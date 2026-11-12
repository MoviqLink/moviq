import { useCallback, useEffect, useState } from 'react';

/** NOAA renews its radar mosaic every few minutes; the map asks it again every two. */
const RADAR_EVERY_MS = 2 * 60_000;

export interface RadarView {
  readonly on: boolean;
  readonly toggle: () => void;
  /** When the tiles shown were asked, in browser time; null while the radar is off. */
  readonly askedAt: number | null;
}

/** The weather radar: off when Explore opens; while on, asked again every two minutes. */
export function useRadar(): RadarView {
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const on = askedAt !== null;
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => {
      setAskedAt(Date.now());
    }, RADAR_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [on]);
  const toggle = useCallback(() => {
    setAskedAt((value) => (value === null ? Date.now() : null));
  }, []);
  return { on, toggle, askedAt };
}
