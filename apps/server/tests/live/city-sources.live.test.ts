import { describe, expect, it } from 'vitest';

import { resolveIntegrations } from '../../src/config/integrations.js';
import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { attemptCollection } from '../../src/modules/data-platform/attempt.js';
import { credentialsFrom } from '../../src/modules/data-platform/credentials.js';
import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import { mtaSubwayEntrances } from '../../src/modules/data-platform/sources/accessibility/subway-entrances.js';
import { airSources } from '../../src/modules/data-platform/sources/air/index.js';
import { amtrakSources } from '../../src/modules/data-platform/sources/amtrak/index.js';
import { bikeSources } from '../../src/modules/data-platform/sources/bikes/index.js';
import { cityOpsSources } from '../../src/modules/data-platform/sources/city-ops/index.js';
import { ferrySources } from '../../src/modules/data-platform/sources/ferries/index.js';
import { harborSources } from '../../src/modules/data-platform/sources/harbor/index.js';
import { micromobilitySources } from '../../src/modules/data-platform/sources/micromobility/index.js';
import { alertsFeedSchema } from '../../src/modules/data-platform/sources/mta/alerts.js';
import { busPositionsSchema } from '../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { gtfsIndexSchema } from '../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { mtaSources } from '../../src/modules/data-platform/sources/mta/index.js';
import { ny511Sources } from '../../src/modules/data-platform/sources/ny511/index.js';
import { regionalSources } from '../../src/modules/data-platform/sources/regional/index.js';
import { seaSources } from '../../src/modules/data-platform/sources/sea/index.js';
import { shuttleSources } from '../../src/modules/data-platform/sources/shuttles/index.js';
import {
  createParkingSignsReader,
  createPermitStipulationsReader,
  streetSources,
} from '../../src/modules/data-platform/sources/street/index.js';
import { westchesterSources } from '../../src/modules/data-platform/sources/westchester/index.js';

/**
 * One real request per city transport source, through the whole admission chain: LIRR,
 * Metro-North, PATH (arrivals and alerts), ferries (NYC Ferry, NY Waterway, with their alerts),
 * Citi Bike, aircraft, vessels, Bee-Line, airport and campus shuttles, shared scooters and
 * e-bikes, Amtrak, PlowNYC and the harbor (Coast Guard notices, PNCT calls, NOAA PORTS). None
 * needs a key. The street too: 511NY's layers, today's closures, events and permits, meters,
 * chargers (the New Jersey list with `NLR_API_KEY`), defibrillators, subway entrances, and one
 * parking-sign tile and one permit's stipulations on demand. Run with `npm run verify:live`.
 */
const sources = [
  ...regionalSources,
  ...ferrySources,
  ...bikeSources,
  ...airSources,
  ...seaSources,
  ...westchesterSources,
  ...shuttleSources,
  ...micromobilitySources,
  ...amtrakSources,
  ...cityOpsSources,
  ...harborSources,
  ...ny511Sources,
  ...streetSources,
  mtaSubwayEntrances,
];
const http = createHttpClient();
const credentials = credentialsFrom(resolveIntegrations(process.env));

/** One real attempt; the admitted data, or a failed test that says why it was not admitted. */
async function admitted(definition: SourceDefinition): Promise<unknown> {
  const attempt = await attemptCollection({
    definition,
    current: undefined,
    previous: undefined,
    credentials: {},
    http,
    now: () => new Date(),
  });
  if (attempt.outcome === 'admitted') return attempt.data;
  const reason = attempt.outcome === 'unchanged' ? '' : `${attempt.errorCode}: ${attempt.detail}`;
  throw new Error(`${definition.id} ${attempt.outcome} ${reason}`);
}

function find(list: readonly SourceDefinition[], id: string): SourceDefinition {
  const found = list.find((definition) => definition.id === id);
  if (!found) throw new Error(`no source ${id}`);
  return found;
}

describe('every city transport source against its real provider', () => {
  it.each(sources.map((definition) => [definition.id, definition] as const))(
    '%s is admitted',
    async (_, definition) => {
      const { missing, values } = credentials.resolve(definition);
      expect(missing, `set ${missing.join(', ')} to validate this integration`).toEqual([]);
      const attempt = await attemptCollection({
        definition,
        current: undefined,
        previous: undefined,
        credentials: values,
        http,
        now: () => new Date(),
      });
      const explanation =
        attempt.outcome === 'admitted' || attempt.outcome === 'unchanged'
          ? ''
          : `${attempt.errorCode}: ${attempt.detail}`;
      expect(attempt.outcome, explanation).toBe('admitted');
    },
    120_000,
  );
});

describe('what the new fields promise, against the real providers', () => {
  it('Bus Time gives an occupancy to some buses, and never a capacity of zero', async () => {
    const data = busPositionsSchema.parse(await admitted(find(mtaSources, 'mta-bus-positions')));
    const counted = data.vehicles.filter((bus) => bus.occupancy !== null);
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.every((bus) => bus.occupancy?.capacity !== 0)).toBe(true);
  }, 120_000);

  it.each([
    ['nyc-ferry-alerts', 'nyc-ferry-gtfs'],
    ['ny-waterway-alerts', 'ny-waterway-gtfs'],
  ])(
    'every route and stop %s names is in %s',
    async (alertsId, timetableId) => {
      const { alerts } = alertsFeedSchema.parse(await admitted(find(ferrySources, alertsId)));
      const timetable = gtfsIndexSchema.parse(await admitted(find(ferrySources, timetableId)));
      const affected = alerts.flatMap((alert) => alert.affected);
      const unknown = affected.filter(
        (entity) =>
          (entity.routeId !== null && timetable.routes[entity.routeId] === undefined) ||
          (entity.stopId !== null && timetable.stops[entity.stopId] === undefined),
      );
      expect(unknown).toEqual([]);
    },
    120_000,
  );
});

describe('the street readers asked on demand, against the real portal', () => {
  it('reads the parking signs of one tile, each with its text', async () => {
    const reader = createParkingSignsReader({ http, clock: systemClock });
    const outcome = await reader.near({ lat: 40.7695407107263, lon: -73.9883702549362 });
    if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail}`);
    expect(outcome.value.signs.length).toBeGreaterThan(0);
    expect(outcome.value.signs.every((sign) => sign.text !== '')).toBe(true);
  }, 60_000);

  it('reads the stipulations of one permit', async () => {
    const reader = createPermitStipulationsReader({ http, clock: systemClock });
    const outcome = await reader.forPermit('B022026282B47');
    if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail}`);
    expect(outcome.value.stipulations.length).toBeGreaterThan(0);
  }, 60_000);
});
