import {
  toInstant,
  type OpsSummary,
  type ProductFeature,
  type SourceDetail,
  type SourceRow,
  type SourceState,
} from '@moviq/contracts';

import type { Database } from '../../infrastructure/database/database.js';
import type { SourceDefinition } from './definition.js';
import { healthStore, type HealthRecord } from './health-store.js';
import { assess, NO_FACTS, type Assessment } from './health.js';
import { interestStore } from './interests.js';
import { planNextRun } from './schedule.js';

export interface SourceViewContext {
  readonly definitions: readonly SourceDefinition[];
  readonly missingVariables: (definition: SourceDefinition) => readonly string[];
}

const RUNS_SHOWN = 50;
const INCIDENTS_SHOWN = 20;
const seconds = (ms: number) => ms / 1000;
const iso = (date: Date | undefined) => (date === undefined ? null : toInstant(date));

/** Every source as operators see it now: the state is recomputed, so ages keep growing. */
export async function listSourceRows(
  db: Database,
  context: SourceViewContext,
  now: Date,
): Promise<SourceRow[]> {
  const [health, interested] = await Promise.all([
    healthStore.readAll(db),
    interestStore.activeSourceIds(db, now),
  ]);
  return context.definitions.map((definition) =>
    sourceRow(
      definition,
      health.get(definition.id),
      interested.has(definition.id),
      now,
      context.missingVariables(definition),
    ),
  );
}

export async function sourceDetail(
  db: Database,
  context: SourceViewContext,
  id: string,
  now: Date,
): Promise<SourceDetail | undefined> {
  const definition = context.definitions.find((candidate) => candidate.id === id);
  if (definition === undefined) return undefined;
  const [record, interested, runs, incidents] = await Promise.all([
    healthStore.read(db, id),
    interestStore.activeSourceIds(db, now),
    healthStore.runs(db, id, RUNS_SHOWN),
    healthStore.incidents(db, id, INCIDENTS_SHOWN),
  ]);
  return {
    ...sourceRow(definition, record, interested.has(id), now, context.missingVariables(definition)),
    licence: definition.licence,
    failures: definition.failures.map((failure) => ({ ...failure })),
    fallback: definition.fallback ?? null,
    runs: [...runs],
    incidents: [...incidents],
  };
}

function sourceRow(
  definition: SourceDefinition,
  record: HealthRecord | undefined,
  interested: boolean,
  now: Date,
  missing: readonly string[],
): SourceRow {
  const facts = record ?? NO_FACTS;
  const assessment = assess(definition, facts, now, missing);
  const plan = planNextRun(definition, facts, {
    now,
    interested,
    missingVariables: missing,
    random: () => 0.5,
  });
  return {
    id: definition.id,
    title: definition.title,
    provider: definition.provider,
    kind: definition.kind,
    rhythm: definition.rhythm.class,
    state: assessment.state,
    stateSince: iso(stateSince(definition, record, assessment)),
    evidence: assessment.evidence,
    dataTime: iso(facts.dataTime),
    ageSeconds: assessment.ageMs === undefined ? null : seconds(assessment.ageMs),
    freshness: {
      degradedAfterSeconds: seconds(definition.freshness.degradedAfterMs),
      staleAfterSeconds: seconds(definition.freshness.staleAfterMs),
      unavailableAfterSeconds: seconds(definition.freshness.unavailableAfterMs),
    },
    coverage: record?.coverage ?? null,
    lastSuccessAt: iso(record?.lastGoodAt),
    lastAttemptAt: iso(facts.lastAttemptAt),
    lastError:
      record?.lastErrorAt === undefined || record.lastErrorCode === undefined
        ? null
        : {
            at: toInstant(record.lastErrorAt),
            code: record.lastErrorCode,
            detail: record.lastErrorDetail ?? '',
          },
    latencyMs: record?.latencyMs ?? null,
    consecutiveFailures: facts.consecutiveFailures,
    intervalSeconds: seconds(plan.intervalMs),
    nextRunAt: iso(plan.at),
    nextRunReason: plan.reason,
    interested,
    servedVersion: facts.servedVersion ?? null,
    consumers: [...definition.consumers],
  };
}

/**
 * When the current state began. A state reached only by ageing since the last write began when
 * the data crossed that freshness limit.
 */
function stateSince(
  definition: SourceDefinition,
  record: HealthRecord | undefined,
  assessment: Assessment,
): Date | undefined {
  if (record === undefined) return undefined;
  if (record.state === assessment.state) return record.stateSince;
  const limits: Partial<Record<SourceState, number>> = {
    degraded: definition.freshness.degradedAfterMs,
    stale: definition.freshness.staleAfterMs,
    unavailable: definition.freshness.unavailableAfterMs,
  };
  const limit = limits[assessment.state];
  if (limit === undefined || record.dataTime === undefined) return undefined;
  return new Date(record.dataTime.getTime() + limit);
}

function needAttention(failing: readonly SourceRow[], total: number): string {
  const list = failing.map((row) => `${row.id} (${row.state})`).join(', ');
  return `${String(failing.length)} of ${String(total)} sources need attention: ${list}.`;
}

const WORKING: ReadonlySet<SourceState> = new Set(['healthy', 'outside_service']);
const BROKEN: ReadonlySet<SourceState> = new Set(['unavailable', 'misconfigured', 'unknown']);

/**
 * Features that work only while every one of their sources can be used, as their reader does:
 * the routing engine plans step-free only with the station list, both elevator lists and the
 * outages all `healthy` or `degraded`.
 */
const NEEDS_EVERY_SOURCE: ReadonlySet<ProductFeature> = new Set(['step-free']);
const USABLE: ReadonlySet<SourceState> = new Set(['healthy', 'degraded']);

type Feature = OpsSummary['features'][number];

function anySourceState(sources: readonly SourceRow[]): Pick<Feature, 'state' | 'evidence'> {
  const failing = sources.filter((row) => !WORKING.has(row.state));
  const broken = sources.filter((row) => BROKEN.has(row.state));
  const state =
    broken.length === sources.length
      ? 'unavailable'
      : failing.length > 0
        ? 'degraded'
        : 'available';
  const evidence =
    failing.length === 0
      ? `All ${String(sources.length)} sources work.`
      : needAttention(failing, sources.length);
  return { state, evidence };
}

function everySourceState(
  id: ProductFeature,
  sources: readonly SourceRow[],
): Pick<Feature, 'state' | 'evidence'> {
  const unusable = sources.filter((row) => !USABLE.has(row.state));
  if (unusable.length === 0) return anySourceState(sources);
  const list = unusable.map((row) => `${row.id} (${row.state})`).join(', ');
  return {
    state: 'unavailable',
    evidence: `${id} needs all ${String(sources.length)} of its sources: not usable now ${list}.`,
  };
}

/** Product features and whether their sources let them work, grouped by consumer. */
export function featureStates(rows: readonly SourceRow[]): OpsSummary['features'] {
  const byFeature = new Map<ProductFeature, SourceRow[]>();
  for (const row of rows) {
    for (const consumer of row.consumers)
      byFeature.set(consumer, [...(byFeature.get(consumer) ?? []), row]);
  }
  return [...byFeature.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, sources]) => ({
      id,
      ...(NEEDS_EVERY_SOURCE.has(id) ? everySourceState(id, sources) : anySourceState(sources)),
      sources: sources.map((row) => row.id),
    }));
}
