import type { RecorderMode } from '../extractor.js';
import { bandOf, type Band, type DayType } from './calendar.js';
import { ascending, quantile, tenths } from './statistics.js';
import type { Passage, Trajectory } from './trajectories.js';

/** A segment slower than an hour is a trip that stopped being followed, not a run time. */
const MAX_SEGMENT_SECONDS = 3_600;

export interface SegmentRow {
  readonly mode: RecorderMode;
  readonly route: string;
  readonly direction: string;
  readonly from: string;
  readonly to: string;
  readonly band: Band;
  readonly dayType: DayType;
  readonly samples: readonly number[];
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export interface SegmentRun {
  readonly trajectory: Trajectory;
  readonly from: Passage;
  readonly to: Passage;
  readonly seconds: number;
}

const runOf = (trajectory: Trajectory, from: Passage, to: Passage): SegmentRun | undefined => {
  if (from.at === null || to.at === null) return undefined;
  const seconds = Math.round(to.at - from.at);
  return seconds > 0 && seconds <= MAX_SEGMENT_SECONDS
    ? { trajectory, from, to, seconds }
    : undefined;
};

/** Buses: from one timed departure to the next, the stop it named next, so the dwell is in. */
function busRuns(trajectory: Trajectory): SegmentRun[] {
  const runs: SegmentRun[] = [];
  const timed = trajectory.departures.filter((passage) => passage.at !== null);
  for (const [index, to] of timed.entries()) {
    const from = timed[index - 1];
    const run = from?.next === to.stop ? runOf(trajectory, from, to) : undefined;
    if (run !== undefined) runs.push(run);
  }
  return runs;
}

/**
 * Subway: from leaving a stop to arriving at the next, as the estimator counts a run. The
 * departure is when the train first reported itself no longer stopped there; without that
 * report, the time the feed gave for the stop when it was dropped, if it fell inside the window
 * it was dropped in (`exact`): the B Division keeps a stop listed until the train reached the
 * next one, so a dropped stop there is never exact. The arrival is the train stopped at the next.
 */
function subwayRuns(trajectory: Trajectory): SegmentRun[] {
  const left = new Map<string, Passage>();
  for (const passage of trajectory.leaves)
    if (!left.has(passage.stop)) left.set(passage.stop, passage);
  for (const passage of trajectory.departures)
    if (passage.exact && passage.next !== null && !left.has(passage.stop))
      left.set(passage.stop, passage);
  const arrivals = new Map(trajectory.arrivals.map((passage) => [passage.stop, passage]));
  return [...left.values()].flatMap((from) => {
    const to = from.next === null ? undefined : arrivals.get(from.next);
    const run = to === undefined ? undefined : runOf(trajectory, from, to);
    return run === undefined ? [] : [run];
  });
}

/**
 * Runs between consecutive stops of one trip: departure to departure on buses (Bus Time gives
 * no arrivals), departure to arrival on the subway. Both passages must be timed and adjacent.
 */
export function segmentRuns(trajectory: Trajectory): SegmentRun[] {
  return trajectory.mode === 'subway' ? subwayRuns(trajectory) : busRuns(trajectory);
}

const keyOf = (run: SegmentRun, band: Band): string =>
  JSON.stringify([run.trajectory.mode, run.trajectory.route, run.from.stop, run.to.stop, band]);

/** The distribution of each segment for the day, by band, with every sample kept. */
export function segmentRows(runs: readonly SegmentRun[], dayType: DayType): SegmentRow[] {
  const groups = new Map<string, { first: SegmentRun; band: Band; samples: number[] }>();
  for (const run of runs) {
    if (run.from.at === null) continue;
    const band = bandOf(new Date(run.from.at * 1000));
    const key = keyOf(run, band);
    const group = groups.get(key) ?? { first: run, band, samples: [] };
    group.samples.push(run.seconds);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ first, band, samples }) => {
    const sorted = ascending(samples);
    return {
      mode: first.trajectory.mode,
      route: first.trajectory.route,
      direction: first.trajectory.direction ?? '',
      from: first.from.stop,
      to: first.to.stop,
      band,
      dayType,
      samples: sorted,
      p10: tenths(quantile(sorted, 0.1)),
      p50: tenths(quantile(sorted, 0.5)),
      p90: tenths(quantile(sorted, 0.9)),
    };
  });
}
