import type { LivePosition } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import type {
  GpsEstimateInput,
  PlacedStop,
  StationEstimateInput,
} from '../../../src/modules/live/estimate.js';
import { createPositionEstimator } from '../../../src/modules/live/estimation/estimator.js';
import { place, type Line } from '../../../src/modules/live/estimation/line.js';
import { north, straightLine } from './lines.js';
import { RUN_TIME, statisticsWith } from './statistics.js';

const T0 = Date.parse('2026-11-11T01:00:00Z');
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const busLine = straightLine('Q050216', 5_000);
const trainLine = straightLine('A..N55R', 3_000);

function bus(meters: number, reportedAt: number, now: number, shaped = true) {
  const input: GpsEstimateInput = {
    kind: 'gps',
    vehicleId: 'bus:MTA NYCT_8440',
    now: new Date(T0 + now * 1000),
    mode: 'bus',
    route: 'Q5',
    direction: 0,
    line: shaped ? busLine : undefined,
    latest: { ...north(meters), at: T0 + reportedAt * 1000 },
    stopsAhead: [],
  };
  return input;
}

const along = (line: Line, position: LivePosition) => place(line, position).meters;

describe('the estimator for a bus with GPS', () => {
  it('draws the report itself as gps while it is fresh and where it was reported', () => {
    const estimate = createPositionEstimator();
    expect(estimate(bus(0, 0, 5))).toEqual({
      ...north(0),
      basis: 'gps',
      marginMeters: null,
      dataTime: iso(0),
      station: null,
      stall: null,
    });
  });

  it('estimates gps-plus between reports, with a margin only where the recorder measured one', () => {
    const plain = createPositionEstimator();
    plain(bus(0, 0, 0));
    const between = plain(bus(240, 30, 45));
    expect(between).toMatchObject({ basis: 'gps-plus', marginMeters: null, dataTime: iso(30) });
    // 15 s on at about 8.1 m/s from 239.7 m.
    expect(along(busLine, between)).toBeCloseTo(239.74 + 8.1 * 15, -1);
    const measured = createPositionEstimator(statisticsWith({ p90Meters: 85 }));
    measured(bus(0, 0, 0));
    expect(measured(bus(240, 30, 45)).marginMeters).toBe(85);
    const few = createPositionEstimator(statisticsWith({ p90Meters: 85, n: 19 }));
    few(bus(0, 0, 0));
    expect(few(bus(240, 30, 45)).marginMeters).toBeNull();
  });

  it('settles on the typical speed the recorder measured for the stretch, from 20 measures', () => {
    const drawnWith = (statistics?: Parameters<typeof createPositionEstimator>[0]) => {
      const estimate = createPositionEstimator(statistics);
      estimate(bus(0, 0, 0));
      estimate(bus(240, 30, 30));
      return along(busLine, estimate(bus(240, 30, 120)));
    };
    const own = drawnWith();
    // At about 8 m/s of its own, a measured 2 m/s holds it back over the next 90 s.
    const measured = drawnWith(statisticsWith({ metersPerSecond: 2 }));
    expect(measured).toBeLessThan(own - 200);
    expect(measured).toBeGreaterThan(240);
    expect(drawnWith(statisticsWith({ metersPerSecond: 2, n: 19 }))).toBeCloseTo(own, 6);
  });

  it('without the shape of its trip, draws the published report and says so as gps', () => {
    const estimate = createPositionEstimator();
    expect(estimate(bus(240, 0, 90, false))).toEqual({
      ...north(240),
      basis: 'gps',
      marginMeters: null,
      dataTime: iso(0),
      station: null,
      stall: null,
    });
  });
});

const placed = (id: string, meters: number, seconds: number): PlacedStop => ({
  id,
  name: id === 'A06N' ? '181 St' : '190 St',
  ...north(meters),
  arrival: iso(seconds),
  departure: iso(seconds),
});

function train(
  next: PlacedStop,
  predictedAt: number,
  now: number,
  shaped = true,
): StationEstimateInput {
  return {
    kind: 'station',
    vehicleId: 'subway:109850_A..N55R',
    now: new Date(T0 + now * 1000),
    mode: 'subway',
    route: 'A',
    line: shaped ? trainLine : undefined,
    station: { ...next, status: next.id === 'A06N' ? 'stopped' : 'heading' },
    observedAt: new Date(T0 + predictedAt * 1000),
    next,
    predictedAt: new Date(T0 + predictedAt * 1000),
  };
}

