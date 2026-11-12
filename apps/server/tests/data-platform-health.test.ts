import { describe, expect, it } from 'vitest';

import type { SourceDefinition } from '../src/modules/data-platform/definition.js';
import {
  assess,
  formatDuration,
  NO_FACTS,
  type HealthFacts,
} from '../src/modules/data-platform/health.js';
import { testSource } from './support/sources.js';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const definition = testSource({
  freshness: { degradedAfterMs: 60_000, staleAfterMs: 300_000, unavailableAfterMs: 3_600_000 },
});
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const facts = (overrides: Partial<HealthFacts>): HealthFacts => ({ ...NO_FACTS, ...overrides });
const state = (f: HealthFacts, def: SourceDefinition = definition, missing: string[] = []) =>
  assess(def, f, NOW, missing);

describe('assess', () => {
  it('is unknown before the first check', () => {
    expect(state(NO_FACTS)).toMatchObject({
      state: 'unknown',
      evidence: 'Not checked since start-up.',
    });
  });

  it('measures freshness by the time of the data, not of the download', () => {
    expect(state(facts({ dataTime: ago(30_000), lastAttemptAt: NOW })).state).toBe('healthy');
    expect(state(facts({ dataTime: ago(90_000), lastAttemptAt: NOW }))).toMatchObject({
      state: 'degraded',
      evidence: 'Data is 90 s old, over the 60 s target.',
    });
    expect(state(facts({ dataTime: ago(600_000), lastAttemptAt: NOW })).state).toBe('stale');
    expect(state(facts({ dataTime: ago(7_200_000), lastAttemptAt: NOW })).state).toBe(
      'unavailable',
    );
  });

  it('never reports a failed source as healthy: fresh data with a failed attempt is degraded', () => {
    const result = state(
      facts({
        dataTime: ago(10_000),
        lastAttemptAt: NOW,
        lastOutcome: 'failed',
        consecutiveFailures: 1,
        lastErrorCode: 'http-503',
      }),
    );
    expect(result).toMatchObject({
      state: 'degraded',
      evidence: 'Data is 10 s old; the last attempt failed: http-503.',
    });
  });

  it('is unavailable, never "no incidents", when nothing usable ever arrived', () => {
    const result = state(
      facts({
        lastAttemptAt: NOW,
        lastOutcome: 'failed',
        consecutiveFailures: 3,
        lastErrorCode: 'timeout',
        lastErrorDetail: 'No answer within 10000 ms',
      }),
    );
    expect(result).toMatchObject({
      state: 'unavailable',
      evidence: 'No usable data yet: timeout (No answer within 10000 ms).',
    });
  });

  it('names the missing credential, and takes precedence over everything else', () => {
    const needsKey = testSource({ integration: 'mta-bus-time' });
    expect(state(facts({ dataTime: ago(1_000) }), needsKey, ['MTA_BUSTIME_KEY'])).toMatchObject({
      state: 'misconfigured',
      evidence: 'Needs MTA_BUSTIME_KEY, which is not set.',
    });
  });

  it('reports a refused credential as misconfigured', () => {
    expect(
      state(facts({ lastAttemptAt: NOW, lastOutcome: 'misconfigured', lastErrorCode: 'http-403' }))
        .state,
    ).toBe('misconfigured');
  });

  it('reports outside service hours as such, not as a failure', () => {
    const nightly = testSource({ servicePeriod: () => false });
    expect(state(facts({ lastAttemptAt: NOW }), nightly).state).toBe('outside_service');
  });

  it('is rate limited until the time the provider gave', () => {
    const limited = facts({
      dataTime: ago(10_000),
      lastAttemptAt: NOW,
      lastOutcome: 'rate_limited',
      consecutiveFailures: 1,
      retryNotBefore: new Date(NOW.getTime() + 60_000),
    });
    expect(state(limited).state).toBe('rate_limited');
    expect(state({ ...limited, retryNotBefore: ago(1) }).state).toBe('degraded');
  });

  it('ages the same facts as time passes', () => {
    const served = facts({ dataTime: ago(30_000), lastAttemptAt: ago(30_000) });
    expect(assess(definition, served, NOW, []).state).toBe('healthy');
    expect(assess(definition, served, new Date(NOW.getTime() + 600_000), []).state).toBe('stale');
  });
});

describe('sources dated by receipt (regression A11)', () => {
  it('say that freshness only proves the feed answered', () => {
    const received = testSource({ dataTimeSource: 'receipt' });
    expect(
      assess(received, facts({ dataTime: ago(30_000), lastAttemptAt: NOW }), NOW, []),
    ).toMatchObject({
      state: 'healthy',
      evidence: 'Received 30 s ago; the provider gives no time for its data.',
    });
  });
});

describe('static sources the provider dates', () => {
  const timetable = testSource({
    kind: 'static',
    freshness: { degradedAfterMs: 30 * DAY, staleAfterMs: 60 * DAY, unavailableAfterMs: 120 * DAY },
  });
  const published = new Date('2026-10-28T04:00:00.000Z');

  it('say the version in force and the day it was published, not an age as if it were live', () => {
    const served = facts({
      dataTime: published,
      lastAttemptAt: ago(2 * HOUR),
      lastOutcome: 'unchanged',
    });
    expect(assess(timetable, served, NOW, [])).toMatchObject({
      state: 'healthy',
      evidence:
        "In force, published on 2026-10-28, the provider's current version when checked 2 h ago.",
    });
    const fresh = { ...served, lastOutcome: undefined };
    expect(assess(timetable, fresh, NOW, []).evidence).toBe('In force, published on 2026-10-28.');
  });

  it('give the day and the age when the age crosses a limit', () => {
    const old = facts({ dataTime: published, lastAttemptAt: NOW, lastOutcome: 'unchanged' });
    expect(assess(timetable, old, new Date('2026-12-05T12:00:00.000Z'), [])).toMatchObject({
      state: 'degraded',
      evidence: 'Published on 2026-10-28, 38 d 8 h ago, over the 30 d target.',
    });
  });
});

describe('formatDuration', () => {
  it('reads naturally at every scale', () => {
    expect(
      [45_000, 119_000, 600_000, 12_000_000, 190_000_000, 7_200_000, 259_200_000].map(
        formatDuration,
      ),
    ).toEqual(['45 s', '119 s', '10 min', '3 h 20 min', '2 d 4 h', '2 h', '3 d']);
  });
});
