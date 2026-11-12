import type {
  EstimationStatistics,
  RecordedDistribution,
} from '../../../src/modules/live/estimation/statistics.js';

/** Measured over the first week of November 2026, as the recorder would give it. */
export function recorded(seconds: readonly number[], n = 40): RecordedDistribution {
  return {
    n,
    from: '2026-11-02T05:00:00.000Z',
    to: '2026-11-09T04:59:00.000Z',
    seconds: [...seconds],
  };
}

/**
 * Run time of a segment written by hand, at levels 0, 5, 10, 25, 50, 75, 90, 95 and 100: from
 * 60 to 140 s, median 100 s, 95th percentile 130 s.
 */
export const RUN_TIME = recorded([60, 70, 80, 90, 100, 110, 120, 130, 140]);

/** An arrival error spread evenly from 10 s early to 10 s late. */
export const EVEN_ERROR = recorded([-10, -9, -8, -5, 0, 5, 8, 9, 10]);

/** A double of the recorder that answers only what it is given. */
export function statisticsWith(answers: {
  readonly runTime?: RecordedDistribution;
  readonly error?: RecordedDistribution;
  readonly p90Meters?: number;
  readonly metersPerSecond?: number;
  readonly n?: number;
}): EstimationStatistics {
  const measured = {
    n: answers.n ?? 40,
    from: '2026-11-02T05:00:00.000Z',
    to: '2026-11-09T04:59:00.000Z',
  };
  return {
    segments: {
      runTime: () => answers.runTime ?? null,
      typicalSpeed: () =>
        answers.metersPerSecond === undefined
          ? null
          : { ...measured, metersPerSecond: answers.metersPerSecond },
    },
    predictions: { forHorizon: () => answers.error ?? null },
    tracking: {
      forAge: () =>
        answers.p90Meters === undefined ? null : { ...measured, p90Meters: answers.p90Meters },
    },
  };
}
