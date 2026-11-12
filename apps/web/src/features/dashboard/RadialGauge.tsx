import { useId, type CSSProperties } from 'react';

import { GAUGE_BOX, arcPath, bandAt, bandPaths, pointAt, type GaugeBand } from './gauge';

const NEEDLE_INNER = GAUGE_BOX.radius - 15;
const NEEDLE_OUTER = GAUGE_BOX.radius + 11;
const VIEW_BOX = ['0', '0', String(GAUGE_BOX.width), String(GAUGE_BOX.height)].join(' ');

/**
 * A half-circle gauge in percent: faded bands across the dial, the reached part lit once from
 * zero to the value, a fine needle and the figure large in the centre. Without a value the dial
 * stays unlit, shows a dash and has no meter role, never a false zero.
 */
export function RadialGauge({
  label,
  percent,
  bands,
  caption,
}: {
  readonly label: string;
  readonly percent: number | null;
  readonly bands: readonly GaugeBand[];
  readonly caption: string;
}) {
  const labelId = useId();
  const band = percent === null ? undefined : bandAt(bands, percent);
  const meter = percent !== null && {
    role: 'meter' as const,
    'aria-labelledby': labelId,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': percent,
    'aria-valuetext': `${String(percent)}%. ${caption}`,
  };
  return (
    <figure className="gauge" data-empty={percent === null || undefined}>
      <figcaption id={labelId} className="gauge-label">
        {label}
      </figcaption>
      <div className="gauge-dial" {...meter}>
        <Dial bands={bands} percent={percent} />
        <p className="gauge-reading" aria-hidden="true">
          {percent === null ? (
            <span className="gauge-none">—</span>
          ) : (
            <>
              <strong>{percent}</strong>
              <span>%</span>
            </>
          )}
        </p>
      </div>
      <div className="gauge-scale" aria-hidden="true">
        <span>0</span>
        <span>100</span>
      </div>
      <p className="gauge-caption">
        {band !== undefined && (
          <span className="gauge-swatch" style={{ background: band.color }} aria-hidden="true" />
        )}
        {caption}
      </p>
    </figure>
  );
}

/** The drawing: faded bands, the reached part lit once through a mask, and the needle. */
function Dial({
  bands,
  percent,
}: {
  readonly bands: readonly GaugeBand[];
  readonly percent: number | null;
}) {
  const maskId = useId();
  const fraction = (percent ?? 0) / 100;
  const turn = { '--gauge-fill': fraction * 100, '--gauge-turn': `${String(fraction * 180)}deg` };
  const start = pointAt(0, NEEDLE_INNER);
  const tip = pointAt(0, NEEDLE_OUTER);
  const paths = bandPaths(bands);
  return (
    <svg viewBox={VIEW_BOX} aria-hidden="true" focusable="false" style={turn as CSSProperties}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <path className="gauge-reach" d={arcPath(0, 1)} pathLength={100} />
        </mask>
      </defs>
      {paths.map(({ band, d }) => (
        <path
          key={`track-${String(band.from)}`}
          className="gauge-track"
          d={d}
          stroke={band.color}
        />
      ))}
      {percent !== null && (
        <>
          <g mask={`url(#${maskId})`}>
            {paths.map(({ band, d }) => (
              <path
                key={`lit-${String(band.from)}`}
                className="gauge-lit"
                d={d}
                stroke={band.color}
              />
            ))}
          </g>
          <line className="gauge-needle" x1={start.x} y1={start.y} x2={tip.x} y2={tip.y} />
        </>
      )}
    </svg>
  );
}
