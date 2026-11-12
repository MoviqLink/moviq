import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseRow } from '../../src/infrastructure/database/rows.js';
import {
  dropOldSpeeds,
  replaceAggregates,
} from '../../src/modules/recorder/nightly/aggregates-store.js';
import { recorderWorld, type RecorderWorld } from './support.js';

let world: RecorderWorld;

beforeEach(async () => {
  world = await recorderWorld();
});

afterEach(async () => {
  await world.dispose();
});

const nothing = { segments: [], headways: [], predictions: [], stoppages: [], incidents: [] };
const speed = {
  mode: 'bus',
  route: 'M15',
  stretch: '-23464:18108:0',
  band: 'am-peak',
  dayType: 'weekday',
  n: 1,
  counts: [[10, 1]],
} as const;
const tracking = {
  mode: 'bus',
  route: 'M15',
  ageFrom: 30,
  ageTo: 45,
  n: 1,
  counts: [[5, 1]],
} as const;

const daysOf = async (table: string) =>
  (await world.db.query(`SELECT day FROM ${table} ORDER BY day`)).rows.map(
    (row) => parseRow(z.object({ day: z.string() }), row, table).day,
  );

describe('the retention of bus speeds', () => {
  it('keeps 35 days of speeds and every day of the replayed errors', async () => {
    for (const day of ['2026-10-06', '2026-10-07', '2026-11-10'])
      await replaceAggregates(world.term, day, {
        ...nothing,
        speeds: [speed],
        tracking: [tracking],
      });
    expect(await dropOldSpeeds(world.term, '2026-11-11')).toBe(1);
    expect(await daysOf('recorder_stretch_speeds')).toEqual(['2026-10-07', '2026-11-10']);
    expect(await daysOf('recorder_tracking_errors')).toHaveLength(3);
  });
});
