import type {
  BoardDirection,
  BoardFlight,
  Movement,
  MovementPhase,
  Provenance,
  ScheduledFlight,
  UnmatchedReason,
} from '@moviq/contracts';

import type { Airport } from './airports.js';
import { airlineCodes, callSignOfFlight, flightOfCallSign } from './call-signs.js';
import {
  airportByGeometry,
  estimateOf,
  phaseByGeometry,
  phaseOfFlight,
  sight,
  type Aircraft,
  type Sighting,
} from './movements.js';

type Side = 'departure' | 'arrival';
type Unmatched = Movement & { readonly reason: UnmatchedReason };

const HOUR_MS = 60 * 60_000;
/**
 * How far from its time here a flight may be and still be the aircraft seen: a departure's call
 * sign is set at the gate up to 3 hours before and leaves the area within the hour; an arrival
 * enters it under an hour before landing, late or early by up to 2, and keeps its call sign on
 * the ground for up to 3 after.
 */
const WINDOW_MS: Readonly<Record<Side, { readonly before: number; readonly after: number }>> = {
  departure: { before: 3 * HOUR_MS, after: HOUR_MS },
  arrival: { before: 2 * HOUR_MS, after: 3 * HOUR_MS },
};

/** ADS-B now: the fresh positions, their source, and the usual route of each call sign. */
export interface LiveTraffic {
  readonly aircraft: readonly Aircraft[];
  readonly positions: Provenance;
  readonly routes: Readonly<Record<string, readonly string[]>>;
  readonly routesSourceId: string;
}

interface MatchInput {
  readonly airport: Airport;
  readonly direction: BoardDirection;
  /** Both directions of the board: an aircraft of either one is not unmatched. Null without one. */
  readonly board: {
    readonly departures: readonly ScheduledFlight[];
    readonly arrivals: readonly ScheduledFlight[];
  } | null;
  readonly traffic: LiveTraffic;
  readonly now: Date;
}

interface Candidate {
  readonly flight: ScheduledFlight;
  readonly side: Side;
}

/**
 * Crosses the board with ADS-B by call sign and time: each aircraft flying a flight of the board
 * is shown on it; the others moving at the airport are listed with why they match none.
 */
export function matchBoard(input: MatchInput): {
  readonly flights: BoardFlight[];
  readonly unmatched: Unmatched[];
} {
  const { airport, board, traffic, now } = input;
  const candidates: Candidate[] = [
    ...(board?.departures ?? []).map((flight): Candidate => ({ flight, side: 'departure' })),
    ...(board?.arrivals ?? []).map((flight): Candidate => ({ flight, side: 'arrival' })),
  ];
  const byCallSign = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = callSignOfFlight(candidate.flight);
    if (key !== null) byCallSign.set(key, [...(byCallSign.get(key) ?? []), candidate]);
  }
  const airlines = airlineCodes(candidates.map((candidate) => candidate.flight));
  const live = new Map<string, Movement>();
  const unmatched: Unmatched[] = [];
  for (const aircraft of traffic.aircraft) {
    const callSign = aircraft.callsign?.trim().toUpperCase() ?? null;
    const named = callSign === null ? [] : (byCallSign.get(callSign) ?? []);
    const found = flightSeen(aircraft, named, airport, now);
    if (found !== undefined) {
      const movement = movementOf(found.sighting, found.phase, found.candidate, input);
      const shown = live.get(found.candidate.flight.id);
      if (shown === undefined || movement.distanceNm < shown.distanceNm) {
        live.set(found.candidate.flight.id, movement);
      }
      continue;
    }
    const placed = airportByGeometry(aircraft);
    const phase = placed === undefined ? undefined : phaseByGeometry(placed);
    if (placed?.airport.code !== airport.code || phase === undefined) continue;
    if (!shownOn(input.direction, phase)) continue;
    const flight = callSign === null ? null : flightOfCallSign(callSign, airlines);
    const movement = movementOf(placed, phase, null, input);
    unmatched.push({
      ...movement,
      flight,
      reason: reasonOf(board !== null, callSign, named, flight),
    });
  }
  const listed = input.direction === 'departures' ? board?.departures : board?.arrivals;
  return {
    flights: (listed ?? []).map((flight) => ({ ...flight, live: live.get(flight.id) ?? null })),
    unmatched,
  };
}

