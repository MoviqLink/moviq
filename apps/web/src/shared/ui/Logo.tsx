import { useId } from 'react';

// The ring is the route around the name: two arcs, with gaps where the word would cross it.
function polar(deg: number, r: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
}

function arc(r: number, from: number, to: number): string {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  const large = (to - from + 360) % 360 > 180 ? 1 : 0;
  const point = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return `M ${point(x1, y1)} A ${String(r)} ${String(r)} 0 ${String(large)} 1 ${point(x2, y2)}`;
}

/** The two arcs of the ring in a 100 × 100 box, for the logo and for the intro that draws it. */
export const RING_ARCS = { top: arc(33, 296, 64), bottom: arc(33, 116, 204) } as const;
const { top: TOP, bottom: BOTTOM } = RING_ARCS;

/** The ring on its own. Its colours come from the `--ring-*` tokens, so it follows the theme. */
function LogoMark({ size }: { size: number }) {
  const id = `ring${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--ring-a)', stopOpacity: 'var(--ring-a-o)' }} />
          <stop offset=".5" style={{ stopColor: 'var(--ring-b)' }} />
          <stop offset="1" style={{ stopColor: 'var(--ring-c)' }} />
        </linearGradient>
      </defs>
      <path d={TOP} stroke={`url(#${id})`} strokeWidth="6.5" fill="none" strokeLinecap="round" />
      <path d={BOTTOM} stroke={`url(#${id})`} strokeWidth="6.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** The MovIQ logo: the lime ring and the spaced name, with "IQ" in lime. */
export function Logo() {
  return (
    <span className="logo">
      <LogoMark size={30} />
      <span className="logo-word">
        MOV<b>IQ</b>
      </span>
    </span>
  );
}
