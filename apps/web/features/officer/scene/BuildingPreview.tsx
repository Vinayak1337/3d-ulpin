import type { PhysicalFeature } from "@ulpin/contracts";
import { geometryParts } from "../register/model";
/** Small geometric preview; measurement geometry stays unchanged on the feature. */
export default function BuildingPreview({
  feature,
}: {
  feature: PhysicalFeature;
}) {
  const ring = geometryParts(feature.geometry).polygons[0]?.[0] || [];
  if (ring.length < 3) return null;
  const points = ring.slice(0, -1);
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const h = feature.height.value || 0,
    span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      h,
      1,
    ),
    scale = 130 / span;
  const project = ([x, y]: number[], z = 0) => [
    155 + ((x - cx) * 0.8 - (y - cy) * 0.6) * scale,
    134 - ((x - cx) * 0.3 + (y - cy) * 0.4 + z * 0.75) * scale,
  ];
  const coords = (ps: number[][]) => ps.map((p) => p.join(",")).join(" ");
  return (
    <svg
      viewBox="0 0 310 180"
      className="building-preview"
      role="img"
      aria-label={`${feature.name}: preview from recorded footprint and height`}
    >
      <rect width="310" height="180" fill="#e7ece4" />
      <path d="M0 150L175 78L310 132V180H0Z" fill="#ced7c4" />
      <path
        d="M0 177L211 89L310 117"
        stroke="#aeb9b4"
        strokeWidth="24"
        fill="none"
      />
      {points.map((a, i) => {
        const b = points[(i + 1) % points.length];
        return (
          <polygon
            key={i}
            points={coords([
              project(a),
              project(b),
              project(b, h),
              project(a, h),
            ])}
            fill={i % 2 ? "#bac5c1" : "#d6dcd3"}
            stroke="#8c9e97"
            strokeWidth=".6"
          />
        );
      })}
      {feature.worldStatus === "synthetic" &&
        points.map((a, i) => {
          const b = points[(i + 1) % points.length],
            len = Math.hypot(a[0] - b[0], a[1] - b[1]);
          return Array.from(
            { length: Math.max(0, Math.floor(h / 3.2)) },
            (_, f) =>
              Array.from({ length: Math.floor(len / 4) }, (_, j) => {
                const t = (j + 0.5) / Math.floor(len / 4),
                  x = a[0] + (b[0] - a[0]) * t,
                  y = a[1] + (b[1] - a[1]) * t;
                const [px, py] = project([x, y], f * 3.2 + 1.2);
                return (
                  <rect
                    key={`${i}-${f}-${j}`}
                    x={px - 2.5}
                    y={py - 5}
                    width="5"
                    height="8"
                    fill="#6b858b"
                  />
                );
              }),
          );
        })}
      <polygon
        points={coords(points.map((p) => project(p, h)))}
        fill="#eceee7"
        stroke="#a8b4aa"
        strokeWidth="1.5"
      />
      <text x="14" y="165" fontSize="9" fill="#586b61">
        {feature.worldStatus === "synthetic"
          ? "Fictional demonstration"
          : "Recorded exterior"}
      </text>
    </svg>
  );
}
