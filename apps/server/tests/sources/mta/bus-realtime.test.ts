import protobuf from 'protobufjs';
import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import {
  busPositionsSchema,
  busTripUpdatesSchema,
} from '../../../src/modules/data-platform/sources/mta/bus-realtime.js';
import {
  CAPTURED_AT,
  accepted,
  capture,
  parseFresh,
  source,
  storedAndRead,
  text,
} from './captures.js';

const HEADER_TIME = Math.floor(Date.parse('2026-11-11T01:05:19Z') / 1000);

function feed(entity: unknown[], timestamp = HEADER_TIME): Uint8Array {
  return encodeGtfsRealtime({ header: { gtfs_realtime_version: '1.0', timestamp }, entity });
}

const trip = { trip_id: 'JA_D6-Weekday-SDon-118700_MISC_887', route_id: 'Q5', direction_id: 0 };
const position = { latitude: 40.678978, longitude: -73.760117, bearing: 343.4 };

/** Protobuf tag of a length-delimited field. */
const tag = (field: number): number => (field << 3) | 2;

/**
 * A feed of one bus that also carries the OneBusAway crowding extension (field 1006 of the
 * vehicle), which `encodeGtfsRealtime` cannot write: a second `vehicle` field merges into the
 * first, as protobuf merges repeated embedded messages.
 */
function withCrowding(entity: unknown, crowding: { count: number; capacity: number }): Uint8Array {
  const header = feed([]);
  const field = feed([entity]).subarray(header.length);
  const reader = protobuf.Reader.create(field);
  reader.uint32();
  const length = reader.uint32();
  const content = field.subarray(reader.pos, reader.pos + length);
  const descriptor = protobuf.Writer.create().uint32(8).int32(crowding.count);
  descriptor.uint32(16).int32(crowding.capacity);
  const vehicle = protobuf.Writer.create().uint32(tag(1006)).bytes(descriptor.finish()).finish();
  const extra = protobuf.Writer.create().uint32(tag(4)).bytes(vehicle).finish();
  const merged = Uint8Array.from([...content, ...extra]);
  return Uint8Array.from([
    ...header,
    ...protobuf.Writer.create().uint32(tag(2)).bytes(merged).finish(),
  ]);
}

const bus = (occupancy: Record<string, unknown> = {}) => ({
  id: 'bus',
  vehicle: {
    trip,
    position,
    timestamp: HEADER_TIME,
    vehicle: { id: 'MTA NYCT_7117' },
    ...occupancy,
  },
});

function occupancyOf(body: Uint8Array): unknown {
  return busPositionsSchema.parse(accepted(parseFresh('mta-bus-positions', body)).data).vehicles[0]
    ?.occupancy;
}

const cancelledUpdate = {
  id: 'cancelled',
  trip_update: {
    trip: {
      ...trip,
      trip_id: 'JA_D6-Weekday-SDon-119000_MISC_887',
      schedule_relationship: 'CANCELED',
    },
  },
};

