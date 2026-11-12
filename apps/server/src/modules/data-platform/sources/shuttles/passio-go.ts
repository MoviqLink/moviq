import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import {
  fromNewYorkWallClock,
  toNewYorkWallClockText,
} from '../../../../infrastructure/clock/new-york.js';
import type { KnownFailure, ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { DAY, MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

const SYSTEM_NAMES = [
  'nyu',
  'downtown-connection',
  'hutch-metro-center',
  'liu',
  'hoboken',
] as const;
type SystemName = (typeof SYSTEM_NAMES)[number];

/** The Passio GO systems read, by the id of `mapGetData.php?getSystems=2` (11/11/2026). */
const SYSTEMS: ReadonlyMap<string, SystemName> = new Map([
  ['1007', 'nyu'],
  ['7073', 'downtown-connection'],
  ['1569', 'hutch-metro-center'],
  ['5082', 'liu'],
  ['466', 'hoboken'],
]);

/** The query the public map sends in its `json` parameter: one key per system, and their count. */
const QUERY = {
  ...Object.fromEntries([...SYSTEMS.keys()].map((id, index) => [`s${String(index)}`, id])),
  sA: SYSTEMS.size,
};

const PASSIO_GO_URL =
  'https://passiogo.com/mapGetData.php?getBuses=2&json=' +
  encodeURIComponent(JSON.stringify(QUERY));

/** A clock time of the map, `10:22 PM`, in the time of the systems, all in New York. */
const CLOCK = /^(\d{1,2}):(\d{2}) ([AP]M)$/;
const FUTURE_TOLERANCE_MS = 2 * MINUTE;

/** PHP writes an empty map as `[]`. */
const keyed = <T extends z.ZodType>(value: T) =>
  z.union([z.record(z.string(), value), z.array(z.never()).length(0)]);

const answerSchema = z.object({
  buses: keyed(z.array(z.unknown())),
  /** The clock of each system when the map answered. */
  time: keyed(z.string()),
});

const numeric = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

const busRow = z.object({
  deviceId: z.number().int(),
  busName: z.string().min(1),
  userId: z.string(),
  routeId: z.string().min(1),
  route: z.string().min(1),
  latitude: numeric,
  longitude: numeric,
  calculatedCourse: numeric.nullable().optional(),
  paxLoad: z.number().int().nonnegative(),
  totalCap: z.number().int().nonnegative(),
  outOfService: z.union([z.literal(0), z.literal(1)]),
  outdated: z.union([z.literal(0), z.literal(1)]),
  createdTime: z.string(),
});

const shuttleSchema = z.object({
  /** Each bus sends the position of its own GPS receiver. */
  located: z.literal('gps'),
  system: z.enum(SYSTEM_NAMES),
  vehicleId: z.string().min(1),
  /** The bus name of the operator, such as `2146` or `Shark Shuttle 01`. */
  name: z.string().min(1),
  routeId: z.string().min(1),
  /** The route as the operator names it, such as `Route A`. */
  route: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  courseDegrees: z.number().min(0).max(360).nullable(),
  /** People on board by the bus counter, and its capacity; both null where it counts none. */
  passengers: z.number().int().nonnegative().nullable(),
  capacity: z.number().int().positive().nullable(),
  /** The minute of the report: the map gives no seconds. */
  observedAt: instantSchema,
});

export const passioGoSchema = z.object({
  answeredAt: instantSchema,
  /** Buses in service; an empty list is valid outside the hours of every system. */
  shuttles: z.array(shuttleSchema),
  leftOut: z.object({
    /** Marked out of service by the operator. */
    outOfService: z.number().int().nonnegative(),
    /** With a position the map itself marks as outdated. */
    outdated: z.number().int().nonnegative(),
    /** Another system, or a row without a usable route, place or time. */
    unusable: z.number().int().nonnegative(),
  }),
});

export type PassioGoShuttles = z.infer<typeof passioGoSchema>;
type Shuttle = z.infer<typeof shuttleSchema>;
type LeftOut = PassioGoShuttles['leftOut'];

function onNewYorkDayOf(instant: Date, hour: number, minute: number): Date | undefined {
  const [year = 0, month = 0, day = 0] = toNewYorkWallClockText(instant)
    .slice(0, 10)
    .split('-')
    .map(Number);
  return fromNewYorkWallClock({ year, month, day, hour, minute, second: 0 });
}

/**
 * The instant of a map clock time: on the New York day of receipt, or the day before when that
 * would be ahead of receipt (a report from before midnight read just after it).
 */
export function instantOfClock(clock: string, receivedAt: Date): Date | undefined {
  const match = CLOCK.exec(clock);
  if (match === null) return undefined;
  const [, hours = '', minutes = '', half] = match;
  const hour = (Number(hours) % 12) + (half === 'PM' ? 12 : 0);
  const today = onNewYorkDayOf(receivedAt, hour, Number(minutes));
  if (today === undefined || today.getTime() - receivedAt.getTime() <= FUTURE_TOLERANCE_MS) {
    return today;
  }
  return onNewYorkDayOf(new Date(receivedAt.getTime() - DAY), hour, Number(minutes));
}

type Outcome = { readonly shuttle: Shuttle } | { readonly leftOut: keyof LeftOut };

function shuttleOf(row: unknown, receivedAt: Date): Outcome {
  const parsed = busRow.safeParse(row);
  if (!parsed.success) return { leftOut: 'unusable' };
  const bus = parsed.data;
  if (bus.outOfService === 1) return { leftOut: 'outOfService' };
  if (bus.outdated === 1) return { leftOut: 'outdated' };
  const observedAt = instantOfClock(bus.createdTime, receivedAt);
  if (observedAt === undefined) return { leftOut: 'unusable' };
  const counted = bus.totalCap > 0;
  const course = bus.calculatedCourse ?? Number.NaN;
  const candidate = shuttleSchema.safeParse({
    located: 'gps',
    system: SYSTEMS.get(bus.userId),
    vehicleId: String(bus.deviceId),
    name: bus.busName.trim(),
    routeId: bus.routeId,
    route: bus.route.trim(),
    latitude: bus.latitude,
    longitude: bus.longitude,
    // A bad course does not cost the bus its place.
    courseDegrees: course >= 0 && course <= 360 ? course : null,
    passengers: counted ? bus.paxLoad : null,
    capacity: counted ? bus.totalCap : null,
    observedAt: toInstant(observedAt),
  });
  return candidate.success ? { shuttle: candidate.data } : { leftOut: 'unusable' };
}

function parsePassioGo(body: Uint8Array, receivedAt: Date): ParseResult<PassioGoShuttles> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const answer = answerSchema.safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const clocks = Object.values(answer.data.time).flatMap((clock) => {
    const instant = instantOfClock(clock, receivedAt);
    return instant === undefined ? [] : [instant.getTime()];
  });
  if (clocks.length === 0) return refuse('no-answer-time', 'No system carries a clock time.');
  const answeredAt = new Date(Math.max(...clocks));
  const shuttles: Shuttle[] = [];
  const leftOut: LeftOut = { outOfService: 0, outdated: 0, unusable: 0 };
  for (const row of Object.values(answer.data.buses).flat()) {
    const outcome = shuttleOf(row, receivedAt);
    if ('shuttle' in outcome) shuttles.push(outcome.shuttle);
    else leftOut[outcome.leftOut] += 1;
  }
  const newest = Math.max(...shuttles.map((shuttle) => Date.parse(shuttle.observedAt)));
  const counted = shuttles.filter((shuttle) => shuttle.capacity !== null).length;
  return {
    ok: true,
    data: { answeredAt: toInstant(answeredAt), shuttles, leftOut },
    dataTime: shuttles.length === 0 ? answeredAt : new Date(newest),
    coverage: [
      count(shuttles.length, 'shuttles'),
      count(counted, 'with a passenger count'),
      `${String(leftOut.outOfService + leftOut.outdated + leftOut.unusable)} left out`,
    ].join(', '),
  };
}

const FAILURES: readonly KnownFailure[] = [
  ...httpFailures('passiogo.com', 'https://passiogo.com/'),
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as a PHP error page',
    state: 'degraded',
    remedy: 'Keep the last good positions with their age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection: 'No buses or time map: the answer of the public map changed',
    state: 'misconfigured',
    remedy: 'Compare with the capture and the map of passiogo.com, then update the reader',
  },
  {
    code: 'no-answer-time',
    detection: 'No system of the answer carries a clock time, so the data has no time',
    state: 'degraded',
    remedy: 'Refused: data without a time is never served',
  },
  {
    code: 'older-than-served',
    detection: 'The answer clock is earlier than the one served, as from a stale cache',
    state: 'degraded',
    remedy: 'Keep the newer positions; the next run normally brings current ones',
  },
];

