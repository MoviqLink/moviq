import type { Place, TravelMode } from '@moviq/contracts';

import type { RouteQuery } from '../../journeys/ports.js';

/** MOTIS 2 planning on Transitous, the version its OpenAPI names (`MOTIS v2.11.4` on 11/11/2026). */
export const TRANSITOUS_PLAN_URL = 'https://api.transitous.org/api/v6/plan';

/**
 * MOTIS transit modes for each MovIQ mode. `RAIL` is not used because MOTIS counts the subway in
 * it; walking and taxis are street modes, not transit.
 */
const TRANSIT_MODES: Readonly<Record<TravelMode, readonly string[]>> = {
  walk: [],
  taxi: [],
  subway: ['SUBWAY'],
  bus: ['BUS', 'COACH'],
  rail: ['REGIONAL_RAIL', 'SUBURBAN', 'LONG_DISTANCE', 'HIGHSPEED_RAIL', 'NIGHT_RAIL'],
  ferry: ['FERRY'],
};

/** A taxi ride is the engine's direct car connection; every airport trip fits in two hours. */
const MAX_TAXI_SECONDS = 2 * 60 * 60;

/**
 * The plan request for "arrive by": the walk limit applies to the first and last mile and to a
 * trip on foot only, which MOTIS returns apart and only when walking is allowed. Step-free uses
 * the MOTIS wheelchair profile for every footpath, transfers included. With `taxi`, the direct
 * connection is by car (`directModes=CAR`, answered in `direct`), as MOTIS routes a ride door to door.
 */
export function planUrl(query: RouteQuery): string {
  const walkSeconds = String(query.maxWalkMinutes * 60);
  const transitModes = [...new Set(query.modes.flatMap((mode) => TRANSIT_MODES[mode]))];
  const params = new URLSearchParams({
    fromPlace: coordinates(query.from),
    toPlace: coordinates(query.to),
    time: wholeSeconds(query.arriveBy),
    arriveBy: 'true',
    numItineraries: String(query.count),
    transitModes: transitModes.join(','),
    pedestrianProfile: query.stepFree ? 'WHEELCHAIR' : 'FOOT',
    maxPreTransitTime: walkSeconds,
    maxPostTransitTime: walkSeconds,
    maxDirectTime: directSeconds(query, walkSeconds),
  });
  if (query.modes.includes('taxi')) params.set('directModes', 'CAR');
  return `${TRANSITOUS_PLAN_URL}?${params.toString()}`;
}

function directSeconds(query: RouteQuery, walkSeconds: string): string {
  if (query.modes.includes('taxi')) return String(MAX_TAXI_SECONDS);
  return query.modes.includes('walk') ? walkSeconds : '0';
}

function coordinates(place: Place): string {
  return `${String(place.lat)},${String(place.lon)}`;
}

function wholeSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
