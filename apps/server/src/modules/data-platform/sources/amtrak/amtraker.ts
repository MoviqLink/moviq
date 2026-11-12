import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { KnownFailure, ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

/**
 * The approaches of Penn Station: the Northeast Corridor to Trenton, the Empire line to
 * Croton-Harmon and Peekskill, and the New Haven line past Stamford. Trains outside are counted,
 * not kept.
 */
const AREA = { south: 40.2, north: 41.3, west: -74.8, east: -73.3 } as const;

/** Clocks may differ a little; a train dated further ahead than this has a wrong clock. */
const FUTURE_TOLERANCE_MS = 2 * MINUTE;

const HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const STATE_NAMES = ['active', 'completed'] as const;
const STATES: ReadonlyMap<string, (typeof STATE_NAMES)[number]> = new Map([
  ['Active', 'active'],
  ['Completed', 'completed'],
]);
/** Before departure Amtraker gives no `updatedAt`, and `lastValTS` is the departure time. */
const PREDEPARTURE = 'Predeparture';

const instantText = z.string().refine((text) => !Number.isNaN(Date.parse(text)));

const trainRow = z.object({
  trainID: z.string().min(1),
  trainNum: z.string().min(1),
  routeName: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  heading: z.string(),
  velocity: z.number().nonnegative().optional(),
  trainState: z.string(),
  provider: z.string(),
  origCode: z.string().min(1),
  origName: z.string().min(1),
  destCode: z.string().min(1),
  destName: z.string().min(1),
  eventCode: z.string(),
  eventName: z.string(),
  updatedAt: instantText.nullable(),
  lastValTS: instantText,
});

const stationSchema = z.object({ code: z.string().min(1), name: z.string().min(1) });

const trainSchema = z.object({
  /** Amtrak trains send the position of their own GPS receiver. */
  located: z.literal('gps'),
  /** The train number and the day of its start, such as `67-10`. */
  trainId: z.string().min(1),
  number: z.string().min(1),
  route: z.string().min(1),
  state: z.enum(STATE_NAMES),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedMph: z.number().nonnegative().nullable(),
  heading: z.enum(HEADINGS).nullable(),
  origin: stationSchema,
  destination: stationSchema,
  /** The station the train is at or heading to. */
  nextStation: stationSchema.nullable(),
  /** When Amtrak last received the position (`lastValTS`). */
  observedAt: instantSchema,
});

const amtrakTrainsSchema = z.object({
  /** The newest `updatedAt` of an Amtrak train: Amtraker refreshes them in batches. */
  updatedAt: instantSchema,
  trains: z.array(trainSchema),
  /** Trains of the area waiting to depart, which have no position of their own yet. */
  notDeparted: z.number().int().nonnegative(),
  /** Amtrak trains elsewhere in the country, and VIA Rail and Brightline trains, not kept. */
  outsideArea: z.number().int().nonnegative(),
  otherNetworks: z.number().int().nonnegative(),
  /** Amtrak trains without a usable number, place, state or time. */
  leftOut: z.number().int().nonnegative(),
});

export type AmtrakTrains = z.infer<typeof amtrakTrainsSchema>;
type Train = z.infer<typeof trainSchema>;
type TrainRow = z.infer<typeof trainRow>;

function inArea(row: TrainRow): boolean {
  return (
    row.lat >= AREA.south && row.lat <= AREA.north && row.lon >= AREA.west && row.lon <= AREA.east
  );
}

function trainOf(row: TrainRow): Train | undefined {
  const heading = HEADINGS.find((value) => value === row.heading) ?? null;
  const candidate = trainSchema.safeParse({
    located: 'gps',
    trainId: row.trainID,
    number: row.trainNum,
    route: row.routeName,
    state: STATES.get(row.trainState),
    latitude: row.lat,
    longitude: row.lon,
    speedMph: row.velocity ?? null,
    heading,
    origin: { code: row.origCode, name: row.origName },
    destination: { code: row.destCode, name: row.destName },
    nextStation:
      row.eventCode === '' || row.eventName === ''
        ? null
        : { code: row.eventCode, name: row.eventName },
    observedAt: toInstant(new Date(row.lastValTS)),
  });
  return candidate.success ? candidate.data : undefined;
}

function parseAmtraker(body: Uint8Array, receivedAt: Date): ParseResult<AmtrakTrains> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const answer = z.record(z.string(), z.array(z.unknown())).safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const rows = Object.values(answer.data).flat();
  const amtrak: TrainRow[] = [];
  let otherNetworks = 0;
  let leftOut = 0;
  for (const value of rows) {
    const row = trainRow.safeParse(value);
    if (row.success && row.data.provider !== 'Amtrak') otherNetworks += 1;
    else if (row.success) amtrak.push(row.data);
    else leftOut += 1;
  }
  const updates = amtrak
    .flatMap((row) => (row.updatedAt === null ? [] : [Date.parse(row.updatedAt)]))
    .filter((time) => time - receivedAt.getTime() <= FUTURE_TOLERANCE_MS);
  if (updates.length === 0) {
    return refuse('no-trains', `${count(rows.length, 'trains')}, no Amtrak train with a time.`);
  }
  const updatedAt = new Date(Math.max(...updates));
  const near = amtrak.filter(inArea);
  const departed = near.filter((row) => row.trainState !== PREDEPARTURE);
  const trains = departed.flatMap((row) => trainOf(row) ?? []);
  leftOut += departed.length - trains.length;
  const moving = trains.filter((train) => train.state === 'active').length;
  return {
    ok: true,
    data: {
      updatedAt: toInstant(updatedAt),
      trains,
      notDeparted: near.length - departed.length,
      outsideArea: amtrak.length - near.length,
      otherNetworks,
      leftOut,
    },
    dataTime: updatedAt,
    coverage: [
      count(trains.length, 'trains around New York'),
      count(moving, 'active'),
      `${String(leftOut)} left out`,
    ].join(', '),
  };
}

