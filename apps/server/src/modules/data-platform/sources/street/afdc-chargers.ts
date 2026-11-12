import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import { DAY, MINUTE, count } from '../mta/provider.js';
import { inCityArea } from '../ny511/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { LISTING, chargingStationSchema, type ChargingStation } from './ev-chargers.js';

const API_URL = 'https://developer.nlr.gov/api/alt-fuel-stations/v1.json';

const optional = z
  .string()
  .nullish()
  .transform((value) =>
    value === null || value === undefined || value.trim() === '' ? null : value.trim(),
  );
const portCount = z
  .number()
  .int()
  .nonnegative()
  .nullish()
  .transform((value) => value ?? 0);

/** One station of the Alternative Fuel Stations API, with the fields read. */
const stationRow = z.object({
  id: z.number().int().positive(),
  station_name: z.string().min(1),
  street_address: z.string().min(1),
  city: z.string().min(1),
  state: z.literal('NJ'),
  /** As published: the API drops the leading zero of some New Jersey codes (`7114`). */
  zip: z.string().regex(/^\d{4,5}$/),
  status_code: z.enum(['E', 'P', 'T']),
  groups_with_access_code: optional,
  access_days_time: optional,
  ev_level1_evse_num: portCount,
  ev_level2_evse_num: portCount,
  ev_dc_fast_num: portCount,
  ev_network: optional,
  ev_connector_types: z.array(z.string()).nullish(),
  ev_pricing: optional,
  date_last_confirmed: z.iso.date().nullish(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const answerSchema = z.object({
  total_results: z.number().int().nonnegative(),
  fuel_stations: z.array(z.unknown()),
});

const afdcStationsSchema = z.object({
  readAt: instantSchema,
  stations: z.array(chargingStationSchema),
  /** Stations of New Jersey outside the city area, or without the fields. */
  leftOut: z.number().int().nonnegative(),
});

export type AfdcStations = z.infer<typeof afdcStationsSchema>;

/** 529 public stations of New Jersey in the city area on 11/11/2026. */
const MINIMUM_STATIONS = 250;

function toStation(row: z.infer<typeof stationRow>): ChargingStation {
  return {
    id: String(row.id),
    name: row.station_name.trim(),
    address: row.street_address.trim(),
    city: row.city.trim(),
    zip: row.zip,
    listing: LISTING[row.status_code],
    access: row.groups_with_access_code,
    hours: row.access_days_time,
    level1Ports: row.ev_level1_evse_num,
    level2Ports: row.ev_level2_evse_num,
    fastPorts: row.ev_dc_fast_num,
    network: row.ev_network,
    connectors: row.ev_connector_types ?? [],
    pricing: row.ev_pricing,
    confirmedOn: row.date_last_confirmed ?? null,
    point: [row.longitude, row.latitude],
  };
}

function parseStations(body: Uint8Array, receivedAt: Date): ParseResult<AfdcStations> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const answer = answerSchema.safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const rows = answer.data.fuel_stations.flatMap((candidate) => {
    const parsed = stationRow.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  const stations = rows.filter((row) => inCityArea([row.longitude, row.latitude])).map(toStation);
  const leftOut = answer.data.fuel_stations.length - stations.length;
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), stations, leftOut },
    dataTime: receivedAt,
    coverage: `${count(stations.length, 'stations')} in the New Jersey part of the city area`,
  };
}

/**
 * Public EV charging stations on the New Jersey side of the city area (Jersey City, Hoboken, Fort
 * Lee, Newark airport), from the Department of Energy's Alternative Fuel Stations API, run by the
 * National Laboratory of the Rockies (NLR). It adds what `nyc-ev-chargers` cannot have, as that
 * list is New York State's: the request asks New Jersey only, so the two never list the same
 * station, and it carries the station's pricing. The API needs a free key (`NLR_API_KEY`); its
 * default limit is 1,000 requests an hour, and one a day is enough. A list, never a live status.
 */
export const afdcNewJerseyChargers: SourceDefinition<AfdcStations> = {
  id: 'afdc-ev-chargers-new-jersey',
  title: 'EV charging stations on the New Jersey side (AFDC)',
  provider: 'U.S. Department of Energy, Alternative Fuels Data Center (NLR developer API)',
  licence: {
    name: 'NLR Developer Network terms and conditions',
    url: 'https://developer.nlr.gov/terms/',
    attribution: 'Alternative Fuels Data Center, U.S. Department of Energy',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 32 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  integration: 'nlr',
  keepVersions: 2,
  dataSchema: afdcStationsSchema,
  request({ credentials }) {
    const params = new URLSearchParams({
      api_key: credentials['NLR_API_KEY'] ?? '',
      fuel_type: 'ELEC',
      state: 'NJ',
      status: 'E,T',
      access: 'public',
      limit: 'all',
    });
    return { url: `${API_URL}?${params.toString()}`, headers: { accept: 'application/json' } };
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
  failures: [
    ...httpFailures('developer.nlr.gov', 'https://developer.nlr.gov/docs/rate-limits/'),
    {
      code: 'http-429',
      detection: 'The key went past its hourly limit (1,000 requests by default)',
      state: 'rate_limited',
      remedy: 'Wait the hour the API blocks the key for; the list served stays with its age',
    },
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page',
      state: 'degraded',
      remedy: 'The served list stays with its age; the next daily run tries again',
    },
    {
      code: 'unexpected-shape',
      detection: 'No total_results or fuel_stations: the API changed',
      state: 'misconfigured',
      remedy: 'Compare with the documentation at developer.nlr.gov and update the reader',
    },
    {
      code: 'check-failed',
      detection: `Fewer than ${String(MINIMUM_STATIONS)} stations in the city area`,
      state: 'degraded',
      remedy: 'Refused, so a cut list never reads as the whole area',
    },
  ],
};
