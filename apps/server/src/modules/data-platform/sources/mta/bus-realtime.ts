import { instantSchema, toInstant } from '@moviq/contracts';
import protobuf from 'protobufjs';
import { z } from 'zod';

import type { KnownFailure, SourceDefinition } from '../../definition.js';
import type { GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { MINUTE, MTA_LICENCE, MTA_PROVIDER, count } from './provider.js';
import {
  REALTIME_FAILURES,
  cancelledTrip,
  instantOf,
  predictedStopSchema,
  predictedStops,
  readRealtimeFeed,
  runsOrCancelled,
} from './realtime-feed.js';

/**
 * Bus Time answers without a key (HTTP 200 on 11/11/2026, through CloudFront with
 * `cache-control: max-age=10`), so these sources declare no integration.
 */
const BUS_TIME_URL = 'https://gtfsrt.prod.obanyc.com/';

const direction = z.union([z.literal(0), z.literal(1)]).nullable();

/** GTFS Realtime `OccupancyStatus` names by wire number; 7, `NO_DATA_AVAILABLE`, is no level. */
const OCCUPANCY_LEVELS = [
  'EMPTY',
  'MANY_SEATS_AVAILABLE',
  'FEW_SEATS_AVAILABLE',
  'STANDING_ROOM_ONLY',
  'CRUSHED_STANDING_ROOM_ONLY',
  'FULL',
  'NOT_ACCEPTING_PASSENGERS',
  null,
  'NOT_BOARDABLE',
] as const;

const occupancySchema = z.object({
  /** `occupancy_status` as published, a state rather than a scale (GTFS Realtime reference). */
  level: z.enum(OCCUPANCY_LEVELS.filter((level) => level !== null)).nullable(),
  /** `estimated_count`: the passengers on board, by the bus's own counter. */
  passengers: z.number().int().nonnegative().nullable(),
  /** `estimated_capacity`: the capacity under current crowding rules, as given; never derived. */
  capacity: z.number().int().positive().nullable(),
});

type Occupancy = z.infer<typeof occupancySchema>;

const busVehicleSchema = z.object({
  vehicleId: z.string().min(1),
  tripId: z.string().min(1),
  routeId: z.string().min(1),
  direction,
  startDate: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  bearing: z.number().nullable(),
  /** The next stop the bus serves. */
  stopId: z.string().nullable(),
  /** When the bus reported this position, which can be older than the feed. */
  observedAt: instantSchema,
  /** Null when the bus publishes none; absent from copies stored before 11/11/2026. */
  occupancy: occupancySchema.nullable().default(null),
});

export const busPositionsSchema = z.object({
  feedTime: instantSchema,
  /** Only buses with their trip and route: the others cannot be followed and are not shown. */
  vehicles: z.array(busVehicleSchema),
  leftOut: z.number().int().nonnegative(),
});

const busTripSchema = z
  .object({
    tripId: z.string().min(1),
    routeId: z.string().min(1),
    direction,
    startDate: z.string().nullable(),
    vehicleId: z.string().nullable(),
    updatedAt: instantSchema.nullable(),
    delaySeconds: z.number().int().nullable(),
    /**
     * The feed says the trip does not run (`schedule_relationship` CANCELED or DELETED); false in
     * copies stored before 11/11/2026, when cancelled trips were left out.
     */
    cancelled: z.boolean().default(false),
    /** Stops still ahead, in travel order, with the predicted times of this very bus. */
    stops: z.array(predictedStopSchema),
  })
  .refine(runsOrCancelled, { message: 'a running trip has a stop ahead', path: ['stops'] });

export const busTripUpdatesSchema = z.object({
  feedTime: instantSchema,
  trips: z.array(busTripSchema),
  leftOut: z.number().int().nonnegative(),
});

type BusPositions = z.infer<typeof busPositionsSchema>;
type BusVehicle = z.infer<typeof busVehicleSchema>;
export type BusTripUpdates = z.infer<typeof busTripUpdatesSchema>;
type BusTrip = z.infer<typeof busTripSchema>;

type Entity = GtfsRealtimeFeed['entity'][number];

function directionOf(value: number | undefined): BusVehicle['direction'] {
  if (value === 0 || value === 1) return value;
  return null;
}

/**
 * The occupancy fields the shared reader leaves out, checked against their definitions on
 * 11/11/2026: `occupancy_status` (field 9 of `VehiclePosition`) and extension 1006 of OneBusAway,
 * the software Bus Time runs on (`gtfs-realtime-crowding.proto`, onebusaway-gtfs-realtime-api).
 * Of 1,162 buses that night, 466 gave a level and 608 a count and capacity; none gave
 * `occupancy_percentage` or `multi_carriage_details`. Protobuf skips every field not declared.
 */
const occupancyMessage = protobuf
  .parse(
    `syntax = "proto2";
    message Feed { repeated Entity entity = 2; }
    message Entity { optional Vehicle vehicle = 4; }
    message Vehicle { optional uint32 occupancy_status = 9; optional Crowding crowding = 1006; }
    message Crowding { optional int32 estimated_count = 1; optional int32 estimated_capacity = 2; }`,
    { keepCase: true },
  )
  .root.lookupType('Feed');

const wireInteger = z.number().int().optional();
const wireVehicle = z.object({
  occupancy_status: wireInteger,
  crowding: z.object({ estimated_count: wireInteger, estimated_capacity: wireInteger }).optional(),
});
const occupancyWireSchema = z.object({
  entity: z.array(z.object({ vehicle: wireVehicle.optional() })).default([]),
});

function occupancyOf(vehicle: z.infer<typeof wireVehicle> | undefined): Occupancy | null {
  const level = OCCUPANCY_LEVELS[vehicle?.occupancy_status ?? OCCUPANCY_LEVELS.length] ?? null;
  const passengers = vehicle?.crowding?.estimated_count ?? -1;
  const capacity = vehicle?.crowding?.estimated_capacity ?? 0;
  const occupancy = {
    level,
    passengers: passengers >= 0 ? passengers : null,
    capacity: capacity > 0 ? capacity : null,
  };
  return Object.values(occupancy).every((value) => value === null) ? null : occupancy;
}

/** Occupancy by entity, in feed order; when these fields cannot be read, no bus gets any. */
function occupancies(body: Uint8Array): readonly (Occupancy | null)[] {
  let plain: unknown;
  try {
    plain = occupancyMessage.toObject(occupancyMessage.decode(body), { defaults: false });
  } catch {
    return [];
  }
  const read = occupancyWireSchema.safeParse(plain);
  return read.success ? read.data.entity.map((entity) => occupancyOf(entity.vehicle)) : [];
}

function vehicleOf(entity: Entity, occupancy: Occupancy | null): BusVehicle | undefined {
  const vehicle = entity.vehicle;
  const trip = vehicle?.trip;
  const observedAt = instantOf(vehicle?.timestamp);
  if (!vehicle?.position || trip?.trip_id === undefined || trip.route_id === undefined) return;
  if (observedAt === null) return;
  return {
    vehicleId: vehicle.vehicle?.id ?? entity.id,
    tripId: trip.trip_id,
    routeId: trip.route_id,
    direction: directionOf(trip.direction_id),
    startDate: trip.start_date ?? null,
    latitude: vehicle.position.latitude,
    longitude: vehicle.position.longitude,
    bearing: vehicle.position.bearing ?? null,
    stopId: vehicle.stop_id ?? null,
    observedAt,
    occupancy,
  };
}

function tripOf(entity: Entity): BusTrip | undefined {
  const update = entity.trip_update;
  if (update === undefined) return;
  const stops = predictedStops(update.stop_time_update);
  const { trip_id: tripId, route_id: routeId } = update.trip;
  const cancelled = cancelledTrip(update.trip.schedule_relationship);
  if (tripId === undefined || routeId === undefined || !runsOrCancelled({ cancelled, stops })) {
    return;
  }
  return {
    tripId,
    routeId,
    direction: directionOf(update.trip.direction_id),
    startDate: update.trip.start_date ?? null,
    vehicleId: update.vehicle?.id ?? null,
    updatedAt: instantOf(update.timestamp),
    delaySeconds: update.delay ?? null,
    cancelled,
    stops,
  };
}

function emptyFeed(subject: string): KnownFailure {
  return {
    code: 'empty-feed',
    detection: `No ${subject}, while buses run at all hours`,
    state: 'degraded',
    remedy: 'Refused; the last good data is served with its age until it runs out',
  };
}

// Bus Time builds both feeds from GPS reports that buses send about every 30 seconds.
const BUS_FRESHNESS = {
  degradedAfterMs: 2 * MINUTE,
  staleAfterMs: 5 * MINUTE,
  unavailableAfterMs: 15 * MINUTE,
} as const;

const busPositions: SourceDefinition<BusPositions> = {
  id: 'mta-bus-positions',
  title: 'MTA Bus Time vehicle positions',
  provider: MTA_PROVIDER,
  licence: MTA_LICENCE,
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: MINUTE, interestIntervalMs: 30_000 },
  freshness: BUS_FRESHNESS,
  limits: { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: busPositionsSchema,
  request() {
    return { url: `${BUS_TIME_URL}vehiclePositions` };
  },
  parse(body, context) {
    const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
    if (!read.ok) return read;
    const occupancy = occupancies(body);
    const vehicles = read.feed.entity.flatMap(
      (entity, index) => vehicleOf(entity, occupancy[index] ?? null) ?? [],
    );
    const leftOut = read.feed.entity.length - vehicles.length;
    if (vehicles.length === 0) {
      return { ok: false, code: 'empty-feed', detail: `${String(leftOut)} entities, none usable` };
    }
    const buses = count(vehicles.length, 'buses with trip and route');
    const counted = vehicles.filter((bus) => bus.occupancy !== null).length;
    return {
      ok: true,
      data: { feedTime: toInstant(read.feedTime), vehicles, leftOut },
      dataTime: read.feedTime,
      coverage: `${buses}, ${count(counted, 'with occupancy')}, ${String(leftOut)} left out`,
    };
  },
  consumers: ['live-map', 'boarding', 'trip-watch'],
  failures: [...REALTIME_FAILURES, emptyFeed('bus with a position, a trip and a route')],
};

/**
 * The whole city in one response: 2.3 MB at 20:05 in New York, more at rush hour. Without an
 * interest it is read every 2 minutes; with one, as often as positions.
 */
const busTripUpdates: SourceDefinition<BusTripUpdates> = {
  id: 'mta-bus-trip-updates',
  title: 'MTA Bus Time predictions',
  provider: MTA_PROVIDER,
  licence: MTA_LICENCE,
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: 2 * MINUTE, interestIntervalMs: 30_000 },
  freshness: { ...BUS_FRESHNESS, degradedAfterMs: 3 * MINUTE },
  limits: { timeoutMs: 30_000, maxBytes: 16 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: busTripUpdatesSchema,
  request() {
    return { url: `${BUS_TIME_URL}tripUpdates` };
  },
  parse(body, context) {
    const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
    if (!read.ok) return read;
    const trips = read.feed.entity.flatMap((entity) => tripOf(entity) ?? []);
    const leftOut = read.feed.entity.length - trips.length;
    if (trips.every((trip) => trip.cancelled)) {
      return { ok: false, code: 'empty-feed', detail: `${String(leftOut)} entities, none usable` };
    }
    const stopTimes = trips.reduce((total, trip) => total + trip.stops.length, 0);
    return {
      ok: true,
      data: { feedTime: toInstant(read.feedTime), trips, leftOut },
      dataTime: read.feedTime,
      coverage: `${count(trips.length, 'trips')}, ${count(stopTimes, 'stop times')}, ${String(leftOut)} left out`,
    };
  },
  consumers: ['arrivals', 'live-map', 'trip-watch'],
  failures: [...REALTIME_FAILURES, emptyFeed('trip with a route and a timed stop')],
};

export const busSources = [busPositions, busTripUpdates] as const;
