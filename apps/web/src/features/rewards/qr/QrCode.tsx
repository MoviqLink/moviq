import { useMemo } from 'react';

import { qrMatrix } from './qr';

/** Light modules around the code, as the standard asks, so readers find its edges. */
const QUIET = 4;

/** The signed pickup code as a QR, dark on white in both themes so every reader can scan it. */
export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  const { size, path } = useMemo(() => {
    const matrix = qrMatrix(text);
    const parts: string[] = [];
    matrix.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${String(x + QUIET)} ${String(y + QUIET)}h1v1h-1z`);
      });
    });
    return { size: matrix.length + QUIET * 2, path: parts.join('') };
  }, [text]);
  return (
    <svg
      className="reward-qr"
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
