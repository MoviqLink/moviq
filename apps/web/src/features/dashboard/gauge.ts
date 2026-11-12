/** The drawing box of a gauge: a half circle on a 200 × 112 canvas. */
export const GAUGE_BOX = { width: 200, height: 112, cx: 100, cy: 100, radius: 84 } as const;

/** One coloured stretch of the dial, in percent from 0 to 100. */
export interface GaugeBand {
  readonly from: number;
  readonly to: number;
  /** A CSS colour, usually a MovIQ token such as `var(--accent)`. */
  readonly color: string;
}

/** The point of the dial at a fraction: 0 is the left end, 1 the right end, 0.5 the top. */
export function pointAt(fraction: number, radius: number = GAUGE_BOX.radius) {
  const angle = Math.PI * (1 - fraction);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    x: round(GAUGE_BOX.cx + radius * Math.cos(angle)),
    y: round(GAUGE_BOX.cy - radius * Math.sin(angle)),
  };
}

/** The SVG path of the dial between two fractions, drawn clockwise over the top. */
export function arcPath(from: number, to: number, radius: number = GAUGE_BOX.radius): string {
  const start = pointAt(from, radius);
  const end = pointAt(to, radius);
  return ['M', start.x, start.y, 'A', radius, radius, 0, 0, 1, end.x, end.y].join(' ');
}

/** Space left between two bands, as a fraction of the dial. */
const BAND_GAP = 0.008;

/** The path of each band on the dial, with a fine gap between neighbours. */
export function bandPaths(bands: readonly GaugeBand[]) {
  return bands.map((band) => {
    const from = band.from / 100;
    const to = band.to / 100;
    return {
      band,
      d: arcPath(from + (from > 0 ? BAND_GAP : 0), to - (to < 1 ? BAND_GAP : 0)),
    };
  });
}

/** The band a percentage falls in; the last band holds 100. */
export function bandAt(bands: readonly GaugeBand[], percent: number): GaugeBand | undefined {
  return bands.find((band) => percent >= band.from && percent < band.to) ?? bands.at(-1);
}

/** A share as a whole percentage from 0 to 100; 0 when there is nothing to divide by. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

/** On time: red when few, amber in the middle, MovIQ green when nearly all. */
export const ON_TIME_BANDS: readonly GaugeBand[] = [
  { from: 0, to: 60, color: 'var(--st-unavailable)' },
  { from: 60, to: 85, color: 'var(--st-degraded)' },
  { from: 85, to: 100, color: 'var(--accent)' },
];

/** Trips Sara stepped in: a quiet blue scale, darker as she helps more. */
export const REROUTED_BANDS: readonly GaugeBand[] = [
  { from: 0, to: 34, color: 'var(--st-outside_service)' },
  { from: 34, to: 67, color: 'var(--st-rate_limited)' },
  { from: 67, to: 100, color: 'var(--accent)' },
];

/** Wallet spent: plenty left, running low, nearly spent. */
export const WALLET_BANDS: readonly GaugeBand[] = [
  { from: 0, to: 60, color: 'var(--accent)' },
  { from: 60, to: 85, color: 'var(--st-degraded)' },
  { from: 85, to: 100, color: 'var(--st-unavailable)' },
];
