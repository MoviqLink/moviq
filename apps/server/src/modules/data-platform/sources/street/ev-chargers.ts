import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, MINUTE, count } from '../mta/provider.js';
import { readRows, socrataDate, socrataFailures } from './socrata.js';

/**
 * A charging station as listed by the Department of Energy's Alternative Fuels Data Center. The
 * listing status is administrative (open, planned, temporarily unavailable): no source here says
 * whether a charger is free or in use now.
 */
export const chargingStationSchema = z.object({
  /** The AFDC station id, shared by every copy of the list. */
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  zip: z.string().min(1),
  listing: z.enum(['open', 'planned', 'temporarily-unavailable']),
  access: z.string().nullable(),
  hours: z.string().nullable(),
  level1Ports: z.number().int().nonnegative(),
  level2Ports: z.number().int().nonnegative(),
  fastPorts: z.number().int().nonnegative(),
  network: z.string().nullable(),
  connectors: z.array(z.string()),
  /** As the station lists it, such as `Free` or `$0.35 per kWh`; null when not listed. */
  pricing: z.string().nullable(),
  /** The date AFDC last confirmed the station's details. */
  confirmedOn: z.iso.date().nullable(),
  point: z.tuple([z.number(), z.number()]),
});

export type ChargingStation = z.infer<typeof chargingStationSchema>;

export const LISTING = { E: 'open', P: 'planned', T: 'temporarily-unavailable' } as const;

const chargingStationsSchema = z.object({
  readAt: instantSchema,
  stations: z.array(chargingStationSchema),
  /** Rows of the area box outside the five boroughs (Westchester, Nassau) or without the fields. */
  leftOut: z.number().int().nonnegative(),
});

export type ChargingStations = z.infer<typeof chargingStationsSchema>;

/**
 * The ZIP codes of the five boroughs (USPS): Manhattan 10001-10282, Staten Island 10301-10314,
 * the Bronx 10451-10475, Queens 11004-11005, 11101-11109, 11351-11499 and 11690-11697, and
 * Brooklyn 11201-11256. Nassau's 11001-11003, 11010-11099 and 11501-11599 stay out.
 */
const CITY_ZIPS: readonly (readonly [number, number])[] = [
  [10001, 10282],
  [10301, 10314],
  [10451, 10475],
  [11004, 11005],
  [11101, 11109],
  [11201, 11256],
  [11351, 11499],
  [11690, 11697],
];

function inCity(zip: string): boolean {
  const value = Number(zip.slice(0, 5));
  return CITY_ZIPS.some(([from, to]) => value >= from && value <= to);
}

const ports = z
  .string()
  .regex(/^\d+(\.0+)?$/)
  .transform(Number)
  .optional();
const text = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? null : value.trim()));

/** One row of "Electric Vehicle Charging Stations in New York" on data.ny.gov (`7rrd-248n`). */
const stationRow = z.object({
  id: z.string().min(1),
  station_name: z.string().min(1),
  street_address: z.string().min(1),
  city: z.string().min(1),
  zip: z.string().regex(/^\d{5}/),
  status_code: z.enum(['E', 'P', 'T']),
  groups_with_access_code: text,
  access_days_time: text,
  ev_level1_evse_num: ports,
  ev_level2_evse_num: ports,
  ev_dc_fast_count: ports,
  ev_network: text,
  ev_connector_types: text,
  latitude: z.string().transform(Number).pipe(z.number().min(-90).max(90)),
  longitude: z.string().transform(Number).pipe(z.number().min(-180).max(180)),
  date_last_confirmed: socrataDate.optional(),
});

type StationRow = z.infer<typeof stationRow>;

function toStation(row: StationRow): ChargingStation {
  return {
    id: row.id,
    name: row.station_name.trim(),
    address: row.street_address.trim(),
    city: row.city.trim(),
    zip: row.zip.slice(0, 5),
    listing: LISTING[row.status_code],
    access: row.groups_with_access_code,
    hours: row.access_days_time,
    level1Ports: row.ev_level1_evse_num ?? 0,
    level2Ports: row.ev_level2_evse_num ?? 0,
    fastPorts: row.ev_dc_fast_count ?? 0,
    network: row.ev_network,
    connectors: row.ev_connector_types?.split(/\s+/) ?? [],
    pricing: null,
    confirmedOn: row.date_last_confirmed ?? null,
    point: [row.longitude, row.latitude],
  };
}

/** 848 stations in the five boroughs on 11/11/2026. */
const MINIMUM_STATIONS = 500;

function parseStations(body: Uint8Array, receivedAt: Date): ParseResult<ChargingStations> {
  const read = readRows(body, stationRow);
  if (!('rows' in read)) return read;
  const stations = read.rows.filter((row) => inCity(row.zip)).map(toStation);
  const leftOut = read.leftOut + read.rows.length - stations.length;
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), stations, leftOut },
    dataTime: receivedAt,
    coverage: `${count(stations.length, 'stations')} in the five boroughs, ${String(leftOut)} left out`,
  };
}

const COLUMNS = [
  'id',
  'station_name',
  'street_address',
  'city',
  'zip',
  'status_code',
  'groups_with_access_code',
  'access_days_time',
  'ev_level1_evse_num',
  'ev_level2_evse_num',
  'ev_dc_fast_count',
  'ev_network',
  'ev_connector_types',
  'latitude',
  'longitude',
  'date_last_confirmed',
].join(',');

const AREA =
  "fuel_type_code='ELEC' AND latitude between 40.49 and 40.92 AND longitude between -74.27 and -73.68";

/**
 * Public EV charging stations in the five boroughs: the Department of Energy's list (AFDC), as
 * NYSERDA republishes it daily on data.ny.gov (`7rrd-248n`), without a key. A list, not a live
 * status: never shown as free or in use. On 11/11/2026, 914 stations in the area box and 848 in
 * the five boroughs by ZIP code. Read daily.
 */
export const nycEvChargers: SourceDefinition<ChargingStations> = {
  id: 'nyc-ev-chargers',
  title: 'EV charging stations in New York City',
  provider: 'U.S. Department of Energy (AFDC), via NYSERDA on data.ny.gov',
  licence: {
    name: 'Open NY Terms of Use',
    url: 'https://data.ny.gov/dataset/OPEN-NY-Terms-Of-Use/77gx-ii52',
    attribution:
      'Electric Vehicle Charging Stations in New York, U.S. Department of Energy (data.ny.gov)',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 8 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: chargingStationsSchema,
  request() {
    const query = `$select=${COLUMNS}&$where=${encodeURIComponent(AREA)}&$order=id&$limit=20000`;
    return { url: `https://data.ny.gov/resource/7rrd-248n.json?${query}` };
  },
  parse(body, { receivedAt }) {
    return parseStations(body, receivedAt);
  },
  check(data) {
    return data.stations.length < MINIMUM_STATIONS
      ? [`${count(data.stations.length, 'stations')}, minimum ${String(MINIMUM_STATIONS)}`]
      : [];
  },
  consumers: ['live-map'],
  failures: socrataFailures('data.ny.gov', `Fewer than ${String(MINIMUM_STATIONS)} stations`),
};
