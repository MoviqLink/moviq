import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { toInstant } from '@moviq/contracts';
import type { Transaction } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { createHttpClient } from '../src/infrastructure/http/client.js';
import type { LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import { createCollector, type Collect } from '../src/modules/data-platform/collector.js';
import type { SourceDefinition } from '../src/modules/data-platform/definition.js';
import { healthStore } from '../src/modules/data-platform/health-store.js';
import { interestStore } from '../src/modules/data-platform/interests.js';
import { runScheduler, type SchedulerOptions } from '../src/modules/data-platform/scheduler.js';
import { jobStore } from '../src/modules/operations/jobs.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { testSource, type Sample } from './support/sources.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';
import { waitFor } from './support/wait.js';

let temp: TempDatabase;
let db: Database;
let server: Server;
let base = '';
let clock: ManualClock;
let active = 0;
let maxActive = 0;
let delayMs = 0;
let status = 200;
/** The paths asked for, in order. */
let requested: string[] = [];

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock('2026-11-11T12:00:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
  active = 0;
  maxActive = 0;
  delayMs = 0;
  status = 200;
  requested = [];
  server = createServer((request, response) => {
    requested.push(request.url ?? '');
    active += 1;
    maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      active -= 1;
      response
        .writeHead(status)
        .end(JSON.stringify({ items: [1, 2, 3], at: clock.now().toISOString() }));
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await temp.dispose();
});

function source(
  id: string,
  overrides: Partial<SourceDefinition<Sample>> = {},
): SourceDefinition<Sample> {
  return testSource({ id, request: () => ({ url: `${base}/${id}` }), ...overrides });
}

function start(
  definitions: readonly SourceDefinition[],
  overrides: Partial<SchedulerOptions> = {},
) {
  const controller = new AbortController();
  const term: LeaderTerm = {
    name: 'worker',
    holder: 'test',
    fencingToken: 1,
    signal: controller.signal,
    fenced: (work) => db.transaction(work),
  };
  const collect: Collect = createCollector({
    db,
    http: createHttpClient(),
    clock,
    logger: memoryLogger().logger,
    credentials: () => ({ missing: [], values: {} }),
    sanitize: (text) => text,
  });
  const running = runScheduler(term, {
    db,
    clock,
    logger: memoryLogger().logger,
    definitions,
    collect,
    missingVariables: () => [],
    tickMs: 10,
    lanes: { realtime: 4, static: 1 },
    retentionMs: 30 * 24 * 60 * 60_000,
    random: () => 0.5,
    ...overrides,
  });
  return async () => {
    controller.abort();
    await running;
  };
}

const runCount = async (id: string) => (await healthStore.runs(db, id, 100)).length;
const jobsNow = () => jobStore.list(db, 'all', 20);
const jobById = async (id: number) => (await jobsNow()).find((job) => job.id === id);
/** A manual refresh of `target`, asked for as the control room does. */
const ask = (tx: Transaction, target: string, reason: string) =>
  jobStore.create(
    tx,
    { kind: 'source.refresh', target, requestedBy: 'ops:admin', reason },
    clock.now(),
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('runScheduler', () => {
  it('runs each source when due, and not again before its interval', async () => {
    const stop = start([source('a'), source('b')]);
    await waitFor(async () => (await runCount('a')) === 1 && (await runCount('b')) === 1);
    clock.advance(59_000);
    await settle();
    expect(await runCount('a')).toBe(1);
    clock.advance(1_000);
    await waitFor(async () => (await runCount('a')) === 2);
    await stop();
  });

  it('runs faster while something is interested', async () => {
    const stop = start([source('a')]);
    await waitFor(async () => (await runCount('a')) === 1);
    await interestStore.register(
      db,
      { kind: 'screen', ref: 's1', sourceIds: ['a'], ttlMs: 120_000 },
      clock.now(),
    );
    clock.advance(15_000);
    await waitFor(async () => (await runCount('a')) === 2);
    await stop();
  });

  it('never runs a source whose credential is missing', async () => {
    const stop = start([source('a')], { missingVariables: () => ['MTA_BUSTIME_KEY'] });
    await settle();
    await stop();
    expect(await runCount('a')).toBe(0);
  });

  it('runs heavy timetables one at a time in their own lane', async () => {
    delayMs = 60;
    const timetables = ['t1', 't2', 't3'].map((id) => source(id, { kind: 'static' }));
    const stop = start(timetables);
    await waitFor(async () =>
      (await Promise.all(['t1', 't2', 't3'].map(runCount))).every((n) => n === 1),
    );
    await stop();
    expect(maxActive).toBe(1);
  });

  it('reads a source never read before retrying one that failed (regression e2e-verde)', async () => {
    status = 500;
    const timetable = (id: string) => source(id, { kind: 'static' });
    const first = start([timetable('failing')]);
    await waitFor(async () => (await runCount('failing')) === 1);
    await first();
    // The retry is due (5 s after one failure) when a timetable never read joins the lane.
    clock.advance(6_000);
    const stop = start([timetable('failing'), timetable('fresh')]);
    await waitFor(async () => (await runCount('fresh')) === 1);
    await stop();
    expect(requested.slice(1, 2)).toEqual(['/fresh']);
  });

  it('carries out refreshes people asked for, with who and why, and fails unknown targets', async () => {
    const stop = start([source('a')]);
    await waitFor(async () => (await runCount('a')) === 1);
    const [asked, unknown] = await db.transaction(async (tx) => [
      await ask(tx, 'a', 'check after outage'),
      await ask(tx, 'nope', 'typo'),
    ]);
    await waitFor(async () =>
      (await jobsNow()).every((job) => job.state === 'done' || job.state === 'failed'),
    );
    await stop();
    const jobs = new Map((await jobsNow()).map((job) => [job.id, job]));
    expect(jobs.get(asked.id)).toMatchObject({ state: 'done', attempts: 1, lastError: null });
    expect(jobs.get(unknown.id)).toMatchObject({
      state: 'failed',
      lastError: 'Unknown source nope.',
    });
    expect((await healthStore.runs(db, 'a', 10))[0]).toMatchObject({
      trigger: 'manual',
      requestedBy: 'ops:admin',
      reason: 'check after outage',
    });
  });

  it('deletes runs past their retention and expired interests', async () => {
    await db.execute({
      sql: `INSERT INTO source_runs (source_id, trigger, started_at, finished_at, outcome, duration_ms)
            VALUES ('a', 'schedule', ?, ?, 'failed', 1)`,
      args: [
        toInstant(new Date('2026-09-01T00:00:00Z')),
        toInstant(new Date('2026-09-01T00:00:01Z')),
      ],
    });
    await interestStore.register(
      db,
      { kind: 'screen', ref: 'old', sourceIds: ['a'], ttlMs: 1 },
      new Date('2026-11-10T00:00:00Z'),
    );
    const stop = start([]);
    await waitFor(async () => (await runCount('a')) === 0);
    await stop();
    const interests = await db.query('SELECT COUNT(*) AS n FROM interests');
    expect(interests.rows[0]?.['n']).toBe(0);
  });

  it('marks a refresh that could not collect as failed, not done (regression A03)', async () => {
    status = 500;
    const stop = start([source('a')]);
    await waitFor(async () => (await runCount('a')) === 1);
    const job = await db.transaction((tx) => ask(tx, 'a', 'after outage'));
    await waitFor(async () => {
      const state = (await jobById(job.id))?.state;
      return state === 'done' || state === 'failed';
    });
    await stop();
    const finished = await jobById(job.id);
    expect(finished).toMatchObject({ state: 'failed' });
    expect(finished?.lastError).toContain('http-500');
  });

  it('keeps manual refreshes within their lane (regression A04)', async () => {
    delayMs = 60;
    const timetables = ['t1', 't2', 't3'].map((id) =>
      source(id, { kind: 'static', rhythm: { class: 'cold', baseIntervalMs: 86_400_000 } }),
    );
    const stop = start(timetables);
    await waitFor(async () =>
      (await Promise.all(['t1', 't2', 't3'].map(runCount))).every((n) => n === 1),
    );
    maxActive = 0;
    await db.transaction(async (tx) => {
      for (const id of ['t1', 't2', 't3']) {
        await ask(tx, id, 'refresh all');
      }
    });
    await waitFor(async () => (await jobsNow()).every((job) => job.state === 'done'));
    await stop();
    expect(maxActive).toBe(1);
  });

  it('waits for the provider Retry-After before a manual refresh, saying so (regression A04)', async () => {
    const stop = start([source('a')]);
    await waitFor(async () => (await runCount('a')) === 1);
    await stop();
    await db.execute({
      sql: `UPDATE source_health
            SET last_outcome = 'rate_limited', consecutive_failures = 1, retry_not_before = ?
            WHERE source_id = 'a'`,
      args: [new Date(clock.now().getTime() + 120_000).toISOString()],
    });
    const job = await db.transaction((tx) => ask(tx, 'a', 'try now'));
    const again = start([source('a')]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const waiting = await jobById(job.id);
    expect(waiting?.state).toBe('pending');
    expect(waiting?.lastError).toMatch(/^Waiting for the provider until /);
    expect(await runCount('a')).toBe(1);
    clock.advance(121_000);
    await waitFor(async () => (await jobById(job.id))?.state === 'done');
    await again();
  });

  it('takes back a refresh interrupted by a crash, and gives up after three tries (regression A02)', async () => {
    const [interrupted, exhausted] = await db.transaction(async (tx) => {
      const first = await ask(tx, 'a', 'one');
      const second = await ask(tx, 'a', 'two');
      await jobStore.start(tx, first.id, clock.now());
      await tx.execute({
        sql: "UPDATE jobs SET state = 'running', attempts = 3 WHERE id = ?",
        args: [second.id],
      });
      return [first, second];
    });
    const stop = start([source('a')]);
    await waitFor(async () =>
      (await jobsNow()).every((job) => job.state === 'done' || job.state === 'failed'),
    );
    await stop();
    const jobs = new Map((await jobsNow()).map((job) => [job.id, job]));
    expect(jobs.get(interrupted.id)).toMatchObject({ state: 'done', attempts: 2 });
    expect(jobs.get(exhausted.id)).toMatchObject({
      state: 'failed',
      lastError: 'Interrupted three times by a restart; not tried again.',
    });
  });
});
