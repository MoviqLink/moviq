import { fileURLToPath } from 'node:url';

import {
  apiErrorSchema,
  auditListSchema,
  jobListSchema,
  jobSchema,
  opsSessionSchema,
  opsSummarySchema,
  sourceDetailSchema,
  sourceListSchema,
} from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import {
  migrate,
  readMigrations,
  type Migration,
} from '../src/infrastructure/database/migrations.js';
import { jobStore } from '../src/modules/operations/jobs.js';
import { ADMIN_TOKEN, testApp, VIEWER_TOKEN } from './support/app.js';
import { manualClock } from './support/manual-clock.js';
import { testSource } from './support/sources.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

const clock = manualClock('2026-11-11T12:00:00.000Z');
let temp: TempDatabase;
let db: Database;
let migrations: readonly Migration[];
let app: ReturnType<typeof testApp>['app'];

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  migrations = await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url)));
  await migrate(db, migrations, clock);
  ({ app } = testApp({
    db,
    migrations,
    clock,
    definitions: [
      testSource({ id: 'feed-a' }),
      testSource({ id: 'feed-b', integration: 'mta-bus-time' }),
    ],
  }));
});

afterEach(async () => {
  await temp.dispose();
});

async function login(token: string): Promise<string> {
  const response = await app.request('/api/ops/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  expect(response.status).toBe(204);
  const cookie = response.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);
  return cookie.split(';')[0] ?? '';
}

const get = (path: string, cookie: string) => app.request(path, { headers: { cookie } });
const post = (path: string, cookie: string, body: unknown, origin?: string) =>
  app.request(`http://moviq.test${path}`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      ...(origin === undefined ? {} : { origin }),
    },
    body: JSON.stringify(body),
  });

