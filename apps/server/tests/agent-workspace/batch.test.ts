import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import type { LeaderTerm } from '../../src/infrastructure/jobs/leadership.js';
import { checkRoadWatches } from '../../src/modules/agent-workspace/road-watch.js';
import { checkWatches } from '../../src/modules/agent-workspace/watch.js';
import { fakeReader } from '../assistant/city-doubles.js';
import { addTraveller } from '../payments/support/payments.js';
import { manualClock } from '../support/manual-clock.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';

let temp: TempDatabase;
beforeEach(async () => {
  temp = await tempDatabase();
});
afterEach(async () => {
  await temp.dispose();
});

it('rotates bounded transit and road batches without starving either kind', async () => {
  const clock = manualClock('2026-11-11T22:31:00.000Z');
  const db = await temp.open();
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../../migrations/', import.meta.url))),
    clock,
  );
  const travellerId = await addTraveller(db, clock);
  const agent = { id: 'batch-agent' };
  await db.execute({
    sql: `INSERT INTO workspace_agents (id, traveller_id, name, is_primary, created_at) VALUES (?, ?, 'A', 1, ?)`,
    args: [agent.id, travellerId, clock.now().toISOString()],
  });
  for (const kind of ['line', 'street'] as const) {
    await db.execute({
      sql: `WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 101)
        INSERT INTO workspace_watches (id, agent_id, line, kind, status, segment_id, threshold_kmh, created_at)
        SELECT ? || n, ?, ?, ?, 'waiting', ?, ?, ? FROM seq`,
      args: [
        kind,
        agent.id,
        kind === 'line' ? '7' : 'Broadway',
        kind,
        kind === 'street' ? '42' : null,
        kind === 'street' ? 30 : null,
        clock.now().toISOString(),
      ],
    });
  }
  const term: LeaderTerm = {
    name: 'test',
    holder: 'test',
    fencingToken: 1,
    signal: new AbortController().signal,
    fenced: (work) => db.transaction(work),
  };
  const deps = { db, clock, reader: fakeReader({}) };
  const counts = async () =>
    (
      await db.query({
        sql: `SELECT kind, COUNT(*) AS n FROM workspace_watches
      WHERE checked_at IS NOT NULL GROUP BY kind ORDER BY kind`,
        args: [],
      })
    ).rows.map((row) => z.object({ kind: z.string(), n: z.number() }).parse(row));
  await checkWatches(term, deps);
  await checkRoadWatches(term, deps);
  expect(await counts()).toEqual([
    { kind: 'line', n: 100 },
    { kind: 'street', n: 100 },
  ]);
  clock.advance(60_000);
  await checkWatches(term, deps);
  await checkRoadWatches(term, deps);
  expect(await counts()).toEqual([
    { kind: 'line', n: 101 },
    { kind: 'street', n: 101 },
  ]);
});
