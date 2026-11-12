import type { Itinerary } from '@moviq/contracts';

const MINUTE = 60_000;

export interface Span {
  /** Percentages of the axis, so the bars scale with the panel. */
  readonly left: number;
  readonly width: number;
}

export interface Timeline {
  readonly ticks: readonly { readonly at: string; readonly left: number }[];
  /** Each leg as planned, by index. */
  readonly lanes: readonly Span[];
  readonly deadline: number;
  /** Where the projected arrival falls, or null without a projection. */
  readonly expected: number | null;
}

function stepFor(spanMinutes: number): number {
  if (spanMinutes <= 50) return 10;
  if (spanMinutes <= 150) return 15;
  if (spanMinutes <= 300) return 30;
  return 60;
}

/**
 * The plan on one time axis, leg by leg, with the deadline and the server's projected arrival.
 * The axis runs from 5 min before leaving to 5 min after the latest of the planned arrival, the
 * deadline and the projection, with ticks on round minutes.
 */
export function buildTimeline(
  itinerary: Itinerary,
  deadline: string,
  projected: string | null,
): Timeline {
  const start = Date.parse(itinerary.departAt) - 5 * MINUTE;
  const instants = [itinerary.arriveAt, deadline, ...(projected === null ? [] : [projected])];
  const end = Math.max(...instants.map((instant) => Date.parse(instant))) + 5 * MINUTE;
  const at = (ms: number) => ((ms - start) / (end - start)) * 100;

  const step = stepFor((end - start) / MINUTE) * MINUTE;
  const ticks = [];
  // A label centred on its tick would cross the panel's edge in the outer 4 % of the axis.
  for (let tick = Math.ceil(start / step) * step; tick <= end; tick += step) {
    const left = at(tick);
    if (left >= 4 && left <= 96) ticks.push({ at: new Date(tick).toISOString(), left });
  }

  const lanes = itinerary.legs.map((leg) => {
    const from = at(Date.parse(leg.departAt));
    return { left: from, width: at(Date.parse(leg.arriveAt)) - from };
  });
  return {
    ticks,
    lanes,
    deadline: at(Date.parse(deadline)),
    expected: projected === null ? null : at(Date.parse(projected)),
  };
}
