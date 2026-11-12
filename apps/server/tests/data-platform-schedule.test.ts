import { describe, expect, it } from 'vitest';

import { NO_FACTS, type HealthFacts } from '../src/modules/data-platform/health.js';
import {
  BREAKER_THRESHOLD,
  planNextRun,
  type ScheduleContext,
} from '../src/modules/data-platform/schedule.js';
import { testSource } from './support/sources.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const LAST = new Date('2026-11-11T11:59:00.000Z');
const hot = testSource({
  rhythm: { class: 'hot', baseIntervalMs: 60_000, interestIntervalMs: 15_000 },
});
const context = (overrides: Partial<ScheduleContext> = {}): ScheduleContext => ({
  now: NOW,
  interested: false,
  missingVariables: [],
  random: () => 0.5,
  ...overrides,
});
const facts = (overrides: Partial<HealthFacts>): HealthFacts => ({
  ...NO_FACTS,
  lastAttemptAt: LAST,
  ...overrides,
});
const offset = (at: Date | undefined) =>
  at === undefined ? undefined : at.getTime() - LAST.getTime();

describe('planNextRun', () => {
  it('runs a source never checked at once', () => {
    expect(planNextRun(hot, NO_FACTS, context())).toMatchObject({ at: NOW, reason: 'interval' });
  });

  it('never runs a source whose credential is missing', () => {
    expect(
      planNextRun(hot, facts({}), context({ missingVariables: ['MTA_BUSTIME_KEY'] })),
    ).toMatchObject({
      at: undefined,
      reason: 'never',
    });
  });

  it('uses the base interval, and the faster one while something is interested', () => {
    const idle = planNextRun(hot, facts({ lastOutcome: 'admitted' }), context());
    expect([offset(idle.at), idle.reason]).toEqual([60_000, 'interval']);
    const busy = planNextRun(
      hot,
      facts({ lastOutcome: 'admitted' }),
      context({ interested: true }),
    );
    expect([offset(busy.at), busy.reason, busy.intervalMs]).toEqual([15_000, 'interest', 15_000]);
  });

  it('ignores interest for sources with no faster rhythm', () => {
    const daily = testSource({ rhythm: { class: 'cold', baseIntervalMs: 86_400_000 } });
    expect(
      planNextRun(daily, facts({ lastOutcome: 'admitted' }), context({ interested: true })).reason,
    ).toBe('interval');
  });

  it('backs off after failures, doubling from 5 s, never beyond the interval', () => {
    const delays = [1, 2, 3, 4].map((failures) =>
      offset(
        planNextRun(hot, facts({ lastOutcome: 'failed', consecutiveFailures: failures }), context())
          .at,
      ),
    );
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000]);
    const rejected = planNextRun(
      hot,
      facts({ lastOutcome: 'rejected', consecutiveFailures: 4 }),
      context({ interested: true }),
    );
    expect(offset(rejected.at)).toBe(15_000);
  });

  it('spreads retries by ±20 %', () => {
    const early = planNextRun(
      hot,
      facts({ lastOutcome: 'failed', consecutiveFailures: 1 }),
      context({ random: () => 0 }),
    );
    const late = planNextRun(
      hot,
      facts({ lastOutcome: 'failed', consecutiveFailures: 1 }),
      context({ random: () => 0.999 }),
    );
    expect([offset(early.at), offset(late.at)]).toEqual([4_000, 5_998]);
  });

  it('opens a breaker after repeated failures: 5 to 30 minutes between tries', () => {
    const open = planNextRun(
      hot,
      facts({ lastOutcome: 'failed', consecutiveFailures: BREAKER_THRESHOLD }),
      context(),
    );
    expect([offset(open.at), open.reason]).toEqual([300_000, 'breaker']);
    const daily = testSource({ rhythm: { class: 'cold', baseIntervalMs: 86_400_000 } });
    expect(
      offset(
        planNextRun(daily, facts({ lastOutcome: 'failed', consecutiveFailures: 9 }), context()).at,
      ),
    ).toBe(1_800_000);
  });

  it('honours Retry-After when it is later than the interval', () => {
    const retryNotBefore = new Date(LAST.getTime() + 600_000);
    const plan = planNextRun(
      hot,
      facts({ lastOutcome: 'rate_limited', consecutiveFailures: 1, retryNotBefore }),
      context(),
    );
    expect([plan.at, plan.reason]).toEqual([retryNotBefore, 'retry-after']);
  });

  it('retries a refused credential hourly instead of looping', () => {
    const plan = planNextRun(
      hot,
      facts({ lastOutcome: 'misconfigured', consecutiveFailures: 7 }),
      context(),
    );
    expect(offset(plan.at)).toBe(3_600_000);
  });
});
