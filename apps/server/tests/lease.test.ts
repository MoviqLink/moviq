import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { createLeaseStore, type LeaseStore } from '../src/infrastructure/jobs/lease.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const TTL = 30_000;

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;
let store: LeaseStore;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock();
  await migrate(db, await readMigrations(MIGRATIONS), clock);
  store = createLeaseStore(db, clock);
});

afterEach(async () => {
  await temp.dispose();
});

/** Holds the write lock of `target` until `release` is called, as a slow writer would. */
async function holdWriteLock(target: Database): Promise<{ release: () => Promise<void> }> {
  let unblock: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = target.transaction(async () => {
    entered();
    await new Promise<void>((resolve) => {
      unblock = resolve;
    });
  });
  await inside;
  return {
    release: async () => {
      unblock();
      await held;
    },
  };
}

describe('LeaseStore', () => {
  it('gives a free lease to the first holder and refuses it to others while valid', async () => {
    const lease = await store.acquire('worker', 'a', TTL);
    expect(lease).toEqual({
      name: 'worker',
      holder: 'a',
      fencingToken: 1,
      expiresAt: '2026-11-11T12:00:30.000Z',
    });
    clock.advance(TTL - 1);
    expect(await store.acquire('worker', 'b', TTL)).toBeUndefined();
  });

  it('hands an expired lease to a new holder with a higher fencing token', async () => {
    const first = await store.acquire('worker', 'a', TTL);
    clock.advance(TTL);
    const second = await store.acquire('worker', 'b', TTL);
    expect(second?.fencingToken).toBe(2);
    if (first === undefined) throw new Error('first lease missing');
    expect(await store.renew(first, TTL)).toBeUndefined();
  });

  it('lets the holder renew before expiry, and not after', async () => {
    const lease = await store.acquire('worker', 'a', TTL);
    if (lease === undefined) throw new Error('lease missing');
    clock.advance(20_000);
    const renewed = await store.renew(lease, TTL);
    expect(renewed?.expiresAt).toBe('2026-11-11T12:00:50.000Z');
    if (renewed === undefined) throw new Error('renewal missing');
    clock.advance(TTL);
    expect(await store.renew(renewed, TTL)).toBeUndefined();
  });

  it('frees the lease at once on release', async () => {
    const lease = await store.acquire('worker', 'a', TTL);
    if (lease === undefined) throw new Error('lease missing');
    await store.release(lease);
    expect((await store.acquire('worker', 'b', TTL))?.fencingToken).toBe(2);
  });

  it('judges expiry when the write runs, not when it was requested (regression)', async () => {
    const lease = await store.acquire('worker', 'a', TTL);
    if (lease === undefined) throw new Error('lease missing');
    const blocker = await holdWriteLock(db);
    const renewal = store.renew(lease, TTL);
    clock.advance(TTL + 1);
    await blocker.release();
    expect(await renewal).toBeUndefined();
  });

  it('takes an expired lease when the write runs after a wait (regression)', async () => {
    await store.acquire('worker', 'a', TTL);
    const blocker = await holdWriteLock(db);
    const takeover = store.acquire('worker', 'b', TTL);
    clock.advance(TTL);
    await blocker.release();
    expect((await takeover)?.expiresAt).toBe('2026-11-11T12:01:00.000Z');
  });

  it('keeps separate leases for separate names', async () => {
    expect(await store.acquire('worker', 'a', TTL)).toBeDefined();
    expect(await store.acquire('daily-import', 'b', TTL)).toBeDefined();
  });
});
