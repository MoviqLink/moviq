import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiRequestError, type ApiFailure } from '../../shared/api/errors';
import { createLatest } from '../../shared/api/latest';
import { useMerchantSession } from './session';

const POLL_MS = 15_000;

export interface Resource<T> {
  /** The last good answer, kept while later requests fail. */
  readonly data: T | null;
  /** When the last good answer arrived, by the browser clock. */
  readonly receivedAt: number | null;
  readonly failure: ApiFailure | null;
  readonly loading: boolean;
  /** Asks again now, cancelling any request in flight. */
  readonly reload: () => void;
}

interface State<T> {
  readonly data: T | null;
  readonly receivedAt: number | null;
  readonly failure: ApiFailure | null;
  readonly loading: boolean;
  readonly bug: Error | null;
}

const EMPTY = { data: null, receivedAt: null, failure: null, loading: true, bug: null };

/**
 * Loads one panel resource and keeps it current: on open and every 15 s while the page is
 * visible, only the newest answer kept, and a lapsed session sent back to choosing a merchant.
 * The numbers change once per answer; nothing on screen moves while it waits.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>): Resource<T> {
  const { expire } = useMerchantSession();
  const [state, setState] = useState<State<T>>(EMPTY);
  const loadRef = useRef(load);
  const latest = useRef(createLatest());

  useEffect(() => {
    loadRef.current = load;
  });

  const run = useCallback(async () => {
    const signal = latest.current.next();
    try {
      const data = await loadRef.current(signal);
      setState({ data, receivedAt: Date.now(), failure: null, loading: false, bug: null });
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
      setState((previous) => ({ ...previous, failure, loading: false }));
    }
  }, [expire]);

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

  // A programming error reaches the error boundary instead of failing silently.
  if (state.bug !== null) throw state.bug;
  return {
    data: state.data,
    receivedAt: state.receivedAt,
    failure: state.failure,
    loading: state.loading,
    reload: () => {
      setState((previous) => ({ ...previous, loading: true }));
      void run();
    },
  };
}
