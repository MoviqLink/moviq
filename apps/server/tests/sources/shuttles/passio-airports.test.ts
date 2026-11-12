import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import { shuttleSources } from '../../../src/modules/data-platform/sources/shuttles/index.js';
import { busPositionsSchema } from '../../../src/modules/data-platform/sources/westchester/bus-positions.js';
import { accepted, capture, findSource, storedAndRead, text } from '../regional/captures.js';

const jfkLga = findSource(shuttleSources, 'jfk-lga-shuttle-positions');
const ewr = findSource(shuttleSources, 'ewr-shuttle-positions');
/** Both captures were downloaded at 03:20:01 and 03:20:04 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T03:20:10Z');

function parse(source: typeof jfkLga, body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

describe('Port Authority airport shuttles (Passio GTFS Realtime)', () => {
  it('accepts the JFK and LaGuardia capture: 10 buses by GPS on their routes', () => {
    const result = accepted(parse(jfkLga, capture('shuttles', 'jfk-lga-shuttle-positions.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:19:55.000Z');
    expect(result.coverage).toBe('10 buses on a route, 0 left out');
    expect(storedAndRead(jfkLga, result.data)).toEqual(result.data);
    const data = busPositionsSchema.parse(result.data);
    expect(data.buses[0]).toMatchObject({
      located: 'gps',
      vehicleId: '13697',
      label: '603',
      routeId: '3688',
      tripId: '402992',
      observedAt: '2026-11-11T03:19:49.000Z',
    });
    // Some buses send no speed: it stays unknown, not zero.
    expect(data.buses.some((bus) => bus.speedMetresPerSecond === null)).toBe(true);
  });

  it('accepts the Newark capture: 17 buses, with the stop each one serves', () => {
    const result = accepted(parse(ewr, capture('shuttles', 'ewr-shuttle-positions.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:20:04.000Z');
    expect(result.coverage).toBe('17 buses on a route, 0 left out');
    const data = busPositionsSchema.parse(result.data);
    expect(data.buses.every((bus) => bus.stopId !== null)).toBe(true);
  });

  it('accepts an empty feed and refuses what is not a full GTFS Realtime dataset', () => {
    const header = { gtfs_realtime_version: '2.0', timestamp: RECEIVED_AT.getTime() / 1000 };
    const empty = encodeGtfsRealtime({ header, entity: [] });
    expect(accepted(parse(ewr, empty)).coverage).toBe('0 buses on a route, 0 left out');
    const differential = encodeGtfsRealtime({
      header: { ...header, incrementality: 'DIFFERENTIAL' },
      entity: [],
    });
    expect(parse(ewr, differential)).toMatchObject({ ok: false, code: 'differential-feed' });
    expect(parse(ewr, text('Not Found'))).toMatchObject({ ok: false, code: 'not-protobuf' });
  });

  it('downloads each system from passio3.com, without a key', () => {
    const context = { credentials: {}, now: RECEIVED_AT };
    expect(jfkLga.request(context).url).toBe(
      'https://passio3.com/jfkpanynj/passioTransit/gtfs/realtime/vehiclePositions',
    );
    expect(ewr.request(context).url).toBe(
      'https://passio3.com/ewrpanynj/passioTransit/gtfs/realtime/vehiclePositions',
    );
  });
});
