import type { Place, Provenance } from '@moviq/contracts';

import type {
  EngineSources,
  GtfsTransfer,
  LivePredictions,
  PredictionReading,
  TimetableInput,
  TimetableReading,
} from '../../../src/modules/journeys/engine/inputs.js';
import type { RouteQuery } from '../../../src/modules/journeys/ports.js';
import { stopTimeColumns, type TripCalls } from './columns.js';

/**
 * A small network written by hand, in Lower Manhattan coordinates so every place is inside the
 * planning area. Stops sit about 1 km apart unless a test puts them closer.
 */
export const STOPS = {
  A: { lat: 40.7, lon: -74.0 },
  B: { lat: 40.709, lon: -74.0 },
  C: { lat: 40.718, lon: -74.0 },
  D: { lat: 40.727, lon: -74.0 },
  /** 100 m east of B: a walking transfer. */
  B2: { lat: 40.709, lon: -73.99882 },
  /** Far from everything: no walk reaches it. */
  Z: { lat: 40.9, lon: -73.7 },
} as const;

export type StopName = keyof typeof STOPS;

export interface HandTrip {
  readonly id: string;
  readonly route: string;
  readonly service?: string;
  /** Stop and `HH:MM` or `HH:MM:SS`, arrival equal to departure. */
  readonly calls: readonly (readonly [StopName, string])[];
  readonly noPickup?: readonly number[];
  readonly noDropOff?: readonly number[];
}

export function seconds(clock: string): number {
  const [hours = 0, minutes = 0, secs = 0] = clock.split(':').map(Number);
  return hours * 3600 + minutes * 60 + secs;
}

function stopTimes(trip: HandTrip): TripCalls {
  const times = trip.calls.map(([, clock]) => seconds(clock));
  return {
    stops: trip.calls.map(([stop]) => stop),
    arrivals: times,
    departures: times,
    noPickup: trip.noPickup ?? [],
    noDropOff: trip.noDropOff ?? [],
  };
}

/** Weekday service from 2 to 15 November 2026; `SUN` runs on Sundays only. */
export function handTimetable(
  trips: readonly HandTrip[],
  options: {
    readonly accessible?: readonly string[];
    readonly routeType?: number;
    readonly transfers?: readonly GtfsTransfer[];
    readonly complexes?: Readonly<Record<string, string>>;
    readonly entrances?: TimetableInput['entrances'];
  } = {},
): TimetableInput {
  const routes = [...new Set(trips.map((trip) => trip.route))];
  return {
    routes: Object.fromEntries(
      routes.map((route) => [
        route,
        {
          shortName: route,
          longName: null,
          type: options.routeType ?? 1,
          color: null,
          textColor: null,
        },
      ]),
    ),
    stops: Object.fromEntries(
      Object.entries(STOPS).map(([id, at]) => [
        id,
        { name: `Stop ${id}`, lat: at.lat, lon: at.lon, parent: null, station: false },
      ]),
    ),
    trips: Object.fromEntries(
      trips.map((trip) => [
        trip.id,
        {
          route: trip.route,
          service: trip.service ?? 'WKD',
          headsign: `To ${trip.route}`,
          direction: 0,
        },
      ]),
    ),
    services: {
      WKD: {
        days: [true, true, true, true, true, false, false],
        start: '20261102',
        end: '20261115',
        added: [],
        removed: [],
      },
      SUN: {
        days: [false, false, false, false, false, false, true],
        start: '20261102',
        end: '20261115',
        added: [],
        removed: [],
      },
    },
    stopTimes: stopTimeColumns(trips.map((trip) => [trip.id, stopTimes(trip)] as const)),
    transfers: options.transfers ?? [],
    shapes: {},
    wheelchairBoarding: Object.fromEntries(
      (options.accessible ?? []).map((stop) => [stop, 1 as const]),
    ),
    complexes: options.complexes ?? {},
    entrances: options.entrances ?? {},
  };
}

export function provenance(sourceId: string, state: Provenance['state'] = 'healthy'): Provenance {
  return {
    sourceId,
    dataTime: '2026-11-01T00:00:00.000Z',
    receivedAt: '2026-11-01T00:05:00.000Z',
    ageSeconds: 300,
    state,
    evidence: `${sourceId} as written for the test.`,
  };
}

export function timetableReading(
  timetable: TimetableInput | undefined,
  sourceId = 'hand-gtfs',
): TimetableReading {
  return {
    sourceId,
    version: timetable === undefined ? undefined : 'v1',
    provenance: provenance(sourceId, timetable === undefined ? 'unavailable' : 'healthy'),
    timetable,
  };
}

export function predictionReading(
  predictions: LivePredictions,
  state: Provenance['state'] = 'healthy',
): PredictionReading {
  return { sourceId: 'hand-live', provenance: provenance('hand-live', state), predictions };
}

export function sources(
  timetables: readonly TimetableReading[],
  predictions: readonly PredictionReading[] = [],
): EngineSources {
  return {
    readTimetables: () => Promise.resolve(timetables),
    readPredictions: () => Promise.resolve(predictions),
  };
}

/** A New York wall-clock time on Tuesday 10 November 2026 (EST, UTC-5) as an instant. */
export function tuesday(clock: string): Date {
  return new Date(Date.parse('2026-11-10T05:00:00.000Z') + seconds(clock) * 1000);
}

export function place(stop: StopName, label = `Near ${stop}`): Place {
  return { label, lat: STOPS[stop].lat, lon: STOPS[stop].lon, kind: 'address', stopId: null };
}

export function stopPlace(stop: StopName): Place {
  return {
    label: `Stop ${stop}`,
    lat: STOPS[stop].lat,
    lon: STOPS[stop].lon,
    kind: 'stop',
    stopId: stop,
  };
}

export function query(
  overrides: Partial<RouteQuery> & Pick<RouteQuery, 'from' | 'to' | 'arriveBy'>,
): RouteQuery {
  return {
    modes: ['subway', 'bus', 'walk'],
    maxWalkMinutes: 0,
    stepFree: false,
    count: 3,
    ...overrides,
  };
}

/** The legs reduced to what a timetable check reads: mode, route, stops and New York times. */
export function summary(
  legs: readonly {
    readonly mode: string;
    readonly route: { readonly id: string } | null;
    readonly from: Place;
    readonly to: Place;
    readonly departAt: Date;
    readonly arriveAt: Date;
    readonly scheduled: boolean;
  }[],
): string[] {
  const clock = (date: Date): string =>
    new Date(date.getTime() - 5 * 3_600_000).toISOString().slice(11, 19);
  return legs.map(
    (leg) =>
      `${leg.mode}${leg.route ? ` ${leg.route.id}` : ''} ${leg.from.stopId ?? 'origin'} ${clock(leg.departAt)}` +
      ` > ${leg.to.stopId ?? 'destination'} ${clock(leg.arriveAt)}${leg.scheduled ? '' : ' live'}`,
  );
}
