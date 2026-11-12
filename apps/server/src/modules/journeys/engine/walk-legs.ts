import type { Place } from '@moviq/contracts';

import type { RoutedItinerary, RoutedLeg, RoutedWalk } from '../ports.js';
import type { StreetPoint, WalkProfile } from './street-walks.js';

/** Where a walk sits in the itinerary, which decides what its street time may move. */
export type WalkRole = 'access' | 'transfer' | 'egress' | 'direct';

/** A walk of an itinerary to ask the streets about. */
export interface WalkRef {
  readonly leg: number;
  readonly role: WalkRole;
  /** The points walked between: a step-free entrance where the walk goes through one. */
  readonly from: StreetPoint;
  readonly to: StreetPoint;
  /** The engine's stops at its ends, -1 for the traveller's own place. */
  readonly fromStop: number;
  readonly toStop: number;
}

/** An itinerary as the engine found it, with the walks the streets can check. */
export interface EngineItinerary extends RoutedItinerary {
  readonly walks: readonly WalkRef[];
}

/** A walk estimated from the straight line (`walking.ts`), until the streets say otherwise. */
export function estimatedWalk(profile: WalkProfile): RoutedWalk {
  return { basis: 'estimated', profile, metres: null, unchecked: 'not-asked' };
}

/** A change whose time is a `transfers.txt` rule's: inside a station, with no street path. */
export function stationRuleWalk(profile: WalkProfile): RoutedWalk {
  return { basis: 'station-rule', profile, metres: null, unchecked: null };
}

/** A walk leg with no path: its way is only drawn once the streets give one. */
export function walkLeg(
  ends: { readonly from: Place; readonly to: Place },
  departAt: Date,
  seconds: number,
  walk: RoutedWalk,
): RoutedLeg {
  return {
    mode: 'walk',
    from: ends.from,
    to: ends.to,
    departAt,
    arriveAt: new Date(departAt.getTime() + seconds * 1000),
    route: null,
    tripId: null,
    scheduled: true,
    path: [],
    walk,
  };
}

export function pointOf(place: Place): StreetPoint {
  return { lat: place.lat, lon: place.lon };
}

/** The time of a walk the streets have no way for: past every limit, its change is dropped. */
export const NO_STREET_WAY = Number.POSITIVE_INFINITY;

/**
 * Street times already known for this plan, in seconds, so a search again uses them in place of
 * the estimates: walks from the origin and to the destination by stop, changes by
 * `from * stops + to`, and the walk door to door. A walk with no way is `NO_STREET_WAY`.
 */
export interface KnownWalks {
  readonly access: ReadonlyMap<number, number>;
  readonly egress: ReadonlyMap<number, number>;
  readonly transfers: ReadonlyMap<number, number>;
  readonly direct: number | undefined;
}
