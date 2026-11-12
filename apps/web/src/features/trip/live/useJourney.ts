import { journeySchema, type Journey } from '@moviq/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiRequestError, type ApiFailure } from '../../../shared/api/errors';
import { createLatest } from '../../../shared/api/latest';
import { tripApi } from '../api';
import { createLiveFeed, type FeedDeps, type FeedStatus } from './feed';

export interface JourneyView {
  readonly journey: Journey | null;
  /** When the last good snapshot arrived, by the browser clock. */
  readonly receivedAt: number | null;
  readonly load: 'loading' | 'ready' | 'not-found' | 'failed';
  /** Why the last request for the journey failed, or null. */
  readonly failure: ApiFailure | null;
  readonly feed: FeedStatus;
  /** Live updates refused because they did not match the contract. */
  readonly rejected: number;
  /** Asks the server for the journey again and opens a new live connection now. */
  readonly reconnect: () => void;
  /** Shows a journey the server just answered with, such as after taking an alternative. */
  readonly replace: (journey: Journey) => void;
}

type Inner = Omit<JourneyView, 'reconnect' | 'replace'> & { readonly bug: Error | null };

const initial: Inner = {
  journey: null,
  receivedAt: null,
  load: 'loading',
  failure: null,
  feed: { kind: 'connecting' },
  rejected: 0,
  bug: null,
};

const browserDeps: FeedDeps = {
  open: (url) => new EventSource(url),
  now: () => Date.now(),
  setTimer: (run, ms) => {
    const timer = window.setTimeout(run, ms);
    return () => {
      window.clearTimeout(timer);
    };
  },
};

/**
 * The journey `id` as the server has it: one request on open, then every live snapshot. Use it in
 * a component keyed by the id, so nothing of another journey survives a change of address.
 */
export function useJourney(id: string): JourneyView {
  const [state, setState] = useState<Inner>(initial);
  const latest = useRef(createLatest());
  const feed = useRef<ReturnType<typeof createLiveFeed<Journey>> | null>(null);

  const received = useCallback((journey: Journey) => {
    setState((s) => ({ ...s, journey, receivedAt: Date.now(), load: 'ready', failure: null }));
  }, []);

  const fetchJourney = useCallback(async () => {
    const signal = latest.current.next();
    try {
      received(await tripApi.journey(id, signal));
    } catch (error) {
      if (!(error instanceof ApiRequestError)) {
        const bug = error instanceof Error ? error : new Error(String(error));
        setState((s) => ({ ...s, bug }));
        return;
      }
      if (error.failure.kind === 'aborted') return;
      if (error.code === 'not_found') feed.current?.stop();
      const load = error.code === 'not_found' ? 'not-found' : 'failed';
      const failure = error.failure;
      setState((s) => ({ ...s, load: s.journey === null ? load : s.load, failure }));
    }
  }, [id, received]);

  useEffect(() => {
    const requests = latest.current;
    const live = createLiveFeed(tripApi.eventsUrl(id), journeySchema, browserDeps, {
      onData: received,
      onStatus: (status) => {
        setState((s) => ({ ...s, feed: status }));
      },
      onRejected: () => {
        setState((s) => ({ ...s, rejected: s.rejected + 1 }));
      },
    });
    feed.current = live;
    void fetchJourney();
    live.start();
    return () => {
      live.stop();
      requests.cancel();
    };
  }, [id, fetchJourney, received]);

  // A programming error reaches the error boundary instead of failing silently.
  if (state.bug !== null) throw state.bug;
  return {
    ...state,
    replace: received,
    reconnect: () => {
      feed.current?.reconnect();
      void fetchJourney();
    },
  };
}
