import { z } from 'zod';

import { parseRow } from '../../infrastructure/database/rows.js';
import { jsonColumn } from './json-column.js';
import { bandOf, dayOf, dayTypeOf, shiftDay, type Band, type DayType } from './nightly/calendar.js';
import { ALL_ROUTES, INCIDENT_WINDOW_DAYS } from './nightly/incident-durations.js';
import {
  REDUCED_DAYS,
  provenanceOf,
  windowOf,
  type Reading,
  type ReadingDependencies,
} from './reading.js';

/** How regular a line runs at a band and kind of day, from its headways at every stop. */
interface LineRegularity {
  readonly meanHeadwaySeconds: number;
  /** Standard deviation over mean of the headways: 0 is perfectly even. */
  readonly coefficientOfVariation: number;
  /** Share of headways under a quarter of the usual one: vehicles running together. */
  readonly bunchedShare: number;
  /** Stoppages observed on the line in that band over the same days. */
  readonly stoppages: number;
  readonly band: Band;
  readonly dayType: DayType;
}

interface IncidentDuration {
  readonly p50Seconds: number;
  readonly p90Seconds: number | null;
  readonly closed: number;
  readonly open: number;
  /** `[seconds, share still open]`, the Kaplan–Meier curve. */
  readonly curve: readonly (readonly [number, number])[];
}

export interface LineReliability {
  at(route: string, at: Date): Promise<Reading<LineRegularity>>;
}

export interface IncidentDurations {
  typical(kind: string, type: string, route?: string): Promise<Reading<IncidentDuration>>;
}

/** Incidents needed before a typical duration is given. */
const MIN_INCIDENTS = 10;

const headwayRow = z.object({
  day: z.string(),
  outcome: z.enum(['complete', 'incomplete']),
  n: z.number().int().positive(),
  sum: z.number(),
  sum_squares: z.number(),
  bunched: z.number().int().nonnegative(),
});

const stoppageRow = z.object({ started_at: z.string() });

/** Regularity and bunching pooled over the days of the window, exactly, from their sums. */
export function createLineReliability(deps: ReadingDependencies): LineReliability {
  return {
    async at(route, at) {
      const band = bandOf(at);
      const dayType = dayTypeOf(dayOf(at));
      const window = windowOf(deps);
      const result = await deps.db.query({
        sql: `SELECT t.day, n.outcome, t.n, t.sum, t.sum_squares, t.bunched
              FROM recorder_headways t ${REDUCED_DAYS}
              WHERE t.route = ? AND t.band = ? AND t.day_type = ? AND t.day >= ? AND t.day < ?`,
        args: [route, band, dayType, window.from, window.until],
      });
      const rows = result.rows.map((row) => parseRow(headwayRow, row, 'recorder_headways'));
      const n = rows.reduce((total, row) => total + row.n, 0);
      if (n === 0)
        return { status: 'no-data', n: 0, reason: 'This line was not measured at this time.' };
      const mean = rows.reduce((total, row) => total + row.sum, 0) / n;
      const meanSquare = rows.reduce((total, row) => total + row.sum_squares, 0) / n;
      const stoppages = await deps.db.query({
        sql: `SELECT t.started_at FROM recorder_stoppages t ${REDUCED_DAYS}
              WHERE t.route = ? AND t.day >= ? AND t.day < ?`,
        args: [route, window.from, window.until],
      });
      const inBand = stoppages.rows
        .map((row) => parseRow(stoppageRow, row, 'recorder_stoppages'))
        .filter((row) => bandOf(new Date(row.started_at)) === band).length;
      const value = {
        meanHeadwaySeconds: Math.round(mean * 10) / 10,
        coefficientOfVariation:
          Math.round((Math.sqrt(Math.max(0, meanSquare - mean * mean)) / mean) * 1000) / 1000,
        bunchedShare:
          Math.round((rows.reduce((total, row) => total + row.bunched, 0) / n) * 1000) / 1000,
        stoppages: inBand,
        band,
        dayType,
      };
      return provenanceOf(rows, n, value);
    },
  };
}

const durationRow = z.object({
  day: z.string(),
  n: z.number().int().positive(),
  closed: z.number().int().nonnegative(),
  still_open: z.number().int().nonnegative(),
  p50_seconds: z.number().nullable(),
  p90_seconds: z.number().nullable(),
  curve: jsonColumn(z.array(z.tuple([z.number(), z.number()]))),
  first_seen: z.string(),
  last_seen: z.string(),
});

const nightRow = z.object({ day: z.string(), outcome: z.enum(['complete', 'incomplete']) });

/** The nights reduced within the window of incidents that ends on `day`. */
async function nightsUpTo(deps: ReadingDependencies, day: string) {
  const result = await deps.db.query({
    sql: `SELECT day, outcome FROM recorder_nightly
          WHERE outcome IN ('complete', 'incomplete') AND day > ? AND day <= ?`,
    args: [shiftDay(day, -INCIDENT_WINDOW_DAYS), day],
  });
  return result.rows.map((row) => parseRow(nightRow, row, 'recorder_nightly'));
}

/** How long incidents of a kind and type last on a line, from the latest night's curve. */
export function createIncidentDurations(deps: ReadingDependencies): IncidentDurations {
  return {
    async typical(kind, type, route = ALL_ROUTES) {
      const result = await deps.db.query({
        sql: `SELECT t.* FROM recorder_incident_durations t ${REDUCED_DAYS}
              WHERE t.kind = ? AND t.type = ? AND t.route = ? ORDER BY t.day DESC LIMIT 1`,
        args: [kind, type, route],
      });
      const found = result.rows[0];
      if (found === undefined)
        return { status: 'no-data', n: 0, reason: 'No incident of this kind was recorded.' };
      const row = parseRow(durationRow, found, 'recorder_incident_durations');
      if (row.closed < MIN_INCIDENTS || row.p50_seconds === null)
        return {
          status: 'no-data',
          n: row.n,
          reason:
            `Only ${String(row.closed)} of ${String(row.n)} have ended; ` +
            `${String(MIN_INCIDENTS)} are needed and half of them.`,
        };
      const nights = await nightsUpTo(deps, row.day);
      return {
        status: 'ok',
        value: {
          p50Seconds: row.p50_seconds,
          p90Seconds: row.p90_seconds,
          closed: row.closed,
          open: row.still_open,
          curve: row.curve,
        },
        n: row.n,
        from: dayOf(new Date(row.first_seen)),
        to: dayOf(new Date(row.last_seen)),
        days: nights.length,
        incompleteDays: nights
          .filter((night) => night.outcome === 'incomplete')
          .map((night) => night.day)
          .sort(),
      };
    },
  };
}
