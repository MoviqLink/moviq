import type { SourceRow } from '@moviq/contracts';

import { secondsSince } from '../../../shared/time/instant';

type Freshness = SourceRow['freshness'];

/** Where an age falls against the source's limits. */
export type AgeBand = 'fresh' | 'degraded' | 'stale' | 'unavailable';

/**
 * The age of the data now: the data time against the browser clock, so it keeps growing on screen
 * between two answers of the API. Null while the source has never delivered data.
 */
export function liveAge(dataTime: string | null, nowMs: number): number | null {
  return dataTime === null ? null : secondsSince(dataTime, nowMs);
}

export function ageBand(ageSeconds: number, freshness: Freshness): AgeBand {
  if (ageSeconds >= freshness.unavailableAfterSeconds) return 'unavailable';
  if (ageSeconds >= freshness.staleAfterSeconds) return 'stale';
  if (ageSeconds >= freshness.degradedAfterSeconds) return 'degraded';
  return 'fresh';
}

/** The limit a source is measured against while fresh: the age at which it degrades. */
export function currentLimit(ageSeconds: number, freshness: Freshness): number {
  const band = ageBand(ageSeconds, freshness);
  if (band === 'fresh') return freshness.degradedAfterSeconds;
  if (band === 'degraded') return freshness.staleAfterSeconds;
  return freshness.unavailableAfterSeconds;
}

/** A position from 0 to 1 along the age line, whose end is the age at which data is unusable. */
export function agePosition(ageSeconds: number, freshness: Freshness): number {
  return Math.min(1, ageSeconds / freshness.unavailableAfterSeconds);
}
