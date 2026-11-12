import { fileURLToPath } from 'node:url';

import type { Flight, Place, PlanRequest, PlanResponse, Provenance } from '@moviq/contracts';

import type { Clock } from '../../src/infrastructure/clock/clock.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import type {
  ModelRequest,
  ModelStep,
  LanguageModel,
  ToolResult,
} from '../../src/modules/assistant/model/language-model.js';
import type {
  FlightFinder,
  FlightQuery,
  Geocoder,
  JourneyPlanner,
  ProviderOutcome,
} from '../../src/modules/journeys/ports.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** A migrated database in a fresh temporary folder. */
export async function assistantDatabase(
  clock: Clock,
): Promise<{ temp: TempDatabase; db: Database }> {
  const temp = await tempDatabase();
  const db = await temp.open();
  await migrate(db, await readMigrations(MIGRATIONS), clock);
  return { temp, db };
}

const provenance = (sourceId: string): Provenance => ({
  sourceId,
  dataTime: '2026-11-11T12:00:00.000Z',
  receivedAt: '2026-11-11T12:00:00.000Z',
  ageSeconds: 0,
  state: 'healthy',
  evidence: 'Answered by the test double.',
});

const place = (label: string, lat: number, lon: number, kind: Place['kind']): Place => ({
  label,
  lat,
  lon,
  kind,
  stopId: kind === 'station' ? `S-${label}` : null,
});

export const BRYANT_PARK = place(
  'Bryant Park, Manhattan, New York, NY',
  40.7536,
  -73.9832,
  'address',
);
export const HARLEM_ACBD = place('125 St (A C B D), Manhattan', 40.8111, -73.9524, 'station');
export const HARLEM_456 = place('125 St (4 5 6), Manhattan', 40.8041, -73.9375, 'station');
export const HARLEM_STREET = place('125 Street, Manhattan', 40.8075, -73.9454, 'address');
export const JFK = place(
  'John F. Kennedy International Airport, Queens',
  40.6413,
  -73.7781,
  'airport',
);

/** Answers known queries, case-insensitively; anything else finds nothing. */
export function fakeGeocoder(
  answers: Readonly<Record<string, readonly Place[]>>,
  state: { down: boolean } = { down: false },
): Geocoder & { readonly queries: string[] } {
  const queries: string[] = [];
  return {
    sourceId: 'nyc-geosearch',
    queries,
    search(text) {
      queries.push(text);
      if (state.down) return Promise.resolve(unavailable<readonly Place[]>());
      const key = Object.keys(answers).find((query) => query.toLowerCase() === text.toLowerCase());
      if (key === undefined)
        return Promise.resolve({
          ok: false,
          state: 'unavailable',
          code: 'no-match',
          detail: 'No match.',
        });
      const value = answers[key] ?? [];
      return Promise.resolve({ ok: true, value, provenance: provenance('nyc-geosearch') });
    },
  };
}

export function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    carrier: 'DL',
    number: '405',
    departureAt: '2026-11-11T15:00:00.000Z',
    revisedDeparture: null,
    takeOffAt: null,
    airport: 'JFK',
    terminal: '4',
    gate: null,
    status: 'Expected',
    aircraftHex: null,
    callSign: 'DAL405',
    provenance: provenance('aerodatabox'),
    ...overrides,
  };
}

/**
 * Knows flights by `CARRIER NUMBER DATE`. `down` fails as an unreachable provider does;
 * `no-units` as AeroDataBox does once the month's units are spent.
 */
export function fakeFlights(
  known: Readonly<Record<string, Flight>>,
  state: { down: boolean | 'no-units' } = { down: false },
): FlightFinder & { readonly queries: FlightQuery[] } {
  const queries: FlightQuery[] = [];
  return {
    sourceId: 'aerodatabox',
    queries,
    find(query) {
      queries.push(query);
      if (state.down === 'no-units') {
        return Promise.resolve({
          ok: false,
          state: 'rate_limited',
          code: 'monthly-units',
          detail: "AeroDataBox's free plan has 0 of its 400 monthly units left above the reserve.",
        });
      }
      if (state.down) return Promise.resolve(unavailable<Flight | null>('misconfigured'));
      const found = known[`${query.carrier} ${query.number} ${query.date}`] ?? null;
      return Promise.resolve({ ok: true, value: found, provenance: provenance('aerodatabox') });
    },
  };
}

function unavailable<T>(
  state: 'unavailable' | 'misconfigured' = 'unavailable',
): ProviderOutcome<T> {
  return { ok: false, state, code: 'test-down', detail: 'The test double is down.' };
}

/** Leaves 40 minutes before the deadline and arrives 8 minutes early. */
export function fakePlanner(): JourneyPlanner & {
  readonly requests: { request: PlanRequest; travellerId: string }[];
} {
  const requests: { request: PlanRequest; travellerId: string }[] = [];
  return {
    requests,
    plan(request, travellerId) {
      requests.push({ request, travellerId });
      const arriveBy = Date.parse(request.arriveBy);
      const departAt = new Date(arriveBy - 40 * 60_000).toISOString();
      const arriveAt = new Date(arriveBy - 8 * 60_000).toISOString();
      const response: PlanResponse = {
        planId: `plan-${String(requests.length)}`,
        generatedAt: '2026-11-11T12:00:00.000Z',
        itineraries: [
          {
            id: 'it-1',
            departAt,
            arriveAt,
            spareMinutes: 8,
            transfers: 0,
            walkMinutes: 6,
            legs: [
              {
                mode: 'subway',
                from: request.origin,
                to: request.destination,
                departAt,
                arriveAt,
                route: { id: 'B', shortName: 'B', headsign: 'Brighton Beach' },
                tripId: 'B-1',
                timing: 'scheduled',
                provenance: provenance('transitous'),
                path: [],
              },
            ],
            fare: null,
          },
        ],
        recommendedId: 'it-1',
        notices: [],
      };
      return Promise.resolve(response);
    },
  };
}

/** A model that plays recorded steps in order and keeps every request and result it got. */
export function scriptedModel(steps: readonly ModelStep[]): LanguageModel & {
  readonly requests: ModelRequest[];
  readonly results: (readonly ToolResult[])[];
} {
  const requests: ModelRequest[] = [];
  const results: (readonly ToolResult[])[] = [];
  let next = 0;
  return {
    model: 'scripted',
    maxTokensPerStep: 1_000,
    requests,
    results,
    open(request) {
      requests.push(request);
      return {
        step(received) {
          results.push(received);
          const step = steps[next];
          next += 1;
          if (step === undefined) throw new Error('The script has no more steps.');
          return Promise.resolve(step);
        },
      };
    },
  };
}

export const calls = (...list: readonly (readonly [name: string, args: unknown])[]): ModelStep => ({
  ok: true,
  kind: 'calls',
  calls: list.map(([name, args], index) => ({
    callId: `call_${String(index)}`,
    name,
    arguments: args,
  })),
  usage: { totalTokens: 300 },
});

export const text = (words: string): ModelStep => ({
  ok: true,
  kind: 'text',
  text: words,
  usage: { totalTokens: 120 },
});