/**
 * The shuttles of NYU, Long Island University, the Free Downtown Connection (Lower Manhattan),
 * Hutch Metro Center (the Bronx) and Hoboken, read as the public map of Passio GO reads them:
 * one GET without a key or a cookie. NYU publishes no GTFS Realtime feed (404), so this is the
 * only source of its buses, and the only one that carries the passenger counter.
 *
 * Rhythm and freshness: reports carry the minute only; bus 2146 of NYU moved from one minute to
 * the next on 11/11/2026. Every 30 seconds while a trip is watched and every minute at rest; three
 * minutes without a newer report degrade it.
 *
 * Terms: Passio GO publishes none for the data of its map (none found on 11/11/2026).
 */
export const passioGoSource: SourceDefinition<PassioGoShuttles> = {
  id: 'passio-go-shuttles',
  title: 'University and district shuttles (Passio GO)',
  provider: 'Passio GO public map (Passio Technologies)',
  licence: {
    name: 'No published terms (Passio GO public map)',
    url: 'https://passiogo.com/',
    attribution: 'Shuttle positions from Passio GO',
  },
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: MINUTE, interestIntervalMs: 30_000 },
  freshness: {
    degradedAfterMs: 3 * MINUTE,
    staleAfterMs: 6 * MINUTE,
    unavailableAfterMs: 15 * MINUTE,
  },
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  keepVersions: 1,
  dataSchema: passioGoSchema,
  request() {
    return { url: PASSIO_GO_URL, headers: { accept: 'application/json' } };
  },
  parse(body, { receivedAt }) {
    return parsePassioGo(body, receivedAt);
  },
  check(data, previous) {
    return olderThanServed(data.answeredAt, previous?.answeredAt);
  },
  consumers: ['live-map', 'trip-watch'],
  failures: FAILURES,
};
