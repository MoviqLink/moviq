import {
  liveModeSchema,
  type BoundingBox,
  type LiveMode,
  type LiveLineKey,
  type LiveVehiclesResponse,
} from '@moviq/contracts';
import { useCallback, useEffect, useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { fetchLive, registerInterest } from '../api';
import { startPolling } from './poll';

/** Bus Time and the subway feeds are read every 30 s while someone looks: half that finds each. */
const POLL_MS = 15_000;
/** The interest lasts two minutes on the server; renewing every minute keeps it alive. */
const INTEREST_MS = 60_000;

export interface LiveCityView {
  readonly data: LiveVehiclesResponse | null;
  /** Browser time of the last good answer. */
  readonly receivedAt: number | null;
  /** True while the last request failed; the last good data stays, with its age. */
  readonly failing: boolean;
  readonly retryNow: () => void;
}

/**
 * Reads the live city inside the box every 15 seconds while the page is visible, one request at a
 * time: a new box or a retry cancels the request in flight, and leaving the screen stops it all.
 */
export function useLiveCity(
  box: BoundingBox,
  modes: readonly LiveMode[],
  selection?: { readonly lines: readonly LiveLineKey[]; readonly enabled: boolean },
): LiveCityView {
  const modesKey = modes.join(',');
  const linesKey =
    selection === undefined
      ? null
      : JSON.stringify(
          selection.lines.map(({ mode, sourceId, lineId }) => ({ mode, sourceId, lineId })),
        );
  const enabled = selection?.enabled ?? true;
  const [data, setData] = useState<LiveVehiclesResponse | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return startPolling(async (signal) => {
      if (document.visibilityState === 'hidden') return;
      const shown = liveModeSchema.array().safeParse(modesKey === '' ? [] : modesKey.split(','));
      try {
        const lines = linesKey === null ? undefined : (JSON.parse(linesKey) as LiveLineKey[]);
        const answer = await fetchLive(box, shown.success ? shown.data : [], signal, lines);
        if (signal.aborted) return;
        setData(answer);
        setReceivedAt(Date.now());
        setFailing(false);
      } catch (error: unknown) {
        if (
          signal.aborted ||
          (error instanceof ApiRequestError && error.failure.kind === 'aborted')
        ) {
          return;
        }
        setFailing(true);
      }
    }, POLL_MS);
  }, [box, round, modesKey, linesKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const shown = liveModeSchema.array().min(1).safeParse(modesKey.split(','));
    if (!shown.success) return;
    return startPolling(async (signal) => {
      await registerInterest(shown.data, signal).catch(() => undefined);
    }, INTEREST_MS);
  }, [modesKey, enabled]);

  const retryNow = useCallback(() => {
    setRound((value) => value + 1);
  }, []);

  return {
    data: enabled ? data : null,
    receivedAt: enabled ? receivedAt : null,
    failing: enabled && failing,
    retryNow,
  };
}
