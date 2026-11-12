import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import { ferrySources } from '../../../src/modules/data-platform/sources/ferries/index.js';
import { ferryPositionsSchema } from '../../../src/modules/data-platform/sources/ferries/nyc-ferry-realtime.js';
import { gtfsIndexSchema } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { accepted, capture, findSource, storedAndRead, text } from '../regional/captures.js';

const positions = findSource(ferrySources, 'ny-waterway-positions');
const timetable = findSource(ferrySources, 'ny-waterway-gtfs');
/** The captures were downloaded at 03:20:08 (positions) and 03:23:30 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T03:24:00Z');

function parse(source: typeof positions, body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

describe('NY Waterway', () => {
  it('accepts the positions capture: two boats by GPS, each on a trip of the timetable', () => {
    const result = accepted(parse(positions, capture('ferries', 'ny-waterway-positions.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:19:59.000Z');
    expect(result.coverage).toBe('2 boats on a trip, 0 left out');
    expect(storedAndRead(positions, result.data)).toEqual(result.data);
    const index = gtfsIndexSchema.parse(
      accepted(parse(timetable, capture('ferries', 'ny-waterway-gtfs.zip'))).data,
    );
    const data = ferryPositionsSchema.parse(result.data);
    expect(data.vessels.map((vessel) => vessel.label)).toEqual(['Hudson', 'York']);
    for (const vessel of data.vessels) {
      expect(index.trips[vessel.tripId]?.route).toBeTruthy();
    }
    expect(data.vessels[1]).toMatchObject({
      located: 'gps',
      vesselId: '27',
      tripId: '7562',
      speedMetresPerSecond: 4,
      status: 'in-transit',
      observedAt: '2026-11-11T03:19:57.000Z',
    });
  });

  it('accepts the timetable capture, dated by feed_version', () => {
    const result = accepted(parse(timetable, capture('ferries', 'ny-waterway-gtfs.zip')));
    // Midnight of 10/11/2026 in New York.
    expect(result.dataTime.toISOString()).toBe('2026-11-10T05:00:00.000Z');
    expect(result.coverage).toBe('14 routes, 0 stations, 15 stops, 1,381 trips, 72 shapes');
    expect(timetable.check?.(result.data, undefined)).toEqual([]);
  });

  it('refuses a differential feed and a body that is not protobuf', () => {
    const differential = encodeGtfsRealtime({
      header: {
        gtfs_realtime_version: '2.0',
        incrementality: 'DIFFERENTIAL',
        timestamp: RECEIVED_AT.getTime() / 1000,
      },
      entity: [],
    });
    expect(parse(positions, differential)).toMatchObject({ code: 'differential-feed' });
    expect(parse(positions, text('<html></html>'))).toMatchObject({ code: 'not-protobuf' });
  });

  it('downloads both from the Connexionz host of NY Waterway, without a key', () => {
    const context = { credentials: {}, now: RECEIVED_AT };
    expect(positions.request(context).url).toBe(
      'https://nywaterway.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition',
    );
    expect(timetable.request(context).url).toBe(
      'https://nywaterway.connexionz.net/rtt/public/resource/gtfs.zip',
    );
  });
});
