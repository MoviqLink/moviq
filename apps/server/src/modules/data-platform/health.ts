import type { RunOutcome, SourceState } from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import type { SourceDefinition } from './definition.js';

/** What the platform knows about a source, as stored after each run. */
export interface HealthFacts {
  readonly servedVersion: string | undefined;
  readonly dataTime: Date | undefined;
  readonly lastAttemptAt: Date | undefined;
  readonly lastOutcome: RunOutcome | undefined;
  readonly lastErrorCode: string | undefined;
  readonly lastErrorDetail: string | undefined;
  readonly consecutiveFailures: number;
  readonly retryNotBefore: Date | undefined;
}

export const NO_FACTS: HealthFacts = {
  servedVersion: undefined,
  dataTime: undefined,
  lastAttemptAt: undefined,
  lastOutcome: undefined,
  lastErrorCode: undefined,
  lastErrorDetail: undefined,
  consecutiveFailures: 0,
  retryNotBefore: undefined,
};

export interface Assessment {
  readonly state: SourceState;
  /** The rule and the facts that produced the state, in one sentence. */
  readonly evidence: string;
  readonly ageMs: number | undefined;
}

/**
 * Turns the facts of a source into its state, applying the rules in order of precedence.
 * `missingVariables` lists the unset credentials of its integration, if any. Pure: the same
 * facts at a later `now` give an older age, so served copies age as they are read.
 */
export function assess(
  definition: SourceDefinition,
  facts: HealthFacts,
  now: Date,
  missingVariables: readonly string[],
): Assessment {
  const ageMs =
    facts.dataTime === undefined
      ? undefined
      : Math.max(0, now.getTime() - facts.dataTime.getTime());
  const result = (state: SourceState, evidence: string): Assessment => ({ state, evidence, ageMs });
  const lastError = describeLastError(facts);

  if (missingVariables.length > 0) {
    return result(
      'misconfigured',
      `Needs ${missingVariables.join(', ')}, which ${missingVariables.length === 1 ? 'is' : 'are'} not set.`,
    );
  }
  if (facts.lastOutcome === 'misconfigured') {
    return result('misconfigured', `The provider refused the request: ${lastError}.`);
  }
  if (definition.servicePeriod !== undefined && !definition.servicePeriod(now)) {
    return result('outside_service', 'The provider publishes no data at this time.');
  }
  if (facts.lastAttemptAt === undefined && facts.dataTime === undefined) {
    return result('unknown', 'Not checked since start-up.');
  }
  if (
    facts.lastOutcome === 'rate_limited' &&
    facts.retryNotBefore !== undefined &&
    facts.retryNotBefore > now
  ) {
    return result(
      'rate_limited',
      `The provider asked us to wait until ${facts.retryNotBefore.toISOString()}.`,
    );
  }
  if (ageMs === undefined) {
    return result(
      'unavailable',
      `No usable data yet${lastError === 'none' ? '' : `: ${lastError}`}.`,
    );
  }
  const { degradedAfterMs, staleAfterMs, unavailableAfterMs } = definition.freshness;
  // A source the provider does not date is aged from when we received it: say so, because a
  // frozen feed would still look fresh.
  const byReceipt = definition.dataTimeSource === 'receipt';
  const published = byReceipt ? undefined : publishedDay(definition, facts);
  const age = byReceipt
    ? `Received ${formatDuration(ageMs)} ago`
    : published === undefined
      ? `Data is ${formatDuration(ageMs)} old`
      : `Published on ${published}, ${formatDuration(ageMs)} ago`;
  const undated = byReceipt ? '; the provider gives no time for its data' : '';
  if (ageMs > unavailableAfterMs) {
    return result(
      'unavailable',
      `${age}, beyond the ${formatDuration(unavailableAfterMs)} limit${undated}.`,
    );
  }
  if (ageMs > staleAfterMs) {
    return result(
      'stale',
      `${age}, over the ${formatDuration(staleAfterMs)} limit${withError(lastError, facts)}.`,
    );
  }
  if (ageMs > degradedAfterMs) {
    return result(
      'degraded',
      `${age}, over the ${formatDuration(degradedAfterMs)} target${withError(lastError, facts)}.`,
    );
  }
  if (facts.consecutiveFailures > 0) {
    return result('degraded', `${age}; the last attempt failed: ${lastError}.`);
  }
  if (published !== undefined) {
    return result('healthy', `In force, published on ${published}${stillServed(facts, now)}.`);
  }
  return result('healthy', `${age}${undated}.`);
}

/**
 * The New York day a static source the provider dates was published, such as a timetable: its
 * age is how long it has been in force, not a delay, so the evidence gives the day instead.
 */
function publishedDay(definition: SourceDefinition, facts: HealthFacts): string | undefined {
  if (definition.kind !== 'static' || facts.dataTime === undefined) return undefined;
  return toNewYorkWallClockText(facts.dataTime).slice(0, 10);
}

/** That the provider still published this version when last asked, which keeps it in force. */
function stillServed(facts: HealthFacts, now: Date): string {
  const current = facts.lastOutcome === 'admitted' || facts.lastOutcome === 'unchanged';
  if (!current || facts.lastAttemptAt === undefined) return '';
  const since = Math.max(0, now.getTime() - facts.lastAttemptAt.getTime());
  return `, the provider's current version when checked ${formatDuration(since)} ago`;
}

function describeLastError(facts: HealthFacts): string {
  if (facts.lastErrorCode === undefined) return 'none';
  return facts.lastErrorDetail === undefined || facts.lastErrorDetail === ''
    ? facts.lastErrorCode
    : `${facts.lastErrorCode} (${facts.lastErrorDetail})`;
}

function withError(lastError: string, facts: HealthFacts): string {
  return facts.consecutiveFailures > 0 ? `; the last attempt failed: ${lastError}` : '';
}

/** "45 s", "12 min", "3 h 20 min", "2 d 4 h". */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 120) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48)
    return minutes % 60 === 0
      ? `${String(hours)} h`
      : `${String(hours)} h ${String(minutes % 60)} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${String(days)} d` : `${String(days)} d ${String(hours % 24)} h`;
}
