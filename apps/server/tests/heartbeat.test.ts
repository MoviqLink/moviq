import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { LeaseLostError, type LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import { runHeartbeat } from '../src/modules/operations/heartbeat.js';
import { manualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

const DAY = 24 * 60 * 60 * 1000;
const clock = manualClock('2026-11-11T12:00:00.000Z');
let temp: TempDatabase;
let db: Database;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
});

afterEach(async () => {
  await temp.dispose();
});

/** A term whose fenced writes go straight to the database, stopping after `beats` heartbeats. */
function termFor(beats: number): LeaderTerm {
  const controller = new AbortController();
  let written = 0;
  return {
    name: 'worker',
    holder: 'worker-a',
    fencingToken: 4,
    signal: controller.signal,
    fenced: (work) =>
      db.transaction(async (tx) => {
        const result = await work(tx);
        written += 1;
        if (written >= beats) controller.abort();
        return result;
      }),
  };
}

describe('runHeartbeat', () => {
  it('records one beat per interval with the holder, its fencing token and the latency', async () => {
    await runHeartbeat(termFor(3), {
      clock,
      intervalMs: 5,
      retentionMs: DAY,
      logger: memoryLogger().logger,
    });
    const rows = (await db.query('SELECT * FROM worker_heartbeats ORDER BY id')).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      beat_at: '2026-11-11T12:00:00.000Z',
      holder: 'worker-a',
      fencing_token: 4,
    });
    expect(rows.every((row) => Number(row['latency_ms']) >= 0)).toBe(true);
  });

  it('deletes beats older than the retention period', async () => {
    await db.execute({
      sql: 'INSERT INTO worker_heartbeats (beat_at, holder, fencing_token, latency_ms) VALUES (?, ?, ?, ?)',
      args: ['2026-11-01T00:00:00.000Z', 'worker-old', 1, 3],
    });
    await runHeartbeat(termFor(1), {
      clock,
      intervalMs: 5,
      retentionMs: DAY,
      logger: memoryLogger().logger,
    });
    const holders = (await db.query('SELECT holder FROM worker_heartbeats')).rows.map(
      (row) => row['holder'],
    );
    expect(holders).toEqual(['worker-a']);
  });

  it('keeps beating with the same term after a passing failure (regression)', async () => {
    const term = termFor(2);
    let calls = 0;
    const flaky: LeaderTerm = {
      ...term,
      fenced: (work) => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('database busy')) : term.fenced(work);
      },
    };
    const log = memoryLogger();
    await runHeartbeat(flaky, { clock, intervalMs: 5, retentionMs: DAY, logger: log.logger });
    const tokens = (await db.query('SELECT fencing_token FROM worker_heartbeats')).rows.map(
      (row) => row['fencing_token'],
    );
    expect(tokens).toEqual([4, 4]);
    expect(log.entries().map((entry) => entry['msg'])).toContain('heartbeat failed');
  });

  it('writes nothing once the lease is lost', async () => {
    const lost: LeaderTerm = {
      ...termFor(1),
      fenced: () => Promise.reject(new LeaseLostError('worker')),
    };
    await expect(
      runHeartbeat(lost, { clock, intervalMs: 5, retentionMs: DAY, logger: memoryLogger().logger }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect((await db.query('SELECT COUNT(*) AS n FROM worker_heartbeats')).rows[0]?.['n']).toBe(0);
  });
});
