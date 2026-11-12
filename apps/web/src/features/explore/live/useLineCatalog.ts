import { liveLinesResponseSchema, type LiveLinesResponse } from '@moviq/contracts';
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { startPolling } from './poll';

/** The compact catalogue is refreshed independently of the positions on the map. */
export function useLineCatalog(enabled: boolean) {
  const [data, setData] = useState<LiveLinesResponse | null>(null);
  const [failing, setFailing] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    return startPolling(async (signal) => {
      try {
        const answer = await api.json('/api/live/lines', liveLinesResponseSchema, { signal });
        if (!signal.aborted) {
          setData(answer);
          setFailing(false);
        }
      } catch {
        if (!signal.aborted) setFailing(true);
      }
    }, 30_000);
  }, [enabled]);
  return { data, failing };
}
