import type { Place } from '@moviq/contracts';

import type { RoutedItinerary, RouteQuery } from '../ports.js';
import { ENTRANCE_REACH_M, entranceWalk, listsEntrances } from './entrances.js';
import { feedKey } from './feed-key.js';
import { withChangeTimes } from './footpaths.js';
import { nearbyStops } from './grid.js';
import type { LiveOverlay } from './live.js';
import type { Network } from './network.js';
import type { SearchRequest, StopWalk } from './labels.js';
import { runRaptor } from './raptor.js';
import { reconstruct, type Ends } from './reconstruct.js';
import type { SearchCalendar } from './service-days.js';
import type { StreetPoint } from './street-walks.js';
import { estimatedWalk, pointOf, type EngineItinerary, type KnownWalks } from './walk-legs.js';
import { distanceMetres, reachMetres, walkSeconds } from './walking.js';

interface PlanInput {
  readonly network: Network;
  readonly calendar: SearchCalendar;
  readonly overlay: LiveOverlay;
  readonly query: RouteQuery;
  readonly now: Date;
  readonly maxTransfers: number;
}

interface StopsAround {
  readonly walks: StopWalk[];
  /** The step-free entrance each walk goes through, where it uses one. */
  readonly points: Map<number, StreetPoint>;
}

interface StepFreeUse {
  readonly allowed: Uint8Array;
  readonly use: 'entry' | 'exit';
}

/**
 * Stops within the walk limit of a place, plus the stop or station it names, by stop order. A
 * step-free walk goes through a step-free entrance (`entry` to board, `exit` at the end) where
 * the survey lists one for the station, and to the station's point where it lists none. A street
 * time already known for a stop stands for its estimate.
 */
function stopsAround(
  network: Network,
  place: Place,
  limit: { readonly maxSeconds: number; readonly known: ReadonlyMap<number, number> },
  stepFree: StepFreeUse | null,
): StopsAround {
  const seconds = new Map<number, number>();
  const points = new Map<number, StreetPoint>();
  const radius = reachMetres(limit.maxSeconds) + (stepFree === null ? 0 : ENTRANCE_REACH_M);
  for (const near of nearbyStops(network.grid, network.stops, place, radius)) {
    const listed =
      stepFree !== null && listsEntrances(network.entrances, near.stop) ? stepFree : null;
    const through =
      listed === null ? undefined : entranceWalk(network.entrances, near.stop, place, listed.use);
    if (through !== undefined) points.set(near.stop, { lat: through.lat, lon: through.lon });
    const estimate = listed === null ? walkSeconds(near.metres) : through?.seconds;
    const walk = estimate === undefined ? undefined : (limit.known.get(near.stop) ?? estimate);
    if (walk !== undefined && walk <= limit.maxSeconds) seconds.set(near.stop, walk);
  }
  if (place.stopId !== null) {
    for (const feed of network.feeds.keys()) {
      for (const stop of network.named.get(feedKey(feed, place.stopId)) ?? []) seconds.set(stop, 0);
    }
  }
  const walks = [...seconds]
    .filter(([stop]) => stepFree === null || stepFree.allowed[stop] === 1)
    .map(([stop, walk]) => ({ stop, seconds: walk }))
    .sort((a, b) => a.stop - b.stop);
  return { walks, points };
}

function patternsFor(network: Network, query: RouteQuery): Uint8Array {
  return Uint8Array.from(network.patterns.route, (route) => {
    const mode = network.routes.modes[route];
    return mode !== undefined && query.modes.includes(mode) ? 1 : 0;
  });
}

/** A trip on foot only, estimated or at the street time already known, and its walk to check. */
function directWalk(
  query: RouteQuery,
  now: Date,
  known: number | undefined,
): EngineItinerary | undefined {
  if (!query.modes.includes('walk')) return undefined;
  const { from, to } = query;
  const seconds = known ?? walkSeconds(distanceMetres(from.lat, from.lon, to.lat, to.lon));
  const departAt = new Date(query.arriveBy.getTime() - seconds * 1000);
  if (seconds > query.maxWalkMinutes * 60 || departAt < now) return undefined;
  const leg = {
    mode: 'walk' as const,
    from,
    to,
    departAt,
    arriveAt: query.arriveBy,
    route: null,
    tripId: null,
    scheduled: true,
    path: [],
    walk: estimatedWalk(query.stepFree ? 'wheelchair' : 'foot'),
  };
  const ref = { leg: 0, role: 'direct' as const, from: pointOf(from), to: pointOf(to) };
  return { legs: [leg], walks: [{ ...ref, fromStop: -1, toStop: -1 }] };
}

/** A stable identity: modes, trips, stops and times of every leg. */
function signature(itinerary: RoutedItinerary): string {
  return itinerary.legs
    .map(
      (leg) =>
        `${leg.mode}:${leg.tripId ?? ''}:${leg.from.stopId ?? ''}>${leg.to.stopId ?? ''}` +
        `@${String(leg.departAt.getTime())}-${String(leg.arriveAt.getTime())}`,
    )
    .join('|');
}

