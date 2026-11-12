import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { HOUR, count } from '../mta/provider.js';
import { geometrySchema } from '../ny511/provider.js';
import {
  NYC_OPEN_DATA,
  coversDate,
  newYorkDate,
  nycOpenDataLicence,
  readRows,
  socrataDate,
  socrataFailures,
} from './socrata.js';

const BOROUGHS = {
  M: 'Manhattan',
  B: 'Brooklyn',
  Q: 'Queens',
  X: 'Bronx',
  S: 'Staten Island',
} as const;

/** One row of "Street Closures due to construction activities by Block" (`i6b5-j7bu`). */
const closureRow = z.object({
  uniqueid: z.string().min(1),
  segmentid: z.string().min(1),
  onstreetname: z.string().min(1),
  fromstreetname: z.string().optional(),
  tostreetname: z.string().optional(),
  borough_code: z.enum(['M', 'B', 'Q', 'X', 'S']),
  work_start_date: socrataDate,
  work_end_date: socrataDate,
  purpose: z.string().optional(),
  the_geom: geometrySchema,
});

const closureSchema = z.object({
  id: z.string().min(1),
  /** The LION street segment of NYC Planning. */
  segment: z.string().min(1),
  street: z.string().min(1),
  from: z.string().nullable(),
  to: z.string().nullable(),
  borough: z.enum(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']),
  /** The permitted work, such as `DOT IN-HOUSE PAVING`. */
  purpose: z.string().nullable(),
  /** New York dates, as the dataset gives no hours. */
  firstDay: z.iso.date(),
  lastDay: z.iso.date(),
  geometry: geometrySchema,
});

const streetClosuresSchema = z.object({
  /** The New York date the closures are for. */
  date: z.iso.date(),
  readAt: instantSchema,
  closures: z.array(closureSchema),
  /** Rows without the published fields. */
  leftOut: z.number().int().nonnegative(),
});

export type StreetClosures = z.infer<typeof streetClosuresSchema>;
type Closure = z.infer<typeof closureSchema>;
type ClosureRow = z.infer<typeof closureRow>;

/** 3,191 rows (3,035 blocks) for 11/11/2026, a Wednesday; a weekend has fewer. */
const MINIMUM_CLOSURES = 300;

function toClosure(row: ClosureRow): Closure {
  return {
    id: row.uniqueid,
    segment: row.segmentid,
    street: row.onstreetname.trim(),
    from: row.fromstreetname?.trim() ?? null,
    to: row.tostreetname?.trim() ?? null,
    borough: BOROUGHS[row.borough_code],
    purpose: row.purpose ?? null,
    firstDay: row.work_start_date,
    lastDay: row.work_end_date,
    geometry: row.the_geom,
  };
}

/** The portal repeats some rows whole: each block once. The same id with other data is refused. */
function onePerBlock(closures: readonly Closure[]): Closure[] | string {
  const byId = new Map<string, Closure>();
  for (const closure of closures) {
    const seen = byId.get(closure.id);
    if (seen === undefined) byId.set(closure.id, closure);
    else if (JSON.stringify(seen) !== JSON.stringify(closure)) return closure.id;
  }
  return [...byId.values()];
}

function parseClosures(body: Uint8Array, receivedAt: Date): ParseResult<StreetClosures> {
  const read = readRows(body, closureRow);
  if (!('rows' in read)) return read;
  const date = newYorkDate(receivedAt);
  const today = read.rows
    .map(toClosure)
    .filter((closure) => closure.firstDay <= date && closure.lastDay >= date);
  const closures = onePerBlock(today);
  if (typeof closures === 'string') {
    return { ok: false, code: 'check-failed', detail: `block ${closures} twice, with other data` };
  }
  return {
    ok: true,
    data: { date, readAt: toInstant(receivedAt), closures, leftOut: read.leftOut },
    dataTime: receivedAt,
    coverage: `${count(closures.length, 'blocks')} closed on ${date}, ${String(read.leftOut)} left out`,
  };
}

/**
 * Blocks closed today by permitted construction, from NYC DOT's "Street Closures due to
 * construction activities by Block" on NYC Open Data (`i6b5-j7bu`), with each block's line. The
 * dataset is updated daily and gives days, not hours: a closure covers the whole of its days.
 * Asked every hour, so a new day's list arrives within an hour of midnight in New York.
 */
export const nycStreetClosuresToday: SourceDefinition<StreetClosures> = {
  id: 'nyc-street-closures-today',
  title: 'NYC street closures for construction today',
  provider: 'NYC Department of Transportation (NYC Open Data)',
  licence: nycOpenDataLicence(
    'Street Closures due to construction activities by Block, NYC DOT (NYC Open Data, i6b5-j7bu)',
  ),
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: HOUR },
  freshness: { degradedAfterMs: 3 * HOUR, staleAfterMs: 12 * HOUR, unavailableAfterMs: 24 * HOUR },
  limits: { timeoutMs: 60_000, maxBytes: 16 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: streetClosuresSchema,
  request({ now }) {
    const where = coversDate('work_start_date', 'work_end_date', newYorkDate(now));
    return {
      url: `${NYC_OPEN_DATA}i6b5-j7bu.json?$where=${encodeURIComponent(where)}&$order=uniqueid&$limit=50000`,
    };
  },
  parse(body, { receivedAt }) {
    return parseClosures(body, receivedAt);
  },
  check(data) {
    return data.closures.length < MINIMUM_CLOSURES
      ? [`${count(data.closures.length, 'blocks')}, minimum ${String(MINIMUM_CLOSURES)}`]
      : [];
  },
  consumers: ['live-map', 'trip-watch'],
  failures: socrataFailures(
    'data.cityofnewyork.us',
    `Fewer than ${String(MINIMUM_CLOSURES)} blocks, or a block twice with other data`,
  ),
};
