import { instantSchema, type VehicleMode } from '@moviq/contracts';
import { z } from 'zod';

import type { Line } from './line.js';

/**
 * The probabilities at which a recorded distribution is given: the least value measured, the
 * quantiles 5, 10, 25, 50, 75, 90 and 95 and the greatest value measured.
 */
export const LEVELS = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 1] as const;

/**
 * A figure with fewer measurements than this is not shown and not used, the rule Vektia's
 * `docs/precision.md` set for each cell of its margin tables.
 */
const MIN_MEASUREMENTS = 20;

const measured = {
  /** How many measurements the figure comes from. */
  n: z.number().int().positive(),
  /** The first and the last moment measured. */
  from: instantSchema,
  to: instantSchema,
};

const nonDecreasing = (values: readonly number[]) =>
  values.every((value, index) => index === 0 || value >= (values[index - 1] ?? value));

const recordedDistributionSchema = z.object({
  ...measured,
  /** Seconds at each of `LEVELS`, never decreasing. */
  seconds: z.array(z.number()).length(LEVELS.length).refine(nonDecreasing),
});

const recordedSpeedSchema = z.object({
  ...measured,
  metersPerSecond: z.number().nonnegative(),
});

const recordedMarginSchema = z.object({
  ...measured,
  /** Nine in ten measured errors were smaller than this. */
  p90Meters: z.number().nonnegative(),
});

export type RecordedDistribution = z.infer<typeof recordedDistributionSchema>;
export type RecordedSpeed = z.infer<typeof recordedSpeedSchema>;
export type RecordedMargin = z.infer<typeof recordedMarginSchema>;

/** What the recorder measured on the lines, for the day type and the hour of `at`. */
interface SegmentStatistics {
  /** Seconds from leaving stop `from` to arriving at stop `to`, the next one, on `route`. */
  runTime(route: string, from: string, to: string, at: Date): RecordedDistribution | null;
  /** The typical speed of `route` on the stretch of its shape `meters` along `line`. */
  typicalSpeed(route: string, line: Line, meters: number, at: Date): RecordedSpeed | null;
}

/** How wrong the operator's arrival times were, measured against the arrivals recorded. */
interface PredictionErrors {
  /** Actual minus predicted arrival, in seconds, for predictions made `horizonSeconds` ahead. */
  forHorizon(route: string, horizonSeconds: number): RecordedDistribution | null;
}

/** How far MovIQ's own estimates were from the next GPS report, measured by the recorder. */
interface TrackingErrors {
  /** For a `gps-plus` position drawn `ageSeconds` after the last GPS report. */
  forAge(mode: VehicleMode, route: string, ageSeconds: number): RecordedMargin | null;
}

/** Everything the estimator asks the recorder; null in any answer means «not measured yet». */
export interface EstimationStatistics {
  readonly segments: SegmentStatistics;
  readonly predictions: PredictionErrors;
  readonly tracking: TrackingErrors;
}

/** The recorder before it has measured anything: every answer is «not measured yet». */
export const noStatistics: EstimationStatistics = {
  segments: { runTime: () => null, typicalSpeed: () => null },
  predictions: { forHorizon: () => null },
  tracking: { forAge: () => null },
};

/**
 * An answer of the recorder checked before it is used: one that does not match its shape, or
 * with fewer than `MIN_MEASUREMENTS`, counts as not measured.
 */
function usable<T extends { readonly n: number }>(schema: z.ZodType<T>, answer: unknown): T | null {
  if (answer === null) return null;
  const parsed = schema.safeParse(answer);
  return parsed.success && parsed.data.n >= MIN_MEASUREMENTS ? parsed.data : null;
}

export const usableDistribution = (answer: RecordedDistribution | null) =>
  usable(recordedDistributionSchema, answer);
export const usableSpeed = (answer: RecordedSpeed | null) => usable(recordedSpeedSchema, answer);
export const usableMargin = (answer: RecordedMargin | null) => usable(recordedMarginSchema, answer);
