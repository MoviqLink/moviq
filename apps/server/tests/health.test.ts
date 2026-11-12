import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiErrorSchema, livenessSchema, readinessSchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import {
  migrate,
  readMigrations,
  type Migration,
} from '../src/infrastructure/database/migrations.js';
import { healthRoutes } from '../src/modules/operations/health.js';
import { manualClock } from './support/manual-clock.js';
import { testApp } from './support/app.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

const clock = manualClock('2026-11-11T09:00:00.000Z');
let temp: TempDatabase;
let migrations: readonly Migration[];

beforeEach(async () => {
  temp = await tempDatabase();
  migrations = await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url)));
});

afterEach(async () => {
  await temp.dispose();
});

function appWith(db: Database) {
  return testApp({ db, migrations, clock });
}

/** A database whose reads fail or never answer, to stand in for an outage. */
function brokenDatabase(behaviour: 'fails' | 'hangs'): Database {
  const read = () =>
    behaviour === 'fails'
      ? Promise.reject(new Error('disk I/O error'))
      : new Promise<never>(() => undefined);
  return { query: read, execute: read, transaction: read, close: () => undefined };
}

describe('GET /healthz', () => {
  it('answers while the process runs, without touching the database', async () => {
    const { app } = appWith(brokenDatabase('fails'));
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(livenessSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  it('is ready when the database answers and every migration is applied', async () => {
    const db = await temp.open();
    await migrate(db, migrations, clock);
    const response = await appWith(db).app.request('/readyz');
    expect(response.status).toBe(200);
    const body = readinessSchema.parse(await response.json());
    expect(body).toMatchObject({
      status: 'ready',
      version: '1.2.3',
      checkedAt: '2026-11-11T09:00:00.000Z',
      checks: { database: { ok: true }, migrations: { ok: true, pending: 0 } },
    });
  });

  it('is not ready while migrations are pending', async () => {
    const response = await appWith(await temp.open()).app.request('/readyz');
    expect(response.status).toBe(503);
    const body = readinessSchema.parse(await response.json());
    expect(body.checks.migrations).toMatchObject({ ok: false, pending: migrations.length });
    expect(body.checks.migrations.detail).toBe(
      `${String(migrations.length)} migration(s) not applied yet.`,
    );
  });

  it('is not ready when the database fails, and says so plainly', async () => {
    const response = await appWith(brokenDatabase('fails')).app.request('/readyz');
    expect(response.status).toBe(503);
    const body = readinessSchema.parse(await response.json());
    expect(body.checks.database).toMatchObject({
      ok: false,
      detail: 'The database could not be read.',
    });
    expect(JSON.stringify(body)).not.toContain('disk I/O');
  });

  it('is not ready when the database does not answer in time', async () => {
    const db = brokenDatabase('hangs');
    const { app } = testApp({ db, migrations, clock, version: 'x' });
    const quick = healthRoutes({ db, migrations, clock, version: 'x', databaseTimeoutMs: 30 });
    app.route('/quick', quick);
    const body = readinessSchema.parse(await (await app.request('/quick/readyz')).json());
    expect(body.checks.database.detail).toBe('The database did not answer within 30 ms.');
  });
});

describe('the web build', () => {
  it('is served from the same origin, with hashed assets cached and the page revalidated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moviq-web-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>MovIQ</title>');
    await writeFile(join(root, 'assets', 'app-1a2b3c.js'), 'console.log(1)');
    try {
      const { app } = testApp({ db: await temp.open(), migrations, clock, webRoot: root });
      const page = await app.request('/');
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toBe('no-cache');
      const asset = await app.request('/assets/app-1a2b3c.js');
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect((await app.request('/../secret')).status).toBe(404);
      expect((await app.request('/api/ops/summary')).status).toBe(401);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('request context', () => {
  it('answers unknown routes with the shared error body and a request id', async () => {
    const response = await appWith(await temp.open()).app.request('/nothing-here');
    expect(response.status).toBe(404);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error.code).toBe('not_found');
    expect(response.headers.get('x-request-id')).toBe(body.error.requestId);
  });

  it('reuses a well-formed incoming request id and replaces a malformed one', async () => {
    const { app } = appWith(await temp.open());
    const reused = await app.request('/healthz', { headers: { 'x-request-id': 'edge-1234abcd' } });
    expect(reused.headers.get('x-request-id')).toBe('edge-1234abcd');
    const replaced = await app.request('/healthz', { headers: { 'x-request-id': 'bad id!' } });
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs each request by path only, never the query string', async () => {
    const { app, log } = appWith(await temp.open());
    await app.request('/healthz?email=someone%40example.com');
    expect(log.entries().at(-1)).toMatchObject({ msg: 'request', path: '/healthz', status: 200 });
    expect(log.text()).not.toContain('example.com');
  });

  it('turns an unexpected failure into a plain 500 and logs the error', async () => {
    const { app, log } = appWith(await temp.open());
    app.get('/explode', () => {
      throw new Error('internal detail');
    });
    const response = await app.request('/explode');
    expect(response.status).toBe(500);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error.code).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('internal detail');
    expect(log.entries().find((entry) => entry['msg'] === 'unhandled error')).toMatchObject({
      requestId: body.error.requestId,
      error: { message: 'internal detail' },
    });
  });
});
