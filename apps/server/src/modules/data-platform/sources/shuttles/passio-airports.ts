import type { Licence, SourceDefinition } from '../../definition.js';
import { MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import {
  BUS_POSITION_FAILURES,
  busPositionsSchema,
  parseBusPositions,
  type BusPositions,
} from '../westchester/bus-positions.js';

/**
 * Neither the Port Authority nor Passio publishes terms for these feeds, and transit.land and
 * the Mobility Database record no licence for them (checked on 11/11/2026).
 */
const LICENCE: Licence = {
  name: 'No published terms (public GTFS Realtime feed)',
  url: 'https://passiotech.com/',
  attribution: 'Airport shuttle data from the Port Authority of New York and New Jersey (Passio)',
};

interface AirportFeed {
  readonly id: string;
  readonly title: string;
  /** The Passio system of `https://passio3.com/<system>/passioTransit/gtfs/realtime/`. */
  readonly system: string;
}

const FEEDS: readonly AirportFeed[] = [
  {
    id: 'jfk-lga-shuttle-positions',
    title: 'JFK and LaGuardia airport shuttle positions',
    system: 'jfkpanynj',
  },
  { id: 'ewr-shuttle-positions', title: 'Newark airport shuttle positions', system: 'ewrpanynj' },
];

/**
 * Airport shuttle positions of the Port Authority, from Passio. The header is the second of the
 * request; on 11/11/2026 the 10 JFK and LaGuardia buses had reported 6 to 14 seconds before it,
 * and 16 of the 17 Newark buses 1 to 9 (one 119). Every 30 seconds while a trip is watched and
 * every minute at rest follow a shuttle from terminal to terminal.
 */
function airportShuttles(feed: AirportFeed): SourceDefinition<BusPositions> {
  return {
    id: feed.id,
    title: feed.title,
    provider: 'Port Authority of New York and New Jersey, feeds hosted by Passio',
    licence: LICENCE,
    kind: 'realtime',
    rhythm: { class: 'hot', baseIntervalMs: MINUTE, interestIntervalMs: 30_000 },
    freshness: {
      degradedAfterMs: 2 * MINUTE,
      staleAfterMs: 5 * MINUTE,
      unavailableAfterMs: 15 * MINUTE,
    },
    limits: { timeoutMs: 15_000, maxBytes: 256 * 1024 },
    keepVersions: 1,
    dataSchema: busPositionsSchema,
    request() {
      return {
        url: `https://passio3.com/${feed.system}/passioTransit/gtfs/realtime/vehiclePositions`,
      };
    },
    parse(body, context) {
      return parseBusPositions(body, context);
    },
    consumers: ['live-map', 'trip-watch'],
    failures: [
      ...httpFailures('passio3.com', 'https://passiotech.com/'),
      {
        code: 'http-429',
        detection: 'passio3.com answers 429: over its limit per address (x-ratelimit-limit 6000)',
        state: 'rate_limited',
        remedy: 'Wait for Retry-After; the last positions are served with their age',
      },
      ...BUS_POSITION_FAILURES,
    ],
  };
}

export const airportShuttleSources: readonly SourceDefinition<BusPositions>[] =
  FEEDS.map(airportShuttles);
