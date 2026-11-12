import { placeSchema, type Place } from '@moviq/contracts';

import type { RoutedLeg } from '../ports.js';
import type { Footpaths } from './footpaths.js';
import { NONE } from './live.js';
import type { Network } from './network.js';
import type { FrontEntry, Labels, SearchRequest } from './labels.js';
import { ridePath } from './ride-shapes.js';
import type { StreetPoint, WalkProfile } from './street-walks.js';
import {
  estimatedWalk,
  pointOf,
  stationRuleWalk,
  walkLeg,
  type EngineItinerary,
  type WalkRef,
} from './walk-legs.js';

/** The ends of the search: the traveller's own places and the walks to and from stops. */
export interface Ends {
  readonly from: Place;
  readonly to: Place;
  readonly accessSeconds: ReadonlyMap<number, number>;
  readonly egressSeconds: ReadonlyMap<number, number>;
  /** The step-free entrance a walk to or from a stop goes through, where it uses one. */
  readonly accessPoints: ReadonlyMap<number, StreetPoint>;
  readonly egressPoints: ReadonlyMap<number, StreetPoint>;
  readonly profile: WalkProfile;
}

function stopPlace(network: Network, stop: number): Place | undefined {
  const parsed = placeSchema.safeParse({
    label: network.stops.names[stop],
    lat: network.stops.lat[stop],
    lon: network.stops.lon[stop],
    kind: 'stop',
    stopId: network.stops.ids[stop],
  });
  return parsed.success ? parsed.data : undefined;
}

/** Whether the change from `from` to board at `to` takes the time of a `transfers.txt` rule. */
function ruledChange(footpaths: Footpaths, from: number, to: number): boolean {
  for (let at = footpaths.start[to] ?? 0; at < (footpaths.start[to + 1] ?? 0); at += 1) {
    if (footpaths.from[at] === from) return footpaths.ruled[at] === 1;
  }
  return false;
}

interface Ride {
  readonly trip: number;
  readonly times: (position: number) => readonly [number, number];
  readonly live: boolean;
}

function rideOf(request: SearchRequest, code: number): Ride | undefined {
  const { network, calendar, overlay } = request;
  if (code < 0) {
    const live = overlay.instances[-code - 1];
    if (live === undefined) return undefined;
    const times = (position: number): readonly [number, number] => [
      live.times[2 * position] ?? NONE,
      live.times[2 * position + 1] ?? NONE,
    ];
    return { trip: live.trip, times, live: true };
  }
  const tripCount = network.trips.ids.length;
  const trip = code % tripCount;
  const offset = calendar.days[(code - trip) / tripCount]?.offset ?? 0;
  const start = network.trips.timesStart[trip] ?? 0;
  const times = (position: number): readonly [number, number] => [
    offset + (network.trips.times[start + 2 * position] ?? 0),
    offset + (network.trips.times[start + 2 * position + 1] ?? 0),
  ];
  return { trip, times, live: false };
}

type Point = readonly [number, number];

/**
 * The way of a ride: along its trip's shape from the stop it boards at to the one it leaves at,
 * or through the stops it calls at when the timetable gives no shape that fits them.
 */
function wayOf(network: Network, trip: number, calls: Int32Array, boardAt: number): Point[] {
  const points = Array.from(calls, (stop): Point => [
    network.stops.lon[stop] ?? 0,
    network.stops.lat[stop] ?? 0,
  ]);
  return ridePath(network.shapes, trip, points, boardAt) ?? points.slice(boardAt);
}

/** The ride from `boardAt` to `alightAt`, its path along the trip's way. */
function rideLeg(
  request: SearchRequest,
  code: number,
  boardAt: number,
  alightAt: number,
): { readonly leg: RoutedLeg; readonly alighted: number } | undefined {
  const { network, calendar } = request;
  const ride = rideOf(request, code);
  if (ride === undefined || boardAt < 0 || alightAt <= boardAt) return undefined;
  const pattern = network.trips.pattern[ride.trip] ?? 0;
  const first = network.patterns.stopsStart[pattern] ?? 0;
  const calls = network.patterns.stops.subarray(first, first + alightAt + 1);
  const stops = Array.from(calls.subarray(boardAt));
  const from = stopPlace(network, stops[0] ?? 0);
  const to = stopPlace(network, stops.at(-1) ?? 0);
  const route = network.patterns.route[pattern] ?? 0;
  const mode = network.routes.modes[route];
  if (from === undefined || to === undefined || mode === undefined) return undefined;
  const toDate = (seconds: number): Date => new Date(calendar.epochMs + seconds * 1000);
  const leg: RoutedLeg = {
    mode,
    from,
    to,
    departAt: toDate(ride.times(boardAt)[1]),
    arriveAt: toDate(ride.times(alightAt)[0]),
    route: {
      id: network.routes.ids[route] ?? '',
      shortName: network.routes.names[route] ?? '',
      headsign: network.trips.headsigns[ride.trip] ?? null,
    },
    tripId: network.trips.ids[ride.trip] ?? null,
    scheduled: !ride.live,
    path: wayOf(network, ride.trip, calls, boardAt),
  };
  return { leg, alighted: stops.at(-1) ?? 0 };
}

