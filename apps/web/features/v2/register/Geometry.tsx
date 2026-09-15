"use client";
import { useId, useMemo, useState } from "react";
import type {
  AreaFinding,
  BuildingDossier,
  RegistryRecord,
} from "@ulpin/contracts";
import { number, geometryParts, recordGeometry } from "./model";
import styles from "./register.module.css";

export default function RegisterGeometry({
  dossier,
  selectedId,
  onSelect,
  finding,
  compact = false,
}: {
  dossier: BuildingDossier;
  selectedId?: string;
  onSelect?: (id: string) => void;
  finding?: AreaFinding;
  compact?: boolean;
}) {
  const gridId = useId();
  const [mode, setMode] = useState<"plan" | "section">("plan");
  const spaces = useMemo(
    () => dossier.records.filter((record) => record.kind === "space"),
    [dossier.records],
  );
  const shapes = useMemo(
    () => [
      ...dossier.parcels.map((item) => ({
        id: item.feature.id,
        label: item.feature.name,
        ...geometryParts(item.feature.geometry),
        kind: "parcel",
      })),
      {
        id: dossier.building.id,
        label: dossier.building.name,
        ...geometryParts(dossier.building.geometry),
        kind: "building",
      },
      ...spaces.map((record) => ({
        id: record.id,
        label: record.name,
        ...geometryParts(recordGeometry(dossier, record)),
        kind: "space",
      })),
      ...(finding?.geometry
        ? [
            {
              id: finding.id,
              label: finding.message,
              ...geometryParts(finding.geometry),
              kind: "finding",
            },
          ]
        : []),
    ],
    [dossier, finding, spaces],
  );
  const points = shapes.flatMap((shape) => [
    ...shape.polygons.flat(2),
    ...shape.lines.flat(),
    ...shape.points,
  ]);
  const [minX, maxX, minY, maxY] = points.reduce(
    ([x0, x1, y0, y1], p) => [
      Math.min(x0, p[0]),
      Math.max(x1, p[0]),
      Math.min(y0, p[1]),
      Math.max(y1, p[1]),
    ],
    [Infinity, -Infinity, Infinity, -Infinity],
  );
  const width = Math.max(maxX - minX, 1),
    height = Math.max(maxY - minY, 1),
    scale = Math.min(460 / width, 340 / height);
  const project = (p: number[]) => [
    300 + (p[0] - (minX + maxX) / 2) * scale,
    205 - (p[1] - (minY + maxY) / 2) * scale,
  ];
  const sections = spaces
    .map((record) => ({
      record,
      scene: dossier.detailedScene.find((item) => item.record.id === record.id),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.scene?.lower ?? item.record.geometry?.lower) &&
        Number.isFinite(item.scene?.upper ?? item.record.geometry?.upper),
    );
  const low = Math.min(
    0,
    ...sections.map((item) => item.scene?.lower ?? item.record.geometry!.lower),
  );
  const high = Math.max(
    1,
    ...sections.map((item) => item.scene?.upper ?? item.record.geometry!.upper),
  );
  const levelY = (z: number) => 350 - ((z - low) / (high - low)) * 280;
  const references = [
    ...new Set(
      sections.map((item) => item.scene?.verticalReference).filter(Boolean),
    ),
  ];
  return (
    <div
      className={`${styles.geometry} ${compact ? styles.geometryCompact : ""}`}
    >
      {!compact && (
        <div className={styles.geometryToolbar}>
          <span>Recorded geometry</span>
          <div className={styles.segmented} aria-label="Geometry view">
            {(["plan", "section"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === "plan" ? "Plan view" : "Section"}
              </button>
            ))}
          </div>
        </div>
      )}
      {(mode === "plan" || compact) && points.length > 0 ? (
        <svg
          viewBox="0 0 600 410"
          role="img"
          aria-label="Recorded property, parcel and unit geometry in local metres"
        >
          <defs>
            <pattern
              id={gridId}
              width="30"
              height="30"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 30 0 L 0 0 0 30"
                fill="none"
                stroke="#e0e9e6"
                strokeWidth=".6"
              />
            </pattern>
          </defs>
          <rect width="600" height="410" fill={`url(#${gridId})`} />
          {shapes.map((shape) => (
            <g
              key={shape.id}
              role={shape.kind === "space" && onSelect ? "button" : undefined}
              tabIndex={shape.kind === "space" && onSelect ? 0 : undefined}
              aria-label={shape.label}
              onClick={() => shape.kind === "space" && onSelect?.(shape.id)}
              onKeyDown={(event) => {
                if (
                  shape.kind === "space" &&
                  ["Enter", " "].includes(event.key)
                ) {
                  event.preventDefault();
                  onSelect?.(shape.id);
                }
              }}
            >
              <title>{shape.label}</title>
              {shape.polygons.map((polygon, index) => (
                <path
                  key={index}
                  d={polygon
                    .map(
                      (ring) =>
                        ring
                          .map(
                            (point, i) =>
                              `${i ? "L" : "M"}${project(point)
                                .map((value) => value.toFixed(2))
                                .join(" ")}`,
                          )
                          .join(" ") + "Z",
                    )
                    .join(" ")}
                  fill={
                    shape.kind === "finding"
                      ? "#e39a77"
                      : shape.id === selectedId
                        ? "#39725e"
                        : shape.kind === "parcel"
                          ? "#eaf4fc"
                          : shape.kind === "space"
                            ? "#9ccbb3"
                            : "#d6e8df"
                  }
                  fillOpacity={shape.kind === "building" ? 0.58 : 0.8}
                  fillRule="evenodd"
                  stroke={
                    shape.kind === "finding"
                      ? "#b42318"
                      : shape.kind === "parcel"
                        ? "#4380a4"
                        : "#326450"
                  }
                  strokeWidth={shape.id === selectedId ? 3 : 1.5}
                  strokeDasharray={shape.kind === "parcel" ? "6 4" : undefined}
                />
              ))}
              {shape.lines.map((line, index) => (
                <polyline
                  key={`line-${index}`}
                  points={line
                    .map((point) =>
                      project(point)
                        .map((value) => value.toFixed(2))
                        .join(","),
                    )
                    .join(" ")}
                  fill="none"
                  stroke={shape.kind === "finding" ? "#b42318" : "#326450"}
                  strokeWidth={shape.kind === "finding" ? 4 : 2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {shape.points.map((point, index) => (
                <circle
                  key={`point-${index}`}
                  cx={project(point)[0]}
                  cy={project(point)[1]}
                  r={shape.kind === "finding" ? 5 : 3}
                  fill={shape.kind === "finding" ? "#b42318" : "#326450"}
                />
              ))}
            </g>
          ))}
          <path d="M558 48V20m0 0l-5 9m5-9l5 9" stroke="#315d50" fill="none" />
          <text x="553" y="65" fontSize="12" fill="#315d50">
            N
          </text>
        </svg>
      ) : mode === "section" && sections.length && references.length <= 1 ? (
        <svg
          viewBox="0 0 600 410"
          role="img"
          aria-label="Section from recorded unit lower and upper levels"
        >
          {Array.from(
            { length: 5 },
            (_, i) => low + ((high - low) * i) / 4,
          ).map((z) => (
            <g key={z}>
              <line
                x1="68"
                x2="565"
                y1={levelY(z)}
                y2={levelY(z)}
                stroke="#d9e4de"
              />
              <text
                x="58"
                y={levelY(z) + 4}
                textAnchor="end"
                fontSize="12"
                fill="#66757d"
              >
                {number(z, "m")}
              </text>
            </g>
          ))}
          {sections.map(({ record, scene }, i) => {
            const lower = scene?.lower ?? record.geometry!.lower,
              upper = scene?.upper ?? record.geometry!.upper,
              w = 450 / sections.length;
            return (
              <g
                key={record.id}
                role="button"
                tabIndex={0}
                aria-label={`${record.name}: ${lower} to ${upper} metres`}
                onClick={() => onSelect?.(record.id)}
                onKeyDown={(event) => {
                  if (["Enter", " "].includes(event.key)) {
                    event.preventDefault();
                    onSelect?.(record.id);
                  }
                }}
              >
                <rect
                  x={80 + i * w}
                  width={Math.max(w - 12, 4)}
                  y={levelY(upper)}
                  height={levelY(lower) - levelY(upper)}
                  fill={record.id === selectedId ? "#39725e" : "#b4d3c1"}
                  stroke="#326450"
                />
                <text x={85 + i * w} y="375" fontSize="12" fill="#31454d">
                  {record.name.slice(0, Math.max(8, 38 / sections.length))}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className={styles.canvasEmpty}>
          <strong>
            {references.length > 1
              ? "Different level references"
              : "No supported section yet"}
          </strong>
          <span>
            {references.length > 1
              ? "Review compatible benchmarks in the workspace."
              : "Add and review unit levels in the workspace."}
          </span>
        </div>
      )}
      {!compact && (
        <div className={styles.geometryLegend}>
          {mode === "plan" ? (
            <>
              <span>
                <i style={{ background: "#d6e8df" }} />
                Building
              </span>
              <span>
                <i style={{ background: "#9ccbb3" }} />
                Detailed space
              </span>
              <span>
                <i style={{ background: "#eaf4fc" }} />
                Parcel
              </span>
              {finding && (
                <span>
                  <i style={{ background: "#b42318" }} />
                  Finding geometry
                </span>
              )}
            </>
          ) : (
            <span>
              {references[0] || "Recorded source levels"} · horizontal layout is
              schematic
            </span>
          )}
        </div>
      )}
    </div>
  );
}
