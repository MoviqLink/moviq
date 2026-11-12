/** How long one incident lasted, or has lasted so far when it is still open (censored). */
export interface Duration {
  readonly seconds: number;
  readonly closed: boolean;
}

export interface SurvivalCurve {
  /** `[seconds, share still open]` after each time at which incidents closed. */
  readonly points: readonly (readonly [number, number])[];
  /** The first time at which half of the incidents had closed, or null if not reached yet. */
  readonly p50: number | null;
  /** The first time at which nine in ten had closed, or null if not reached yet. */
  readonly p90: number | null;
  readonly n: number;
  readonly closed: number;
  readonly open: number;
}

/**
 * Kaplan–Meier estimate of how long incidents stay open. Incidents still open count as at risk
 * up to the time they have lasted so far, so ongoing ones lengthen the curve instead of being
 * left out. At a tie, closings come before the open ones, which are still at risk at that time.
 */
export function kaplanMeier(durations: readonly Duration[]): SurvivalCurve {
  const sorted = [...durations].sort(
    (a, b) => a.seconds - b.seconds || Number(b.closed) - Number(a.closed),
  );
  const points: [number, number][] = [];
  let survival = 1;
  let atRisk = sorted.length;
  let index = 0;
  while (index < sorted.length) {
    const time = sorted[index]?.seconds ?? 0;
    let closedNow = 0;
    let leaving = 0;
    while (sorted[index]?.seconds === time) {
      if (sorted[index]?.closed === true) closedNow += 1;
      leaving += 1;
      index += 1;
    }
    if (closedNow > 0) {
      survival *= 1 - closedNow / atRisk;
      points.push([time, survival]);
    }
    atRisk -= leaving;
  }
  const firstAtOrBelow = (level: number) =>
    points.find(([, share]) => share <= level + 1e-12)?.[0] ?? null;
  const closed = durations.filter((duration) => duration.closed).length;
  return {
    points,
    p50: firstAtOrBelow(0.5),
    p90: firstAtOrBelow(0.1),
    n: durations.length,
    closed,
    open: durations.length - closed,
  };
}
