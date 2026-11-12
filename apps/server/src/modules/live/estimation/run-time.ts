import { LEVELS, type RecordedDistribution } from './statistics.js';

/** The cumulative probability of `value` on the piecewise-linear curve through the levels. */
function cumulative(distribution: RecordedDistribution, value: number): number {
  const { seconds } = distribution;
  const first = seconds[0] ?? 0;
  const last = seconds.at(-1) ?? 0;
  if (value < first) return 0;
  if (value >= last) return 1;
  for (let index = 1; index < seconds.length; index += 1) {
    const low = seconds[index - 1] ?? 0;
    const high = seconds[index] ?? 0;
    if (value >= low && value < high) {
      const from = LEVELS[index - 1] ?? 0;
      const to = LEVELS[index] ?? 1;
      return from + ((to - from) * (value - low)) / (high - low);
    }
  }
  return 1;
}

/** The run time of a segment once it is known the train has not arrived after `elapsed` s. */
interface RunTimeBelief {
  /** Seconds from departure at the 10th, 50th and 90th percentiles. */
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  /** Whether the operator's arrival time was weighed in. */
  readonly withPrediction: boolean;
}

/** The operator's arrival time, as seconds after the departure, and its recorded error. */
interface PredictedArrival {
  readonly afterDeparture: number;
  /** Actual minus predicted arrival, in seconds, for predictions made that far ahead. */
  readonly error: RecordedDistribution;
}

/** Seconds of each step of the grid the belief is computed on. */
const STEP_S = 1;

function quantileOf(weights: readonly number[], start: number, level: number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let below = 0;
  for (const [index, weight] of weights.entries()) {
    if (weight > 0 && below + weight >= level * total) {
      return start + (index + (level * total - below) / weight) * STEP_S;
    }
    below += weight;
  }
  return start + weights.length * STEP_S;
}

/**
 * Bayes on a one-second grid: the recorded run time of the segment, conditioned on «not arrived
 * after `elapsed` seconds», times the likelihood of the operator's arrival time given its
 * recorded error. Each step weighs the probability mass of its second under both curves, so a
 * distribution with repeated values needs no density. An arrival time the recorded error cannot
 * explain (no mass left) is left out and said so; undefined when the recorded run time leaves no
 * mass after `elapsed`.
 */
export function runTimeBelief(
  recorded: RecordedDistribution,
  elapsed: number,
  predicted: PredictedArrival | null,
): RunTimeBelief | undefined {
  const longest = recorded.seconds.at(-1) ?? 0;
  if (elapsed >= longest) return undefined;
  const steps = Math.ceil((longest - elapsed) / STEP_S);
  const prior: number[] = [];
  const posterior: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const low = elapsed + step * STEP_S;
    const high = low + STEP_S;
    const mass = cumulative(recorded, high) - cumulative(recorded, low);
    prior.push(mass);
    if (predicted === null) continue;
    const errorLow = low - predicted.afterDeparture;
    const errorHigh = high - predicted.afterDeparture;
    const likelihood =
      cumulative(predicted.error, errorHigh) - cumulative(predicted.error, errorLow);
    posterior.push(mass * likelihood);
  }
  if (!prior.some((mass) => mass > 0)) return undefined;
  const withPrediction = posterior.some((weight) => weight > 0);
  const weights = withPrediction ? posterior : prior;
  return {
    p10: quantileOf(weights, elapsed, 0.1),
    p50: quantileOf(weights, elapsed, 0.5),
    p90: quantileOf(weights, elapsed, 0.9),
    withPrediction,
  };
}

/**
 * Metres covered `elapsed` seconds into a run of `meters` that lasts `runTime` seconds, with the
 * same acceleration out of the station and braking into the next: it speeds up, cruises at the
 * speed that covers the run in time and slows down (Vektia's `runAt`). A run too short for that
 * acceleration is covered speeding up and slowing down only.
 */
export function progress(
  elapsed: number,
  runTime: number,
  meters: number,
  acceleration: number,
): number {
  if (runTime <= 0 || elapsed >= runTime) return meters;
  if (elapsed <= 0) return 0;
  const discriminant = acceleration ** 2 * runTime ** 2 - 4 * acceleration * meters;
  const rate = discriminant >= 0 ? acceleration : (4 * meters) / runTime ** 2;
  const cruise =
    discriminant >= 0 ? (rate * runTime - Math.sqrt(discriminant)) / 2 : (rate * runTime) / 2;
  const ramp = cruise / rate;
  if (elapsed <= ramp) return (rate * elapsed ** 2) / 2;
  const remaining = runTime - elapsed;
  if (remaining <= ramp) return meters - (rate * remaining ** 2) / 2;
  return (rate * ramp ** 2) / 2 + cruise * (elapsed - ramp);
}
