import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RecorderMode } from '../../src/modules/recorder/extractor.js';
import {
  replaceAggregates,
  writeNightly,
} from '../../src/modules/recorder/nightly/aggregates-store.js';
import { segmentDistribution } from '../../src/modules/recorder/reading-estimation.js';
import { manualClock } from '../support/manual-clock.js';
import { recorderWorld, type RecorderWorld } from './support.js';

/** Thursday 12/11/2026 in New York: the window ends on Wednesday 11/11. */
const clock = manualClock('2026-11-12T15:00:00.000Z');
const LEVELS = [0, 0.5, 1];
const KEY = {
  mode: 'subway',
  route: 'A',
  from: 'A06N',
  to: 'A05N',
  band: 'am-peak',
  dayType: 'weekday',
} as const;

let world: RecorderWorld;

beforeEach(async () => {
  world = await recorderWorld();
});

afterEach(async () => {
  await world.dispose();
});

const runs = (mode: RecorderMode, samples: readonly number[]) => ({
  ...KEY,
  mode,
  direction: 'north',
  samples,
  p10: 0,
  p50: 0,
  p90: 0,
});

async function day(name: string, rows: ReturnType<typeof runs>[], reduced = true) {
  await replaceAggregates(world.term, name, {
    segments: rows,
    headways: [],
    predictions: [],
    stoppages: [],
    incidents: [],
    speeds: [],
    tracking: [],
  });
  if (!reduced) return;
  const at = new Date(`${name}T12:00:00.000Z`);
  await writeNightly(world.term, {
    day: name,
    outcome: 'complete',
    startedAt: at,
    finishedAt: at,
    detail: {},
  });
}

describe('run times read for the estimator', () => {
  it('pools the reduced days of the window for one mode, never a bus of the same ids', async () => {
    await day('2026-11-10', [runs('subway', [100, 110, 120]), runs('bus', [900])]);
    await day('2026-11-11', [
      runs(
        'subway',
        Array.from({ length: 17 }, () => 130),
      ),
    ]);
    // Not reduced yet, and out of the window: neither counts.
    await day('2026-11-09', [runs('subway', [1, 2, 3])], false);
    await day('2026-10-01', [runs('subway', [5_000])]);
    expect(await segmentDistribution({ db: world.db, clock }, KEY, LEVELS)).toEqual({
      status: 'ok',
      value: [100, 130, 130],
      n: 20,
      from: '2026-11-10',
      to: '2026-11-11',
      days: 2,
      incompleteDays: [],
    });
  });

  it('gives no figure under 20 runs', async () => {
    await day('2026-11-10', [runs('subway', [100, 110, 120])]);
    expect(await segmentDistribution({ db: world.db, clock }, KEY, LEVELS)).toEqual({
      status: 'no-data',
      n: 3,
      reason: 'Only 3 measures; 20 are needed.',
    });
  });
});
