import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { KnownFailure, Licence, ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { DAY, HOUR, MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

/** The New York system (`bkn`) of the GBFS 2.3 index at https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json. */
const GBFS_URL = 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/';

/**
 * The Citi Bike Data License Agreement grants a royalty-free licence to use and distribute the
 * data in a product, but not as a stand-alone dataset, and not the Citi Bike marks.
 */
const LICENCE: Licence = {
  name: 'Citi Bike Data License Agreement',
  url: 'https://citibikenyc.com/data-sharing-policy',
  attribution: 'Bike share data provided by Lyft Bikes and Scooters, LLC',
};

const PROVIDER = 'Lyft Bikes and Scooters, LLC (Citi Bike GBFS)';

/** The system started on 2013-05-01 (`system_information.json`): an earlier report is a filler. */
const SYSTEM_START = Date.parse('2013-05-01T04:00:00Z');

/** About half the 2,519 stations of 11/11/2026: a real file has never had so few. */
const MINIMUM_STATIONS = 1_260;

const envelopeSchema = z.object({
  last_updated: z.number().int().positive(),
  ttl: z.number().int().nonnegative(),
  data: z.object({ stations: z.array(z.unknown()) }),
});

/** GBFS 2.3 writes flags as booleans; Lyft writes them as 0 and 1. */
const flag = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((value) => value === true || value === 1);
const amount = z.number().int().nonnegative();

const informationRow = z.object({
  station_id: z.string().min(1),
  name: z.string().min(1),
  short_name: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  capacity: amount.optional(),
});

const statusRow = z.object({
  station_id: z.string().min(1),
  num_bikes_available: amount,
  num_ebikes_available: amount,
  num_docks_available: amount,
  is_installed: flag,
  is_renting: flag,
  is_returning: flag,
  last_reported: z.number().int().nonnegative(),
});

const stationSchema = z.object({
  stationId: z.string().min(1),
  name: z.string().min(1),
  /** The number on the station sign, such as `6560.01`. */
  shortName: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  capacity: amount.nullable(),
});

const stationsSchema = z.object({
  updatedAt: instantSchema,
  stations: z.array(stationSchema),
  /** Rows without an id, a name or a place, which cannot be shown. */
  leftOut: amount,
});

const stationStatusSchema = z.object({
  /** Bikes are counted at their station; there is no position per bike. */
  located: z.literal('station'),
  stationId: z.string().min(1),
  installed: z.boolean(),
  renting: z.boolean(),
  returning: z.boolean(),
  /** Every bike ready to rent, electric ones included. */
  bikes: amount,
  ebikes: amount,
  docks: amount,
  /** Null when the station never reported (Lyft writes 86400, a day after 1970). */
  reportedAt: instantSchema.nullable(),
});

const stationStatusesSchema = z.object({
  updatedAt: instantSchema,
  stations: z.array(stationStatusSchema),
  leftOut: amount,
});

export type CitiBikeStations = z.infer<typeof stationsSchema>;
export type CitiBikeStatus = z.infer<typeof stationStatusesSchema>;

/** Clocks may differ a little; a file dated further ahead than this has a wrong clock. */
const FUTURE_TOLERANCE_MS = 2 * MINUTE;

interface Rows<T> {
  readonly updatedAt: Date;
  readonly rows: T[];
  readonly leftOut: number;
}

/** The GBFS envelope and its rows, each turned into the stored shape or left out and counted. */
function readGbfs<T>(
  body: Uint8Array,
  receivedAt: Date,
  toRow: (row: unknown) => T | undefined,
): Rows<T> | Extract<ParseResult<T>, { ok: false }> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const envelope = envelopeSchema.safeParse(decoded.value);
  if (!envelope.success) return refuse('unexpected-shape', describeIssue(envelope.error));
  const updatedAt = new Date(envelope.data.last_updated * 1000);
  if (updatedAt.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return refuse('future-update', `last_updated ${toInstant(updatedAt)} is after receipt.`);
  }
  const rows = envelope.data.data.stations.map(toRow);
  const kept = rows.filter((row): row is T => row !== undefined);
  return { updatedAt, rows: kept, leftOut: rows.length - kept.length };
}

function stationOf(row: unknown): z.infer<typeof stationSchema> | undefined {
  const parsed = informationRow.safeParse(row);
  if (!parsed.success) return undefined;
  const station = stationSchema.safeParse({
    stationId: parsed.data.station_id,
    name: parsed.data.name.trim(),
    shortName: parsed.data.short_name ?? null,
    latitude: parsed.data.lat,
    longitude: parsed.data.lon,
    capacity: parsed.data.capacity ?? null,
  });
  return station.success ? station.data : undefined;
}

function statusOf(row: unknown): z.infer<typeof stationStatusSchema> | undefined {
  const parsed = statusRow.safeParse(row);
  if (!parsed.success) return undefined;
  const reported = parsed.data.last_reported * 1000;
  return {
    located: 'station',
    stationId: parsed.data.station_id,
    installed: parsed.data.is_installed,
    renting: parsed.data.is_renting,
    returning: parsed.data.is_returning,
    bikes: parsed.data.num_bikes_available,
    ebikes: parsed.data.num_ebikes_available,
    docks: parsed.data.num_docks_available,
    reportedAt: reported < SYSTEM_START ? null : toInstant(new Date(reported)),
  };
}

/** Too few stations for the system, or under half of those served: a cut or partial file. */
function coverage(now: number, before: number | undefined): string[] {
  const reasons: string[] = [];
  if (now < MINIMUM_STATIONS) {
    reasons.push(
      `too-few-stations: ${count(now, 'stations')}, minimum ${count(MINIMUM_STATIONS, 'stations')}`,
    );
  }
  if (before !== undefined && now * 2 < before) {
    reasons.push(`coverage-drop: ${count(now, 'stations')}, ${String(before)} before`);
  }
  return reasons;
}

const FAILURES: readonly KnownFailure[] = [
  ...httpFailures('gbfs.lyft.com', 'https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json'),
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as an HTML error page of the CDN',
    state: 'degraded',
    remedy: 'Keep the last good data with its age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection: 'No last_updated, ttl or data.stations: the GBFS envelope changed',
    state: 'misconfigured',
    remedy: 'Compare with the capture and the GBFS reference, then update the reader',
  },
  {
    code: 'future-update',
    detection: 'last_updated is more than 2 minutes after the download',
    state: 'degraded',
    remedy: 'Refused until the provider clock is right again',
  },
  {
    code: 'too-few-stations',
    detection: `Fewer than ${String(MINIMUM_STATIONS)} usable stations: a cut or partial file`,
    state: 'degraded',
    remedy: 'Refused; the last good data is served with its age until it runs out',
  },
  {
    code: 'older-than-served',
    detection: 'last_updated is earlier than the one served, as from a stale cache',
    state: 'degraded',
    remedy: 'Keep the newer data; the next run normally brings a current one',
  },
  {
    code: 'coverage-drop',
    detection: 'Fewer than half as many stations as the data served',
    state: 'degraded',
    remedy: 'Keep the fuller data while it is fresh; an operator looks at the feed',
  },
];

