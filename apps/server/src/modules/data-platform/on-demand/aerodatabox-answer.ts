import { flightSchema, toInstant, type Flight } from '@moviq/contracts';
import { z } from 'zod';

import type { FlightQuery, ProviderOutcome } from '../../journeys/ports.js';
import { failure, providerProvenance, readJson, unexpectedShape } from './outcome.js';

export const PROVIDER = 'AeroDataBox';

const NEW_YORK_AIRPORTS: ReadonlySet<string> = new Set(['JFK', 'LGA', 'EWR']);

/** Statuses after the aircraft has left the gate and the runway. */
const LEFT_STATUSES: ReadonlySet<string> = new Set([
  'Departed',
  'EnRoute',
  'Approaching',
  'Arrived',
  'Diverted',
]);

/** `DateTimeContract`: UTC and local times, written `2026-11-11 14:30Z` or in ISO 8601. */
const timeSchema = z.object({ utc: z.string(), local: z.string() });

/** The parts of a `FlightContract` MovIQ reads, with the names and nullability of the OpenAPI. */
const flightContractSchema = z.object({
  number: z.string().min(1),
  callSign: z.string().nullish(),
  status: z.string(),
  isCargo: z.boolean(),
  lastUpdatedUtc: z.string(),
  aircraft: z.object({ modeS: z.string().nullish() }).nullish(),
  departure: z.object({
    airport: z.object({ iata: z.string().nullish(), name: z.string() }),
    scheduledTime: timeSchema.nullish(),
    revisedTime: timeSchema.nullish(),
    predictedTime: timeSchema.nullish(),
    runwayTime: timeSchema.nullish(),
    terminal: z.string().nullish(),
    gate: z.string().nullish(),
  }),
});

const answerSchema = z.array(flightContractSchema);

type FlightContract = z.infer<typeof flightContractSchema>;

/** The flight of the query departing New York, from a Flight Status answer. */
export function readFlight(
  response: { readonly status: number; readonly body: Uint8Array },
  query: FlightQuery,
  receivedAt: Date,
): ProviderOutcome<Flight | null> {
  const name = `${query.carrier} ${query.number}`;
  if (response.status === 204 || response.body.byteLength === 0) {
    return noFlight(`${PROVIDER} has no flight ${name} on ${query.date}.`, receivedAt);
  }
  const json = readJson(response.body, PROVIDER);
  if (!json.ok) return json;
  const parsed = answerSchema.safeParse(json.value);
  if (!parsed.success) return unexpectedShape(parsed.error, PROVIDER);
  const fromNewYork = parsed.data.filter((item) => departsNewYork(item, query.date));
  const timed = fromNewYork
    .map((item) => ({ item, departure: readTime(item.departure.scheduledTime?.utc) }))
    .filter((entry): entry is { item: FlightContract; departure: Date } => entry.departure !== null)
    .sort((a, b) => a.departure.getTime() - b.departure.getTime());
  const first = timed[0];
  if (first === undefined) {
    if (fromNewYork.length > 0) {
      return failure(
        'unavailable',
        'no-departure-time',
        `${PROVIDER} lists ${name} without a departure time.`,
      );
    }
    return noFlight(
      `${PROVIDER} has no flight ${name} from New York on ${query.date}.`,
      receivedAt,
    );
  }
  return toFlight(first.item, first.departure, query, receivedAt);
}

function departsNewYork(item: FlightContract, date: string): boolean {
  const airport = item.departure.airport.iata ?? '';
  const localDate = item.departure.scheduledTime?.local.slice(0, 10);
  return !item.isCargo && NEW_YORK_AIRPORTS.has(airport) && (localDate ?? date) === date;
}

function noFlight(evidence: string, receivedAt: Date): ProviderOutcome<Flight | null> {
  return {
    ok: true,
    value: null,
    provenance: providerProvenance({
      sourceId: 'aerodatabox',
      dataTime: null,
      receivedAt,
      evidence,
    }),
  };
}

function toFlight(
  item: FlightContract,
  departure: Date,
  query: FlightQuery,
  receivedAt: Date,
): ProviderOutcome<Flight | null> {
  const airport = item.departure.airport.iata ?? '';
  const candidate = flightSchema.safeParse({
    carrier: query.carrier,
    number: query.number,
    departureAt: toInstant(departure),
    revisedDeparture: revisedDeparture(item),
    takeOffAt: takeOff(item, receivedAt),
    airport,
    terminal: label(item.departure.terminal),
    gate: label(item.departure.gate),
    status: item.status === 'Unknown' ? null : item.status,
    callSign: callSign(item.callSign),
    aircraftHex: hex(item.aircraft?.modeS),
    provenance: providerProvenance({
      sourceId: 'aerodatabox',
      dataTime: readTime(item.lastUpdatedUtc),
      receivedAt,
      evidence: `${PROVIDER} lists ${item.number} departing ${airport} on ${query.date}.`,
    }),
  });
  if (!candidate.success) return unexpectedShape(candidate.error, PROVIDER);
  return { ok: true, value: candidate.data, provenance: candidate.data.provenance };
}

/** The live estimate first; the experimental one from history only without it. */
function revisedDeparture(item: FlightContract): Flight['revisedDeparture'] {
  const revised = readTime(item.departure.revisedTime?.utc);
  if (revised !== null) return { at: toInstant(revised), kind: 'revised' };
  const predicted = readTime(item.departure.predictedTime?.utc);
  return predicted === null ? null : { at: toInstant(predicted), kind: 'predicted' };
}

/** `runwayTime` may be an estimate: it is a take-off only once passed and the flight has left. */
function takeOff(item: FlightContract, receivedAt: Date): string | null {
  const runway = readTime(item.departure.runwayTime?.utc);
  if (runway === null || runway.getTime() > receivedAt.getTime()) return null;
  return LEFT_STATUSES.has(item.status) ? toInstant(runway) : null;
}

export function label(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
}

/** Mode S as AeroDataBox writes it (`A9D286`), in the lower case ADS-B uses. */
function hex(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(text) ? text : null;
}

export function callSign(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(text) ? text : null;
}

/** `2026-11-11 14:30Z`, `2026-11-11T14:30:00Z` or with an offset; `null` in any other form. */
const TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})$/;

export function readTime(text: string | undefined): Date | null {
  const match = text === undefined ? null : TIME.exec(text.trim());
  if (match === null) return null;
  const [, day, time, zone] = match;
  const parsed = Date.parse(`${day ?? ''}T${time ?? ''}${zone ?? ''}`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
