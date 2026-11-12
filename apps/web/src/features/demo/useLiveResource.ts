import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiRequestError } from '../../shared/api/errors';

/** Keep the last successful data while refreshing, with one request at a time. */
export function useLiveResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    if (active.current !== null) return;
    const controller = new AbortController();
    active.current = controller;
    void load(controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted) {
            setData(value);
            setError(false);
          }
        },
        (failure: unknown) => {
          if (controller.signal.aborted) return;
          // Stale data is useful during an outage, but must disappear when access is revoked.
          if (
            failure instanceof ApiRequestError &&
            failure.failure.kind === 'http' &&
            [401, 403, 404].includes(failure.failure.status)
          ) {
            setData(null);
          }
          setError(true);
        },
      )
      .finally(() => {
        if (active.current === controller) active.current = null;
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [load]);
  useEffect(() => {
    refresh();
    const visible = () => {
      if (!document.hidden) refresh();
    };
    const timer = window.setInterval(visible, 15000);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      active.current?.abort();
      active.current = null;
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}
