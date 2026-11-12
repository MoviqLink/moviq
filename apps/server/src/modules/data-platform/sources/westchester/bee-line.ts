import type { Licence, SourceDefinition } from '../../definition.js';
import { gtfsIndexSchema, type GtfsIndex } from '../mta/gtfs-static-schema.js';
import { DAY, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { belowMinimum, parseTimetable, shrunk, timetableFailures } from '../regional/timetable.js';
import {
  BUS_POSITION_FAILURES,
  busPositionsSchema,
  parseBusPositions,
  type BusPositions,
} from './bus-positions.js';

const PROVIDER = 'Westchester County Bee-Line System, feeds hosted by GMV';

const TERMS_URL =
  'https://planning.westchestercountyny.gov/transportation-planning/gfts-developers-transit-api/' +
  'transit-api-service-terms-of-service';

/**
 * The terms that transit.land records for both feeds. The page did not answer from Europe on
 * 10/11 and 11/11/2026 (three timeouts), so their text is not yet read.
 */
const LICENCE: Licence = {
  name: 'Westchester County Transit API Service Terms of Service',
  url: TERMS_URL,
  attribution: 'Bus data from the Westchester County Bee-Line System',
};

/** About half the 57 routes and 2,836 stops of the file of 14/10/2026. */
const MINIMUM = { routes: 28, stops: 1_400 } as const;

/**
 * Bee-Line bus positions. The header is the second of the request; buses had reported 6 to 27
 * seconds before it on 11/11/2026 (35 buses on 17 routes at 22:20 in New York). Every 30 seconds
 * while a trip is watched and every minute at rest follow a bus from stop to stop.
 */
const beeLinePositions: SourceDefinition<BusPositions> = {
  id: 'bee-line-positions',
  title: 'Bee-Line bus positions (Westchester)',
  provider: PROVIDER,
  licence: LICENCE,
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: MINUTE, interestIntervalMs: 30_000 },
  freshness: {
    degradedAfterMs: 2 * MINUTE,
    staleAfterMs: 5 * MINUTE,
    unavailableAfterMs: 15 * MINUTE,
  },
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  keepVersions: 1,
  dataSchema: busPositionsSchema,
  request() {
    return { url: 'https://westchester.gmv.com/gtfsrtapi/api/vehiclepositions' };
  },
  parse(body, context) {
    return parseBusPositions(body, context);
  },
  consumers: ['live-map', 'trip-watch'],
  failures: [...httpFailures('westchester.gmv.com', TERMS_URL), ...BUS_POSITION_FAILURES],
};

/**
 * The Bee-Line timetable, which names the route and destination of every trip of the positions.
 * It has no `feed_info.txt`, and its entries are dated by the publisher's clock (12:06 on
 * 14/10/2026 for a `Last-Modified` of 10:08 UTC), not New York's, so the time of receipt stands
 * in. A new file comes with each service change; a check a day finds it in time.
 */
const beeLineTimetable: SourceDefinition<GtfsIndex> = {
  id: 'bee-line-gtfs',
  title: 'Bee-Line timetable (GTFS)',
  provider: PROVIDER,
  licence: LICENCE,
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 2 * DAY, staleAfterMs: 4 * DAY, unavailableAfterMs: 8 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 8 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 3,
  dataSchema: gtfsIndexSchema,
  request() {
    return {
      url: 'https://westchester-win.gmv.com:8443/repository/gtfs-public/GTFS_GMV_WCDOT.zip',
    };
  },
  parse(body, context) {
    return parseTimetable(body, context, 'receipt');
  },
  check(data, previous) {
    return [...belowMinimum(data, MINIMUM), ...shrunk(data, previous)];
  },
  consumers: ['trip-planning', 'live-map'],
  failures: timetableFailures(httpFailures('westchester-win.gmv.com', TERMS_URL)),
};

export const beeLineSources = [beeLineTimetable, beeLinePositions] as const;
