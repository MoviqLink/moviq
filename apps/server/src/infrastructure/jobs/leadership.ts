import type { Transaction } from '@libsql/client';
import { toInstant } from '@moviq/contracts';

import type { Clock } from '../clock/clock.js';
import { pause } from '../clock/pause.js';
import type { Database } from '../database/database.js';
import type { Logger } from '../telemetry/logger.js';
import type { Lease, LeaseStore } from './lease.js';

export class LeaseLostError extends Error {
  constructor(name: string) {
    super(`The lease "${name}" is no longer held by this process.`);
    this.name = 'LeaseLostError';
  }
}

/** One uninterrupted period during which this process holds the lease. */
export interface LeaderTerm {
  readonly name: string;
  readonly holder: string;
  readonly fencingToken: number;
  /** Fires as soon as the lease is lost or the process stops. Work must stop when it does. */
  readonly signal: AbortSignal;
  /** Runs `work` in a write transaction that commits only if this term still holds the lease. */
  fenced<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

export type LeaderWork = (term: LeaderTerm) => Promise<void>;

export interface LeadershipOptions {
  readonly db: Database;
  readonly clock: Clock;
  readonly store: LeaseStore;
  readonly name: string;
  readonly holder: string;
  readonly ttlMs: number;
  /** How often to try to take or renew the lease. At most half of `ttlMs`. */
  readonly intervalMs: number;
  readonly logger: Logger;
  readonly signal: AbortSignal;
  readonly work: LeaderWork;
}

/** Why a term ended. Only a term that still holds its lease has one to release. */
type TermEnd =
  | { readonly reason: 'stopped'; readonly lease: Lease }
  | { readonly reason: 'work-ended'; readonly lease: Lease }
  | { readonly reason: 'lost'; readonly lease: undefined }
  | { readonly reason: 'expired'; readonly lease: undefined };

const STILL_HELD = `SELECT 1 FROM worker_leases
WHERE name = :name AND holder = :holder AND fencing_token = :token AND expires_at > :now`;

/**
 * Runs `work` only while this process holds the lease, until `signal` aborts. Each time the lease
 * is taken a new term starts; when it is lost, cannot be renewed in time, or the process stops,
 * the term's signal fires and its fenced writes can no longer commit.
 */
export async function runAsLeader(options: LeadershipOptions): Promise<void> {
  if (options.intervalMs * 2 > options.ttlMs) {
    throw new RangeError('intervalMs must be at most half of ttlMs');
  }
  while (!options.signal.aborted) {
    const requestedAt = performance.now();
    const lease = await attempt(options, 'acquire', () =>
      options.store.acquire(options.name, options.holder, options.ttlMs),
    );
    if (lease !== undefined && lease !== null) {
      if (stopRequested(options.signal)) await releaseQuietly(options, lease);
      else await serveTerm(options, lease, requestedAt);
    }
    await pause(options.intervalMs, options.signal);
  }
}

/**
 * Reads the signal again after an await. TypeScript keeps the narrowing of `signal.aborted`
 * across awaits, but the signal may have fired meanwhile.
 */
function stopRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function serveTerm(
  options: LeadershipOptions,
  acquired: Lease,
  requestedAt: number,
): Promise<void> {
  const { logger, name, signal } = options;
  logger.info('lease acquired', { lease: name, fencingToken: acquired.fencingToken });
  const term = new AbortController();
  const stop = () => {
    term.abort();
  };
  signal.addEventListener('abort', stop, { once: true });
  const working = runWork(options, acquired, term.signal);
  const end = await holdLease(options, acquired, requestedAt, term.signal, working);
  term.abort();
  await working;
  signal.removeEventListener('abort', stop);
  if (end.lease === undefined) {
    logger.warn('lease lost', {
      lease: name,
      fencingToken: acquired.fencingToken,
      reason: end.reason,
    });
    return;
  }
  await releaseQuietly(options, end.lease);
}

/**
 * Renews the lease until the term must end. The lease is trusted only until a local deadline:
 * the moment the last successful request was sent, plus the lease duration, minus one interval.
 * The deadline runs on a monotonic timer, so a renewal that is slow to fail or never answers
 * still ends the term before the lease can expire.
 */
async function holdLease(
  options: LeadershipOptions,
  acquired: Lease,
  requestedAt: number,
  termSignal: AbortSignal,
  working: Promise<void>,
): Promise<TermEnd> {
  const workEnded = new AbortController();
  void working.then(() => {
    workEnded.abort();
  });
  const deadline = new LeaseDeadline(options.ttlMs - options.intervalMs);
  deadline.renewed(requestedAt);
  let lease = acquired;
  try {
    for (;;) {
      const wake = AbortSignal.any([termSignal, workEnded.signal, deadline.signal]);
      await pause(options.intervalMs, wake);
      const stopped = checkTerm(termSignal, workEnded.signal, deadline.signal, lease);
      if (stopped !== undefined) return stopped;
      const sentAt = performance.now();
      const renewed = await untilAborted(
        attempt(options, 'renew', () => options.store.renew(lease, options.ttlMs)),
        AbortSignal.any([termSignal, deadline.signal]),
      );
      if (renewed === undefined) return { reason: 'lost', lease: undefined };
      if (renewed !== null && renewed !== ABORTED) {
        lease = renewed;
        deadline.renewed(sentAt);
      }
    }
  } finally {
    deadline.clear();
  }
}

function checkTerm(
  termSignal: AbortSignal,
  workEnded: AbortSignal,
  expired: AbortSignal,
  lease: Lease,
): TermEnd | undefined {
  if (termSignal.aborted) return { reason: 'stopped', lease };
  if (expired.aborted) return { reason: 'expired', lease: undefined };
  if (workEnded.aborted) return { reason: 'work-ended', lease };
  return undefined;
}

/** Fires its signal when the lease can no longer be trusted. */
class LeaseDeadline {
  readonly #trustMs: number;
  readonly #controller = new AbortController();
  #timer: NodeJS.Timeout | undefined;

