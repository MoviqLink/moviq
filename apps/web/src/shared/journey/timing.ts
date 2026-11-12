import type { Leg } from '@moviq/contracts';

export type Timing = Leg['timing'];

const rides = (legs: readonly Leg[]): Leg[] => legs.filter((leg) => leg.mode !== 'walk');

/**
 * Where the departure time comes from. Leaving is timed to catch the first vehicle, so its
 * timing is that vehicle's; a trip made only on foot is an estimate.
 */
export function departureTiming(legs: readonly Leg[]): Timing {
  return rides(legs)[0]?.timing ?? 'estimated';
}

/** Where the arrival time comes from: the last vehicle that gets you there, or an estimate. */
export function arrivalTiming(legs: readonly Leg[]): Timing {
  return rides(legs).at(-1)?.timing ?? 'estimated';
}
