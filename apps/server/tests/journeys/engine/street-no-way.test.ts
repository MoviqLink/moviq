import { describe, expect, it } from 'vitest';

import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import { sources, stopPlace, summary, timetableReading, type HandTrip } from './hand-network.js';
import {
  asServed,
  changeAtB,
  engineWith,
  lineAToC,
  NORTH_OF_C,
  NOW,
  planned,
  SOUTH_OF_A,
  toC,
  walkOf,
} from './street-support.js';

/**
 * `transitous-walk-none.json` is Transitous' answer from Roosevelt Island to Manhattan across the
 * East River on foot: no way on the streets. Every walk asked here gets it.
 */
const NONE = 'transitous-walk-none.json';

/** R1 from A to B at 07:30, and R3 from B itself to C: a ride that needs no walk. */
const EARLIER_AT_B: readonly HandTrip[] = [
  {
    id: 'R1-early',
    route: 'R1',
    calls: [
      ['A', '07:30'],
      ['B', '07:40'],
    ],
  },
  {
    id: 'R3',
    route: 'R3',
    calls: [
      ['B', '07:45'],
      ['C', '07:57'],
    ],
  },
];

const walkOnly = { maxWalkMinutes: 10, modes: ['subway' as const] };

describe('walks the streets have no way for', () => {
  it('leaves out a change with no way on the streets and searches for a ride that needs none', async () => {
    const { engine, sent } = engineWith(changeAtB(['08:13'], [], EARLIER_AT_B), NONE);
    const outcome = await planned(engine, { ...toC, count: 1 });
    expect(outcome.value).toHaveLength(1);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual([
      'subway R1 A 07:30:00 > B 07:40:00',
      'subway R3 B 07:45:00 > C 07:57:00',
    ]);
    // The change from B to B2 is not asked again: the second search no longer walks it.
    expect(sent).toHaveLength(1);
    expect(outcome.provenance.evidence).toContain(
      '1 itineraries left out once walked (the streets of transitous have no way on foot ' +
        'for 1 change)',
    );
  });

  it('never offers a change the streets have no way for, not even as provisional', async () => {
    const { engine, sent } = engineWith(changeAtB(['08:13']), NONE);
    const outcome = await engine.plan(toC);
    expect(outcome).toMatchObject({ ok: false, code: 'no-street-way' });
    if (outcome.ok) throw new Error('an itinerary with no way on the streets');
    expect(outcome.detail).toContain('the streets of transitous have no way on foot for 1 change');
    expect(sent).toHaveLength(1);
  });

  it('says so when the start has no way on foot to any stop', async () => {
    const { engine, sent } = engineWith(lineAToC(), NONE);
    const outcome = await engine.plan({ ...toC, ...walkOnly, from: SOUTH_OF_A });
    expect(outcome).toMatchObject({ ok: false, code: 'no-street-way' });
    if (outcome.ok) throw new Error('an itinerary with no way on the streets');
    expect(outcome.detail).toContain('no way on foot from the start to 1 stop');
    expect(sent).toHaveLength(1);
  });

  it('says so when no stop has a way on foot to the destination', async () => {
    const { engine } = engineWith(lineAToC(), NONE);
    const outcome = await engine.plan({ ...toC, ...walkOnly, to: NORTH_OF_C });
    expect(outcome).toMatchObject({ ok: false, code: 'no-street-way' });
    if (outcome.ok) throw new Error('an itinerary with no way on the streets');
    expect(outcome.detail).toContain('no way on foot from 1 stop to the destination');
  });

  it('offers no trip on foot only that the streets have no way for', async () => {
    const { engine } = engineWith(lineAToC(), NONE);
    const request = { ...toC, from: SOUTH_OF_A, to: stopPlace('A'), maxWalkMinutes: 10 };
    const outcome = await engine.plan({ ...request, modes: ['walk'] });
    expect(outcome).toMatchObject({ ok: false, code: 'no-street-way' });
    if (outcome.ok) throw new Error('a walk with no way on the streets');
    expect(outcome.detail).toContain('no way on foot door to door');
  });

  it('keeps a walk not asked provisional: no answer is not an answer of no way', async () => {
    const engine = createEngineRouting({
      sources: sources([timetableReading(changeAtB(['08:13']))]),
      clock: NOW,
      streets: {
        sourceId: 'spent',
        walk: (asks) =>
          Promise.resolve({
            answers: asks.map(() => ({ kind: 'not-asked' as const })),
            requests: 0,
          }),
      },
    });
    const outcome = await planned(engine, toC);
    expect(walkOf(outcome.value[0])?.walk?.unchecked).toBe('not-asked');
    expect(asServed(outcome.value[0]).walking).toBe('provisional');
  });
});
