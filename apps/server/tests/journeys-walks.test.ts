import { fileURLToPath } from 'node:url';

import { planResponseSchema, type Journey, type PlanRequest } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { journeyFacts } from '../src/modules/assistant/journey/facts.js';
import { findAlternatives } from '../src/modules/journeys/alternatives.js';
import type {
  RoutedItinerary,
  RoutedLeg,
  RoutedWalk,
  RoutingProvider,
} from '../src/modules/journeys/ports.js';
import { journeyApp, postJson } from './support/journey-app.js';
import { fakeRouting, planRequest, subwayTrip } from './support/journeys.js';
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

const ESTIMATED: RoutedWalk = {
  basis: 'estimated',
  profile: 'foot',
  metres: null,
  unchecked: 'streets-unavailable',
};

/** The trip of the support with its walk labelled as given. */
function withWalk(itinerary: RoutedItinerary, walk: RoutedWalk): RoutedItinerary {
  return {
    legs: itinerary.legs.map((leg): RoutedLeg => (leg.mode === 'walk' ? { ...leg, walk } : leg)),
  };
}

/** A ride, an estimated change, a second ride: the change is not confirmed. */
function changeTrip(): RoutedItinerary {
  const [ride] = subwayTrip('2026-11-11T18:00:00.000Z', '2026-11-11T18:20:00.000Z').legs;
  if (ride === undefined) throw new Error('fixture');
  const change: RoutedLeg = {
    ...ride,
    mode: 'walk',
    route: null,
    tripId: null,
    departAt: ride.arriveAt,
    arriveAt: new Date(ride.arriveAt.getTime() + 120_000),
    path: [],
    walk: ESTIMATED,
  };
  const second: RoutedLeg = {
    ...ride,
    departAt: new Date(change.arriveAt.getTime() + 60_000),
    arriveAt: new Date(change.arriveAt.getTime() + 600_000),
  };
  return { legs: [ride, change, second] };
}

async function plan(itineraries: readonly RoutedItinerary[], request: PlanRequest = planRequest()) {
  const app = journeyApp({ db, clock, routing: fakeRouting(itineraries) });
  const response = await app.request('/api/plan', postJson(request));
  return planResponseSchema.parse(await response.json());
}

const stepFree = (): PlanRequest => {
  const request = planRequest();
  return { ...request, preferences: { ...request.preferences, stepFree: true } };
};

