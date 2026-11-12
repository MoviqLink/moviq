import type { Licence, SourceDefinition } from '../../definition.js';
import { gtfsIndexSchema, type GtfsIndex } from '../mta/gtfs-static-schema.js';
import { DAY, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import {
  belowMinimum,
  parseTimetable,
  shrunk,
  timetableFailures,
  type PublicationTime,
} from '../regional/timetable.js';
import {
  NY_WATERWAY_HTTP_FAILURES,
  NY_WATERWAY_LICENCE,
  NY_WATERWAY_PROVIDER,
} from './ny-waterway.js';
import {
  NYC_FERRY_HTTP_FAILURES,
  NYC_FERRY_LICENCE,
  NYC_FERRY_PROVIDER,
} from './nyc-ferry-realtime.js';

interface FerryTimetable {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly licence: Licence;
  readonly url: string;
  readonly published: PublicationTime;
  /** About half the routes and stops of the capture of 11/11/2026 (14 and 15 for NY Waterway). */
  readonly minimum: { readonly routes: number; readonly stops: number };
  /** Days after publication when the timetable is degraded, stale and unavailable. */
  readonly ageDays: readonly [number, number, number];
  readonly failures: SourceDefinition['failures'];
}

/**
 * NYC DOT asks that any application using its data carry the disclaimer of
 * https://www.nyc.gov/html/dot/html/about/datafeeds.shtml#disclaimer: the data was compiled for
 * governmental purposes, may have been modified, and comes with no representation of accuracy.
 */
const NYC_DOT_LICENCE: Licence = {
  name: 'NYC DOT data feeds disclaimer',
  url: 'https://www.nyc.gov/html/dot/html/about/datafeeds.shtml#disclaimer',
  attribution:
    'Information originally compiled by the New York City Department of Transportation (NYC DOT)',
};

const TIMETABLES: readonly FerryTimetable[] = [
  {
    id: 'nyc-ferry-gtfs',
    title: 'NYC Ferry timetable (GTFS)',
    provider: NYC_FERRY_PROVIDER,
    licence: NYC_FERRY_LICENCE,
    url: 'https://nycferry.connexionz.net/rtt/public/resource/gtfs.zip',
    // `feed_version` is the publication date, `20261108` in the capture.
    published: 'feed-version',
    minimum: { routes: 3, stops: 25 },
    // A seasonal timetable: the file of 08/11/2026 starts the winter service of 02/11/2026 and is
    // valid until 31/12/2027.
    ageDays: [200, 300, 400],
    failures: timetableFailures(NYC_FERRY_HTTP_FAILURES),
  },
  {
    id: 'ny-waterway-gtfs',
    title: 'NY Waterway timetable (GTFS)',
    provider: NY_WATERWAY_PROVIDER,
    licence: NY_WATERWAY_LICENCE,
    url: 'https://nywaterway.connexionz.net/rtt/public/resource/gtfs.zip',
    // `feed_version` is the publication date, `20261110` in the capture.
    published: 'feed-version',
    minimum: { routes: 7, stops: 8 },
    // The file of 10/11/2026 is valid from 01/11/2026 to 31/12/2027, like NYC Ferry's.
    ageDays: [200, 300, 400],
    failures: timetableFailures(NY_WATERWAY_HTTP_FAILURES),
  },
  {
    id: 'staten-island-ferry-gtfs',
    title: 'Staten Island Ferry timetable (GTFS)',
    provider: 'New York City Department of Transportation (NYC DOT)',
    licence: NYC_DOT_LICENCE,
    url: 'https://www.nyc.gov/html/dot/downloads/misc/siferry-gtfs.zip',
    // `feed_version` is `18`; the entries are dated in New York time, the latest on 09/01/2026,
    // before the file was uploaded (Last-Modified 15/01/2026).
    published: 'archive',
    minimum: { routes: 1, stops: 2 },
    // One file a year: `siferry-gtfs_2026.1`, valid from 01/01/2026 to 17/01/2028.
    ageDays: [400, 500, 760],
    failures: timetableFailures(
      httpFailures('nyc.gov', 'https://www.nyc.gov/html/dot/html/about/datafeeds.shtml'),
    ),
  },
];

function ferryTimetable(timetable: FerryTimetable): SourceDefinition<GtfsIndex> {
  const [degraded, stale, unavailable] = timetable.ageDays;
  return {
    id: timetable.id,
    title: timetable.title,
    provider: timetable.provider,
    licence: timetable.licence,
    kind: 'static',
    // A new file appears a few times a year at most; one check a day finds it in time.
    rhythm: { class: 'cold', baseIntervalMs: DAY },
    freshness: {
      degradedAfterMs: degraded * DAY,
      staleAfterMs: stale * DAY,
      unavailableAfterMs: unavailable * DAY,
    },
    limits: { timeoutMs: 2 * MINUTE, maxBytes: 4 * 1024 * 1024 },
    keepVersions: 3,
    dataSchema: gtfsIndexSchema,
    request() {
      return { url: timetable.url };
    },
    parse(body, context) {
      return parseTimetable(body, context, timetable.published);
    },
    check(data, previous) {
      return [...belowMinimum(data, timetable.minimum), ...shrunk(data, previous)];
    },
    consumers: ['trip-planning', 'live-map'],
    failures: timetable.failures,
  };
}

/** NYC Ferry, NY Waterway and Staten Island Ferry timetables: piers, routes and trips. */
export const ferryTimetableSources: readonly SourceDefinition<GtfsIndex>[] =
  TIMETABLES.map(ferryTimetable);
