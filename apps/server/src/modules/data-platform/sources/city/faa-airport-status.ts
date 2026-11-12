import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import {
  durationMinutes,
  KNOWN_LISTS,
  parseUpdateTime,
  readNasStatusXml,
  type NasDelayType,
} from './faa-nas-status-xml.js';
import { olderThanServed, refuse } from './parsing.js';

const NEW_YORK_AIRPORTS = ['JFK', 'LGA', 'EWR'] as const;

const newYorkAirports: ReadonlySet<string> = new Set(NEW_YORK_AIRPORTS);

/** A delay as the FAA writes it (`1 hour and 52 minutes`), and in minutes when that form is known. */
const durationSchema = z.object({
  text: z.string(),
  minutes: z.number().int().nonnegative().nullable(),
});

const airportProgramSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ground-stop'),
    reason: z.string().nullable(),
    /** Planned end as the FAA writes it, such as `7:45 pm EDT`. */
    until: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('ground-delay'),
    reason: z.string().nullable(),
    average: durationSchema.nullable(),
    maximum: durationSchema.nullable(),
  }),
  z.object({
    kind: z.literal('delay'),
    direction: z.enum(['arrival', 'departure']),
    reason: z.string().nullable(),
    minimum: durationSchema.nullable(),
    maximum: durationSchema.nullable(),
    trend: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('closure'),
    reason: z.string().nullable(),
    /** Start and reopening as the FAA writes them, such as `Nov 10 at 07:30 UTC.` */
    from: z.string().nullable(),
    reopens: z.string().nullable(),
  }),
]);

const newYorkAirportStatusSchema = z.object({
  updatedAt: instantSchema,
  /** Always the three airports; an empty list of programs means that none is active. */
  airports: z.array(
    z.object({ code: z.enum(NEW_YORK_AIRPORTS), programs: z.array(airportProgramSchema) }),
  ),
});

type Duration = z.infer<typeof durationSchema>;
type AirportProgram = z.infer<typeof airportProgramSchema>;
export type NewYorkAirportStatus = z.infer<typeof newYorkAirportStatusSchema>;

interface Entry {
  readonly code: string;
  readonly program: AirportProgram;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function duration(value: string | undefined): Duration | null {
  const text = nonEmpty(value);
  return text === null ? null : { text, minutes: durationMinutes(text) ?? null };
}

function groundStops(type: NasDelayType): Entry[] {
  return (type.Ground_Stop_List?.Program ?? []).map((item) => ({
    code: item.ARPT.trim(),
    program: { kind: 'ground-stop', reason: nonEmpty(item.Reason), until: nonEmpty(item.End_Time) },
  }));
}

function groundDelays(type: NasDelayType): Entry[] {
  return (type.Ground_Delay_List?.Ground_Delay ?? []).map((item) => ({
    code: item.ARPT.trim(),
    program: {
      kind: 'ground-delay',
      reason: nonEmpty(item.Reason),
      average: duration(item.Avg),
      maximum: duration(item.Max),
    },
  }));
}

function generalDelays(type: NasDelayType): Entry[] {
  return (type.Arrival_Departure_Delay_List?.Delay ?? []).flatMap((item) =>
    item.Arrival_Departure.map((leg): Entry => ({
      code: item.ARPT.trim(),
      program: {
        kind: 'delay',
        direction: leg.Type === 'Arrival' ? 'arrival' : 'departure',
        reason: nonEmpty(item.Reason),
        minimum: duration(leg.Min),
        maximum: duration(leg.Max),
        trend: nonEmpty(leg.Trend),
      },
    })),
  );
}

function closures(type: NasDelayType): Entry[] {
  return (type.Airport_Closure_List?.Airport ?? []).map((item) => ({
    code: item.ARPT.trim(),
    program: {
      kind: 'closure',
      reason: nonEmpty(item.Reason),
      from: nonEmpty(item.Start),
      reopens: nonEmpty(item.Reopen),
    },
  }));
}

/** True when a value read from the XML names one of the three airports anywhere inside it. */
function mentionsNewYork(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(mentionsNewYork);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, inner]) =>
      (key === 'ARPT' && typeof inner === 'string' && newYorkAirports.has(inner.trim())) ||
      mentionsNewYork(inner),
  );
}

/** Lists of a kind MovIQ does not read that concern New York: reading on would hide them. */
function unreadListsForNewYork(types: readonly NasDelayType[]): string[] {
  return types.flatMap((type) =>
    Object.entries(type)
      .filter(([key, value]) => !KNOWN_LISTS.has(key) && mentionsNewYork(value))
      .map(([key]) => `${key} (${type.Name})`),
  );
}

