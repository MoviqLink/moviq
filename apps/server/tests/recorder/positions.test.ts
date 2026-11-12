import { describe, expect, it } from 'vitest';

import { unixSeconds } from '../../src/modules/recorder/events.js';
import type { ExtractorSession } from '../../src/modules/recorder/extractor.js';
import { busExtractors } from '../../src/modules/recorder/extractors/bus.js';
import { cellOf } from '../../src/modules/recorder/extractors/counts.js';
import { recorderExtractors } from '../../src/modules/recorder/extractors/index.js';
import { createFixTracker } from '../../src/modules/recorder/extractors/positions.js';
import { subwayExtractors } from '../../src/modules/recorder/extractors/subway.js';

function sessionFor(sourceId: string): ExtractorSession {
  const extractor = recorderExtractors.find((candidate) => candidate.sourceId === sourceId);
  if (extractor === undefined) throw new Error(`missing extractor for ${sourceId}`);
  return extractor.start(new Map());
}

function run(session: ExtractorSession, data: unknown, at: string) {
  const result = session.extract(data, {
    version: `v-${at}`,
    dataTime: new Date(at),
    previousDataTime: undefined,
  });
  if (!result.ok) throw new Error(result.why);
  return result.events;
}

const fix = (
  at: number,
  lat: number,
  extra: Partial<Parameters<ReturnType<typeof createFixTracker>>[0][number]> = {},
) => ({
  veh: 'V1',
  trip: 'T1',
  route: 'R1',
  dir: null,
  stop: 'S1',
  lat,
  lon: -73.9,
  brg: 90.4,
  at,
  ...extra,
});

describe('the position tracker', () => {
  it('assigns a trip once, writes a move of 15 m or more, and skips noise and old reports', () => {
    const track = createFixTracker();
    expect(track([fix(100, 40.7)]).map((event) => event.k)).toEqual(['assign', 'gps']);
    expect(track([fix(130, 40.70005)])).toEqual([]);
    expect(track([fix(120, 40.71)])).toEqual([]);
    const moved = track([fix(160, 40.701)]);
    expect(moved).toEqual([
      { k: 'gps', t: 160, veh: 'V1', lat: 40.701, lon: -73.9, brg: 90, stop: 'S1' },
    ]);
  });

  it('writes a new stop or a new trip even without moving, and forgets vehicles gone', () => {
    const track = createFixTracker();
    track([fix(100, 40.7)]);
    expect(track([fix(130, 40.7, { stop: 'S2' })]).map((event) => event.k)).toEqual(['gps']);
    expect(track([fix(160, 40.7, { stop: 'S2', trip: 'T2' })]).map((event) => event.k)).toEqual([
      'assign',
      'gps',
    ]);
    expect(track([])).toEqual([]);
    expect(track([fix(200, 40.7, { stop: 'S2', trip: 'T2' })]).map((event) => event.k)).toEqual([
      'assign',
      'gps',
    ]);
  });

  it('records aircraft by their address, without a trip', () => {
    const session = sessionFor('adsb-lol-new-york');
    const aircraft = {
      located: 'gps',
      hex: 'a1b2c3',
      callsign: 'UAL1518',
      registration: null,
      aircraftType: 'B39M',
      latitude: 40.64,
      longitude: -73.78,
      onGround: false,
      altitudeFeet: 3000,
      groundSpeedKnots: 180,
      trackDegrees: 312.6,
      observedAt: '2026-11-11T10:00:00.000Z',
    };
    const events = run(
      session,
      { answeredAt: '2026-11-11T10:00:01.000Z', aircraft: [aircraft], leftOut: 0 },
      '2026-11-11T10:00:01.000Z',
    );
    expect(events).toEqual([
      {
        k: 'gps',
        t: unixSeconds('2026-11-11T10:00:00.000Z'),
        veh: 'a1b2c3',
        lat: 40.64,
        lon: -73.78,
        brg: 313,
        stop: null,
      },
    ]);
  });
});

describe('the counts of shared vehicles', () => {
  it('places a vehicle in its cell of a hundredth of a degree', () => {
    expect(cellOf(40.7128, -74.006)).toBe('40.71,-74.01');
  });

  it('samples the cells of a fleet only when their counts change', () => {
    const session = sessionFor('veo-bronx');
    const vehicle = (id: string, disabled: boolean) => ({
      located: 'parked',
      vehicleId: id,
      kind: null,
      latitude: 40.8123,
      longitude: -73.9123,
      reserved: false,
      disabled,
      rangeMetres: null,
      battery: null,
      reportedAt: null,
    });
    const answer = (updatedAt: string, vehicles: unknown[]) => ({
      updatedAt,
      vehicleIds: 'rotating',
      vehicles,
      leftOut: 0,
    });
    const first = run(
      session,
      answer('2026-11-11T10:00:00.000Z', [vehicle('a', false), vehicle('b', true)]),
      '2026-11-11T10:00:00.000Z',
    );
    expect(
      first.map((event) => (event.k === 'sample' ? [event.key, event.value] : event.k)),
    ).toEqual([
      ['total', { vehicles: 2, cells: 1 }],
      ['40.81,-73.92', { ready: 1, reserved: 0, disabled: 1 }],
    ]);
    const same = run(
      session,
      answer('2026-11-11T10:05:00.000Z', [vehicle('c', false), vehicle('d', true)]),
      '2026-11-11T10:05:00.000Z',
    );
    expect(same).toEqual([]);
  });
});

describe('cancelled trips', () => {
  const stop = (stopId: string, time: string) => ({
    stopId,
    sequence: null,
    arrival: time,
    departure: time,
  });

  it('are neither a stopped train nor a segment on the subway', () => {
    const session = subwayExtractors[0]?.start(new Map());
    if (session === undefined) throw new Error('missing subway extractor');
    const feed = {
      feedTime: '2026-11-11T12:00:00.000Z',
      leftOut: 0,
      trips: [
        {
          tripId: 'T9',
          routeId: 'A',
          direction: 'north',
          startDate: '20261111',
          startTime: '06:00:00',
          cancelled: true,
          stops: [],
          train: { stopId: 'A06N', status: 'stopped', observedAt: '2026-11-11T11:59:50.000Z' },
        },
      ],
    };
    expect(run(session, feed, '2026-11-11T12:00:00.000Z')).toEqual([]);
  });

  it('leave no predictions on buses', () => {
    const session = busExtractors[1]?.start(new Map());
    if (session === undefined) throw new Error('missing bus predictions extractor');
    const trip = (cancelled: boolean) => ({
      tripId: cancelled ? 'C1' : 'R1',
      routeId: 'B14',
      direction: 0,
      startDate: '20261111',
      vehicleId: null,
      updatedAt: null,
      delaySeconds: null,
      cancelled,
      stops: [stop('S1', '2026-11-11T12:01:30.000Z')],
    });
    const feed = {
      feedTime: '2026-11-11T12:00:00.000Z',
      trips: [trip(true), trip(false)],
      leftOut: 0,
    };
    const events = run(session, feed, '2026-11-11T12:00:00.000Z');
    expect(events.map((event) => (event.k === 'pred' ? event.trip : event.k))).toEqual(['R1']);
  });
});
