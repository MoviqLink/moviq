import { fileURLToPath } from 'node:url';

import type { Journey, Provenance } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import type { LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import type { SourceReader } from '../src/modules/data-platform/reader.js';
import { interestStore } from '../src/modules/data-platform/interests.js';
import { toItinerary } from '../src/modules/journeys/itineraries.js';
import { journeyStore } from '../src/modules/journeys/journey-store.js';
import { journeyPurchases } from '../src/modules/journeys/purchases.js';
import { runJourneyWatch } from '../src/modules/journeys/watch.js';
import type { PredictedTrip } from '../src/modules/journeys/watch-assess.js';
import { finder, sources } from './support/flights.js';
import { fakeRouting, planRequest, ROUTING_PROVENANCE, subwayTrip } from './support/journeys.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { servingSource } from './support/sources.js';
import { stepFreeLists, stepFreeReader } from './support/step-free.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';
import { waitFor } from './support/wait.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock('2026-11-11T18:20:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
});

afterEach(async () => {
  await temp.dispose();
});

const LIVE: Provenance = { ...ROUTING_PROVENANCE, sourceId: 'feed', evidence: 'Data is 10 s old.' };
const tripsSchema = z.object({
  trips: z.array(
    z.object({
      tripId: z.string(),
      routeId: z.string(),
      stops: z.array(
        z.object({
          stopId: z.string(),
          arrival: z.string().nullable(),
          departure: z.string().nullable(),
        }),
      ),
    }),
  ),
});
const alertsSchema = z.object({
  alerts: z.array(
    z.object({
      id: z.string(),
      header: z.string(),
      affected: z.array(
        z.object({ agencyId: z.string().nullable(), routeId: z.string().nullable() }),
      ),
      activePeriods: z.array(
        z.object({ start: z.string().nullable(), end: z.string().nullable() }),
      ),
    }),
  ),
});
const predictions = servingSource('subway-a', tripsSchema);
const alerts = servingSource('alerts', alertsSchema);

/**
 * A reader that serves the given live trips and the step-free lists, validated like the real one
 * with each schema.
 */
function readerWith(trips: readonly PredictedTrip[], lists = stepFreeLists()): SourceReader {
  return stepFreeReader(lists, {
    read: (definition) =>
      Promise.resolve({
        data: definition.dataSchema.parse(definition.id === 'alerts' ? { alerts: [] } : { trips }),
        provenance: { ...LIVE, sourceId: definition.id },
      }),
  });
}