function label(list: readonly Int32Array[], k: number, stop: number): number {
  return list[k]?.[stop] ?? -1;
}

/** The legs and walks of an itinerary as it is built, from the origin on. */
class Built {
  readonly legs: RoutedLeg[] = [];
  readonly walks: WalkRef[] = [];

  /** A walk to ask the streets about, between the points given and the stops at its ends. */
  walk(leg: RoutedLeg, ref: Omit<WalkRef, 'leg'>): void {
    this.walks.push({ ...ref, leg: this.legs.length });
    this.legs.push(leg);
  }
}

/** The change between two stops after a ride: a station rule's time, or a walk to check. */
function addChange(
  built: Built,
  request: SearchRequest,
  change: {
    readonly ride: RoutedLeg;
    readonly from: number;
    readonly to: number;
    readonly seconds: number;
  },
  profile: WalkProfile,
): boolean {
  const place = stopPlace(request.network, change.to);
  if (place === undefined) return false;
  const ends = { from: change.ride.to, to: place };
  if (ruledChange(request.footpaths, change.from, change.to)) {
    built.legs.push(walkLeg(ends, change.ride.arriveAt, change.seconds, stationRuleWalk(profile)));
    return true;
  }
  const leg = walkLeg(ends, change.ride.arriveAt, change.seconds, estimatedWalk(profile));
  const points = { from: pointOf(ends.from), to: pointOf(place) };
  built.walk(leg, { role: 'transfer', ...points, fromStop: change.from, toStop: change.to });
  return true;
}

/** The itinerary of one front entry, following the labels from the origin to the destination. */
export function reconstruct(
  request: SearchRequest,
  labels: Labels,
  entry: FrontEntry,
  ends: Ends,
): EngineItinerary | undefined {
  const { network, calendar } = request;
  const built = new Built();
  const toDate = (seconds: number): Date => new Date(calendar.epochMs + seconds * 1000);
  let stop = entry.accessStop;
  const access = ends.accessSeconds.get(stop) ?? 0;
  const firstStop = stopPlace(network, stop);
  if (firstStop === undefined) return undefined;
  if (access > 0) {
    const leg = walkLeg(
      { from: ends.from, to: firstStop },
      toDate(entry.departure),
      access,
      estimatedWalk(ends.profile),
    );
    const to = ends.accessPoints.get(stop) ?? pointOf(firstStop);
    built.walk(leg, { role: 'access', from: pointOf(ends.from), to, fromStop: -1, toStop: stop });
  }
  for (let k = entry.rides; k >= 1; k -= 1) {
    const ride = rideLeg(
      request,
      label(labels.ride, k, stop),
      label(labels.boardAt, k, stop),
      label(labels.alightAt, k, stop),
    );
    if (ride === undefined) return undefined;
    const { leg, alighted } = ride;
    built.legs.push(leg);
    if (k === 1) {
      const egress = ends.egressSeconds.get(alighted) ?? 0;
      if (egress > 0) {
        const walk = walkLeg(
          { from: leg.to, to: ends.to },
          leg.arriveAt,
          egress,
          estimatedWalk(ends.profile),
        );
        const from = ends.egressPoints.get(alighted) ?? pointOf(leg.to);
        built.walk(walk, {
          role: 'egress',
          from,
          to: pointOf(ends.to),
          fromStop: alighted,
          toStop: -1,
        });
      }
      break;
    }
    const next = label(labels.transferTo, k - 1, alighted);
    if (next < 0) return undefined;
    const seconds = label(labels.transferSeconds, k - 1, alighted);
    const change = { ride: leg, from: alighted, to: next, seconds };
    if (next !== alighted && !addChange(built, request, change, ends.profile)) return undefined;
    stop = next;
  }
  return { legs: built.legs, walks: built.walks };
}
