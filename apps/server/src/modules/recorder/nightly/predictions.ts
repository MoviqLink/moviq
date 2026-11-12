import type { PredictionEvent } from '../events.js';
import type { RecorderMode } from '../extractor.js';
import { HORIZON_BANDS, horizonBand } from '../extractors/trip-stops.js';
import { quantileOfCounts, tenths, type Counts } from './statistics.js';
import { timingPassages, type Trajectories } from './trajectories.js';

export interface PredictionErrorRow {
  readonly sourceId: string;
  readonly horizonFrom: number;
  readonly horizonTo: number;
  readonly n: number;
  readonly p50Abs: number;
  readonly p90Abs: number;
  readonly biasP50: number;
  /** `[predicted minus observed in seconds, how many]`, sorted. */
  readonly histogram: Counts;
}

/**
 * The error of the provider's predictions: the predicted time minus the observed passage of the
 * same trip at the same stop (arrival on the subway, departure on buses), by the lead the
 * prediction had. Predictions of stops the trip was never timed at are only counted.
 */
export function createPredictionErrors(trajectories: Trajectories) {
  const errors = new Map<string, Map<number, Map<number, number>>>();
  let unmatched = 0;
  return {
    add(sourceId: string, mode: RecorderMode, event: PredictionEvent): void {
      const band = horizonBand(event.p - event.t, HORIZON_BANDS);
      if (band === undefined) return;
      const trajectory = trajectories.find(mode, event.trip);
      const observed =
        trajectory === undefined
          ? undefined
          : timingPassages(trajectory).find((passage) => passage.stop === event.stop)?.at;
      if (observed === undefined || observed === null) {
        unmatched += 1;
        return;
      }
      const error = Math.round(event.p - observed);
      const bySource = errors.get(sourceId) ?? new Map<number, Map<number, number>>();
      const counts = bySource.get(band) ?? new Map<number, number>();
      counts.set(error, (counts.get(error) ?? 0) + 1);
      bySource.set(band, counts);
      errors.set(sourceId, bySource);
    },

    unmatched: () => unmatched,

    rows(): PredictionErrorRow[] {
      return [...errors].flatMap(([sourceId, bands]) =>
        [...bands].map(([band, counts]) => {
          const histogram: Counts = [...counts].sort(([a], [b]) => a - b);
          const absolute: Counts = mergeAbsolute(histogram);
          return {
            sourceId,
            horizonFrom: band === 0 ? 0 : (HORIZON_BANDS[band - 1] ?? 0),
            horizonTo: HORIZON_BANDS[band] ?? 0,
            n: histogram.reduce((total, [, count]) => total + count, 0),
            p50Abs: tenths(quantileOfCounts(absolute, 0.5)),
            p90Abs: tenths(quantileOfCounts(absolute, 0.9)),
            biasP50: tenths(quantileOfCounts(histogram, 0.5)),
            histogram,
          };
        }),
      );
    },
  };
}

/** The counts of the absolute errors, from the counts of the signed ones. */
export function mergeAbsolute(signed: Counts): Counts {
  const counts = new Map<number, number>();
  for (const [error, count] of signed)
    counts.set(Math.abs(error), (counts.get(Math.abs(error)) ?? 0) + count);
  return [...counts].sort(([a], [b]) => a - b);
}
