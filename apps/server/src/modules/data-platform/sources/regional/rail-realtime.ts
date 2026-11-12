import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseContext, ParseResult, SourceDefinition } from '../../definition.js';
import type { GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { MINUTE, MTA_FEEDS_URL, MTA_LICENCE, MTA_PROVIDER, count } from '../mta/provider.js';
import {
  REALTIME_FAILURES,
  instantOf,
  predictedStopSchema,
  predictedStops,
  readRealtimeFeed,
} from '../mta/realtime-feed.js';

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/** `gps`: the train sends its coordinates. `station`: only the stop it is at or heading to. */
const trainPositionSchema = z.discriminatedUnion('located', [
  z.object({ located: z.literal('gps'), latitude, longitude }),
  z.object({ located: z.literal('station') }),
]);

const trainSchema = z.object({
  vehicleId: z.string().nullable(),
  label: z.string().nullable(),
  /** The stop the train is at or heading to. */
  stopId: z.string().nullable(),
  status: z.enum(['incoming', 'stopped', 'in-transit']).nullable(),
  position: trainPositionSchema,
  /** When the train reported; null where the provider stamps every train with the feed time. */
  observedAt: instantSchema.nullable(),
});

const railTripSchema = z.object({
  tripId: z.string().min(1),
  routeId: z.string().min(1),
  /**
   * Metro-North's trip ids do not join its timetable; the entity id is the train number, which
   * is `trip_short_name` there. Null for LIRR, whose trip ids join the timetable directly.
   */
  trainNumber: z.string().nullable(),
  direction: z.union([z.literal(0), z.literal(1)]).nullable(),
  startDate: z.string().nullable(),
  /** The last stop the update lists and does not skip: where the trip ends. */
  finalStopId: z.string().min(1),
  /** Stops with a time, in travel order; those before the feed time are already behind. */
  stops: z.array(predictedStopSchema).min(1),
  /** Null while no train runs the trip yet, or the train reports neither a place nor a stop. */
  train: trainSchema.nullable(),
});

export const railFeedSchema = z.object({
  feedTime: instantSchema,
  /** The time of the data: the header, or the newest train report where the header is not. */
  dataTime: instantSchema,
  trips: z.array(railTripSchema),
  /** Trip updates without a trip, a route, a final stop or any timed stop. */
  leftOut: z.number().int().nonnegative(),
});

type RailFeed = z.infer<typeof railFeedSchema>;
type RailTrip = z.infer<typeof railTripSchema>;
type Train = z.infer<typeof trainSchema>;
type Entity = GtfsRealtimeFeed['entity'][number];
type Vehicle = NonNullable<Entity['vehicle']>;
type Update = NonNullable<Entity['trip_update']>;

const STATUS = new Map<string, Train['status']>([
  ['INCOMING_AT', 'incoming'],
  ['STOPPED_AT', 'stopped'],
  ['IN_TRANSIT_TO', 'in-transit'],
]);

interface RailFeedFile {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  /** `observed`: each vehicle carries its own report time. `feed`: every one carries the feed's. */
  readonly vehicleTimes: 'observed' | 'feed';
  readonly trainNumber: 'entity-id' | 'none';
  /** `header`: the feed time. `newest-report`: the latest train report, for a header made on request. */
  readonly dataTime: 'header' | 'newest-report';
}

function trainOf(vehicle: Vehicle | undefined, file: RailFeedFile): Train | null {
  if (vehicle === undefined) return null;
  const stopId = vehicle.stop_id ?? null;
  const position = vehicle.position;
  if (position === undefined && stopId === null) return null;
  // A train that would not read back (a position out of range) is dropped; its trip stays.
  const train = trainSchema.safeParse({
    vehicleId: vehicle.vehicle?.id ?? null,
    label: vehicle.vehicle?.label ?? null,
    stopId,
    status: STATUS.get(vehicle.current_status ?? '') ?? null,
    position: position
      ? { located: 'gps', latitude: position.latitude, longitude: position.longitude }
      : { located: 'station' },
    observedAt: file.vehicleTimes === 'observed' ? instantOf(vehicle.timestamp) : null,
  });
  return train.success ? train.data : null;
}

function finalStopOf(update: Update): string | undefined {
  return update.stop_time_update
    .filter((stop) => stop.schedule_relationship !== 'SKIPPED' && (stop.stop_id ?? '') !== '')
    .at(-1)?.stop_id;
}

function directionOf(value: number | undefined): RailTrip['direction'] {
  return value === 0 || value === 1 ? value : null;
}

/**
 * LIRR sends a train as its own entity next to the trip update and names the same trip;
 * Metro-North puts both in one entity, with a vehicle trip id of its own.
 */
function normaliseRail(
  feed: GtfsRealtimeFeed,
  feedTime: Date,
  file: RailFeedFile,
): Omit<RailFeed, 'dataTime'> {
  const vehicles = new Map<string, Vehicle>();
  for (const entity of feed.entity) {
    const tripId = entity.vehicle?.trip?.trip_id;
    if (entity.vehicle && tripId !== undefined) vehicles.set(tripId, entity.vehicle);
  }
  const trips: RailTrip[] = [];
  let leftOut = 0;
  for (const entity of feed.entity) {
    const update = entity.trip_update;
    if (update === undefined) continue;
    const tripId = update.trip.trip_id ?? '';
    // Validated as stored, so a trip that would not read back (an empty id, no route) is left
    // out and counted instead of served.
    const trip = railTripSchema.safeParse({
      tripId,
      routeId: update.trip.route_id,
      trainNumber: file.trainNumber === 'entity-id' ? entity.id : null,
      direction: directionOf(update.trip.direction_id),
      startDate: update.trip.start_date ?? null,
      finalStopId: finalStopOf(update),
      stops: predictedStops(update.stop_time_update),
      train: trainOf(entity.vehicle ?? vehicles.get(tripId), file),
    });
    if (trip.success) trips.push(trip.data);
    else leftOut += 1;
  }
  return { feedTime: toInstant(feedTime), trips, leftOut };
}

/** The latest train report no later than the feed itself, or undefined when none has a time. */
function newestReport(trips: readonly RailTrip[], feedTime: Date): Date | undefined {
  const reports = trips
    .map((trip) => Date.parse(trip.train?.observedAt ?? ''))
    .filter((time) => !Number.isNaN(time) && time <= feedTime.getTime());
  return reports.length === 0 ? undefined : new Date(Math.max(...reports));
}

function parseRail(
  body: Uint8Array,
  context: ParseContext<RailFeed>,
  file: RailFeedFile,
): ParseResult<RailFeed> {
  const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
  if (!read.ok) return read;
  const normalised = normaliseRail(read.feed, read.feedTime, file);
  // Both railroads list trips hours ahead of departure, so a feed without one is a failure.
  if (normalised.trips.length === 0) {
    const detail = `${count(normalised.leftOut, 'trips')} unusable`;
    return { ok: false, code: 'empty-feed', detail };
  }
  const dataTime =
    file.dataTime === 'header' ? read.feedTime : newestReport(normalised.trips, read.feedTime);
  if (dataTime === undefined) {
    return { ok: false, code: 'no-train-report', detail: 'no train carries a report time' };
  }
  const data: RailFeed = { ...normalised, dataTime: toInstant(dataTime) };
  const trains = data.trips.filter((trip) => trip.train !== null);
  const gps = trains.filter((trip) => trip.train?.position.located === 'gps').length;
  return {
    ok: true,
    data,
    dataTime,
    coverage: [
      count(data.trips.length, 'trips'),
      count(trains.length, 'trains'),
      count(gps, 'GPS positions'),
      `${String(data.leftOut)} left out`,
    ].join(', '),
  };
}

const FEEDS: readonly RailFeedFile[] = [
  {
    id: 'mta-lirr-realtime',
    path: 'lirr%2Fgtfs-lirr',
    title: 'Long Island Rail Road live trains',
    vehicleTimes: 'observed',
    trainNumber: 'none',
    // The header is the second of each request (three downloads 21 s apart on 11/11/2026), so
    // it says nothing of the data; the newest train report was 2 to 12 seconds older.
    dataTime: 'newest-report',
  },
  {
    id: 'mta-metro-north-realtime',
    path: 'mnr%2Fgtfs-mnr',
    title: 'Metro-North Railroad live trains',
    // All 114 vehicles of the capture of 11/11/2026 carried the header time to the second.
    vehicleTimes: 'feed',
    trainNumber: 'entity-id',
    // The header moved every 10 to 23 seconds in the same three downloads.
    dataTime: 'header',
  },
];

function railSource(file: RailFeedFile): SourceDefinition<RailFeed> {
  return {
    id: file.id,
    title: file.title,
    provider: MTA_PROVIDER,
    licence: MTA_LICENCE,
    kind: 'realtime',
    // Both feeds move every few seconds; every 30 seconds while a trip is watched follows a train
    // from stop to stop, and once a minute is enough for the map at rest.
    rhythm: { class: 'hot', baseIntervalMs: MINUTE, interestIntervalMs: 30_000 },
    freshness: {
      degradedAfterMs: 2 * MINUTE,
      staleAfterMs: 5 * MINUTE,
      unavailableAfterMs: 15 * MINUTE,
    },
    limits: { timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 },
    keepVersions: 1,
    dataSchema: railFeedSchema,
    request() {
      return { url: `${MTA_FEEDS_URL}${file.path}` };
    },
    parse(body, context) {
      return parseRail(body, context, file);
    },
    consumers: ['live-map', 'trip-watch', 'arrivals'],
    failures: [
      ...REALTIME_FAILURES,
      {
        code: 'empty-feed',
        detection: 'No trip with a route, a final stop and a timed stop',
        state: 'degraded',
        remedy: 'Refused; the last good trips are served with their age until it runs out',
      },
      {
        code: 'no-train-report',
        detection: 'LIRR: no train carries a report time, so the age of the data is unknown',
        state: 'degraded',
        remedy: 'Refused: data without a time is never served',
      },
    ],
  };
}

/** LIRR and Metro-North in real time, from the MTA's GTFS Realtime gateway without a key. */
export const railRealtimeSources: readonly SourceDefinition<RailFeed>[] = FEEDS.map(railSource);
