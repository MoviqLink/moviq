import { useSyncExternalStore } from 'react';

// One timer for the whole page, running only while something on screen shows a live time.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshot = (): number => now;

/** The browser clock in milliseconds, updated once a second, so ages grow on screen. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