const FAILURES: readonly KnownFailure[] = [
  ...httpFailures('api-v3.amtraker.com', 'https://www.npmjs.com/package/amtrak'),
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as an HTML error page of the CDN',
    state: 'degraded',
    remedy: 'Keep the last good trains with their age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection: 'The answer is not a map of train numbers to lists of trains',
    state: 'misconfigured',
    remedy: 'Compare with the capture and the Amtraker reference, then update the reader',
  },
  {
    code: 'no-trains',
    detection: 'No Amtrak train with a usable updatedAt in the whole country',
    state: 'degraded',
    remedy: 'Refused: Amtrak always runs trains, so none means Amtraker lost its source',
  },
  {
    code: 'older-than-served',
    detection: 'The newest updatedAt is earlier than the one served, as from a stale cache',
    state: 'degraded',
    remedy: 'Keep the newer trains; the next run normally brings current ones',
  },
];

/**
 * Amtrak trains around New York from Amtraker, an independent API that reads and decrypts the
 * official Amtrak map (no relation to Amtrak). It asks for a User-Agent that names the project;
 * MovIQ sends the generic browser identity of every request, which it accepts.
 *
 * Rhythm and freshness: Amtraker refreshes its trains in batches; `updatedAt` was 71 seconds old
 * on 11/11/2026 and 2 to 3 minutes in two earlier samples, with positions about 10 seconds older.
 * Every minute while a trip is watched and every two at rest; five minutes without a newer batch
 * degrade it.
 *
 * Licence: ODC-By 1.0, with a prominent credit to Amtraker linking to https://amtraker.com.
 */
export const amtrakerSource: SourceDefinition<AmtrakTrains> = {
  id: 'amtraker-new-york',
  title: 'Amtrak trains around New York (Amtraker)',
  provider: 'Amtraker (independent API over the Amtrak map)',
  licence: {
    name: 'Open Data Commons Attribution License (ODC-By) 1.0',
    url: 'https://opendatacommons.org/licenses/by/1-0/',
    attribution: 'Train data from Amtraker (https://amtraker.com)',
  },
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: 2 * MINUTE, interestIntervalMs: MINUTE },
  freshness: {
    degradedAfterMs: 5 * MINUTE,
    staleAfterMs: 15 * MINUTE,
    unavailableAfterMs: 30 * MINUTE,
  },
  limits: { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: amtrakTrainsSchema,
  request() {
    return {
      url: 'https://api-v3.amtraker.com/v3/trains',
      headers: { accept: 'application/json' },
    };
  },
  parse(body, { receivedAt }) {
    return parseAmtraker(body, receivedAt);
  },
  check(data, previous) {
    return olderThanServed(data.updatedAt, previous?.updatedAt);
  },
  consumers: ['live-map', 'trip-watch'],
  failures: FAILURES,
};
