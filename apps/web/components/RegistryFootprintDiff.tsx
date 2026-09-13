import type { Point2 } from "@ulpin/contracts";
import { boundsOf } from "@/lib/ui/geometry";

export default function RegistryFootprintDiff({
  before,
  after,
}: {
  before?: Point2[];
  after: Point2[];
}) {
  const b = boundsOf([...(before ? [before] : []), after]);
  const pad = Math.max(b.width, b.height, 1) * 0.1;
  const points = (ring: Point2[]) =>
    ring.map(([x, y]) => `${x},${b.minY + b.maxY - y}`).join(" ");
  return (
    <figure className="registry-footprint-diff">
      <svg
        role="img"
        aria-label="Footprint comparison: dashed current boundary and solid proposed boundary"
        viewBox={`${b.minX - pad} ${b.minY - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`}
      >
        <polygon
          points={points(after)}
          fill="#cbd9cc"
          stroke="#3e6559"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {before && (
          <polygon
            points={points(before)}
            fill="none"
            stroke="#776751"
            strokeWidth="2"
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <figcaption>Dashed: current · solid: proposed · local metres</figcaption>
      <details>
        <summary>Compare footprint coordinates</summary>
        <pre>
          {JSON.stringify(
            { current: before || null, proposed: after },
            null,
            2,
          )}
        </pre>
      </details>
    </figure>
  );
}
