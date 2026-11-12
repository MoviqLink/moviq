import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseContext, ParseResult, SourceDefinition } from '../../definition.js';
import type { GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { MINUTE, MTA_FEEDS_URL, MTA_LICENCE, MTA_PROVIDER, count } from './provider.js';
import {
  REALTIME_FAILURES,
  cancelledTrip,
  instantOf,
  predictedStopSchema,
  predictedStops,
  readRealtimeFeed,
  runsOrCancelled,
} from './realtime-feed.js';

const trainSchema = z.object({
  /** The stop the train is at or heading to. */
  stopId: z.string().nullable(),
  status: z.enum(['incoming', 'stopped', 'in-transit']).nullable(),
  observedAt: instantSchema,
});

const subwayTripSchema = z
  .object({
    tripId: z.string().min(1),
    routeId: z.string().min(1),
    /** From the platform suffix of the stops (`A06N`), as subway stop ids carry it. */
    direction: z.enum(['north', 'south']).nullable(),
    startDate: z.string().nullable(),
    startTime: z.string().nullable(),
    /**
     * The feed says the trip does not run (`schedule_relationship` CANCELED or DELETED); false in
     * copies stored before 11/11/2026, when cancelled trips were left out.
     */
    cancelled: z.boolean().default(false),
    /** Stops still ahead, in travel order; the last one is where the trip ends. None if cancelled. */
    stops: z.array(predictedStopSchema),
    /** Null while the train has not left its first stop or reports no time of its own. */
    train: trainSchema.nullable(),
  })
  .refine(runsOrCancelled, { message: 'a running trip has a stop ahead', path: ['stops'] });

export const subwayFeedSchema = z.object({
  feedTime: instantSchema,
  trips: z.array(subwayTripSchema),
  /** Trip updates without a trip or a route, or running without any timed stop. */
  leftOut: z.number().int().nonnegative(),
});

export type SubwayFeed = z.infer<typeof subwayFeedSchema>;
type SubwayTrip = z.infer<typeof subwayTripSchema>;
type Train = z.infer<typeof trainSchema>;
type Vehicle = NonNullable<GtfsRealtimeFeed['entity'][number]['vehicle']>;

const STATUS = new Map<string, Train['status']>([
  ['INCOMING_AT', 'incoming'],
  ['STOPPED_AT', 'stopped'],
  ['IN_TRANSIT_TO', 'in-transit'],
]);

function directionOf(stopIds: readonly string[], tripId: string): SubwayTrip['direction'] {
  const suffix = /([NS])$/.exec(stopIds[0] ?? '')?.[1] ?? /\.{1,2}([NS])/.exec(tripId)?.[1];
  if (suffix === 'N') return 'north';
  if (suffix === 'S') return 'south';
  return null;
}

/**
 * Before departure the MTA stamps a train with the time it is due to leave, which is later than
 * the feed itself: such a train has not been observed yet.
 */
function trainOf(vehicle: Vehicle | undefined, feedTime: Date): Train | null {
  const observedAt = instantOf(vehicle?.timestamp);
  if (vehicle === undefined || observedAt === null) return null;
  if (Date.parse(observedAt) - feedTime.getTime() > 2 * MINUTE) return null;
  return {
    stopId: vehicle.stop_id ?? null,
    status: STATUS.get(vehicle.current_status ?? '') ?? null,
    observedAt,
  };
}

function normaliseSubway(feed: GtfsRealtimeFeed, feedTime: Date): SubwayFeed {
  const vehicles = new Map<string, Vehicle>();
  for (const entity of feed.entity) {
    const tripId = entity.vehicle?.trip?.trip_id;
    if (entity.vehicle && tripId !== undefined) vehicles.set(tripId, entity.vehicle);
  }
  const trips: SubwayTrip[] = [];
  let leftOut = 0;
  for (const entity of feed.entity) {
    const update = entity.trip_update;
    if (update === undefined) continue;
    const { trip_id: tripId, route_id: routeId } = update.trip;
    const stops = predictedStops(update.stop_time_update);
    const cancelled = cancelledTrip(update.trip.schedule_relationship);
    if (tripId === undefined || routeId === undefined || !runsOrCancelled({ cancelled, stops })) {
      leftOut += 1;
      continue;
    }
    trips.push({
      tripId,
      routeId,
      direction: directionOf(
        stops.map((stop) => stop.stopId),
        tripId,
      ),
      startDate: update.trip.start_date ?? null,
      startTime: update.trip.start_time ?? null,
      cancelled,
      stops,
      train: trainOf(vehicles.get(tripId), feedTime),
    });
  }
  return { feedTime: toInstant(feedTime), trips, leftOut };
}

function parseSubway(body: Uint8Array, context: ParseContext<SubwayFeed>): ParseResult<SubwayFeed> {
  const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
  if (!read.ok) return read;
  const data = normaliseSubway(read.feed, read.feedTime);
  // The subway runs all night, so a feed without a running trip is a failure, never a quiet hour.
  if (data.trips.every((trip) => trip.cancelled)) {
    return { ok: false, code: 'empty-feed', detail: `${count(data.leftOut, 'trips')} unusable` };
  }
  const trains = data.trips.filter((trip) => trip.train !== null).length;
  const stopTimes = data.trips.reduce((total, trip) => total + trip.stops.length, 0);
  return {
    ok: true,
    data,
    dataTime: read.feedTime,
    coverage: [
      count(data.trips.length, 'trips'),
      count(trains, 'trains'),
      count(stopTimes, 'stop times'),
      `${String(data.leftOut)} left out`,
    ].join(', '),
  };
}

/** The eight subway feeds and the routes each carries, as on the MTA developer page. */
const FEEDS = [
  { path: 'gtfs-ace', id: 'ace', routes: 'A C E and Rockaway shuttle' },
  { path: 'gtfs-bdfm', id: 'bdfm', routes: 'B D F M and Franklin shuttle' },
  { path: 'gtfs-g', id: 'g', routes: 'G' },
  { path: 'gtfs-jz', id: 'jz', routes: 'J Z' },
  { path: 'gtfs-nqrw', id: 'nqrw', routes: 'N Q R W' },
  { path: 'gtfs-l', id: 'l', routes: 'L' },
  { path: 'gtfs', id: '1234567', routes: '1 2 3 4 5 6 7 and 42 St shuttle' },
  { path: 'gtfs-si', id: 'sir', routes: 'Staten Island Railway' },
] as const;

function subwaySource(feed: (typeof FEEDS)[number]): SourceDefinition<SubwayFeed> {
  return {
    id: `mta-subway-${feed.id}`,
    title: `MTA subway live: ${feed.routes}`,
    provider: MTA_PROVIDER,
    licence: MTA_LICENCE,
    kind: 'realtime',
    // The MTA regenerates these feeds about every 30 seconds (headers of the 11/11/2026 capture
    // were under 15 seconds old on arrival), so polling faster brings nothing new.
    rhythm: { class: 'hot', baseIntervalMs: MINUTE, interestIntervalMs: 30_000 },
    // Two missed updates degrade it; at 5 minutes predictions are no longer worth showing as live.
    freshness: {
      degradedAfterMs: 2 * MINUTE,
      staleAfterMs: 5 * MINUTE,
      unavailableAfterMs: 15 * MINUTE,
    },
    limits: { timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 },
    keepVersions: 1,
    dataSchema: subwayFeedSchema,
    request() {
      return { url: `${MTA_FEEDS_URL}nyct%2F${feed.path}` };
    },
    parse(body, context) {
      return parseSubway(body, context);
    },
    consumers: ['trip-watch', 'arrivals', 'live-map'],
    failures: [
      ...REALTIME_FAILURES,
      {
        code: 'empty-feed',
        detection: 'No trip with a route and a timed stop, while the subway runs at all hours',
        state: 'degraded',
        remedy: 'Refused; the last good trips are served with their age until it runs out',
      },
    ],
  };
}

export const subwaySources: readonly SourceDefinition<SubwayFeed>[] = FEEDS.map(subwaySource);
