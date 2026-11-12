import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, MINUTE, count } from '../mta/provider.js';
import { NYC_OPEN_DATA, nycOpenDataLicence, readRows, socrataFailures } from './socrata.js';

const COLUMNS =
  'meter_number,status,facility,meter_hours,borough,on_street,side_of_street,from_street,to_street,lat,long';

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .transform(Number);
const text = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? null : value.trim()));

/** One row of "Parking Meters Locations and Status" (`693u-uax6`). */
const meterRow = z.object({
  meter_number: z.string().min(1),
  status: text,
  facility: text,
  meter_hours: text,
  borough: z.string().min(1),
  on_street: text,
  side_of_street: text,
  from_street: text,
  to_street: text,
  lat: decimal.pipe(z.number().min(40.4).max(41)),
  long: decimal.pipe(z.number().min(-74.3).max(-73.6)),
});

const meterSchema = z.object({
  id: z.string().min(1),
  /** The rules printed on the meter, as `2HR Pas Mon-Sat 0830-1900`: not whether a space is free. */
  hours: z.string().nullable(),
  facility: z.enum(['on-street', 'off-street']).nullable(),
  borough: z.string().min(1),
  street: z.string().nullable(),
  side: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  point: z.tuple([z.number(), z.number()]),
});

const parkingMetersSchema = z.object({
  readAt: instantSchema,
  /** Meters with the status `Active`: the meter is in service, which says nothing of the spaces. */
  meters: z.array(meterSchema),
  /** Meters the dataset keeps as `Inactive`: no longer in service, never shown as meters. */
  inactive: z.number().int().nonnegative(),
  /** Rows without a status, a number listed twice with different places, or invalid. */
  leftOut: z.number().int().nonnegative(),
});

export type ParkingMeters = z.infer<typeof parkingMetersSchema>;
type MeterRow = z.infer<typeof meterRow>;
type Meter = z.infer<typeof meterSchema>;

/** 12,798 active meters on 11/11/2026. */
const MINIMUM_METERS = 8_000;

function facilityOf(value: string | null): Meter['facility'] {
  const lower = value?.toLowerCase();
  if (lower === 'on street') return 'on-street';
  if (lower === 'off street') return 'off-street';
  return null;
}

function toMeter(row: MeterRow): Meter {
  return {
    id: row.meter_number,
    hours: row.meter_hours,
    facility: facilityOf(row.facility),
    borough: row.borough,
    street: row.on_street,
    side: row.side_of_street,
    from: row.from_street,
    to: row.to_street,
    point: [row.long, row.lat],
  };
}

/** Meters listed once; a number listed again with other data names no single meter. */
function uniqueMeters(rows: readonly MeterRow[]): { meters: Meter[]; ambiguous: number } {
  const byId = new Map<string, Meter[]>();
  for (const meter of rows.map(toMeter)) byId.set(meter.id, [...(byId.get(meter.id) ?? []), meter]);
  const meters: Meter[] = [];
  let ambiguous = 0;
  for (const listed of byId.values()) {
    const [first] = listed;
    const same = listed.every((meter) => JSON.stringify(meter) === JSON.stringify(first));
    if (first !== undefined && same) meters.push(first);
    else ambiguous += listed.length;
  }
  return { meters, ambiguous };
}

function parseMeters(body: Uint8Array, receivedAt: Date): ParseResult<ParkingMeters> {
  const read = readRows(body, meterRow);
  if (!('rows' in read)) return read;
  const status = (row: MeterRow) => row.status?.toLowerCase();
  const active = uniqueMeters(read.rows.filter((row) => status(row) === 'active'));
  const inactive = read.rows.filter((row) => status(row) === 'inactive').length;
  const unknown =
    read.rows.length - inactive - read.rows.filter((row) => status(row) === 'active').length;
  const leftOut = read.leftOut + unknown + active.ambiguous;
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), meters: active.meters, inactive, leftOut },
    dataTime: receivedAt,
    coverage: [
      count(active.meters.length, 'active meters'),
      `${String(inactive)} inactive`,
      `${String(leftOut)} left out`,
    ].join(', '),
  };
}

/**
 * NYC DOT's parking meters with their place, the rules printed on each and whether the meter is
 * in service, from NYC Open Data (`693u-uax6`). `Active` is the meter, not a free space: nothing
 * here says that one can park now. Inactive meters are counted apart and never listed. On
 * 11/11/2026, 15,598 rows: 12,798 active, 2,763 inactive and 37 without a status. Read daily.
 */
export const nycParkingMeters: SourceDefinition<ParkingMeters> = {
  id: 'nyc-parking-meters',
  title: 'NYC parking meters',
  provider: 'NYC Department of Transportation (NYC Open Data)',
  licence: nycOpenDataLicence(
    'Parking Meters Locations and Status, NYC DOT (NYC Open Data, 693u-uax6)',
  ),
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 16 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: parkingMetersSchema,
  request() {
    return {
      url: `${NYC_OPEN_DATA}693u-uax6.json?$select=${COLUMNS}&$order=meter_number&$limit=100000`,
    };
  },
  parse(body, { receivedAt }) {
    return parseMeters(body, receivedAt);
  },
  check(data) {
    return data.meters.length < MINIMUM_METERS
      ? [`${count(data.meters.length, 'active meters')}, minimum ${String(MINIMUM_METERS)}`]
      : [];
  },
  consumers: ['live-map'],
  failures: socrataFailures(
    'data.cityofnewyork.us',
    `Fewer than ${String(MINIMUM_METERS)} active meters`,
  ),
};
