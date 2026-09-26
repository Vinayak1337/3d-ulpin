import { useMemo } from 'react';
import { encode } from 'uqr';

/** QR for the verification page. Drawn as SVG rects from the encoded matrix. */
export function Qr({ value, size = 120, label }: { value: string; size?: number; label: string }) {
  const matrix = useMemo(() => encode(value, { ecc: 'M', border: 1 }).data, [value]);
  const n = matrix.length;
  const cells: string[] = [];
  matrix.forEach((row, y) => row.forEach((on, x) => { if (on) cells.push(`M${x} ${y}h1v1h-1z`); }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="var(--ui-surface)" />
      <path d={cells.join('')} fill="var(--ui-ink)" />
    </svg>
  );
}
