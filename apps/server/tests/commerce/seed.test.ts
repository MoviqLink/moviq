import type { Leg } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseRow } from '../../src/infrastructure/database/rows.js';
import { merchantStore } from '../../src/modules/commerce/merchants.js';
import { ORDER_TRANSITIONS } from '../../src/modules/commerce/orders-store.js';
import { passTime } from '../../src/modules/commerce/route.js';
import { commerceSettings } from '../../src/modules/commerce/settings.js';
import { commerceWorld, type CommerceWorld } from './support/commerce.js';

let world: CommerceWorld;

beforeEach(async () => {
  world = await commerceWorld();
});

afterEach(async () => {
  await world.temp.dispose();
});

const transitionSchema = z.object({ from_status: z.string(), to_status: z.string() });

describe('the demo merchants, seeded by the migration', () => {
  it('are all demos next to a real M60 stop, with valid menus and agent rules', async () => {
    const merchants = await merchantStore.all(world.db);
    expect(merchants.length).toBeGreaterThanOrEqual(5);
    for (const merchant of merchants) {
      expect(merchant.summary.demo).toBe(true);
      expect(merchant.summary.id).toMatch(/^demo-/);
      expect(merchant.summary.stop.routes).toContain('M60');
      const setup = await merchantStore.setup(world.db, merchant);
      expect(setup.menu.length).toBeGreaterThan(0);
      for (const id of setup.rules.featuredItemIds)
        expect(setup.menu.map((item) => item.id)).toContain(id);
      expect(setup.rules.maxDiscountPercent).toBeGreaterThanOrEqual(10);
    }
  });

  it('keeps the order transitions equal in code and in the database', async () => {
    const rows = await world.db.query(
      'SELECT from_status, to_status FROM commerce_order_transitions',
    );
    const stored = rows.rows
      .map((row) => parseRow(transitionSchema, row, 'transitions'))
      .map((r) => `${r.from_status}>${r.to_status}`);
    const code = Object.entries(ORDER_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}>${to}`),
    );
    expect(stored.sort()).toEqual(code.sort());
  });

  it('refuses a merchant that is not a demo', async () => {
    const insert = world.db.execute(
      `INSERT INTO commerce_merchants (id, demo, name, kind, lat, lon, stop_id, stop_name,
         stop_lat, stop_lon, stop_routes, walk_minutes, code_letter, payout_receiver)
       VALUES ('real-cafe', 0, 'Real', 'cafe', 40.8, -73.9, '1', 'x', 40.8, -73.9, '[]', 1,
         'Z', 'x')`,
    );
    await expect(insert).rejects.toThrow();
  });
});

describe('merchants on the way', () => {
  const place = (lat: number, lon: number) => ({
    label: 'x',
    lat,
    lon,
    kind: 'stop' as const,
    stopId: null,
  });
  const bus: Leg = {
    mode: 'bus',
    from: place(40.8078, -73.9638),
    to: place(40.804, -73.9369),
    departAt: '2026-11-11T23:30:00.000Z',
    arriveAt: '2026-11-11T23:50:00.000Z',
    route: { id: 'M60', shortName: 'M60', headsign: 'LaGuardia' },
    tripId: null,
    timing: 'scheduled',
    provenance: {
      sourceId: 'mta-gtfs-static',
      dataTime: null,
      receivedAt: null,
      ageSeconds: null,
      state: 'healthy',
      evidence: 'Timetable.',
    },
    path: [
      [-73.963847, 40.807777],
      [-73.95, 40.806],
      [-73.936892, 40.804052],
    ],
  };

  it("estimates when the journey passes a merchant's stop from the leg's own path and times", () => {
    expect(passTime([bus], { lat: 40.804052, lon: -73.936892 })?.toISOString()).toBe(
      '2026-11-11T23:50:00.000Z',
    );
    expect(passTime([bus], { lat: 40.807777, lon: -73.963847 })?.toISOString()).toBe(
      '2026-11-11T23:30:00.000Z',
    );
    expect(passTime([bus], { lat: 40.75, lon: -73.99 })).toBeUndefined();
    expect(passTime([bus], { lat: 40.8069, lon: -73.9569 })).toBeDefined();
    expect(passTime([{ ...bus, path: [] }], { lat: 40.8069, lon: -73.9569 })).toBeUndefined();
  });
});

describe('commerce settings', () => {
  it('require a pickup-code secret in production, and keep the program minimum configurable', () => {
    expect(commerceSettings({ APP_ENV: 'production' }).ok).toBe(false);
    const result = commerceSettings({ APP_ENV: 'development', MIN_REWARD_PERCENT: '15' });
    expect(result.ok && result.settings.minRewardPercent).toBe(15);
    expect(commerceSettings({ MIN_REWARD_PERCENT: '0' }).ok).toBe(false);
  });
});
