import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { KnownFailure, ParseContext, ParseResult } from '../../definition.js';
import type { GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { count } from '../mta/provider.js';
import { instantOf, readRealtimeFeed } from '../mta/realtime-feed.js';
import { GTFS_REALTIME_FAILURES } from '../regional/provider-failures.js';

const busSchema = z.object({
  /** Each bus sends the position of its own GPS receiver. */
  located: z.literal('gps'),
  vehicleId: z.string().min(1),
  /** The fleet number on the bus, such as `356`. */
  label: z.string().nullable(),
  /** The route of the timetable, which names the line. */
  routeId: z.string().min(1),
  /** The trip of the timetable, which gives the destination; null when the bus names none. */
  tripId: z.string().min(1).nullable(),
  direction: z.union([z.literal(0), z.literal(1)]).nullable(),
  /** The stop the bus is at or heading to. */
  stopId: z.string().min(1).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  bearingDegrees: z.number().min(0).max(360).nullable(),
  speedMetresPerSecond: z.number().nonnegative().nullable(),
  observedAt: instantSchema,
});

export const busPositionsSchema = z.object({
  feedTime: instantSchema,
  /** Buses on a route; an empty list is a valid answer when no bus runs. */
  buses: z.array(busSchema),
  /** Vehicles without a route, a position or a report time, or reported after the header. */
  leftOut: z.number().int().nonnegative(),
});

export type BusPositions = z.infer<typeof busPositionsSchema>;
type Bus = z.infer<typeof busSchema>;
type Entity = GtfsRealtimeFeed['entity'][number];

function text(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

/** A value inside its range, or null: a bad bearing or speed does not cost the bus its place. */
function within(value: number | undefined, min: number, max: number): number | null {
  return value !== undefined && value >= min && value <= max ? value : null;
}

function busOf(entity: Entity, feedTime: Date): Bus | undefined {
  const vehicle = entity.vehicle;
  const position = vehicle?.position;
  if (vehicle === undefined || position === undefined) return undefined;
  const observedAt = instantOf(vehicle.timestamp);
  if (observedAt === null || Date.parse(observedAt) > feedTime.getTime()) return undefined;
  const direction = vehicle.trip?.direction_id;
  const candidate = busSchema.safeParse({
    located: 'gps',
    vehicleId: text(vehicle.vehicle?.id) ?? entity.id,
    label: text(vehicle.vehicle?.label),
    routeId: vehicle.trip?.route_id,
    tripId: text(vehicle.trip?.trip_id),
    direction: direction === 0 || direction === 1 ? direction : null,
    stopId: text(vehicle.stop_id),
    latitude: position.latitude,
    longitude: position.longitude,
    bearingDegrees: within(position.bearing, 0, 360),
    speedMetresPerSecond: within(position.speed, 0, Number.POSITIVE_INFINITY),
    observedAt,
  });
  return candidate.success ? candidate.data : undefined;
}

/**
 * Reads a GTFS Realtime vehicle positions feed whose header is the second of the request, as
 * GMV (Bee-Line) and Passio do: the header then says nothing of the data, so the time of the data
 * is the newest bus report, and the header only when no bus runs.
 */
export function parseBusPositions(
  body: Uint8Array,
  context: ParseContext<BusPositions>,
): ParseResult<BusPositions> {
  const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
  if (!read.ok) return read;
  const buses = read.feed.entity.flatMap((entity) => busOf(entity, read.feedTime) ?? []);
  const leftOut = read.feed.entity.length - buses.length;
  const newest = Math.max(...buses.map((bus) => Date.parse(bus.observedAt)));
  const dataTime = buses.length === 0 ? read.feedTime : new Date(newest);
  return {
    ok: true,
    data: { feedTime: toInstant(read.feedTime), buses, leftOut },
    dataTime,
    coverage: `${count(buses.length, 'buses on a route')}, ${String(leftOut)} left out`,
  };
}

/** The failures of reading the feed, after the HTTP ones of each provider. */
export const BUS_POSITION_FAILURES: readonly KnownFailure[] = GTFS_REALTIME_FAILURES.map(
  (failure) =>
    failure.code === 'stale-header'
      ? {
          ...failure,
          code: 'stale-reports',
          detection: 'The newest bus report stops moving while downloads succeed',
          remedy: 'Freshness is measured on that report, so the age grows and the state follows it',
        }
      : failure,
);
