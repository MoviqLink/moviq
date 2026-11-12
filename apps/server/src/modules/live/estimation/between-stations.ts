import type { Point } from '../geo.js';
import { OFF_LINE_METERS } from './gps-plus.js';
import { place, type Line } from './line.js';
import { progress, runTimeBelief } from './run-time.js';
import {
  usableDistribution,
  type EstimationStatistics,
  type RecordedDistribution,
} from './statistics.js';

/**
 * Speeding up out of a station and braking into the next at 1.0 m/s², the metro model of Vektia
 * (`motor-llegadas.js`), whose margin its metro bench of 05/11/2026 found above the error measured.
 */
const SUBWAY_ACCELERATION = 1.0;

/** A stop the train has not left yet, as the operator lists it, with its times in ms. */
export interface ListedStop extends Point {
  readonly id: string;
  readonly name: string;
  readonly arrival: number | null;
  readonly departure: number | null;
}

/** A departure seen between two readings: the stop left, the next one and when it was left. */
export interface Departure {
  readonly from: ListedStop;
  readonly to: string;
  readonly at: number;
}

/** What is kept of a train from one reading to the next. */
export interface TrainMemory {
  /** The first stop of the last reading, which the train had not left, and when it was read. */
  readonly next: ListedStop;
  readonly readAt: number;
  readonly departure: Departure | undefined;
  /** The furthest metres drawn since the last departure: nothing is drawn behind it. */
  readonly drawn: number | undefined;
}

/**
 * Remembers a reading. When the first stop not left changes from A to B, the train left A
 * between the two readings: when the train itself said so (`leftAt`), or else at the departure
 * the operator last gave for A, held inside that window.
 */
export function remember(
  memory: TrainMemory | undefined,
  next: ListedStop,
  readAt: number,
  leftAt?: number,
): TrainMemory {
  if (memory === undefined) return { next, readAt, departure: undefined, drawn: undefined };
  if (readAt < memory.readAt) return memory;
  if (memory.next.id === next.id) return { ...memory, next, readAt };
  const given = leftAt ?? memory.next.departure ?? memory.next.arrival ?? memory.readAt;
  const at = Math.min(readAt, Math.max(memory.readAt, given));
  return { next, readAt, departure: { from: memory.next, to: next.id, at }, drawn: undefined };
}

/**
 * The first stop the train has not left. The operator lists the stops not left, but its B
 * Division feeds keep a stop listed until the train has reached the next one (11/11/2026: 13 s
 * after that arrival, median): a train that reports a station after the first stop listed, on
 * its line, has left that stop for the station, and the station is the stop not left.
 */
export function notLeft(line: Line | undefined, listed: ListedStop, station: ListedStop) {
  if (line === undefined || station.id === listed.id) return listed;
  return segmentOn(line, listed, station) === undefined ? listed : station;
}

/** A train that has taken longer than 95 in 100 recorded runs of its segment. */
export interface StallEvidence {
  readonly elapsedSeconds: number;
  /** The 95th percentile and the median of the recorded run time. */
  readonly usualSeconds: number;
  readonly medianSeconds: number;
  readonly n: number;
  readonly from: string;
  readonly to: string;
}

/**
 * - `recorded-run-time`: the recorded run time of the segment, conditioned on «not arrived yet»;
 * - `recorded-run-time-and-arrival`: the same, weighed with the operator's arrival time;
 * - `predicted-arrival`: no usable recorded run time, so the segment is shared out by the
 *   operator's arrival time, with no margin.
 */
type SegmentMethod = 'recorded-run-time' | 'recorded-run-time-and-arrival' | 'predicted-arrival';

interface SegmentEstimate {
  readonly meters: number;
  /** The wider side of the 10th to 90th percentile around the median, in metres; null unmeasured. */
  readonly marginMeters: number | null;
  readonly method: SegmentMethod;
  readonly stall: StallEvidence | null;
}

interface SegmentInput {
  readonly route: string;
  readonly line: Line;
  readonly departure: Departure;
  /** The stop it is heading to, with the operator's times. */
  readonly next: ListedStop;
  readonly now: number;
  /** When the operator published those times. */
  readonly predictedAt: number;
}

function stallOf(recorded: RecordedDistribution, elapsed: number): StallEvidence | null {
  const usual = recorded.seconds[7] ?? Number.POSITIVE_INFINITY;
  if (!(elapsed > usual)) return null;
  return {
    elapsedSeconds: elapsed,
    usualSeconds: usual,
    medianSeconds: recorded.seconds[4] ?? usual,
    n: recorded.n,
    from: recorded.from,
    to: recorded.to,
  };
}

/** Both stops on the line, the next after the one left; undefined when either is off it. */
function segmentOn(line: Line, from: Point, to: Point) {
  const start = place(line, from);
  const end = place(line, to, start.meters);
  const off = Math.max(start.offsetMeters, end.offsetMeters) > OFF_LINE_METERS;
  return off || end.meters <= start.meters ? undefined : { start: start.meters, end: end.meters };
}

/**
 * Where a train without GPS is between the stop it left and the next: the median of its run
 * time given what is known now, placed on the line with the motion of a run, and the margin
 * from the 10th and 90th percentiles. Undefined when the stops cannot be placed on the line.
 */
export function betweenStations(
  input: SegmentInput,
  statistics: EstimationStatistics,
): SegmentEstimate | undefined {
  const segment = segmentOn(input.line, input.departure.from, input.next);
  if (segment === undefined) return undefined;
  const meters = segment.end - segment.start;
  const elapsed = (input.now - input.departure.at) / 1000;
  const at = new Date(input.now);
  const recorded = usableDistribution(
    statistics.segments.runTime(input.route, input.departure.from.id, input.next.id, at),
  );
  const stall = recorded === null ? null : stallOf(recorded, elapsed);
  const arrival = input.next.arrival ?? input.next.departure;
  const afterDeparture = arrival === null ? null : (arrival - input.departure.at) / 1000;
  const error =
    arrival === null
      ? null
      : usableDistribution(
          statistics.predictions.forHorizon(
            input.route,
            Math.max(0, (arrival - input.predictedAt) / 1000),
          ),
        );
  const belief =
    recorded === null
      ? undefined
      : runTimeBelief(
          recorded,
          elapsed,
          afterDeparture === null || error === null ? null : { afterDeparture, error },
        );
  if (belief !== undefined) {
    const along = (runTime: number) =>
      segment.start + progress(elapsed, runTime, meters, SUBWAY_ACCELERATION);
    const median = along(belief.p50);
    const margin = Math.max(median - along(belief.p90), along(belief.p10) - median);
    return {
      meters: median,
      marginMeters: margin,
      method: belief.withPrediction ? 'recorded-run-time-and-arrival' : 'recorded-run-time',
      stall,
    };
  }
  if (afterDeparture === null) return undefined;
  return {
    meters: segment.start + progress(elapsed, afterDeparture, meters, SUBWAY_ACCELERATION),
    marginMeters: null,
    method: 'predicted-arrival',
    stall,
  };
}
