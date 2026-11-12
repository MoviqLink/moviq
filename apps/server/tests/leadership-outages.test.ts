import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { systemClock } from '../src/infrastructure/clock/clock.js';
import type { Database } from '../src/infrastructure/database/database.js';
import { runAsLeader, type LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import { createLeaseStore, type LeaseStore } from '../src/infrastructure/jobs/lease.js';
import { leadershipDatabase, messages, startRunner, untilTermEnds } from './support/leadership.js';
import { memoryLogger } from './support/memory-logger.js';
import type { TempDatabase } from './support/temp-database.js';
import { waitFor } from './support/wait.js';

let temp: TempDatabase;
let db: Database;

beforeEach(async () => {
  ({ temp, db } = await leadershipDatabase());
});

afterEach(async () => {
  await temp.dispose();
});

describe('runAsLeader during database outages', () => {
  it('stops the work before expiry when the database cannot confirm the lease', async () => {
    const real = createLeaseStore(db, systemClock);
    let failing = false;
    const store: LeaseStore = {
      ...real,
      renew: (lease, ttlMs) =>
        failing ? Promise.reject(new Error('database unreachable')) : real.renew(lease, ttlMs),
    };
    let term: LeaderTerm | undefined;
    const startedAt = performance.now();
    const runner = startRunner(db, {
      holder: 'a',
      store,
      ttlMs: 300,
      intervalMs: 100,
      work: untilTermEnds((t) => (term = t)),
    });
    await waitFor(() => term !== undefined);
    failing = true;
    await waitFor(() => term?.signal.aborted === true);
    expect(performance.now() - startedAt).toBeLessThan(300);
    await runner.stop();
    expect(messages(runner.log)).toContain('lease renew failed');
    expect(runner.log.entries().find((entry) => entry['msg'] === 'lease lost')).toMatchObject({
      reason: 'expired',
    });
  });

  it('stops the work before expiry when renewals are slow to fail (regression)', async () => {
    const real = createLeaseStore(db, systemClock);
    let failing = false;
    const store: LeaseStore = {
      ...real,
      renew: (lease, ttlMs) =>
        failing
          ? new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error('timeout'));
              }, 80);
            })
          : real.renew(lease, ttlMs),
    };
    let term: LeaderTerm | undefined;
    const startedAt = performance.now();
    const runner = startRunner(db, {
      holder: 'a',
      store,
      ttlMs: 300,
      intervalMs: 100,
      work: untilTermEnds((t) => (term = t)),
    });
    await waitFor(() => term !== undefined);
    failing = true;
    await waitFor(() => term?.signal.aborted === true);
    expect(performance.now() - startedAt).toBeLessThan(300);
    await runner.stop();
  });

  it('stops the work before expiry and stops cleanly when a renewal hangs (regression)', async () => {
    const real = createLeaseStore(db, systemClock);
    let hanging = false;
    const store: LeaseStore = {
      ...real,
      renew: (lease, ttlMs) => (hanging ? new Promise(() => undefined) : real.renew(lease, ttlMs)),
    };
    let term: LeaderTerm | undefined;
    const startedAt = performance.now();
    const runner = startRunner(db, {
      holder: 'a',
      store,
      ttlMs: 300,
      intervalMs: 100,
      work: untilTermEnds((t) => (term = t)),
    });
    await waitFor(() => term !== undefined);
    hanging = true;
    await waitFor(() => term?.signal.aborted === true);
    expect(performance.now() - startedAt).toBeLessThan(300);
    await runner.stop();
  });

  it('stops cleanly when asked to stop while it is taking the lease (regression)', async () => {
    const real = createLeaseStore(db, systemClock);
    const controller = new AbortController();
    const store: LeaseStore = {
      ...real,
      acquire: async (name, holder, ttlMs) => {
        controller.abort();
        return real.acquire(name, holder, ttlMs);
      },
    };
    let started = false;
    const log = memoryLogger();
    const running = runAsLeader({
      db,
      clock: systemClock,
      store,
      name: 'worker',
      holder: 'a',
      ttlMs: 1_000,
      intervalMs: 20,
      logger: log.logger,
      signal: controller.signal,
      work: untilTermEnds(() => (started = true)),
    });
    const outcome = await Promise.race([
      running.then(() => 'stopped'),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('still running');
        }, 1_000);
      }),
    ]);
    expect(outcome).toBe('stopped');
    expect(started).toBe(false);
    expect(await real.acquire('worker', 'b', 1_000)).toBeDefined();
  });
});
