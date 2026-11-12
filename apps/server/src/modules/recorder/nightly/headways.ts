import type { RecorderMode } from '../extractor.js';
import { bandOf, type Band, type DayType } from './calendar.js';
import { ascending, quantile, tenths } from './statistics.js';
import { timingPassages, type Trajectory } from './trajectories.js';

/** Two vehicles more than two hours apart are a break in service, not a headway. */
const MAX_HEADWAY_SECONDS = 7_200;
/** A headway under a quarter of the usual one means two vehicles running together. */
const BUNCHED_SHARE = 0.25;

export interface HeadwayRow {
  readonly mode: RecorderMode;
  readonly route: string;
  readonly direction: string;
  readonly band: Band;
  readonly dayType: DayType;
  readonly n: number;
  readonly p50: number;
  readonly p90: number;
  readonly sum: number;
  readonly sumSquares: number;
  readonly bunched: number;
}

interface Stop {
  readonly mode: RecorderMode;
  readonly route: string;
  readonly direction: string;
  readonly times: number[];
}

function passagesByStop(trajectories: readonly Trajectory[]): Map<string, Stop> {
  const stops = new Map<string, Stop>();
  for (const trajectory of trajectories) {
    const direction = trajectory.direction ?? '';
    for (const passage of timingPassages(trajectory)) {
      if (passage.at === null) continue;
      const key = JSON.stringify([trajectory.mode, trajectory.route, direction, passage.stop]);
      const stop = stops.get(key) ?? {
        mode: trajectory.mode,
        route: trajectory.route,
        direction,
        times: [],
      };
      stop.times.push(passage.at);
      stops.set(key, stop);
    }
  }
  return stops;
}

/**
 * Headways: the time between consecutive vehicles of a line and direction passing the same
 * stop (by their timing passages), grouped by the band of the later one. Regularity is their spread (the coefficient of
 * variation follows from the sums); bunching counts headways under a quarter of the median.
 */
export function headwayRows(trajectories: readonly Trajectory[], dayType: DayType): HeadwayRow[] {
  const groups = new Map<string, { stop: Stop; band: Band; headways: number[] }>();
  for (const stop of passagesByStop(trajectories).values()) {
    const times = ascending(stop.times);
    for (let index = 1; index < times.length; index += 1) {
      const later = times[index] ?? 0;
      const headway = Math.round(later - (times[index - 1] ?? later));
      if (headway <= 0 || headway > MAX_HEADWAY_SECONDS) continue;
      const band = bandOf(new Date(later * 1000));
      const key = JSON.stringify([stop.mode, stop.route, stop.direction, band]);
      const group = groups.get(key) ?? { stop, band, headways: [] };
      group.headways.push(headway);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(({ stop, band, headways }) => {
    const sorted = ascending(headways);
    const p50 = quantile(sorted, 0.5);
    return {
      mode: stop.mode,
      route: stop.route,
      direction: stop.direction,
      band,
      dayType,
      n: sorted.length,
      p50: tenths(p50),
      p90: tenths(quantile(sorted, 0.9)),
      sum: sorted.reduce((total, value) => total + value, 0),
      sumSquares: sorted.reduce((total, value) => total + value * value, 0),
      bunched: sorted.filter((value) => value < BUNCHED_SHARE * p50).length,
    };
  });
}
