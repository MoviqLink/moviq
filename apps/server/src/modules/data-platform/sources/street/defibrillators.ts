import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, MINUTE, count } from '../mta/provider.js';
import {
  NYC_OPEN_DATA,
  nycOpenDataLicence,
  readRows,
  socrataDate,
  socrataFailures,
} from './socrata.js';

const COLUMNS =
  'entity_name,address,floor,borough,zip,aednumaeds,latitude,longitude,location_type,last_updated';

const text = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? null : value.trim()));

/** One row of the "New York City Automated External Defibrillator (AED) Inventory" (`2er2-jqsx`). */
const defibrillatorRow = z.object({
  entity_name: z.string().min(1),
  address: z.string().min(1),
  floor: text,
  borough: z.string().min(1),
  zip: text,
  aednumaeds: z.string().regex(/^\d+$/).transform(Number).optional(),
  latitude: z.string().transform(Number).pipe(z.number().min(40.4).max(41)),
  longitude: z.string().transform(Number).pipe(z.number().min(-74.3).max(-73.6)),
  location_type: text,
  last_updated: socrataDate.optional(),
});

const defibrillatorSchema = z.object({
  /** Who registered it: a school, a business, a gym. */
  entity: z.string().min(1),
  address: z.string().min(1),
  /** Where inside, as registered (`Main Entrance`, `FL 01`, `Near Gym`); not opening hours. */
  place: z.string().nullable(),
  borough: z.string().min(1),
  zip: z.string().nullable(),
  units: z.number().int().nonnegative().nullable(),
  locationType: z.string().nullable(),
  /** The date of the row's last update, which only some rows have. */
  updatedOn: z.iso.date().nullable(),
  point: z.tuple([z.number(), z.number()]),
});

const defibrillatorsSchema = z.object({
  readAt: instantSchema,
  defibrillators: z.array(defibrillatorSchema),
  leftOut: z.number().int().nonnegative(),
});

export type Defibrillators = z.infer<typeof defibrillatorsSchema>;
type Defibrillator = z.infer<typeof defibrillatorSchema>;

/** 7,437 rows on 11/11/2026. */
const MINIMUM_DEFIBRILLATORS = 5_000;

function parseDefibrillators(body: Uint8Array, receivedAt: Date): ParseResult<Defibrillators> {
  const read = readRows(body, defibrillatorRow);
  if (!('rows' in read)) return read;
  const defibrillators = read.rows.map((row): Defibrillator => ({
    entity: row.entity_name.trim(),
    address: row.address.trim(),
    // The registry writes "-" or "N/A" when no place inside is given.
    place: row.floor === null || ['-', 'N/A'].includes(row.floor) ? null : row.floor,
    borough: row.borough.trim(),
    zip: row.zip,
    units: row.aednumaeds ?? null,
    locationType: row.location_type,
    updatedOn: row.last_updated ?? null,
    point: [row.longitude, row.latitude],
  }));
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), defibrillators, leftOut: read.leftOut },
    dataTime: receivedAt,
    coverage: `${count(defibrillators.length, 'places')}, ${String(read.leftOut)} left out`,
  };
}

/**
 * Where the registered defibrillators are, from the NYC REMSCO registry that the Department of
 * Health and Mental Hygiene publishes (`2er2-jqsx`; the map `2ync-kihj` is a view of it, and
 * answers rows without fields). It gives the building, the place inside and how many units, but
 * no opening hours: a defibrillator is never said to be reachable now. The rows were last
 * changed on 15/07/2026 and the dataset is updated yearly; read daily, dated by receipt.
 */
export const nycDefibrillators: SourceDefinition<Defibrillators> = {
  id: 'nyc-defibrillators',
  title: 'NYC automated external defibrillators',
  provider: 'NYC Department of Health and Mental Hygiene, NYC REMSCO (NYC Open Data)',
  licence: nycOpenDataLicence(
    'New York City AED Inventory, NYC Department of Health and Mental Hygiene (NYC Open Data, 2er2-jqsx)',
  ),
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 8 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: defibrillatorsSchema,
  request() {
    return {
      url: `${NYC_OPEN_DATA}2er2-jqsx.json?$select=${COLUMNS}&$order=latitude,longitude&$limit=50000`,
    };
  },
  parse(body, { receivedAt }) {
    return parseDefibrillators(body, receivedAt);
  },
  check(data) {
    return data.defibrillators.length < MINIMUM_DEFIBRILLATORS
      ? [
          `${count(data.defibrillators.length, 'places')}, minimum ${String(MINIMUM_DEFIBRILLATORS)}`,
        ]
      : [];
  },
  consumers: ['live-map'],
  failures: socrataFailures(
    'data.cityofnewyork.us',
    `Fewer than ${String(MINIMUM_DEFIBRILLATORS)} places`,
  ),
};
