import { describe, expect, it } from 'vitest';

import {
  betweenStations,
  remember,
  type ListedStop,
} from '../../../src/modules/live/estimation/between-stations.js';
import { place } from '../../../src/modules/live/estimation/line.js';
import { progress, runTimeBelief } from '../../../src/modules/live/estimation/run-time.js';
import { noStatistics } from '../../../src/modules/live/estimation/statistics.js';
import { north, straightLine } from './lines.js';
import { EVEN_ERROR, RUN_TIME, recorded, statisticsWith } from './statistics.js';

describe('the run time of a segment, given the train has not arrived', () => {
  it('conditions the recorded distribution on «not arrived after t»', () => {
    // Not arrived after 100 s, half the mass is left: the median is where F = 0.75, 110 s; the
    // 10th percentile where F = 0.55, 102 s; the 90th where F = 0.95, 130 s.
    const belief = runTimeBelief(RUN_TIME, 100, null);
    expect(belief?.p50).toBeCloseTo(110, 6);
    expect(belief?.p10).toBeCloseTo(102, 6);
    expect(belief?.p90).toBeCloseTo(130, 6);
    expect(belief?.withPrediction).toBe(false);
  });

  it('weighs the operator arrival time by its recorded error', () => {
    // Arrival announced 115 s after departure, ±10 s evenly: the run lies in 105–125 s, where the
    // prior mass is 0.125 (105–110), 0.150 (110–120) and 0.025 (120–125) of 0.300.
    const belief = runTimeBelief(RUN_TIME, 100, { afterDeparture: 115, error: EVEN_ERROR });
    expect(belief?.withPrediction).toBe(true);
    expect(belief?.p10).toBeCloseTo(106.2, 6);
    expect(belief?.p50).toBeCloseTo(110 + 0.025 / 0.015, 6);
    expect(belief?.p90).toBeCloseTo(110 + 0.145 / 0.015, 6);
  });

  it('leaves out an arrival time its recorded error cannot explain, and says so', () => {
    const belief = runTimeBelief(RUN_TIME, 100, { afterDeparture: 300, error: EVEN_ERROR });
    expect(belief).toMatchObject({ withPrediction: false });
    expect(belief?.p50).toBeCloseTo(110, 6);
  });

  it('has no belief once the train has run longer than any recorded run', () => {
    expect(runTimeBelief(RUN_TIME, 140, null)).toBeUndefined();
  });

  it('covers a run speeding up, cruising and braking', () => {
    // 1,000 m in 100 s at 1 m/s²: cruise (100 − √6000)/2 = 11.27 m/s, symmetric about 50 s.
    expect(progress(5, 100, 1_000, 1)).toBeCloseTo(12.5, 6);
    expect(progress(50, 100, 1_000, 1)).toBeCloseTo(500, 6);
    expect(progress(95, 100, 1_000, 1)).toBeCloseTo(987.5, 6);
    expect(progress(120, 100, 1_000, 1)).toBe(1_000);
    // Too short a time for 1 m/s²: speeding up and braking only, still symmetric.
    expect(progress(10, 20, 400, 1)).toBeCloseTo(200, 6);
  });
});

const line = straightLine('A..N55R', 3_000);
const T0 = Date.parse('2026-11-11T01:00:00Z');
const stop = (id: string, meters: number, seconds: number): ListedStop => ({
  id,
  name: id,
  ...north(meters),
  arrival: T0 + seconds * 1000,
  departure: T0 + seconds * 1000,
});

describe('a subway train between stations', () => {
  it('sees a departure when the first stop listed changes, at the time given, inside the window', () => {
    const atA = remember(undefined, stop('A06N', 500, 5), T0 + 10_000);
    expect(atA.departure).toBeUndefined();
    const leftA = remember(atA, stop('A05N', 1_500, 120), T0 + 40_000);
    // A was due to leave at +5 s, before the reading that still listed it: held to +10 s.
    expect(leftA.departure).toMatchObject({ to: 'A05N', at: T0 + 10_000 });
    expect(leftA.departure?.from.id).toBe('A06N');
    expect(remember(leftA, stop('A05N', 1_500, 125), T0 + 70_000).departure).toEqual(
      leftA.departure,
    );
  });

  const input = (seconds: number) => ({
    route: 'A',
    line,
    departure: { from: stop('A06N', 500, 0), to: 'A05N', at: T0 },
    next: stop('A05N', 1_500, 115),
    now: T0 + seconds * 1000,
    predictedAt: T0 + 60_000,
  });

  it('places it at the conditioned median, with the 10th to 90th percentile as its margin', () => {
    const estimate = betweenStations(input(100), statisticsWith({ runTime: RUN_TIME }));
    // Median run 110 s: 100 s into a 1,000 m run of 110 s, then the margin from 102 s and 130 s.
    const along = (runTime: number) => 500 + progress(100, runTime, 1_000, 1);
    expect(estimate?.method).toBe('recorded-run-time');
    expect(estimate?.meters).toBeCloseTo(along(110), 3);
    expect(estimate?.marginMeters).toBeCloseTo(
      Math.max(along(110) - along(130), along(102) - along(110)),
      3,
    );
    expect(estimate?.stall).toBeNull();
    expect(place(line, north(estimate?.meters ?? 0)).meters).toBeCloseTo(estimate?.meters ?? 0, 0);
  });

  it('weighs the arrival time in when its error is recorded', () => {
    const estimate = betweenStations(
      input(100),
      statisticsWith({ runTime: RUN_TIME, error: EVEN_ERROR }),
    );
    expect(estimate?.method).toBe('recorded-run-time-and-arrival');
  });

  it('marks a possible stoppage past the 95th percentile, with n and dates', () => {
    const estimate = betweenStations(input(135), statisticsWith({ runTime: RUN_TIME }));
    expect(estimate?.stall).toEqual({
      elapsedSeconds: 135,
      usualSeconds: 130,
      medianSeconds: 100,
      n: 40,
      from: '2026-11-02T05:00:00.000Z',
      to: '2026-11-09T04:59:00.000Z',
    });
  });

  it('without a recorded run time, shares the segment out by the arrival time, with no margin', () => {
    const estimate = betweenStations(input(57.5), noStatistics);
    expect(estimate).toMatchObject({
      marginMeters: null,
      method: 'predicted-arrival',
      stall: null,
    });
    // Half the announced run: half the segment, 1,000 m from the start of the line.
    expect(estimate?.meters).toBeCloseTo(500 + progress(57.5, 115, 1_000, 1), 3);
    expect(estimate?.meters).toBeCloseTo(1_000, 3);
    // Fewer than 20 measurements count as none.
    const few = statisticsWith({ runTime: recorded(RUN_TIME.seconds, 19) });
    expect(betweenStations(input(57.5), few)?.method).toBe('predicted-arrival');
  });

  it('cannot place a segment whose stops are off the line', () => {
    const off = { ...input(50), next: { ...stop('A05N', 1_500, 115), lon: -73.99 } };
    expect(betweenStations(off, noStatistics)).toBeUndefined();
  });
});
