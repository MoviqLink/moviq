import type { RecorderMode } from '../extractor.js';
import type { SegmentRun } from './segments.js';
import { ascending, quantile } from './statistics.js';
import type { HeldReport, Passage, Trajectories } from './trajectories.js';

/** Standing still this long between two stops of a trip is a stoppage. */
const STOPPAGE_SECONDS = 300;
/** A subway segment this much slower than its median of the day is a stoppage on the way. */
const SUBWAY_EXCESS_SECONDS = 300;
/** The median of a segment is trusted for that comparison from this many runs of the day. */
const MIN_RUNS_FOR_TYPICAL = 5;

export interface StoppageRow {
  readonly mode: RecorderMode;
  readonly route: string;
  readonly trip: string;
  readonly vehicle: string | null;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly seconds: number;
  readonly proof: Readonly<Record<string, unknown>>;
}

interface Hold {
  readonly report: HeldReport;
  readonly since: number;
  until: number;
  reports: number;
}

function holdsOf(held: readonly HeldReport[]): Hold[] {
  const holds = new Map<string, Hold>();
  for (const report of held) {
    const key = JSON.stringify([report.mode, report.event.veh, report.event.since]);
    const hold = holds.get(key) ?? { report, since: report.event.since, until: 0, reports: 0 };
    hold.until = Math.max(hold.until, report.event.t);
    hold.reports = Math.max(hold.reports, report.event.n);
    holds.set(key, hold);
  }
  return [...holds.values()];
}

const lastBefore = (passages: readonly Passage[], at: number): Passage | undefined =>
  passages.filter((passage) => passage.at !== null && passage.at <= at).at(-1);

const firstAfter = (passages: readonly Passage[], at: number): Passage | undefined =>
  passages.find((passage) => passage.at !== null && passage.at >= at);

/**
 * A vehicle that kept reporting the same place for five minutes or more, after leaving one stop
 * of its trip and before leaving another. Waiting at a terminal is not a stoppage: there the
 * trip has not left a stop yet, or never leaves another.
 */
export function heldStoppages(trajectories: Pick<Trajectories, 'held' | 'find'>): StoppageRow[] {
  return holdsOf(trajectories.held()).flatMap((hold) => {
    const seconds = hold.until - hold.since;
    if (seconds < STOPPAGE_SECONDS) return [];
    const { mode, event } = hold.report;
    const trajectory = trajectories.find(mode, event.trip);
    if (trajectory === undefined) return [];
    const before = lastBefore(trajectory.departures, hold.since);
    const after = firstAfter(trajectory.departures, hold.until);
    if (before === undefined || after === undefined) return [];
    return [
      {
        mode,
        route: trajectory.route,
        trip: trajectory.trip,
        vehicle: event.veh,
        startedAt: hold.since,
        endedAt: hold.until,
        seconds,
        proof: {
          rule: 'same place for 5 minutes or more between two stops of the trip',
          latitude: event.lat,
          longitude: event.lon,
          reports: hold.reports,
          leftBefore: { stop: before.stop, at: before.at },
          leftAfter: { stop: after.stop, at: after.at },
        },
      },
    ];
  });
}

/**
 * The subway has no GPS: a stoppage shows as a segment that took five minutes or more beyond
 * its median of the day, measured over enough runs of that segment.
 */
export function slowSegmentStoppages(runs: readonly SegmentRun[]): StoppageRow[] {
  const bySegment = new Map<string, SegmentRun[]>();
  for (const run of runs) {
    if (run.trajectory.mode !== 'subway') continue;
    const key = JSON.stringify([run.trajectory.route, run.from.stop, run.to.stop]);
    bySegment.set(key, [...(bySegment.get(key) ?? []), run]);
  }
  return [...bySegment.values()].flatMap((segment) => {
    if (segment.length < MIN_RUNS_FOR_TYPICAL) return [];
    const typical = quantile(ascending(segment.map((run) => run.seconds)), 0.5);
    return segment
      .filter((run) => run.seconds - typical >= SUBWAY_EXCESS_SECONDS)
      .map((run) => ({
        mode: run.trajectory.mode,
        route: run.trajectory.route,
        trip: run.trajectory.trip,
        vehicle: run.trajectory.vehicle,
        startedAt: run.from.at ?? run.from.hi,
        endedAt: run.to.at ?? run.to.hi,
        seconds: run.seconds,
        proof: {
          rule: 'segment 5 minutes or more slower than its median of the day',
          from: run.from.stop,
          to: run.to.stop,
          typicalSeconds: typical,
          runsThatDay: segment.length,
        },
      }));
  });
}
