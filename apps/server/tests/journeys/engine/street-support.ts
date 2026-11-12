import type { Place } from '@moviq/contracts';

import { createDailyBudget } from '../../../src/modules/data-platform/on-demand/daily-budget.js';
import { createTransitousStreets } from '../../../src/modules/data-platform/on-demand/transitous-streets.js';
import type { TimetableInput } from '../../../src/modules/journeys/engine/inputs.js';
import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import { toItinerary } from '../../../src/modules/journeys/itineraries.js';
import type { RoutedItinerary, RouteQuery } from '../../../src/modules/journeys/ports.js';
import { capture, stubHttp } from '../../on-demand/support.js';
import {
  handTimetable,
  query,
  sources,
  STOPS,
  stopPlace,
  timetableReading,
  tuesday,
  type HandTrip,
} from './hand-network.js';

export const NOW = { now: () => tuesday('06:00') };
const json = { 'content-type': 'application/json' };

/**
 * The engine with the real Transitous walk client over a stub answering one capture, or down
 * (`null`). The captures were taken elsewhere in the city: each stands for the walk asked.
 */
export function engineWith(timetable: TimetableInput, streetAnswer: string | null) {
  const { http, sent } = stubHttp(
    streetAnswer === null ? 'network-down' : { body: capture(streetAnswer), headers: json },
  );
  const streets = createTransitousStreets({ http, clock: NOW, budget: createDailyBudget(300) });
  const engine = createEngineRouting({
    sources: sources([timetableReading(timetable)]),
    clock: NOW,
    streets,
  });
  return { engine, sent };
}

export async function planned(engine: ReturnType<typeof createEngineRouting>, request: RouteQuery) {
  const outcome = await engine.plan(request);
  if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail}`);
  return outcome;
}

export const walkOf = (itinerary: RoutedItinerary | undefined) =>
  itinerary?.legs.find((leg) => leg.mode === 'walk');

/** R2 from B2, 100 m east of B, to C, 12 minutes after each departure. */
function r2Trips(departures: readonly string[]): HandTrip[] {
  return departures.map((departure, index) => ({
    id: `R2-${String(index)}`,
    route: 'R2',
    calls: [
      ['B2', departure],
      ['C', `${departure.slice(0, 3)}${String(Number(departure.slice(3)) + 12).padStart(2, '0')}`],
    ],
  }));
}

/** R1 from A to B at 08:00, then R2 from B2 (100 m east, an estimated change of 108 s) to C. */
export function changeAtB(
  r2Departures: readonly string[],
  transfers: TimetableInput['transfers'] = [],
  more: readonly HandTrip[] = [],
) {
  const r1: HandTrip = {
    id: 'R1',
    route: 'R1',
    calls: [
      ['A', '08:00'],
      ['B', '08:10'],
    ],
  };
  return handTimetable([r1, ...r2Trips(r2Departures), ...more], { transfers });
}

/** R1 from A to C, 08:00 to 08:20: a ride with no change. */
export function lineAToC(accessible: readonly string[] = []) {
  const trip: HandTrip = {
    id: 'R1',
    route: 'R1',
    calls: [
      ['A', '08:00'],
      ['C', '08:20'],
    ],
  };
  return handTimetable([trip], { accessible });
}

export const toC = query({ from: stopPlace('A'), to: stopPlace('C'), arriveBy: tuesday('09:00') });

/** 200 m south of A: an access walk estimated at 217 s. */
export const SOUTH_OF_A: Place = {
  label: 'Near A',
  lat: STOPS.A.lat - 0.0018,
  lon: STOPS.A.lon,
  kind: 'address',
  stopId: null,
};

/** 200 m north of C: a walk to the destination estimated at 217 s. */
export const NORTH_OF_C: Place = {
  label: 'Near C',
  lat: STOPS.C.lat + 0.0018,
  lon: STOPS.C.lon,
  kind: 'address',
  stopId: null,
};

const PROVENANCE = {
  sourceId: 'moviq-raptor',
  dataTime: null,
  receivedAt: '2026-11-10T11:00:00.000Z',
  ageSeconds: null,
  state: 'healthy' as const,
  evidence: 'The engine, for the test.',
};

/** The itinerary as MovIQ serves it. */
export function asServed(itinerary: RoutedItinerary | undefined) {
  if (itinerary === undefined) throw new Error('no itinerary');
  return toItinerary(itinerary, PROVENANCE, tuesday('09:00'), { fareFor: () => null });
}
