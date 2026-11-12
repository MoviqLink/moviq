import { Hono } from 'hono';

import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { cityLayerRoutes } from '../../src/modules/city-layers/routes.js';
import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import type { SourceReader } from '../../src/modules/data-platform/reader.js';
import { mtaSubwayEntrances } from '../../src/modules/data-platform/sources/accessibility/subway-entrances.js';
import { nwsAlertsSource } from '../../src/modules/data-platform/sources/city/nws-alerts.js';
import { ferryAlertSources } from '../../src/modules/data-platform/sources/ferries/ferry-alerts.js';
import { coastGuardNotices } from '../../src/modules/data-platform/sources/harbor/coast-guard-notices.js';
import { portsSources } from '../../src/modules/data-platform/sources/harbor/noaa-ports.js';
import { pnctVesselSchedule } from '../../src/modules/data-platform/sources/harbor/pnct-vessel-schedule.js';
import { ny511Cameras } from '../../src/modules/data-platform/sources/ny511/cameras.js';
import {
  ny511Closures,
  ny511Construction,
  ny511FutureConstruction,
  ny511Incidents,
  ny511TransitEvents,
} from '../../src/modules/data-platform/sources/ny511/event-layers.js';
import { ny511RoadConditions } from '../../src/modules/data-platform/sources/ny511/road-conditions.js';
import { pathAlertsSource } from '../../src/modules/data-platform/sources/regional/path-alerts.js';
import { afdcNewJerseyChargers } from '../../src/modules/data-platform/sources/street/afdc-chargers.js';
import { nycDefibrillators } from '../../src/modules/data-platform/sources/street/defibrillators.js';
import { nycEvChargers } from '../../src/modules/data-platform/sources/street/ev-chargers.js';
import { nycLandmarks } from '../../src/modules/data-platform/sources/street/landmarks.js';
import { nycParkingMeters } from '../../src/modules/data-platform/sources/street/parking-meters.js';
import { nycPermittedEventsToday } from '../../src/modules/data-platform/sources/street/permitted-events.js';
import { nycPublicRestrooms } from '../../src/modules/data-platform/sources/street/public-restrooms.js';
import { nycStreetClosuresToday } from '../../src/modules/data-platform/sources/street/street-closures.js';
import { nycStreetPermitSources } from '../../src/modules/data-platform/sources/street/street-permits.js';
import { parsedCapture, readerWith } from '../live-vehicles/reader.js';
import type { ManualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';

/** After every capture of 11/11/2026, still the night of 10/11 in New York. */
export const NOW = '2026-11-11T05:30:00.000Z';

const statenIslandPermits = nycStreetPermitSources.find((source) =>
  source.id.endsWith('staten-island'),
);
if (statenIslandPermits === undefined) throw new Error('No Staten Island permits source');

/** Every capture a city layer reads, each with the time it was taken (`tests/fixtures/`). */
const CAPTURES: readonly (readonly [SourceDefinition, string, string])[] = [
  [ny511Incidents, 'ny511/incidents.json', '2026-11-11T03:50:39Z'],
  [ny511Closures, 'ny511/closures.json', '2026-11-11T03:50:02Z'],
  [ny511Construction, 'ny511/construction.json', '2026-11-11T03:50:46Z'],
  [ny511FutureConstruction, 'ny511/future-construction.json', '2026-11-11T04:07:06Z'],
  [ny511TransitEvents, 'ny511/transit-events.json', '2026-11-11T03:52:38Z'],
  [ny511RoadConditions, 'ny511/road-conditions.json', '2026-11-11T04:07:11Z'],
  [ny511Cameras, 'ny511/cameras.json', '2026-11-11T03:50:50Z'],
  [nycStreetClosuresToday, 'street/street-closures-today.json', NOW],
  [nycPermittedEventsToday, 'street/permitted-events-today.json', NOW],
  [statenIslandPermits, 'street/street-permits-staten-island.json', NOW],
  [nycEvChargers, 'street/ev-chargers.json', '2026-11-11T04:36:57Z'],
  [afdcNewJerseyChargers, 'street/afdc-new-jersey.json', '2026-11-11T04:34:39Z'],
  [nycDefibrillators, 'street/defibrillators.json', '2026-11-11T04:32:41Z'],
  [nycParkingMeters, 'street/parking-meters.json', '2026-11-11T04:36:53Z'],
  [nycPublicRestrooms, 'street/public-restrooms.json', '2026-11-11T14:45:58Z'],
  [nycLandmarks, 'street/landmarks.json', NOW],
  [mtaSubwayEntrances, 'accessibility/subway-entrances.json', '2026-11-11T04:31:26Z'],
  [pnctVesselSchedule, 'harbor/pnct-vessel-schedule.txt', '2026-11-11T04:02:24Z'],
  [coastGuardNotices, 'harbor/uscg-sector-new-york.rss', '2026-11-11T04:00:30Z'],
  [pathAlertsSource, 'regional/path-alerts.json', '2026-11-11T03:56:13Z'],
  [nwsAlertsSource, 'city/nws-alerts-new-york.geojson', '2026-11-11T04:00:00Z'],
];

const PORTS: readonly string[] = [
  'harbor/noaa-battery-water-level.json',
  'harbor/noaa-verrazzano-air-gap.json',
  'harbor/noaa-kill-van-kull-current.json',
  'harbor/noaa-robbins-reef-wind.json',
];

const FERRY_ALERTS = ['ferries/nyc-ferry-alerts.pb', 'ferries/ny-waterway-alerts.pb'];

/** The data each source makes of its capture, by source id. */
export function capturedAnswers(): Map<string, unknown> {
  const answers = new Map<string, unknown>();
  for (const [source, file, at] of CAPTURES) {
    answers.set(source.id, parsedCapture(source, file, at));
  }
  portsSources.forEach((source, index) => {
    answers.set(source.id, parsedCapture(source, PORTS[index] ?? '', '2026-11-11T03:41:00Z'));
  });
  ferryAlertSources.forEach((source, index) => {
    answers.set(source.id, parsedCapture(source, FERRY_ALERTS[index] ?? '', NOW));
  });
  return answers;
}

/** The routes as the process would mount them, at `/api/city`. */
export function cityApp(
  reader: SourceReader,
  clock: ManualClock,
  fetch: typeof globalThis.fetch,
): Hono<AppBindings> {
  const root = new Hono<AppBindings>();
  root.use(requestContext(memoryLogger().logger));
  root.route('/api/city', cityLayerRoutes({ reader, clock, http: createHttpClient({ fetch }) }));
  return root;
}

/** A reader over every capture, healthy at `NOW`. */
export const capturedReader = (): SourceReader => readerWith(capturedAnswers(), NOW);
