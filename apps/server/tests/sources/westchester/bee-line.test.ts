import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import { gtfsIndexSchema } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { busPositionsSchema } from '../../../src/modules/data-platform/sources/westchester/bus-positions.js';
import { westchesterSources } from '../../../src/modules/data-platform/sources/westchester/index.js';
import { accepted, capture, findSource, storedAndRead, text } from '../regional/captures.js';

const positions = findSource(westchesterSources, 'bee-line-positions');
const timetable = findSource(westchesterSources, 'bee-line-gtfs');
/** The captures were downloaded at 03:19:57 (positions) and 03:23:18 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T03:25:00Z');
const HEADER_TIME = Math.floor(Date.parse('2026-11-11T03:19:58Z') / 1000);

function parse(source: typeof positions, body: Uint8Array, previous?: unknown) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous });
}

function feed(entity: unknown[], header: Record<string, unknown> = {}): Uint8Array {
  return encodeGtfsRealtime({
    header: { gtfs_realtime_version: '2.0', timestamp: HEADER_TIME, ...header },
    entity,
  });
}

function bus(id: string, vehicle: Record<string, unknown>) {
  return {
    id,
    vehicle: {
      trip: { trip_id: '7_E_A1W_2130_Wkd_Weekdays', route_id: '7' },
      position: { latitude: 40.91, longitude: -73.79 },
      timestamp: HEADER_TIME - 10,
      ...vehicle,
    },
  };
}

describe('Bee-Line bus positions', () => {
  it('accepts the capture: 35 buses by GPS, dated by the newest report', () => {
    const result = accepted(parse(positions, capture('westchester', 'bee-line-positions.pb')));
    // The header is the second of the request; the newest bus had reported 6 seconds before.
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:19:52.000Z');
    expect(result.coverage).toBe('35 buses on a route, 0 left out');
    expect(storedAndRead(positions, result.data)).toEqual(result.data);
    const data = busPositionsSchema.parse(result.data);
    expect(data.feedTime).toBe('2026-11-11T03:19:58.000Z');
    expect(new Set(data.buses.map((one) => one.routeId)).size).toBe(17);
    expect(data.buses[0]).toMatchObject({
      located: 'gps',
      label: '356',
      routeId: '7',
      tripId: '7_E_A1W_2130_Wkd_Weekdays',
      direction: 0,
      stopId: '921',
      bearingDegrees: 160,
      observedAt: '2026-11-11T03:19:47.000Z',
    });
  });

  it('names the route and destination of every bus through the timetable', () => {
    const buses = busPositionsSchema.parse(
      accepted(parse(positions, capture('westchester', 'bee-line-positions.pb'))).data,
    ).buses;
    const index = gtfsIndexSchema.parse(
      accepted(parse(timetable, capture('westchester', 'bee-line-gtfs.zip'))).data,
    );
    // The timetable capture keeps routes 7 and 42 only.
    const kept = buses.filter((one) => one.routeId === '7' || one.routeId === '42');
    expect(kept).toHaveLength(4);
    for (const one of kept) {
      const trip = index.trips[one.tripId ?? ''];
      expect(trip?.route).toBe(one.routeId);
      expect(trip?.headsign).toBeTruthy();
      expect(index.routes[one.routeId]?.longName).toBeTruthy();
    }
  });

  it('accepts an empty feed, dated by its header, as when no bus runs', () => {
    const result = accepted(parse(positions, feed([])));
    expect(result.coverage).toBe('0 buses on a route, 0 left out');
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:19:58.000Z');
  });

  it('leaves out a bus without a route, without a report time or reported after the header', () => {
    const body = feed([
      bus('1', {}),
      bus('2', { trip: { trip_id: 'x' } }),
      bus('3', { timestamp: 0 }),
      bus('4', { timestamp: HEADER_TIME + 5 }),
      { id: '5', vehicle: { trip: { route_id: '7' }, timestamp: HEADER_TIME } },
    ]);
    expect(accepted(parse(positions, body)).coverage).toBe('1 buses on a route, 4 left out');
  });

  it('keeps a bus whose bearing or speed is out of range, without them', () => {
    const body = feed([
      bus('1', { position: { latitude: 40.91, longitude: -73.79, bearing: -5, speed: -1 } }),
    ]);
    expect(busPositionsSchema.parse(accepted(parse(positions, body)).data).buses[0]).toMatchObject({
      bearingDegrees: null,
      speedMetresPerSecond: null,
    });
  });

  it.each([
    ['not-protobuf', text('<html><body>Service Unavailable</body></html>')],
    ['differential-feed', feed([], { incrementality: 'DIFFERENTIAL' })],
    ['no-header-time', feed([], { timestamp: 0 })],
    ['future-header', feed([], { timestamp: HEADER_TIME + 900 })],
  ])('refuses %s', (code, body) => {
    expect(parse(positions, body)).toMatchObject({ ok: false, code });
  });

  it('refuses a feed older than the version served', () => {
    const served = accepted(parse(positions, feed([]))).data;
    const older = feed([], { timestamp: HEADER_TIME - 30 });
    expect(parse(positions, older, served)).toMatchObject({ code: 'older-than-served' });
  });
});

describe('Bee-Line timetable', () => {
  it('accepts the capture, dated by receipt, and refuses it as cut by the minimum', () => {
    const result = accepted(parse(timetable, capture('westchester', 'bee-line-gtfs.zip')));
    expect(result.dataTime).toEqual(RECEIVED_AT);
    expect(timetable.dataTimeSource).toBe('receipt');
    expect(result.coverage).toBe('2 routes, 0 stations, 167 stops, 459 trips, 0 shapes');
    expect(storedAndRead(timetable, result.data)).toEqual(result.data);
    // The whole file has 57 routes and 2,836 stops; the capture keeps two routes.
    expect(timetable.check?.(result.data, undefined)).toEqual([
      '2 routes with trips, minimum 28',
      '167 stops, minimum 1400',
    ]);
  });

  it('downloads both feeds from GMV, without a key', () => {
    const context = { credentials: {}, now: RECEIVED_AT };
    expect(positions.request(context).url).toBe(
      'https://westchester.gmv.com/gtfsrtapi/api/vehiclepositions',
    );
    expect(timetable.request(context).url).toBe(
      'https://westchester-win.gmv.com:8443/repository/gtfs-public/GTFS_GMV_WCDOT.zip',
    );
  });
});
