import type { Clock } from '../clock/clock.js';

interface Window {
  readonly until: number;
  count: number;
}

/** Fixed windows in expiry order. Active keys are never evicted to grant a fresh allowance. */
export function windowLimit(clock: Clock, limit: number, windowMs = 60_000, maxKeys = 10_000) {
  const windows = new Map<string, Window>();
  return (key: string): number => {
    const now = clock.now().getTime();
    for (const [oldKey, old] of windows) {
      if (old.until > now) break;
      windows.delete(oldKey);
    }
    let window = windows.get(key);
    if (window === undefined) {
      if (windows.size >= maxKeys) {
        const earliest = windows.values().next().value;
        return Math.max(1, Math.ceil(((earliest?.until ?? now + windowMs) - now) / 1000));
      }
      window = { until: now + windowMs, count: 0 };
      windows.set(key, window);
    }
    if (window.count >= limit) return Math.max(1, Math.ceil((window.until - now) / 1000));
    window.count += 1;
    return 0;
  };
}
