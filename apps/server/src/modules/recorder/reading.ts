import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import { HORIZON_BANDS, horizonBand } from './extractors/trip-stops.js';
import { jsonColumn } from './json-column.js';
import { bandOf, dayOf, dayTypeOf, shiftDay, type Band, type DayType } from './nightly/calendar.js';
import { mergeAbsolute } from './nightly/predictions.js';
import {
  ascending,
  mergeCounts,
  quantile,
  quantileOfCounts,
  tenths,
} from './nightly/statistics.js';

/** A figure measured by MovIQ, with how many measures it rests on and from which days. */
interface Measured<T> {
  readonly status: 'ok';
  readonly value: T;
  readonly n: number;
  /** First and last New York day with measures, and how many days had some. */
  readonly from: string;
  readonly to: string;
  readonly days: number;
  /** Days among them that were not recorded whole; their figures are what was recorded. */
  readonly incompleteDays: readonly string[];
}

/** Not enough measures: there is no figure, and none is made up. */
interface NoData {
  readonly status: 'no-data';
  readonly n: number;
  readonly reason: string;
}

export type Reading<T> = Measured<T> | NoData;

/** Seconds from leaving one stop to leaving the next, for the band and kind of day asked. */
interface RunTimeQuantiles {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly band: Band;
  readonly dayType: DayType;
}

/** Absolute error of the provider's predicted time, in seconds, and its median signed bias. */
interface ErrorQuantiles {
  readonly p50: number;
  readonly p90: number;
  readonly biasP50: number;
  readonly horizonFrom: number;
  readonly horizonTo: number;
}

/** One month of a segment kept for good, once its days left the detail window. */
interface MonthlyRunTime extends RunTimeQuantiles {
  readonly month: string;
  readonly n: number;
  readonly days: number;
  readonly from: string;
  readonly to: string;
}

export interface SegmentStats {
  runTime(route: string, from: string, to: string, at: Date): Promise<Reading<RunTimeQuantiles>>;
  /** Past months of the same band and kind of day, oldest first; empty when there are none. */
  history(route: string, from: string, to: string, at: Date): Promise<readonly MonthlyRunTime[]>;
}

export interface PredictionError {
  forHorizon(source: string, horizonSeconds: number): Promise<Reading<ErrorQuantiles>>;
}

export interface ReadingDependencies {
  readonly db: Database;
  readonly clock: Clock;
  /** Days looked back, ending yesterday. */
  readonly windowDays?: number;
}

const READING_WINDOW_DAYS = 28;
/** Fewer measures than this give no figure, as in Vektia's tables of margins. */
const MIN_MEASURES = 20;

/** The days a reading may use: reduced, in the window, ending yesterday. */
export function windowOf(deps: ReadingDependencies): { from: string; until: string } {
  const today = dayOf(deps.clock.now());
  return { from: shiftDay(today, -(deps.windowDays ?? READING_WINDOW_DAYS)), until: today };
}

const dayInfo = { day: z.string(), outcome: z.enum(['complete', 'incomplete']) };

/** What the days of a set of rows say about where the measures come from. */
export function provenanceOf<T>(
  rows: readonly { readonly day: string; readonly outcome: 'complete' | 'incomplete' }[],
  n: number,
  value: T,
): Reading<T> {
  if (n < MIN_MEASURES)
    return {
      status: 'no-data',
      n,
      reason: `Only ${String(n)} measures; ${String(MIN_MEASURES)} are needed.`,
    };
  const days = [...new Set(rows.map((row) => row.day))].sort();
  const incomplete = new Set(
    rows.filter((row) => row.outcome === 'incomplete').map((row) => row.day),
  );
  return {
    status: 'ok',
    value,
    n,
    from: days[0] ?? '',
    to: days.at(-1) ?? '',
    days: days.length,
    incompleteDays: [...incomplete].sort(),
  };
}

export const REDUCED_DAYS = `JOIN recorder_nightly n ON n.day = t.day
  AND n.outcome IN ('complete', 'incomplete')`;

const segmentRow = z.object({ ...dayInfo, samples: jsonColumn(z.array(z.number())) });
const monthRow = z.object({
  month: z.string(),
  n: z.number().int().positive(),
  p10: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  days: z.number().int().positive(),
  first_day: z.string(),
  last_day: z.string(),
});

