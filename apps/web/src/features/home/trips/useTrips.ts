import { useCallback, useEffect, useState } from 'react';

import { loadTrip, type TripView } from './load';
import { settle } from './model';
import { savedTrips } from './saved';

const loading = (id: string): TripView => ({ id, state: 'loading' });

/**
 * The trips started in this browser, each asked for to the server by its id, newest first. A trip
 * the server no longer gives to this traveller is forgotten; one that cannot be read now says so.
 */
export function useTrips(): { trips: readonly TripView[]; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [trips, setTrips] = useState<readonly TripView[]>(() => savedTrips.list().map(loading));

  useEffect(() => {
    const controller = new AbortController();
    for (const id of savedTrips.list()) {
      void loadTrip(id, controller.signal).then((answer) => {
        if (answer.kind === 'gone') savedTrips.forget(id);
        setTrips((current) => settle(current, id, answer));
      });
    }
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setTrips((current) =>
      current.map((trip) => (trip.state === 'failed' ? loading(trip.id) : trip)),
    );
    setAttempt((count) => count + 1);
  }, []);

  return { trips, retry };
}
