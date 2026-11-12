import type { InStatement } from '@libsql/client';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import { parseRow } from '../../../infrastructure/database/rows.js';
import type { LeaderTerm } from '../../../infrastructure/jobs/leadership.js';
import { jsonColumn } from '../json-column.js';
import { shiftDay } from './calendar.js';
import { ascending, quantile, tenths } from './statistics.js';

/**
 * Days of segment samples kept one by one: more than the 28 read by the estimator. Measured on
 * 11/11/2026, buses give about one row per sample, some 20 MB a day; a month folded is one row
 * per segment, band and kind of day.
 */
const SEGMENT_DETAIL_DAYS = 35;

const routeRow = z.object({ route: z.string() });
const dayRow = z.object({
  day: z.string(),
  mode: z.string(),
  direction: z.string(),
  from_stop: z.string(),
  to_stop: z.string(),
  band: z.string(),
  day_type: z.string(),
  samples: jsonColumn(z.array(z.number())),
});
type DayRow = z.infer<typeof dayRow>;

const monthRow = z.object({ month: z.string() });

interface MonthGroup {
  readonly first: DayRow;
  readonly samples: number[];
  readonly days: Set<string>;
}

function monthStatement(month: string, route: string, group: MonthGroup): InStatement {
  const sorted = ascending(group.samples);
  const days = [...group.days].sort();
  const { first } = group;
  return {
    sql: `INSERT INTO recorder_segment_months (month, mode, route, direction, from_stop, to_stop,
            band, day_type, n, p10, p50, p90, p95, days, first_day, last_day)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      ...[month, first.mode, route, first.direction, first.from_stop, first.to_stop, first.band],
      ...[first.day_type, sorted.length, tenths(quantile(sorted, 0.1))],
      ...[tenths(quantile(sorted, 0.5)), tenths(quantile(sorted, 0.9))],
      ...[tenths(quantile(sorted, 0.95)), days.length, days[0] ?? '', days.at(-1) ?? ''],
    ],
  };
}

/** Folds the days of one route in one month into monthly rows, and deletes those days. */
async function foldRoute(term: LeaderTerm, db: Database, month: string, route: string) {
  const result = await db.query({
    sql: `SELECT day, mode, direction, from_stop, to_stop, band, day_type, samples
          FROM recorder_segment_times WHERE route = ? AND day >= ? AND day < ?`,
    args: [route, `${month}-01`, `${month}-32`],
  });
  const groups = new Map<string, MonthGroup>();
  for (const row of result.rows) {
    const parsed = parseRow(dayRow, row, 'recorder_segment_times');
    const key = JSON.stringify([
      parsed.mode,
      parsed.from_stop,
      parsed.to_stop,
      parsed.band,
      parsed.day_type,
    ]);
    const group = groups.get(key) ?? { first: parsed, samples: [], days: new Set<string>() };
    group.samples.push(...parsed.samples);
    group.days.add(parsed.day);
    groups.set(key, group);
  }
  const statements = [...groups.values()].map((group) => monthStatement(month, route, group));
  await term.fenced(async (tx) => {
    await tx.batch(statements);
    await tx.execute({
      sql: 'DELETE FROM recorder_segment_times WHERE route = ? AND day >= ? AND day < ?',
      args: [route, `${month}-01`, `${month}-32`],
    });
  });
}

/**
 * Folds every whole month older than the detail window, one route at a time, so memory and
 * write locks stay small. A route folded is gone from the days, so a fold stopped half-way
 * carries on with the routes left.
 */
export async function foldSegmentMonths(
  term: LeaderTerm,
  db: Database,
  today: string,
): Promise<string[]> {
  const firstKept = `${shiftDay(today, -SEGMENT_DETAIL_DAYS).slice(0, 7)}-01`;
  const months = await db.query({
    sql: 'SELECT DISTINCT substr(day, 1, 7) AS month FROM recorder_segment_times WHERE day < ?',
    args: [firstKept],
  });
  const folded = months.rows.map((row) => parseRow(monthRow, row, 'recorder_segment_times').month);
  for (const month of folded) {
    const routes = await db.query({
      sql: 'SELECT DISTINCT route FROM recorder_segment_times WHERE day >= ? AND day < ?',
      args: [`${month}-01`, `${month}-32`],
    });
    for (const row of routes.rows)
      await foldRoute(term, db, month, parseRow(routeRow, row, 'recorder_segment_times').route);
  }
  return folded.sort();
}
