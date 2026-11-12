import { placeSchema, type Place, type TravelMode } from '@moviq/contracts';
import { z } from 'zod';

import type { RoutedItinerary, RoutedLeg, RoutedWalk, RouteQuery } from '../../journeys/ports.js';
import { decodePolyline } from './polyline.js';

/** The parts of a MOTIS 2 place that MovIQ reads (OpenAPI `Place`). */
const enginePlaceSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  stopId: z.string().optional(),
});

const optionalText = z.string().nullish();

/** The parts of a MOTIS 2 leg that MovIQ reads (OpenAPI `Leg`). */
const engineLegSchema = z.object({
  mode: z.string(),
  from: enginePlaceSchema,
  to: enginePlaceSchema,
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true }),
  realTime: z.boolean(),
  routeId: optionalText,
  routeShortName: optionalText,
  displayName: optionalText,
  routeLongName: optionalText,
  headsign: optionalText,
  tripId: optionalText,
  /** Metres walked, on street legs. */
  distance: z.number().nonnegative().optional(),
  legGeometry: z.object({
    points: z.string(),
    precision: z.number().int().min(1).max(10),
    length: z.number().int().nonnegative(),
  }),
});

const engineItinerarySchema = z.object({ legs: z.array(engineLegSchema).min(1) });

/** A MOTIS 2 plan answer: trips on foot only in `direct`, the rest in `itineraries`. */
export const planResponseSchema = z.object({
  direct: z.array(engineItinerarySchema),
  itineraries: z.array(engineItinerarySchema),
});

type EnginePlace = z.infer<typeof enginePlaceSchema>;
type EngineLeg = z.infer<typeof engineLegSchema>;
type EngineItinerary = z.infer<typeof engineItinerarySchema>;
type EnginePlan = z.infer<typeof planResponseSchema>;

const MODES: ReadonlyMap<string, TravelMode> = new Map([
  ['WALK', 'walk'],
  ['CAR', 'taxi'],
  ['SUBWAY', 'subway'],
  ['METRO', 'subway'],
  ['BUS', 'bus'],
  ['COACH', 'bus'],
  ['FERRY', 'ferry'],
  ['RAIL', 'rail'],
  ['REGIONAL_RAIL', 'rail'],
  ['REGIONAL_FAST_RAIL', 'rail'],
  ['SUBURBAN', 'rail'],
  ['LONG_DISTANCE', 'rail'],
  ['HIGHSPEED_RAIL', 'rail'],
  ['NIGHT_RAIL', 'rail'],
]);

/** Why an itinerary of the answer is left out; none of these is an error of the provider. */
export type LeftOut = 'unsupported-mode' | 'unusable-place' | 'after-deadline' | 'bad-times';

type LegResult =
  | { readonly ok: true; readonly leg: RoutedLeg }
  | { readonly ok: false; readonly reason: LeftOut | 'bad-geometry' };

type NormalisedPlan =
  | {
      readonly ok: true;
      readonly itineraries: readonly RoutedItinerary[];
      readonly leftOut: ReadonlyMap<LeftOut, number>;
    }
  | { readonly ok: false; readonly detail: string };

/**
 * The itineraries MovIQ can follow, latest departure first, at most `query.count`. Every time,
 * stop and line comes from the answer: an itinerary with a part MovIQ cannot represent is left
 * out whole, and a polyline that does not decode means the format changed.
 */
export function normalisePlan(response: EnginePlan, query: RouteQuery): NormalisedPlan {
  const leftOut = new Map<LeftOut, number>();
  const kept: RoutedItinerary[] = [];
  for (const itinerary of [...response.direct, ...response.itineraries]) {
    const result = normaliseItinerary(itinerary, query);
    if (result.ok) kept.push(result.itinerary);
    else if (result.reason === 'bad-geometry') {
      return { ok: false, detail: 'a leg geometry is not a whole encoded polyline' };
    } else leftOut.set(result.reason, (leftOut.get(result.reason) ?? 0) + 1);
  }
  const itineraries = kept
    .sort((a, b) => departure(b) - departure(a))
    .slice(0, Math.max(0, query.count));
  return { ok: true, itineraries, leftOut };
}

