import type { InStatement } from '@libsql/client';
import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import type { LeaderTerm } from '../../../infrastructure/jobs/leadership.js';
import { parseRow } from '../../../infrastructure/database/rows.js';
import { shiftDay } from './calendar.js';
import type { HeadwayRow } from './headways.js';
import type { IncidentDurationRow } from './incident-durations.js';
import type { PredictionErrorRow } from './predictions.js';
import type { SegmentRow } from './segments.js';
import type { StoppageRow } from './stoppages.js';
import type { StretchSpeedRow } from './stretch-speeds.js';
import type { TrackingErrorRow } from './tracking-errors.js';

export interface DayAggregates {
  readonly segments: readonly SegmentRow[];
  readonly headways: readonly HeadwayRow[];
  readonly predictions: readonly PredictionErrorRow[];
  readonly stoppages: readonly StoppageRow[];
  readonly incidents: readonly IncidentDurationRow[];
  readonly speeds: readonly StretchSpeedRow[];
  readonly tracking: readonly TrackingErrorRow[];
}

export type NightlyOutcome = 'complete' | 'incomplete' | 'no-recording';

export interface NightlyRecord {
  readonly day: string;
  readonly outcome: NightlyOutcome;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** Days of bus speeds kept, as the detail of segments. */
const SPEED_DAYS = 35;

/** Statements per fenced write, so a large day never holds the write lock for long. */
const CHUNK = 400;

const TABLES = [
  'recorder_segment_times',
  'recorder_headways',
  'recorder_prediction_errors',
  'recorder_stoppages',
  'recorder_incident_durations',
  'recorder_stretch_speeds',
  'recorder_tracking_errors',
] as const;

const at = (seconds: number): string => toInstant(new Date(seconds * 1000));
const fourDecimals = (share: number): number => Math.round(share * 10_000) / 10_000;

type Value = string | number | null;

function inserts(table: string, columns: string, rows: readonly Value[][]): InStatement[] {
  const marks = columns
    .split(',')
    .map(() => '?')
    .join(', ');
  const sql = `INSERT INTO ${table} (${columns}) VALUES (${marks})`;
  return rows.map((args) => ({ sql, args }));
}

const segmentInserts = (day: string, rows: readonly SegmentRow[]) =>
  inserts(
    'recorder_segment_times',
    'day, mode, route, direction, from_stop, to_stop, band, day_type, n, p10, p50, p90, samples',
    rows.map((row) => [
      ...[day, row.mode, row.route, row.direction, row.from, row.to, row.band, row.dayType],
      ...[row.samples.length, row.p10, row.p50, row.p90, JSON.stringify(row.samples)],
    ]),
  );

const headwayInserts = (day: string, rows: readonly HeadwayRow[]) =>
  inserts(
    'recorder_headways',
    'day, mode, route, direction, band, day_type, n, p50, p90, sum, sum_squares, bunched',
    rows.map((row) => [
      ...[day, row.mode, row.route, row.direction, row.band, row.dayType, row.n],
      ...[row.p50, row.p90, row.sum, row.sumSquares, row.bunched],
    ]),
  );

const predictionInserts = (day: string, rows: readonly PredictionErrorRow[]) =>
  inserts(
    'recorder_prediction_errors',
    'day, source_id, horizon_from, horizon_to, n, p50_abs, p90_abs, bias_p50, histogram',
    rows.map((row) => [
      ...[day, row.sourceId, row.horizonFrom, row.horizonTo, row.n],
      ...[row.p50Abs, row.p90Abs, row.biasP50, JSON.stringify(row.histogram)],
    ]),
  );

const stoppageInserts = (day: string, rows: readonly StoppageRow[]) =>
  inserts(
    'recorder_stoppages',
    'day, mode, route, trip, vehicle, started_at, ended_at, seconds, proof',
    rows.map((row) => [
      ...[day, row.mode, row.route, row.trip, row.vehicle, at(row.startedAt), at(row.endedAt)],
      ...[Math.round(row.seconds), JSON.stringify(row.proof)],
    ]),
  );

const incidentInserts = (day: string, rows: readonly IncidentDurationRow[]) =>
  inserts(
    'recorder_incident_durations',
    'day, kind, type, route, n, closed, still_open, p50_seconds, p90_seconds, curve, first_seen, last_seen',
    rows.map(({ curve, ...row }) => [
      ...[day, row.kind, row.type, row.route, curve.n, curve.closed, curve.open, curve.p50],
      curve.p90,
      JSON.stringify(curve.points.map(([seconds, share]) => [seconds, fourDecimals(share)])),
      ...[row.firstSeen, row.lastSeen],
    ]),
  );

/** In the order of the table's key, so its pages fill as they are written. */
const byKey = (a: StretchSpeedRow, b: StretchSpeedRow) =>
  a.route.localeCompare(b.route) ||
  a.stretch.localeCompare(b.stretch) ||
  a.band.localeCompare(b.band);

const speedInserts = (day: string, rows: readonly StretchSpeedRow[]) =>
  inserts(
    'recorder_stretch_speeds',
    'day, mode, route, stretch, band, day_type, n, counts',
    [...rows]
      .sort(byKey)
      .map((row) => [
        ...[day, row.mode, row.route, row.stretch, row.band, row.dayType, row.n],
        JSON.stringify(row.counts),
      ]),
  );

const trackingInserts = (day: string, rows: readonly TrackingErrorRow[]) =>
  inserts(
    'recorder_tracking_errors',
    'day, mode, route, age_from, age_to, n, counts',
    rows.map((row) => [
      ...[day, row.mode, row.route, row.ageFrom, row.ageTo, row.n],
      JSON.stringify(row.counts),
    ]),
  );

function statements(day: string, aggregates: DayAggregates): InStatement[] {
  return [
    ...segmentInserts(day, aggregates.segments),
    ...headwayInserts(day, aggregates.headways),
    ...predictionInserts(day, aggregates.predictions),
    ...stoppageInserts(day, aggregates.stoppages),
    ...incidentInserts(day, aggregates.incidents),
    ...speedInserts(day, aggregates.speeds),
    ...trackingInserts(day, aggregates.tracking),
  ];
}

/**
 * Replaces the aggregates of a day: deletes what an earlier run left, then inserts in chunks.
 * Readers trust a day only once its nightly record exists, which is written last.
 */
export async function replaceAggregates(
  term: LeaderTerm,
  day: string,
  aggregates: DayAggregates,
): Promise<void> {
  await term.fenced(async (tx) => {
    await tx.execute({ sql: 'DELETE FROM recorder_nightly WHERE day = ?', args: [day] });
    for (const table of TABLES)
      await tx.execute({ sql: `DELETE FROM ${table} WHERE day = ?`, args: [day] });
  });
  const all = statements(day, aggregates);
  for (let start = 0; start < all.length; start += CHUNK) {
    const chunk = all.slice(start, start + CHUNK);
    await term.fenced(async (tx) => {
      await tx.batch(chunk);
    });
  }
}

/**
 * Bus speeds are kept for the 35 days the segments keep their samples (the estimator reads 28):
 * some hundred thousand rows a day, 11 MB, would otherwise pile up for good. Returns how many
 * rows were dropped.
 */
export async function dropOldSpeeds(term: LeaderTerm, today: string): Promise<number> {
  const result = await term.fenced((tx) =>
    tx.execute({
      sql: 'DELETE FROM recorder_stretch_speeds WHERE day < ?',
      args: [shiftDay(today, -SPEED_DAYS)],
    }),
  );
  return result.rowsAffected;
}

export async function writeNightly(term: LeaderTerm, record: NightlyRecord): Promise<void> {
  await term.fenced((tx) =>
    tx.execute({
      sql: `INSERT INTO recorder_nightly (day, outcome, started_at, finished_at, detail)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT (day) DO UPDATE SET outcome = excluded.outcome,
            started_at = excluded.started_at, finished_at = excluded.finished_at,
            detail = excluded.detail`,
      args: [
        record.day,
        record.outcome,
        toInstant(record.startedAt),
        toInstant(record.finishedAt),
        JSON.stringify(record.detail),
      ],
    }),
  );
}

const dayRow = z.object({ day: z.string() });

/** The days the nightly process has already reduced. */
export async function reducedDays(db: Database): Promise<Set<string>> {
  const result = await db.query('SELECT day FROM recorder_nightly');
  return new Set(result.rows.map((row) => parseRow(dayRow, row, 'recorder_nightly').day));
}
