import {
  instantSchema,
  restroomFactsSchema,
  toInstant,
  type RestroomFacts,
} from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, MINUTE, count } from '../mta/provider.js';
import { NYC_OPEN_DATA, nycOpenDataLicence, readRows, socrataFailures } from './socrata.js';

const COLUMNS =
  'facility_name,location_type,operator,status,open,hours_of_operation,accessibility,' +
  'restroom_type,changing_stations,additional_notes,website,latitude,longitude';

/** A text field; the portal writes some values inside quotes (`"Yes, in men's restroom only"`). */
const text = z
  .string()
  .optional()
  .transform((value) => {
    const bare = (value ?? '')
      .trim()
      .replace(/^"([\s\S]*)"$/, '$1')
      .trim();
    return bare === '' || bare === 'N/A' ? null : bare;
  });

/** One row of NYC Open Data's "Public Restrooms" (`i7jb-7jku`). */
const restroomRow = z.object({
  facility_name: z.string().trim().min(1),
  location_type: text,
  operator: text,
  status: z.string().trim().min(1),
  open: text,
  hours_of_operation: text,
  accessibility: text,
  restroom_type: text,
  changing_stations: text,
  additional_notes: text,
  website: z.object({ url: z.string() }).optional(),
  latitude: z.string().transform(Number).pipe(z.number().min(40.4).max(41)),
  longitude: z.string().transform(Number).pipe(z.number().min(-74.3).max(-73.6)),
});

type RestroomRow = z.output<typeof restroomRow>;

const restroomSchema = z.object({
  name: z.string().min(1),
  point: z.tuple([z.number(), z.number()]),
  facts: restroomFactsSchema,
});

const restroomsSchema = z.object({
  readAt: instantSchema,
  /** In service (`Operational`) and open to the public, once each. */
  restrooms: z.array(restroomSchema),
  /** Listed as not operational, closed or closed for construction: never shown. */
  notInService: z.number().int().nonnegative(),
  /** In service by the list, but its note keeps it for staff: never shown. */
  staffOnly: z.number().int().nonnegative(),
  leftOut: z.number().int().nonnegative(),
});

export type PublicRestrooms = z.infer<typeof restroomsSchema>;
export type PublicRestroom = PublicRestrooms['restrooms'][number];

/** 998 of 1,100 rows were in service on 11/11/2026. */
const MINIMUM_RESTROOMS = 700;

const ACCESS: Readonly<Record<string, RestroomFacts['access']>> = {
  'fully accessible': 'full',
  'partially accessible': 'partial',
  'limited accessibility': 'limited',
  'not accessible': 'none',
};

const STALLS: Readonly<Record<string, RestroomFacts['stalls']>> = {
  'multi-stall w/m restrooms': 'multi-stall-gendered',
  'multi-stall all gender restrooms': 'multi-stall-all-gender',
  'single-stall all gender restroom(s)': 'single-stall-all-gender',
  'single-stall w/m restrooms': 'single-stall-gendered',
  'both single-stall all gender and multi-stall w/m': 'both',
};

const CHANGING: Readonly<Record<string, RestroomFacts['changingTable']>> = {
  yes: 'yes',
  no: 'no',
  "yes, in women's restroom only": 'women',
  "yes, in men's restroom only": 'men',
  'yes, in single-stall all gender restroom only': 'all-gender',
};

const SEASON: Readonly<Record<string, RestroomFacts['season']>> = {
  'year round': 'year-round',
  seasonal: 'seasonal',
};

/** `Single -Stall` and `Single-Stall` are one word; case does not matter. */
const keyOf = (value: string | null): string =>
  (value ?? '')
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');

const KEY_OR_CODE = /\bkeys?\b|\bcodes?\b/i;
const STAFF_ONLY = /\b(?:staff|employees) only\b/i;

/** The hours line by line, with the spaces and tabs of the portal made single spaces. */
function hoursOf(value: string | null): string | null {
  if (value === null) return null;
  const lines = value
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter((line) => line !== '');
  return lines.length === 0 ? null : lines.join('\n');
}

const websiteOf = (row: RestroomRow): string | null => {
  const parsed = restroomFactsSchema.shape.website.safeParse(row.website?.url.trim());
  return parsed.success ? parsed.data : null;
};

function toRestroom(row: RestroomRow): PublicRestroom {
  return {
    name: row.facility_name,
    point: [row.longitude, row.latitude],
    facts: {
      placeType: row.location_type,
      operator: row.operator,
      hours: hoursOf(row.hours_of_operation),
      season: SEASON[keyOf(row.open)] ?? null,
      access: ACCESS[keyOf(row.accessibility)] ?? null,
      stalls: STALLS[keyOf(row.restroom_type)] ?? null,
      changingTable: CHANGING[keyOf(row.changing_stations)] ?? null,
      keyOrCode: row.additional_notes !== null && KEY_OR_CODE.test(row.additional_notes),
      note: row.additional_notes,
      website: websiteOf(row),
    },
  };
}

function parseRestrooms(body: Uint8Array, receivedAt: Date): ParseResult<PublicRestrooms> {
  const read = readRows(body, restroomRow);
  if (!('rows' in read)) return read;
  const inService = read.rows.filter((row) => row.status === 'Operational');
  const open = inService.filter((row) => !STAFF_ONLY.test(row.additional_notes ?? ''));
  // A place listed twice with the same name and point is one restroom.
  const seen = new Set<string>();
  const restrooms = open.map(toRestroom).filter((restroom) => {
    const key = `${restroom.name}|${restroom.point.join(',')}`;
    return !seen.has(key) && seen.add(key);
  });
  const notInService = read.rows.length - inService.length;
  return {
    ok: true,
    data: {
      readAt: toInstant(receivedAt),
      restrooms,
      notInService,
      staffOnly: inService.length - open.length,
      leftOut: read.leftOut,
    },
    dataTime: receivedAt,
    coverage:
      `${count(restrooms.length, 'restrooms')} in service, ${String(notInService)} not in ` +
      `service, ${String(read.leftOut)} left out`,
  };
}

/**
 * The City's public restrooms (`i7jb-7jku`): parks, libraries, plazas and stations, all free to
 * use. Only those listed `Operational` are served; the hours are kept as published, line by line,
 * and never read as "open now": the forms are many and some contradict themselves (`10:00 pm -
 * 6:00 pm`). The list is updated as places open and close; read daily, dated by receipt.
 */
export const nycPublicRestrooms: SourceDefinition<PublicRestrooms> = {
  id: 'nyc-public-restrooms',
  title: 'NYC public restrooms',
  provider: 'NYC Parks, public libraries and partners (NYC Open Data)',
  licence: nycOpenDataLicence('Public Restrooms, City of New York (NYC Open Data, i7jb-7jku)'),
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 4 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: restroomsSchema,
  request() {
    return {
      url: `${NYC_OPEN_DATA}i7jb-7jku.json?$select=${COLUMNS}&$order=facility_name,latitude&$limit=5000`,
    };
  },
  parse(body, { receivedAt }) {
    return parseRestrooms(body, receivedAt);
  },
  check(data) {
    return data.restrooms.length < MINIMUM_RESTROOMS
      ? [`${count(data.restrooms.length, 'restrooms')}, minimum ${String(MINIMUM_RESTROOMS)}`]
      : [];
  },
  consumers: ['live-map'],
  failures: socrataFailures(
    'data.cityofnewyork.us',
    `Fewer than ${String(MINIMUM_RESTROOMS)} restrooms in service`,
  ),
};
