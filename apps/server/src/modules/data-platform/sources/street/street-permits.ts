import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import { fromNewYorkWallClockText } from '../../../../infrastructure/clock/new-york.js';
import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, HOUR, count } from '../mta/provider.js';
import {
  NYC_OPEN_DATA,
  coversDate,
  newYorkDate,
  nycOpenDataLicence,
  readRows,
  socrataFailures,
} from './socrata.js';

/** The statuses of a permit in force: issued, confirmed by the permittee, or an emergency. */
const IN_FORCE = ['ISSUED & PRINTED', "CONFIRMATION REC'D", 'EMERGENCY'] as const;

const COLUMNS = [
  'permitnumber',
  'permitstatusshortdesc',
  'permitseriesshortdesc',
  'permittypedesc',
  'issuedworkstartdate',
  'issuedworkenddate',
  'permithousenumber',
  'onstreetname',
  'fromstreetname',
  'tostreetname',
  'permitpurposecomments',
  'permitlocationcomments',
  'specificstipulations',
].join(',');

/** Zone-less times of DOT permits are New York times: work ends at `23:59:59` of its last day. */
const newYorkTime = z
  .string()
  .transform((text) => fromNewYorkWallClockText(text))
  .pipe(z.date());

const optionalText = z
  .string()
  .optional()
  .transform((text) => (text === undefined || text.trim() === '' ? null : text.trim()));

/** One row of "Street Construction Permits (2022 - Present)" (`tqtj-sjs8`). */
const permitRow = z.object({
  permitnumber: z.string().min(1),
  permitstatusshortdesc: z.enum(IN_FORCE),
  permitseriesshortdesc: z.string().min(1),
  permittypedesc: z.string().min(1),
  issuedworkstartdate: newYorkTime,
  issuedworkenddate: newYorkTime,
  permithousenumber: optionalText,
  onstreetname: optionalText,
  fromstreetname: optionalText,
  tostreetname: optionalText,
  permitpurposecomments: optionalText,
  permitlocationcomments: optionalText,
  specificstipulations: optionalText,
});

const permitSchema = z.object({
  number: z.string().min(1),
  status: z.enum(IN_FORCE),
  series: z.string().min(1),
  /** What the permit allows, such as `OCCUPANCY OF ROADWAY AS STIPULATED`. */
  type: z.string().min(1),
  /** The window the permit allows work in: not proof that work goes on in it. */
  workFrom: instantSchema,
  workTo: instantSchema,
  house: z.string().nullable(),
  street: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  purpose: z.string().nullable(),
  location: z.string().nullable(),
  /** Conditions written for this permit; the standard ones are asked by permit number. */
  stipulations: z.string().nullable(),
});

const streetPermitsSchema = z.object({
  date: z.iso.date(),
  borough: z.string().min(1),
  readAt: instantSchema,
  permits: z.array(permitSchema),
  leftOut: z.number().int().nonnegative(),
});

export type StreetPermits = z.infer<typeof streetPermitsSchema>;
type PermitRow = z.infer<typeof permitRow>;

/** Staten Island, the smallest borough, had 4,286 permits in force on 11/11/2026. */
const MINIMUM_PERMITS = 1_000;

function toPermit(row: PermitRow): z.infer<typeof permitSchema> {
  return {
    number: row.permitnumber,
    status: row.permitstatusshortdesc,
    series: row.permitseriesshortdesc,
    type: row.permittypedesc,
    workFrom: toInstant(row.issuedworkstartdate),
    workTo: toInstant(row.issuedworkenddate),
    house: row.permithousenumber,
    street: row.onstreetname?.replace(/\s+/g, ' ') ?? null,
    from: row.fromstreetname?.replace(/\s+/g, ' ') ?? null,
    to: row.tostreetname?.replace(/\s+/g, ' ') ?? null,
    purpose: row.permitpurposecomments,
    location: row.permitlocationcomments,
    stipulations: row.specificstipulations,
  };
}

