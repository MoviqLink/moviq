import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Licence, ParseContext, ParseResult, SourceDefinition } from '../../definition.js';
import type { GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { MINUTE, count } from '../mta/provider.js';
import { GTFS_REALTIME_FAILURES, httpFailures } from '../regional/provider-failures.js';
import {
  instantOf,
  predictedStopSchema,
  predictedStops,
  readRealtimeFeed,
} from '../mta/realtime-feed.js';

export const NYC_FERRY_PROVIDER = 'NYC Ferry (Hornblower), feeds hosted by Connexionz';

/**
 * The developer terms on https://www.ferry.nyc/developer-tools/: a non-exclusive, revocable
 * right to use the GTFS and real-time feeds in our products, NYC Ferry keeping every right.
 */
export const NYC_FERRY_LICENCE: Licence = {
  name: 'NYC Ferry Developer Terms',
  url: 'https://www.ferry.nyc/developer-tools/',
  attribution: 'Schedules and real-time data from NYC Ferry',
};

const FEEDS_URL = 'https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/';

/** What the Connexionz host can answer, for the timetable and the real-time feeds alike. */
export const NYC_FERRY_HTTP_FAILURES = httpFailures(
  'nycferry.connexionz.net',
  'https://www.ferry.nyc/developer-tools/',
);

const FAILURES = [...NYC_FERRY_HTTP_FAILURES, ...GTFS_REALTIME_FAILURES];

const vesselSchema = z.object({
  /** NYC Ferry and NY Waterway boats send their GPS position. */
  located: z.literal('gps'),
  vesselId: z.string().min(1),
  /** The name on the boat, such as `H109` (NYC Ferry) or `Hudson` (NY Waterway). */
  label: z.string().nullable(),
  /** The timetable trip: route and headsign come from the operator's GTFS. */
  tripId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedMetresPerSecond: z.number().nonnegative().nullable(),
  /** The position in the trip of the stop the boat is at or heading to. */
  stopSequence: z.number().int().nonnegative().nullable(),
  status: z.enum(['incoming', 'stopped', 'in-transit']).nullable(),
  observedAt: instantSchema,
});

export const ferryPositionsSchema = z.object({
  feedTime: instantSchema,
  /** Boats on a trip; an empty list is a valid answer when no boat sails. */
  vessels: z.array(vesselSchema),
  /** Boats without a trip, a position or a time, which cannot be followed. */
  leftOut: z.number().int().nonnegative(),
});

const ferryTripSchema = z.object({
  tripId: z.string().min(1),
  vesselId: z.string().nullable(),
  label: z.string().nullable(),
  /** The next stops of the trip with their predicted times. */
  stops: z.array(predictedStopSchema).min(1),
});

export const ferryTripUpdatesSchema = z.object({
  feedTime: instantSchema,
  trips: z.array(ferryTripSchema),
  leftOut: z.number().int().nonnegative(),
});

export type FerryPositions = z.infer<typeof ferryPositionsSchema>;
type FerryTripUpdates = z.infer<typeof ferryTripUpdatesSchema>;
type Vessel = z.infer<typeof vesselSchema>;
type FerryTrip = z.infer<typeof ferryTripSchema>;
type Entity = GtfsRealtimeFeed['entity'][number];

const STATUS = new Map<string, Vessel['status']>([
  ['INCOMING_AT', 'incoming'],
  ['STOPPED_AT', 'stopped'],
  ['IN_TRANSIT_TO', 'in-transit'],
]);

function vesselOf(entity: Entity): Vessel | undefined {
  const vehicle = entity.vehicle;
  if (vehicle?.position === undefined) return undefined;
  const candidate = vesselSchema.safeParse({
    located: 'gps',
    vesselId: vehicle.vehicle?.id ?? entity.id,
    label: vehicle.vehicle?.label ?? null,
    tripId: vehicle.trip?.trip_id,
    latitude: vehicle.position.latitude,
    longitude: vehicle.position.longitude,
    speedMetresPerSecond: vehicle.position.speed ?? null,
    stopSequence: vehicle.current_stop_sequence ?? null,
    status: STATUS.get(vehicle.current_status ?? '') ?? null,
    observedAt: instantOf(vehicle.timestamp),
  });
  return candidate.success ? candidate.data : undefined;
}

function tripOf(entity: Entity): FerryTrip | undefined {
  const update = entity.trip_update;
  if (update === undefined) return undefined;
  const candidate = ferryTripSchema.safeParse({
    tripId: update.trip.trip_id,
    vesselId: update.vehicle?.id ?? null,
    label: update.vehicle?.label ?? null,
    stops: predictedStops(update.stop_time_update),
  });
  return candidate.success ? candidate.data : undefined;
}

/** Reads a Connexionz positions feed, whose header is the time of the data. */
export function parseFerryPositions(
  body: Uint8Array,
  context: ParseContext<FerryPositions>,
): ParseResult<FerryPositions> {
  const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
  if (!read.ok) return read;
  const vessels = read.feed.entity.flatMap((entity) => vesselOf(entity) ?? []);
  const leftOut = read.feed.entity.length - vessels.length;
  return {
    ok: true,
    data: { feedTime: toInstant(read.feedTime), vessels, leftOut },
    dataTime: read.feedTime,
    coverage: `${count(vessels.length, 'boats on a trip')}, ${String(leftOut)} left out`,
  };
}

function parseTripUpdates(
  body: Uint8Array,
  context: ParseContext<FerryTripUpdates>,
): ParseResult<FerryTripUpdates> {
  const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
  if (!read.ok) return read;
  const trips = read.feed.entity.flatMap((entity) => tripOf(entity) ?? []);
  const leftOut = read.feed.entity.length - trips.length;
  return {
    ok: true,
    data: { feedTime: toInstant(read.feedTime), trips, leftOut },
    dataTime: read.feedTime,
    coverage: `${count(trips.length, 'trips')}, ${String(leftOut)} left out`,
  };
}

/**
 * Headers were 2 to 3 seconds old on arrival on 11/11/2026 and boats had reported 2 to 7 seconds
 * before them. A ferry crosses between piers in minutes, so every 30 seconds while a trip is
 * watched and every minute at rest follow it closely.
 */
export const FERRY_RHYTHM = {
  class: 'hot',
  baseIntervalMs: MINUTE,
  interestIntervalMs: 30_000,
} as const;
export const FERRY_FRESHNESS = {
  degradedAfterMs: 2 * MINUTE,
  staleAfterMs: 5 * MINUTE,
  unavailableAfterMs: 15 * MINUTE,
} as const;

/**
 * NYC Ferry boat positions. The developer page lists the alerts and trip updates of this host;
 * positions answer at the same address with `vehicleposition`, as transit.land records.
 * Boats are joined to their route and destination through the trip id of `nyc-ferry-gtfs`.
 */
const nycFerryPositions: SourceDefinition<FerryPositions> = {
  id: 'nyc-ferry-positions',
  title: 'NYC Ferry boat positions',
  provider: NYC_FERRY_PROVIDER,
  licence: NYC_FERRY_LICENCE,
  kind: 'realtime',
  rhythm: FERRY_RHYTHM,
  freshness: FERRY_FRESHNESS,
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  keepVersions: 1,
  dataSchema: ferryPositionsSchema,
  request() {
    return { url: `${FEEDS_URL}vehicleposition` };
  },
  parse(body, context) {
    return parseFerryPositions(body, context);
  },
  consumers: ['live-map', 'trip-watch'],
  failures: FAILURES,
};

/** NYC Ferry predictions for the next stops of each trip, as listed on the developer page. */
const nycFerryTripUpdates: SourceDefinition<FerryTripUpdates> = {
  id: 'nyc-ferry-trip-updates',
  title: 'NYC Ferry predictions',
  provider: NYC_FERRY_PROVIDER,
  licence: NYC_FERRY_LICENCE,
  kind: 'realtime',
  rhythm: FERRY_RHYTHM,
  freshness: FERRY_FRESHNESS,
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  keepVersions: 1,
  dataSchema: ferryTripUpdatesSchema,
  request() {
    return { url: `${FEEDS_URL}tripupdate` };
  },
  parse(body, context) {
    return parseTripUpdates(body, context);
  },
  consumers: ['arrivals', 'live-map', 'trip-watch'],
  failures: FAILURES,
};

export const nycFerryRealtimeSources = [nycFerryPositions, nycFerryTripUpdates] as const;
