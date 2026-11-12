import type { Clock } from '../../infrastructure/clock/clock.js';
import { pause } from '../../infrastructure/clock/pause.js';
import type { Database } from '../../infrastructure/database/database.js';
import { LeaseLostError, type LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import { jobStore } from '../operations/jobs.js';
import type { Collect, CollectRequest } from './collector.js';
import type { SourceDefinition } from './definition.js';
import { healthStore } from './health-store.js';
import { NO_FACTS } from './health.js';
import { interestStore } from './interests.js';
import { planNextRun, type NextRun } from './schedule.js';

export interface SchedulerOptions {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly definitions: readonly SourceDefinition[];
  readonly collect: Collect;
  readonly missingVariables: (definition: SourceDefinition) => readonly string[];
  readonly tickMs: number;
  /** Real-time sources and heavy timetables run in separate lanes, so one never waits for the other. */
  readonly lanes: { readonly realtime: number; readonly static: number };
  readonly retentionMs: number;
  readonly random: () => number;
}

interface Running {
  readonly kind: SourceDefinition['kind'];
  readonly done: Promise<void>;
}

const HOUSEKEEPING_EVERY_MS = 60 * 60_000;
/** A job that was running when the worker stopped is tried again, up to this many times. */
const MAX_JOB_ATTEMPTS = 3;

/**
 * The leader's collection loop: each tick starts the sources that are due, within their lane,
 * and the refreshes people asked for. Only a lost lease ends it early.
 */
export async function runScheduler(term: LeaderTerm, options: SchedulerOptions): Promise<void> {
  const running = new Map<string, Running>();
  let lastHousekeeping = Number.NEGATIVE_INFINITY;
  await term.fenced((tx) => jobStore.recoverInterrupted(tx, options.clock.now(), MAX_JOB_ATTEMPTS));
  try {
    while (!term.signal.aborted) {
      try {
        await startManualRefreshes(term, options, running);
        await startDueSources(term, options, running);
        const now = options.clock.now().getTime();
        if (now - lastHousekeeping >= HOUSEKEEPING_EVERY_MS) {
          await housekeeping(term, options);
          lastHousekeeping = now;
        }
      } catch (error) {
        if (error instanceof LeaseLostError) throw error;
        options.logger.error('scheduler tick failed', { error });
      }
      await pause(options.tickMs, term.signal);
    }
  } finally {
    await Promise.allSettled([...running.values()].map((run) => run.done));
  }
}

async function startDueSources(
  term: LeaderTerm,
  options: SchedulerOptions,
  running: Map<string, Running>,
): Promise<void> {
  const now = options.clock.now();
  const [health, interested] = await Promise.all([
    healthStore.readAll(options.db),
    interestStore.activeSourceIds(options.db, now),
  ]);
  const due = options.definitions
    .filter((definition) => !running.has(definition.id))
    .map((definition): Due => {
      const facts = health.get(definition.id) ?? NO_FACTS;
      return {
        definition,
        neverRead: facts.lastAttemptAt === undefined,
        plan: planNextRun(definition, facts, {
          now,
          interested: interested.has(definition.id),
          missingVariables: options.missingVariables(definition),
          random: options.random,
        }),
      };
    })
    .filter(({ plan }) => plan.at !== undefined && plan.at <= now)
    .sort(byTurn);
  for (const { definition } of due) {
    if (laneIsFull(options, running, definition)) continue;
    launch(term, options, running, definition, {
      trigger: 'schedule',
      requestedBy: null,
      reason: null,
    });
  }
}

interface Due {
  readonly definition: SourceDefinition;
  /** No attempt yet, as on a fresh database. */
  readonly neverRead: boolean;
  readonly plan: NextRun;
}

/**
 * A source never read goes before any retry, so failing sources retried every few seconds cannot
 * hold back the first reading of the others in their lane; then the longest overdue goes first.
 */
function byTurn(a: Due, b: Due): number {
  if (a.neverRead !== b.neverRead) return a.neverRead ? -1 : 1;
  return (a.plan.at?.getTime() ?? 0) - (b.plan.at?.getTime() ?? 0);
}

function laneIsFull(
  options: SchedulerOptions,
  running: ReadonlyMap<string, Running>,
  definition: SourceDefinition,
): boolean {
  const inLane = [...running.values()].filter((run) => run.kind === definition.kind).length;
  return inLane >= options.lanes[definition.kind];
}

/**
 * Starts the refreshes people asked for, oldest first. They share the lanes with scheduled runs
 * and respect the provider's Retry-After: a job that has to wait stays pending and says until when.
 */
async function startManualRefreshes(
  term: LeaderTerm,
  options: SchedulerOptions,
  running: Map<string, Running>,
): Promise<void> {
  const jobs = await jobStore.pending(options.db, 'source.refresh');
  if (jobs.length === 0) return;
  const health = await healthStore.readAll(options.db);
  for (const job of jobs) {
    if (running.has(job.target)) continue;
    const definition = options.definitions.find((candidate) => candidate.id === job.target);
    if (definition === undefined) {
      await failUnknown(term, options, job.id, job.target);
      continue;
    }
    if (laneIsFull(options, running, definition)) continue;
    const now = options.clock.now();
    const retryNotBefore = health.get(definition.id)?.retryNotBefore;
    if (retryNotBefore !== undefined && retryNotBefore > now) {
      const note = `Waiting for the provider until ${retryNotBefore.toISOString()}.`;
      if (job.lastError !== note) await term.fenced((tx) => jobStore.note(tx, job.id, note));
      continue;
    }
    if (!(await term.fenced((tx) => jobStore.start(tx, job.id, now)))) continue;
    const request = {
      trigger: 'manual',
      requestedBy: job.requestedBy,
      reason: job.reason,
    } as const;
    launch(term, options, running, definition, request, async (outcome) => {
      await term.fenced((tx) =>
        jobStore.finish(tx, job.id, outcome.state, outcome.error, options.clock.now()),
      );
    });
  }
}

async function failUnknown(
  term: LeaderTerm,
  options: SchedulerOptions,
  id: number,
  target: string,
): Promise<void> {
  await term.fenced(async (tx) => {
    if (await jobStore.start(tx, id, options.clock.now()))
      await jobStore.finish(tx, id, 'failed', `Unknown source ${target}.`, options.clock.now());
  });
}

interface JobOutcome {
  readonly state: 'done' | 'failed';
  readonly error: string | null;
}

function launch(
  term: LeaderTerm,
  options: SchedulerOptions,
  running: Map<string, Running>,
  definition: SourceDefinition,
  request: CollectRequest,
  onFinish: (outcome: JobOutcome) => Promise<void> = () => Promise.resolve(),
): void {
  const done = options
    .collect(definition, term, request)
    .then(
      (result): JobOutcome =>
        result.outcome === 'admitted' || result.outcome === 'unchanged'
          ? { state: 'done', error: null }
          : {
              state: 'failed',
              error: `${result.outcome} (${result.errorCode}): ${result.evidence}`,
            },
      (error: unknown): JobOutcome => {
        if (!(error instanceof LeaseLostError))
          options.logger.error('source run crashed', { source: definition.id, error });
        return { state: 'failed', error: error instanceof Error ? error.message : String(error) };
      },
    )
    .then(onFinish)
    .catch((error: unknown) => {
      if (!(error instanceof LeaseLostError))
        options.logger.error('job update failed', { source: definition.id, error });
    })
    .finally(() => {
      running.delete(definition.id);
    });
  running.set(definition.id, { kind: definition.kind, done });
}

async function housekeeping(term: LeaderTerm, options: SchedulerOptions): Promise<void> {
  const now = options.clock.now();
  const cutoff = new Date(now.getTime() - options.retentionMs);
  await term.fenced(async (tx) => {
    for (const statement of healthStore.retentionStatements(cutoff)) await tx.execute(statement);
    await tx.execute(interestStore.expiredStatement(now));
  });
}