describe('the estimator for a subway train', () => {
  const atA = placed('A06N', 500, 0);
  const towardsB = placed('A05N', 1_500, 115);

  it('draws a train at its station, then between stations once it is seen leaving', () => {
    const estimate = createPositionEstimator(statisticsWith({ runTime: RUN_TIME }));
    expect(estimate(train(atA, 0, 0))).toMatchObject({
      basis: 'predicted',
      station: { id: 'A06N', status: 'stopped' },
    });
    const between = estimate(train(towardsB, 30, 100));
    expect(between).toMatchObject({
      basis: 'predicted',
      dataTime: iso(30),
      station: { id: 'A05N', name: '190 St', status: 'heading' },
    });
    expect(between.marginMeters).toBeGreaterThan(0);
    const meters = along(trainLine, between);
    expect(meters).toBeGreaterThan(500);
    expect(meters).toBeLessThan(1_500);
  });

  it('carries a possible stoppage past the 95th percentile, with its evidence and the stop left', () => {
    const estimate = createPositionEstimator(statisticsWith({ runTime: RUN_TIME }));
    estimate(train(atA, 0, 0));
    expect(estimate(train(towardsB, 30, 100)).stall).toBeNull();
    // Left 181 St at 0 s and still listed towards 190 St at 200 s: past the 130 s of the p95.
    expect(estimate(train(towardsB, 190, 200)).stall).toEqual({
      elapsedSeconds: 200,
      usualSeconds: 130,
      medianSeconds: 100,
      n: 40,
      from: '2026-11-02T05:00:00.000Z',
      to: '2026-11-09T04:59:00.000Z',
      leftStop: { id: 'A06N', name: '181 St' },
    });
  });

  it('follows a B Division train that keeps the stop it left listed until it reaches the next', () => {
    const estimate = createPositionEstimator(statisticsWith({ runTime: RUN_TIME }));
    estimate(train(atA, 0, 0));
    // 181 St is still listed first, but the train reported at 20 s that it is heading to 190 St.
    const heading = (now: number) => ({
      ...train(atA, now, now),
      station: { ...towardsB, status: 'heading' as const },
      observedAt: new Date(T0 + 20_000),
    });
    const between = estimate(heading(50));
    expect(between).toMatchObject({
      basis: 'predicted',
      station: { id: 'A05N', status: 'heading' },
    });
    expect(along(trainLine, between)).toBeGreaterThan(500);
    expect(along(trainLine, between)).toBeLessThan(1_500);
    // The run is counted from the departure the train reported, not from a reading.
    expect(estimate(heading(250)).stall).toMatchObject({ elapsedSeconds: 230, usualSeconds: 130 });
    // Stopped at 190 St with 181 St still listed, then once it is dropped: at the station.
    const stopped = { ...towardsB, status: 'stopped' as const };
    expect(estimate({ ...train(atA, 260, 260), station: stopped })).toMatchObject({
      ...north(1_500),
      station: { id: 'A05N', status: 'stopped' },
    });
    expect(estimate({ ...train(towardsB, 275, 275), station: stopped })).toMatchObject({
      ...north(1_500),
      station: { id: 'A05N', status: 'stopped' },
    });
  });

  it('never draws a train behind where it was drawn on the same segment', () => {
    const estimate = createPositionEstimator();
    estimate(train(atA, 0, 0));
    const first = along(trainLine, estimate(train(towardsB, 30, 80)));
    // A later arrival time would place it further back: it holds where it was.
    const later = estimate(train(placed('A05N', 1_500, 400), 60, 85));
    expect(along(trainLine, later)).toBeGreaterThanOrEqual(first - 1);
  });

  it('without a departure seen, or without the shape, places it by station as published', () => {
    const unseen = createPositionEstimator()(train(towardsB, 30, 60));
    expect(unseen).toMatchObject({ ...north(1_500), marginMeters: null, dataTime: iso(30) });
    const estimate = createPositionEstimator();
    estimate(train(atA, 0, 0, false));
    expect(estimate(train(towardsB, 30, 60, false))).toMatchObject({
      ...north(1_500),
      station: { id: 'A05N', status: 'heading' },
    });
  });

  it('forgets a vehicle 15 minutes after it was last seen', () => {
    const estimate = createPositionEstimator();
    estimate(train(atA, 0, 0));
    // Seen again at 14 min, due at B a minute later: still remembered, so it left A and is on its
    // way to B.
    const kept = estimate(train(placed('A05N', 1_500, 900), 840, 840));
    expect(along(trainLine, kept)).toBeLessThan(1_499);
    const forgetting = createPositionEstimator();
    forgetting(train(atA, 0, 0));
    // Another vehicle seen at 16 min sweeps it out; it then reappears with no departure known.
    forgetting({ ...train(atA, 960, 960), vehicleId: 'subway:other' });
    expect(forgetting(train(towardsB, 961, 961))).toMatchObject(north(1_500));
  });
});
