import type { KnownFailure, ParseContext, ParseResult } from '../../definition.js';
import { parseGtfsArchive, type PublicationTime } from '../mta/gtfs-static-parse.js';
import type { GtfsIndex } from '../mta/gtfs-static-schema.js';

export { belowMinimum, shrunk } from '../mta/gtfs-static-checks.js';
export type { PublicationTime } from '../mta/gtfs-static-parse.js';

/**
 * A timetable outside the MTA subway and buses, read by the common GTFS reader of `mta/`: tables
 * at the root or in one folder, dated by the rule its source names, with shapes for the live map.
 * Stop times and transfers are not indexed here.
 */
export function parseTimetable(
  body: Uint8Array,
  context: ParseContext<GtfsIndex>,
  rule: PublicationTime,
): ParseResult<GtfsIndex> {
  return parseGtfsArchive(body, context, { dating: [rule], shapes: true, routing: false });
}

const RETRY_TOMORROW = 'The served version stays; the next run tries again';

/** Failures of a timetable read by `parseTimetable`, after the HTTP ones of its provider. */
export function timetableFailures(http: readonly KnownFailure[]): readonly KnownFailure[] {
  return [...http, ...ARCHIVE_FAILURES];
}

const ARCHIVE_FAILURES: readonly KnownFailure[] = [
  {
    code: 'not-zip',
    detection: 'The body does not start like a ZIP, as with an HTML error page',
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
    remedy: 'An operator checks whether the publisher changed the layout of the file',
  },
  {
    code: 'invalid-row',
    detection: 'A row of a table read does not match the GTFS format',
    state: 'misconfigured',
    remedy: 'An operator checks the row named in the detail against the GTFS reference',
  },
  {
    code: 'no-publication-time',
    detection: 'The date the source reads its publication from is absent from the file',
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
    detection: 'A trip names a route or service, or a stop a station, that the file lacks',
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
