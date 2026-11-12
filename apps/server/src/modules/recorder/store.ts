import type { Transaction } from '@libsql/client';
import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import { unixSeconds } from './events.js';
import type { OpenIncidents } from './extractor.js';

/** An admitted run of `source_runs`: one version to record. */
export interface AdmittedRun {
  readonly id: number;
  readonly sourceId: string;
  readonly version: string;
  readonly dataTime: Date;
  readonly admittedAt: Date;
}

export interface SourcePosition {
  readonly sourceId: string;
  readonly lastRunId: number;
  readonly lastVersion: string;
  readonly lastDataTime: Date;
}

export interface DayCount {
  readonly day: string;
  readonly sourceId: string;
  readonly versions: number;
  readonly events: number;
  readonly bytes: number;
  readonly lostVersions: number;
}

export interface GapRecord {
  readonly sourceId: string;
  readonly day: string;
  readonly fromRunId: number;
  readonly toRunId: number;
  readonly versions: number;
  readonly firstDataTime: Date;
  readonly lastDataTime: Date;
  readonly evidence: string;
}

export type IncidentChange =
  | {
      readonly op: 'open' | 'change';
      readonly sourceId: string;
      readonly id: string;
      readonly kind: string;
      readonly type: string;
      readonly routes: readonly string[];
      readonly fingerprint: string;
      readonly at: Date;
    }
  | {
      readonly op: 'close';
      readonly sourceId: string;
      readonly id: string;
      readonly last: Date;
      readonly at: Date;
    };

/** Everything one pass of the recorder learnt, committed together with the cursor. */
export interface RecorderBatch {
  readonly lastRunId: number;
  readonly sources: readonly SourcePosition[];
  readonly days: readonly DayCount[];
  readonly gaps: readonly GapRecord[];
  readonly incidents: readonly IncidentChange[];
}

const runRowSchema = z.object({
  id: z.number().int().positive(),
  source_id: z.string(),
  version: z.string(),
  data_time: z.string(),
  finished_at: z.string(),
});

const positionRowSchema = z.object({
  source_id: z.string(),
  last_run_id: z.number().int(),
  last_version: z.string(),
  last_data_time: z.string(),
});

const openRowSchema = z.object({
  incident_id: z.string(),
  fingerprint: z.string(),
  first_seen: z.string(),
});
const cursorRowSchema = z.object({ last_run_id: z.number().int().nonnegative() });
const maxRowSchema = z.object({ last: z.number().int().nullable() });

const UPSERT_DAY = `INSERT INTO recorder_days (day, source_id, versions, events, bytes, lost_versions)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (day, source_id) DO UPDATE SET versions = versions + excluded.versions,
  events = events + excluded.events, bytes = bytes + excluded.bytes,
  lost_versions = lost_versions + excluded.lost_versions`;

const UPSERT_SOURCE = `INSERT INTO recorder_sources (source_id, last_run_id, last_version,
  last_data_time, last_written_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (source_id) DO UPDATE SET last_run_id = excluded.last_run_id,
  last_version = excluded.last_version, last_data_time = excluded.last_data_time,
  last_written_at = excluded.last_written_at`;

