import type { LiveSource } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { SourceDefinition } from '../data-platform/definition.js';
import type { SourceReader } from '../data-platform/reader.js';
import { ferryTimetableSources } from '../data-platform/sources/ferries/timetables.js';
import { gtfsStaticSources } from '../data-platform/sources/mta/gtfs-static.js';
import type {
  GtfsIndex,
  GtfsRoute,
  GtfsStop,
  GtfsTrip,
} from '../data-platform/sources/mta/gtfs-static-schema.js';
import { railTimetableSources } from '../data-platform/sources/regional/rail-timetables.js';
import { airportShuttleTimetableSource } from '../data-platform/sources/shuttles/passio-timetable.js';
import { lineOf, type Line } from './estimation/line.js';
import { liveSource } from './sources.js';

/** The static timetables of one network, looked up as one. */
export interface Timetable {
  readonly sources: readonly LiveSource[];
  route(id: string): GtfsRoute | undefined;
  /** All published route IDs and names, including routes without active vehicles. */
  routes?(): Iterable<readonly [string, GtfsRoute]>;
  stop(id: string): GtfsStop | undefined;
  trip(id: string): GtfsTrip | undefined;
  /** Route candidates, optionally filtered by the operator's public trip number. */
  tripsForRoute(route: string, shortName: string | null): readonly GtfsTrip[];
  /** The shape of that id as a line, or undefined when no timetable has it or it is not a line. */
  line(shapeId: string): Line | undefined;
  /** Every shape id of the timetables. */
  shapeIds(): Iterable<string>;
}

type TimetableSource = SourceDefinition<GtfsIndex>;

const only = (sources: readonly TimetableSource[], ...ids: string[]) =>
  sources.filter((definition) => ids.includes(definition.id));

/**
 * Each network with the timetables it is looked up in. Stop and trip ids repeat between
 * networks (LIRR and Metro-North both number their stations), so each one is read apart.
 */
const NETWORKS = {
  bus: gtfsStaticSources.filter((definition) => definition.id !== 'mta-gtfs-subway'),
  subway: only(gtfsStaticSources, 'mta-gtfs-subway'),
  lirr: only(railTimetableSources, 'mta-gtfs-lirr'),
  metroNorth: only(railTimetableSources, 'mta-gtfs-metro-north'),
  nycFerry: only(ferryTimetableSources, 'nyc-ferry-gtfs'),
  newarkShuttle: [airportShuttleTimetableSource],
} satisfies Record<string, readonly TimetableSource[]>;

export type Network = keyof typeof NETWORKS;

/** Every network's timetable, read together. */
export type Timetables = Readonly<Record<Network, Timetable>>;

/** The timetable sources of each network, for the tests that load them. */
export const timetableSources: Readonly<Record<Network, readonly TimetableSource[]>> = NETWORKS;

/**
 * Timetables change a few times a year and are large, so they are read again at most once a
 * minute; a state change of their sources shows within that minute.
 */
const REREAD_MS = 60_000;
const EMPTY_BUS_REREAD_MS = 5_000;

function first<T>(indexes: readonly GtfsIndex[], pick: (index: GtfsIndex) => T | undefined) {
  for (const index of indexes) {
    const found = pick(index);
    if (found !== undefined) return found;
  }
  return undefined;
}

type IndexedTimetable = Timetable & { readonly hasData: boolean };

function timetableOf(
  indexes: readonly GtfsIndex[],
  sources: readonly LiveSource[],
): IndexedTimetable {
  // Decoded once per reading of the timetables, and only the shapes asked for.
  const lines = new Map<string, Line | undefined>();
  const byRoute = new Map<string, GtfsTrip[]>();
  const byNumber = new Map<string, Map<string, GtfsTrip[]>>();
  for (const index of indexes) {
    for (const trip of Object.values(index.trips)) {
      const trips = byRoute.get(trip.route) ?? [];
      trips.push(trip);
      byRoute.set(trip.route, trips);
      if (trip.shortName !== undefined) {
        const numbers = byNumber.get(trip.route) ?? new Map<string, GtfsTrip[]>();
        const named = numbers.get(trip.shortName) ?? [];
        named.push(trip);
        numbers.set(trip.shortName, named);
        byNumber.set(trip.route, numbers);
      }
    }
  }
  return {
    sources,
    hasData: indexes.length > 0,
    route: (id) => first(indexes, (index) => index.routes[id]),
    *routes() {
      const seen = new Set<string>();
      for (const index of indexes)
        for (const [id, route] of Object.entries(index.routes)) {
          if (!seen.has(id)) {
            seen.add(id);
            yield [id, route] as const;
          }
        }
    },
    stop: (id) => first(indexes, (index) => index.stops[id]),
    trip: (id) => first(indexes, (index) => index.trips[id]),
    tripsForRoute(route, shortName) {
      const candidates = byRoute.get(route) ?? [];
      const numbers = byNumber.get(route);
      // Older cached timetables have no short names; matching stops still must be unambiguous.
      return numbers === undefined
        ? candidates
        : shortName === null
          ? []
          : (numbers.get(shortName) ?? []);
    },
    line(shapeId) {
      if (!lines.has(shapeId)) {
        const encoded = first(indexes, (index) => index.shapes?.[shapeId]);
        lines.set(shapeId, encoded === undefined ? undefined : lineOf(shapeId, encoded));
      }
      return lines.get(shapeId);
    },
    *shapeIds() {
      for (const index of indexes) yield* Object.keys(index.shapes ?? {});
    },
  };
}

async function readNetwork(reader: SourceReader, sources: readonly TimetableSource[]) {
  const readings = await Promise.all(
    sources.map(async (definition) => ({ definition, reading: await reader.read(definition) })),
  );
  return timetableOf(
    readings.flatMap(({ reading }) => reading.data ?? []),
    readings.map(({ definition, reading }) => liveSource(definition, reading)),
  );
}

async function readTimetables(
  reader: SourceReader,
): Promise<Timetables & { readonly bus: IndexedTimetable }> {
  const [bus, subway, lirr, metroNorth, nycFerry, newarkShuttle] = await Promise.all([
    readNetwork(reader, NETWORKS.bus),
    readNetwork(reader, NETWORKS.subway),
    readNetwork(reader, NETWORKS.lirr),
    readNetwork(reader, NETWORKS.metroNorth),
    readNetwork(reader, NETWORKS.nycFerry),
    readNetwork(reader, NETWORKS.newarkShuttle),
  ]);
  return { bus, subway, lirr, metroNorth, nycFerry, newarkShuttle };
}

/** The timetables of every network the platform serves, read again once a minute. */
export function createTimetables(reader: SourceReader, clock: Clock) {
  let cached: { readonly at: number; readonly value: Promise<Timetables>; ttl: number } | undefined;
  return {
    current(): Promise<Timetables> {
      const now = clock.now().getTime();
      if (cached === undefined || now - cached.at >= cached.ttl) {
        const value = readTimetables(reader);
        cached = { at: now, value, ttl: EMPTY_BUS_REREAD_MS };
        value
          .then((tables) => {
            if (cached?.value === value && tables.bus.hasData) cached.ttl = REREAD_MS;
          })
          .catch(() => undefined);
        value.catch(() => {
          if (cached?.value === value) cached = undefined;
        });
      }
      return cached.value;
    },
  };
}
