import {
  boardStatusSchema,
  scheduledFlightSchema,
  toInstant,
  type AirportCode,
  type ScheduledFlight,
} from '@moviq/contracts';
import { z } from 'zod';

import type { ProviderOutcome } from '../../journeys/ports.js';
import { callSign, label, PROVIDER, readTime } from './aerodatabox-answer.js';
import { AERODATABOX_HOST } from './aerodatabox-gateway.js';
import { providerProvenance, readJson, unexpectedShape } from './outcome.js';

export const AIRPORT_ICAO: Readonly<Record<AirportCode, string>> = {
  JFK: 'KJFK',
  LGA: 'KLGA',
  EWR: 'KEWR',
};

/** FIDS is a Tier 2 endpoint, like Flight Status: 2 units a request (aerodatabox.com/pricing). */
export const FIDS_UNITS = 2;

/** From 2 hours ago to 10 hours ahead: the longest window the Basic plan gives in one request. */
const WINDOW = { offsetMinutes: -120, durationMinutes: 720 } as const;

/** JFK's 12 hours, departures and arrivals, were 282,862 bytes on 11/11/2026; a busy day has more. */
export const FIDS_MAX_BYTES = 2 * 1024 * 1024;

/** One airport's departures and arrivals, as AeroDataBox listed them in one answer. */
export interface AirportSnapshot {
  readonly code: AirportCode;
  readonly takenAt: Date;
  readonly window: { readonly from: Date; readonly to: Date };
  readonly departures: readonly ScheduledFlight[];
  readonly arrivals: readonly ScheduledFlight[];
}

/**
 * "FIDS (airport departures and arrivals) - by relative time": both directions in one request,
 * the other end of each flight (`withLeg`), operated flights only, no cargo and no private ones.
 */
export function fidsUrl(code: AirportCode): string {
  const params = new URLSearchParams({
    offsetMinutes: String(WINDOW.offsetMinutes),
    durationMinutes: String(WINDOW.durationMinutes),
    direction: 'Both',
    withLeg: 'true',
    withCodeshared: 'false',
    withCargo: 'false',
    withPrivate: 'false',
  });
  return `https://${AERODATABOX_HOST}/flights/airports/icao/${AIRPORT_ICAO[code]}?${params.toString()}`;
}

const timeSchema = z.object({ utc: z.string(), local: z.string() });

/** `FlightAirportMovementContract`: with `withLeg`, the end at this airport has no `airport`. */
const movementSchema = z.object({
  airport: z
    .object({ icao: z.string().nullish(), iata: z.string().nullish(), name: z.string().min(1) })
    .nullish(),
  scheduledTime: timeSchema.nullish(),
  revisedTime: timeSchema.nullish(),
  runwayTime: timeSchema.nullish(),
  terminal: z.string().nullish(),
  gate: z.string().nullish(),
  quality: z.array(z.string()),
});

/** `AirportFlightContract`, the parts MovIQ reads. */
const entrySchema = z.object({
  departure: movementSchema.nullish(),
  arrival: movementSchema.nullish(),
  number: z.string().min(1),
  callSign: z.string().nullish(),
  status: z.string(),
  isCargo: z.boolean(),
  airline: z
    .object({ name: z.string().min(1), iata: z.string().nullish(), icao: z.string().nullish() })
    .nullish(),
});

/** `AirportFidsContract`. */
const answerSchema = z.object({
  departures: z.array(z.unknown()).nullish(),
  arrivals: z.array(z.unknown()).nullish(),
});

type Entry = z.infer<typeof entrySchema>;
type Side = 'departure' | 'arrival';

/** Statuses after the aircraft has left (a departure) or reached the runway (an arrival). */
const RUNWAY_PASSED: Readonly<Record<Side, ReadonlySet<string>>> = {
  departure: new Set(['Departed', 'EnRoute', 'Approaching', 'Arrived', 'Diverted']),
  arrival: new Set(['Arrived']),
};

