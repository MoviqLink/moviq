import type { NeedView, VirtualRide } from '@moviq/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startPolling } from '../explore/live/poll';
import { virtualApi } from './api';
const POLL_MS = 15_000;
export function useVirtualRide(enabled = true) {
  const [ride, setRide] = useState<VirtualRide | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const version = useRef(0);
  useEffect(
    () =>
      !enabled
        ? undefined
        : startPolling(async (signal) => {
            if (document.visibilityState === 'hidden') return;
            const generation = version.current;
            try {
              const result = await virtualApi.current(signal);
              if (!signal.aborted && generation === version.current) {
                setRide(result.ride);
                setFailed(false);
                setLoading(false);
              }
            } catch {
              if (!signal.aborted && generation === version.current) {
                setFailed(true);
                setLoading(false);
              }
            }
          }, POLL_MS),
    [round, enabled],
  );
  const refresh = useCallback(() => {
    version.current += 1;
    setRound((value) => value + 1);
  }, []);
  const board = async (id: string) => {
    if (busy) return;
    version.current += 1;
    setBusy(true);
    setFailed(false);
    try {
      const next = await virtualApi.board(id);
      setRide(next);
      refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const getOff = async () => {
    if (ride === null || busy) return;
    version.current += 1;
    setBusy(true);
    setFailed(false);
    try {
      await virtualApi.getOff(ride.id);
      setRide(null);
      refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const replaceNeed = (need: NeedView) => {
    setRide((current) =>
      current === null
        ? null
        : { ...current, needs: current.needs.map((item) => (item.id === need.id ? need : item)) },
    );
  };
  return { ride, loading, busy, failed, board, getOff, refresh, replaceNeed };
}
