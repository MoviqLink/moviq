import type { SourceDefinition } from './definition.js';
import type { HealthFacts } from './health.js';

type NextRunReason = 'interval' | 'interest' | 'backoff' | 'breaker' | 'retry-after' | 'never';

export interface NextRun {
  /** Undefined when the source must not run at all (a credential is missing). */
  readonly at: Date | undefined;
  readonly reason: NextRunReason;
  /** The interval in force, for operators. */
  readonly intervalMs: number;
}

export interface ScheduleContext {
  readonly now: Date;
  readonly interested: boolean;
  readonly missingVariables: readonly string[];
  /** A number in [0, 1). Injected so tests are exact; production passes `Math.random`. */
  readonly random: () => number;
}

/** After this many failures in a row the breaker opens and retries slow down. */
export const BREAKER_THRESHOLD = 5;
const FIRST_RETRY_MS = 5_000;
const BREAKER_MIN_MS = 5 * 60_000;
const BREAKER_MAX_MS = 30 * 60_000;
const REFUSED_CREDENTIAL_RETRY_MS = 60 * 60_000;

/**
 * When a source should run next. Missing credentials never run; refused credentials are retried
 * hourly, not in a loop; a provider's Retry-After is honoured; failures back off with jitter and,
 * after several, open a breaker. Interest speeds a source up, never beyond its own rate.
 */
export function planNextRun(
  definition: SourceDefinition,
  facts: HealthFacts,
  context: ScheduleContext,
): NextRun {
  const interestMs = definition.rhythm.interestIntervalMs;
  const useInterest =
    context.interested && interestMs !== undefined && interestMs < definition.rhythm.baseIntervalMs;
  const intervalMs = useInterest ? interestMs : definition.rhythm.baseIntervalMs;
  const plan = (at: Date | undefined, reason: NextRunReason): NextRun => ({
    at,
    reason,
    intervalMs,
  });

  if (context.missingVariables.length > 0) return plan(undefined, 'never');
  const last = facts.lastAttemptAt;
  if (last === undefined) return plan(context.now, useInterest ? 'interest' : 'interval');
  const after = (ms: number) => new Date(last.getTime() + ms);

  if (facts.lastOutcome === 'misconfigured')
    return plan(after(REFUSED_CREDENTIAL_RETRY_MS), 'backoff');
  if (facts.lastOutcome === 'rate_limited' && facts.retryNotBefore !== undefined) {
    const regular = after(intervalMs);
    return plan(facts.retryNotBefore > regular ? facts.retryNotBefore : regular, 'retry-after');
  }
  if (facts.consecutiveFailures >= BREAKER_THRESHOLD) {
    const wait = Math.min(Math.max(intervalMs, BREAKER_MIN_MS), BREAKER_MAX_MS);
    return plan(after(jitter(wait, context.random)), 'breaker');
  }
  if (facts.consecutiveFailures > 0) {
    const backoff = FIRST_RETRY_MS * 2 ** (facts.consecutiveFailures - 1);
    return plan(after(jitter(Math.min(backoff, intervalMs), context.random)), 'backoff');
  }
  return plan(after(intervalMs), useInterest ? 'interest' : 'interval');
}

/** Spreads retries by ±20 % so sources that failed together do not retry together. */
function jitter(ms: number, random: () => number): number {
  return Math.round(ms * (0.8 + 0.4 * random()));
}
