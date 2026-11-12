import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiFailure } from '../../shared/api/errors';
import { ApiRequestError } from '../../shared/api/errors';
import { createLatest } from '../../shared/api/latest';
import { useSession } from './session';

const POLL_MS = 15_000;

export interface Resource<T> {
  /** The last good answer, kept while later requests fail, so the screen shows it with its age. */
  readonly data: T | null;
  /** When the last good answer arrived, by the browser clock. */
  readonly receivedAt: number | null;
  /** Why the latest request failed, or null if it succeeded. */
  readonly failure: ApiFailure | null;
  readonly loading: boolean;
  /** Asks again now, cancelling any request in flight. */
  readonly reload: () => void;
}

interface State<T> {
  readonly key: string;
  readonly data: T | null;
  readonly receivedAt: number | null;
  readonly failure: ApiFailure | null;
  readonly loading: boolean;
  readonly bug: Error | null;
}

const empty = <T>(key: string): State<T> => ({
  key,
  data: null,
  receivedAt: null,
  failure: null,
  loading: true,
  bug: null,
});

/**
 * Loads one API resource for a screen and keeps it current: asks on open and every 15 s while the
 * page is visible, keeps only the newest answer, and sends a lapsed session back to sign-in.
 */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> {
  const { expire } = useSession();
  const [state, setState] = useState<State<T>>(() => empty(key));
  const loadRef = useRef(load);
  const latest = useRef(createLatest());

  useEffect(() => {
    loadRef.current = load;
  });

  // Every state change happens after the answer, so starting a request never renders by itself.
  const run = useCallback(async () => {
    const signal = latest.current.next();
    try {
      const data = await loadRef.current(signal);
      setState({ key, data, receivedAt: Date.now(), failure: null, loading: false, bug: null });
    } catch (error) {
      if (!(error instanceof ApiRequestError)) {
        const bug = error instanceof Error ? error : new Error(String(error));
        setState((previous) => ({ ...previous, bug }));
        return;
      }
      if (error.failure.kind === 'aborted') return;
      if (error.code === 'unauthorized') {
        expire();
        return;
      }
      const failure = error.failure;
      setState((previous) => ({
        ...(previous.key === key ? previous : empty<T>(key)),
        failure,
        loading: false,
      }));
    }
  }, [key, expire]);

  useEffect(() => {
    const current = latest.current;
    void run();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      current.cancel();
    };
  }, [run]);

  // A programming error surfaces in the screen's error boundary instead of failing silently.
  if (state.bug !== null) throw state.bug;
  const own = state.key === key ? state : empty<T>(key);
  return {
    data: own.data,
    receivedAt: own.receivedAt,
    failure: own.failure,
    loading: own.loading,
    reload: () => {
      setState((previous) => ({ ...previous, loading: true }));
      void run();
    },
  };
}
