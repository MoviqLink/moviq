import { fileURLToPath } from 'node:url';

import type { Journey } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import type { LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import type { SourceReader } from '../src/modules/data-platform/reader.js';
import { journeyStore } from '../src/modules/journeys/journey-store.js';
import type { RouteQuery, RoutingProvider } from '../src/modules/journeys/ports.js';
import { runJourneyWatch } from '../src/modules/journeys/watch.js';
import { finder, sources } from './support/flights.js';
import { ROUTING_PROVENANCE, subwayTrip } from './support/journeys.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { servingSource } from './support/sources.js';
import {
  D17_OUTAGE,
  heraldSquareJourney,
  listProvenance,
  stepFreeLists,
  stepFreeReader,
} from './support/step-free.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';
import { waitFor } from './support/wait.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock('2026-11-11T21:20:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
});

afterEach(async () => {
  await temp.dispose();
});

const alerts = servingSource(
  'alerts',
  z.object({
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
  }),
);
/** No live source other than the step-free lists: none is asked for here. */
const noLive: SourceReader = {
  read: (definition) =>
    Promise.resolve({
      data: definition.dataSchema.parse({ alerts: [] }),
      provenance: listProvenance(definition.id),
    }),
};

/** A routing engine that keeps the queries it gets and answers as told. */
function routing(
  answer: 'ride' | 'no-step-free-data',
): RoutingProvider & { queries: RouteQuery[] } {
  const queries: RouteQuery[] = [];
  return {
    sourceId: 'moviq-raptor',
    queries,
    plan: (query) => {
      queries.push(query);
      return Promise.resolve(
        answer === 'ride'
          ? {
              ok: true,
              value: [subwayTrip('2026-11-11T21:35:00.000Z', '2026-11-11T21:55:00.000Z')],
              provenance: ROUTING_PROVENANCE,
            }
          : {
              ok: false,
              state: 'unavailable',
              code: 'no-step-free-data',
              detail: 'The timetables served do not say which stops are step-free.',
            },
      );
    },
  };
}

async function watchOnce(reader: SourceReader, engine: RoutingProvider): Promise<Journey> {
  await journeyStore.create(db, heraldSquareJourney(true), 'traveller-1', clock.now());
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
    routing: engine,
    fares: { fareFor: () => null },
    predictionSources: [],
    alertsSource: alerts,
    flightSources: sources(finder({ ok: true, value: null, provenance: ROUTING_PROVENANCE })),
    intervalMs: 10,
    replanEveryMs: 60_000,
  });
  await waitFor(
    async () => (await journeyStore.get(db, 'j-step-free'))?.journey.watch.evaluatedAt !== null,
  );
  controller.abort();
  await running;
  const stored = await journeyStore.get(db, 'j-step-free');
  if (stored === undefined) throw new Error('the journey is gone');
  return stored.journey;
}

describe('the watch of a step-free journey', () => {
  it('reads the elevator out at D17, keeps its proof and finds step-free alternatives', async () => {
    const engine = routing('ride');
    const journey = await watchOnce(stepFreeReader(stepFreeLists([D17_OUTAGE]), noLive), engine);
    expect(journey.watch.status).toBe('at-risk');
    expect(journey.incidents.map((incident) => incident.id)).toEqual(['elevator:3:EL293']);
    expect(journey.itinerary.accessibility?.platforms[3]?.state).toBe('elevator-out');
    expect(engine.queries.every((query) => query.stepFree)).toBe(true);
    expect(journey.alternatives.length).toBeGreaterThan(0);
    expect(
      journey.alternatives.every((option) => (option.itinerary.accessibility ?? null) !== null),
    ).toBe(true);
    expect(journey.watch.stepFreeRefusal).toBeNull();
  });

  it('says why no step-free alternative could be looked for', async () => {
    const reader = stepFreeReader(stepFreeLists([D17_OUTAGE]), noLive);
    const journey = await watchOnce(reader, routing('no-step-free-data'));
    expect(journey.alternatives).toEqual([]);
    expect(journey.watch.stepFreeRefusal).toEqual({
      reason: 'modes-without-data',
      detail: 'The timetables served do not say which stops are step-free.',
    });
  });

  it('turns a feed of outages down into source-down, never silence', async () => {
    const reader = stepFreeReader(stepFreeLists(), noLive, { 'mta-elevators': 'unavailable' });
    const journey = await watchOnce(reader, routing('ride'));
    expect(journey.incidents.map((incident) => incident.kind)).toEqual(['source-down']);
    expect(journey.itinerary.accessibility?.checkedAt).toBeNull();
    expect(journey.watch.status).toBe('unknown');
  });
});
