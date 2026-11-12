import type { Transaction } from '@libsql/client';
import { jobSchema, toInstant, type Job, type JobFilter } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

export class JobStateError extends Error {
  constructor(id: number, state: Job['state']) {
    super(`Job ${String(id)} is ${state} and cannot change now.`);
    this.name = 'JobStateError';
  }
}

const rowSchema = z
  .object({
    id: z.number().int(),
    kind: z.string(),
    target: z.string(),
    state: z.string(),
    requested_by: z.string(),
    reason: z.string(),
    created_at: z.string(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    attempts: z.number().int(),
    last_error: z.string().nullable(),
  })
  .transform((row) =>
    jobSchema.parse({
      id: row.id,
      kind: row.kind,
      target: row.target,
      state: row.state,
      requestedBy: row.requested_by,
      reason: row.reason,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      attempts: row.attempts,
      lastError: row.last_error,
    }),
  );

const toJob = (row: unknown) => parseRow(rowSchema, row, 'jobs');

const totalRowSchema = z.object({ state: jobSchema.shape.state, n: z.number().int() });

function filterStates(filter: JobFilter): readonly Job['state'][] | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'active') return ['pending', 'running'];
  return [filter];
}

const INTERRUPTED_ONCE = 'Interrupted by a restart; it will run again.';
const INTERRUPTED_TOO_OFTEN = 'Interrupted three times by a restart; not tried again.';

/** Work asked for by people and carried out by the worker, with every change recorded. */
export const jobStore = {
  async create(
    tx: Transaction,
    job: Pick<Job, 'kind' | 'target' | 'requestedBy' | 'reason'>,
    now: Date,
  ): Promise<Job> {
    const result = await tx.execute({
      sql: `INSERT INTO jobs (kind, target, state, requested_by, reason, created_at)
            VALUES (?, ?, 'pending', ?, ?, ?) RETURNING *`,
      args: [job.kind, job.target, job.requestedBy, job.reason, toInstant(now)],
    });
    return toJob(result.rows[0]);
  },

  /** The newest jobs that match the filter. */
  async list(db: Database, filter: JobFilter, limit: number): Promise<readonly Job[]> {
    const states = filterStates(filter);
    const where =
      states === undefined ? '' : `WHERE state IN (${states.map(() => '?').join(', ')})`;
    const result = await db.query({
      sql: `SELECT * FROM jobs ${where} ORDER BY id DESC LIMIT ?`,
      args: [...(states ?? []), limit],
    });
    return result.rows.map(toJob);
  },

  /** How many jobs there are in each state. */
  async totals(db: Database): Promise<Record<Job['state'], number>> {
    const result = await db.query('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state');
    const totals = { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
    for (const row of result.rows) {
      const { state, n } = parseRow(totalRowSchema, row, 'jobs totals');
      totals[state] = n;
    }
    return totals;
  },

  async pending(db: Database, kind: Job['kind']): Promise<readonly Job[]> {
    const result = await db.query({
      sql: "SELECT * FROM jobs WHERE kind = ? AND state = 'pending' ORDER BY id",
      args: [kind],
    });
    return result.rows.map(toJob);
  },

  async counts(
    db: Database,
    since: Date,
  ): Promise<{ pending: number; running: number; failedLast24h: number }> {
    const result = await db.query({
      sql: `SELECT
              SUM(state = 'pending') AS pending,
              SUM(state = 'running') AS running,
              SUM(state = 'failed' AND finished_at >= ?) AS failed
            FROM jobs`,
      args: [toInstant(since)],
    });
    const row = parseRow(
      z.object({
        pending: z.number().nullable(),
        running: z.number().nullable(),
        failed: z.number().nullable(),
      }),
      result.rows[0],
      'jobs counts',
    );
    return { pending: row.pending ?? 0, running: row.running ?? 0, failedLast24h: row.failed ?? 0 };
  },

  /** Moves a pending job to running. False if someone else took or cancelled it first. */
  async start(tx: Transaction, id: number, now: Date): Promise<boolean> {
    const result = await tx.execute({
      sql: `UPDATE jobs SET state = 'running', started_at = ?, attempts = attempts + 1
            WHERE id = ? AND state = 'pending'`,
      args: [toInstant(now), id],
    });
    return result.rowsAffected === 1;
  },

  async finish(
    tx: Transaction,
    id: number,
    outcome: 'done' | 'failed',
    error: string | null,
    now: Date,
  ): Promise<void> {
    await tx.execute({
      sql: "UPDATE jobs SET state = ?, finished_at = ?, last_error = ? WHERE id = ? AND state = 'running'",
      args: [outcome, toInstant(now), error, id],
    });
  },

  /** Leaves a note on a job that is still waiting, such as why it has not started yet. */
  async note(tx: Transaction, id: number, text: string): Promise<void> {
    await tx.execute({
      sql: "UPDATE jobs SET last_error = ? WHERE id = ? AND state = 'pending'",
      args: [text, id],
    });
  },

  /**
   * Jobs left `running` by a worker that stopped mid-way go back to `pending`, unless they were
   * already interrupted `maxAttempts` times: then they fail, so a job that kills the worker
   * cannot loop forever.
   */
  async recoverInterrupted(tx: Transaction, now: Date, maxAttempts: number): Promise<void> {
    await tx.execute({
      sql: `UPDATE jobs SET state = 'failed', finished_at = ?, last_error = ?
            WHERE state = 'running' AND attempts >= ?`,
      args: [toInstant(now), INTERRUPTED_TOO_OFTEN, maxAttempts],
    });
    await tx.execute({
      sql: `UPDATE jobs SET state = 'pending', started_at = NULL, last_error = ?
            WHERE state = 'running'`,
      args: [INTERRUPTED_ONCE],
    });
  },

  /** Cancels a pending job. A job already running or finished cannot be cancelled. */
  async cancel(tx: Transaction, id: number, now: Date): Promise<Job | undefined> {
    const result = await tx.execute({
      sql: "UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ? AND state = 'pending' RETURNING *",
      args: [toInstant(now), id],
    });
    if (result.rows.length > 0) return toJob(result.rows[0]);
    const existing = await tx.execute({ sql: 'SELECT * FROM jobs WHERE id = ?', args: [id] });
    if (existing.rows.length === 0) return undefined;
    throw new JobStateError(id, toJob(existing.rows[0]).state);
  },
};
