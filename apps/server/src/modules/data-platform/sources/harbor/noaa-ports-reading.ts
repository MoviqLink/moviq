import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';

/** `2026-11-11 03:30`, in GMT as requested. */
const TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

const stationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const observedAt = instantSchema;
/** A NOAA quality limit was exceeded (flat, rate of change, expected range or maximum). */
const flagged = z.boolean();

const observationSchema = z.discriminatedUnion('measure', [
  z.object({
    measure: z.literal('water-level'),
    observedAt,
    /** Height above Mean Lower Low Water, the chart datum. */
    metresAboveChartDatum: z.number(),
    /** Preliminary until NOAA verifies it, which takes weeks. */
    preliminary: z.boolean(),
    flagged,
  }),
  z.object({
    measure: z.literal('air-gap'),
    observedAt,
    /** Distance between the bridge and the water's surface. */
    metres: z.number().positive(),
    flagged,
  }),
  z.object({
    measure: z.literal('current'),
    observedAt,
    centimetresPerSecond: z.number().nonnegative(),
    /** Where the water flows to, in degrees from true north. */
    directionDegrees: z.number().min(0).max(360),
  }),
  z.object({
    measure: z.literal('wind'),
    observedAt,
    metresPerSecond: z.number().nonnegative(),
    gustMetresPerSecond: z.number().nonnegative().nullable(),
    /** Where the wind blows from, in degrees from true north. */
    directionDegrees: z.number().min(0).max(360),
    flagged,
  }),
]);

export const portsReadingSchema = z.object({
  station: stationSchema,
  observation: observationSchema,
});

export type PortsReading = z.infer<typeof portsReadingSchema>;
type Observation = z.infer<typeof observationSchema>;
export type Measure = Observation['measure'];

const text = z.string();
const field = text.optional();
/**
 * The columns of the NOAA Response Help page: time, value, speed, direction, gust, flags and
 * quality level; each product fills its own, all as text.
 */
const rowSchema = z.object({ t: text, v: field, s: field, d: field, g: field, f: field, q: field });
const answerSchema = z.object({
  metadata: z.object({ id: text, name: text, lat: text, lon: text }),
  data: z.array(rowSchema).min(1),
});

function number(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timeOf(value: string | undefined): Date | undefined {
  const match = TIME.exec(value ?? '');
  if (match === null) return undefined;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0] = match.slice(1).map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return instant.getUTCDate() === day && hour < 24 && minute < 60 ? instant : undefined;
}

/** Flags after the first, which for water level and air gap is a count of outlying samples. */
function limitFlags(flags: string | undefined, skipCount: boolean): boolean {
  const values = (flags ?? '').split(',').slice(skipCount ? 1 : 0);
  return values.some((value) => value.trim() === '1');
}

/** One row of the answer as an observation, or undefined when a value is missing. */
function observationOf(measure: Measure, row: z.infer<typeof rowSchema>): unknown {
  const time = timeOf(row.t);
  if (time === undefined) return undefined;
  const at = toInstant(time);
  switch (measure) {
    case 'water-level':
      return {
        measure,
        observedAt: at,
        metresAboveChartDatum: number(row.v),
        preliminary: row.q !== 'v',
        flagged: limitFlags(row.f, true),
      };
    case 'air-gap':
      return { measure, observedAt: at, metres: number(row.v), flagged: limitFlags(row.f, true) };
    case 'current':
      return {
        measure,
        observedAt: at,
        centimetresPerSecond: number(row.s),
        directionDegrees: number(row.d),
      };
    case 'wind':
      return {
        measure,
        observedAt: at,
        metresPerSecond: number(row.s),
        gustMetresPerSecond: number(row.g) ?? null,
        directionDegrees: number(row.d),
        flagged: limitFlags(row.f, false),
      };
  }
}

/** The newest observation of a NOAA answer for one station and measure, or why it is refused. */
export function parsePortsAnswer(
  body: Uint8Array,
  stationId: string,
  measure: Measure,
): ParseResult<PortsReading> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(decoded.value);
  if (failure.success) return refuse('no-data', failure.data.error.message);
  const answer = answerSchema.safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const { metadata, data } = answer.data;
  if (metadata.id !== stationId) {
    return refuse('wrong-station', `Asked for ${stationId}, NOAA answered ${metadata.id}.`);
  }
  const observations = data.flatMap((row) => {
    const parsed = observationSchema.safeParse(observationOf(measure, row));
    return parsed.success ? [parsed.data] : [];
  });
  const newest = observations.sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  if (newest === undefined) return refuse('no-data', 'No row has a time and a value.');
  const candidate = portsReadingSchema.safeParse({
    station: {
      id: metadata.id,
      name: metadata.name,
      latitude: number(metadata.lat),
      longitude: number(metadata.lon),
    },
    observation: newest,
  });
  if (!candidate.success) return refuse('unexpected-shape', describeIssue(candidate.error));
  return {
    ok: true,
    data: candidate.data,
    dataTime: new Date(newest.observedAt),
    coverage: `1 ${measure} reading at ${metadata.name} (${metadata.id})`,
  };
}
