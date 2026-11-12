import { signalBars } from '../model/card';

/** A compass with the course as a needle; an empty dial when there is no course. */
export function Compass({ degrees }: { degrees: number | null }) {
  return (
    <svg className="ex-compass" width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true">
      <circle r="15" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.2" />
      <path d="M0 -15 L0 -11" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.6" />
      {degrees !== null && (
        <path
          d="M0 -11 L5 7 L0 3.5 L-5 7 Z"
          fill="currentColor"
          transform={`rotate(${String(degrees)})`}
        />
      )}
    </svg>
  );
}

const HEIGHTS = [0.35, 0.6, 0.8, 1];

/** Four bars that fill with how recent the last report is; all empty without one. */
export function SignalBars({ ageSeconds, label }: { ageSeconds: number | null; label: string }) {
  const level = ageSeconds === null ? 0 : signalBars(ageSeconds);
  const tone = level >= 3 ? 'good' : level === 2 ? 'fair' : 'poor';
  return (
    <span className={`ex-bars ${tone}`} role="img" aria-label={label}>
      {HEIGHTS.map((height, index) => (
        <i
          key={height}
          className={index < level ? 'on' : ''}
          style={{ height: `${String(Math.round(22 * height))}px` }}
        />
      ))}
    </span>
  );
}

/** A point with its tolerance and the four corners of the selected mark. */
export function MarginIcon() {
  const corner = (x: number, y: number) =>
    `M ${String(x * 13.5)} ${String(y * 8.5)} ` +
    `L ${String(x * 13.5)} ${String(y * 13.5)} L ${String(x * 8.5)} ${String(y * 13.5)}`;
  return (
    <svg
      className="ex-margin-icon"
      width="30"
      height="30"
      viewBox="-15 -15 30 30"
      aria-hidden="true"
    >
      <circle
        r="8.5"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle r="2.6" fill="currentColor" />
      <path
        d={[corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}
