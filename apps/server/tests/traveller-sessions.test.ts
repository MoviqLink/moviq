import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { requestContext } from '../src/infrastructure/http/context.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
} from '../src/modules/identity/traveller-sessions.js';
import { manualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

const clock = manualClock();
let temp: TempDatabase;
let db: Database;
let app: Hono<TravellerBindings>;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
  const deps = { db, clock, secureCookies: false };
  app = new Hono<TravellerBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.use(readTraveller(deps));
  app.get('/who', (c) => c.json({ travellerId: c.var.travellerId ?? null }));
  app.post('/act', ensureTraveller(deps), (c) =>
    c.json({ travellerId: c.var.travellerId ?? null }),
  );
});

afterEach(async () => {
  await temp.dispose();
});

const count = async (table: string) =>
  Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]?.['n']);

describe('traveller sessions', () => {
  it('leaves nothing behind for plain visits', async () => {
    const response = await app.request('/who');
    expect(await response.json()).toEqual({ travellerId: null });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await count('travellers')).toBe(0);
  });

  it('creates an anonymous traveller on the first action and recognises the device after', async () => {
    const first = await app.request('/act', { method: 'POST' });
    const { travellerId } = (await first.json()) as { travellerId: string };
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(first.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    const again = await app.request('/act', { method: 'POST', headers: { cookie } });
    expect(await again.json()).toEqual({ travellerId });
    expect(again.headers.get('set-cookie')).toBeNull();
    expect(await (await app.request('/who', { headers: { cookie } })).json()).toEqual({
      travellerId,
    });
    expect(await count('travellers')).toBe(1);
  });

  it('stores only a hash of the session id, and ignores unknown or expired sessions', async () => {
    const first = await app.request('/act', { method: 'POST' });
    const id = ((first.headers.get('set-cookie') ?? '').split(';')[0] ?? '').split('=')[1] ?? '';
    const stored = await db.query('SELECT id_hash FROM traveller_sessions');
    expect(stored.rows[0]?.['id_hash']).not.toBe(id);
    expect(
      await (await app.request('/who', { headers: { cookie: 'moviq_session=forged' } })).json(),
    ).toEqual({ travellerId: null });
    clock.advance(31 * 24 * 60 * 60_000);
    expect(
      await (await app.request('/who', { headers: { cookie: `moviq_session=${id}` } })).json(),
    ).toEqual({ travellerId: null });
  });
});
