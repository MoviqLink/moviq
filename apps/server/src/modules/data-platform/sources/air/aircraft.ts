import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { KnownFailure, ParseResult } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import { MINUTE, count } from '../mta/provider.js';

/**
 * A circle of 25 nautical miles around (40.70, -73.95): LaGuardia lies 6 NM from its centre,
 * JFK 9 and Newark 10, so their approaches and departures are inside it.
 */
export const AREA = { latitude: 40.7, longitude: -73.95, radiusNm: 25 } as const;

/**
 * Both providers answer in the ADS-B Exchange v2 format with the same fields per aircraft;
 * adsb.lol lists them in `ac` with `now` in milliseconds and a `msg`, adsb.fi in `aircraft` with
 * `now` in seconds.
 */
interface AdsbDialect {
  readonly list: 'ac' | 'aircraft';
  readonly nowUnit: 'ms' | 's';
}

const answerSchema = z.object({
  msg: z.string().optional(),
  /** When the provider built the answer. */
  now: z.number().positive(),
  ac: z.array(z.unknown()).optional(),
  aircraft: z.array(z.unknown()).optional(),
});

const aircraftRow = z.object({
  hex: z.string().min(1),
  /** readsb's source of the position: `adsb_icao`, `mlat`, `tisb_icao`, `adsr_icao`… */
  type: z.string(),
  flight: z.string().optional(),
  r: z.string().optional(),
  t: z.string().optional(),
  alt_baro: z.union([z.number(), z.literal('ground')]).optional(),
  gs: z.number().nonnegative().optional(),
  track: z.number().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Seconds since the position was received. */
  seen_pos: z.number().nonnegative(),
});

const aircraftSchema = z.object({
  /**
   * `gps`: the aircraft broadcasts its own satellite position (ADS-B, or ADS-R rebroadcast).
   * `multilateration`: receivers computed it from the arrival times of its signal.
   * `radar`: the FAA rebroadcast a radar track (TIS-B).
   */
  located: z.enum(['gps', 'multilateration', 'radar']),
  /** The 24-bit ICAO address in hexadecimal; TIS-B tracks without one start with `~`. */
  hex: z.string().min(1),
  /** As broadcast, such as `UAL1518`; `adsb-routes` gives its usual airports. */
  callsign: z.string().nullable(),
  registration: z.string().nullable(),
  /** The ICAO type designator, such as `B39M`. */
  aircraftType: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  onGround: z.boolean(),
  /** Barometric altitude in feet, null on the ground or when not sent. */
  altitudeFeet: z.number().nullable(),
  groundSpeedKnots: z.number().nonnegative().nullable(),
  trackDegrees: z.number().nullable(),
  /** When the position was received: the answer time less `seen_pos`. */
  observedAt: instantSchema,
});

export const airTrafficSchema = z.object({
  answeredAt: instantSchema,
  aircraft: z.array(aircraftSchema),
  /** Aircraft without a position, or placed by a means not listed (Mode S only, other). */
  leftOut: z.number().int().nonnegative(),
});

type Aircraft = z.infer<typeof aircraftSchema>;
export type AirTraffic = z.infer<typeof airTrafficSchema>;

/** Clocks may differ a little; an answer dated further ahead than this has a wrong clock. */
const FUTURE_TOLERANCE_MS = 2 * MINUTE;

function locatedBy(type: string): Aircraft['located'] | undefined {
  if (/^ad(sb|sr|sc)/.test(type)) return 'gps';
  if (type === 'mlat') return 'multilateration';
  if (type.startsWith('tisb')) return 'radar';
  return undefined;
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function aircraftOf(row: unknown, answeredAt: number): Aircraft | undefined {
  const parsed = aircraftRow.safeParse(row);
  if (!parsed.success) return undefined;
  const plane = parsed.data;
  const candidate = aircraftSchema.safeParse({
    located: locatedBy(plane.type),
    hex: plane.hex,
    callsign: text(plane.flight),
    registration: text(plane.r),
    aircraftType: text(plane.t),
    latitude: plane.lat,
    longitude: plane.lon,
    onGround: plane.alt_baro === 'ground',
    altitudeFeet: typeof plane.alt_baro === 'number' ? plane.alt_baro : null,
    groundSpeedKnots: plane.gs ?? null,
    trackDegrees: plane.track ?? null,
    observedAt: toInstant(new Date(answeredAt - Math.round(plane.seen_pos * 1000))),
  });
  return candidate.success ? candidate.data : undefined;
}

/** Reads an ADS-B Exchange v2 answer of either provider into the aircraft around New York. */
export function parseAirTraffic(
  body: Uint8Array,
  receivedAt: Date,
  dialect: AdsbDialect,
): ParseResult<AirTraffic> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const answer = answerSchema.safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const rows = answer.data[dialect.list];
  if (rows === undefined) return refuse('unexpected-shape', `${dialect.list}: no aircraft list`);
  if (answer.data.msg !== undefined && answer.data.msg !== 'No error') {
    return refuse('provider-error', answer.data.msg);
  }
  const answeredAt = Math.round(answer.data.now * (dialect.nowUnit === 's' ? 1000 : 1));
  if (answeredAt - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return refuse('future-answer', `now ${toInstant(new Date(answeredAt))} is after receipt.`);
  }
  const aircraft = rows.flatMap((row) => aircraftOf(row, answeredAt) ?? []);
  const leftOut = rows.length - aircraft.length;
  // Three of the busiest airports always have aircraft moving or parked with ADS-B on.
  if (aircraft.length === 0) {
    return refuse('empty-area', `${String(leftOut)} aircraft, none with a usable position.`);
  }
  const flying = aircraft.filter((plane) => !plane.onGround).length;
  return {
    ok: true,
    data: { answeredAt: toInstant(new Date(answeredAt)), aircraft, leftOut },
    dataTime: new Date(answeredAt),
    coverage: `${count(aircraft.length, 'aircraft')}, ${count(flying, 'airborne')}, ${String(leftOut)} left out`,
  };
}

/** The failures of reading an answer, after the HTTP ones of each provider. */
export const ANSWER_FAILURES: readonly KnownFailure[] = [
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as an HTML error page',
    state: 'degraded',
    remedy: 'Keep the last good positions with their age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection: 'No now or aircraft list: the answer of the API changed',
    state: 'misconfigured',
    remedy: 'Compare with the capture and the API reference, then update the reader',
  },
  {
    code: 'provider-error',
    detection: 'msg is present and is not "No error"',
    state: 'degraded',
    remedy: 'Refused; the message is kept as evidence and the next run tries again',
  },
  {
    code: 'future-answer',
    detection: 'now is more than 2 minutes after the download',
    state: 'degraded',
    remedy: 'Refused until the provider clock is right again',
  },
  {
    code: 'empty-area',
    detection: 'No aircraft with a usable position around the three airports',
    state: 'degraded',
    remedy: 'Refused: an empty sky over New York means missing receivers, not no traffic',
  },
  {
    code: 'older-than-served',
    detection: 'now is earlier than the answer served, as from a stale cache',
    state: 'degraded',
    remedy: 'Keep the newer positions; the next run normally brings current ones',
  },
];