describe('MTA Bus Time live feeds', () => {
  it('asks for no key: Bus Time answered without one when captured', () => {
    for (const id of ['mta-bus-positions', 'mta-bus-trip-updates']) {
      const definition = source(id);
      expect(definition.integration).toBeUndefined();
      expect(definition.request({ credentials: {}, now: CAPTURED_AT }).url).not.toContain('key');
    }
  });

  it('accepts the positions capture, every bus with its trip and route', () => {
    const result = accepted(parseFresh('mta-bus-positions', capture('bus-vehicle-positions.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T01:05:19.000Z');
    expect(result.coverage).toBe('40 buses with trip and route, 0 with occupancy, 0 left out');
    expect(storedAndRead('mta-bus-positions', result.data)).toEqual(result.data);
    const { vehicles } = busPositionsSchema.parse(result.data);
    expect(vehicles.every((one) => one.tripId !== '' && one.routeId !== '')).toBe(true);
    // Re-encoded through the shared schema when captured, this file kept no occupancy at all.
    expect(vehicles.every((one) => one.occupancy === null)).toBe(true);
  });

  it('reads the occupancy level, passengers and capacity Bus Time publishes, as published', () => {
    const received = new Date('2026-11-11T03:42:02Z');
    const result = accepted(parseFresh('mta-bus-positions', capture('bus-occupancy.pb'), received));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:42:00.000Z');
    expect(result.coverage).toBe('28 buses with trip and route, 15 with occupancy, 0 left out');
    expect(storedAndRead('mta-bus-positions', result.data)).toEqual(result.data);
    const buses = new Map(
      busPositionsSchema.parse(result.data).vehicles.map((one) => [one.vehicleId, one.occupancy]),
    );
    expect(buses.get('MTA NYCT_7117')).toEqual({
      level: 'MANY_SEATS_AVAILABLE',
      passengers: 7,
      capacity: 80,
    });
    expect(buses.get('MTA NYCT_1630')).toEqual({
      level: 'STANDING_ROOM_ONLY',
      passengers: 39,
      capacity: 65,
    });
    expect(buses.get('MTABC_1393')).toEqual({ level: 'FULL', passengers: 61, capacity: 65 });
    // A count without a level, and a bus that publishes nothing.
    expect(buses.get('MTA NYCT_5538')).toEqual({ level: null, passengers: 15, capacity: 100 });
    expect(buses.get('MTA NYCT_8443')).toBeNull();
  });

  it('never makes up a level or a capacity the bus does not give', () => {
    expect(occupancyOf(feed([bus({ occupancy_status: 'NO_DATA_AVAILABLE' })]))).toBeNull();
    expect(occupancyOf(feed([bus({ occupancy_status: 'FULL' })]))).toEqual({
      level: 'FULL',
      passengers: null,
      capacity: null,
    });
    expect(occupancyOf(withCrowding(bus(), { count: 0, capacity: 0 }))).toEqual({
      level: null,
      passengers: 0,
      capacity: null,
    });
    expect(occupancyOf(withCrowding(bus(), { count: -1, capacity: 80 }))).toEqual({
      level: null,
      passengers: null,
      capacity: 80,
    });
  });

  it('reads copies stored before occupancy was kept as buses without it', () => {
    const stored = busPositionsSchema.parse(
      accepted(parseFresh('mta-bus-positions', feed([bus()]))).data,
    );
    const { occupancy: _left, ...older } = stored.vehicles[0] ?? {};
    const read = busPositionsSchema.parse({ ...stored, vehicles: [older] });
    expect(read.vehicles[0]?.occupancy).toBeNull();
  });

  it('accepts the predictions capture, and every captured bus finds its stops and times', () => {
    const result = accepted(parseFresh('mta-bus-trip-updates', capture('bus-trip-updates.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T01:05:19.000Z');
    expect(result.coverage).toBe('40 trips, 707 stop times, 0 left out');
    expect(storedAndRead('mta-bus-trip-updates', result.data)).toEqual(result.data);
    const trips = new Map(busTripUpdatesSchema.parse(result.data).trips.map((t) => [t.tripId, t]));
    const positions = accepted(
      parseFresh('mta-bus-positions', capture('bus-vehicle-positions.pb')),
    );
    for (const bus of busPositionsSchema.parse(positions.data).vehicles) {
      expect(trips.get(bus.tripId)?.stops.length).toBeGreaterThan(0);
    }
  });

  it('leaves out a bus without a trip, a position or a time of its own', () => {
    const body = feed([
      {
        id: 'ok',
        vehicle: { trip, position, timestamp: HEADER_TIME, vehicle: { id: 'MTA NYCT_8440' } },
      },
      { id: 'no-trip', vehicle: { position, timestamp: HEADER_TIME } },
      { id: 'no-position', vehicle: { trip, timestamp: HEADER_TIME } },
      { id: 'no-time', vehicle: { trip, position } },
    ]);
    const result = accepted(parseFresh('mta-bus-positions', body));
    const data = busPositionsSchema.parse(result.data);
    expect(data.vehicles.map((bus) => bus.vehicleId)).toEqual(['MTA NYCT_8440']);
    expect(data.leftOut).toBe(3);
  });

  it.each([
    ['mta-bus-positions', 'not-protobuf', text('<html>502 Bad Gateway</html>')],
    ['mta-bus-positions', 'no-header-time', feed([], 0)],
    ['mta-bus-positions', 'future-header', feed([], HEADER_TIME + 3_600)],
    ['mta-bus-positions', 'empty-feed', feed([{ id: 'x', vehicle: { position } }])],
    ['mta-bus-trip-updates', 'not-protobuf', text('{"error":"bad gateway"}')],
    ['mta-bus-trip-updates', 'empty-feed', feed([{ id: 'x', trip_update: { trip } }])],
    ['mta-bus-trip-updates', 'empty-feed', feed([cancelledUpdate])],
  ])('%s refuses %s', (id, code, body) => {
    expect(parseFresh(id, body)).toMatchObject({ ok: false, code });
  });

  it('keeps a cancelled trip without stops, marked as such', () => {
    const update = {
      id: 'running',
      trip_update: {
        trip,
        stop_time_update: [{ stop_id: '500549', arrival: { time: HEADER_TIME } }],
      },
    };
    const body = feed([update, cancelledUpdate, { id: 'silent', trip_update: { trip } }]);
    const data = busTripUpdatesSchema.parse(
      accepted(parseFresh('mta-bus-trip-updates', body)).data,
    );
    expect(data.trips.map((one) => [one.tripId, one.cancelled, one.stops.length])).toEqual([
      ['JA_D6-Weekday-SDon-118700_MISC_887', false, 1],
      ['JA_D6-Weekday-SDon-119000_MISC_887', true, 0],
    ]);
    expect(data.leftOut).toBe(1);
  });

  it('refuses predictions older than the version served', () => {
    const update = {
      id: 'x',
      trip_update: {
        trip,
        stop_time_update: [{ stop_id: '500549', arrival: { time: HEADER_TIME } }],
      },
    };
    const served = busTripUpdatesSchema.parse(
      accepted(parseFresh('mta-bus-trip-updates', feed([update]))).data,
    );
    const result = source('mta-bus-trip-updates').parse(feed([update], HEADER_TIME - 30), {
      receivedAt: CAPTURED_AT,
      previous: served,
    });
    expect(result).toMatchObject({ ok: false, code: 'older-than-served' });
  });
});
