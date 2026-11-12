import type { DayType } from '../../../server/src/modules/recorder/nightly/calendar.js';
import {
  segmentRuns,
  type SegmentRun,
} from '../../../server/src/modules/recorder/nightly/segments.js';
import {
  sortPassages,
  type HeldReport,
  type Trajectories,
  type Trajectory,
} from '../../../server/src/modules/recorder/nightly/trajectories.js';
import { addHeadways, addHolds, addSegments, emptyRows, type DayRows } from './aggregate.js';

/** Passages measured per step: the CPU guard measures the largest step against its budget. */
const PASSAGES_PER_STEP = 3_000;

const passages = (trip: Trajectory): number => trip.arrivals.length + trip.departures.length;
const tripKey = (mode: string, trip: string) => `${mode}\u0000${trip}`;

interface Batch {
  readonly trips: readonly Trajectory[];
  /** The stops whose segments this step measures: all of them without a set. */
  readonly stops: ReadonlySet<string> | undefined;
  /** Whether this step measures the headways and holds of its lines. */
  readonly whole: boolean;
}

/** The stops of a busy line, in groups of about `PASSAGES_PER_STEP` passages. */
function stopGroups(trips: readonly Trajectory[]): Set<string>[] {
  const counts = new Map<string, number>();
  for (const trip of trips)
    for (const passage of [...trip.arrivals, ...trip.departures])
      counts.set(passage.stop, (counts.get(passage.stop) ?? 0) + 1);
  const groups: Set<string>[] = [];
  let current = new Set<string>();
  let size = 0;
  for (const [stop, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    if (size > 0 && size + count > PASSAGES_PER_STEP) {
      groups.push(current);
      current = new Set();
      size = 0;
    }
    current.add(stop);
    size += count;
  }
  if (current.size > 0) groups.push(current);
  return groups;
}

/**
 * The lines of a day, by direction, in steps of about `PASSAGES_PER_STEP` passages. Segments,
 * headways and stoppages are grouped within a line and direction, and segments also by their
 * stops: a step with a few small lines, or with the segments of some stops of a busy one, gives
 * the same rows as the whole day at once; a busy line ends with a step for its headways and
 * holds. Passages are sorted as each line is reached.
 */
export function createLineBatches(trajectories: Trajectories, dayType: DayType) {
  const byLine = new Map<string, Trajectory[]>();
  const held = new Map<string, HeldReport[]>();
  for (const trip of trajectories.unsorted()) {
    const key = JSON.stringify([trip.mode, trip.route, trip.direction]);
    const trips = byLine.get(key) ?? [];
    trips.push(trip);
    byLine.set(key, trips);
  }
  for (const report of trajectories.held()) {
    const key = tripKey(report.mode, report.event.trip);
    held.set(key, [...(held.get(key) ?? []), report]);
  }
  const lines = [...byLine.values()];
  const pending: Batch[] = [];
  const rows: DayRows = emptyRows();
  let index = 0;
  let runs: { readonly trips: readonly Trajectory[]; readonly runs: SegmentRun[] } | undefined;

  /** The next steps: whole small lines together, or a busy line stop group by stop group. */
  const plan = () => {
    const trips: Trajectory[] = [];
    let count = 0;
    while (index < lines.length) {
      const line = lines[index] ?? [];
      const size = line.reduce((total, trip) => total + passages(trip), 0);
      if (trips.length > 0 && count + size > PASSAGES_PER_STEP) break;
      index += 1;
      for (const trip of line) sortPassages(trip);
      if (size > PASSAGES_PER_STEP) {
        for (const stops of stopGroups(line)) pending.push({ trips: line, stops, whole: false });
        pending.push({ trips: line, stops: new Set(), whole: true });
        return;
      }
      trips.push(...line);
      count += size;
    }
    if (trips.length > 0) pending.push({ trips, stops: undefined, whole: true });
  };

  return {
    rows,
    /** Measures the next step; false once every line is measured. */
    next(): boolean {
      if (pending.length === 0) plan();
      const batch = pending.shift();
      if (batch !== undefined) {
        if (runs?.trips !== batch.trips)
          runs = { trips: batch.trips, runs: batch.trips.flatMap(segmentRuns) };
        if (batch.stops?.size !== 0) addSegments(rows, runs.runs, batch.stops, dayType);
        if (batch.whole) {
          addHeadways(rows, batch.trips, dayType);
          const reports = batch.trips.flatMap(
            (trip) => held.get(tripKey(trip.mode, trip.trip)) ?? [],
          );
          addHolds(rows, {
            held: () => reports,
            find: (mode, trip) => trajectories.find(mode, trip),
          });
        }
      }
      return pending.length > 0 || index < lines.length;
    },
  };
}
