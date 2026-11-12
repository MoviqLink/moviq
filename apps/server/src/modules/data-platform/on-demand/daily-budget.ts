/** A count of requests per UTC day, kept in this process. */
export interface DailyBudget {
  /** Spends one request of `now`'s day; false, spending nothing, once the day's limit is reached. */
  take(now: Date): boolean;
  /** Requests still left on `now`'s day. */
  left(now: Date): number;
}

export function createDailyBudget(limit: number): DailyBudget {
  let day = '';
  let used = 0;
  const roll = (now: Date): void => {
    const today = now.toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
    }
  };
  return {
    take(now) {
      roll(now);
      if (used >= limit) return false;
      used += 1;
      return true;
    },
    left(now) {
      roll(now);
      return limit - used;
    },
  };
}
