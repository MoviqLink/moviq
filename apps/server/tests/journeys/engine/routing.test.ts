import { describe, expect, it } from 'vitest';

import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import type { RoutedItinerary, RouteQuery } from '../../../src/modules/journeys/ports.js';
import {
  handTimetable,
  place,
  query,
  sources,
  stopPlace,
  summary,
  timetableReading,
  tuesday,
  type HandTrip,
} from './hand-network.js';

const NOW = { now: () => tuesday('06:00') };

async function plan(
  trips: readonly HandTrip[],
  request: RouteQuery,
  options: { readonly maxTransfers?: number } = {},
): Promise<readonly RoutedItinerary[]> {
  const engine = createEngineRouting({
    sources: sources([timetableReading(handTimetable(trips))]),
    clock: NOW,
    ...options,
  });
  const outcome = await engine.plan(request);
  if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail}`);
  return outcome.value;
}

const LINE_1: readonly HandTrip[] = [
  {
    id: 'L1a',
    route: 'L1',
    calls: [
      ['A', '08:00'],
      ['B', '08:10'],
      ['C', '08:20'],
    ],
  },
  {
    id: 'L1b',
    route: 'L1',
    calls: [
      ['A', '08:15'],
      ['B', '08:25'],
      ['C', '08:35'],
    ],
  },
  {
    id: 'L1c',
    route: 'L1',
    calls: [
      ['A', '08:30'],
      ['B', '08:40'],
      ['C', '08:50'],
    ],
  },
];

describe('the engine plans backwards over a hand-written network', () => {
  it('takes the latest trip arriving in time, then the ones before it', async () => {
    const result = await plan(
      LINE_1,
      query({ from: stopPlace('A'), to: stopPlace('C'), arriveBy: tuesday('08:40') }),
    );
    expect(result.map((itinerary) => summary(itinerary.legs))).toEqual([
      ['subway L1 A 08:15:00 > C 08:35:00'],
      ['subway L1 A 08:00:00 > C 08:20:00'],
    ]);
    expect(result[0]?.legs[0]).toMatchObject({ tripId: 'L1b', scheduled: true });
    expect(result[0]?.legs[0]?.route).toEqual({ id: 'L1', shortName: 'L1', headsign: 'To L1' });
    // The hand-written timetable has no shapes: the ride is drawn through the stops it calls at.
    expect(result[0]?.legs[0]?.path).toEqual([
      [-74.0, 40.7],
      [-74.0, 40.709],
      [-74.0, 40.718],
    ]);
  });

  it('keeps a minute to change at the same stop', async () => {
    const trips: HandTrip[] = [
      {
        id: 'R1a',
        route: 'R1',
        calls: [
          ['A', '07:50'],
          ['B', '08:00'],
        ],
      },
      {
        id: 'R1b',
        route: 'R1',
        calls: [
          ['A', '08:00'],
          ['B', '08:10'],
        ],
      },
      {
        id: 'R2a',
        route: 'R2',
        calls: [
          ['B', '08:10:30'],
          ['D', '08:20'],
        ],
      },
    ];
    const result = await plan(
      trips,
      query({ from: stopPlace('A'), to: stopPlace('D'), arriveBy: tuesday('08:25'), count: 1 }),
    );
    expect(result.map((itinerary) => summary(itinerary.legs))).toEqual([
      ['subway R1 A 07:50:00 > B 08:00:00', 'subway R2 B 08:10:30 > D 08:20:00'],
    ]);
  });

  it('walks between nearby stops to change, at the walking speed and detour assumed', async () => {
    const trips: HandTrip[] = [
      {
        id: 'R1',
        route: 'R1',
        calls: [
          ['A', '08:00'],
          ['B', '08:10'],
        ],
      },
      {
        id: 'R3',
        route: 'R3',
        calls: [
          ['B2', '08:12'],
          ['D', '08:30'],
        ],
      },
    ];
    const result = await plan(
      trips,
      query({ from: stopPlace('A'), to: stopPlace('D'), arriveBy: tuesday('08:35'), count: 1 }),
    );
    // B to B2 is 99.5 m in a straight line: 99.5 × 1.3 / 1.2 = 108 s.
    expect(summary(result[0]?.legs ?? [])).toEqual([
      'subway R1 A 08:00:00 > B 08:10:00',
      'walk B 08:10:00 > B2 08:11:48',
      'subway R3 B2 08:12:00 > D 08:30:00',
    ]);
  });

  it('returns the Pareto front of departure time and rides, latest departure first', async () => {
    const trips: HandTrip[] = [
      {
        id: 'slow',
        route: 'S',
        calls: [
          ['A', '07:30'],
          ['D', '08:20'],
        ],
      },
      {
        id: 'fast1',
        route: 'F1',
        calls: [
          ['A', '07:50'],
          ['B', '07:55'],
        ],
      },
      {
        id: 'fast2',
        route: 'F2',
        calls: [
          ['B', '07:57'],
          ['D', '08:15'],
        ],
      },
    ];
    const request = query({ from: stopPlace('A'), to: stopPlace('D'), arriveBy: tuesday('08:25') });
    const front = await plan(trips, request);
    expect(front.map((itinerary) => summary(itinerary.legs))).toEqual([
      ['subway F1 A 07:50:00 > B 07:55:00', 'subway F2 B 07:57:00 > D 08:15:00'],
      ['subway S A 07:30:00 > D 08:20:00'],
    ]);
    const direct = await plan(trips, request, { maxTransfers: 0 });
    expect(direct.map((itinerary) => summary(itinerary.legs))).toEqual([
      ['subway S A 07:30:00 > D 08:20:00'],
    ]);
  });

  it('rides trips of the previous service day that run past midnight', async () => {
    const trips: HandTrip[] = [
      {
        id: 'night',
        route: 'N',
        calls: [
          ['A', '24:10'],
          ['C', '24:40'],
        ],
      },
      {
        id: 'sunday',
        route: 'N',
        service: 'SUN',
        calls: [
          ['A', '24:20'],
          ['C', '24:45'],
        ],
      },
    ];
    const engine = createEngineRouting({
      sources: sources([timetableReading(handTimetable(trips))]),
      clock: { now: () => new Date(tuesday('00:00').getTime() - 3_600_000) },
    });
    const outcome = await engine.plan(
      query({ from: stopPlace('A'), to: stopPlace('C'), arriveBy: tuesday('00:50') }),
    );
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.value).toHaveLength(1);
    // Monday's 24:10 is Tuesday 00:10 in New York, 05:10 UTC; the Sunday trip does not run.
    expect(outcome.value[0]?.legs[0]).toMatchObject({
      tripId: 'night',
      departAt: new Date('2026-11-10T05:10:00.000Z'),
      arriveAt: new Date('2026-11-10T05:40:00.000Z'),
    });
  });

  it('walks to and from stops within the walk limit, and offers walking all the way', async () => {
    const south = { ...place('A', 'Home'), lat: 40.6982 };
    const result = await plan(
      LINE_1,
      query({
        from: south,
        to: stopPlace('C'),
        arriveBy: tuesday('08:40'),
        maxWalkMinutes: 5,
        count: 1,
      }),
    );
    // 200 m south of A: 200.2 × 1.3 / 1.2 = 217 s on foot before the 08:15 departure.
    expect(summary(result[0]?.legs ?? [])).toEqual([
      'walk origin 08:11:23 > A 08:15:00',
      'subway L1 A 08:15:00 > C 08:35:00',
    ]);
    // 422.5 m to the office: 458 s on foot.
    const near = { ...place('B', 'Office'), lat: 40.702 };
    const walking = await plan(
      LINE_1,
      query({
        from: south,
        to: near,
        arriveBy: tuesday('08:40'),
        maxWalkMinutes: 15,
        modes: ['walk'],
      }),
    );
    expect(walking.map((itinerary) => summary(itinerary.legs))).toEqual([
      ['walk origin 08:32:22 > destination 08:40:00'],
    ]);
    // Walks are estimated from the straight line: no street geometry, so no path to draw as exact.
    const walks = [...(result[0]?.legs ?? []), ...(walking[0]?.legs ?? [])].filter(
      (leg) => leg.mode === 'walk',
    );
    expect(walks.map((leg) => leg.path)).toEqual([[], []]);
  });

  it('breaks ties the same way whatever the order of the timetable', async () => {
    const trips: HandTrip[] = [
      {
        id: 'nine',
        route: 'R9',
        calls: [
          ['A', '08:00'],
          ['C', '08:20'],
        ],
      },
      {
        id: 'one',
        route: 'R1',
        calls: [
          ['A', '08:00'],
          ['C', '08:20'],
        ],
      },
    ];
    const request = query({ from: stopPlace('A'), to: stopPlace('C'), arriveBy: tuesday('08:30') });
    const forwards = await plan(trips, request);
    const backwards = await plan([...trips].reverse(), request);
    expect(forwards).toEqual(backwards);
    expect(forwards.map((itinerary) => itinerary.legs[0]?.tripId)).toEqual(['one']);
  });
});
