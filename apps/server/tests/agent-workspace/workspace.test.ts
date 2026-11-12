import { fileURLToPath } from 'node:url';
import { agentDetailSchema, agentListSchema } from '@moviq/contracts';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import { lockTurn, unlockTurn } from '../../src/modules/agent-workspace/store.js';
import { checkRoadWatches, nextRoad } from '../../src/modules/agent-workspace/road-watch.js';
import type { LeaderTerm } from '../../src/infrastructure/jobs/leadership.js';
import type { SourceReader } from '../../src/modules/data-platform/reader.js';
import { findRoad, readRoads, recentMeasurement } from '../../src/modules/agent-workspace/roads.js';
import { fakeReader } from '../assistant/city-doubles.js';
import { nextWatch } from '../../src/modules/agent-workspace/watch.js';
import { browser } from '../commerce/support/commerce.js';
import { testApp } from '../support/app.js';
import { manualClock } from '../support/manual-clock.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';

let temp: TempDatabase | undefined;
afterEach(async () => {
  await temp?.dispose();
  temp = undefined;
});
async function world() {
  temp = await tempDatabase();
  const db = await temp.open();
  const clock = manualClock('2026-11-11T22:31:00.000Z');
  const migrations = await readMigrations(
    fileURLToPath(new URL('../../migrations/', import.meta.url)),
  );
  await migrate(db, migrations, clock);
  const { app } = testApp({ db, migrations, clock });
  return { db, clock, app, visitor: browser(app), stranger: browser(app) };
}
it('enforces the agent limit and isolates stored chats and ownership', async () => {
  const { visitor, stranger } = await world();
  const first = agentListSchema.parse((await visitor.get('/api/agents')).body).agents[0];
  if (!first) throw new Error('Sara missing');
  await visitor.post('/api/agents', { name: 'Nora' });
  const list = agentListSchema.parse((await visitor.post('/api/agents', { name: 'Leo' })).body);
  expect(list.agents).toHaveLength(3);
  expect((await visitor.post('/api/agents', { name: 'Fourth' })).status).toBe(409);
  const second = list.agents[1];
  if (!second) throw new Error('Agent missing');
  expect(
    (await visitor.post(`/api/agents/${first.id}/turns`, { message: 'Hello from one', lang: 'en' }))
      .status,
  ).toBe(200);
  expect(
    (
      await visitor.post(`/api/agents/${second.id}/turns`, {
        message: 'Hello from two',
        lang: 'en',
      })
    ).status,
  ).toBe(200);
  const a = agentDetailSchema.parse((await visitor.get(`/api/agents/${first.id}`)).body);
  const b = agentDetailSchema.parse((await visitor.get(`/api/agents/${second.id}`)).body);
  expect(a.messages[0]?.text).toBe('Hello from one');
  expect(b.messages[0]?.text).toBe('Hello from two');
  expect((await stranger.get(`/api/agents/${first.id}`)).status).toBe(404);
  expect((await stranger.post(`/api/agents/${first.id}/watches`, { line: '7' })).status).toBe(404);
  expect((await visitor.post(`/api/agents/${second.id}/watches`, { line: '7' })).status).toBe(201);
  expect(
    (await visitor.post(`/api/agents/${second.id}/watches`, { line: 'unknown road' })).status,
  ).toBe(400);
  const street = await visitor.post(`/api/agents/${second.id}/watches`, {
    line: 'Broadway',
    kind: 'street',
    segmentId: 'unverified',
    thresholdKmh: 30,
  });
  expect(street.status).toBe(400);
});
it('serializes concurrent turns for one agent and rejects stale unlocks', async () => {
  const { db, clock, visitor } = await world();
  const id = agentListSchema.parse((await visitor.get('/api/agents')).body).agents[0]?.id;
  const row = (await db.query('SELECT id FROM travellers')).rows[0];
  const traveller = z.object({ id: z.string() }).parse(row).id;
  if (!id) throw new Error('missing agent');
  const [one, two] = await Promise.all([
    lockTurn(db, traveller, id, clock.now()),
    lockTurn(db, traveller, id, clock.now()),
  ]);
  expect([one, two].filter(Boolean)).toHaveLength(1);
  await unlockTurn(db, id, 'stale');
  expect(await lockTurn(db, traveller, id, clock.now())).toBeNull();
  await unlockTurn(db, id, one ?? two ?? '');
  expect(await lockTurn(db, traveller, id, clock.now())).not.toBeNull();
});
it('never marks a source failure as a cleared alert', () => {
  expect(nextWatch({ available: false, count: null }, true)).toEqual({
    status: 'unavailable',
    sawAlert: true,
    notify: false,
  });
  expect(nextWatch({ available: true, count: 0 }, true)).toEqual({
    status: 'clear',
    sawAlert: false,
    notify: true,
  });
  expect(nextWatch({ available: true, count: 0 }, false).notify).toBe(false);
});

it('notifies only after a measured below-threshold baseline and two new readings above it', () => {
  const baseline = nextRoad(
    { below: false, consecutive: 0, measuredAt: null },
    '2026-01-01T00:00:00.000Z',
    15,
    30,
  );
  const first = nextRoad(baseline, '2026-01-01T00:05:00.000Z', 35, 30);
  expect(first.notify).toBe(false);
  expect(nextRoad(first, '2026-01-01T00:05:00.000Z', 35, 30).notify).toBe(false);
  const second = nextRoad(first, '2026-01-01T00:10:00.000Z', 40, 30);
  expect(second.notify).toBe(true);
  expect(nextRoad(second, '2026-01-01T00:15:00.000Z', 40, 30).notify).toBe(false);
  expect(recentMeasurement('2026-01-01T00:00:00.000Z', new Date('2026-01-01T00:16:00.000Z'))).toBe(
    false,
  );
});

