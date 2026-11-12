import { describe, expect, it } from 'vitest';

import { GENERIC_USER_AGENT } from '../../src/infrastructure/http/client.js';
import { createDailyBudget } from '../../src/modules/data-platform/on-demand/daily-budget.js';
import {
  createTransitousStreets,
  KEPT_FOR_PLANS,
} from '../../src/modules/data-platform/on-demand/transitous-streets.js';
import { walkUrl } from '../../src/modules/data-platform/on-demand/transitous-walk.js';
import type { Clock } from '../../src/infrastructure/clock/clock.js';
import { capture, stubHttp, type StubAnswer } from './support.js';

/** The walks of the captures (`tests/fixtures/on-demand/README.md`). */
const TIMES_SQ = { lat: 40.7553, lon: -73.9876 };
const BRYANT_PK = { lat: 40.7542, lon: -73.9846 };
const AT_TIMES_SQ = { from: TIMES_SQ, to: BRYANT_PK };

const json = { 'content-type': 'application/json', server: 'MOTIS v2.11.4' };
const answer = (name: string): StubAnswer => ({ body: capture(name), headers: json });

function movingClock(start: string): Clock & { advance: (ms: number) => void } {
  let now = Date.parse(start);
  return {
    now: () => new Date(now),
    advance: (ms) => {
      now += ms;
    },
  };
}

function streets(reply: StubAnswer | 'network-down', budget = createDailyBudget(300)) {
  const { http, sent } = stubHttp(reply);
  const clock = movingClock('2026-11-11T07:56:48Z');
  return { walks: createTransitousStreets({ http, clock, budget }), sent, clock };
}

describe('walks on the streets of Transitous', () => {
  it('asks the plan endpoint for a walk only, with the foot or wheelchair profile', () => {
    expect(walkUrl(AT_TIMES_SQ, 'foot')).toBe(
      'https://api.transitous.org/api/v6/plan?fromPlace=40.7553%2C-73.9876&toPlace=40.7542%2C-73.9846' +
        '&transitModes=&directModes=WALK&pedestrianProfile=FOOT&maxDirectTime=3600',
    );
    expect(walkUrl(AT_TIMES_SQ, 'wheelchair')).toContain('pedestrianProfile=WHEELCHAIR');
  });

  it('reads the walk of the capture: its seconds, metres and the path of its geometry', async () => {
    const { walks, sent } = streets(answer('transitous-walk-foot.json'));
    const { answers, requests } = await walks.walk([AT_TIMES_SQ], 'foot', 8);
    expect(requests).toBe(1);
    expect(sent[0]?.headers.get('user-agent')).toBe(GENERIC_USER_AGENT);
    const [walk] = answers;
    if (walk?.kind !== 'walked') throw new Error(`walk: ${String(walk?.kind)}`);
    expect([walk.seconds, walk.metres, walk.path.length]).toEqual([255, 300, 42]);
    // The path starts where MOTIS matched the corner to the sidewalk, 2 m away.
    expect(walk.path[0]).toEqual([-73.987619, 40.755309]);
  });

  it('walks slower with the wheelchair profile on the same corners', async () => {
    const { walks, sent } = streets(answer('transitous-walk-wheelchair.json'));
    const { answers } = await walks.walk([AT_TIMES_SQ], 'wheelchair', 8);
    expect(answers[0]).toMatchObject({ kind: 'walked', seconds: 381, metres: 300 });
    expect(sent[0]?.url).toContain('pedestrianProfile=WHEELCHAIR');
  });

  it('says there is no way when the streets give none (Roosevelt Island to Manhattan)', async () => {
    const { walks } = streets(answer('transitous-walk-none.json'));
    const ask = { from: { lat: 40.758, lon: -73.9535 }, to: { lat: 40.758, lon: -73.959 } };
    expect((await walks.walk([ask], 'foot', 8)).answers).toEqual([{ kind: 'no-street-route' }]);
  });

  it('keeps each answer 12 hours by rounded corners and profile, asking once', async () => {
    const { walks, sent, clock } = streets(answer('transitous-walk-foot.json'));
    await walks.walk([AT_TIMES_SQ], 'foot', 8);
    const nearby = { from: { lat: 40.75531, lon: -73.98761 }, to: BRYANT_PK };
    const again = await walks.walk([nearby, AT_TIMES_SQ], 'foot', 8);
    expect(again.requests).toBe(0);
    expect(again.answers.map((walk) => walk.kind)).toEqual(['walked', 'walked']);
    await walks.walk([AT_TIMES_SQ], 'wheelchair', 8);
    expect(sent).toHaveLength(2);
    clock.advance(12 * 60 * 60 * 1000 + 1);
    await walks.walk([AT_TIMES_SQ], 'foot', 8);
    expect(sent).toHaveLength(3);
  });

  it('sends at most the requests the plan allows; the rest are not asked', async () => {
    const { walks, sent } = streets(answer('transitous-walk-foot.json'));
    const other = { from: BRYANT_PK, to: TIMES_SQ };
    const { answers, requests } = await walks.walk([AT_TIMES_SQ, other], 'foot', 1);
    expect([requests, sent.length]).toEqual([1, 1]);
    expect(answers[1]).toEqual({ kind: 'not-asked' });
  });

  it('leaves the requests of the day the plans need: none below the reserve', async () => {
    const budget = createDailyBudget(KEPT_FOR_PLANS + 1);
    const { walks, sent } = streets(answer('transitous-walk-foot.json'), budget);
    const first = await walks.walk([AT_TIMES_SQ], 'foot', 8);
    const second = await walks.walk([{ from: BRYANT_PK, to: TIMES_SQ }], 'foot', 8);
    expect([first.requests, second.requests, sent.length]).toEqual([1, 0, 1]);
    expect(budget.left(new Date('2026-11-11T08:00:00Z'))).toBe(KEPT_FOR_PLANS);
  });

  it('with Transitous down, the walk is unavailable and Transitous is left alone 2 minutes', async () => {
    const { walks, sent, clock } = streets('network-down');
    expect((await walks.walk([AT_TIMES_SQ], 'foot', 8)).answers).toEqual([
      { kind: 'streets-unavailable' },
    ]);
    const paused = await walks.walk([AT_TIMES_SQ], 'foot', 8);
    expect([paused.answers[0]?.kind, sent.length]).toEqual(['not-asked', 1]);
    clock.advance(2 * 60 * 1000);
    await walks.walk([AT_TIMES_SQ], 'foot', 8);
    expect(sent).toHaveLength(2);
  });

  it('treats an answer in another shape as no answer', async () => {
    const { walks } = streets({ body: '{"direct":"no"}', headers: json });
    expect((await walks.walk([AT_TIMES_SQ], 'foot', 8)).answers[0]?.kind).toBe(
      'streets-unavailable',
    );
  });
});
