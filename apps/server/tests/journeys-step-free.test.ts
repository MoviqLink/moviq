import type { Journey } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { itineraryAccessibility } from '../src/modules/journeys/accessibility.js';
import {
  readStepFreeLists,
  type StepFreeReading,
} from '../src/modules/journeys/step-free-lists.js';
import type { Assessment } from '../src/modules/journeys/watch-assess.js';
import {
  checkElevators,
  stepFreeRefusal,
  withElevators,
} from '../src/modules/journeys/watch-elevators.js';
import {
  D17_OUTAGE,
  heraldSquareJourney,
  heraldSquareLegs,
  stepFreeLists,
  stepFreeReader,
} from './support/step-free.js';

/** 16:20 in New York, ten minutes before the walk to Times Sq-42 St starts. */
const NOW = new Date('2026-11-11T21:20:00.000Z');
const WINDOW = { from: NOW, to: new Date('2026-11-11T22:00:00.000Z') };
const nothing = {
  read: () => Promise.reject(new Error('only the step-free lists are read')),
};

function reading(
  outages = [D17_OUTAGE],
  states: Parameters<typeof stepFreeReader>[2] = {},
): Promise<StepFreeReading> {
  return readStepFreeLists(stepFreeReader(stepFreeLists(outages), nothing, states));
}

const ON_TRACK: Assessment = {
  status: 'on-track',
  evidence: 'On track: arriving about 16:52, 8 min to spare.',
  projectedArriveAt: null,
  incidents: [],
  needsAlternatives: false,
};

describe('the step-free check of an itinerary', () => {
  it('gives each platform its state and names what the MTA does not publish', async () => {
    const access = itineraryAccessibility(
      { legs: heraldSquareLegs() },
      ['walk', 'subway', 'bus'],
      await reading([]),
      WINDOW,
    );
    expect(access.checkedAt).toBe('2026-11-11T21:20:00.000Z');
    expect(access.provenance.sourceId).toBe('mta-elevators');
    expect(access.platforms.map((p) => [p.legIndex, p.at, p.station, p.state])).toEqual([
      [1, 'board', 'Times Sq-42 St', 'accessible'],
      [1, 'alight', '5 Av', 'accessible'],
      [3, 'board', '42 St-Bryant Pk', 'accessible'],
      [3, 'alight', '34 St-Herald Sq', 'accessible'],
    ]);
    expect(access.warnings).toEqual([
      { kind: 'modes-left-out', modes: ['bus'] },
      { kind: 'change-unverified', legIndex: 2, from: '5 Av', to: '42 St-Bryant Pk' },
      { kind: 'entrance-not-surveyed', legIndex: 0, station: 'Times Sq-42 St' },
      // Estimated walks to the first ride and from the last: not walked with a wheelchair.
      { kind: 'walk-unverified', legIndex: 0 },
      { kind: 'walk-unverified', legIndex: 4 },
    ]);
  });

  it('marks the platform of an elevator out with the MTA code, what it serves and its times', async () => {
    const access = itineraryAccessibility(
      { legs: heraldSquareLegs() },
      ['walk', 'subway'],
      await reading(),
      WINDOW,
    );
    expect(access.platforms[3]).toMatchObject({
      station: '34 St-Herald Sq',
      state: 'elevator-out',
      cause: 'outage',
      elevators: [
        {
          id: 'EL293',
          serving: 'Street to mezzanine',
          since: '2026-11-11T21:01:00.000Z',
          estimatedReturn: '2026-11-12T03:00:00.000Z',
          upcoming: false,
        },
      ],
    });
  });

  it('counts an announced outage inside the window, not one that starts after it', async () => {
    const later = { ...D17_OUTAGE, upcoming: true, since: '2026-11-11T22:30:00.000Z' };
    const after = itineraryAccessibility(
      { legs: heraldSquareLegs() },
      ['subway'],
      await reading([later]),
      WINDOW,
    );
    expect(after.platforms[3]?.state).toBe('accessible');
    const soon = { ...later, since: '2026-11-11T21:40:00.000Z' };
    const inside = itineraryAccessibility(
      { legs: heraldSquareLegs() },
      ['subway'],
      await reading([soon]),
      WINDOW,
    );
    expect(inside.platforms[3]).toMatchObject({
      state: 'elevator-out',
      elevators: [{ upcoming: true }],
    });
  });

  it('says one direction only for a station accessible one way, and none the other way', async () => {
    const legs = heraldSquareLegs().map((leg, index) =>
      index === 1
        ? {
            ...leg,
            from: { ...leg.from, stopId: '626N', label: '86 St' },
            to: { ...leg.to, stopId: '626S' },
          }
        : leg,
    );
    const access = itineraryAccessibility({ legs }, ['subway'], await reading([]), WINDOW);
    expect(access.platforms.slice(0, 2).map((p) => [p.station, p.state, p.cause])).toEqual([
      ['86 St', 'one-direction', null],
      ['86 St', 'not-step-free', 'not-step-free'],
    ]);
  });

  it('confirms nothing when a list cannot be used or an elevator out cannot be placed', async () => {
    const down = itineraryAccessibility(
      { legs: heraldSquareLegs() },
      ['subway'],
      await reading([], { 'mta-elevators': 'stale' }),
      WINDOW,
    );
    expect(down.checkedAt).toBeNull();
    expect(down.provenance.state).toBe('stale');
    expect(new Set(down.platforms.map((p) => `${p.state}/${p.cause ?? ''}`))).toEqual(
      new Set(['unknown/lists-unavailable']),
    );
    const stray = { ...D17_OUTAGE, equipmentId: 'EL999' };
    const unplaced = itineraryAccessibility(
      { legs: heraldSquareLegs() },
      ['subway'],
      await reading([stray]),
      WINDOW,
    );
    expect(new Set(unplaced.platforms.map((p) => p.cause))).toEqual(new Set(['outage-unplaced']));
  });
});

