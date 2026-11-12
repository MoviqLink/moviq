import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import {
  railFeedSchema,
  railRealtimeSources,
} from '../../../src/modules/data-platform/sources/regional/rail-realtime.js';
import { accepted, capture, findSource, storedAndRead, text } from './captures.js';

const lirr = findSource(railRealtimeSources, 'mta-lirr-realtime');
const metroNorth = findSource(railRealtimeSources, 'mta-metro-north-realtime');
/** Both feeds were downloaded at 02:21:48 and 02:21:52 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T02:22:00Z');
const HEADER_TIME = Math.floor(Date.parse('2026-11-11T02:21:00Z') / 1000);

function parse(id: 'lirr' | 'mnr', body: Uint8Array, previous?: unknown) {
  return (id === 'lirr' ? lirr : metroNorth).parse(body, { receivedAt: RECEIVED_AT, previous });
}

function feed(entity: unknown[], header: Record<string, unknown> = {}): Uint8Array {
  return encodeGtfsRealtime({
    header: { gtfs_realtime_version: '2.0', timestamp: HEADER_TIME, ...header },
    entity,
  });
}

const update = {
  id: 'T1',
  trip_update: {
    trip: { trip_id: 'GO203_26_22', route_id: '5', direction_id: 0 },
    stop_time_update: [
      { stop_id: '27', arrival: { time: HEADER_TIME + 60 } },
      { stop_id: '141', schedule_relationship: 'NO_DATA' },
    ],
  },
};
const train = {
  id: 'V1',
  vehicle: {
    trip: { trip_id: 'GO203_26_22' },
    vehicle: { id: '422_22', label: '422' },
    position: { latitude: 40.98, longitude: -72.12 },
    stop_id: '141',
    current_status: 'IN_TRANSIT_TO',
    timestamp: HEADER_TIME - 5,
  },
};

describe('LIRR and Metro-North live trains', () => {
  it('accepts the LIRR capture, dated by its newest train report', () => {
    const result = accepted(parse('lirr', capture('regional', 'lirr-realtime.pb')));
    // The header is the second of the request (02:21:47); the newest report came 2 s before.
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:21:45.000Z');
    expect(result.coverage).toBe('7 trips, 6 trains, 6 GPS positions, 0 left out');
    expect(storedAndRead(lirr, result.data)).toEqual(result.data);
    const data = railFeedSchema.parse(result.data);
    expect(data.feedTime).toBe('2026-11-11T02:21:47.000Z');
    for (const trip of data.trips) {
      expect(trip.trainNumber).toBeNull();
      expect(trip.stops.length).toBeGreaterThan(0);
    }
    // Train 566 has stood at its stop since 00:42 UTC: its report keeps its own, old time.
    const parked = data.trips.find((trip) => trip.tripId === 'GO203_26_566');
    expect(parked?.train).toMatchObject({
      status: 'stopped',
      position: { located: 'gps' },
      observedAt: '2026-11-11T00:42:32.000Z',
    });
  });

  it('accepts the Metro-North capture, with train numbers and no report times of its own', () => {
    const result = accepted(parse('mnr', capture('regional', 'metro-north-realtime.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:21:51.000Z');
    expect(result.coverage).toBe('7 trips, 5 trains, 3 GPS positions, 0 left out');
    expect(storedAndRead(metroNorth, result.data)).toEqual(result.data);
    const data = railFeedSchema.parse(result.data);
    expect(data.trips.map((trip) => trip.trainNumber)).toEqual([
      '1386',
      '1388',
      '1389',
      '1391',
      '1578',
      '1299',
      '1300',
    ]);
    const trains = data.trips.flatMap((trip) => (trip.train ? [trip.train] : []));
    expect(trains.every((one) => one.observedAt === null)).toBe(true);
    const byStation = trains.filter((one) => one.position.located === 'station');
    expect(byStation).toHaveLength(2);
    for (const one of byStation) expect(one.stopId).toBeTruthy();
  });

  it('joins a LIRR train to its trip and ends the trip at its last stop, timed or not', () => {
    const data = railFeedSchema.parse(accepted(parse('lirr', feed([update, train]))).data);
    expect(data.trips).toEqual([
      {
        tripId: 'GO203_26_22',
        routeId: '5',
        trainNumber: null,
        direction: 0,
        startDate: null,
        finalStopId: '141',
        stops: [
          {
            stopId: '27',
            sequence: null,
            arrival: '2026-11-11T02:22:00.000Z',
            departure: null,
          },
        ],
        train: {
          vehicleId: '422_22',
          label: '422',
          stopId: '141',
          status: 'in-transit',
          // Protobuf floats: 40.98 comes back as 40.97999954223633.
          position: {
            located: 'gps',
            latitude: Math.fround(40.98),
            longitude: Math.fround(-72.12),
          },
          observedAt: '2026-11-11T02:20:55.000Z',
        },
      },
    ]);
  });

  it('leaves out and counts what would not read back through its schema', () => {
    const noRoute = { id: 'T2', trip_update: { ...update.trip_update, trip: { trip_id: 'x' } } };
    const emptyId = {
      id: 'T3',
      trip_update: { ...update.trip_update, trip: { trip_id: '', route_id: '5' } },
    };
    const outOfRange = {
      ...train,
      vehicle: { ...train.vehicle, position: { latitude: 140, longitude: -72 } },
    };
    const data = railFeedSchema.parse(
      accepted(parse('mnr', feed([update, noRoute, emptyId, outOfRange]))).data,
    );
    // The trip stays without its train, whose position is impossible.
    expect(data.trips.map((trip) => [trip.tripId, trip.train])).toEqual([['GO203_26_22', null]]);
    expect(data.leftOut).toBe(2);
  });

  it.each([
    ['not-protobuf', 'lirr', text('<html><body>503 Service Unavailable</body></html>')],
    ['differential-feed', 'mnr', feed([update], { incrementality: 'DIFFERENTIAL' })],
    ['no-header-time', 'mnr', feed([update], { timestamp: 0 })],
    ['future-header', 'mnr', feed([update], { timestamp: HEADER_TIME + 600 })],
    ['empty-feed', 'mnr', feed([])],
    ['empty-feed', 'lirr', feed([{ id: 'T', trip_update: { trip: { trip_id: 'x' } } }])],
    ['no-train-report', 'lirr', feed([update])],
  ] as const)('refuses %s', (code, id, body) => {
    expect(parse(id, body)).toMatchObject({ ok: false, code });
  });

  it('refuses a feed older than the version served', () => {
    const served = accepted(parse('mnr', feed([update, train]))).data;
    const older = feed([update, train], { timestamp: HEADER_TIME - 30 });
    expect(parse('mnr', older, served)).toMatchObject({ ok: false, code: 'older-than-served' });
  });

  it('asks the MTA gateway for each railroad without a key', () => {
    const urls = railRealtimeSources.map(
      (definition) => definition.request({ credentials: {}, now: RECEIVED_AT }).url,
    );
    expect(urls).toEqual([
      'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr',
      'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr',
    ]);
  });
});