async function storeJourney(): Promise<Journey> {
  const journey: Journey = {
    id: 'j1',
    state: 'watching',
    request: planRequest(),
    itinerary: toItinerary(
      subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z'),
      ROUTING_PROVENANCE,
      new Date('2026-11-11T19:00:00.000Z'),
      { fareFor: () => null },
    ),
    createdAt: '2026-11-11T18:00:00.000Z',
    watch: {
      status: 'unknown',
      evaluatedAt: null,
      projectedArriveAt: null,
      evidence: 'Not checked yet.',
      flight: null,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
  await journeyStore.create(db, journey, 'traveller-1', clock.now());
  return journey;
}

function startWatch(
  reader: SourceReader,
  routing = fakeRouting([subwayTrip('2026-11-11T18:25:00.000Z', '2026-11-11T18:52:00.000Z')]),
) {
  const controller = new AbortController();
  const term: LeaderTerm = {
    name: 'worker',
    holder: 'test',
    fencingToken: 1,
    signal: controller.signal,
    fenced: (work) => db.transaction(work),
  };
  const running = runJourneyWatch(term, {
    db,
    clock,
    logger: memoryLogger().logger,
    reader,
    routing,
    fares: { fareFor: () => null },
    predictionSources: [predictions],
    alertsSource: alerts,
    // No journey here has a flight: the finder is never asked.
    flightSources: sources(finder({ ok: true, value: null, provenance: ROUTING_PROVENANCE })),
    intervalMs: 10,
    replanEveryMs: 60_000,
  });
  return async () => {
    controller.abort();
    await running;
  };
}

describe('runJourneyWatch', () => {
  it('watches a late train, records the proof, finds alternatives and keeps the feeds fast', async () => {
    await storeJourney();
    const stop = startWatch(
      readerWith([
        {
          tripId: 't',
          routeId: 'A',
          stops: [{ stopId: 'A27S', arrival: '2026-11-11T18:53:00.000Z', departure: null }],
        },
      ]),
    );
    await waitFor(
      async () => (await journeyStore.get(db, 'j1'))?.journey.watch.status === 'at-risk',
    );
    await stop();
    const { journey } = (await journeyStore.get(db, 'j1')) ?? {};
    expect(journey?.incidents).toMatchObject([{ kind: 'delay', impactMinutes: 8 }]);
    expect(journey?.alternatives).toMatchObject([{ recommended: true, price: null }]);
    expect(journey?.alternatives[0]?.why).toBe(
      'Arrives at 13:52, 8 min to spare: the earliest option.',
    );
    expect([...(await interestStore.activeSourceIds(db, clock.now()))].sort()).toEqual([
      'alerts',
      'mta-elevator-equipment',
      'mta-elevator-inventory',
      'mta-elevators',
      'mta-subway-entrances',
      'mta-subway-stations',
      'subway-a',
    ]);
  });

  it('finishes a journey an hour after its arrival', async () => {
    await storeJourney();
    clock.advance(2 * 60 * 60_000);
    const stop = startWatch(readerWith([]));
    await waitFor(async () => (await journeyStore.get(db, 'j1'))?.journey.state === 'completed');
    await stop();
  });
});

describe('journeyPurchases', () => {
  it('quotes only a priced alternative of the traveller own watched journey', async () => {
    await storeJourney();
    const catalog = journeyPurchases({ db, clock });
    const purpose = {
      kind: 'journey-alternative',
      journeyId: 'j1',
      alternativeId: 'none',
    } as const;
    expect(await catalog.quote(purpose, 'someone-else')).toEqual({
      ok: false,
      reason: 'There is no journey with that id.',
    });
    expect(await catalog.quote(purpose, 'traveller-1')).toEqual({
      ok: false,
      reason: 'That alternative is no longer on offer.',
    });
    const stored = await journeyStore.get(db, 'j1');
    const itinerary = stored?.journey.itinerary;
    if (stored === undefined || itinerary === undefined) throw new Error('fixture');
    await db.transaction((tx) =>
      journeyStore.update(
        tx,
        'j1',
        stored.version,
        {
          alternatives: [
            {
              id: 'taxi',
              itinerary,
              recommended: true,
              why: 'A taxi arrives at 13:45.',
              price: { amountMinor: 2350, currency: 'USD' },
            },
            { id: 'bus', itinerary, recommended: false, why: 'A bus.', price: null },
          ],
        },
        clock.now(),
      ),
    );
    expect(await catalog.quote({ ...purpose, alternativeId: 'bus' }, 'traveller-1')).toEqual({
      ok: false,
      reason: 'That alternative costs nothing: just take it.',
    });
    expect(await catalog.quote({ ...purpose, alternativeId: 'taxi' }, 'traveller-1')).toEqual({
      ok: true,
      amount: { amountMinor: 2350, currency: 'USD' },
      description: 'A taxi arrives at 13:45.',
    });
    await db.transaction((tx) =>
      catalog.fulfil({ ...purpose, alternativeId: 'taxi' }, 'payment-1', tx),
    );
    const after = await journeyStore.get(db, 'j1');
    expect(after?.journey).toMatchObject({
      alternatives: [],
      watch: { evidence: 'Switched to the alternative you paid for.' },
    });
    expect(
      z
        .array(z.object({ kind: z.string() }))
        .parse(
          (await db.query("SELECT kind FROM journey_events WHERE journey_id = 'j1' ORDER BY id"))
            .rows,
        )
        .map((row) => row.kind),
    ).toEqual(['created', 'alternative-paid']);
  });
});