describe('the watch over the elevators', () => {
  it('turns an outage closing D17 on a step-free trip into an elevator incident', async () => {
    const journey = heraldSquareJourney(true);
    const check = checkElevators(journey, await reading(), NOW);
    expect(check.incidents).toHaveLength(1);
    expect(check.incidents).toMatchObject([
      {
        id: 'elevator:3:EL293',
        kind: 'elevator',
        legIndex: 3,
        evidence:
          'The MTA says elevator EL293 at 34 St-Herald Sq (Street to mezzanine) is out of service ' +
          'since 16:01, back about 22:00. Your step-free route needs it.',
        provenance: { sourceId: 'mta-elevators' },
      },
    ]);
    expect(withElevators(ON_TRACK, check)).toMatchObject({
      status: 'at-risk',
      evidence:
        'The step-free route needs elevator EL293 at 34 St-Herald Sq, which is out of service; ' +
        'looking for another way.',
      needsAlternatives: true,
    });
  });

  it('only warns a trip that is not step-free, and keeps its verdict', async () => {
    const check = checkElevators(heraldSquareJourney(false), await reading(), NOW);
    expect(check.incidents.map((incident) => incident.evidence)).toEqual([
      expect.stringMatching(/It matters only if you need step-free access\.$/),
    ]);
    expect(withElevators(ON_TRACK, check)).toMatchObject({
      status: 'on-track',
      needsAlternatives: false,
    });
  });

  it('ignores platforms already left behind', async () => {
    const check = checkElevators(
      heraldSquareJourney(true),
      await reading(),
      new Date('2026-11-11T21:48:00.000Z'),
    );
    expect(check).toEqual({ incidents: [], verdict: undefined });
  });

  it('says source-down on a step-free trip when the outages feed is down, never silence', async () => {
    const down = await reading([], { 'mta-elevators': 'unavailable' });
    const check = checkElevators(heraldSquareJourney(true), down, NOW);
    expect(check.incidents).toHaveLength(1);
    expect(check.incidents).toMatchObject([
      {
        id: 'source-down:step-free:mta-elevators',
        kind: 'source-down',
        legIndex: 1,
        provenance: { state: 'unavailable' },
      },
    ]);
    expect(withElevators(ON_TRACK, check)).toMatchObject({
      status: 'unknown',
      evidence:
        'The MTA elevator outages cannot be read now, so the step-free route is not confirmed.',
      needsAlternatives: false,
    });
    expect(checkElevators(heraldSquareJourney(false), down, NOW).incidents).toEqual([]);
  });

  it('reads the reason of a step-free refusal from the same lists', async () => {
    const journey = heraldSquareJourney(true);
    const refused = { code: 'no-step-free-data', detail: 'No step-free route can be planned.' };
    expect(
      stepFreeRefusal(refused, await reading([], { 'mta-subway-stations': 'stale' }), journey, NOW),
    ).toEqual({
      reason: 'lists-unavailable',
      detail: 'No step-free route can be planned.',
    });
    const stray = { ...D17_OUTAGE, equipmentId: 'EL999' };
    expect(stepFreeRefusal(refused, await reading([stray]), journey, NOW)?.reason).toBe(
      'outage-unplaced',
    );
    expect(stepFreeRefusal(refused, await reading([]), journey, NOW)?.reason).toBe(
      'modes-without-data',
    );
    expect(
      stepFreeRefusal({ ...refused, code: 'http-503' }, await reading([]), journey, NOW),
    ).toBeNull();
    const notStepFree: Journey = heraldSquareJourney(false);
    expect(stepFreeRefusal(refused, await reading([]), notStepFree, NOW)).toBeNull();
  });
});