describe('control room sessions', () => {
  it('refuses a wrong token and anything without a session', async () => {
    const wrong = await app.request('/api/ops/session', {
      method: 'POST',
      body: JSON.stringify({ token: 'nope' }),
    });
    expect(wrong.status).toBe(401);
    expect(apiErrorSchema.parse(await wrong.json()).error.code).toBe('unauthorized');
    expect((await app.request('/api/ops/summary')).status).toBe(401);
  });

  it('opens a session per role, reads it back and closes it', async () => {
    const cookie = await login(VIEWER_TOKEN);
    const session = opsSessionSchema.parse(await (await get('/api/ops/session', cookie)).json());
    expect(session).toEqual({ role: 'viewer', expiresAt: '2026-11-12T00:00:00.000Z' });
    const closed = await app.request('/api/ops/session', { method: 'DELETE', headers: { cookie } });
    expect(closed.status).toBe(204);
    expect((await get('/api/ops/session', cookie)).status).toBe(401);
  });

  it('stores only a hash of the session id', async () => {
    const cookie = await login(ADMIN_TOKEN);
    const id = cookie.split('=')[1] ?? '';
    const stored = await db.query('SELECT id_hash FROM ops_sessions');
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.['id_hash']).not.toBe(id);
  });

  it('slows down repeated login attempts', async () => {
    const attempt = () =>
      app.request('/api/ops/session', { method: 'POST', body: JSON.stringify({ token: 'nope' }) });
    for (let index = 0; index < 10; index += 1) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});

describe('control room API', () => {
  it('serves the summary, the sources and their detail in the shapes of the contracts', async () => {
    const cookie = await login(VIEWER_TOKEN);
    const summary = opsSummarySchema.parse(await (await get('/api/ops/summary', cookie)).json());
    expect(summary.sourcesByState.unknown).toBe(2);
    expect(summary.features).toEqual([
      {
        id: 'trip-watch',
        state: 'unavailable',
        sources: ['feed-a', 'feed-b'],
        evidence: '2 of 2 sources need attention: feed-a (unknown), feed-b (unknown).',
      },
    ]);
    const list = sourceListSchema.parse(await (await get('/api/ops/sources', cookie)).json());
    expect(list.sources.map((row) => [row.id, row.state, row.nextRunReason])).toEqual([
      ['feed-a', 'unknown', 'interval'],
      ['feed-b', 'unknown', 'interval'],
    ]);
    const detail = sourceDetailSchema.parse(
      await (await get('/api/ops/sources/feed-a', cookie)).json(),
    );
    expect(detail.licence.name).toBe('Test licence');
    expect((await get('/api/ops/sources/nope', cookie)).status).toBe(404);
    expect(jobListSchema.parse(await (await get('/api/ops/jobs', cookie)).json()).jobs).toEqual([]);
  });

  it('lets an admin ask for a refresh with a reason, recorded in the audit log', async () => {
    const cookie = await login(ADMIN_TOKEN);
    const response = await post('/api/ops/sources/feed-a/refresh', cookie, {
      reason: 'verify after the outage',
    });
    expect(response.status).toBe(202);
    const job = jobSchema.parse(await response.json());
    expect(job).toMatchObject({
      kind: 'source.refresh',
      target: 'feed-a',
      state: 'pending',
      reason: 'verify after the outage',
    });
    const audit = auditListSchema.parse(await (await get('/api/ops/audit', cookie)).json());
    expect(audit.entries).toMatchObject([
      { action: 'source.refresh', target: 'feed-a', reason: 'verify after the outage' },
    ]);
    expect(audit.entries[0]?.actor).toMatch(/^ops:admin:[0-9a-f]{8}$/);
  });

  it('refuses actions from viewers, without a reason, or from another origin', async () => {
    const viewer = await login(VIEWER_TOKEN);
    expect(
      (await post('/api/ops/sources/feed-a/refresh', viewer, { reason: 'just looking' })).status,
    ).toBe(403);
    const admin = await login(ADMIN_TOKEN);
    expect((await post('/api/ops/sources/feed-a/refresh', admin, { reason: '' })).status).toBe(400);
    expect(
      (
        await post(
          '/api/ops/sources/feed-a/refresh',
          admin,
          { reason: 'valid reason' },
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (await post('/api/ops/sources/nope/refresh', admin, { reason: 'valid reason' })).status,
    ).toBe(404);
  });

  it('cancels a pending job, and refuses to cancel one already running', async () => {
    const cookie = await login(ADMIN_TOKEN);
    const pending = jobSchema.parse(
      await (await post('/api/ops/sources/feed-a/refresh', cookie, { reason: 'first try' })).json(),
    );
    const cancelled = await post(`/api/ops/jobs/${String(pending.id)}/cancel`, cookie, {
      reason: 'asked twice',
    });
    expect(jobSchema.parse(await cancelled.json()).state).toBe('cancelled');
    const second = jobSchema.parse(
      await (
        await post('/api/ops/sources/feed-a/refresh', cookie, { reason: 'second try' })
      ).json(),
    );
    await db.transaction((tx) => jobStore.start(tx, second.id, clock.now()));
    const conflict = await post(`/api/ops/jobs/${String(second.id)}/cancel`, cookie, {
      reason: 'too late',
    });
    expect(conflict.status).toBe(409);
    expect((await post('/api/ops/jobs/999/cancel', cookie, { reason: 'missing job' })).status).toBe(
      404,
    );
  });

  it('refuses request bodies over the limit before reading them (regression A06)', async () => {
    const big = JSON.stringify({ token: ADMIN_TOKEN, padding: 'x'.repeat(4 * 1024 * 1024) });
    const declared = await app.request('/api/ops/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    });
    expect(declared.status).toBe(413);
    expect(apiErrorSchema.parse(await declared.json()).error.code).toBe('too_large');
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 64; index += 1)
          controller.enqueue(new TextEncoder().encode('x'.repeat(64 * 1024)));
        controller.close();
      },
    });
    const streamed = await app.request(
      new Request('http://moviq.test/api/ops/session', {
        method: 'POST',
        body: chunks,
        duplex: 'half',
      }),
    );
    expect(streamed.status).toBe(413);
  });

  it('says how much history the worker probe has before claiming there are no gaps (regression A07)', async () => {
    const cookie = await login(VIEWER_TOKEN);
    const empty = opsSummarySchema.parse(await (await get('/api/ops/summary', cookie)).json());
    expect(empty.worker).toMatchObject({ observedFrom: null, gapsLast24h: [], beatsLast24h: 0 });
    await db.execute({
      sql: 'INSERT INTO worker_heartbeats (beat_at, holder, fencing_token, latency_ms) VALUES (?, ?, 1, 2)',
      args: ['2026-11-11T11:50:00.000Z', 'w'],
    });
    const some = opsSummarySchema.parse(await (await get('/api/ops/summary', cookie)).json());
    expect(some.worker.observedFrom).toBe('2026-11-11T11:50:00.000Z');
  });

  it('lists jobs by state with totals, so no pending job hides behind newer ones (regression A08)', async () => {
    const cookie = await login(ADMIN_TOKEN);
    for (const reason of ['one', 'two', 'three'])
      await post('/api/ops/sources/feed-a/refresh', cookie, { reason: `refresh ${reason}` });
    const first = jobListSchema
      .parse(await (await get('/api/ops/jobs', cookie)).json())
      .jobs.at(-1);
    await post(`/api/ops/jobs/${String(first?.id ?? 0)}/cancel`, cookie, { reason: 'not needed' });
    const pending = jobListSchema.parse(
      await (await get('/api/ops/jobs?state=pending', cookie)).json(),
    );
    expect(pending.jobs.map((job) => job.state)).toEqual(['pending', 'pending']);
    expect(pending.totals).toMatchObject({ pending: 2, cancelled: 1, running: 0 });
    expect((await get('/api/ops/jobs?state=nonsense', cookie)).status).toBe(400);
  });
});
