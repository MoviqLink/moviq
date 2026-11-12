import { describe, expect, it } from 'vitest';

import type { TimetableInput } from '../../../src/modules/journeys/engine/inputs.js';
import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import type { RouteQuery } from '../../../src/modules/journeys/ports.js';
import {
  handTimetable,
  query,
  sources,
  STOPS,
  stopPlace,
  summary,
  timetableReading,
  tuesday,
  type HandTrip,
} from './hand-network.js';

const NOW = { now: () => tuesday('06:00') };

async function plan(timetable: TimetableInput, request: RouteQuery) {
  return createEngineRouting({ sources: sources([timetableReading(timetable)]), clock: NOW }).plan(
    request,
  );
}

const CALLS: HandTrip['calls'] = [
  ['A', '08:00'],
  ['B', '08:10'],
  ['C', '08:20'],
];

describe('timetable rules the engine follows', () => {
  it('never alights where drop-off is refused, nor boards where pickup is', async () => {
    const noDropOff = handTimetable([{ id: 'T', route: 'R', calls: CALLS, noDropOff: [1] }]);
    const toB = query({ from: stopPlace('A'), to: stopPlace('B'), arriveBy: tuesday('08:30') });
    expect(await plan(noDropOff, toB)).toMatchObject({ ok: false, code: 'no-itineraries' });
    const toC = { ...toB, to: stopPlace('C') };
    const through = await plan(noDropOff, toC);
    expect(through.ok && summary(through.value[0]?.legs ?? [])).toEqual([
      'subway R A 08:00:00 > C 08:20:00',
    ]);
    const noPickup = handTimetable([{ id: 'T', route: 'R', calls: CALLS, noPickup: [0] }]);
    expect(await plan(noPickup, toC)).toMatchObject({ ok: false, code: 'no-itineraries' });
  });

  it('applies the minimum time of transfers.txt, and its type 3 forbids the change', async () => {
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
        id: 'R3a',
        route: 'R3',
        calls: [
          ['B2', '08:12'],
          ['D', '08:30'],
        ],
      },
      {
        id: 'R3b',
        route: 'R3',
        calls: [
          ['B2', '08:20'],
          ['D', '08:40'],
        ],
      },
    ];
    const request = query({
      from: stopPlace('A'),
      to: stopPlace('D'),
      arriveBy: tuesday('08:45'),
      count: 1,
    });
    // On foot B to B2 takes 108 s, so 08:12 would be caught; the rule asks for 5 minutes.
    const slow = handTimetable(trips, {
      transfers: [{ from: 'B', to: 'B2', type: 2, minSeconds: 300 }],
    });
    const result = await plan(slow, request);
    expect(result.ok && summary(result.value[0]?.legs ?? [])).toEqual([
      'subway R1 A 08:00:00 > B 08:10:00',
      'walk B 08:10:00 > B2 08:15:00',
      'subway R3 B2 08:20:00 > D 08:40:00',
    ]);
    const forbidden = handTimetable(trips, {
      transfers: [{ from: 'B', to: 'B2', type: 3, minSeconds: null }],
    });
    expect(await plan(forbidden, request)).toMatchObject({ ok: false, code: 'no-itineraries' });
  });

  it('changes platforms step-free only by a transfers.txt rule inside one complex', async () => {
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
        id: 'R3a',
        route: 'R3',
        calls: [
          ['B2', '08:12'],
          ['D', '08:30'],
        ],
      },
      {
        id: 'R3b',
        route: 'R3',
        calls: [
          ['B2', '08:20'],
          ['D', '08:40'],
        ],
      },
    ];
    // B and B2: two platforms of station S at the same point, as the L at 1 Av (L06N, L06S),
    // where changing sides means leaving the station and crossing 14 St.
    const platforms = (transfers: TimetableInput['transfers'] = []): TimetableInput => {
      const base = handTimetable(trips, { accessible: ['A', 'B', 'B2', 'D'], transfers });
      const station = { name: 'Station S', ...STOPS.B, parent: null, station: true };
      const platform = { ...station, parent: 'S', station: false };
      return {
        ...base,
        stops: {
          ...base.stops,
          S: station,
          B: { ...platform, name: 'B' },
          B2: { ...platform, name: 'B2' },
        },
      };
    };
    const request = query({
      from: stopPlace('A'),
      to: stopPlace('D'),
      arriveBy: tuesday('08:45'),
      stepFree: true,
      count: 1,
    });
    const onFoot = await plan(platforms(), { ...request, stepFree: false });
    expect(onFoot.ok && summary(onFoot.value[0]?.legs ?? [])[1]).toBe(
      'walk B 08:10:00 > B2 08:11:00',
    );
    expect(await plan(platforms(), request)).toMatchObject({ ok: false, code: 'no-itineraries' });
    const ruled = await plan(
      platforms([{ from: 'S', to: 'S', type: 2, minSeconds: 180 }]),
      request,
    );
    expect(ruled.ok && summary(ruled.value[0]?.legs ?? [])).toEqual([
      'subway R1 A 08:00:00 > B 08:10:00',
      'walk B 08:10:00 > B2 08:13:00',
      'subway R3 B2 08:20:00 > D 08:40:00',
    ]);
    expect(ruled.ok && ruled.provenance.evidence).toContain(
      '1 change not verified step-free: B > B2',
    );
  });

  it('follows no step-free transfer rule between two complexes', async () => {
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
          ['B2', '08:20'],
          ['D', '08:40'],
        ],
      },
    ];
    const rule = { from: 'B', to: 'B2', type: 2 as const, minSeconds: 180 };
    const accessible = ['A', 'B', 'B2', 'D'];
    const request = query({
      from: stopPlace('A'),
      to: stopPlace('D'),
      arriveBy: tuesday('08:45'),
      stepFree: true,
    });
    const apart = handTimetable(trips, {
      accessible,
      transfers: [rule],
      complexes: { B: '1', B2: '2' },
    });
    expect(await plan(apart, request)).toMatchObject({ ok: false, code: 'no-itineraries' });
    const together = handTimetable(trips, {
      accessible,
      transfers: [rule],
      complexes: { B: '1', B2: '1' },
    });
    expect((await plan(together, request)).ok).toBe(true);
  });

  it('boards at the platforms of a station named, accessible through the station', async () => {
    const base = handTimetable([{ id: 'T', route: 'R', calls: CALLS }], {
      accessible: ['S1', 'C'],
    });
    const station = { name: 'Station S1', ...STOPS.A, parent: null, station: true };
    const timetable: TimetableInput = {
      ...base,
      stops: {
        ...base.stops,
        S1: station,
        A: { ...station, name: 'Stop A', parent: 'S1', station: false },
      },
    };
    const from = { label: 'Station S1', ...STOPS.A, kind: 'station' as const, stopId: 'S1' };
    const result = await plan(
      timetable,
      query({ from, to: stopPlace('C'), arriveBy: tuesday('08:30'), stepFree: true }),
    );
    expect(result.ok && summary(result.value[0]?.legs ?? [])).toEqual([
      'subway R A 08:00:00 > C 08:20:00',
    ]);
  });
});
