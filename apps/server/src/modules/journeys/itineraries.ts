import { randomUUID } from 'node:crypto';

import { toInstant, type Itinerary, type Leg, type Provenance } from '@moviq/contracts';

import type { FareRules, RoutedItinerary, RoutedLeg, RoutedWalk } from './ports.js';

const MINUTE = 60_000;

/** An itinerary as MovIQ serves it, from what the routing engine returned. */
export function toItinerary(
  routed: RoutedItinerary,
  provenance: Provenance,
  arriveBy: Date,
  fares: FareRules,
): Itinerary {
  const legs = routed.legs.map((leg) => toLeg(leg, provenance));
  const first = routed.legs[0];
  const last = routed.legs.at(-1);
  const departAt = first?.departAt ?? arriveBy;
  const arriveAt = last?.arriveAt ?? arriveBy;
  const transit = routed.legs.filter((leg) => leg.mode !== 'walk' && leg.mode !== 'taxi').length;
  return {
    id: randomUUID(),
    departAt: toInstant(departAt),
    arriveAt: toInstant(arriveAt),
    spareMinutes: Math.floor((arriveBy.getTime() - arriveAt.getTime()) / MINUTE),
    transfers: Math.max(0, transit - 1),
    walkMinutes: Math.round(
      routed.legs
        .filter((leg) => leg.mode === 'walk')
        .reduce((total, leg) => total + leg.arriveAt.getTime() - leg.departAt.getTime(), 0) /
        MINUTE,
    ),
    legs,
    fare: fares.fareFor(routed.legs),
    accessibility: null,
    walking: legs.some((leg) => leg.walk?.basis === 'estimated') ? 'provisional' : 'checked',
  };
}

/** A walk a provider did not label is estimated: nothing says it was walked on the streets. */
const UNLABELLED_WALK: RoutedWalk = {
  basis: 'estimated',
  profile: 'foot',
  metres: null,
  unchecked: 'not-asked',
};

function toLeg(leg: RoutedLeg, provenance: Provenance): Leg {
  const timing =
    leg.mode === 'walk' || leg.mode === 'taxi'
      ? 'estimated'
      : leg.scheduled
        ? 'scheduled'
        : 'realtime';
  return {
    mode: leg.mode,
    from: leg.from,
    to: leg.to,
    departAt: toInstant(leg.departAt),
    arriveAt: toInstant(leg.arriveAt),
    route: leg.route,
    tripId: leg.tripId,
    timing,
    provenance,
    path: leg.path.map(([lon, lat]): [number, number] => [lon, lat]),
    walk: leg.mode === 'walk' ? (leg.walk ?? UNLABELLED_WALK) : null,
  };
}
