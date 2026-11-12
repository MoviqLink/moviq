import { toInstant, type SourceState } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { HttpClient } from '../../infrastructure/http/client.js';
import type { LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import { attemptCollection, type Attempt } from './attempt.js';
import type { SourceDefinition } from './definition.js';
import { healthStore, type HealthRecord, type RunRecord } from './health-store.js';
import { assess, NO_FACTS } from './health.js';
import { snapshotStore } from './snapshots.js';

export interface CollectRequest {
  readonly trigger: 'schedule' | 'manual';
  readonly requestedBy: string | null;
  readonly reason: string | null;
  /** Fetch the full body to rebuild an older stored representation. */
  readonly forceFull?: boolean;
}

interface CollectResult {
  readonly outcome: Attempt['outcome'];
  /** Why the attempt failed, or null when it collected. */
  readonly errorCode: string | null;
  readonly state: SourceState;
  readonly evidence: string;
}

/** The credentials a source needs: the names of those missing and the values of those set. */
export type CredentialResolver = (definition: SourceDefinition) => {
  readonly missing: readonly string[];
  readonly values: Readonly<Record<string, string>>;
};

export interface CollectorDependencies {
  readonly db: Database;
  readonly http: HttpClient;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly credentials: CredentialResolver;
  /** Removes credentials and secret-shaped text from what a provider said. */
  readonly sanitize: (text: string) => string;
}

export type Collect = (
  definition: SourceDefinition,
  term: LeaderTerm,
  request: CollectRequest,
) => Promise<CollectResult>;

function mustFetchFull(
  definition: SourceDefinition,
  previous: unknown,
  request: CollectRequest,
): boolean {
  return (
    request.forceFull === true ||
    (previous !== undefined && definition.needsFullRefresh?.(previous) === true)
  );
}

/**
 * Runs the admission chain for one source and commits everything it learnt (snapshot, run,
 * facts, incident) in one fenced transaction. Keeps the served data of each source in memory so
 * checks can compare without reading it back.
 */
export function createCollector(deps: CollectorDependencies): Collect {
  const served = new Map<string, { readonly version: string; readonly data: unknown }>();

  const previousData = async (definition: SourceDefinition, current: HealthRecord | undefined) => {
    const version = current?.servedVersion;
    if (version === undefined) return undefined;
    const cached = served.get(definition.id);
    if (cached?.version === version) return cached.data;
    const stored = await snapshotStore.read(deps.db, definition.id, version);
    const parsed = definition.dataSchema.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  };

  return async (definition, term, request) => {
    const startedAt = deps.clock.now();
    const current = await healthStore.read(deps.db, definition.id);
    const { missing, values } = deps.credentials(definition);
    const previous = await previousData(definition, current);
    const forceFull = mustFetchFull(definition, previous, request);
    const raw: Attempt =
      missing.length > 0
        ? {
            outcome: 'misconfigured',
            errorCode: 'missing-credential',
            detail: `Needs ${missing.join(', ')}.`,
            response: undefined,
          }
        : await attemptCollection({
            definition,
            current,
            forceFull,
            previous,
            credentials: values,
            http: deps.http,
            now: () => deps.clock.now(),
          });
    const attempt = cleanDetail(raw, deps.sanitize);
    const finishedAt = deps.clock.now();
    const facts = nextFacts(definition.id, current, attempt, finishedAt);
    const assessment = assess(definition, facts, finishedAt, missing);
    const sameState = current?.state === assessment.state;
    const record: HealthRecord = {
      ...facts,
      state: assessment.state,
      stateSince: sameState ? current.stateSince : finishedAt,
      evidence: assessment.evidence,
    };
    const run = runRecord(definition.id, request, attempt, startedAt, finishedAt);

    await term.fenced(async (tx) => {
      if (attempt.outcome === 'admitted') {
        await snapshotStore.put(
          tx,
          definition.id,
          attempt.snapshot,
          attempt.dataTime,
          finishedAt,
          definition.keepVersions,
        );
      }
      await healthStore.addRun(tx, run);
      await healthStore.write(tx, record, finishedAt);
      if (!sameState) {
        await healthStore.addIncident(tx, definition.id, {
          at: toInstant(finishedAt),
          fromState: current?.state ?? 'unknown',
          toState: assessment.state,
          evidence: assessment.evidence,
        });
      }
    });
    if (attempt.outcome === 'admitted')
      served.set(definition.id, { version: attempt.snapshot.version, data: attempt.data });
    logRun(deps.logger, definition.id, run, assessment.state);
    return {
      outcome: attempt.outcome,
      errorCode: run.errorCode,
      state: assessment.state,
      evidence: assessment.evidence,
    };
  };
}

/** Stored error details are short enough to read and never longer than this. */
const MAX_DETAIL_LENGTH = 500;

/** The attempt with its error detail sanitised and cut, ready to store and show. Pure. */
function cleanDetail(attempt: Attempt, sanitize: (text: string) => string): Attempt {
  if (attempt.outcome === 'admitted' || attempt.outcome === 'unchanged') return attempt;
  const clean = sanitize(attempt.detail);
  const detail =
    clean.length > MAX_DETAIL_LENGTH ? `${clean.slice(0, MAX_DETAIL_LENGTH - 1)}…` : clean;
  return { ...attempt, detail };
}

type Facts = Omit<HealthRecord, 'state' | 'stateSince' | 'evidence'>;

/** The facts after an attempt. Pure. */
function nextFacts(
  sourceId: string,
  current: HealthRecord | undefined,
  attempt: Attempt,
  now: Date,
): Facts {
  const base: Facts = {
    sourceId,
    ...NO_FACTS,
    receivedAt: undefined,
    coverage: undefined,
    etag: undefined,
    lastGoodAt: undefined,
    lastErrorAt: undefined,
    latencyMs: undefined,
    ...stripState(current),
  };
  const latencyMs = attempt.response?.latencyMs ?? base.latencyMs;
  switch (attempt.outcome) {
    case 'admitted':
      return {
        ...base,
        servedVersion: attempt.snapshot.version,
        dataTime: attempt.dataTime,
        receivedAt: now,
        coverage: attempt.coverage,
        etag: attempt.response.etag,
        lastGoodAt: now,
        lastAttemptAt: now,
        lastOutcome: 'admitted',
        consecutiveFailures: 0,
        retryNotBefore: undefined,
        latencyMs,
      };
    case 'unchanged':
      return {
        ...base,
        dataTime: attempt.dataTime ?? base.dataTime,
        coverage: attempt.coverage ?? base.coverage,
        etag: attempt.response.etag ?? base.etag,
        receivedAt: now,
        lastGoodAt: now,
        lastAttemptAt: now,
        lastOutcome: 'unchanged',
        consecutiveFailures: 0,
        retryNotBefore: undefined,
        latencyMs,
      };
    case 'rejected':
    case 'failed':
    case 'rate_limited':
    case 'misconfigured':
      return {
        ...base,
        lastAttemptAt: now,
        lastOutcome: attempt.outcome,
        lastErrorAt: now,
        lastErrorCode: attempt.errorCode,
        lastErrorDetail: attempt.detail,
        consecutiveFailures: base.consecutiveFailures + 1,
        retryNotBefore:
          attempt.outcome === 'rate_limited' && attempt.retryAfterMs !== undefined
            ? new Date(now.getTime() + attempt.retryAfterMs)
            : undefined,
        latencyMs,
      };
  }
}

function stripState(current: HealthRecord | undefined): Partial<Facts> {
  if (current === undefined) return {};
  const { state, stateSince, evidence, ...facts } = current;
  return facts;
}

function runRecord(
  sourceId: string,
  request: CollectRequest,
  attempt: Attempt,
  startedAt: Date,
  finishedAt: Date,
): RunRecord {
  const failed = attempt.outcome !== 'admitted' && attempt.outcome !== 'unchanged';
  return {
    sourceId,
    trigger: request.trigger,
    requestedBy: request.requestedBy,
    reason: request.reason,
    startedAt: toInstant(startedAt),
    finishedAt: toInstant(finishedAt),
    outcome: attempt.outcome,
    httpStatus: attempt.response?.httpStatus ?? null,
    bytes: attempt.response?.bytes ?? null,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    dataTime:
      attempt.outcome === 'admitted' || attempt.outcome === 'unchanged'
        ? attempt.dataTime === undefined
          ? null
          : toInstant(attempt.dataTime)
        : null,
    version: attempt.outcome === 'admitted' ? attempt.snapshot.version : null,
    coverage: attempt.outcome === 'admitted' ? attempt.coverage : null,
    errorCode: failed ? attempt.errorCode : null,
    detail: failed ? attempt.detail : null,
  };
}

function logRun(logger: Logger, sourceId: string, run: RunRecord, state: SourceState): void {
  const fields = {
    source: sourceId,
    outcome: run.outcome,
    state,
    durationMs: run.durationMs,
    errorCode: run.errorCode,
  };
  if (run.errorCode === null) logger.debug('source run', fields);
  else logger.warn('source run failed', { ...fields, detail: run.detail });
}
