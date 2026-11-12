import type { SourceDefinition } from '../../definition.js';
import { gtfsIndexSchema, type GtfsIndex } from '../mta/gtfs-static-schema.js';
import { DAY, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { belowMinimum, parseTimetable, shrunk, timetableFailures } from '../regional/timetable.js';

/** Newark's published GTFS, including the shapes identified by its real-time trips. */
export const airportShuttleTimetableSource: SourceDefinition<GtfsIndex> = {
  id: 'ewr-shuttle-gtfs',
  title: 'Newark airport shuttle timetable (GTFS)',
  provider: 'Port Authority of New York and New Jersey, feeds hosted by Passio',
  licence: {
    name: 'No published terms (public GTFS feed)',
    url: 'https://passiotech.com/',
    attribution: 'Airport shuttle data from the Port Authority of New York and New Jersey (Passio)',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 2 * DAY, staleAfterMs: 7 * DAY, unavailableAfterMs: 30 * DAY },
  dataTimeSource: 'receipt',
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 4 * 1024 * 1024 },
  keepVersions: 3,
  dataSchema: gtfsIndexSchema,
  request: () => ({ url: 'https://passio3.com/ewrpanynj/passioTransit/gtfs/google_transit.zip' }),
  parse: (body, context) => parseTimetable(body, context, 'receipt'),
  check: (data, previous) => [
    ...belowMinimum(data, { routes: 1, stops: 2 }),
    ...shrunk(data, previous),
  ],
  consumers: ['live-map'],
  failures: timetableFailures(httpFailures('passio3.com', 'https://passiotech.com/')),
};
