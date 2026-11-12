import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { Database } from '../../../infrastructure/database/database.js';
import type { LeaderTerm } from '../../../infrastructure/jobs/leadership.js';
import type { SourceDefinition } from '../../data-platform/definition.js';
import type { Extractor, RecorderMode } from '../extractor.js';
import { reducedFile, sourceFilesOfDay, writeLines, type HourFile } from '../files.js';
import { replaceAggregates, writeNightly, type NightlyOutcome } from './aggregates-store.js';
import { createBusMeasures, replayedLine } from './bus-measures.js';
import { dayTypeOf } from './calendar.js';
import { judgeDay } from './completeness.js';
import { emptyStats, kind, sourceEvents, type ReadStats } from './day-reader.js';
import { headwayRows } from './headways.js';
import { incidentDurations } from './incident-durations.js';
import { createPredictionErrors } from './predictions.js';
import { segmentRows, segmentRuns } from './segments.js';
import { heldStoppages, slowSegmentStoppages } from './stoppages.js';
import { createTrajectories, type Trajectories, type Trajectory } from './trajectories.js';

export interface ReduceDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly directory: string;
  readonly definitions: readonly SourceDefinition[];
  readonly extractors: readonly Extractor[];
}

interface Recorded {
  readonly sourceId: string;
  readonly mode: RecorderMode | null;
  readonly files: readonly HourFile[];
}

type BusMeasures = ReturnType<typeof createBusMeasures>;

/** First pass: versions seen per hour, the trajectories of every trip and the bus speeds. */
async function readTrips(recorded: readonly Recorded[], stats: ReadStats, buses: BusMeasures) {
  const trajectories = createTrajectories();
  const hours = new Map<string, Set<string>>();
  const skipPredictions = (line: string) => !kind('pred')(line);
  for (const { sourceId, mode, files } of recorded) {
    const seen = new Set<string>();
    hours.set(sourceId, seen);
    for await (const { hour, event } of sourceEvents(files, stats, skipPredictions)) {
      if (event.k === 'version') seen.add(hour);
      else if (mode !== null) trajectories.add(mode, event);
      if (mode === 'bus') buses.add(sourceId, event);
    }
  }
  return { trajectories, hours };
}

const isPrediction = kind('pred');
const busReplay = (line: string) => isPrediction(line) || replayedLine(line);

/**
 * Second pass: each sampled prediction against the passage observed, and the bus reports again,
 * replayed through the estimator with the speeds of the first pass.
 */
async function judgePredictions(
  recorded: readonly Recorded[],
  trajectories: Trajectories,
  stats: ReadStats,
  buses: BusMeasures,
) {
  const errors = createPredictionErrors(trajectories);
  buses.replay();
  for (const { sourceId, mode, files } of recorded) {
    if (mode === null) continue;
    for await (const { event } of sourceEvents(
      files,
      stats,
      mode === 'bus' ? busReplay : isPrediction,
    ))
      if (event.k === 'pred') errors.add(sourceId, mode, event);
      else if (mode === 'bus') buses.add(sourceId, event);
  }
  return errors;
}

/** The reduced copy of a day: one line per trip with its passages, as Vektia keeps beside the raw one. */
function trajectoryLines(trajectories: readonly Trajectory[]): Iterable<string> {
  return trajectories.map((trajectory) =>
    JSON.stringify({
      mode: trajectory.mode,
      trip: trajectory.trip,
      route: trajectory.route,
      dir: trajectory.direction,
      veh: trajectory.vehicle,
      gps: trajectory.gpsReports,
      dep: trajectory.departures.map((p) => [p.stop, p.at, p.lo, p.hi]),
      arr: trajectory.arrivals.map((p) => [p.stop, p.at, p.lo, p.hi]),
      left: trajectory.leaves.map((p) => [p.stop, p.at]),
    }),
  );
}

/**
 * Reduces one New York day: rebuilds the trajectories, measures segments, headways, prediction
 * errors and stoppages, updates incident durations, and says whether the day was whole. Nothing
 * missing is filled in: an incomplete day is reduced from what was recorded and marked so.
 */
export async function reduceDay(
  term: LeaderTerm,
  deps: ReduceDependencies,
  day: string,
): Promise<NightlyOutcome> {
  const startedAt = deps.clock.now();
  const files = await sourceFilesOfDay(deps.directory, day);
  const recordable = deps.definitions.filter((definition) =>
    deps.extractors.some((extractor) => extractor.sourceId === definition.id),
  );
  if (files.size === 0) {
    const detail = { reason: 'Nothing was recorded that day.', judged: recordable.length };
    await writeNightly(term, {
      day,
      outcome: 'no-recording',
      startedAt,
      finishedAt: deps.clock.now(),
      detail,
    });
    return 'no-recording';
  }
  const recorded: Recorded[] = deps.extractors.flatMap((extractor) => {
    const found = files.get(extractor.sourceId);
    return found === undefined
      ? []
      : [{ sourceId: extractor.sourceId, mode: extractor.mode, files: found }];
  });
  const stats = emptyStats();
  const dayType = dayTypeOf(day);
  const buses = createBusMeasures(dayType);
  const { trajectories, hours } = await readTrips(recorded, stats, buses);
  // The second pass reads the same files again: only the lines it parses add to what was invalid.
  const second = emptyStats();
  const errors = await judgePredictions(recorded, trajectories, second, buses);
  stats.invalid += second.invalid;
  const speeds = [...buses.speeds(Number.POSITIVE_INFINITY)].flat();
  const tracking = buses.tracking();
  const all = trajectories.all();
  const runs = all.flatMap(segmentRuns);
  const aggregates = {
    segments: segmentRows(runs, dayType),
    headways: headwayRows(all, dayType),
    predictions: errors.rows(),
    stoppages: [...heldStoppages(trajectories), ...slowSegmentStoppages(runs)],
    incidents: await incidentDurations(deps.db, day),
    speeds,
    tracking,
  };
  const completeness = await judgeDay(deps.db, day, recordable, hours);
  await writeLines(reducedFile(deps.directory, day, 'trajectories'), trajectoryLines(all));
  await replaceAggregates(term, day, aggregates);
  const outcome = completeness.complete ? 'complete' : 'incomplete';
  const detail = {
    completeness,
    counts: {
      trajectories: all.length,
      segmentRuns: runs.length,
      predictionsJudged: aggregates.predictions.reduce((total, row) => total + row.n, 0),
      predictionsUnmatched: errors.unmatched(),
      stoppages: aggregates.stoppages.length,
      stretchSpeeds: speeds.length,
      trackingJudged: tracking.reduce((total, row) => total + row.n, 0),
    },
    read: stats,
  };
  await writeNightly(term, { day, outcome, startedAt, finishedAt: deps.clock.now(), detail });
  return outcome;
}
