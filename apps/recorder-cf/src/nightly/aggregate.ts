import { RECORDER_STATS_VERSION, toInstant, type RecorderStats } from '@moviq/contracts';

import { LEVELS } from '../../../server/src/modules/live/estimation/statistics.js';
import type { CloseEvent, IncidentEvent } from '../../../server/src/modules/recorder/events.js';
import { hoursOfDay, type DayType } from '../../../server/src/modules/recorder/nightly/calendar.js';
import { headwayRows } from '../../../server/src/modules/recorder/nightly/headways.js';
import { ALL_ROUTES } from '../../../server/src/modules/recorder/nightly/incident-durations.js';
import type { createPredictionErrors } from '../../../server/src/modules/recorder/nightly/predictions.js';
import {
  segmentRows,
  type SegmentRun,
} from '../../../server/src/modules/recorder/nightly/segments.js';
import {
  quantile,
  quantileOfCounts,
  tenths,
  type Counts,
} from '../../../server/src/modules/recorder/nightly/statistics.js';
import {
  heldStoppages,
  slowSegmentStoppages,
  type StoppageRow,
} from '../../../server/src/modules/recorder/nightly/stoppages.js';
import {
  kaplanMeier,
  type Duration,
} from '../../../server/src/modules/recorder/nightly/survival.js';
import type { StretchSpeedRow } from '../../../server/src/modules/recorder/nightly/stretch-speeds.js';
import type { TrackingErrorRow } from '../../../server/src/modules/recorder/nightly/tracking-errors.js';
import type {
  Trajectories,
  Trajectory,
} from '../../../server/src/modules/recorder/nightly/trajectories.js';
import type { DayCount } from '../state.js';

/** The incidents of a day as their events tell: opened, changed, closed. */
export interface IncidentLog {
  readonly opened: Map<string, IncidentEvent>;
  readonly closed: Map<string, CloseEvent>;
}

export const emptyIncidentLog = (): IncidentLog => ({ opened: new Map(), closed: new Map() });

/** The rows of a day, filled line by line in batches that each fit in one alarm. */
export interface DayRows {
  readonly segments: RecorderStats['segments'];
  readonly headways: RecorderStats['headways'];
  readonly stoppages: RecorderStats['stoppages'];
  segmentRuns: number;
}

export const emptyRows = (): DayRows => ({
  segments: [],
  headways: [],
  stoppages: [],
  segmentRuns: 0,
});

type Levels = [number, number, number, number, number, number, number, number, number];

/** Values at the nine `LEVELS` the estimator reads, to a tenth. */
const levelsOf = (at: (level: number) => number): Levels => {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = LEVELS.map((level) =>
    tenths(at(level)),
  );
  return [a, b, c, d, e, f, g, h, i];
};

/**
 * A stretch moved over fewer times in the day is not published: the estimator uses no speed of
 * fewer than 20 moves, and a day of the city has about a hundred thousand stretches.
 */
const MIN_MOVES = 20;

/** The stretches measured 20 times or more, as published: their median speed. */
export const speedTuples = (rows: readonly StretchSpeedRow[]): RecorderStats['speeds'] =>
  rows
    .filter((row) => row.n >= MIN_MOVES)
    .map((row) => [
      row.route,
      row.stretch,
      row.band,
      row.n,
      tenths(quantileOfCounts(row.counts, 0.5)),
    ]);

const ofCounts = (counts: Counts) => levelsOf((level) => quantileOfCounts(counts, level));

const stoppageTuple = (row: StoppageRow): RecorderStats['stoppages'][number] => [
  row.mode,
  row.route,
  row.trip,
  row.vehicle,
  row.startedAt,
  row.endedAt,
  row.seconds,
  String(row.proof['rule']),
];

/**
 * The segments and slow subway segments that start at some stops (all, without `stops`).
 * Segments are grouped by their stops, so measuring them stop group by stop group gives the
 * rows of the whole day.
 */
export function addSegments(
  rows: DayRows,
  runs: readonly SegmentRun[],
  stops: ReadonlySet<string> | undefined,
  dayType: DayType,
): void {
  const mine = stops === undefined ? runs : runs.filter((run) => stops.has(run.from.stop));
  rows.segmentRuns += mine.length;
  for (const row of segmentRows(mine, dayType))
    rows.segments.push([
      row.mode,
      row.route,
      row.direction,
      row.from,
      row.to,
      row.band,
      row.samples.length,
      ...levelsOf((level) => quantile(row.samples, level)),
    ]);
  rows.stoppages.push(...slowSegmentStoppages(mine).map(stoppageTuple));
}

