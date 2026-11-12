/** The source of "now". Injected everywhere so time-dependent rules can be tested exactly. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
