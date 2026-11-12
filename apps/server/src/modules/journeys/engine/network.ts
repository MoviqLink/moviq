import type { Provenance, TravelMode } from '@moviq/contracts';

import type { GtfsService } from '../../data-platform/sources/mta/gtfs-static-schema.js';
import { compileEntrances, type StopEntrances } from './entrances.js';
import { buildFootpaths, buildStepFreeFootpaths, type Footpaths } from './footpaths.js';
import { buildGrid, insideArea, type StopGrid } from './grid.js';
import type { TimetableInput } from './inputs.js';
import {
  buildPatterns,
  indexStopPatterns,
  type PatternTable,
  type StopPatterns,
  type TripTable,
} from './patterns.js';
import { compileShapes, type RideShapes } from './ride-shapes.js';
import { draftTrips } from './trip-drafts.js';
import { feedKey } from './feed-key.js';

/** One timetable compiled into the network, with what it was compiled from. */
interface CompiledFeed {
  readonly sourceId: string;
  readonly version: string;
  readonly provenance: Provenance;
}

interface StopTable {
  readonly count: number;
  /** GTFS ids; the same id in two feeds is two stops, joined by a footpath. */
  readonly ids: readonly string[];
  readonly names: readonly string[];
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly feed: Uint8Array;
  /** 1 when GTFS `wheelchair_boarding` says the stop, or its station, is accessible. */
  readonly accessible: Uint8Array;
}

/** The compact network RAPTOR runs on, built once per set of timetable versions. */
export interface Network {
  readonly key: string;
  readonly feeds: readonly CompiledFeed[];
  readonly stops: StopTable;
  readonly routes: {
    readonly ids: readonly string[];
    readonly names: readonly string[];
    readonly modes: readonly TravelMode[];
  };
  readonly services: readonly GtfsService[];
  readonly patterns: PatternTable;
  readonly trips: TripTable;
  /** The shape each trip follows, so a ride is drawn along its way. */
  readonly shapes: RideShapes;
  readonly stopPatterns: StopPatterns;
  readonly footpaths: Footpaths;
  /** The transfers of a step-free trip: the same stop and rules inside one complex, none on foot. */
  readonly stepFreeFootpaths: Footpaths;
  /** Modes with a stop the timetables mark accessible; a step-free trip rides only these. */
  readonly stepFreeModes: readonly TravelMode[];
  /** Step-free entrances of each stop's station, where step-free walks start and end. */
  readonly entrances: StopEntrances;
  readonly grid: StopGrid;
  /** Stops by feed and GTFS id; a station id gives its platforms. */
  readonly named: ReadonlyMap<string, readonly number[]>;
  /** Trips by feed and GTFS trip id. */
  readonly tripByKey: ReadonlyMap<string, number>;
  /** Timetable entries left out, by reason, for the evidence. */
  readonly leftOut: ReadonlyMap<string, number>;
}

interface FeedToCompile extends CompiledFeed {
  readonly timetable: TimetableInput;
}

/** GTFS `route_type`, basic and extended, as MovIQ modes; other types are not followed. */
function modeOf(routeType: number): TravelMode | undefined {
  if (routeType === 1 || (routeType >= 400 && routeType < 500)) return 'subway';
  if (routeType === 3 || (routeType >= 700 && routeType < 800)) return 'bus';
  if (routeType === 2 || (routeType >= 100 && routeType < 200)) return 'rail';
  if (routeType === 4 || (routeType >= 1000 && routeType < 1100)) return 'ferry';
  return undefined;
}

/** Stops that some trip calls at, inside the planning area, by feed then GTFS id. */
function servedStops(feeds: readonly FeedToCompile[]): {
  readonly table: StopTable;
  readonly index: Map<string, number>;
  readonly outside: number;
} {
  const ids: string[] = [];
  const names: string[] = [];
  const lat: number[] = [];
  const lon: number[] = [];
  const feedOf: number[] = [];
  const accessible: number[] = [];
  const index = new Map<string, number>();
  let outside = 0;
  for (const [feed, { timetable }] of feeds.entries()) {
    const { stops: stopIds, stop: calls } = timetable.stopTimes;
    const served = new Set(Array.from(new Set(calls), (at) => stopIds[at] ?? '').filter(Boolean));
    for (const id of [...served].sort()) {
      const stop = timetable.stops[id];
      if (stop === undefined) continue;
      if (!insideArea(stop.lat, stop.lon)) {
        outside += 1;
        continue;
      }
      const own = timetable.wheelchairBoarding[id];
      const inherited =
        stop.parent === null ? undefined : timetable.wheelchairBoarding[stop.parent];
      index.set(feedKey(feed, id), ids.length);
      ids.push(id);
      names.push(stop.name);
      lat.push(stop.lat);
      lon.push(stop.lon);
      feedOf.push(feed);
      accessible.push((own ?? inherited) === 1 ? 1 : 0);
    }
  }
  const table: StopTable = {
    count: ids.length,
    ids,
    names,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    feed: Uint8Array.from(feedOf),
    accessible: Uint8Array.from(accessible),
  };
  return { table, index, outside };
}

/** Each served stop under its own id and, for a platform, under its station's. */
function namedStops(feeds: readonly FeedToCompile[], stops: StopTable): Map<string, number[]> {
  const named = new Map<string, number[]>();
  const add = (key: string, stop: number): void => {
    const list = named.get(key);
    if (list) list.push(stop);
    else named.set(key, [stop]);
  };
  for (let stop = 0; stop < stops.count; stop += 1) {
    const feed = stops.feed[stop] ?? 0;
    const id = stops.ids[stop] ?? '';
    add(feedKey(feed, id), stop);
    const parent = feeds[feed]?.timetable.stops[id]?.parent ?? null;
    if (parent !== null) add(feedKey(feed, parent), stop);
  }
  return named;
}

