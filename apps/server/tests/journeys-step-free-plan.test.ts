import { fileURLToPath } from 'node:url';

import type { PlanRequest } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { createPlanner } from '../src/modules/journeys/planner.js';
import type { RoutedItinerary, RoutingProvider } from '../src/modules/journeys/ports.js';
import { ROUTING_PROVENANCE } from './support/journeys.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import {
  D17_OUTAGE,
  heraldSquareJourney,
  heraldSquareLegs,
  stepFreeLists,
  stepFreeReader,
} from './support/step-free.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

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

/** The routed form of the Herald Sq legs, as the engine returns them. */
const ROUTED: RoutedItinerary = {
  legs: heraldSquareLegs().map((leg) => ({
    mode: leg.mode,
    from: leg.from,
    to: leg.to,
    departAt: new Date(leg.departAt),
    arriveAt: new Date(leg.arriveAt),
    route: leg.route,
    tripId: leg.tripId,
    scheduled: true,
    path: leg.path,
  })),
};

const answering: RoutingProvider = {
  sourceId: 'moviq-raptor',
  plan: () => Promise.resolve({ ok: true, value: [ROUTED], provenance: ROUTING_PROVENANCE }),
};

const refusing: RoutingProvider = {
  sourceId: 'moviq-raptor',
  plan: () =>
    Promise.resolve({
      ok: false,
      state: 'unavailable',
      code: 'no-step-free-data',
      detail: 'The timetables served do not say which stops are step-free.',
    }),
};

const nothing = { read: () => Promise.reject(new Error('only the step-free lists are read')) };
const reader = stepFreeReader(stepFreeLists([D17_OUTAGE]), nothing);

function request(stepFree: boolean): PlanRequest {
  return heraldSquareJourney(stepFree).request;
}

describe('the step-free check of a plan', () => {
  it('gives a step-free plan its platforms, the time of the outages and its warnings', async () => {
    const planner = createPlanner({
      db,
      clock,
      routing: answering,
      fares: { fareFor: () => null },
      reader,
    });
    const plan = await planner.plan(request(true), 'traveller-1');
    const access = plan.itineraries[0]?.accessibility;
    expect(access?.checkedAt).toBe('2026-11-11T21:20:00.000Z');
    expect(access?.platforms.map((platform) => platform.state)).toEqual([
      'accessible',
      'accessible',
      'accessible',
      'elevator-out',
    ]);
    expect(access?.warnings.map((warning) => warning.kind)).toEqual([
      'modes-left-out',
      'change-unverified',
      'entrance-not-surveyed',
      'walk-unverified',
      'walk-unverified',
    ]);
  });

  it('leaves the check out of a plan that is not step-free, and of one without the lists', async () => {
    const fares = { fareFor: () => null };
    const withLists = createPlanner({ db, clock, routing: answering, fares, reader });
    const plain = await withLists.plan(request(false), 'traveller-1');
    expect(plain.itineraries[0]?.accessibility).toBeNull();
    const withoutLists = createPlanner({ db, clock, routing: answering, fares });
    const unread = await withoutLists.plan(request(true), 'traveller-1');
    expect(unread.itineraries[0]?.accessibility).toBeNull();
  });

  it('says plainly when a step-free trip cannot be guaranteed', async () => {
    const planner = createPlanner({
      db,
      clock,
      routing: refusing,
      fares: { fareFor: () => null },
      reader,
    });
    const plan = await planner.plan(request(true), 'traveller-1');
    expect(plan.itineraries).toEqual([]);
    expect(plan.notices).toEqual([
      "We can't guarantee a step-free trip right now: The timetables served do not say which " +
        'stops are step-free.',
    ]);
  });
});