it('returns only recent named road segments and rejects stale or unknown segments', async () => {
  const now = new Date('2026-11-11T12:00:00.000Z');
  const reader = fakeReader({
    'nyc-dot-traffic-speeds': {
      data: {
        measuredUpTo: '2026-11-11T11:59:00.000Z',
        segments: [
          {
            id: '42',
            name: 'Broadway',
            borough: 'Manhattan',
            measuredAt: '2026-11-11T11:59:00.000Z',
            path: null,
            speedMph: 20,
            travelTimeSeconds: 10,
          },
        ],
        suspect: [],
        droppedPoints: 0,
      },
    },
  });
  expect((await readRoads(reader, now, 'broad')).segments.map((item) => item.id)).toEqual(['42']);
  expect((await findRoad(reader, now, '42'))?.name).toBe('Broadway');
  expect(await findRoad(reader, now, 'unknown')).toBeUndefined();
  expect(await findRoad(reader, new Date('2026-11-11T12:20:00.000Z'), '42')).toBeUndefined();
  const unavailable = fakeReader({});
  expect((await readRoads(unavailable, now, 'broad')).available).toBe(false);
});

it('the worker persists fresh crossings and never calls a missing reading clear', async () => {
  const { db, clock, visitor } = await world();
  const id = agentListSchema.parse((await visitor.get('/api/agents')).body).agents[0]?.id;
  if (id === undefined) throw new Error('missing agent');
  await db.execute({
    sql: `INSERT INTO workspace_watches
      (id, agent_id, line, kind, status, segment_id, threshold_kmh, created_at)
      VALUES ('watch', ?, 'Broadway', 'street', 'waiting', '42', 30, ?)`,
    args: [id, clock.now().toISOString()],
  });
  const term: LeaderTerm = {
    name: 'test',
    holder: 'test',
    fencingToken: 1,
    signal: new AbortController().signal,
    fenced: (work) => db.transaction(work),
  };
  const row = async () =>
    z
      .object({
        status: z.string(),
        speed_kmh: z.number().nullable(),
        alerted_at: z.string().nullable(),
        consecutive: z.number(),
      })
      .parse(
        (
          await db.query({
            sql: 'SELECT status, speed_kmh, alerted_at, consecutive FROM workspace_watches WHERE id = ?',
            args: ['watch'],
          })
        ).rows[0],
      );
  const measure = (speedMph: number) =>
    fakeReader({
      'nyc-dot-traffic-speeds': {
        data: {
          measuredUpTo: clock.now().toISOString(),
          segments: [
            {
              id: '42',
              name: 'Broadway',
              borough: 'Manhattan',
              measuredAt: clock.now().toISOString(),
              path: null,
              speedMph,
              travelTimeSeconds: 10,
            },
          ],
          suspect: [],
          droppedPoints: 0,
        },
      },
    });
  await checkRoadWatches(term, { db, clock, reader: measure(10) });
  expect((await row()).status).toBe('active');
  clock.advance(5 * 60_000);
  const first = measure(25);
  await checkRoadWatches(term, { db, clock, reader: first });
  await checkRoadWatches(term, { db, clock, reader: first });
  expect((await row()).consecutive).toBe(1);
  expect((await row()).alerted_at).toBeNull();
  await checkRoadWatches(term, { db, clock, reader: fakeReader({}) });
  expect((await row()).status).toBe('unavailable');
  expect((await row()).alerted_at).toBeNull();
  clock.advance(5 * 60_000);
  await checkRoadWatches(term, { db, clock, reader: measure(25) });
  expect((await row()).alerted_at).toBeNull();
  clock.advance(5 * 60_000);
  await checkRoadWatches(term, { db, clock, reader: measure(25) });
  expect((await row()).alerted_at).not.toBeNull();
});

it('a road reading started before pause and resume cannot overwrite the new generation', async () => {
  const { db, clock, visitor } = await world();
  const id = agentListSchema.parse((await visitor.get('/api/agents')).body).agents[0]?.id;
  if (id === undefined) throw new Error('missing agent');
  await db.execute({
    sql: `INSERT INTO workspace_watches
      (id, agent_id, line, kind, status, segment_id, threshold_kmh, created_at)
      VALUES ('race', ?, 'Broadway', 'street', 'waiting', '42', 30, ?)`,
    args: [id, clock.now().toISOString()],
  });
  const term: LeaderTerm = {
    name: 'test',
    holder: 'test',
    fencingToken: 1,
    signal: new AbortController().signal,
    fenced: (work) => db.transaction(work),
  };
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const empty = fakeReader({});
  const delayed: SourceReader = {
    async read(definition) {
      started();
      await gate;
      return empty.read(definition);
    },
  };
  const pending = checkRoadWatches(term, { db, clock, reader: delayed });
  await entered;
  await db.execute({
    sql: `UPDATE workspace_watches SET status = 'waiting', generation = generation + 2 WHERE id = ?`,
    args: ['race'],
  });
  release();
  await pending;
  const row = z.object({ status: z.string(), generation: z.number() }).parse(
    (
      await db.query({
        sql: 'SELECT status, generation FROM workspace_watches WHERE id = ?',
        args: ['race'],
      })
    ).rows[0],
  );
  expect(row).toEqual({ status: 'waiting', generation: 2 });
});