describe('what a plan says of its walks', () => {
  it('calls an itinerary with an estimated walk provisional and its margin approximate', async () => {
    const trip = withWalk(
      subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z'),
      ESTIMATED,
    );
    const served = await plan([trip]);
    expect(served.itineraries[0]?.walking).toBe('provisional');
    expect(served.itineraries[0]?.legs[1]?.walk).toEqual(ESTIMATED);
    expect(served.notices).toEqual([
      'Some walks of the recommended route are estimated, not checked on the streets: ' +
        'its changes are not confirmed and its time to spare is approximate.',
    ]);
  });

  it('never tells Sara an estimated change is sure', async () => {
    const served = await plan([changeTrip()]);
    const itinerary = served.itineraries[0];
    if (itinerary === undefined) throw new Error('no itinerary');
    const facts = JSON.parse(
      journeyFacts(journeyOf(itinerary, planRequest()), 'en', clock.now()).context,
    ) as { steps: { walk: string | null }[]; walksSay: string[] };
    expect(facts.steps[1]?.walk).toBe(
      'estimated, not checked on the streets: the change is not checked',
    );
    expect(facts.walksSay).toEqual([
      'Some walks are estimated: changes are not confirmed, the time to spare is approximate.',
    ]);
  });

  it('on a step-free trip, puts the walks walked with a wheelchair first and says what is not', async () => {
    const wheelchair: RoutedWalk = {
      basis: 'street',
      profile: 'wheelchair',
      metres: 410,
      unchecked: null,
    };
    // The estimated one leaves later and would be recommended first by time alone.
    const late = withWalk(subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z'), {
      ...ESTIMATED,
      profile: 'wheelchair',
    });
    const early = withWalk(
      subwayTrip('2026-11-11T18:05:00.000Z', '2026-11-11T18:40:00.000Z'),
      wheelchair,
    );
    const served = await plan([late, early], stepFree());
    expect(served.itineraries.map((itinerary) => itinerary.departAt)).toEqual([
      '2026-11-11T18:05:00.000Z',
      '2026-11-11T18:15:00.000Z',
    ]);
    expect(served.recommendedId).toBe(served.itineraries[0]?.id);
    const unchecked = served.itineraries[1];
    if (unchecked === undefined) throw new Error('no itinerary');
    const facts = JSON.parse(
      journeyFacts(journeyOf(unchecked, stepFree()), 'en', clock.now()).context,
    ) as { walksSay: string[] };
    expect(facts.walksSay).toContain('Step 2: step-free access is not checked on this walk.');
  });

  it('offers step-free alternatives walked with a wheelchair first, and says it of the others', async () => {
    const unchecked = withWalk(subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:35:00.000Z'), {
      ...ESTIMATED,
      profile: 'wheelchair',
    });
    const checked = withWalk(subwayTrip('2026-11-11T18:10:00.000Z', '2026-11-11T18:45:00.000Z'), {
      basis: 'street',
      profile: 'wheelchair',
      metres: 410,
      unchecked: null,
    });
    const served = await plan([checked], stepFree());
    const itinerary = served.itineraries[0];
    if (itinerary === undefined) throw new Error('no itinerary');
    const found = await findAlternatives(
      journeyOf(itinerary, stepFree()),
      fakeRouting([unchecked, checked]),
      { fareFor: () => null },
      clock.now(),
    );
    expect(found.alternatives.map((option) => option.itinerary.departAt)).toEqual([
      '2026-11-11T18:10:00.000Z',
      '2026-11-11T18:15:00.000Z',
    ]);
    expect(found.alternatives[0]?.recommended).toBe(true);
    expect(found.alternatives[1]?.why).toBe(
      'Arrives at 13:35, 25 min to spare. Some of its walks are estimated: changes not ' +
        'confirmed, time to spare approximate. Step-free access is not checked on some of its walks.',
    );
  });

  it('offers neither a plan nor an alternative the streets have no way for, and says why', async () => {
    const detail =
      'No itinerary arrives by 13:50: the streets of transitous have no way on foot from the start to 1 stop.';
    const noWay: RoutingProvider = {
      sourceId: 'moviq-raptor',
      plan: () =>
        Promise.resolve({ ok: false, state: 'unavailable', code: 'no-street-way', detail }),
    };
    const app = journeyApp({ db, clock, routing: noWay });
    const response = await app.request('/api/plan', postJson(planRequest()));
    const served = planResponseSchema.parse(await response.json());
    expect(served.itineraries).toEqual([]);
    expect(served.notices).toEqual([
      `No route can be walked on the streets for this trip: ${detail}`,
    ]);
    const trip = await plan([subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z')]);
    const itinerary = trip.itineraries[0];
    if (itinerary === undefined) throw new Error('no itinerary');
    const found = await findAlternatives(
      journeyOf(itinerary, planRequest()),
      noWay,
      {
        fareFor: () => null,
      },
      clock.now(),
    );
    expect(found).toEqual({ alternatives: [], refused: { code: 'no-street-way', detail } });
  });
});

function journeyOf(itinerary: Journey['itinerary'], request: PlanRequest): Journey {
  return {
    id: 'j1',
    state: 'watching',
    request,
    itinerary,
    createdAt: '2026-11-11T17:00:00.000Z',
    watch: {
      status: 'on-track',
      evaluatedAt: null,
      projectedArriveAt: null,
      evidence: 'Not watched yet.',
      flight: null,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
}