function parsePermits(
  body: Uint8Array,
  borough: string,
  receivedAt: Date,
): ParseResult<StreetPermits> {
  const read = readRows(body, permitRow);
  if (!('rows' in read)) return read;
  const date = newYorkDate(receivedAt);
  const permits = read.rows
    .filter(
      (row) =>
        newYorkDate(row.issuedworkstartdate) <= date && newYorkDate(row.issuedworkenddate) >= date,
    )
    .map(toPermit);
  if (new Set(permits.map((permit) => permit.number)).size !== permits.length) {
    return { ok: false, code: 'check-failed', detail: 'a permit number listed twice' };
  }
  return {
    ok: true,
    data: { date, borough, readAt: toInstant(receivedAt), permits, leftOut: read.leftOut },
    dataTime: receivedAt,
    coverage: `${count(permits.length, 'permits')} in force on ${date}, ${String(read.leftOut)} left out`,
  };
}

/**
 * The street construction permits of one borough in force today, from NYC DOT's permits on NYC
 * Open Data (`tqtj-sjs8`): about 86,000 across the city on 11/11/2026, so one source per
 * borough keeps each list to a few megabytes. A permit allows work in a window; it is neither
 * work going on nor a closure, so it never blocks a route: closures come from
 * `nyc-street-closures-today` and `ny511-closures`. The dataset is updated daily: every 6 hours.
 */
function streetPermitsSource(borough: string, id: string): SourceDefinition<StreetPermits> {
  return {
    id: `nyc-street-permits-${id}`,
    title: `NYC street construction permits in force, ${borough}`,
    provider: 'NYC Department of Transportation (NYC Open Data)',
    licence: nycOpenDataLicence('Street Construction Permits, NYC DOT (NYC Open Data, tqtj-sjs8)'),
    kind: 'static',
    rhythm: { class: 'cold', baseIntervalMs: 6 * HOUR },
    freshness: { degradedAfterMs: 18 * HOUR, staleAfterMs: 3 * DAY, unavailableAfterMs: 7 * DAY },
    limits: { timeoutMs: 2 * 60_000, maxBytes: 48 * 1024 * 1024 },
    dataTimeSource: 'receipt',
    keepVersions: 1,
    dataSchema: streetPermitsSchema,
    request({ now }) {
      const statuses = IN_FORCE.map((status) => `'${status.replace(/'/g, "''")}'`).join(',');
      const where = [
        `boroughname='${borough.toUpperCase()}'`,
        coversDate('issuedworkstartdate', 'issuedworkenddate', newYorkDate(now)),
        `permitstatusshortdesc in(${statuses})`,
      ].join(' AND ');
      const query = `$select=${COLUMNS}&$where=${encodeURIComponent(where)}&$order=permitnumber`;
      return { url: `${NYC_OPEN_DATA}tqtj-sjs8.json?${query}&$limit=200000` };
    },
    parse(body, { receivedAt }) {
      return parsePermits(body, borough, receivedAt);
    },
    check(data) {
      return data.permits.length < MINIMUM_PERMITS
        ? [`${count(data.permits.length, 'permits')}, minimum ${String(MINIMUM_PERMITS)}`]
        : [];
    },
    consumers: ['live-map'],
    failures: socrataFailures(
      'data.cityofnewyork.us',
      `Fewer than ${String(MINIMUM_PERMITS)} permits, or a permit listed twice`,
    ),
  };
}

export const nycStreetPermitSources: readonly SourceDefinition<StreetPermits>[] = [
  streetPermitsSource('Manhattan', 'manhattan'),
  streetPermitsSource('Brooklyn', 'brooklyn'),
  streetPermitsSource('Queens', 'queens'),
  streetPermitsSource('Bronx', 'bronx'),
  streetPermitsSource('Staten Island', 'staten-island'),
];
