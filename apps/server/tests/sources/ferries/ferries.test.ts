import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import { ferrySources } from '../../../src/modules/data-platform/sources/ferries/index.js';
import {
  ferryPositionsSchema,
  ferryTripUpdatesSchema,
} from '../../../src/modules/data-platform/sources/ferries/nyc-ferry-realtime.js';
import { gtfsIndexSchema } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { accepted, capture, findSource, storedAndRead, text } from '../regional/captures.js';

const positions = findSource(ferrySources, 'nyc-ferry-positions');
const tripUpdates = findSource(ferrySources, 'nyc-ferry-trip-updates');
const nycFerry = findSource(ferrySources, 'nyc-ferry-gtfs');
const statenIsland = findSource(ferrySources, 'staten-island-ferry-gtfs');
/** The ferry captures were downloaded between 02:27:47 and 02:28:33 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T02:29:00Z');
const HEADER_TIME = Math.floor(Date.parse('2026-11-11T02:28:00Z') / 1000);

function parse(source: typeof positions, body: Uint8Array, previous?: unknown) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous });
}

function feed(entity: unknown[], header: Record<string, unknown> = {}): Uint8Array {
  return encodeGtfsRealtime({
    header: { gtfs_realtime_version: '2.0', timestamp: HEADER_TIME, ...header },
    entity,
  });
}

describe('NYC Ferry live feeds', () => {
  it('accepts the positions capture: four boats by GPS, each on a trip of the timetable', () => {
    const result = accepted(parse(positions, capture('ferries', 'nyc-ferry-positions.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:27:49.000Z');
    expect(result.coverage).toBe('4 boats on a trip, 0 left out');
    expect(storedAndRead(positions, result.data)).toEqual(result.data);
    const timetable = gtfsIndexSchema.parse(
      accepted(parse(nycFerry, capture('ferries', 'nyc-ferry-gtfs.zip'))).data,
    );
    const data = ferryPositionsSchema.parse(result.data);
    for (const vessel of data.vessels) {
      expect(vessel.located).toBe('gps');
      expect(timetable.trips[vessel.tripId]?.route).toBeTruthy();
    }
    expect(data.vessels[0]).toMatchObject({
      vesselId: '16',
      label: 'H109',
      tripId: '2295',
      speedMetresPerSecond: 11,
      status: 'in-transit',
      observedAt: '2026-11-11T02:27:45.000Z',
    });
  });

  it('accepts the predictions capture, joined to the same trips', () => {
    const result = accepted(parse(tripUpdates, capture('ferries', 'nyc-ferry-trip-updates.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:27:44.000Z');
    expect(result.coverage).toBe('4 trips, 0 left out');
    expect(storedAndRead(tripUpdates, result.data)).toEqual(result.data);
    const data = ferryTripUpdatesSchema.parse(result.data);
    expect(data.trips.map((trip) => trip.tripId).sort()).toEqual(['2210', '2284', '2295', '2325']);
  });

  it('accepts an empty feed, as when no boat sails at night', () => {
    expect(accepted(parse(positions, feed([]))).coverage).toBe('0 boats on a trip, 0 left out');
    expect(accepted(parse(tripUpdates, feed([]))).coverage).toBe('0 trips, 0 left out');
  });

  it('leaves out and counts a boat without a trip or a time', () => {
    const boat = {
      id: '16',
      vehicle: { position: { latitude: 40.7, longitude: -74 }, timestamp: HEADER_TIME },
    };
    const untimed = {
      id: '17',
      vehicle: { trip: { trip_id: '2295' }, position: { latitude: 40.7, longitude: -74 } },
    };
    expect(accepted(parse(positions, feed([boat, untimed]))).coverage).toBe(
      '0 boats on a trip, 2 left out',
    );
  });

  it.each([
    ['not-protobuf', text('<html><body>Service Unavailable</body></html>')],
    ['differential-feed', feed([], { incrementality: 'DIFFERENTIAL' })],
    ['no-header-time', feed([], { timestamp: 0 })],
    ['future-header', feed([], { timestamp: HEADER_TIME + 600 })],
  ])('refuses %s', (code, body) => {
    expect(parse(positions, body)).toMatchObject({ ok: false, code });
    expect(parse(tripUpdates, body)).toMatchObject({ ok: false, code });
  });

  it('refuses a feed older than the version served', () => {
    const served = accepted(parse(positions, feed([]))).data;
    const older = feed([], { timestamp: HEADER_TIME - 30 });
    expect(parse(positions, older, served)).toMatchObject({ code: 'older-than-served' });
  });
});

describe('Ferry timetables', () => {
  it('accepts the NYC Ferry capture, dated by feed_version', () => {
    const result = accepted(parse(nycFerry, capture('ferries', 'nyc-ferry-gtfs.zip')));
    // Midnight of 08/11/2026 in New York.
    expect(result.dataTime.toISOString()).toBe('2026-11-08T05:00:00.000Z');
    expect(result.coverage).toBe('7 routes, 0 stations, 50 stops, 439 trips, 25 shapes');
    expect(nycFerry.check?.(result.data, undefined)).toEqual([]);
    expect(storedAndRead(nycFerry, result.data)).toEqual(result.data);
  });

  it('accepts the Staten Island Ferry capture, whose tables sit in one folder', () => {
    const result = accepted(parse(statenIsland, capture('ferries', 'siferry-gtfs.zip')));
    // Its latest entry, 13:27:54 on 09/01/2026 in New York.
    expect(result.dataTime.toISOString()).toBe('2026-01-09T18:27:54.000Z');
    expect(result.coverage).toBe('1 routes, 0 stations, 2 stops, 416 trips, 2 shapes');
    expect(statenIsland.check?.(result.data, undefined)).toEqual([]);
    expect(storedAndRead(statenIsland, result.data)).toEqual(result.data);
  });

  it('refuses a folder without a required table, and tables in more than one folder', () => {
    const tables = unzipSync(capture('ferries', 'siferry-gtfs.zip'));
    const withoutStops = Object.fromEntries(
      Object.entries(tables).filter(([name]) => !name.endsWith('stops.txt')),
    );
    expect(parse(statenIsland, zipSync(withoutStops))).toMatchObject({
      ok: false,
      code: 'missing-file',
      detail: 'stops.txt is missing',
    });
    const mixed = { ...tables, 'other/agency.txt': text('agency_id\n1\n') };
    expect(parse(statenIsland, zipSync(mixed))).toMatchObject({ code: 'missing-file' });
  });

  it('downloads the timetables from their publishers', () => {
    expect(nycFerry.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://nycferry.connexionz.net/rtt/public/resource/gtfs.zip',
    );
    expect(statenIsland.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://www.nyc.gov/html/dot/downloads/misc/siferry-gtfs.zip',
    );
  });
});
