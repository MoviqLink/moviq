import { z } from 'zod';

import { parseRow } from '../../infrastructure/database/rows.js';
import { jsonColumn } from './json-column.js';
import type { Band, DayType } from './nightly/calendar.js';
import { mergeCounts, quantileOfCounts, tenths, type Counts } from './nightly/statistics.js';
import {
  REDUCED_DAYS,
  provenanceOf,
  windowOf,
  type Reading,
  type ReadingDependencies,
} from './reading.js';

/** One stretch of one bus route, for one band and kind of day, as the nightly process keys it. */
export interface StretchKey {
  readonly route: string;
  readonly stretch: string;
  readonly band: Band;
  readonly dayType: DayType;
}

/** The replayed error of `gps-plus` positions of one route, by band of age, in metres. */
export interface TrackingError {
  readonly route: string;
  readonly ageFrom: number;
  readonly ageTo: number;
  /** Nine in ten errors measured were at most this, in metres. */
  readonly p90Meters: number;
}

const dayInfo = { day: z.string(), outcome: z.enum(['complete', 'incomplete']) };
const counts = jsonColumn(z.array(z.tuple([z.number(), z.number().int().positive()])));
const speedRow = z.object({ ...dayInfo, counts });
const trackingRow = z.object({
  ...dayInfo,
  route: z.string(),
  age_from: z.number().int().nonnegative(),
  age_to: z.number().int().positive(),
  counts,
});

const total = (merged: Counts) => merged.reduce((sum, [, count]) => sum + count, 0);

/**
 * The median speed of buses of a route on a stretch over the days of the window, every move
 * merged, in metres a second.
 */
export async function stretchSpeed(
  deps: ReadingDependencies,
  key: StretchKey,
): Promise<Reading<number>> {
  const window = windowOf(deps);
  const result = await deps.db.query({
    sql: `SELECT t.day, n.outcome, t.counts FROM recorder_stretch_speeds t ${REDUCED_DAYS}
          WHERE t.route = ? AND t.stretch = ? AND t.band = ? AND t.day_type = ?
            AND t.mode = 'bus' AND t.day >= ? AND t.day < ?`,
    args: [key.route, key.stretch, key.band, key.dayType, window.from, window.until],
  });
  const rows = result.rows.map((row) => parseRow(speedRow, row, 'recorder_stretch_speeds'));
  const merged = mergeCounts(rows.map((row) => row.counts));
  if (merged.length === 0)
    return { status: 'no-data', n: 0, reason: 'No bus of this route was measured here then.' };
  return provenanceOf(rows, total(merged), tenths(quantileOfCounts(merged, 0.5)));
}

/**
 * The replayed error of every bus route measured, by band of age, over the days of the window,
 * of every kind: the estimator asks by age alone.
 */
export async function trackingErrors(deps: ReadingDependencies): Promise<Reading<TrackingError>[]> {
  const window = windowOf(deps);
  const result = await deps.db.query({
    sql: `SELECT t.day, n.outcome, t.route, t.age_from, t.age_to, t.counts
          FROM recorder_tracking_errors t ${REDUCED_DAYS}
          WHERE t.mode = 'bus' AND t.day >= ? AND t.day < ?`,
    args: [window.from, window.until],
  });
  const rows = result.rows.map((row) => parseRow(trackingRow, row, 'recorder_tracking_errors'));
  const groups = Map.groupBy(rows, (row) => JSON.stringify([row.route, row.age_from]));
  return [...groups.values()].flatMap((group) => {
    const first = group[0];
    if (first === undefined) return [];
    const merged = mergeCounts(group.map((row) => row.counts));
    return [
      provenanceOf(group, total(merged), {
        route: first.route,
        ageFrom: first.age_from,
        ageTo: first.age_to,
        p90Meters: quantileOfCounts(merged, 0.9),
      }),
    ];
  });
}
