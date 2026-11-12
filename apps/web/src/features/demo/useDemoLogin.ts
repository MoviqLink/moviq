import { useEffect, useRef, useState } from 'react';

import { demoApi } from './api';
import { LOGIN_DURATION_MS, SUCCESS_HOLD_MS } from './loginTimeline';
import { setTravellerEntered } from './travellerSession';

export type Role = 'traveller' | 'partner';
export function useDemoLogin(role: Role) {
  const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending');
  const [elapsed, setElapsed] = useState(() =>
    matchMedia('(prefers-reduced-motion: reduce)').matches ? LOGIN_DURATION_MS : 0,
  );
  const progress = useRef(elapsed);
  useEffect(() => {
    const controller = new AbortController();
    void demoApi.login(role, controller.signal).then(
      () => {
        if (!controller.signal.aborted) {
          setState('ready');
        }
      },
      () => {
        if (!controller.signal.aborted) setState('error');
      },
    );
    return () => {
      controller.abort();
    };
  }, [role]);
  useEffect(() => {
    if (progress.current >= LOGIN_DURATION_MS || state === 'error') return;
    let frame = 0;
    let previous: number | null = null;
    const tick = (now: number) => {
      if (previous !== null)
        progress.current = Math.min(LOGIN_DURATION_MS, progress.current + now - previous);
      previous = now;
      setElapsed(progress.current);
      if (progress.current < LOGIN_DURATION_MS) frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      previous = null;
      if (!document.hidden && progress.current < LOGIN_DURATION_MS)
        frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      cancelAnimationFrame(frame);
    };
  }, [state]);
  const complete = state === 'ready' && elapsed >= LOGIN_DURATION_MS;
  useEffect(() => {
    if (!complete) return;
    const timer = window.setTimeout(() => {
      // Whoever has entered, in either role, finds the welcome at home, never the entry again.
      setTravellerEntered(true);
      window.location.hash = role === 'partner' ? '/business' : '/';
    }, SUCCESS_HOLD_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [complete, role]);
  return {
    state,
    elapsed,
    complete,
    skip: () => {
      progress.current = LOGIN_DURATION_MS;
      setElapsed(LOGIN_DURATION_MS);
    },
  };
}
