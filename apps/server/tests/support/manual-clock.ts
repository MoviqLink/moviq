import type { Clock } from '../../src/infrastructure/clock/clock.js';

/** A clock that only moves when the test says so. */
export interface ManualClock extends Clock {
  advance(ms: number): void;
}

export function manualClock(start = '2026-11-11T12:00:00.000Z'): ManualClock {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}
