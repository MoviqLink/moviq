import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { systemClock } from '../src/infrastructure/clock/clock.js';
import { pause } from '../src/infrastructure/clock/pause.js';
import type { Database } from '../src/infrastructure/database/database.js';
import {
  LeaseLostError,
  runAsLeader,
  type LeaderTerm,
  type LeaderWork,
} from '../src/infrastructure/jobs/leadership.js';
import { createLeaseStore, type LeaseStore } from '../src/infrastructure/jobs/lease.js';
import {
  leadershipDatabase,
  logWrite,
  messages,
  startRunner,
  untilTermEnds,
  workLog,
} from './support/leadership.js';
import { manualClock } from './support/manual-clock.js';
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

describe('runAsLeader', () => {
  it('runs the work while it holds the lease, then stops it and releases the lease', async () => {
    let started = false;
    const runner = startRunner(db, { holder: 'a', work: untilTermEnds(() => (started = true)) });
    await waitFor(() => started);
    const store = createLeaseStore(db, systemClock);
    expect(await store.acquire('worker', 'b', 1_000)).toBeUndefined();
    await runner.stop();
    expect(messages(runner.log)).toEqual(['lease acquired', 'lease released']);
    expect(await store.acquire('worker', 'b', 1_000)).toBeDefined();
  });

  it('never lets two workers run the work at once, and hands it over between them', async () => {
    const [connectionA, connectionB] = await Promise.all([temp.open(), temp.open()]);
    let active = 0;
    let maxActive = 0;
    const work: LeaderWork = async (term) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        for (let write = 0; write < 3 && !term.signal.aborted; write += 1) {
          await logWrite(term);
          await pause(15, term.signal);
        }
      } finally {
        active -= 1;
      }
    };
    const a = startRunner(connectionA, { holder: 'a', work, intervalMs: 150, ttlMs: 400 });
    await waitFor(async () => (await workLog(db)).length > 0);
    const b = startRunner(connectionB, { holder: 'b', work, intervalMs: 20, ttlMs: 400 });
    await waitFor(async () => (await workLog(db)).some((row) => row.holder === 'b'));
    await Promise.all([a.stop(), b.stop()]);

    expect(maxActive).toBe(1);
    const rows = await workLog(db);
    const holderOfToken = new Map<number, string>();
    rows.forEach((row, index) => {
      if (index > 0) expect(row.token).toBeGreaterThanOrEqual(rows[index - 1]?.token ?? 0);
      expect(holderOfToken.get(row.token) ?? row.holder).toBe(row.holder);
      holderOfToken.set(row.token, row.holder);
    });
  });

  it('refuses to commit for a holder that lost the lease, even before it notices', async () => {
    const clock = manualClock();
    let term: LeaderTerm | undefined;
    const runner = startRunner(db, {
      holder: 'a',
      clock,
      ttlMs: 30_000,
      intervalMs: 10_000,
      work: untilTermEnds((started) => (term = started)),
    });
    await waitFor(() => term !== undefined);
    clock.advance(30_001);
    const store = createLeaseStore(db, clock);
    expect(await store.acquire('worker', 'b', 30_000)).toBeDefined();
    if (term === undefined) throw new Error('term missing');
    await expect(logWrite(term)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await workLog(db)).toEqual([]);
    await runner.stop();
    expect(await store.acquire('worker', 'c', 30_000)).toBeUndefined();
  });

  it('stops the work as soon as a renewal shows another worker took over', async () => {
    const clock = manualClock();
    let term: LeaderTerm | undefined;
    const runner = startRunner(db, { holder: 'a', clock, work: untilTermEnds((t) => (term = t)) });
    await waitFor(() => term !== undefined);
    clock.advance(1_000);
    expect(await createLeaseStore(db, clock).acquire('worker', 'b', 1_000)).toBeDefined();
    await waitFor(() => term?.signal.aborted === true);
    await runner.stop();
    expect(runner.log.entries().find((entry) => entry['msg'] === 'lease lost')).toMatchObject({
      reason: 'lost',
      fencingToken: 1,
    });
  });

  it('logs a failed release on stop without failing the stop', async () => {
    const real = createLeaseStore(db, systemClock);
    const store: LeaseStore = { ...real, release: () => Promise.reject(new Error('disk full')) };
    let started = false;
    const runner = startRunner(db, {
      holder: 'a',
      store,
      work: untilTermEnds(() => (started = true)),
    });
    await waitFor(() => started);
    await expect(runner.stop()).resolves.toBeUndefined();
    expect(messages(runner.log)).toContain('lease release failed; it will expire on its own');
  });

  it('ends the term when the work fails, and runs it again in a new term', async () => {
    const tokens: number[] = [];
    const work: LeaderWork = async (term) => {
      tokens.push(term.fencingToken);
      if (tokens.length === 1) throw new Error('boom');
      await untilTermEnds()(term);
    };
    const runner = startRunner(db, { holder: 'a', work });
    await waitFor(() => tokens.length === 2);
    await runner.stop();
    expect(tokens).toEqual([1, 2]);
    expect(messages(runner.log)).toContain('leader work failed');
  });

  it('refuses an interval too close to the lease duration', async () => {
    await expect(
      runAsLeader({
        db,
        clock: systemClock,
        store: createLeaseStore(db, systemClock),
        name: 'worker',
        holder: 'a',
        ttlMs: 100,
        intervalMs: 60,
        logger: memoryLogger().logger,
        signal: new AbortController().signal,
        work: untilTermEnds(),
      }),
    ).rejects.toThrow(RangeError);
  });
});
