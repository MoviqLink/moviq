import { describe, expect, it } from 'vitest';

import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import {
  handTimetable,
  query,
  sources,
  stopPlace,
  summary,
  timetableReading,
  tuesday,
  type HandTrip,
} from './hand-network.js';

const NOW = { now: () => tuesday('06:00') };

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
];

const BUS_LINE: readonly HandTrip[] = [
  {
    id: 'B1a',
    route: 'B1',
    calls: [
      ['A', '08:05'],
      ['C', '08:30'],
    ],
  },
];

const TO_C = query({ from: stopPlace('A'), to: stopPlace('C'), arriveBy: tuesday('08:40') });

describe('step-free plans on the hand-written network', () => {
  it('refuses a step-free plan on modes whose timetables say nothing, as buses', async () => {
    const engine = createEngineRouting({
      sources: sources([
        timetableReading(handTimetable(LINE_1, { accessible: ['A', 'C'] })),
        timetableReading(handTimetable(BUS_LINE, { routeType: 3 }), 'hand-bus'),
      ]),
      clock: NOW,
    });
    const bus = await engine.plan({ ...TO_C, modes: ['bus', 'walk'], stepFree: true });
    expect(bus).toMatchObject({ ok: false, state: 'unavailable', code: 'no-step-free-data' });
    if (!bus.ok) expect(bus.detail).toContain('bus');
    const both = await engine.plan({ ...TO_C, modes: ['subway', 'bus'], stepFree: true, count: 1 });
    expect(both.ok && summary(both.value[0]?.legs ?? [])).toEqual([
      'subway L1 A 08:15:00 > C 08:35:00',
    ]);
    expect(both.ok && both.provenance.evidence).toContain('step-free: bus left out');
  });

  it('walks step-free through an elevator entrance where the survey lists one', async () => {
    // 250 m south of A; its elevator is 200 m north of it. C lists no entrance.
    const from = {
      label: 'South of A',
      lat: 40.69775,
      lon: -74.0,
      kind: 'address' as const,
      stopId: null,
    };
    const to = {
      label: 'North of C',
      lat: 40.7189,
      lon: -74.0,
      kind: 'address' as const,
      stopId: null,
    };
    const elevator = (entry: boolean) => ({ A: [{ lat: 40.7018, lon: -74.0, entry, exit: true }] });
    const engine = (entry: boolean) =>
      createEngineRouting({
        sources: sources([
          timetableReading(
            handTimetable(LINE_1, { accessible: ['A', 'C'], entrances: elevator(entry) }),
          ),
        ]),
        clock: NOW,
      });
    const trip = { ...TO_C, from, to, stepFree: true, count: 1 };
    const seconds = (leg: { readonly departAt: Date; readonly arriveAt: Date } | undefined) =>
      leg === undefined ? undefined : (leg.arriveAt.getTime() - leg.departAt.getTime()) / 1000;
    const near = await engine(true).plan({ ...trip, stepFree: false, maxWalkMinutes: 6 });
    expect(near.ok && seconds(near.value[0]?.legs[0])).toBe(272);
    expect(await engine(true).plan({ ...trip, maxWalkMinutes: 6 })).toMatchObject({
      ok: false,
      code: 'no-itineraries',
    });
    const far = await engine(true).plan({ ...trip, maxWalkMinutes: 10 });
    expect(far.ok && seconds(far.value[0]?.legs[0])).toBe(488);
    expect(far.ok && far.provenance.evidence).toContain(
      "walks at C measured to the station's point: the entrance survey lists no step-free entrance there",
    );
    const exitOnly = await engine(false).plan({ ...trip, maxWalkMinutes: 10 });
    expect(exitOnly).toMatchObject({ ok: false, code: 'no-itineraries' });
  });
});
