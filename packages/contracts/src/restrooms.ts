import { z } from 'zod';

import type { Leg, Place } from './legs.js';
import { liveSourceSchema } from './live.js';
import { instantSchema } from './time.js';

const text = z.string().min(1);
/** A field as the city publishes it; null when it gives nothing. */
const note = z.string().min(1).nullable();

/** NYC's own words: `Fully Accessible`, `Partially Accessible`, `Limited Accessibility`… */
export const restroomAccessSchema = z.enum(['full', 'partial', 'limited', 'none']);

export type RestroomAccess = z.infer<typeof restroomAccessSchema>;

/**
 * A public restroom of NYC's list (NYC Open Data `i7jb-7jku`), in service when listed: free to
 * use, with its hours as published and never worked out into "open now".
 */
export const restroomFactsSchema = z.object({
  /** As NYC names the place: `Park`, `Library`, `Public Plaza`, `Transit`… */
  placeType: note,
  operator: note,
  /** The published hours, line by line, as the city writes them. */
  hours: note,
  /** `Seasonal`: open part of the year only, as the city lists it. */
  season: z.enum(['year-round', 'seasonal']).nullable(),
  access: restroomAccessSchema.nullable(),
  stalls: z
    .enum([
      'multi-stall-gendered',
      'multi-stall-all-gender',
      'single-stall-all-gender',
      'single-stall-gendered',
      'both',
    ])
    .nullable(),
  /** A changing table, and in which restroom when only in one. */
  changingTable: z.enum(['yes', 'women', 'men', 'all-gender', 'no']).nullable(),
  /** True when the city's note says a key or a code is needed to get in. */
  keyOrCode: z.boolean(),
  /** The city's note, in English as published: where inside, a key, who opens it. */
  note,
  website: z.url({ protocol: /^https?$/ }).nullable(),
});

export type RestroomFacts = z.infer<typeof restroomFactsSchema>;

/** Longitude and latitude, in that order, as GeoJSON writes them. */
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** A restroom near one of the points asked, with the straight line to it. */
export const nearRestroomSchema = z.object({
  name: text,
  point: lonLat,
  facts: restroomFactsSchema,
  /** The index of the point asked it is nearest to. */
  near: z.number().int().nonnegative(),
  /** The straight line from that point, in metres: never a walk along the streets. */
  straightMetres: z.number().int().nonnegative(),
});

export type NearRestroom = z.infer<typeof nearRestroomSchema>;

/** The most points one request may ask about: the next stops of a trip. */
export const MAX_RESTROOM_POINTS = 4;

/**
 * `GET /api/city/restrooms?near=lat,lon;lat,lon&stepFree=1`: the public restrooms in service
 * nearest to each point, within `withinMetres` in a straight line. With `stepFree`, the fully
 * accessible ones come first. `restrooms` is null when the list cannot be read, never empty.
 */
export const restroomsNearResponseSchema = z.object({
  generatedAt: instantSchema,
  stepFree: z.boolean(),
  withinMetres: z.number().int().positive(),
  restrooms: z.array(nearRestroomSchema).nullable(),
  source: liveSourceSchema,
});

export type RestroomsNearResponse = z.infer<typeof restroomsNearResponseSchema>;

/** The stops of a trip a restroom is looked for near: three at most. */
const STOPS_LOOKED_AT = MAX_RESTROOM_POINTS - 1;

/**
 * The next stops of a trip at `now`: where each leg not yet over ends, in order, each place once
 * (the station boarded, the one left, the destination). Shared by the trip screen and Sara.
 */
export function nextStops(legs: readonly Leg[], now: number): Place[] {
  const stops: Place[] = [];
  for (const leg of legs) {
    if (Date.parse(leg.arriveAt) <= now) continue;
    if (stops.some((stop) => stop.label === leg.to.label)) continue;
    stops.push(leg.to);
  }
  return stops.slice(0, STOPS_LOOKED_AT);
}
