import type { Itinerary, Place, PlanRequest, PlanResponse } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import type { PlanningPorts } from '../../src/modules/assistant/planning/actions.js';
import { emptyState, type Turn } from '../../src/modules/assistant/planning/state.js';
import {
  legAfterStop,
  planThroughStop,
  STOP_MINUTES,
} from '../../src/modules/assistant/planning/stopover.js';

const provenance = { sourceId: 'test', fetchedAt: '2026-11-13T12:00:00.000Z' };
const place = (label: string): Place =>
  ({ label, lat: 40.75, lon: -73.98, provenance }) as unknown as Place;
const START = place('Times Square');
const STOP = place('Bryant Park');
const END = place('Brooklyn Museum');

function leg(from: Place, to: Place, departAt: string, arriveAt: string, mode: 'walk' | 'subway') {
  return {
    mode,
    from,
    to,
    departAt,
    arriveAt,
    route: mode === 'walk' ? null : { id: 'Q', shortName: 'Q', headsign: null },
    tripId: null,
    timing: 'scheduled',
    provenance,
    path: [],
  } as unknown as Itinerary['legs'][number];
}

function plan(id: string, legs: Itinerary['legs']): PlanResponse {
  const first = legs[0];
  const last = legs.at(-1);
  if (first === undefined || last === undefined) throw new Error('A plan needs legs.');
  return {
    planId: `plan-${id}`,
    generatedAt: '2026-11-13T12:00:00.000Z',
    itineraries: [
      {
        id,
        departAt: first.departAt,
        arriveAt: last.arriveAt,
        spareMinutes: 7,
        transfers: 0,
        walkMinutes: 4,
        legs,
        fare: { amount: { amountMinor: 300, currency: 'USD' }, note: 'OMNY' },
      },
    ],
    recommendedId: id,
    notices: [`notice of ${id}`],
  };
}

function turnOf(): Turn {
  return {
    state: emptyState(),
    notes: [],
    city: [],
    lang: 'en',
    now: new Date('2026-11-13T12:00:00.000Z'),
    travellerId: 'traveller-1',
    signal: undefined,
  };
}

const request: PlanRequest = {
  origin: START,
  destination: END,
  arriveBy: '2026-11-13T15:00:00.000Z',
  flight: null,
  preferences: { maxWalkMinutes: 15, stepFree: false, modes: ['walk', 'subway'], spareMinutes: 5 },
};

describe('a trip through a stop on the way', () => {
  it('plans the second part first and reaches the stop ten minutes before leaving it', async () => {
    const asked: PlanRequest[] = [];
    const onward = plan('onward', [
      leg(STOP, END, '2026-11-13T14:20:00.000Z', '2026-11-13T14:53:00.000Z', 'subway'),
    ]);
    const before = plan('before', [
      leg(START, STOP, '2026-11-13T14:02:00.000Z', '2026-11-13T14:08:00.000Z', 'walk'),
    ]);
    const ports = {
      planner: {
        plan: (asking: PlanRequest) => {
          asked.push(asking);
          return Promise.resolve(asked.length === 1 ? onward : before);
        },
      },
    } as unknown as PlanningPorts;

    const joined = await planThroughStop(ports, turnOf(), request, STOP);

    expect(asked[0]).toMatchObject({ origin: STOP, destination: END });
    expect(asked[1]).toMatchObject({ origin: START, destination: STOP, flight: null });
    const beThere = new Date('2026-11-13T14:20:00.000Z').getTime() - STOP_MINUTES * 60_000;
    expect(new Date(asked[1]?.arriveBy ?? '').getTime()).toBe(beThere);
    const [trip] = joined.itineraries;
    expect(joined.recommendedId).toBe(trip?.id);
    expect(trip?.departAt).toBe('2026-11-13T14:02:00.000Z');
    expect(trip?.arriveAt).toBe('2026-11-13T14:53:00.000Z');
    expect(trip?.legs.map((part) => part.mode)).toEqual(['walk', 'subway']);
    expect(trip?.fare).toBeNull();
    expect(joined.notices).toEqual(['notice of before', 'notice of onward']);
    expect(legAfterStop(trip?.legs ?? [], STOP)).toBe(1);
  });

  it('returns the part that has no itinerary as the planner gave it', async () => {
    const nothing: PlanResponse = { ...plan('x', [leg(STOP, END, 'a', 'b', 'walk')]) };
    const empty = { ...nothing, itineraries: [], recommendedId: null, notices: ['No way found.'] };
    const ports = {
      planner: { plan: () => Promise.resolve(empty) },
    } as unknown as PlanningPorts;

    const answer = await planThroughStop(ports, turnOf(), request, STOP);

    expect(answer.itineraries).toEqual([]);
    expect(answer.notices).toEqual(['No way found.']);
  });

  it('finds no stop in a trip that does not pass by it', () => {
    const legs = [
      leg(START, END, '2026-11-13T14:20:00.000Z', '2026-11-13T14:53:00.000Z', 'subway'),
    ];
    expect(legAfterStop(legs, STOP)).toBeUndefined();
  });
});