function departure(itinerary: RoutedItinerary): number {
  return itinerary.legs[0]?.departAt.getTime() ?? 0;
}

function normaliseItinerary(
  itinerary: EngineItinerary,
  query: RouteQuery,
):
  | { readonly ok: true; readonly itinerary: RoutedItinerary }
  | { readonly ok: false; readonly reason: LeftOut | 'bad-geometry' } {
  const last = itinerary.legs.length - 1;
  const legs: RoutedLeg[] = [];
  for (const [index, engineLeg] of itinerary.legs.entries()) {
    const result = normaliseLeg(engineLeg, {
      from: index === 0 ? query.from : undefined,
      to: index === last ? query.to : undefined,
      profile: query.stepFree ? 'wheelchair' : 'foot',
    });
    if (!result.ok) return result;
    legs.push(result.leg);
  }
  const arrival = legs.at(-1)?.arriveAt.getTime() ?? Number.POSITIVE_INFINITY;
  if (arrival > query.arriveBy.getTime()) return { ok: false, reason: 'after-deadline' };
  return { ok: true, itinerary: { legs } };
}

interface LegContext {
  /** The traveller's own places, which stand for the engine's unnamed start and end points. */
  readonly from: Place | undefined;
  readonly to: Place | undefined;
  readonly profile: RoutedWalk['profile'];
}

function normaliseLeg(leg: EngineLeg, context: LegContext): LegResult {
  const mode = MODES.get(leg.mode);
  if (mode === undefined) return { ok: false, reason: 'unsupported-mode' };
  const from = placeOf(leg.from, context.from);
  const to = placeOf(leg.to, context.to);
  if (from === undefined || to === undefined) return { ok: false, reason: 'unusable-place' };
  const departAt = new Date(leg.startTime);
  const arriveAt = new Date(leg.endTime);
  if (arriveAt < departAt) return { ok: false, reason: 'bad-times' };
  const path = pathOf(leg.legGeometry);
  if (path === undefined) return { ok: false, reason: 'bad-geometry' };
  const street = mode === 'walk' || mode === 'taxi';
  return {
    ok: true,
    leg: {
      mode,
      from,
      to,
      departAt,
      arriveAt,
      route: street ? null : routeOf(leg),
      tripId: street ? null : (leg.tripId ?? null),
      scheduled: !leg.realTime,
      path,
      ...(mode === 'walk' ? { walk: walkOf(leg, path, context.profile) } : {}),
    },
  };
}

/**
 * A walk MOTIS routed on the streets has its path; a change it gives without one (the 120 s
 * between platforms of a station, with no distance) was not asked of the streets: estimated.
 */
function walkOf(
  leg: EngineLeg,
  path: RoutedLeg['path'],
  profile: RoutedWalk['profile'],
): RoutedWalk {
  if (path.length < 2) {
    return { basis: 'estimated', profile, metres: null, unchecked: 'not-asked' };
  }
  return { basis: 'street', profile, metres: leg.distance ?? null, unchecked: null };
}

/** A stop as the engine names it; a point without a stop id is the traveller's own place. */
function placeOf(place: EnginePlace, own: Place | undefined): Place | undefined {
  if (place.stopId === undefined && own !== undefined) return own;
  const parsed = placeSchema.safeParse({
    label: place.name,
    lat: place.lat,
    lon: place.lon,
    kind: place.stopId === undefined ? 'address' : 'stop',
    stopId: place.stopId ?? null,
  });
  return parsed.success ? parsed.data : undefined;
}

/** The route as the operator names it; never its colours or symbols. */
function routeOf(leg: EngineLeg): RoutedLeg['route'] {
  const shortName = [leg.routeShortName, leg.displayName, leg.routeLongName].find(
    (name): name is string => typeof name === 'string' && name.trim() !== '',
  );
  if (typeof leg.routeId !== 'string' || shortName === undefined) return null;
  return { id: leg.routeId, shortName, headsign: leg.headsign ?? null };
}

function pathOf(geometry: EngineLeg['legGeometry']): RoutedLeg['path'] | undefined {
  const points = decodePolyline(geometry.points, geometry.precision);
  if (points?.length !== geometry.length) return undefined;
  return points;
}