/** The flight of the board this aircraft flies: same call sign, a time close to now, its way. */
function flightSeen(aircraft: Aircraft, named: readonly Candidate[], airport: Airport, now: Date) {
  const sighting = sight(aircraft, airport);
  return named
    .filter((candidate) => {
      const gap = now.getTime() - timeHere(candidate.flight);
      const window = WINDOW_MS[candidate.side];
      return gap >= -window.before && gap <= window.after;
    })
    .map((candidate) => ({ candidate, sighting, phase: phaseOfFlight(sighting, candidate.side) }))
    .filter((found): found is typeof found & { phase: MovementPhase } => found.phase !== undefined)
    .sort(
      (a, b) =>
        Math.abs(timeHere(a.candidate.flight) - now.getTime()) -
        Math.abs(timeHere(b.candidate.flight) - now.getTime()),
    )[0];
}

/** The runway time first, then the revised one, then the timetable. */
function timeHere(flight: ScheduledFlight): number {
  return Date.parse(flight.runway?.at ?? flight.revisedAt ?? flight.scheduledAt);
}

/** A departures board lists no aircraft landing, an arrivals board none climbing away. */
function shownOn(direction: BoardDirection, phase: MovementPhase): boolean {
  return direction === 'departures' ? phase !== 'approaching' : phase !== 'departed';
}

function reasonOf(
  hasBoard: boolean,
  callSign: string | null,
  named: readonly Candidate[],
  flight: string | null,
): UnmatchedReason {
  if (!hasBoard) return 'no-board';
  if (callSign === null) return 'no-call-sign';
  if (named.length > 0) return 'off-schedule';
  return flight === null ? 'not-a-flight' : 'not-on-board';
}

function movementOf(
  sighting: Sighting,
  phase: MovementPhase,
  candidate: Candidate | null,
  input: MatchInput,
): Movement {
  const { aircraft, distanceNm } = sighting;
  const callSign = aircraft.callsign?.trim().toUpperCase() ?? null;
  const ageMs = input.now.getTime() - Date.parse(aircraft.observedAt);
  return {
    hex: aircraft.hex.toLowerCase(),
    callSign,
    flight: candidate?.flight.number ?? null,
    phase,
    distanceNm: Math.round(distanceNm * 10) / 10,
    altitudeFeet: aircraft.onGround ? null : aircraft.altitudeFeet,
    groundSpeedKnots: aircraft.groundSpeedKnots,
    estimate: estimateOf(sighting, phase),
    usualRoute: usualRouteOf(callSign, candidate?.side ?? sideOf(phase), input),
    provenance: {
      ...input.traffic.positions,
      dataTime: aircraft.observedAt,
      ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
    },
  };
}

function sideOf(phase: MovementPhase): Side | null {
  if (phase === 'approaching') return 'arrival';
  return phase === 'departed' ? 'departure' : null;
}

/** The airport before (an arrival) or after (a departure) this one in the usual route. */
function usualRouteOf(
  callSign: string | null,
  side: Side | null,
  input: MatchInput,
): Movement['usualRoute'] {
  const route = callSign === null ? undefined : input.traffic.routes[callSign];
  if (route === undefined) return null;
  const here = route.indexOf(input.airport.icao);
  const last = route.length - 1;
  const step = side === 'arrival' ? -1 : side === 'departure' ? 1 : here === 0 ? 1 : -1;
  const ends = side !== null || here === 0 || here === last;
  return {
    airports: [...route],
    otherEnd: here < 0 || !ends ? null : (route[here + step] ?? null),
    sourceId: input.traffic.routesSourceId,
  };
}
