import type { Leg, Provenance, TravelMode } from '@moviq/contracts';

import type { LiveReading, PredictedTrip, ServiceAlert } from './watch-assess.js';

/** How far a live trip may be from the planned one and still be taken as the same train or bus. */
const MATCH_WINDOW_MS = 20 * 60_000;

/**
 * The live trip of the leg's route that stops where the leg ends, nearest to the planned time.
 * Before the ride starts, the trip must also stop where it begins, near the planned departure
 * and before the end: a train running only on another part of the line is not this ride.
 */
export function findTrip(
  leg: Leg,
  readings: readonly LiveReading<{ readonly trips: readonly PredictedTrip[] }>[],
  now: Date,
): { arrival: number; provenance: Provenance } | undefined {
  const routeId = leg.route?.id;
  const alight = leg.to.stopId;
  if (routeId === undefined || alight === null) return undefined;
  const planned = Date.parse(leg.arriveAt);
  const boarding = Date.parse(leg.departAt) > now.getTime() ? leg.from.stopId : undefined;
  if (boarding === null) return undefined;
  let best: { arrival: number; provenance: Provenance; distance: number } | undefined;
  for (const reading of readings) {
    for (const trip of reading.data?.trips ?? []) {
      if (baseRoute(trip.routeId) !== baseRoute(routeId)) continue;
      const end = trip.stops.findIndex((candidate) => sameStop(candidate.stopId, alight));
      if (end < 0 || (boarding !== undefined && !boardsNear(trip, boarding, end, leg))) continue;
      const stop = trip.stops[end];
      const time = stop?.arrival ?? stop?.departure;
      if (time === undefined || time === null) continue;
      const arrival = Date.parse(time);
      const distance = Math.abs(arrival - planned);
      if (distance <= MATCH_WINDOW_MS && (best === undefined || distance < best.distance)) {
        best = { arrival, provenance: reading.provenance, distance };
      }
    }
  }
  return best;
}

/** The trip stops at the boarding stop before the leg's end, close to the planned departure. */
function boardsNear(trip: PredictedTrip, boarding: string, end: number, leg: Leg): boolean {
  const start = trip.stops.findIndex((candidate) => sameStop(candidate.stopId, boarding));
  const stop = trip.stops[start];
  const time = stop?.departure ?? stop?.arrival;
  if (start < 0 || start >= end || time === undefined || time === null) return false;
  return Math.abs(Date.parse(time) - Date.parse(leg.departAt)) <= MATCH_WINDOW_MS;
}

/** The MTA agencies of GTFS-rt alerts that run each mode. */
const AGENCIES: Partial<Readonly<Record<TravelMode, ReadonlySet<string>>>> = {
  subway: new Set(['MTASBWY']),
  bus: new Set(['MTA NYCT', 'MTABC']),
  rail: new Set(['MNR', 'LI']),
};

/** Whether an alert names the leg's route, run by the agency of the leg's mode. */
export function alertApplies(alert: ServiceAlert, leg: Leg): boolean {
  if (leg.route === null) return false;
  const routeId = baseRoute(leg.route.id);
  const agencies = AGENCIES[leg.mode];
  return alert.affected.some(
    (affected) =>
      affected.routeId !== null &&
      baseRoute(affected.routeId) === routeId &&
      (affected.agencyId === null || agencies === undefined || agencies.has(affected.agencyId)),
  );
}

/** Ids may come with a feed prefix (`MTA NYCT_M60`, `mta:A27`); the operator's own id is the last part. */
function baseRoute(id: string): string {
  return id.split(/[_:]/).at(-1)?.toUpperCase() ?? id;
}

const DIRECTED_STOP = /^[A-Z0-9]{3}[NS]$/;

/**
 * Subway platforms carry their direction (`A27N`, `A27S`): a planned platform matches only
 * itself, so a train the other way never stands for this one. A plan naming the station without
 * a direction (`A27`) matches either platform. Feed prefixes (`MTA_`, `mta:`) are ignored.
 */
function sameStop(live: string, planned: string): boolean {
  const a = live.split(/[_:]/).at(-1) ?? live;
  const b = planned.split(/[_:]/).at(-1) ?? planned;
  if (a === b) return true;
  return !DIRECTED_STOP.test(b) && DIRECTED_STOP.test(a) && a.slice(0, -1) === b;
}
