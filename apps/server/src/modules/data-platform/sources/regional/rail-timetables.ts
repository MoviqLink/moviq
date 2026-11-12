import type { SourceDefinition } from '../../definition.js';
import { gtfsIndexSchema, type GtfsIndex } from '../mta/gtfs-static-schema.js';
import { DAY, HTTP_FAILURES, MINUTE, MTA_LICENCE, MTA_PROVIDER } from '../mta/provider.js';
import {
  belowMinimum,
  parseTimetable,
  shrunk,
  timetableFailures,
  type PublicationTime,
} from './timetable.js';

/** The railroad files listed on https://www.mta.info/developers, without a key. */
const STATIC_URL = 'https://rrgtfsfeeds.s3.amazonaws.com/';
const MB = 1024 * 1024;

interface RailFile {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  readonly published: PublicationTime;
  /** About half the routes and stops of the capture of 11/11/2026. */
  readonly minimum: { readonly routes: number; readonly stops: number };
  readonly maxBytes: number;
}

const FILES: readonly RailFile[] = [
  {
    id: 'mta-gtfs-lirr',
    file: 'gtfslirr.zip',
    title: 'Long Island Rail Road timetable (GTFS)',
    // `feed_version` is `GO203_26`, with no date, and the entries are dated 15:33 in a file
    // uploaded at 14:34 UTC on 10/11/2026: neither New York time nor UTC. Nothing in the file
    // tells its publication, so the time of receipt stands in.
    published: 'receipt',
    minimum: { routes: 6, stops: 63 },
    maxBytes: 8 * MB,
  },
  {
    id: 'mta-gtfs-metro-north',
    file: 'gtfsmnr.zip',
    title: 'Metro-North Railroad timetable (GTFS)',
    // No `feed_info.txt`; the entries are dated 14:40 New York time, the minute S3 received the
    // file (Last-Modified 19:40:31 UTC on 10/11/2026).
    published: 'archive',
    minimum: { routes: 3, stops: 57 },
    maxBytes: 16 * MB,
  },
];

function railTimetable(file: RailFile): SourceDefinition<GtfsIndex> {
  return {
    id: file.id,
    title: file.title,
    provider: MTA_PROVIDER,
    licence: MTA_LICENCE,
    kind: 'static',
    // Both files were rewritten on 10/11/2026 with calendars that start that day, as a daily
    // export does: one check a day follows them.
    rhythm: { class: 'cold', baseIntervalMs: DAY },
    // Two days without a new file degrade it; the calendar check refuses an expired one anyway.
    freshness: { degradedAfterMs: 2 * DAY, staleAfterMs: 7 * DAY, unavailableAfterMs: 30 * DAY },
    ...(file.published === 'receipt' ? { dataTimeSource: 'receipt' as const } : {}),
    limits: { timeoutMs: 2 * MINUTE, maxBytes: file.maxBytes },
    keepVersions: 3,
    dataSchema: gtfsIndexSchema,
    request() {
      return { url: `${STATIC_URL}${file.file}` };
    },
    needsFullRefresh: (previous) => previous.indexVersion !== 2,
    parse(body, context) {
      return parseTimetable(body, context, file.published);
    },
    check(data, previous) {
      return [...belowMinimum(data, file.minimum), ...shrunk(data, previous)];
    },
    consumers: ['trip-planning', 'live-map'],
    failures: timetableFailures(HTTP_FAILURES),
  };
}

/** The LIRR and Metro-North timetables: stations, routes and trips with their headsigns. */
export const railTimetableSources: readonly SourceDefinition<GtfsIndex>[] =
  FILES.map(railTimetable);
