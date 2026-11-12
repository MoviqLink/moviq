import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import {
  subwayFeedSchema,
  type SubwayFeed,
} from '../../../src/modules/data-platform/sources/mta/subway-realtime.js';
import {
  CAPTURED_AT,
  accepted,
  capture,
  parseFresh,
  source,
  storedAndRead,
  text,
} from './captures.js';

const HEADER_TIME = Math.floor(Date.parse('2026-11-11T01:05:00Z') / 1000);

function feed(entity: unknown[], header: Record<string, unknown> = {}): Uint8Array {
  return encodeGtfsRealtime({
    header: { gtfs_realtime_version: '1.0', timestamp: HEADER_TIME, ...header },
    entity,
  });
}

const tripUpdate = {
  id: '1',
  trip_update: {
    trip: { trip_id: '109850_A..N55R', route_id: 'A', start_date: '20261110' },
    stop_time_update: [{ stop_id: 'A06N', arrival: { time: HEADER_TIME + 60 } }],
  },
};

/** A trip the feed cancels, without stops, as GTFS Realtime allows. */
const cancelledTrip = {
  id: '2',
  trip_update: {
    trip: {
      trip_id: '110000_A..S55R',
      route_id: 'A',
      start_date: '20261110',
      schedule_relationship: 'CANCELED',
    },
  },
};

describe('MTA subway live feeds', () => {
  const captures = [
    ['mta-subway-ace', 'subway-ace.pb', '2026-11-11T01:05:03.000Z', '7 trips, 6 trains'],
    ['mta-subway-bdfm', 'subway-bdfm.pb', '2026-11-11T01:05:04.000Z', '7 trips, 6 trains'],
    ['mta-subway-g', 'subway-g.pb', '2026-11-11T01:05:04.000Z', '7 trips, 6 trains'],
    ['mta-subway-jz', 'subway-jz.pb', '2026-11-11T01:05:12.000Z', '7 trips, 6 trains'],
    ['mta-subway-nqrw', 'subway-nqrw.pb', '2026-11-11T01:05:13.000Z', '7 trips, 6 trains'],
    ['mta-subway-l', 'subway-l.pb', '2026-11-11T01:05:17.000Z', '6 trips, 6 trains'],
    ['mta-subway-1234567', 'subway-1234567.pb', '2026-11-11T01:05:20.000Z', '6 trips, 6 trains'],
    ['mta-subway-sir', 'subway-sir.pb', '2026-11-11T01:05:26.000Z', '7 trips, 6 trains'],
  ] as const;

  it.each(captures)('%s accepts its capture at the header time', (id, file, time, counts) => {
    const result = accepted(parseFresh(id, capture(file)));
    expect(result.dataTime.toISOString()).toBe(time);
    expect(result.coverage.startsWith(counts)).toBe(true);
    expect(storedAndRead(id, result.data)).toEqual(result.data);
  });

  it('gives each trip its route, direction and timed stops, and each train its place', () => {
    const data: SubwayFeed = subwayFeedSchema.parse(
      accepted(parseFresh('mta-subway-ace', capture('subway-ace.pb'))).data,
    );
    for (const trip of data.trips) {
      expect(trip.routeId).toMatch(/^[ACEH]$/);
      expect(trip.direction).not.toBeNull();
      expect(trip.stops.every((stop) => (stop.arrival ?? stop.departure) !== null)).toBe(true);
    }
    const stopped = data.trips.find((trip) => trip.train?.status === 'stopped');
    expect(stopped?.train?.stopId).toMatch(/^A\d\d[NS]$/);
  });

  it('keeps a train that has not left yet out of the observed trains', () => {
    // The ACE capture holds a train stamped with its departure time, later than the feed.
    const data = subwayFeedSchema.parse(
      accepted(parseFresh('mta-subway-ace', capture('subway-ace.pb'))).data,
    );
    const feedTime = Date.parse(data.feedTime);
    const waiting = data.trips.filter((trip) => trip.train === null);
    expect(waiting).toHaveLength(1);
    expect(Date.parse(waiting[0]?.stops[0]?.arrival ?? '')).toBeGreaterThan(feedTime);
    for (const trip of data.trips) {
      if (trip.train) expect(Date.parse(trip.train.observedAt)).toBeLessThanOrEqual(feedTime);
    }
  });

  it.each([
    ['not-protobuf', text('<html><body>503 Service Unavailable</body></html>')],
    ['no-header-time', feed([tripUpdate], { timestamp: 0 })],
    ['future-header', feed([tripUpdate], { timestamp: HEADER_TIME + 600 })],
    ['empty-feed', feed([])],
    ['empty-feed', feed([{ id: '1', trip_update: { trip: { trip_id: 'x', route_id: 'A' } } }])],
    ['empty-feed', feed([cancelledTrip])],
  ])('refuses %s', (code, body) => {
    expect(parseFresh('mta-subway-ace', body)).toMatchObject({ ok: false, code });
  });

  it('keeps a cancelled trip without stops and still leaves out a running one without', () => {
    const silent = { id: '3', trip_update: { trip: { trip_id: '110100_A..S55R', route_id: 'A' } } };
    const body = feed([tripUpdate, cancelledTrip, silent]);
    const data = subwayFeedSchema.parse(accepted(parseFresh('mta-subway-ace', body)).data);
    expect(data.trips.map((trip) => [trip.tripId, trip.cancelled, trip.stops.length])).toEqual([
      ['109850_A..N55R', false, 1],
      ['110000_A..S55R', true, 0],
    ]);
    expect(data.trips[1]?.direction).toBe('south');
    expect(data.leftOut).toBe(1);
  });

  it('reads a copy stored before cancellations as running, and only a cancelled trip bare', () => {
    const { cancelled: _cancelled, ...stored } = subwayFeedSchema.parse(
      accepted(parseFresh('mta-subway-ace', feed([tripUpdate]))).data,
    ).trips[0] ?? { cancelled: false };
    const old = { feedTime: '2026-11-11T01:05:00.000Z', trips: [stored], leftOut: 0 };
    expect(subwayFeedSchema.parse(old).trips[0]?.cancelled).toBe(false);
    const bare = { ...old, trips: [{ ...stored, stops: [] }] };
    expect(subwayFeedSchema.safeParse(bare).success).toBe(false);
  });

  it('accepts a minimal feed and refuses one older than the version served', () => {
    const fresh = accepted(parseFresh('mta-subway-ace', feed([tripUpdate])));
    const served = subwayFeedSchema.parse(fresh.data);
    const older = feed([tripUpdate], { timestamp: HEADER_TIME - 30 });
    const result = source('mta-subway-ace').parse(older, {
      receivedAt: CAPTURED_AT,
      previous: served,
    });
    expect(result).toMatchObject({ ok: false, code: 'older-than-served' });
  });
});
