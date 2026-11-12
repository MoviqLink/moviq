import type { Journey } from '@moviq/contracts';

import type { TripAnswer, TripView } from './load';

/** The list once one trip has answered: a trip the server does not know leaves the list. */
export function settle(
  trips: readonly TripView[],
  id: string,
  answer: TripAnswer,
): readonly TripView[] {
  switch (answer.kind) {
    case 'cancelled':
      return trips;
    case 'gone':
      return trips.filter((trip) => trip.id !== id);
    case 'ready':
      return trips.map((trip) =>
        trip.id === id ? { id, state: 'ready', journey: answer.journey } : trip,
      );
    case 'failed':
      return trips.map((trip) => (trip.id === id ? { id, state: 'failed' } : trip));
  }
}

/** How a trip reads in the list: watched (with its status), finished or cancelled. */
export type TripTone = Journey['watch']['status'] | 'completed' | 'cancelled';

export function toneOf(journey: Journey): TripTone {
  return journey.state === 'watching' ? journey.watch.status : journey.state;
}
