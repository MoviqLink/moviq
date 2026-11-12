import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { createHttpClient } from '../src/infrastructure/http/client.js';
import { createTextSanitizer } from '../src/infrastructure/telemetry/sanitize.js';
import { Secret } from '../src/config/secret.js';
import { LeaseLostError, type LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import {
  createCollector,
  type Collect,
  type CredentialResolver,
} from '../src/modules/data-platform/collector.js';
import type { SourceDefinition } from '../src/modules/data-platform/definition.js';
import { healthStore } from '../src/modules/data-platform/health-store.js';
import { encodeSnapshot, snapshotStore } from '../src/modules/data-platform/snapshots.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { testSource, type Sample } from './support/sources.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

type Reply = (request: IncomingMessage, response: ServerResponse) => void;

let temp: TempDatabase;
let db: Database;
let server: Server;
let reply: Reply;
let requests = 0;
let clock: ManualClock;
let source: SourceDefinition<Sample>;

const json =
  (body: unknown, headers: Record<string, string> = {}): Reply =>
  (_, response) => {
    response
      .writeHead(200, { 'content-type': 'application/json', ...headers })
      .end(JSON.stringify(body));
  };
const sample = (items: number[], at = '2026-11-11T11:59:50.000Z') => ({ items, at });
const term: LeaderTerm = {
  name: 'worker',
  holder: 'test',
  fencingToken: 1,
  signal: new AbortController().signal,
  fenced: (work) => db.transaction(work),
};
const noCredentials: CredentialResolver = () => ({ missing: [], values: {} });
const manual = { trigger: 'schedule', requestedBy: null, reason: null } as const;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock('2026-11-11T12:00:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
  requests = 0;
  reply = json(sample([1, 2, 3, 4]));
  server = createServer((request, response) => {
    requests += 1;
    reply(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  source = testSource({ request: () => ({ url: `http://127.0.0.1:${String(port)}/feed` }) });
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await temp.dispose();
});

function collector(
  credentials: CredentialResolver = noCredentials,
  sanitize: (text: string) => string = (text) => text,
): Collect {
  return createCollector({
    db,
    http: createHttpClient(),
    clock,
    logger: memoryLogger().logger,
    credentials,
    sanitize,
  });
}

const health = () => healthStore.read(db, 'test-feed');
const runs = () => healthStore.runs(db, 'test-feed', 50);

describe('the admission chain', () => {
  it('admits a valid candidate: snapshot, facts, run and the first incident', async () => {
    const result = await collector()(source, term, manual);
    expect(result).toMatchObject({ outcome: 'admitted', state: 'healthy' });
    const record = await health();
    expect(record).toMatchObject({ coverage: '4 items', consecutiveFailures: 0, state: 'healthy' });
    expect(record?.dataTime?.toISOString()).toBe('2026-11-11T11:59:50.000Z');
    expect(await snapshotStore.read(db, 'test-feed', record?.servedVersion ?? '')).toEqual(
      sample([1, 2, 3, 4]),
    );
    expect((await runs())[0]).toMatchObject({
      outcome: 'admitted',
      httpStatus: 200,
      coverage: '4 items',
    });
    expect(await healthStore.incidents(db, 'test-feed', 5)).toMatchObject([
      { fromState: 'unknown', toState: 'healthy' },
    ]);
  });

  it('records the same content, or a 304 for the ETag held, as unchanged', async () => {
    const collect = collector();
    reply = json(sample([1, 2, 3, 4]), { etag: '"v1"' });
    await collect(source, term, manual);
    expect((await collect(source, term, manual)).outcome).toBe('unchanged');
    reply = (request, response) => {
      response.writeHead(request.headers['if-none-match'] === '"v1"' ? 304 : 500).end();
    };
    expect((await collect(source, term, manual)).outcome).toBe('unchanged');
    expect((await runs()).map((run) => run.outcome)).toEqual([
      'unchanged',
      'unchanged',
      'admitted',
    ]);
  });

  it('fetches a full body to rebuild an old representation despite a matching ETag', async () => {
    const collect = collector();
    reply = json(sample([1, 2, 3, 4]), { etag: '"v1"' });
    await collect(source, term, manual);
    const upgrade: SourceDefinition<Sample> = {
      ...source,
      needsFullRefresh: (previous) => previous.items[0] === 1,
      parse: (body, context) => {
        const parsed = source.parse(body, context);
        return parsed.ok ? { ...parsed, data: { ...parsed.data, items: [2, 2, 3, 4] } } : parsed;
      },
    };
    let conditional: string | undefined;
    reply = (request, response) => {
      conditional = request.headers['if-none-match'];
      if (conditional === '"v1"') response.writeHead(304).end();
      else json(sample([1, 2, 3, 4]), { etag: '"v1"' })(request, response);
    };
    expect((await collect(upgrade, term, manual)).outcome).toBe('admitted');
    expect(conditional).toBeUndefined();
    expect((await collect(upgrade, term, manual)).outcome).toBe('unchanged');
    expect(conditional).toBe('"v1"');
  });

  it('never lets a bad candidate replace the served data', async () => {
    const collect = collector();
    await collect(source, term, manual);
    const served = (await health())?.servedVersion;
    for (const bad of [
      (_: IncomingMessage, response: ServerResponse) => response.writeHead(200).end('not json'),
      json({ wrong: true }),
      json(sample([1])),
      json(sample([1, 2, 3, 4, 5], '2026-11-11T11:00:00.000Z')),
      json(sample([1, 2, 3, 4, 5], '2026-11-11T12:30:00.000Z')),
    ]) {
      reply = bad;
      expect((await collect(source, term, manual)).outcome).toBe('rejected');
    }
    expect((await runs()).slice(0, 5).map((run) => run.errorCode)).toEqual([
      'future-data-time',
      'older-than-served',
      'check-failed',
      'bad-shape',
      'bad-json',
    ]);
    const record = await health();
    expect(record?.servedVersion).toBe(served);
    expect(await snapshotStore.read(db, 'test-feed', served ?? '')).toEqual(sample([1, 2, 3, 4]));
    expect(record).toMatchObject({ consecutiveFailures: 5, state: 'degraded' });
    expect(record?.evidence).toContain('the last attempt failed: future-data-time');
  });

  it('classifies provider failures: server error, rate limit and refused credentials', async () => {
    const collect = collector();
    reply = (_, response) => response.writeHead(503).end();
    expect(await collect(source, term, manual)).toMatchObject({
      outcome: 'failed',
      state: 'unavailable',
    });
    reply = (_, response) => response.writeHead(429, { 'retry-after': '120' }).end();
    expect(await collect(source, term, manual)).toMatchObject({
      outcome: 'rate_limited',
      state: 'rate_limited',
    });
    expect((await health())?.retryNotBefore?.toISOString()).toBe('2026-11-11T12:02:00.000Z');
    reply = (_, response) => response.writeHead(403).end();
    expect(await collect(source, term, manual)).toMatchObject({
      outcome: 'misconfigured',
      state: 'misconfigured',
    });
    expect((await runs()).map((run) => run.errorCode)).toEqual([
      'http-403',
      'http-429',
      'http-503',
    ]);
  });

  it('makes no request at all when a credential is missing', async () => {
    const needsKey = { ...source, integration: 'mta-bus-time' } as const;
    const resolver: CredentialResolver = () => ({ missing: ['MTA_BUSTIME_KEY'], values: {} });
    const result = await collector(resolver)(needsKey, term, manual);
    expect(result).toMatchObject({
      outcome: 'misconfigured',
      evidence: 'Needs MTA_BUSTIME_KEY, which is not set.',
    });
    expect(requests).toBe(0);
  });

  it('ages the served copy: the same facts read later are stale', async () => {
    await collector()(source, term, manual);
    clock.advance(10 * 60_000);
    const later = await collector()(
      { ...source, request: () => ({ url: 'http://127.0.0.1:1/down' }) },
      term,
      manual,
    );
    expect(later.state).toBe('stale');
  });

  it('keeps only the newest versions a source asks for', async () => {
    const timetable = { ...source, keepVersions: 2 };
    const collect = collector();
    for (const items of [
      [1, 2],
      [1, 2, 3],
      [1, 2, 3, 4],
    ]) {
      reply = json(sample(items));
      clock.advance(1_000);
      await collect(timetable, term, manual);
    }
    const stored = await db.query(
      "SELECT COUNT(*) AS n FROM source_snapshots WHERE source_id = 'test-feed'",
    );
    expect(stored.rows[0]?.['n']).toBe(2);
  });

  it('never prunes the version it just stored, even stored in the same instant (regression)', async () => {
    const [a, b] = [encodeSnapshot({ n: 1 }), encodeSnapshot({ n: 2 })];
    const now = clock.now();
    for (const [first, second] of [
      [a, b],
      [b, a],
    ] as const) {
      await db.transaction(async (tx) => {
        await snapshotStore.put(tx, 'tie', first, now, now, 1);
        await snapshotStore.put(tx, 'tie', second, now, now, 1);
      });
      expect(await snapshotStore.read(db, 'tie', second.version)).toBeDefined();
    }
  });

  it('commits nothing when the lease is no longer held', async () => {
    const lost: LeaderTerm = {
      ...term,
      fenced: () => Promise.reject(new LeaseLostError('worker')),
    };
    await expect(collector()(source, lost, manual)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await health()).toBeUndefined();
    expect(await runs()).toEqual([]);
  });

  it('refuses data that breaks its own schema and keeps the served copy (regression A01)', async () => {
    const collect = collector();
    await collect(source, term, manual);
    const served = (await health())?.servedVersion;
    const strict = {
      ...source,
      dataSchema: z.object({ items: z.array(z.number().max(100)), at: z.string() }),
    };
    reply = json(sample([1, 2, 999, 4]));
    expect((await collect(strict, term, manual)).outcome).toBe('rejected');
    expect((await runs())[0]?.errorCode).toBe('schema-mismatch');
    expect((await health())?.servedVersion).toBe(served);
  });

  it('stores and serves provider errors sanitised, never with a credential in them (regression A05)', async () => {
    const leaky = {
      ...source,
      parse: () => ({
        ok: false as const,
        code: 'provider-said',
        detail:
          'denied for known-secret-token-123 with Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      }),
    };
    const sanitize = createTextSanitizer([new Secret('known-secret-token-123')]);
    await collector(noCredentials, sanitize)(leaky, term, manual);
    const stored = JSON.stringify({ health: await health(), runs: await runs() });
    expect(stored).not.toContain('known-secret-token-123');
    expect(stored).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(stored).toContain('[redacted]');
  });
});
