import type { SourceState } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { SEVERITY, countByState, sortBySeverity } from '../src/features/ops/model/severity';

const freshness = {
  degradedAfterSeconds: 60,
  staleAfterSeconds: 180,
  unavailableAfterSeconds: 600,
};

const source = (
  title: string,
  state: SourceState,
  extra: { failures?: number; age?: number } = {},
) => ({
  title,
  state,
  consecutiveFailures: extra.failures ?? 0,
  ageSeconds: extra.age ?? null,
  freshness,
});

describe('order by severity', () => {
  it('ranks every state once, from what needs a person to what needs nobody', () => {
    expect(new Set(SEVERITY).size).toBe(8);
    expect(SEVERITY[0]).toBe('unavailable');
    expect(SEVERITY.at(-1)).toBe('healthy');
    expect(SEVERITY.indexOf('misconfigured')).toBeLessThan(SEVERITY.indexOf('degraded'));
    expect(SEVERITY.indexOf('outside_service')).toBeGreaterThan(SEVERITY.indexOf('unknown'));
  });

  it('puts the worst state first', () => {
    const rows = [
      source('Bus', 'healthy'),
      source('Ferry', 'outside_service'),
      source('Alerts', 'stale'),
      source('Lifts', 'unavailable'),
      source('Flights', 'misconfigured'),
    ];
    expect(sortBySeverity(rows).map((row) => row.title)).toEqual([
      'Lifts',
      'Flights',
      'Alerts',
      'Ferry',
      'Bus',
    ]);
  });

  it('breaks ties by failures in a row, then by how worn the data is, then by title', () => {
    const rows = [
      source('B', 'degraded', { age: 90 }),
      source('A', 'degraded', { age: 90 }),
      source('C', 'degraded', { age: 170 }),
      source('D', 'degraded', { failures: 3, age: 61 }),
    ];
    expect(sortBySeverity(rows).map((row) => row.title)).toEqual(['D', 'C', 'A', 'B']);
  });

  it('does not reorder the list it was given', () => {
    const rows = [source('Bus', 'healthy'), source('Lifts', 'unavailable')];
    sortBySeverity(rows);
    expect(rows[0]?.title).toBe('Bus');
  });

  it('counts only the states that occur, worst first', () => {
    const rows = [source('a', 'healthy'), source('b', 'stale'), source('c', 'healthy')];
    expect(countByState(rows)).toEqual([
      { state: 'stale', count: 1 },
      { state: 'healthy', count: 2 },
    ]);
  });
});
