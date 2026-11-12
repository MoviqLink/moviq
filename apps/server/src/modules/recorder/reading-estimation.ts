import { z } from 'zod';

import { parseRow } from '../../infrastructure/database/rows.js';
import type { RecorderMode } from './extractor.js';
import { HORIZON_BANDS } from './extractors/trip-stops.js';
import { jsonColumn } from './json-column.js';
import type { Band, DayType } from './nightly/calendar.js';
import {
  ascending,
  mergeCounts,
  quantile,
  quantileOfCounts,
  tenths,
} from './nightly/statistics.js';
import {
  REDUCED_DAYS,
  provenanceOf,
  windowOf,
  type Reading,
  type ReadingDependencies,
} from './reading.js';

/** One segment of a line, for one band and kind of day, as the nightly process keys it. */
export interface SegmentKey {
  readonly mode: RecorderMode;
  readonly route: string;
  readonly from: string;
  readonly to: string;
  readonly band: Band;
  readonly dayType: DayType;
}

/** The provider's error for one band of lead time, at each probability asked for. */
interface ErrorDistribution {
  readonly sourceId: string;
  readonly horizonFrom: number;
  readonly horizonTo: number;
  /** Observed minus predicted time, in seconds, at each level. */
  readonly seconds: readonly number[];
}

const dayInfo = { day: z.string(), outcome: z.enum(['complete', 'incomplete']) };
const segmentRow = z.object({ ...dayInfo, samples: jsonColumn(z.array(z.number())) });
const errorRow = z.object({
  ...dayInfo,
  source_id: z.string(),
  horizon_from: z.number().int().nonnegative(),
  histogram: jsonColumn(z.array(z.tuple([z.number(), z.number().int().positive()]))),
});

/**
 * The run times of a segment over the days of the window, every sample merged, at each of
 * `levels` (type 7 quantiles: level 0 is the least run measured and level 1 the greatest).
 */
export async function segmentDistribution(
  deps: ReadingDependencies,
  key: SegmentKey,
  levels: readonly number[],
): Promise<Reading<readonly number[]>> {
  const window = windowOf(deps);
  const result = await deps.db.query({
    sql: `SELECT t.day, n.outcome, t.samples FROM recorder_segment_times t ${REDUCED_DAYS}
          WHERE t.route = ? AND t.from_stop = ? AND t.to_stop = ? AND t.band = ?
            AND t.day_type = ? AND t.mode = ? AND t.day >= ? AND t.day < ?`,
    args: [key.route, key.from, key.to, key.band, key.dayType, key.mode, window.from, window.until],
  });
  const rows = result.rows.map((row) => parseRow(segmentRow, row, 'recorder_segment_times'));
  const samples = ascending(rows.flatMap((row) => row.samples));
  if (samples.length === 0)
    return { status: 'no-data', n: 0, reason: 'This segment was not measured at this time.' };
  return provenanceOf(
    rows,
    samples.length,
    levels.map((level) => tenths(quantile(samples, level))),
  );
}

const marks = (count: number) => Array.from({ length: count }, () => '?').join(', ');

/**
 * The error of each source's predictions over the days of the window, by band of lead time, at
 * each of `levels`. The nightly process keeps predicted minus observed; this gives the other
 * sign, observed minus predicted, the way an arrival time is corrected.
 */
export async function predictionErrorDistributions(
  deps: ReadingDependencies,
  sourceIds: readonly string[],
  levels: readonly number[],
): Promise<Reading<ErrorDistribution>[]> {
  if (sourceIds.length === 0) return [];
  const window = windowOf(deps);
  const result = await deps.db.query({
    sql: `SELECT t.day, n.outcome, t.source_id, t.horizon_from, t.histogram
          FROM recorder_prediction_errors t ${REDUCED_DAYS}
          WHERE t.source_id IN (${marks(sourceIds.length)}) AND t.day >= ? AND t.day < ?`,
    args: [...sourceIds, window.from, window.until],
  });
  const rows = result.rows.map((row) => parseRow(errorRow, row, 'recorder_prediction_errors'));
  const groups = Map.groupBy(rows, (row) => JSON.stringify([row.source_id, row.horizon_from]));
  return [...groups.values()].flatMap((group) => {
    const first = group[0];
    const index = HORIZON_BANDS.findIndex((upper) => upper > (first?.horizon_from ?? 0));
    if (first === undefined || index === -1) return [];
    const observedMinusPredicted = mergeCounts(
      group.map((row) => row.histogram.map(([error, count]) => [-error, count] as const)),
    );
    const n = observedMinusPredicted.reduce((total, [, count]) => total + count, 0);
    return [
      provenanceOf(group, n, {
        sourceId: first.source_id,
        horizonFrom: first.horizon_from,
        horizonTo: HORIZON_BANDS[index] ?? first.horizon_from,
        seconds: levels.map((level) => tenths(quantileOfCounts(observedMinusPredicted, level))),
      }),
    ];
  });
}
