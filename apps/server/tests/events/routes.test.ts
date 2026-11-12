import { fileURLToPath } from 'node:url';

import { eventsResponseSchema, type EventsResponse } from '@moviq/contracts';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveIntegrations } from '../../src/config/integrations.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { credentialsFrom } from '../../src/modules/data-platform/credentials.js';
import { createSourceReader } from '../../src/modules/data-platform/reader.js';
import {
  brooklynParamountEventsSource,
  irvingPlazaEventsSource,
  nycParksEventsSource,
  ticketmasterSources,
} from '../../src/modules/data-platform/sources/events/index.js';
import { eventRoutes } from '../../src/modules/events/routes.js';
import { RECEIVED } from '../sources/events/fixtures.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';
import { serveCapture } from './seed.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

/** The API as the process mounts it, with the integrations of `env`. */
function app(env: Readonly<Record<string, string>>): Hono<AppBindings> {
  const { missingVariables } = credentialsFrom(resolveIntegrations(env));
  const reader = createSourceReader({ db, clock, missingVariables });
  const root = new Hono<AppBindings>();
  root.use(requestContext(memoryLogger().logger));
  root.route('/api/events', eventRoutes({ reader, clock }));
  return root;
}

async function get(env: Readonly<Record<string, string>>, query = ''): Promise<EventsResponse> {
  const response = await app(env).request(`/api/events${query}`);
  expect(response.status).toBe(200);
  return eventsResponseSchema.parse(await response.json());
}

async function serveFreeSources(): Promise<void> {
  await serveCapture(db, nycParksEventsSource, 'nyc-parks-events.json', RECEIVED.parks);
  await serveCapture(db, irvingPlazaEventsSource, 'irving-plaza-shows.html', RECEIVED.venues);
  await serveCapture(
    db,
    brooklynParamountEventsSource,
    'brooklyn-paramount-shows.html',
    RECEIVED.venues,
  );
}

const KEY = { TICKETMASTER_API_KEY: 'test-key' };

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  // Five minutes after the last capture: 23:56 on 10/11/2026 in New York.
  clock = manualClock('2026-11-11T04:56:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../../migrations/', import.meta.url))),
    clock,
  );
});

afterEach(async () => {
  await temp.dispose();
});

describe('GET /api/events', () => {
  it('without the Ticketmaster key serves the others and says Ticketmaster is missing', async () => {
    await serveFreeSources();
    const answer = await get({});
    const ticketmaster = answer.sources.find((source) => source.id === 'ticketmaster');
    expect(ticketmaster).toMatchObject({ served: false, complete: false, count: 0 });
    expect(ticketmaster?.provenance).toHaveLength(14);
    for (const provenance of ticketmaster?.provenance ?? []) {
      expect(provenance).toMatchObject({
        state: 'misconfigured',
        evidence: 'Needs TICKETMASTER_API_KEY, which is not set.',
      });
    }
    expect(answer.sources.filter((source) => source.served).map((source) => source.id)).toEqual([
      'irving-plaza',
      'brooklyn-paramount',
      'nyc-parks-events',
    ]);
    expect(answer.events.length).toBeGreaterThan(0);
    expect(answer.events.every((event) => !event.id.startsWith('ticketmaster:'))).toBe(true);
  });

  it('merges the same concert from two sources and keeps every listing with its time', async () => {
    await serveFreeSources();
    const [first] = ticketmasterSources;
    if (first === undefined) throw new Error('No window');
    await serveCapture(db, first, 'ticketmaster-events.json', RECEIVED.ticketmaster);
    const answer = await get(KEY);
    const sting = answer.events.filter(
      (event) => event.startsAt === '2026-11-12T00:00:00.000Z' && event.name === 'Test Singer Tour',
    );
    expect(sting).toHaveLength(1);
    const listings = sting[0]?.listings ?? [];
    expect(listings.map(({ sourceId, dataTime }) => ({ sourceId, dataTime }))).toEqual([
      { sourceId: 'ticketmaster-events-01', dataTime: '2026-11-11T04:40:20.000Z' },
      { sourceId: 'brooklyn-paramount-events', dataTime: '2026-11-11T04:37:40.000Z' },
    ]);
    expect(listings[0]?.eventId).toBe('tm-test-11');
    expect(listings[0]?.officialUrl).toMatch(/^https:\/\/www\.ticketmaster\.com\/test-singer-tour/);
    expect(listings[1]?.officialUrl).toMatch(/^https:\/\/www\.ticketmaster\.com\//);
    const ticketmaster = answer.sources.find((source) => source.id === 'ticketmaster');
    // One window of fourteen is served, and it says Ticketmaster holds more.
    expect(ticketmaster).toMatchObject({ served: true, complete: false, count: 9 });
  });

  it('serves no event already over, nor one without an end once it has started', async () => {
    await serveFreeSources();
    const answer = await get({});
    const names = answer.events.map((event) => event.name);
    expect(names).not.toContain('Forest Fitness');
    expect(names).not.toContain('Test Country Tour');
    for (const event of answer.events) {
      const end = event.endsAt ?? event.startsAt;
      expect(Date.parse(end)).toBeGreaterThanOrEqual(Date.parse(answer.from));
    }
  });

  it('filters by time, box and category', async () => {
    await serveFreeSources();
    const weekend = await get({}, '?from=2026-11-14T05:00:00.000Z&to=2026-11-16T10:00:00.000Z');
    expect(weekend.events.length).toBeGreaterThan(0);
    for (const event of weekend.events) {
      expect(Date.parse(event.startsAt)).toBeLessThan(Date.parse(weekend.to));
    }
    const music = await get({}, '?category=music');
    expect(music.categories).toEqual(['music']);
    expect(music.events.every((event) => event.category === 'music')).toBe(true);
    // Lower Manhattan: Irving Plaza is inside, Brooklyn Paramount and the parks outside it.
    const box = await get({}, '?bbox=-74.02,40.70,-73.97,40.75');
    expect(new Set(box.events.map((event) => event.venue.name))).toEqual(
      new Set(['Irving Plaza Powered By Verizon 5G']),
    );
  });

  it('says what is wrong with a query', async () => {
    const cases = [
      '?from=yesterday',
      '?to=2026-11-10T00:00:00.000Z',
      '?from=2026-11-11T00:00:00.000Z&to=2026-12-01T00:00:00.000Z',
      '?bbox=1,2,3',
      '?category=opera',
    ];
    for (const query of cases) {
      const response = await app({}).request(`/api/events${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
    }
  });

  it('offers only the official pages the sources give: nothing to pay, nothing booked', async () => {
    await serveFreeSources();
    const answer = await get({});
    for (const event of answer.events) {
      expect(Object.keys(event).sort()).toEqual(
        ['category', 'endsAt', 'id', 'listings', 'name', 'startsAt', 'status', 'venue'].sort(),
      );
      for (const listing of event.listings) expect(listing.officialUrl).toMatch(/^https?:\/\//);
    }
    expect(JSON.stringify(answer)).not.toMatch(/paypal|price|free|booked|reserved/i);
  });
});