  constructor(trustMs: number) {
    this.#trustMs = trustMs;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** The lease was granted or renewed by a request sent at `sentAt` (`performance.now()`). */
  renewed(sentAt: number): void {
    this.clear();
    const remaining = sentAt + this.#trustMs - performance.now();
    this.#timer = setTimeout(
      () => {
        this.#controller.abort();
      },
      Math.max(0, remaining),
    );
  }

  clear(): void {
    clearTimeout(this.#timer);
  }
}

const ABORTED = Symbol('aborted');

/** Resolves with the result of `work`, or with ABORTED as soon as `signal` fires. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      resolve(ABORTED);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function runWork(
  options: LeadershipOptions,
  lease: Lease,
  signal: AbortSignal,
): Promise<void> {
  const term: LeaderTerm = {
    name: lease.name,
    holder: lease.holder,
    fencingToken: lease.fencingToken,
    signal,
    fenced: (work) => fenced(options, lease, signal, work),
  };
  try {
    await options.work(term);
  } catch (error) {
    if (error instanceof LeaseLostError || signal.aborted) return;
    options.logger.error('leader work failed', { lease: options.name, error });
  }
}

function fenced<T>(
  options: LeadershipOptions,
  lease: Lease,
  signal: AbortSignal,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return options.db.transaction(async (tx) => {
    if (signal.aborted) throw new LeaseLostError(lease.name);
    const held = await tx.execute({
      sql: STILL_HELD,
      args: {
        name: lease.name,
        holder: lease.holder,
        token: lease.fencingToken,
        now: toInstant(options.clock.now()),
      },
    });
    if (held.rows.length === 0) throw new LeaseLostError(lease.name);
    return work(tx);
  });
}

/** Runs a lease operation; a database error is logged and reported as `null`. */
async function attempt<T>(
  options: LeadershipOptions,
  operation: 'acquire' | 'renew',
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    options.logger.error(`lease ${operation} failed`, { lease: options.name, error });
    return null;
  }
}

async function releaseQuietly(options: LeadershipOptions, lease: Lease): Promise<void> {
  try {
    await options.store.release(lease);
    options.logger.info('lease released', {
      lease: options.name,
      fencingToken: lease.fencingToken,
    });
  } catch (error) {
    options.logger.warn('lease release failed; it will expire on its own', {
      lease: options.name,
      fencingToken: lease.fencingToken,
      error,
    });
  }
}
