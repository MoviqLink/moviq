import { describe, expect, it } from 'vitest';

import { walksNotStepFreeChecked } from '../../../src/modules/journeys/accessibility.js';
import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import { handTimetable, sources, summary, timetableReading } from './hand-network.js';
import {
  asServed,
  changeAtB,
  engineWith,
  NOW,
  planned,
  SOUTH_OF_A,
  toC,
  walkOf,
} from './street-support.js';

describe('walks of the final itineraries on the streets', () => {
  it('leaves out an itinerary whose change the streets make too long (Newtown Creek)', async () => {
    // Estimated, the change from B to B2 takes 108 s; on the streets of the capture, 1,510 s.
    const { engine, sent } = engineWith(changeAtB(['08:13']), 'transitous-walk-creek.json');
    const outcome = await engine.plan(toC);
    expect(outcome).toMatchObject({ ok: false, code: 'no-itineraries' });
    expect(sent).toHaveLength(1);
  });

  it('plans again with the street time and keeps the ride the walk still makes', async () => {
    const { engine, sent } = engineWith(
      changeAtB(['08:13', '08:40']),
      'transitous-walk-creek.json',
    );
    const outcome = await planned(engine, toC);
    expect(outcome.value).toHaveLength(1);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual([
      'subway R1 A 08:00:00 > B 08:10:00',
      'walk B 08:10:00 > B2 08:35:10',
      'subway R2 B2 08:40:00 > C 08:52:00',
    ]);
    const walk = walkOf(outcome.value[0]);
    expect(walk?.walk).toEqual({ basis: 'street', profile: 'foot', metres: 1788, unchecked: null });
    expect(walk?.path).toHaveLength(163);
    expect(sent).toHaveLength(1);
    expect(outcome.provenance.evidence).toContain(
      'walks: 1 on the streets of transitous (1 requests), 0 by station rules, 0 estimated; ' +
        '1 itineraries left out once walked',
    );
  });

  it('moves the departure by the street time of the walk to the first ride', async () => {
    const line = handTimetable([
      {
        id: 'R1',
        route: 'R1',
        calls: [
          ['A', '08:00'],
          ['C', '08:20'],
        ],
      },
    ]);
    const { engine } = engineWith(line, 'transitous-walk-foot.json');
    const request = { ...toC, from: SOUTH_OF_A, maxWalkMinutes: 10, modes: ['subway' as const] };
    const outcome = await planned(engine, request);
    // Estimated 217 s before 08:00; the streets of the capture take 255 s.
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual([
      'walk origin 07:55:45 > A 08:00:00',
      'subway R1 A 08:00:00 > C 08:20:00',
    ]);
    expect(walkOf(outcome.value[0])?.walk?.basis).toBe('street');
  });

  it('walks a step-free trip with the wheelchair profile', async () => {
    const line = handTimetable(
      [
        {
          id: 'R1',
          route: 'R1',
          calls: [
            ['A', '08:00'],
            ['C', '08:20'],
          ],
        },
      ],
      {
        accessible: ['A', 'C'],
      },
    );
    const { engine, sent } = engineWith(line, 'transitous-walk-wheelchair.json');
    const request = {
      ...toC,
      from: SOUTH_OF_A,
      maxWalkMinutes: 10,
      modes: ['subway' as const],
      stepFree: true,
    };
    const outcome = await planned(engine, request);
    expect(sent[0]?.url).toContain('pedestrianProfile=WHEELCHAIR');
    expect(walkOf(outcome.value[0])?.walk).toMatchObject({
      basis: 'street',
      profile: 'wheelchair',
    });
    expect(summary(outcome.value[0]?.legs ?? [])[0]).toBe('walk origin 07:53:39 > A 08:00:00');
    expect(walksNotStepFreeChecked(asServed(outcome.value[0]))).toEqual([]);
  });

  it('with Transitous down keeps the plan, the walk estimated and labelled, and not step-free', async () => {
    const line = handTimetable(
      [
        {
          id: 'R1',
          route: 'R1',
          calls: [
            ['A', '08:00'],
            ['C', '08:20'],
          ],
        },
      ],
      {
        accessible: ['A', 'C'],
      },
    );
    const { engine } = engineWith(line, null);
    const request = {
      ...toC,
      from: SOUTH_OF_A,
      maxWalkMinutes: 10,
      modes: ['subway' as const],
      stepFree: true,
    };
    const outcome = await planned(engine, request);
    const walk = walkOf(outcome.value[0]);
    expect(walk?.walk).toEqual({
      basis: 'estimated',
      profile: 'wheelchair',
      metres: null,
      unchecked: 'streets-unavailable',
    });
    expect(walk?.path).toEqual([]);
    expect(summary(outcome.value[0]?.legs ?? [])[0]).toBe('walk origin 07:56:23 > A 08:00:00');
    const served = asServed(outcome.value[0]);
    expect(served.walking).toBe('provisional');
    expect(walksNotStepFreeChecked(served)).toEqual([0]);
    expect(outcome.provenance.evidence).toContain('1 estimated (streets-unavailable)');
  });

  it('asks nothing for a change a transfers.txt rule times: the station sets it', async () => {
    const rule = [{ from: 'B', to: 'B2', type: 2, minSeconds: 180 }] as const;
    const { engine, sent } = engineWith(changeAtB(['08:13'], rule), 'transitous-walk-creek.json');
    const outcome = await planned(engine, toC);
    expect(walkOf(outcome.value[0])?.walk).toEqual({
      basis: 'station-rule',
      profile: 'foot',
      metres: null,
      unchecked: null,
    });
    expect(sent).toHaveLength(0);
  });

  it('without a street network every walk stays estimated and says so', async () => {
    const engine = createEngineRouting({
      sources: sources([timetableReading(changeAtB(['08:13']))]),
      clock: NOW,
    });
    const outcome = await planned(engine, toC);
    expect(walkOf(outcome.value[0])?.walk?.unchecked).toBe('streets-unavailable');
    expect(asServed(outcome.value[0]).walking).toBe('provisional');
  });
});