/** Run times of each segment, merged over the days of the window, sample by sample. */
export function createSegmentStats(deps: ReadingDependencies): SegmentStats {
  return {
    async runTime(route, from, to, at) {
      const band = bandOf(at);
      const dayType = dayTypeOf(dayOf(at));
      const window = windowOf(deps);
      const result = await deps.db.query({
        sql: `SELECT t.day, n.outcome, t.samples FROM recorder_segment_times t ${REDUCED_DAYS}
              WHERE t.route = ? AND t.from_stop = ? AND t.to_stop = ? AND t.band = ?
                AND t.day_type = ? AND t.day >= ? AND t.day < ?`,
        args: [route, from, to, band, dayType, window.from, window.until],
      });
      const rows = result.rows.map((row) => parseRow(segmentRow, row, 'recorder_segment_times'));
      const samples = ascending(rows.flatMap((row) => row.samples));
      if (samples.length === 0)
        return { status: 'no-data', n: 0, reason: 'This segment was not measured at this time.' };
      const value = {
        p10: tenths(quantile(samples, 0.1)),
        p50: tenths(quantile(samples, 0.5)),
        p90: tenths(quantile(samples, 0.9)),
        p95: tenths(quantile(samples, 0.95)),
        band,
        dayType,
      };
      return provenanceOf(rows, samples.length, value);
    },

    async history(route, from, to, at) {
      const band = bandOf(at);
      const dayType = dayTypeOf(dayOf(at));
      const result = await deps.db.query({
        sql: `SELECT month, n, p10, p50, p90, p95, days, first_day, last_day
              FROM recorder_segment_months WHERE route = ? AND from_stop = ? AND to_stop = ?
                AND band = ? AND day_type = ? ORDER BY month`,
        args: [route, from, to, band, dayType],
      });
      return result.rows.map((row) => {
        const parsed = parseRow(monthRow, row, 'recorder_segment_months');
        const { month, n, p10, p50, p90, p95, days } = parsed;
        return {
          month,
          n,
          p10,
          p50,
          p90,
          p95,
          days,
          from: parsed.first_day,
          to: parsed.last_day,
          band,
          dayType,
        };
      });
    },
  };
}

const errorRow = z.object({
  ...dayInfo,
  histogram: jsonColumn(z.array(z.tuple([z.number(), z.number().int().positive()]))),
});

/** The error of a source's predictions for a lead time, merged over the days of the window. */
export function createPredictionError(deps: ReadingDependencies): PredictionError {
  return {
    async forHorizon(source, horizonSeconds) {
      const band = horizonBand(horizonSeconds, HORIZON_BANDS);
      if (band === undefined)
        return { status: 'no-data', n: 0, reason: 'No prediction is measured at that lead time.' };
      const horizonFrom = band === 0 ? 0 : (HORIZON_BANDS[band - 1] ?? 0);
      const horizonTo = HORIZON_BANDS[band] ?? 0;
      const window = windowOf(deps);
      const result = await deps.db.query({
        sql: `SELECT t.day, n.outcome, t.histogram FROM recorder_prediction_errors t ${REDUCED_DAYS}
              WHERE t.source_id = ? AND t.horizon_from = ? AND t.day >= ? AND t.day < ?`,
        args: [source, horizonFrom, window.from, window.until],
      });
      const rows = result.rows.map((row) => parseRow(errorRow, row, 'recorder_prediction_errors'));
      const signed = mergeCounts(rows.map((row) => row.histogram));
      const n = signed.reduce((total, [, count]) => total + count, 0);
      if (n === 0)
        return { status: 'no-data', n: 0, reason: 'These predictions were not measured yet.' };
      const absolute = mergeAbsolute(signed);
      const value = {
        p50: tenths(quantileOfCounts(absolute, 0.5)),
        p90: tenths(quantileOfCounts(absolute, 0.9)),
        biasP50: tenths(quantileOfCounts(signed, 0.5)),
        horizonFrom,
        horizonTo,
      };
      return provenanceOf(rows, n, value);
    },
  };
}