const INSERT_GAP = `INSERT INTO recorder_gaps (source_id, day, from_run_id, to_run_id, versions,
  first_data_time, last_data_time, evidence, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const recorderStore = {
  async cursor(db: Database): Promise<number | undefined> {
    const row = (await db.query('SELECT last_run_id FROM recorder_cursor WHERE id = 1')).rows[0];
    return row === undefined
      ? undefined
      : parseRow(cursorRowSchema, row, 'recorder_cursor').last_run_id;
  },

  /** Where a new recording starts: after the newest run, so it never reaches back in time. */
  async newestRunId(db: Database): Promise<number> {
    const row = (await db.query('SELECT MAX(id) AS last FROM source_runs')).rows[0];
    return row === undefined ? 0 : (parseRow(maxRowSchema, row, 'source_runs').last ?? 0);
  },

  async startCursor(tx: Transaction, runId: number, now: Date): Promise<void> {
    await tx.execute({
      sql: `INSERT INTO recorder_cursor (id, last_run_id, started_at, updated_at) VALUES (1, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING`,
      args: [runId, toInstant(now), toInstant(now)],
    });
  },

  async admittedRuns(db: Database, afterId: number, limit: number): Promise<AdmittedRun[]> {
    const result = await db.query({
      sql: `SELECT id, source_id, version, data_time, finished_at FROM source_runs
            WHERE id > ? AND outcome = 'admitted' AND version IS NOT NULL AND data_time IS NOT NULL
            ORDER BY id LIMIT ?`,
      args: [afterId, limit],
    });
    return result.rows.map((row) => {
      const parsed = parseRow(runRowSchema, row, 'source_runs');
      return {
        id: parsed.id,
        sourceId: parsed.source_id,
        version: parsed.version,
        dataTime: new Date(parsed.data_time),
        admittedAt: new Date(parsed.finished_at),
      };
    });
  },

  async positions(db: Database): Promise<Map<string, SourcePosition>> {
    const result = await db.query('SELECT * FROM recorder_sources');
    const positions = result.rows.map((row) => {
      const parsed = parseRow(positionRowSchema, row, 'recorder_sources');
      return {
        sourceId: parsed.source_id,
        lastRunId: parsed.last_run_id,
        lastVersion: parsed.last_version,
        lastDataTime: new Date(parsed.last_data_time),
      };
    });
    return new Map(positions.map((position) => [position.sourceId, position]));
  },

  async openIncidents(db: Database, sourceId: string): Promise<OpenIncidents> {
    const result = await db.query({
      sql: `SELECT incident_id, fingerprint, first_seen FROM recorder_incidents
            WHERE source_id = ? AND closed_at IS NULL`,
      args: [sourceId],
    });
    return new Map(
      result.rows.map((row) => {
        const parsed = parseRow(openRowSchema, row, 'recorder_incidents');
        return [
          parsed.incident_id,
          { fingerprint: parsed.fingerprint, since: unixSeconds(parsed.first_seen) },
        ];
      }),
    );
  },

  async commit(tx: Transaction, batch: RecorderBatch, now: Date): Promise<void> {
    const at = toInstant(now);
    await tx.execute({
      sql: 'UPDATE recorder_cursor SET last_run_id = ?, updated_at = ? WHERE id = 1',
      args: [batch.lastRunId, at],
    });
    for (const source of batch.sources) {
      await tx.execute({
        sql: UPSERT_SOURCE,
        args: [
          source.sourceId,
          source.lastRunId,
          source.lastVersion,
          toInstant(source.lastDataTime),
          at,
        ],
      });
    }
    for (const day of batch.days) {
      await tx.execute({
        sql: UPSERT_DAY,
        args: [day.day, day.sourceId, day.versions, day.events, day.bytes, day.lostVersions],
      });
    }
    for (const gap of batch.gaps) {
      await tx.execute({
        sql: INSERT_GAP,
        args: [
          gap.sourceId,
          gap.day,
          gap.fromRunId,
          gap.toRunId,
          gap.versions,
          toInstant(gap.firstDataTime),
          toInstant(gap.lastDataTime),
          gap.evidence,
          at,
        ],
      });
    }
    for (const change of batch.incidents) await writeIncident(tx, change);
  },
};

async function writeIncident(tx: Transaction, change: IncidentChange): Promise<void> {
  if (change.op === 'close') {
    await tx.execute({
      sql: `UPDATE recorder_incidents SET last_seen = ?, closed_at = ?
            WHERE source_id = ? AND incident_id = ? AND closed_at IS NULL`,
      args: [toInstant(change.last), toInstant(change.at), change.sourceId, change.id],
    });
    return;
  }
  const routes = JSON.stringify(change.routes);
  if (change.op === 'change') {
    await tx.execute({
      sql: `UPDATE recorder_incidents SET type = ?, routes = ?, fingerprint = ?
            WHERE source_id = ? AND incident_id = ? AND closed_at IS NULL`,
      args: [change.type, routes, change.fingerprint, change.sourceId, change.id],
    });
    return;
  }
  await tx.execute({
    sql: `INSERT INTO recorder_incidents (source_id, incident_id, first_seen, kind, type, routes,
            fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    args: [
      change.sourceId,
      change.id,
      toInstant(change.at),
      change.kind,
      change.type,
      routes,
      change.fingerprint,
    ],
  });
}
