import { toInstant, type MovementPhase } from '@moviq/contracts';

import type { AirTraffic } from '../data-platform/sources/air/aircraft.js';
import { bearingDegrees, distanceMeters } from '../live/geo.js';
import { AIRPORTS, AIRPORT_CODES, type Airport } from './airports.js';

export type Aircraft = AirTraffic['aircraft'][number];

const METERS_PER_NM = 1852;
/** An aircraft on the ground this close to the reference point is at the airport. */
const ON_AIRPORT_NM = 3;
/** Rolling faster than a pushback, and as fast as a take-off or landing run. */
const TAXI_KNOTS = 5;
const RUNWAY_KNOTS = 40;
/** Approaches and climbs out of New York stay under this altitude within the area. */
const CEILING_FEET = 12_000;
/** A 3° glide path loses about 320 ft per NM; 350 and 1,000 more leave room for a level-off. */
const APPROACH_FEET = { base: 1_000, perNm: 350 } as const;
/** Climbing out at 700 to 800 ft per NM; beyond 12 NM the take-off is too far back to tell. */
const CLIMB = { base: 1_500, perNm: 800, withinNm: 12 } as const;
/** Inbound: the track points at the airport within 45°; outbound: away from it within 60°. */
const INBOUND_DEGREES = 45;
const OUTBOUND_DEGREES = 60;
/** Below this ground speed a time worked out from the distance means nothing. */
const ESTIMATE_KNOTS = 60;

/** An aircraft placed against one airport. */
export interface Sighting {
  readonly aircraft: Aircraft;
  readonly airport: Airport;
  readonly distanceNm: number;
  readonly inbound: boolean;
  readonly outbound: boolean;
}

export function sight(aircraft: Aircraft, airport: Airport): Sighting {
  const at = { lat: aircraft.latitude, lon: aircraft.longitude };
  const track = aircraft.trackDegrees;
  const toward = bearingDegrees(at, airport);
  const away = bearingDegrees(airport, at);
  return {
    aircraft,
    airport,
    distanceNm: distanceMeters(at, airport) / METERS_PER_NM,
    inbound: track !== null && angle(track, toward) <= INBOUND_DEGREES,
    outbound: track !== null && angle(track, away) <= OUTBOUND_DEGREES,
  };
}

function angle(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function groundPhase(aircraft: Aircraft): MovementPhase {
  const speed = aircraft.groundSpeedKnots ?? 0;
  if (speed >= RUNWAY_KNOTS) return 'on-runway';
  return speed >= TAXI_KNOTS ? 'taxiing' : 'on-ground';
}

/** What position, track and altitude alone say the aircraft is doing at this airport. */
export function phaseByGeometry(sighting: Sighting): MovementPhase | undefined {
  const { aircraft, distanceNm: d } = sighting;
  if (aircraft.onGround) return d <= ON_AIRPORT_NM ? groundPhase(aircraft) : undefined;
  const feet = aircraft.altitudeFeet;
  if (feet === null || feet > CEILING_FEET) return undefined;
  if (sighting.inbound && feet <= APPROACH_FEET.base + APPROACH_FEET.perNm * d)
    return 'approaching';
  if (sighting.outbound && d <= CLIMB.withinNm && feet <= CLIMB.base + CLIMB.perNm * d) {
    return 'departed';
  }
  return undefined;
}

/**
 * The phase of an aircraft flying a flight of this airport's board: on the ground at the airport,
 * or in the air going the board's way (an arrival not heading away, a departure not heading in).
 */
export function phaseOfFlight(
  sighting: Sighting,
  side: 'departure' | 'arrival',
): MovementPhase | undefined {
  const { aircraft, distanceNm } = sighting;
  if (aircraft.onGround) return distanceNm <= ON_AIRPORT_NM ? groundPhase(aircraft) : undefined;
  const close = distanceNm <= ON_AIRPORT_NM;
  if (side === 'arrival') return !sighting.outbound || close ? 'approaching' : undefined;
  return !sighting.inbound || close ? 'departed' : undefined;
}

/** The airport an aircraft is moving at by geometry alone: the nearest one that explains it. */
export function airportByGeometry(aircraft: Aircraft): Sighting | undefined {
  return AIRPORT_CODES.map((code) => sight(aircraft, AIRPORTS[code]))
    .filter((sighting) => phaseByGeometry(sighting) !== undefined)
    .sort((a, b) => a.distanceNm - b.distanceNm)[0];
}

/** Landing or take-off worked out from the distance and the ground speed, when they mean it. */
export function estimateOf(
  sighting: Sighting,
  phase: MovementPhase,
): { readonly at: string; readonly kind: 'landing' | 'take-off' } | null {
  const { aircraft, distanceNm } = sighting;
  const speed = aircraft.groundSpeedKnots ?? 0;
  if (aircraft.onGround || speed < ESTIMATE_KNOTS) return null;
  const flownMs = Math.round((distanceNm / speed) * 3_600) * 1000;
  const seenAt = Date.parse(aircraft.observedAt);
  if (phase === 'approaching' && sighting.inbound) {
    return { at: toInstant(new Date(seenAt + flownMs)), kind: 'landing' };
  }
  if (phase === 'departed' && sighting.outbound && distanceNm <= CLIMB.withinNm) {
    return { at: toInstant(new Date(seenAt - flownMs)), kind: 'take-off' };
  }
  return null;
}
