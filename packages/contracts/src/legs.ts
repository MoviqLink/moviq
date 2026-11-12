import { z } from 'zod';

import { provenanceSchema } from './sources.js';
import { instantSchema } from './time.js';

/** A place in the New York area, with what it is; coordinates always come from a source. */
export const placeSchema = z.object({
  label: z.string().min(1).max(200),
  lat: z.number().min(40.4).max(41.1),
  lon: z.number().min(-74.4).max(-73.6),
  kind: z.enum(['address', 'stop', 'station', 'airport', 'device']),
  /** GTFS stop id when the place is a stop or a station. */
  stopId: z.string().nullable(),
});

export type Place = z.infer<typeof placeSchema>;

export const travelModeSchema = z.enum(['walk', 'subway', 'bus', 'rail', 'ferry', 'taxi']);

export type TravelMode = z.infer<typeof travelModeSchema>;

/**
 * How a walk is known. `street`: walked on the OpenStreetMap streets by Transitous, with its
 * metres and path; `station-rule`: the time `transfers.txt` sets for a change inside a station,
 * with no path; `estimated`: the straight line × 1.3 at 1.2 m/s, never a way walked, and
 * `unchecked` says why the streets were not walked.
 */
const walkSchema = z.object({
  basis: z.enum(['street', 'station-rule', 'estimated']),
  /** The street profile: `wheelchair` on a step-free trip. */
  profile: z.enum(['foot', 'wheelchair']),
  /** Metres along the streets; null unless `street`. */
  metres: z.number().nonnegative().nullable(),
  /**
   * Why an estimated walk is not checked: `streets-unavailable`, Transitous did not answer;
   * `not-asked`, the plan's share of requests was spent. Null unless `estimated`. A walk the
   * streets have no way for is never served: its itinerary is left out.
   */
  unchecked: z.enum(['streets-unavailable', 'not-asked']).nullable(),
});

export const legSchema = z.object({
  mode: travelModeSchema,
  from: placeSchema,
  to: placeSchema,
  departAt: instantSchema,
  arriveAt: instantSchema,
  /** The route as the operator names it, shown in MovIQ's own style, never the official symbols. */
  route: z
    .object({ id: z.string(), shortName: z.string(), headsign: z.string().nullable() })
    .nullable(),
  tripId: z.string().nullable(),
  /** `realtime`: a live prediction; `scheduled`: a timetable; `estimated`: walking or road time. */
  timing: z.enum(['realtime', 'scheduled', 'estimated']),
  provenance: provenanceSchema,
  /** [longitude, latitude] pairs for the map. */
  path: z.array(z.tuple([z.number(), z.number()])),
  /** How a walk is known; null for the other modes, absent on legs kept before 11/11/2026. */
  walk: walkSchema.nullable().optional(),
});

export type Leg = z.infer<typeof legSchema>;
