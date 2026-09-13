"use client";
import { useRef } from "react";
import type { Point2, RegistryRecord, RegistryQuery } from "@ulpin/contracts";
import { boundsOf } from "@/lib/ui/geometry";
export default function RegistryMap({
  records,
  selectedId,
  onSelect,
  mode,
  onPoint,
  polygon,
  onPolygon,
  result,
}: {
  records: RegistryRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  mode: "select" | "point" | "draw";
  onPoint: (p: Point2) => void;
  polygon: Point2[];
  onPolygon: (p: Point2[]) => void;
  result: RegistryQuery | null;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const b = boundsOf(records.map((r) => r.footprint)),
    pad = Math.max(b.width, b.height) * 0.08;
  const flip = (y: number) => b.minY + b.maxY - y;
  const points = (ring: Point2[]) =>
    ring.map((p) => `${p[0]},${flip(p[1])}`).join(" ");
  const impacted = new Set(result?.results.map((r) => r.record.id));
  const click = (event: React.MouseEvent<SVGSVGElement>) => {
    if (mode === "select" || !svg.current) return;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return;
    const p = svg.current.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const local = p.matrixTransform(matrix.inverse());
    const point: Point2 = [
      Math.round(local.x * 100) / 100,
      Math.round(flip(local.y) * 100) / 100,
    ];
    if (mode === "point") onPoint(point);
    else onPolygon([...polygon, point]);
  };
  const spaces = records
    .filter((r) => r.kind === "space")
    .sort((a, b) =>
      a.id === selectedId
        ? 1
        : b.id === selectedId
          ? -1
          : (b.geometry?.lower || 0) - (a.geometry?.lower || 0),
    );
  const labels = new Map<string, RegistryRecord>();
  for (const r of spaces)
    if ((r.geometry?.lower ?? 0) >= 0)
      labels.set(JSON.stringify(r.footprint), r);
  return (
    <svg
      ref={svg}
      className={`registry-map ${mode}`}
      viewBox={`${b.minX - pad} ${b.minY - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`}
      onClick={click}
      aria-label="Property plan in local metres"
    >
      <defs>
        <pattern
          id="registry-grid"
          width="1"
          height="1"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 1 0 L 0 0 0 1"
            fill="none"
            stroke="#dcded5"
            strokeWidth=".015"
          />
        </pattern>
      </defs>
      <rect
        x={b.minX - pad}
        y={b.minY - pad}
        width={b.width + 2 * pad}
        height={b.height + 2 * pad}
        fill="url(#registry-grid)"
      />
      {records
        .filter((r) => r.kind === "parcel")
        .map((r) => (
          <g key={r.id}>
            <polygon points={points(r.footprint)} className="parcel-outline" />
            <text
              x={r.footprint[0][0] + 0.3}
              y={flip(b.minY) + 0.65}
              className="parcel-label"
            >
              {r.name}
            </text>
          </g>
        ))}
      {spaces.map((r) => (
        <polygon
          key={r.id}
          points={points(r.footprint)}
          className={`map-space ${r.use} ${selectedId === r.id ? "selected" : ""} ${impacted.has(r.id) ? "impacted" : ""}`}
          role="button"
          tabIndex={mode === "select" ? 0 : -1}
          aria-label={`Locate ${r.alias}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(r.id);
            }
          }}
          onClick={(e) => {
            if (mode === "select") {
              e.stopPropagation();
              onSelect(r.id);
            }
          }}
        >
          <title>
            {r.alias} · {r.name} · {r.geometry?.lower} to {r.geometry?.upper} m
          </title>
        </polygon>
      ))}
      {records
        .filter((r) => r.kind === "building")
        .map((r) => (
          <g key={r.id}>
            <polygon
              points={points(r.footprint)}
              className="building-outline"
            />
            <text
              x={r.footprint[0][0] + 0.3}
              y={flip(Math.max(...r.footprint.map((p) => p[1]))) + 0.65}
              className="building-label"
            >
              {r.name}
            </text>
          </g>
        ))}
      {[...labels.values()].map((r) => {
        const c = boundsOf([r.footprint]);
        return (
          <text
            key={r.id}
            x={c.minX + c.width / 2}
            y={flip(c.minY + c.height / 2)}
            className="space-label"
            textAnchor="middle"
          >
            {r.alias}
          </text>
        );
      })}
      {polygon.length > 0 && (
        <>
          <polyline
            points={points([
              ...polygon,
              ...(polygon.length > 2 ? [polygon[0]] : []),
            ])}
            className="proposal-outline"
          />
          {polygon.map((p, i) => (
            <circle
              key={i}
              cx={p[0]}
              cy={flip(p[1])}
              r=".13"
              className="proposal-point"
            />
          ))}
        </>
      )}
      {result?.results
        .flatMap((x) => x.overlaps)
        .map((r, i) => (
          <polygon
            key={i}
            points={points(r.footprint)}
            className="query-intersection"
          />
        ))}
    </svg>
  );
}
