import { instantSchema } from '@moviq/contracts';
import { z } from 'zod';

import { weekdayOfGtfsDate } from '../../../../infrastructure/clock/new-york.js';
import { POLYLINE_PATTERN } from './polyline.js';

/** A GTFS service date, `YYYYMMDD`. */
const gtfsDateSchema = z.string().regex(/^\d{8}$/);

const routeSchema = z.object({
  shortName: z.string().nullable(),
  longName: z.string().nullable(),
  /** GTFS `route_type`: 1 subway, 3 bus. */
  type: z.number().int().nonnegative(),
  color: z.string().nullable(),
  textColor: z.string().nullable(),
});

const stopSchema = z.object({
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** The station a platform belongs to (subway `101N` and `101S` belong to `101`). */
  parent: z.string().nullable(),
  /** True for a station (`location_type` 1), false for a platform or a bus stop. */
  station: z.boolean(),
  /**
   * GTFS `wheelchair_boarding`: 1 accessible, 2 not. Absent when the file says nothing (0 or
   * empty, as in every MTA file) and from the versions stored until 11/11/2026.
   */
  wheelchairBoarding: z.union([z.literal(1), z.literal(2)]).optional(),
});

const tripSchema = z.object({
  route: z.string().min(1),
  service: z.string().min(1),
  headsign: z.string().nullable(),
  /** GTFS trip_short_name, such as the Metro-North train number. */
  shortName: z.string().min(1).optional(),
  direction: z.union([z.literal(0), z.literal(1)]).nullable(),
  /**
   * The `shape_id` of the trip, or null when it names none; absent from an index built before
   * shapes were read, as the versions stored until 11/11/2026.
   */
  shape: z.string().min(1).nullable().optional(),
});

/**
 * The points of a shape in order, as one encoded polyline (`polyline.ts`): two points at least,
 * so four characters at least.
 */
const shapeSchema = z.string().min(4).regex(POLYLINE_PATTERN);

/**
 * Every call of every trip: stops named by index in `stops`, and the calls of each trip of
 * `trips`, in that order and each in `stop_sequence` order, one after another in `calls`
 * (`stop-times-codec.ts`). One string instead of one per trip: it is validated, stored and kept
 * in memory at once (Brooklyn: 58,357 trips).
 */
export const stopTimesSchema = z.object({
  stops: z.array(z.string().min(1)),
  trips: z
    .array(z.string().min(1))
    .refine((trips) => new Set(trips).size === trips.length, 'a trip is listed twice'),
  calls: z.string().regex(POLYLINE_PATTERN),
});

/** A row of `transfers.txt` between two stops; the MTA writes them between stations. */
const transferSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  /** GTFS `transfer_type`: 3 means the transfer is not possible. */
  type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  minSeconds: z.number().int().nonnegative().nullable(),
});

const serviceSchema = z.object({
  /** Monday to Sunday from `calendar.txt`, or null for a service defined only by dates. */
  days: z.array(z.boolean()).length(7).nullable(),
  start: gtfsDateSchema.nullable(),
  end: gtfsDateSchema.nullable(),
  /** Dates added and removed by `calendar_dates.txt`. */
  added: z.array(gtfsDateSchema),
  removed: z.array(gtfsDateSchema),
});

/**
 * The compact index of one static GTFS file: what live data needs to name a route, place a stop,
 * give a trip its destination and service and draw it along its shape, and what routing needs:
 * the stop times and transfers.
 */
export const gtfsIndexSchema = z.object({
  /** Parser representation: version 2 includes trip short names and shape metadata. */
  indexVersion: z.literal(2).optional(),
  feed: z.object({
    publisher: z.string().nullable(),
    version: z.string().nullable(),
    startDate: gtfsDateSchema.nullable(),
    endDate: gtfsDateSchema.nullable(),
    publishedAt: instantSchema,
  }),
  /** Only the routes that have trips in this file. */
  routes: z.record(z.string(), routeSchema),
  stops: z.record(z.string(), stopSchema),
  trips: z.record(z.string(), tripSchema),
  services: z.record(z.string(), serviceSchema),
  /**
   * Every shape of `shapes.txt`, by `shape_id`; empty when the file has none, and absent from an
   * index built without reading that table (the versions stored until 11/11/2026 among them).
   */
  shapes: z.record(z.string(), shapeSchema).optional(),
  /** Absent from an index built without routing tables, as the versions until 11/11/2026. */
  stopTimes: stopTimesSchema.optional(),
  transfers: z.array(transferSchema).optional(),
});

export type GtfsIndex = z.infer<typeof gtfsIndexSchema>;
export type GtfsRoute = z.infer<typeof routeSchema>;
export type GtfsStop = z.infer<typeof stopSchema>;
export type GtfsTrip = z.infer<typeof tripSchema>;
export type GtfsService = z.infer<typeof serviceSchema>;
export type GtfsStopTimes = z.infer<typeof stopTimesSchema>;
export type GtfsTransfer = z.infer<typeof transferSchema>;

/** Whether a service runs on a GTFS date, with the exceptions of `calendar_dates.txt` first. */
export function serviceRunsOn(service: GtfsService, date: string): boolean {
  if (service.removed.includes(date)) return false;
  if (service.added.includes(date)) return true;
  if (service.days === null || service.start === null || service.end === null) return false;
  if (date < service.start || date > service.end) return false;
  return service.days[weekdayOfGtfsDate(date)] === true;
}
