import type { Journey, Place, RestroomsNearResponse } from '@moviq/contracts';
import { useEffect, useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { useNow } from '../../../shared/time/clock';
import { tripApi } from '../api';
import { restroomQuery, restroomStops } from '../model/restrooms';

export type RestroomsView =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly retry: () => void }
  | {
      readonly kind: 'ready';
      readonly answer: RestroomsNearResponse;
      readonly stops: readonly Place[];
    };

type Loaded =
  | { readonly query: string; readonly failed: true }
  | { readonly query: string; readonly failed: false; readonly answer: RestroomsNearResponse };

/**
 * The public restrooms near the trip's next stops, asked once for each set of stops: again only
 * when a leg ends or the trip changes, or when the traveller asks after a failure.
 */
export function useRestrooms(journey: Journey): RestroomsView {
  const now = useNow();
  const stops = restroomStops(journey, now);
  const stepFree = journey.request.preferences.stepFree;
  const query = stops.length === 0 ? null : restroomQuery(stops, stepFree);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    tripApi.restrooms(query, controller.signal).then(
      (answer) => {
        setLoaded({ query, failed: false, answer });
      },
      (error: unknown) => {
        if (error instanceof ApiRequestError && error.failure.kind === 'aborted') return;
        setLoaded({ query, failed: true });
      },
    );
    return () => {
      controller.abort();
    };
  }, [query, attempt]);

  if (query === null) return { kind: 'none' };
  if (loaded?.query !== query) return { kind: 'loading' };
  if (loaded.failed) {
    return {
      kind: 'failed',
      retry: () => {
        setLoaded(null);
        setAttempt((count) => count + 1);
      },
    };
  }
  // The query is made of these very stops, so the answer's indexes point into them.
  return { kind: 'ready', answer: loaded.answer, stops };
}
