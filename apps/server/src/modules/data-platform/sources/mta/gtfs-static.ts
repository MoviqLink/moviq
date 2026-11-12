import type { KnownFailure, SourceDefinition } from '../../definition.js';
import { belowMinimum, shrunk } from './gtfs-static-checks.js';
import { parseGtfsStatic } from './gtfs-static-parse.js';
import { gtfsIndexSchema, type GtfsIndex } from './gtfs-static-schema.js';
import { DAY, HTTP_FAILURES, MINUTE, MTA_LICENCE, MTA_PROVIDER } from './provider.js';

const STATIC_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/';

interface StaticFile {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  /**
   * About half the routes with trips and the stops of the capture of 11/11/2026: a real file has
   * never had so few, a cut or partial export has.
   */
  readonly minimum: { readonly routes: number; readonly stops: number };
  /** Days after publication when the timetable is degraded, stale and unavailable. */
  readonly ageDays: readonly [number, number, number];
  readonly maxBytes: number;
}

/**
 * The subway file of 28/10/2026 is valid until 15/05/2027 (199 days), so it degrades only past
 * such a window. Bus files are republished for each pick: the one of 09/10/2026 ends on 02/01/2027
 * (85 days).
 */
const SUBWAY_AGE = [200, 240, 365] as const;
const BUS_AGE = [90, 120, 180] as const;
const MB = 1024 * 1024;

const FILES: readonly StaticFile[] = [
  {
    id: 'mta-gtfs-subway',
    file: 'gtfs_subway.zip',
    title: 'MTA subway timetable (GTFS)',
    minimum: { routes: 15, stops: 744 },
    ageDays: SUBWAY_AGE,
    maxBytes: 32 * MB,
  },
  {
    id: 'mta-gtfs-bus-brooklyn',
    file: 'gtfs_b.zip',
    title: 'MTA Brooklyn bus timetable (GTFS)',
    minimum: { routes: 34, stops: 2_287 },
    ageDays: BUS_AGE,
    maxBytes: 64 * MB,
  },
  {
    id: 'mta-gtfs-bus-bronx',
    file: 'gtfs_bx.zip',
    title: 'MTA Bronx bus timetable (GTFS)',
    minimum: { routes: 23, stops: 945 },
    ageDays: BUS_AGE,
    maxBytes: 64 * MB,
  },
  {
    id: 'mta-gtfs-bus-manhattan',
    file: 'gtfs_m.zip',
    title: 'MTA Manhattan bus timetable (GTFS)',
    minimum: { routes: 20, stops: 911 },
    ageDays: BUS_AGE,
    maxBytes: 64 * MB,
  },
  {
    id: 'mta-gtfs-bus-queens',
    file: 'gtfs_q.zip',
    title: 'MTA Queens bus timetable (GTFS)',
    minimum: { routes: 20, stops: 711 },
    ageDays: BUS_AGE,
    maxBytes: 64 * MB,
  },
  {
    id: 'mta-gtfs-bus-staten-island',
    file: 'gtfs_si.zip',
    title: 'MTA Staten Island bus timetable (GTFS)',
    minimum: { routes: 29, stops: 982 },
    ageDays: BUS_AGE,
    maxBytes: 64 * MB,
  },
  {
    id: 'mta-gtfs-bus-company',
    file: 'gtfs_busco.zip',
    title: 'MTA Bus Company timetable (GTFS)',
    minimum: { routes: 46, stops: 1_379 },
    ageDays: BUS_AGE,
    maxBytes: 64 * MB,
  },
];

const RETRY_TOMORROW = 'The served version stays; the next daily run tries again';

const STATIC_FAILURES: readonly KnownFailure[] = [
  ...HTTP_FAILURES,
  {
    code: 'not-zip',
    detection: 'The body does not start like a ZIP, as with an S3 error page',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
  {
    code: 'truncated-zip',
    detection: 'The archive has no end of central directory: the download was cut',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
  {
    code: 'corrupt-zip',
    detection: 'A table needed does not decompress, or the directory and the entries disagree',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
  {
    code: 'missing-file',
    detection: 'agency, stops, routes, trips, stop_times or both calendars are missing or empty',
    state: 'misconfigured',
    remedy: 'An operator checks whether the MTA changed the layout of the file',
  },
  {
    code: 'invalid-row',
    detection:
      'A row of a table read does not match the GTFS format, a shape repeats a point or has one, ' +
      'or a trip repeats a stop_sequence',
    state: 'misconfigured',
    remedy: 'An operator checks the row named in the detail against the GTFS reference',
  },
  {
    code: 'no-publication-time',
    detection: 'No date in feed_version and no file dates in the archive',
    state: 'misconfigured',
    remedy: 'An operator decides how this file is dated before it can be admitted',
  },
  {
    code: 'future-publication',
    detection: 'The publication date is later than the download',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
  {
    code: 'older-than-served',
    detection: 'The file was published before the version served, as from a stale cache',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
  {
    code: 'broken-reference',
    detection:
      'A trip names a route, service or shape, a stop a station, or a stop time or transfer a ' +
      'trip or stop, that the file lacks',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
  {
    code: 'outside-feed-dates',
    detection: 'Today is before feed_start_date or after feed_end_date',
    state: 'degraded',
    remedy: 'A file published ahead of its start is admitted on its first day',
  },
  {
    code: 'no-service-today',
    detection: 'No trip of the file runs today by calendar and calendar dates',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
  {
    code: 'check-failed',
    detection: 'Fewer routes or stops than the minimum, or under half of the version served',
    state: 'degraded',
    remedy: RETRY_TOMORROW,
  },
];

function staticSource(file: StaticFile): SourceDefinition<GtfsIndex> {
  const [degraded, stale, unavailable] = file.ageDays;
  return {
    id: file.id,
    title: file.title,
    provider: MTA_PROVIDER,
    licence: MTA_LICENCE,
    kind: 'static',
    // The MTA republishes these files a few times a year; one check a day finds a new one in time.
    rhythm: { class: 'cold', baseIntervalMs: DAY },
    freshness: {
      degradedAfterMs: degraded * DAY,
      staleAfterMs: stale * DAY,
      unavailableAfterMs: unavailable * DAY,
    },
    limits: { timeoutMs: 2 * MINUTE, maxBytes: file.maxBytes },
    keepVersions: 3,
    dataSchema: gtfsIndexSchema,
    request() {
      return { url: `${STATIC_URL}${file.file}` };
    },
    parse(body, context) {
      return parseGtfsStatic(body, context);
    },
    check(data, previous) {
      return [...belowMinimum(data, file.minimum), ...shrunk(data, previous)];
    },
    consumers: ['trip-planning', 'live-map'],
    failures: STATIC_FAILURES,
  };
}

/** One source per published file: the subway and the five boroughs plus MTA Bus Company. */
export const gtfsStaticSources: readonly SourceDefinition<GtfsIndex>[] = FILES.map(staticSource);