/** The departures and arrivals of a FIDS answer; an entry that cannot be read is left out. */
export function readSnapshot(
  answer: { readonly status: number; readonly body: Uint8Array; readonly receivedAt: Date },
  code: AirportCode,
): ProviderOutcome<AirportSnapshot> {
  const takenAt = answer.receivedAt;
  const json = readJson(answer.body, PROVIDER);
  if (!json.ok) return json;
  const parsed = answerSchema.safeParse(json.value);
  if (!parsed.success) return unexpectedShape(parsed.error, PROVIDER);
  const rows = { departure: parsed.data.departures ?? [], arrival: parsed.data.arrivals ?? [] };
  const departures = flightsOf(rows.departure, 'departure', code, takenAt);
  const arrivals = flightsOf(rows.arrival, 'arrival', code, takenAt);
  const leftOut = rows.departure.length + rows.arrival.length - departures.length - arrivals.length;
  const snapshot: AirportSnapshot = {
    code,
    takenAt,
    window: {
      from: new Date(takenAt.getTime() + WINDOW.offsetMinutes * 60_000),
      to: new Date(takenAt.getTime() + (WINDOW.offsetMinutes + WINDOW.durationMinutes) * 60_000),
    },
    departures,
    arrivals,
  };
  return {
    ok: true,
    value: snapshot,
    provenance: providerProvenance({
      sourceId: 'aerodatabox',
      dataTime: takenAt,
      receivedAt: takenAt,
      evidence:
        `${PROVIDER} listed ${String(departures.length)} departures and ` +
        `${String(arrivals.length)} arrivals at ${code}, ${String(leftOut)} left out.`,
    }),
  };
}

function flightsOf(
  rows: readonly unknown[],
  side: Side,
  code: AirportCode,
  takenAt: Date,
): ScheduledFlight[] {
  const seen = new Set<string>();
  const flights: ScheduledFlight[] = [];
  for (const row of rows) {
    const entry = entrySchema.safeParse(row);
    const flight = entry.success ? flightOf(entry.data, side, code, takenAt) : undefined;
    if (flight === undefined || seen.has(flight.id)) continue;
    seen.add(flight.id);
    flights.push(flight);
  }
  return flights.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
}

function flightOf(
  entry: Entry,
  side: Side,
  code: AirportCode,
  takenAt: Date,
): ScheduledFlight | undefined {
  const here = (side === 'departure' ? entry.departure : entry.arrival) ?? null;
  const other = (side === 'departure' ? entry.arrival : entry.departure)?.airport ?? null;
  const airline = entry.airline ?? null;
  const scheduled = readTime(here?.scheduledTime?.utc);
  if (entry.isCargo || here === null || other === null || scheduled === null) return undefined;
  const number = entry.number.trim().replace(/\s+/g, ' ');
  const revised = readTime(here.revisedTime?.utc);
  const runway = readTime(here.runwayTime?.utc);
  const status = boardStatusSchema.safeParse(entry.status);
  const passed =
    runway !== null &&
    runway.getTime() <= takenAt.getTime() &&
    RUNWAY_PASSED[side].has(entry.status);
  const parsed = scheduledFlightSchema.safeParse({
    id: `${number}@${toInstant(scheduled)}`,
    number,
    airline:
      airline === null
        ? null
        : { name: airline.name, iata: label(airline.iata), icao: label(airline.icao) },
    callSign: callSign(entry.callSign),
    airport: { name: other.name, iata: label(other.iata), icao: label(other.icao) },
    scheduledAt: toInstant(scheduled),
    revisedAt: revised === null ? null : toInstant(revised),
    runway:
      runway === null ? null : { at: toInstant(runway), kind: passed ? 'actual' : 'estimated' },
    terminal: label(here.terminal),
    gate: label(here.gate),
    status: status.success ? status.data : null,
    basis: here.quality.includes('Live') ? 'live' : 'timetable',
    provenance: providerProvenance({
      sourceId: 'aerodatabox',
      dataTime: takenAt,
      receivedAt: takenAt,
      evidence: `${PROVIDER} listed ${number} on the ${code} ${side}s board.`,
    }),
  });
  return parsed.success ? parsed.data : undefined;
}
