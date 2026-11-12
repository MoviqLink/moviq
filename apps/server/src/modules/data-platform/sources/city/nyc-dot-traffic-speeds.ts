import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import {
  fromNewYorkWallClockText,
  toNewYorkWallClockText,
} from '../../../../infrastructure/clock/new-york.js';
import { parseLinkPoints, positionSchema } from './nyc-dot-link-points.js';
import { decodeJson, describeIssue, olderThanServed, refuse, type Refusal } from './parsing.js';

const ENDPOINT = 'https://data.cityofnewyork.us/resource/i4gi-tjb9.json';
/** How far back the request looks; older readings are never asked for. */
const WINDOW_MS = 4 * 60 * 60_000;
const ROW_LIMIT = 1000;
/** A segment whose reading is this much older than the newest one is suspect, not current. */
const SUSPECT_AFTER_MS = 15 * 60_000;
/** Clocks may differ a little; a reading further ahead than this has the wrong time zone. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .transform(Number);

const rowSchema = z.object({
  id: z.string().min(1),
  speed: decimal,
  travel_time: decimal,
  data_as_of: z.string(),
  link_points: z.string().optional(),
  borough: z.string().optional(),
  link_name: z.string().optional(),
});

type Row = z.infer<typeof rowSchema>;

const segmentFields = {
  id: z.string(),
  name: z.string().nullable(),
  borough: z.string().nullable(),
  measuredAt: instantSchema,
  /** `[longitude, latitude]` points of the link, or null when it has no usable line. */
  path: z.array(positionSchema).nullable(),
};

const trafficSegmentSchema = z.object({
  ...segmentFields,
  speedMph: z.number().positive(),
  travelTimeSeconds: z.number().positive(),
});

const suspectSegmentSchema = z.object({
  ...segmentFields,
  /** `old-measurement`: no new reading for a while. `anomalous-reading`: zero speed or time. */
  reason: z.enum(['old-measurement', 'anomalous-reading']),
});

const trafficSpeedsSchema = z.object({
  /** The newest reading of the answer, which is the time of the data. */
  measuredUpTo: instantSchema,
  segments: z.array(trafficSegmentSchema),
  suspect: z.array(suspectSegmentSchema),
  droppedPoints: z.number().int().nonnegative(),
});

type TrafficSegment = z.infer<typeof trafficSegmentSchema>;
type SuspectSegment = z.infer<typeof suspectSegmentSchema>;
export type TrafficSpeeds = z.infer<typeof trafficSpeedsSchema>;

interface Reading {
  readonly row: Row;
  readonly measuredAt: Date;
}

/** The newest reading of each segment; an earlier one of the same segment is history. */
function newestBySegment(readings: readonly Reading[]): Reading[] {
  const newest = new Map<string, Reading>();
  for (const reading of readings) {
    const held = newest.get(reading.row.id);
    if (held === undefined || reading.measuredAt > held.measuredAt) {
      newest.set(reading.row.id, reading);
    }
  }
  return [...newest.values()];
}

function classify(readings: readonly Reading[], measuredUpTo: Date): TrafficSpeeds {
  const segments: TrafficSegment[] = [];
  const suspect: SuspectSegment[] = [];
  let droppedPoints = 0;
  for (const { row, measuredAt } of readings) {
    const line = parseLinkPoints(row.link_points);
    droppedPoints += line.dropped;
    const base = {
      id: row.id,
      name: row.link_name?.trim() ?? null,
      borough: row.borough?.trim() ?? null,
      measuredAt: toInstant(measuredAt),
      path: line.path,
    };
    // NYC DOT warns that missing travel times give extremely low speeds: those are not jams.
    if (row.speed <= 0 || row.travel_time <= 0) {
      suspect.push({ ...base, reason: 'anomalous-reading' });
    } else if (measuredUpTo.getTime() - measuredAt.getTime() > SUSPECT_AFTER_MS) {
      suspect.push({ ...base, reason: 'old-measurement' });
    } else {
      segments.push({ ...base, speedMph: row.speed, travelTimeSeconds: row.travel_time });
    }
  }
  const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);
  return {
    measuredUpTo: toInstant(measuredUpTo),
    segments: segments.sort(byId),
    suspect: suspect.sort(byId),
    droppedPoints,
  };
}

function readRows(body: Uint8Array): { readonly ok: true; readonly readings: Reading[] } | Refusal {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const rows = z.array(rowSchema).safeParse(decoded.value);
  if (!rows.success) return refuse('unexpected-shape', describeIssue(rows.error));
  const readings: Reading[] = [];
  for (const row of rows.data) {
    const measuredAt = fromNewYorkWallClockText(row.data_as_of);
    if (measuredAt === undefined) {
      return refuse('bad-timestamp', `Segment ${row.id} has data_as_of "${row.data_as_of}".`);
    }
    readings.push({ row, measuredAt });
  }
  return { ok: true, readings };
}