function rides(itinerary: RoutedItinerary): number {
  return itinerary.legs.filter((leg) => leg.mode !== 'walk').length;
}

function departure(itinerary: RoutedItinerary): number {
  return itinerary.legs[0]?.departAt.getTime() ?? 0;
}

function arrival(itinerary: RoutedItinerary): number {
  return itinerary.legs.at(-1)?.arriveAt.getTime() ?? 0;
}

/** Latest departure first, then fewer rides, earlier arrival and the signature. */
function compareItineraries(a: RoutedItinerary, b: RoutedItinerary): number {
  return (
    departure(b) - departure(a) ||
    rides(a) - rides(b) ||
    arrival(a) - arrival(b) ||
    (signature(a) < signature(b) ? -1 : signature(a) > signature(b) ? 1 : 0)
  );
}

/** Each itinerary once, in the engine's stable order, at most `count`. */
export function rankItineraries<T extends RoutedItinerary>(
  itineraries: readonly T[],
  count: number,
): T[] {
  const found = new Map<string, T>();
  for (const itinerary of itineraries) found.set(signature(itinerary), itinerary);
  return [...found.values()].sort(compareItineraries).slice(0, Math.max(0, count));
}

function searchRequest(
  input: PlanInput,
  ends: { access: StopWalk[]; egress: StopWalk[] },
  allowed: Uint8Array | null,
  known: KnownWalks | undefined,
): SearchRequest {
  const { network, calendar, overlay, query, now } = input;
  const footpaths = query.stepFree ? network.stepFreeFootpaths : network.footpaths;
  return {
    network,
    calendar,
    overlay,
    patterns: patternsFor(network, query),
    stops: allowed,
    footpaths: known === undefined ? footpaths : withChangeTimes(footpaths, known.transfers),
    access: ends.access,
    egress: ends.egress,
    deadline: Math.floor((query.arriveBy.getTime() - calendar.epochMs) / 1000),
    earliest: Math.ceil((now.getTime() - calendar.epochMs) / 1000),
    maxRides: input.maxTransfers + 1,
  };
}

const NOTHING_KNOWN: KnownWalks = {
  access: new Map(),
  egress: new Map(),
  transfers: new Map(),
  direct: undefined,
};

/** The walks to and from stops at both ends of the trip. */
function endsOf(
  input: PlanInput,
  known: KnownWalks,
): { ends: Ends; access: StopWalk[]; egress: StopWalk[] } {
  const { network, query } = input;
  const allowed = query.stepFree ? network.stops.accessible : null;
  const maxSeconds = query.maxWalkMinutes * 60;
  const through = (use: 'entry' | 'exit') => (allowed === null ? null : { allowed, use });
  const access = stopsAround(
    network,
    query.from,
    { maxSeconds, known: known.access },
    through('entry'),
  );
  const egress = stopsAround(
    network,
    query.to,
    { maxSeconds, known: known.egress },
    through('exit'),
  );
  const ends: Ends = {
    from: query.from,
    to: query.to,
    accessSeconds: new Map(access.walks.map((walk) => [walk.stop, walk.seconds])),
    egressSeconds: new Map(egress.walks.map((walk) => [walk.stop, walk.seconds])),
    accessPoints: access.points,
    egressPoints: egress.points,
    profile: query.stepFree ? 'wheelchair' : 'foot',
  };
  return { ends, access: access.walks, egress: egress.walks };
}

/**
 * Up to `query.count` itineraries: each pass takes the Pareto front of departure time and rides
 * arriving by the deadline, then moves the deadline to one second before the earliest arrival
 * found, so the next pass finds other journeys that leave earlier. Street times already `known`
 * stand for the estimates of the walks they measured.
 */
export function planItineraries(
  input: PlanInput,
  known: KnownWalks = NOTHING_KNOWN,
): EngineItinerary[] {
  const { network, query } = input;
  const allowed = query.stepFree ? network.stops.accessible : null;
  const { ends, access, egress } = endsOf(input, known);
  const found: EngineItinerary[] = [];
  const walk = directWalk(query, input.now, known.direct);
  if (walk !== undefined) found.push(walk);
  let request = searchRequest(input, { access, egress }, allowed, known);
  for (let pass = 0; pass < query.count && access.length > 0 && egress.length > 0; pass += 1) {
    const { labels, front } = runRaptor(request);
    const itineraries = front.flatMap((entry) => reconstruct(request, labels, entry, ends) ?? []);
    if (itineraries.length === 0) break;
    found.push(...itineraries);
    const earliestArrival = Math.min(...itineraries.map(arrival));
    request = {
      ...request,
      deadline: Math.floor((earliestArrival - input.calendar.epochMs) / 1000) - 1,
    };
  }
  return rankItineraries(found, query.count);
}
