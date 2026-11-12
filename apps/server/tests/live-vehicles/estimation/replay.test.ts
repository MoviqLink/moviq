import { describe, expect, it } from 'vitest';

import type { GpsEstimateInput } from '../../../src/modules/live/estimate.js';
import { createPositionEstimator } from '../../../src/modules/live/estimation/estimator.js';
import { place } from '../../../src/modules/live/estimation/line.js';
import { createTrackingErrors } from '../../../src/modules/recorder/nightly/tracking-errors.js';
import { north, straightLine } from './lines.js';
import { statisticsWith } from './statistics.js';

const T0 = Date.parse('2026-11-10T12:00:00Z');
const line = straightLine('M150001', 6_000);
/** A bus that speeds up and slows down, in m/s, over each 30 s between its reports. */
const SPEEDS = [3, 9, 12, 7, 11, 6, 14, 2, 10, 8];
const metersAt = SPEEDS.reduce<number[]>(
  (all, speed) => [...all, (all.at(-1) ?? 0) + speed * 30],
  [0],
);

const input = (meters: number, reportedAt: number, now: number): GpsEstimateInput => ({
  kind: 'gps',
  vehicleId: 'bus:MTA NYCT_7001',
  now: new Date(T0 + now * 1000),
  mode: 'bus',
  route: 'M15',
  direction: 0,
  line,
  latest: { ...north(meters), at: T0 + reportedAt * 1000 },
  stopsAhead: [],
});

describe('the replay of the recorder against the estimator it replays', () => {
  it('finds the error the estimator makes, report by report, at the age of the next one', () => {
    // The estimator draws the bus 30 s after each report, just before the next one comes.
    const estimate = createPositionEstimator(statisticsWith({ metersPerSecond: 10 }));
    const live = metersAt.slice(1).map((meters, index) => {
      const drawn = estimate(input(metersAt[index] ?? 0, index * 30, (index + 1) * 30));
      expect(drawn.basis).toBe('gps-plus');
      return Math.ceil(Math.abs(place(line, drawn).meters - meters) / 5) * 5;
    });
    const replay = createTrackingErrors(() => 10);
    let previous: Parameters<typeof replay.add>[2];
    for (const [index, meters] of metersAt.entries()) {
      const report = {
        route: 'M15',
        trip: 'M15-1',
        point: north(meters),
        at: T0 / 1000 + index * 30,
      };
      replay.add('MTA NYCT_7001', report, previous);
      previous = report;
    }
    const thirty = replay.rows().find((row) => row.ageFrom === 30);
    const counted = [...new Set(live)]
      .sort((a, b) => a - b)
      .map((error) => [error, live.filter((value) => value === error).length]);
    expect(thirty?.counts).toEqual(counted);
    expect(live.some((error) => error > 20)).toBe(true);
  });
});