/** The headways of whole lines: each row joins every stop of a line, direction and band. */
export function addHeadways(rows: DayRows, trips: readonly Trajectory[], dayType: DayType): void {
  for (const row of headwayRows(trips, dayType))
    rows.headways.push([
      row.mode,
      row.route,
      row.direction,
      row.band,
      row.n,
      row.p50,
      row.p90,
      row.sum,
      row.sumSquares,
      row.bunched,
    ]);
}

/** Vehicles held between two stops of their trip. */
export function addHolds(rows: DayRows, holds: Pick<Trajectories, 'held' | 'find'>): void {
  rows.stoppages.push(...heldStoppages(holds).map(stoppageTuple));
}

/** Durations by kind, type and line: closed ones from first to last seen, open ones censored. */
function incidentRows(log: IncidentLog, endOfDay: number): RecorderStats['incidents'] {
  const groups = new Map<
    string,
    { kind: string; type: string; route: string; items: Duration[] }
  >();
  for (const [id, incident] of log.opened) {
    const close = log.closed.get(id);
    const duration: Duration =
      close === undefined
        ? { seconds: Math.max(0, endOfDay - incident.t), closed: false }
        : { seconds: Math.max(0, close.last - incident.t), closed: true };
    for (const route of [ALL_ROUTES, ...incident.routes]) {
      const key = JSON.stringify([incident.kind, incident.type, route]);
      const group = groups.get(key) ?? {
        kind: incident.kind,
        type: incident.type,
        route,
        items: [],
      };
      group.items.push(duration);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(({ kind, type, route, items }) => {
    const curve = kaplanMeier(items);
    return [kind, type, route, curve.n, curve.closed, curve.open, curve.p50, curve.p90];
  });
}

export interface FinishInput {
  readonly day: string;
  readonly dayType: DayType;
  readonly endOfDay: number;
  readonly rows: DayRows;
  readonly trajectories: Trajectories;
  readonly errors: ReturnType<typeof createPredictionErrors>;
  readonly incidents: IncidentLog;
  readonly speeds: RecorderStats['speeds'];
  readonly tracking: readonly TrackingErrorRow[];
  readonly counts: Readonly<Record<string, DayCount>>;
  readonly recordedSources: readonly string[];
  readonly events: number;
  readonly now: Date;
}

/** The last step: prediction errors, incidents and coverage. */
export function finishDay(input: FinishInput): RecorderStats {
  const predictions = input.errors.rows();
  const hours = hoursOfDay(input.day).map(({ hour }) => hour);
  const coverage = input.recordedSources.flatMap((sourceId) => {
    const count = input.counts[sourceId];
    const missingHours = hours.filter((hour) => count?.hours.includes(hour) !== true);
    const rejected = count?.rejected ?? 0;
    const failed = count?.failed ?? 0;
    return missingHours.length === 0 && rejected === 0 && failed === 0
      ? []
      : [{ sourceId, missingHours, rejected, failed }];
  });
  return {
    version: RECORDER_STATS_VERSION,
    day: input.day,
    dayType: input.dayType,
    generatedAt: toInstant(input.now),
    complete: coverage.every((source) => source.missingHours.length === 0),
    coverage,
    counts: {
      events: input.events,
      trajectories: input.trajectories.unsorted().length,
      segmentRuns: input.rows.segmentRuns,
      predictionsJudged: predictions.reduce((total, row) => total + row.n, 0),
      predictionsUnmatched: input.errors.unmatched(),
    },
    segments: input.rows.segments,
    headways: input.rows.headways,
    predictions: predictions.map((row) => [
      row.sourceId,
      row.horizonFrom,
      row.horizonTo,
      row.n,
      ...ofCounts(row.histogram),
    ]),
    stoppages: input.rows.stoppages,
    incidents: incidentRows(input.incidents, input.endOfDay),
    speeds: input.speeds,
    tracking: input.tracking.map((row) => [
      row.route,
      row.ageFrom,
      row.ageTo,
      row.n,
      quantileOfCounts(row.counts, 0.9),
    ]),
  };
}
