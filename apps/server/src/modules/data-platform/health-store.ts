import type { InStatement, Transaction } from '@libsql/client';
import {
  runOutcomeSchema,
  sourceStateSchema,
  toInstant,
  type SourceRun,
  type SourceState,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { HealthFacts } from './health.js';

/** The stored facts of a source plus what operators see about its last run. */
export interface HealthRecord extends HealthFacts {
  readonly sourceId: string;
  readonly receivedAt: Date | undefined;
  readonly coverage: string | undefined;
  readonly etag: string | undefined;
  readonly lastGoodAt: Date | undefined;
  readonly lastErrorAt: Date | undefined;
  readonly latencyMs: number | undefined;
  readonly state: SourceState;
  readonly stateSince: Date;
  readonly evidence: string;
}

export type RunRecord = Omit<SourceRun, 'id'>;

export interface Incident {
  readonly at: string;
  readonly fromState: SourceState;
  readonly toState: SourceState;
  readonly evidence: string;
}

const text = z.string().nullable();
const instant = text.transform((value) => (value === null ? undefined : new Date(value)));
const optional = text.transform((value) => value ?? undefined);

const healthRowSchema = z.object({
  source_id: z.string(),
  served_version: optional,
  data_time: instant,
  received_at: instant,
  coverage: optional,
  etag: optional,
  last_good_at: instant,
  last_attempt_at: instant,
  last_outcome: runOutcomeSchema.nullable().transform((value) => value ?? undefined),
  last_error_at: instant,
  last_error_code: optional,
  last_error_detail: optional,
  latency_ms: z
    .number()
    .int()
    .nullable()
    .transform((value) => value ?? undefined),
  consecutive_failures: z.number().int().nonnegative(),
  retry_not_before: instant,
  state: sourceStateSchema,
  state_since: z.string().transform((value) => new Date(value)),
  evidence: z.string(),
});

const runRowSchema = z.object({
  id: z.number().int().positive(),
  source_id: z.string(),
  trigger: z.enum(['schedule', 'manual']),
  requested_by: text,
  reason: text,
  started_at: z.string(),
  finished_at: z.string(),
  outcome: runOutcomeSchema,
  http_status: z.number().int().nullable(),
  bytes: z.number().int().nullable(),
  duration_ms: z.number().int(),
  data_time: text,
  version: text,
  coverage: text,
  error_code: text,
  detail: text,
});

const incidentRowSchema = z.object({
  at: z.string(),
  from_state: sourceStateSchema,
  to_state: sourceStateSchema,
  evidence: z.string(),
});

const UPSERT_HEALTH = `INSERT INTO source_health (source_id, served_version, data_time, received_at,
  coverage, etag, last_good_at, last_attempt_at, last_outcome, last_error_at, last_error_code,
  last_error_detail, latency_ms, consecutive_failures, retry_not_before, state, state_since,
  evidence, updated_at)
VALUES (:source_id, :served_version, :data_time, :received_at, :coverage, :etag, :last_good_at,
  :last_attempt_at, :last_outcome, :last_error_at, :last_error_code, :last_error_detail,
  :latency_ms, :consecutive_failures, :retry_not_before, :state, :state_since, :evidence,
  :updated_at)
ON CONFLICT (source_id) DO UPDATE SET served_version = excluded.served_version,
  data_time = excluded.data_time, received_at = excluded.received_at,
  coverage = excluded.coverage, etag = excluded.etag, last_good_at = excluded.last_good_at,
  last_attempt_at = excluded.last_attempt_at, last_outcome = excluded.last_outcome,
  last_error_at = excluded.last_error_at, last_error_code = excluded.last_error_code,
  last_error_detail = excluded.last_error_detail, latency_ms = excluded.latency_ms,
  consecutive_failures = excluded.consecutive_failures,
  retry_not_before = excluded.retry_not_before, state = excluded.state,
  state_since = excluded.state_since, evidence = excluded.evidence,
  updated_at = excluded.updated_at`;

const INSERT_RUN = `INSERT INTO source_runs (source_id, trigger, requested_by, reason, started_at,
  finished_at, outcome, http_status, bytes, duration_ms, data_time, version, coverage,
  error_code, detail)
VALUES (:source_id, :trigger, :requested_by, :reason, :started_at, :finished_at, :outcome,
  :http_status, :bytes, :duration_ms, :data_time, :version, :coverage, :error_code, :detail)`;

const iso = (date: Date | undefined) => (date === undefined ? null : toInstant(date));

/** Reads and writes the facts, runs and incidents of sources. Writes go inside a transaction. */
export const healthStore = {
  async readAll(db: Database): Promise<ReadonlyMap<string, HealthRecord>> {
    const result = await db.query('SELECT * FROM source_health');
    const records = result.rows.map((row) =>
      toRecord(parseRow(healthRowSchema, row, 'source_health')),
    );
    return new Map(records.map((record) => [record.sourceId, record]));
  },

  async read(db: Database, sourceId: string): Promise<HealthRecord | undefined> {
    const result = await db.query({
      sql: 'SELECT * FROM source_health WHERE source_id = ?',
      args: [sourceId],
    });
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : toRecord(parseRow(healthRowSchema, row, 'source_health'));
  },

  async write(tx: Transaction, record: HealthRecord, updatedAt: Date): Promise<void> {
    await tx.execute({
      sql: UPSERT_HEALTH,
      args: {
        source_id: record.sourceId,
        served_version: record.servedVersion ?? null,
        data_time: iso(record.dataTime),
        received_at: iso(record.receivedAt),
        coverage: record.coverage ?? null,
        etag: record.etag ?? null,
        last_good_at: iso(record.lastGoodAt),
        last_attempt_at: iso(record.lastAttemptAt),
        last_outcome: record.lastOutcome ?? null,
        last_error_at: iso(record.lastErrorAt),
        last_error_code: record.lastErrorCode ?? null,
        last_error_detail: record.lastErrorDetail ?? null,
        latency_ms: record.latencyMs ?? null,
        consecutive_failures: record.consecutiveFailures,
        retry_not_before: iso(record.retryNotBefore),
        state: record.state,
        state_since: toInstant(record.stateSince),
        evidence: record.evidence,
        updated_at: toInstant(updatedAt),
      },
    });
  },

  async addRun(tx: Transaction, run: RunRecord): Promise<void> {
    await tx.execute({
      sql: INSERT_RUN,
      args: {
        source_id: run.sourceId,
        trigger: run.trigger,
        requested_by: run.requestedBy,
        reason: run.reason,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        outcome: run.outcome,
        http_status: run.httpStatus,
        bytes: run.bytes,
        duration_ms: run.durationMs,
        data_time: run.dataTime,
        version: run.version,
        coverage: run.coverage,
        error_code: run.errorCode,
        detail: run.detail,
      },
    });
  },

  async addIncident(tx: Transaction, sourceId: string, incident: Incident): Promise<void> {
    await tx.execute({
      sql: 'INSERT INTO source_incidents (source_id, at, from_state, to_state, evidence) VALUES (?, ?, ?, ?, ?)',
      args: [sourceId, incident.at, incident.fromState, incident.toState, incident.evidence],
    });
  },

  async runs(db: Database, sourceId: string, limit: number): Promise<readonly SourceRun[]> {
    const result = await db.query({
      sql: 'SELECT * FROM source_runs WHERE source_id = ? ORDER BY id DESC LIMIT ?',
      args: [sourceId, limit],
    });
    return result.rows.map((row) => toRun(parseRow(runRowSchema, row, 'source_runs')));
  },

  async incidents(db: Database, sourceId: string, limit: number): Promise<readonly Incident[]> {
    const result = await db.query({
      sql: `SELECT at, from_state, to_state, evidence FROM source_incidents
            WHERE source_id = ? ORDER BY id DESC LIMIT ?`,
      args: [sourceId, limit],
    });
    return result.rows.map((row) => {
      const parsed = parseRow(incidentRowSchema, row, 'source_incidents');
      return {
        at: parsed.at,
        fromState: parsed.from_state,
        toState: parsed.to_state,
        evidence: parsed.evidence,
      };
    });
  },

  /** Deletes runs and incidents older than the retention period. */
  retentionStatements(cutoff: Date): readonly InStatement[] {
    const at = toInstant(cutoff);
    return [
      { sql: 'DELETE FROM source_runs WHERE started_at < ?', args: [at] },
      { sql: 'DELETE FROM source_incidents WHERE at < ?', args: [at] },
    ];
  },
};

function toRecord(row: z.infer<typeof healthRowSchema>): HealthRecord {
  return {
    sourceId: row.source_id,
    servedVersion: row.served_version,
    dataTime: row.data_time,
    receivedAt: row.received_at,
    coverage: row.coverage,
    etag: row.etag,
    lastGoodAt: row.last_good_at,
    lastAttemptAt: row.last_attempt_at,
    lastOutcome: row.last_outcome,
    lastErrorAt: row.last_error_at,
    lastErrorCode: row.last_error_code,
    lastErrorDetail: row.last_error_detail,
    latencyMs: row.latency_ms,
    consecutiveFailures: row.consecutive_failures,
    retryNotBefore: row.retry_not_before,
    state: row.state,
    stateSince: row.state_since,
    evidence: row.evidence,
  };
}

function toRun(row: z.infer<typeof runRowSchema>): SourceRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    trigger: row.trigger,
    requestedBy: row.requested_by,
    reason: row.reason,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome,
    httpStatus: row.http_status,
    bytes: row.bytes,
    durationMs: row.duration_ms,
    dataTime: row.data_time,
    version: row.version,
    coverage: row.coverage,
    errorCode: row.error_code,
    detail: row.detail,
  };
}