function parseNasStatus(body: Uint8Array): ParseResult<NewYorkAirportStatus> {
  const read = readNasStatusXml(body);
  if (!read.ok) return read;
  const updatedAt = parseUpdateTime(read.document.updateTime);
  if (updatedAt === undefined) {
    return refuse('bad-update-time', `Update_Time "${read.document.updateTime}" is not readable.`);
  }
  const unread = unreadListsForNewYork(read.document.delayTypes);
  if (unread.length > 0) {
    return refuse(
      'unknown-program-type',
      `New York appears in lists not read: ${unread.join(', ')}.`,
    );
  }
  const entries = read.document.delayTypes
    .flatMap((type) => [
      ...groundStops(type),
      ...groundDelays(type),
      ...generalDelays(type),
      ...closures(type),
    ])
    .filter((entry) => newYorkAirports.has(entry.code));
  const airports = NEW_YORK_AIRPORTS.map((code) => ({
    code,
    programs: entries.filter((entry) => entry.code === code).map((entry) => entry.program),
  }));
  const programs =
    entries.length === 0 ? 'no active programs' : `${String(entries.length)} active programs`;
  return {
    ok: true,
    data: { updatedAt: toInstant(updatedAt), airports },
    dataTime: updatedAt,
    coverage: `3 airports, ${programs}`,
  };
}

/**
 * FAA NAS Status for JFK, LaGuardia and Newark: ground stops, ground delay programs, general
 * arrival and departure delays, and closures. An answer without programs for them is valid data
 * ("no active programs"); a failed answer is not, and leaves the last good data ageing.
 *
 * Rhythm and freshness: `Update_Time` moves about once a minute (23 s old when captured on
 * 11/11/2026), so every 5 minutes is enough at rest and every minute while a trip is watched. A
 * quarter of an hour without a new time is degraded, half an hour stale.
 *
 * Licence: a work of the U.S. Government, public domain under 17 U.S.C. § 105
 * (https://www.faa.gov/web_policies).
 */
export const faaAirportStatusSource: SourceDefinition<NewYorkAirportStatus> = {
  id: 'faa-airport-status',
  title: 'New York airports status',
  provider: 'Federal Aviation Administration (NAS Status)',
  licence: {
    name: 'U.S. Government work, public domain (17 U.S.C. § 105)',
    url: 'https://www.faa.gov/web_policies',
    attribution: 'Federal Aviation Administration, NAS Status',
  },
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 5 * 60_000, interestIntervalMs: 60_000 },
  freshness: {
    degradedAfterMs: 15 * 60_000,
    staleAfterMs: 30 * 60_000,
    unavailableAfterMs: 2 * 60 * 60_000,
  },
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  keepVersions: 1,
  dataSchema: newYorkAirportStatusSchema,
  request() {
    return {
      url: 'https://nasstatus.faa.gov/api/airport-status-information',
      headers: { accept: 'application/xml' },
    };
  },
  parse(body) {
    return parseNasStatus(body);
  },
  check(data, previous) {
    return olderThanServed(data.updatedAt, previous?.updatedAt);
  },
  consumers: ['flights', 'trip-watch'],
  failures: [
    {
      code: 'not-xml',
      detection: 'Tags left open or crossed, or no single root: an HTML page or a cut answer.',
      state: 'degraded',
      remedy: 'Keep serving the last good status with its age; the next run tries again.',
    },
    {
      code: 'unexpected-shape',
      detection: 'No AIRPORT_STATUS_INFORMATION root, or a list item without its fields.',
      state: 'misconfigured',
      remedy: 'The FAA changed the format: compare with the capture and update the reader.',
    },
    {
      code: 'bad-update-time',
      detection: 'Update_Time is missing or not like "Wed Nov 11 01:00:34 2026 GMT".',
      state: 'misconfigured',
      remedy: 'Without the time of the data its age is unknown: update the reader.',
    },
    {
      code: 'unknown-program-type',
      detection: 'A list of another kind than the four read names JFK, LGA or EWR.',
      state: 'misconfigured',
      remedy: 'Read the new kind of program before serving New York again.',
    },
    {
      code: 'older-than-served',
      detection: 'Update_Time of the candidate is earlier than the one served.',
      state: 'degraded',
      remedy: 'Keep the newer status; the next run normally brings a current one.',
    },
  ],
};
