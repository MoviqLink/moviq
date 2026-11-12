import { fileURLToPath } from 'node:url';

import type { Journey } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import type { LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import type { WatchExplanation } from '../src/modules/journeys/explanation.js';
import { toItinerary } from '../src/modules/journeys/itineraries.js';
import { journeyStore } from '../src/modules/journeys/journey-store.js';
import type { RoutingProvider } from '../src/modules/journeys/ports.js';
import { runJourneyWatch } from '../src/modules/journeys/watch.js';
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

const stopsSchema = z.array(
  z.object({
    stopId: z.string(),
    arrival: z.string().nullable(),
    departure: z.string().nullable(),
  }),
);
const tripsSchema = z.object({
  trips: z.array(z.object({ tripId: z.string(), routeId: z.string(), stops: stopsSchema })),
});
const alertsSchema = z.object({ alerts: z.array(z.never()) });
const predictions = servingSource('subway-a', tripsSchema);
const alerts = servingSource('alerts', alertsSchema);

/** The A of the plan, predicted 8 minutes late: the journey is at risk. */
const lateTrain = stepFreeReader(stepFreeLists(), {
  read: (definition) =>
    Promise.resolve({
      data: definition.dataSchema.parse(
        definition.id === 'alerts'
          ? { alerts: [] }
          : {
              trips: [
                {
                  tripId: 't',
                  routeId: 'A',
                  stops: [{ stopId: 'A27S', arrival: '2026-11-11T18:53:00.000Z', departure: null }],
                },
              ],
            },
      ),
      provenance: { ...ROUTING_PROVENANCE, sourceId: definition.id, evidence: 'Data is 10 s old.' },
    }),
});

/** What Sara wrote for the verdict the watch is about to commit: late A, the next A offered. */
const WORDS: WatchExplanation = {
  mode: 'basic',
  about: 'at-risk|delay:0|A>walk',
  lang: 'en',
  reason: 'no-model',
};

async function storeJourney(): Promise<void> {
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
}

/** Sara's words land while the watch is looking for alternatives, as from the API process. */
async function saraWritesMeanwhile(): Promise<void> {
  const stored = await journeyStore.get(db, 'j1');
  if (stored === undefined) throw new Error('fixture');
  const watch = { ...stored.journey.watch, explanation: WORDS };
  await db.transaction((tx) =>
    journeyStore.update(tx, 'j1', stored.version, { watch }, clock.now()),
  );
}

describe('the watch and Sara writing the same journey', () => {
  it('looks for alternatives again after a write in between, and keeps words that still apply', async () => {
    await storeJourney();
    const base = fakeRouting([subwayTrip('2026-11-11T18:25:00.000Z', '2026-11-11T18:52:00.000Z')]);
    let raced = false;
    const routing: RoutingProvider = {
      sourceId: base.sourceId,
      plan: async (query, signal) => {
        if (!raced) {
          raced = true;
          await saraWritesMeanwhile();
        }
        return base.plan(query, signal);
      },
    };
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
      reader: lateTrain,
      routing,
      fares: { fareFor: () => null },
      predictionSources: [predictions],
      alertsSource: alerts,
      flightSources: sources(finder({ ok: true, value: null, provenance: ROUTING_PROVENANCE })),
      intervalMs: 10,
      // Far longer than the test: only a lost write may make it look again.
      replanEveryMs: 60 * 60_000,
    });
    await waitFor(
      async () => (await journeyStore.get(db, 'j1'))?.journey.alternatives.length === 1,
    );
    controller.abort();
    await running;
    const { journey } = (await journeyStore.get(db, 'j1')) ?? {};
    expect(journey?.watch.status).toBe('at-risk');
    expect(journey?.watch.explanation).toEqual(WORDS);
    expect(base.calls()).toBe(4);
  });
});