/**
 * Citi Bike stations: name, sign number, place and number of docks. Lyft regenerates the file
 * every minute (`ttl` 60), but stations open or move a few times a month, so every 6 hours is
 * enough; a day without a new file degrades it.
 */
export const citiBikeStationsSource: SourceDefinition<CitiBikeStations> = {
  id: 'citi-bike-stations',
  title: 'Citi Bike stations',
  provider: PROVIDER,
  licence: LICENCE,
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: 6 * HOUR },
  freshness: { degradedAfterMs: DAY, staleAfterMs: 3 * DAY, unavailableAfterMs: 7 * DAY },
  limits: { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 },
  keepVersions: 3,
  dataSchema: stationsSchema,
  request() {
    return { url: `${GBFS_URL}station_information.json`, headers: { accept: 'application/json' } };
  },
  parse(body, { receivedAt }) {
    const read = readGbfs(body, receivedAt, stationOf);
    if (!('rows' in read)) return read;
    return {
      ok: true,
      data: { updatedAt: toInstant(read.updatedAt), stations: read.rows, leftOut: read.leftOut },
      dataTime: read.updatedAt,
      coverage: `${count(read.rows.length, 'stations')}, ${String(read.leftOut)} left out`,
    };
  },
  check(data, previous) {
    return [
      ...olderThanServed(data.updatedAt, previous?.updatedAt),
      ...coverage(data.stations.length, previous?.stations.length),
    ];
  },
  consumers: ['live-map', 'trip-planning'],
  failures: FAILURES,
};

/**
 * Bikes, e-bikes and free docks at every Citi Bike station. `ttl` is 60 seconds and the file was
 * 82 seconds old on arrival on 11/11/2026, so every minute while a trip is watched and every two
 * at rest; five minutes without a newer file degrade it.
 *
 * Lyft's per-type counts (`vehicle_types_available`) disagreed with its totals by one bike in 77
 * of the 2,519 stations of that capture, so only the totals are read.
 */
export const citiBikeStatusSource: SourceDefinition<CitiBikeStatus> = {
  id: 'citi-bike-station-status',
  title: 'Citi Bike station status',
  provider: PROVIDER,
  licence: LICENCE,
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: 2 * MINUTE, interestIntervalMs: MINUTE },
  freshness: {
    degradedAfterMs: 5 * MINUTE,
    staleAfterMs: 15 * MINUTE,
    unavailableAfterMs: HOUR,
  },
  limits: { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: stationStatusesSchema,
  request() {
    return { url: `${GBFS_URL}station_status.json`, headers: { accept: 'application/json' } };
  },
  parse(body, { receivedAt }) {
    const read = readGbfs(body, receivedAt, statusOf);
    if (!('rows' in read)) return read;
    const renting = read.rows.filter((station) => station.installed && station.renting).length;
    return {
      ok: true,
      data: { updatedAt: toInstant(read.updatedAt), stations: read.rows, leftOut: read.leftOut },
      dataTime: read.updatedAt,
      coverage: [
        count(read.rows.length, 'stations'),
        count(renting, 'renting'),
        `${String(read.leftOut)} left out`,
      ].join(', '),
    };
  },
  check(data, previous) {
    return [
      ...olderThanServed(data.updatedAt, previous?.updatedAt),
      ...coverage(data.stations.length, previous?.stations.length),
    ];
  },
  consumers: ['live-map', 'trip-planning'],
  failures: FAILURES,
};
