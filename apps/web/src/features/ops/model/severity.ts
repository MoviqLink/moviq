import type { SourceRow, SourceState } from '@moviq/contracts';

/**
 * States from the one that needs a person first to the one that needs nobody. `misconfigured`
 * follows `unavailable` because it never heals by itself; `outside_service` is not a failure.
 */
export const SEVERITY: readonly SourceState[] = [
  'unavailable',
  'misconfigured',
  'stale',
  'rate_limited',
  'degraded',
  'unknown',
  'outside_service',
  'healthy',
];

export function severityRank(state: SourceState): number {
  return SEVERITY.indexOf(state);
}

type Ranked = Pick<
  SourceRow,
  'state' | 'consecutiveFailures' | 'ageSeconds' | 'freshness' | 'title'
>;

/** How far the data is through its life, measured against the age at which it is unusable. */
function lifeUsed(row: Ranked): number {
  return row.ageSeconds === null ? 0 : row.ageSeconds / row.freshness.unavailableAfterSeconds;
}

/** Worst first: by state, then failures in a row, then how worn the data is, then by title. */
function compareBySeverity(a: Ranked, b: Ranked): number {
  return (
    severityRank(a.state) - severityRank(b.state) ||
    b.consecutiveFailures - a.consecutiveFailures ||
    lifeUsed(b) - lifeUsed(a) ||
    a.title.localeCompare(b.title)
  );
}

export function sortBySeverity<T extends Ranked>(rows: readonly T[]): T[] {
  return [...rows].sort(compareBySeverity);
}

/** How many rows are in each state, listed worst first and only for states that occur. */
export function countByState(
  rows: readonly Pick<SourceRow, 'state'>[],
): { state: SourceState; count: number }[] {
  return SEVERITY.map((state) => ({
    state,
    count: rows.filter((row) => row.state === state).length,
  })).filter((entry) => entry.count > 0);
}