function routeTable(feeds: readonly FeedToCompile[]): {
  readonly table: Network['routes'];
  readonly index: Map<string, number>;
} {
  const ids: string[] = [];
  const names: string[] = [];
  const modes: TravelMode[] = [];
  const index = new Map<string, number>();
  for (const [feed, { timetable }] of feeds.entries()) {
    for (const id of Object.keys(timetable.routes).sort()) {
      const route = timetable.routes[id];
      const mode = route === undefined ? undefined : modeOf(route.type);
      if (route === undefined || mode === undefined) continue;
      index.set(feedKey(feed, id), ids.length);
      ids.push(id);
      names.push(route.shortName ?? route.longName ?? id);
      modes.push(mode);
    }
  }
  return { table: { ids, names, modes }, index };
}

function serviceTable(feeds: readonly FeedToCompile[]): {
  readonly list: GtfsService[];
  readonly index: Map<string, number>;
} {
  const list: GtfsService[] = [];
  const index = new Map<string, number>();
  for (const [feed, { timetable }] of feeds.entries()) {
    for (const id of Object.keys(timetable.services).sort()) {
      const service = timetable.services[id];
      if (service === undefined) continue;
      index.set(feedKey(feed, id), list.length);
      list.push(service);
    }
  }
  return { list, index };
}

/** The station a `transfers.txt` id names: itself, or the parent of a platform. */
function stationOf(feed: FeedToCompile | undefined, id: string): string {
  return feed?.timetable.stops[id]?.parent ?? id;
}

/** Whether a rule joins two stations of one complex (or one station) in its feed. */
function sameComplex(
  feeds: readonly FeedToCompile[],
  feed: number,
  from: string,
  to: string,
): boolean {
  const compiled = feeds[feed];
  const [a, b] = [stationOf(compiled, from), stationOf(compiled, to)];
  if (a === b) return true;
  const complex = compiled?.timetable.complexes[a];
  return complex !== undefined && complex === compiled?.timetable.complexes[b];
}

/** The modes of the patterns that call at a stop marked accessible. */
function modesWithAccess(
  patterns: PatternTable,
  routes: Network['routes'],
  accessible: Uint8Array,
): TravelMode[] {
  const modes = new Set<TravelMode>();
  for (let pattern = 0; pattern < patterns.count; pattern += 1) {
    const mode = routes.modes[patterns.route[pattern] ?? 0];
    const first = patterns.stopsStart[pattern] ?? 0;
    const calls = patterns.stops.subarray(first, patterns.stopsStart[pattern + 1] ?? first);
    if (mode !== undefined && calls.some((stop) => accessible[stop] === 1)) modes.add(mode);
  }
  return [...modes].sort();
}

/** The network key: every source with its version, in source order. */
export function networkKey(feeds: readonly CompiledFeed[]): string {
  return feeds.map((feed) => `${feed.sourceId}@${feed.version}`).join(',');
}

/** Compiles timetables into the network. The order of the feeds given does not matter. */
export function compileNetwork(unordered: readonly FeedToCompile[]): Network {
  const feeds = [...unordered].sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));
  const stops = servedStops(feeds);
  const routes = routeTable(feeds);
  const services = serviceTable(feeds);
  const drafts = draftTrips(feeds, {
    stops: stops.index,
    routes: routes.index,
    services: services.index,
  });
  const { patterns, trips } = buildPatterns(drafts.trips);
  const named = namedStops(feeds, stops.table);
  const grid = buildGrid(stops.table.lat, stops.table.lon);
  const footpaths = buildFootpaths(
    stops.table,
    grid,
    feeds.map((feed) => feed.timetable.transfers),
    (feed, id) => named.get(feedKey(feed, id)) ?? [],
  );
  const stepFreeFootpaths = buildStepFreeFootpaths(
    stops.table,
    feeds.map((feed) => feed.timetable.transfers),
    (feed, id) => named.get(feedKey(feed, id)) ?? [],
    {
      accessible: stops.table.accessible,
      sameComplex: (feed, from, to) => sameComplex(feeds, feed, from, to),
    },
  );
  const tripByKey = new Map<string, number>();
  for (const [trip, id] of trips.ids.entries()) {
    tripByKey.set(feedKey(patterns.feed[trips.pattern[trip] ?? 0] ?? 0, id), trip);
  }
  const leftOut = new Map(drafts.leftOut);
  if (stops.outside > 0) leftOut.set('stop outside the New York area', stops.outside);
  return {
    key: networkKey(feeds),
    feeds: feeds.map(({ sourceId, version, provenance }) => ({ sourceId, version, provenance })),
    stops: stops.table,
    routes: routes.table,
    services: services.list,
    patterns,
    trips,
    shapes: compileShapes(feeds, trips, patterns),
    stopPatterns: indexStopPatterns(patterns, stops.table.count),
    footpaths,
    stepFreeFootpaths,
    stepFreeModes: modesWithAccess(patterns, routes.table, stops.table.accessible),
    entrances: compileEntrances(
      feeds,
      stops.table.ids.map((id, stop) => ({ id, feed: stops.table.feed[stop] ?? 0 })),
    ),
    grid,
    named,
    tripByKey,
    leftOut,
  };
}
