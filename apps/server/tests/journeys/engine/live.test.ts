import { describe, expect, it } from 'vitest';

import type { LiveTrip } from '../../../src/modules/journeys/engine/inputs.js';
import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import {
  handTimetable,
  place,
  predictionReading,
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

const TO_C = query({ from: stopPlace('A'), to: stopPlace('C'), arriveBy: tuesday('08:40') });

function at(clock: string): string {
  return tuesday(clock).toISOString();
}

function liveTrip(
  tripId: string,
  calls: readonly (readonly [string, string])[],
  cancelled = false,
): LiveTrip {
  return {
    tripId,
    startDate: '20261110',
    cancelled,
    stops: calls.map(([stopId, clock]) => ({
      stopId,
      sequence: null,
      arrival: at(clock),
      departure: at(clock),
    })),
  };
}

async function planWith(trips: readonly LiveTrip[], state: 'healthy' | 'stale' = 'healthy') {
  const engine = createEngineRouting({
    sources: sources(
      [timetableReading(handTimetable(LINE_1))],
      [predictionReading({ timetables: ['hand-gtfs'], rule: 'exact', trips }, state)],
    ),
    clock: NOW,
  });
  const outcome = await engine.plan({ ...TO_C, count: 1 });
  if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail}`);
  return outcome;
}

describe('live predictions replace the timetable, never invent a time', () => {
  it('leaves a cancelled trip out', async () => {
    const outcome = await planWith([liveTrip('L1b', [], true)]);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual(['subway L1 A 08:00:00 > C 08:20:00']);
    expect(outcome.provenance.evidence).toContain('0 trips predicted, 1 cancelled');
  });

  it('uses a delay that still arrives in time, marked live', async () => {
    const outcome = await planWith([
      liveTrip('L1b', [
        ['A', '08:18'],
        ['B', '08:28'],
        ['C', '08:38'],
      ]),
    ]);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual([
      'subway L1 A 08:18:00 > C 08:38:00 live',
    ]);
    expect(outcome.value[0]?.legs[0]?.scheduled).toBe(false);
  });

  it('drops a trip whose delay makes it arrive too late', async () => {
    const outcome = await planWith([
      liveTrip('L1b', [
        ['A', '08:20'],
        ['B', '08:32'],
        ['C', '08:45'],
      ]),
    ]);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual(['subway L1 A 08:00:00 > C 08:20:00']);
  });

  it('follows a trip running early', async () => {
    const outcome = await planWith([
      liveTrip('L1b', [
        ['A', '08:20'],
        ['B', '08:32'],
        ['C', '08:45'],
      ]),
      liveTrip('L1a', [
        ['A', '07:58'],
        ['B', '08:08'],
        ['C', '08:18'],
      ]),
    ]);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual([
      'subway L1 A 07:58:00 > C 08:18:00 live',
    ]);
  });

  it('never boards at a stop the vehicle has passed or the prediction leaves out', async () => {
    const passed = await planWith([liveTrip('L1b', [['C', '08:35']])]);
    expect(summary(passed.value[0]?.legs ?? [])).toEqual(['subway L1 A 08:00:00 > C 08:20:00']);
  });

  it('ignores predicted times far from the service days searched', async () => {
    const farOff = liveTrip('L1b', [
      ['A', '08:18'],
      ['C', '08:38'],
    ]);
    const stops = farOff.stops.map((stop) => ({
      ...stop,
      arrival: '1990-01-01T13:00:00.000Z',
      departure: null,
    }));
    const outcome = await planWith([{ ...farOff, stops }]);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual(['subway L1 A 08:15:00 > C 08:35:00']);
  });

  it('keeps to the timetable while the live source is stale, and says so', async () => {
    const outcome = await planWith([liveTrip('L1b', [], true)], 'stale');
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual(['subway L1 A 08:15:00 > C 08:35:00']);
    expect(outcome.provenance.evidence).toContain('live not used: hand-live (stale)');
  });
});

describe('step-free, availability and determinism', () => {
  it('uses only stops the timetable marks accessible when step-free', async () => {
    const timetable = handTimetable(LINE_1, { accessible: ['A', 'C'] });
    const engine = createEngineRouting({
      sources: sources([timetableReading(timetable)]),
      clock: NOW,
    });
    const ok = await engine.plan({ ...TO_C, stepFree: true, count: 1 });
    expect(ok.ok && summary(ok.value[0]?.legs ?? [])).toEqual([
      'subway L1 A 08:15:00 > C 08:35:00',
    ]);
    const toB = await engine.plan({ ...TO_C, to: stopPlace('B'), stepFree: true });
    expect(toB).toMatchObject({ ok: false, code: 'no-itineraries' });
  });

  it('refuses step-free plans when no stop says whether it is accessible', async () => {
    const engine = createEngineRouting({
      sources: sources([timetableReading(handTimetable(LINE_1))]),
      clock: NOW,
    });
    expect(await engine.plan({ ...TO_C, stepFree: true })).toEqual({
      ok: false,
      state: 'unavailable',
      code: 'no-step-free-data',
      detail:
        'The timetables served do not say which stops are step-free, so no step-free route can be planned.',
    });
  });

  it('says plainly when no itinerary reaches the destination in time', async () => {
    const engine = createEngineRouting({
      sources: sources([timetableReading(handTimetable(LINE_1))]),
      clock: NOW,
    });
    const unreachable = await engine.plan(
      query({
        from: stopPlace('A'),
        to: place('Z'),
        arriveBy: tuesday('09:00'),
        maxWalkMinutes: 10,
      }),
    );
    expect(unreachable).toMatchObject({ ok: false, state: 'unavailable', code: 'no-itineraries' });
    const tooEarly = await engine.plan(
      query({ from: stopPlace('A'), to: stopPlace('C'), arriveBy: tuesday('08:19') }),
    );
    expect(tooEarly).toMatchObject({ ok: false, code: 'no-itineraries' });
    if (!tooEarly.ok) expect(tooEarly.detail).toMatch(/^No itinerary on the timetables served/);
  });

  it('is unavailable without a timetable, and degraded without one of several', async () => {
    const none = createEngineRouting({
      sources: sources([timetableReading(undefined, 'mta-gtfs-subway')]),
      clock: NOW,
    });
    expect(await none.plan(TO_C)).toEqual({
      ok: false,
      state: 'unavailable',
      code: 'no-timetable',
      detail: 'No timetable is available to plan with; without mta-gtfs-subway (unavailable).',
    });
    const partial = createEngineRouting({
      sources: sources([
        timetableReading(handTimetable(LINE_1)),
        timetableReading(undefined, 'other-gtfs'),
      ]),
      clock: NOW,
    });
    const outcome = await partial.plan(TO_C);
    expect(outcome.ok && outcome.provenance).toMatchObject({
      sourceId: 'moviq-raptor',
      state: 'degraded',
    });
    expect(outcome.ok && outcome.provenance.evidence).toContain(
      'hand-gtfs@v1 (healthy); without other-gtfs',
    );
  });

  it('gives the same answer for the same query and the same timetables', async () => {
    const shuffled = handTimetable([...LINE_1].reverse());
    const reordered = {
      ...shuffled,
      stops: Object.fromEntries(Object.entries(shuffled.stops).reverse()),
      trips: Object.fromEntries(Object.entries(shuffled.trips).reverse()),
    };
    const first = createEngineRouting({
      sources: sources([timetableReading(handTimetable(LINE_1))]),
      clock: NOW,
    });
    const second = createEngineRouting({
      sources: sources([timetableReading(reordered)]),
      clock: NOW,
    });
    const answers = [await first.plan(TO_C), await first.plan(TO_C), await second.plan(TO_C)];
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });
});