function parseSpeeds(body: Uint8Array, receivedAt: Date): ParseResult<TrafficSpeeds> {
  const read = readRows(body);
  if (!read.ok) return read;
  if (read.readings.length === 0) {
    return refuse('no-recent-readings', 'The answer has no reading from the last 4 hours.');
  }
  const newest = newestBySegment(read.readings);
  const measuredUpTo = new Date(Math.max(...newest.map((reading) => reading.measuredAt.getTime())));
  if (measuredUpTo.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return refuse(
      'future-measurement',
      `The newest reading, ${toInstant(measuredUpTo)}, is after its download.`,
    );
  }
  const data = classify(newest, measuredUpTo);
  if (data.segments.length === 0) {
    return refuse('no-valid-readings', `All ${String(newest.length)} segments are suspect.`);
  }
  return {
    ok: true,
    data,
    dataTime: measuredUpTo,
    coverage: `${String(data.segments.length)} segments, ${String(data.suspect.length)} suspect`,
  };
}

function coverageDrop(data: TrafficSpeeds, previous: TrafficSpeeds | undefined): string[] {
  if (previous === undefined || data.segments.length * 2 >= previous.segments.length) return [];
  const now = String(data.segments.length);
  return [`coverage-drop: ${now} segments, ${String(previous.segments.length)} before`];
}

/** The query string, with `$` kept as Socrata writes it and values percent-encoded. */
function socrataQuery(now: Date): string {
  const since = toNewYorkWallClockText(new Date(now.getTime() - WINDOW_MS));
  const parameters = [
    ['$select', 'id,speed,travel_time,data_as_of,link_points,borough,link_name'],
    ['$where', `data_as_of > '${since}'`],
    ['$order', 'data_as_of DESC'],
    ['$limit', String(ROW_LIMIT)],
  ];
  return parameters
    .map(([key = '', value = '']) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * NYC DOT traffic speeds (NYC Open Data, dataset i4gi-tjb9): speed, travel time, time of the
 * reading and line of each sensor link. The time of the data is that of the newest reading;
 * links whose reading is older by more than 15 minutes, or reads zero, are kept apart as suspect.
 *
 * Rhythm and freshness: sensors report about every 5 minutes (readings at :02, :07, :12… on
 * 10/11/2026), so asking more often brings nothing new and there is no faster rhythm. The Open
 * Data copy arrives in batches and lagged about 2 hours on 11/11/2026, and one of its replicas
 * 5.5 hours: a reading of 20 minutes is degraded, of an hour stale, and of 4 hours, the window
 * asked for, unavailable.
 *
 * Licence: the NYC.gov terms of use (https://www.nyc.gov/main/terms-of-use); the dataset's own
 * metadata says the feed "is freely available to the public", with no warranty of accuracy.
 */
export const nycDotTrafficSpeedsSource: SourceDefinition<TrafficSpeeds> = {
  id: 'nyc-dot-traffic-speeds',
  title: 'New York traffic speeds',
  provider: 'NYC Department of Transportation (NYC Open Data)',
  licence: {
    name: 'NYC.gov terms of use; freely available to the public',
    url: 'https://www.nyc.gov/main/terms-of-use',
    attribution: 'NYC Department of Transportation, Traffic Speeds (NYC Open Data)',
  },
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 5 * 60_000 },
  freshness: {
    degradedAfterMs: 20 * 60_000,
    staleAfterMs: 60 * 60_000,
    unavailableAfterMs: WINDOW_MS,
  },
  limits: { timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: trafficSpeedsSchema,
  request({ now }) {
    return { url: `${ENDPOINT}?${socrataQuery(now)}`, headers: { accept: 'application/json' } };
  },
  parse(body, { receivedAt }) {
    return parseSpeeds(body, receivedAt);
  },
  check(data, previous) {
    return [
      ...olderThanServed(data.measuredUpTo, previous?.measuredUpTo),
      ...coverageDrop(data, previous),
    ];
  },
  consumers: ['road-times', 'trip-watch'],
  failures: [
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page from the portal.',
      state: 'degraded',
      remedy: 'Keep the last good speeds with their age; the next run tries again.',
    },
    {
      code: 'unexpected-shape',
      detection: 'The answer is not a list of rows with id, speed, travel_time and data_as_of.',
      state: 'misconfigured',
      remedy: 'The dataset changed: compare with the capture and update the reader.',
    },
    {
      code: 'bad-timestamp',
      detection: 'A data_as_of is not a New York time like "2026-11-10T18:07:07.000".',
      state: 'misconfigured',
      remedy: 'Without the time of each reading its age is unknown: update the reader.',
    },
    {
      code: 'no-recent-readings',
      detection: 'An empty list: a replica of the portal behind by hours (seen 11/11/2026).',
      state: 'degraded',
      remedy: 'Keep the last good speeds ageing; another replica usually answers next time.',
    },
    {
      code: 'future-measurement',
      detection: 'The newest reading is more than 5 minutes after the download.',
      state: 'misconfigured',
      remedy: 'The time zone of data_as_of changed: fix the conversion from New York time.',
    },
    {
      code: 'no-valid-readings',
      detection: 'Every segment reads zero speed or time, or is far behind the newest.',
      state: 'degraded',
      remedy: 'Serve nothing new: zeros are missing readings, not traffic jams.',
    },
    {
      code: 'older-than-served',
      detection: 'The newest reading is earlier than the one served: a lagging replica.',
      state: 'degraded',
      remedy: 'Keep the newer speeds; the up-to-date replica answers on another run.',
    },
    {
      code: 'coverage-drop',
      detection: 'Fewer than half as many current segments as the speeds served.',
      state: 'degraded',
      remedy: 'Keep the fuller speeds while they are fresh; look at the sensors in the panel.',
    },
  ],
};
