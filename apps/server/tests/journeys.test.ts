import { fileURLToPath } from 'node:url';

import { apiErrorSchema, journeySchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { journeyStore } from '../src/modules/journeys/journey-store.js';
import type { RoutingProvider } from '../src/modules/journeys/ports.js';
import { journeyApp, planAs, postJson } from './support/journey-app.js';
import { fakeRouting, subwayTrip } from './support/journeys.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock('2026-11-11T17:00:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
});

afterEach(async () => {
  await temp.dispose();
});

const appWith = (routing: RoutingProvider) => journeyApp({ db, clock, routing });
const json = postJson;

describe('the backward planner', () => {
  it('recommends the latest departure that keeps the spare time, and lists it first', async () => {
    const early = subwayTrip('2026-11-11T18:00:00.000Z', '2026-11-11T18:35:00.000Z');
    const late = subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z');
    const tight = subwayTrip('2026-11-11T18:25:00.000Z', '2026-11-11T18:57:00.000Z');
    const { plan } = await planAs(appWith(fakeRouting([early, tight, late])));
    expect(plan.itineraries.map((itinerary) => itinerary.arriveAt)).toEqual([
      '2026-11-11T18:50:00.000Z',
      '2026-11-11T18:57:00.000Z',
      '2026-11-11T18:35:00.000Z',
    ]);
    expect(plan.recommendedId).toBe(plan.itineraries[0]?.id);
    expect(plan.itineraries[0]).toMatchObject({ spareMinutes: 10, transfers: 0, walkMinutes: 5 });
    expect(plan.itineraries[0]?.legs.map((leg) => leg.timing)).toEqual(['scheduled', 'estimated']);
    expect(plan.notices).toEqual([]);
  });

  it('says so when no option keeps the spare time, and recommends the earliest arrival', async () => {
    const { plan } = await planAs(
      appWith(fakeRouting([subwayTrip('2026-11-11T18:25:00.000Z', '2026-11-11T18:57:00.000Z')])),
    );
    expect(plan.notices).toEqual([
      'No option keeps 10 min to spare; the earliest arrives at 13:57.',
    ]);
    expect(plan.recommendedId).toBe(plan.itineraries[0]?.id);
  });

  it('never offers a departure that already left, nor invents routes when the engine is down', async () => {
    const gone = subwayTrip('2026-11-11T16:30:00.000Z', '2026-11-11T17:10:00.000Z');
    const { plan } = await planAs(appWith(fakeRouting([gone])));
    expect(plan).toMatchObject({
      itineraries: [],
      recommendedId: null,
      notices: ['No route leaves from now on and arrives in time.'],
    });
    const down = await planAs(appWith(fakeRouting('down')));
    expect(down.plan).toMatchObject({
      itineraries: [],
      notices: ['Routes are not available right now: The routing engine did not answer.'],
    });
  });
});

describe('journeys', () => {
  it('starts a journey from a plan of the same traveller, and only they can see it', async () => {
    const app = appWith(
      fakeRouting([subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z')]),
    );
    const { plan, cookie } = await planAs(app);
    const itineraryId = plan.recommendedId ?? '';
    const created = await app.request(
      '/api/journeys',
      json({ planId: plan.planId, itineraryId }, cookie),
    );
    expect(created.status).toBe(201);
    const journey = journeySchema.parse(await created.json());
    expect(journey).toMatchObject({
      state: 'watching',
      watch: { status: 'unknown' },
      itinerary: { id: itineraryId },
    });
    expect((await app.request(`/api/journeys/${journey.id}`, { headers: { cookie } })).status).toBe(
      200,
    );

    const stranger = await planAs(app);
    expect(
      (await app.request(`/api/journeys/${journey.id}`, { headers: { cookie: stranger.cookie } }))
        .status,
    ).toBe(404);
    expect((await app.request(`/api/journeys/${journey.id}`)).status).toBe(404);
    const stolen = await app.request(
      '/api/journeys',
      json({ planId: plan.planId, itineraryId }, stranger.cookie),
    );
    expect(apiErrorSchema.parse(await stolen.json()).error.code).toBe('not_found');
  });

  it('refuses an expired plan and lets the owner cancel the journey', async () => {
    const app = appWith(
      fakeRouting([subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z')]),
    );
    const { plan, cookie } = await planAs(app);
    const created = journeySchema.parse(
      await (
        await app.request(
          '/api/journeys',
          json({ planId: plan.planId, itineraryId: plan.recommendedId }, cookie),
        )
      ).json(),
    );
    expect(
      (await app.request(`/api/journeys/${created.id}`, { method: 'DELETE', headers: { cookie } }))
        .status,
    ).toBe(204);
    expect((await journeyStore.get(db, created.id))?.journey.state).toBe('cancelled');
    clock.advance(31 * 60_000);
    const late = await app.request(
      '/api/journeys',
      json({ planId: plan.planId, itineraryId: plan.recommendedId }, cookie),
    );
    expect(late.status).toBe(404);
  });

  it('streams the journey, then each new version of it', async () => {
    const app = appWith(
      fakeRouting([subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z')]),
    );
    const { plan, cookie } = await planAs(app);
    const journey = journeySchema.parse(
      await (
        await app.request(
          '/api/journeys',
          json({ planId: plan.planId, itineraryId: plan.recommendedId }, cookie),
        )
      ).json(),
    );
    const controller = new AbortController();
    const response = await app.request(`/api/journeys/${journey.id}/events`, {
      headers: { cookie },
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no stream');
    let text = '';
    const readUntil = async (count: number) => {
      while ((text.match(/^data: \{/gm) ?? []).length < count) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value: unknown = chunk.value;
        if (value instanceof Uint8Array) text += new TextDecoder().decode(value);
      }
    };
    await readUntil(1);
    const stored = await journeyStore.get(db, journey.id);
    await db.transaction((tx) =>
      journeyStore.update(
        tx,
        journey.id,
        stored?.version ?? 0,
        {
          watch: {
            status: 'at-risk',
            evaluatedAt: clock.now().toISOString(),
            projectedArriveAt: null,
            evidence: 'The A runs 6 min late.',
            flight: null,
            stepFreeRefusal: null,
          },
        },
        clock.now(),
      ),
    );
    await readUntil(2);
    controller.abort();
    expect(text).toContain('"status":"at-risk"');
    expect(text).not.toContain('event:');
  });
});
