import type { Licence, SourceDefinition } from '../../definition.js';
import { GTFS_REALTIME_FAILURES, httpFailures } from '../regional/provider-failures.js';
import {
  FERRY_FRESHNESS,
  FERRY_RHYTHM,
  ferryPositionsSchema,
  parseFerryPositions,
  type FerryPositions,
} from './nyc-ferry-realtime.js';

export const NY_WATERWAY_PROVIDER = 'NY Waterway, feeds hosted by Connexionz';

/**
 * NY Waterway publishes no terms for its feeds, and the Mobility Database, which lists them
 * (`mdb-3192` and its real-time feeds), records no licence (checked on 11/11/2026).
 */
export const NY_WATERWAY_LICENCE: Licence = {
  name: 'No published terms (public GTFS and GTFS Realtime feeds)',
  url: 'https://www.nywaterway.com/',
  attribution: 'Schedules and real-time data from NY Waterway',
};

export const NY_WATERWAY_HTTP_FAILURES = httpFailures(
  'nywaterway.connexionz.net',
  'https://www.nywaterway.com/',
);

/**
 * NY Waterway boat positions, from the same Connexionz system as NYC Ferry. On 11/11/2026 the
 * header was 8 seconds old on arrival and the two boats at sea (`Hudson`, `York`) had reported 2
 * and 4 seconds before it, so the rhythm and freshness of NYC Ferry apply. Boats are joined to
 * their route and destination through the trip id of `ny-waterway-gtfs`.
 */
const nyWaterwayPositions: SourceDefinition<FerryPositions> = {
  id: 'ny-waterway-positions',
  title: 'NY Waterway boat positions',
  provider: NY_WATERWAY_PROVIDER,
  licence: NY_WATERWAY_LICENCE,
  kind: 'realtime',
  rhythm: FERRY_RHYTHM,
  freshness: FERRY_FRESHNESS,
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  keepVersions: 1,
  dataSchema: ferryPositionsSchema,
  request() {
    return {
      url: 'https://nywaterway.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition',
    };
  },
  parse(body, context) {
    return parseFerryPositions(body, context);
  },
  consumers: ['live-map', 'trip-watch'],
  failures: [...NY_WATERWAY_HTTP_FAILURES, ...GTFS_REALTIME_FAILURES],
};

export const nyWaterwayRealtimeSources = [nyWaterwayPositions] as const;
