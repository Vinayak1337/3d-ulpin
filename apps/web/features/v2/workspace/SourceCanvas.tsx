"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AreaGeometry, Point2 } from "@ulpin/contracts";
import { Button, EmptyState } from "../shared/ui";
import { useSourceRaster } from "./useSourceRaster";
import type {
  CanvasSource,
  Measurement,
  MeasureTool,
  WorkspaceMode,
} from "./types";
import styles from "./Workspace.module.css";

type Bounds = [number, number, number, number];
const flatten = (input: unknown): number[][] =>
  !Array.isArray(input)
    ? []
    : typeof input[0] === "number"
      ? [input as number[]]
      : input.flatMap(flatten);
function coords(geometry?: AreaGeometry): number[][] {
  return !geometry
    ? []
    : geometry.type === "GeometryCollection"
      ? geometry.geometries.flatMap(coords)
      : flatten(geometry.coordinates);
}
function geometryPaths(geometry: AreaGeometry): string[] {
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap(geometryPaths);
  const line = (ring: number[][], close = false) =>
    ring.map(([x, y], index) => `${index ? "L" : "M"}${x} ${-y}`).join(" ") +
    (close ? " Z" : "");
  if (geometry.type === "Polygon")
    return [geometry.coordinates.map((ring) => line(ring, true)).join(" ")];
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.map((polygon) =>
      polygon.map((ring) => line(ring, true)).join(" "),
    );
  if (geometry.type === "LineString") return [line(geometry.coordinates)];
  if (geometry.type === "MultiLineString")
    return geometry.coordinates.map((ring) => line(ring));
  return [];
}
function sourceBounds(
  source: CanvasSource | undefined,
  width: number,
  height: number,
): Bounds {
  const ps = coords(source?.geometry);
  if (source?.kind !== "geometry" || !ps.length) return [0, 0, width, height];
  let x = Infinity,
    y = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [px, py] of ps) {
    x = Math.min(x, px);
    y = Math.min(y, -py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, -py);
  }
  const w = Math.max(1, maxX - x),
    h = Math.max(1, maxY - y),
    margin = Math.max(w, h) * 0.12;
  return [x - margin, y - margin, w + margin * 2, h + margin * 2];
}
function GeometryLayer({
  source,
  color,
}: {
  source: CanvasSource;
  color: string;
}) {
  if (!source.geometry) return null;
  return (
    <g>
      {geometryPaths(source.geometry).map((d, index) => (
        <path
          key={index}
          d={d}
          fill={/Polygon/.test(source.geometry!.type) ? color + "22" : "none"}
          fillRule="evenodd"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {source.geometry.type === "Point" && (
        <circle
          cx={source.geometry.coordinates[0]}
          cy={-source.geometry.coordinates[1]}
          r="0.12"
          fill={color}
        />
      )}
    </g>
  );
}
export default function SourceCanvas({
  source,
  secondary,
  page,
  mode,
  tool,
  points,
  measurements,
  compareMode,
  opacity,
  swipe,
  onPoint,
  onUndo,
  onFinish,
  onClear,
  onPage,
}: {
  source?: CanvasSource;
  secondary?: CanvasSource;
  page: number;
  mode: WorkspaceMode;
  tool: MeasureTool;
  points: Point2[];
  measurements: Measurement[];
  compareMode: "overlay" | "split" | "side_by_side" | "difference";
  opacity: number;
  swipe: number;
  onPoint: (point: Point2) => void;
  onUndo: () => void;
  onFinish: () => void;
  onClear: () => void;
  onPage: (page: number) => void;
}) {
  const raster = useSourceRaster(source, page),
    other = useSourceRaster(secondary, 1);
  const base = useMemo(
    () => sourceBounds(source, raster.width, raster.height),
    [source, raster.width, raster.height],
  );
  const [view, setView] = useState<Bounds>(base),
    [zoom, setZoom] = useState(1);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ x: number; y: number; view: Bounds } | null>(null);
  useEffect(() => {
    setView(base);
    setZoom(1);
  }, [source?.id, source?.hash, page, ...base]);
  const scale = (factor: number) => {
    setZoom((z) => z / factor);
    setView(([x, y, w, h]) => [
      x + (w * (1 - factor)) / 2,
      y + (h * (1 - factor)) / 2,
      w * factor,
      h * factor,
    ]);
  };
  const metric = source?.kind === "geometry";
  const incomparableGeometry =
    secondary &&
    (metric || secondary.kind === "geometry") &&
    !(
      metric &&
      secondary.kind === "geometry" &&
      source?.frame &&
      source.frame === secondary.frame
    );
  const layout = incomparableGeometry ? "side_by_side" : compareMode;
  const canDraw =
    mode === "calibrate" ||
    (mode === "measure" && tool !== "pan" && tool !== "height");
  const allMeasurements = measurements.filter(
    (m) =>
      m.sourceId === source?.id &&
      m.sourceHash === source?.hash &&
      m.page === page,
  );
  const drawLayer = (
    selected: CanvasSource,
    imageUrl: string,
    color: string,
    rect: Bounds,
  ) =>
    selected.kind === "geometry" ? (
      <GeometryLayer source={selected} color={color} />
    ) : imageUrl ? (
      <image
        href={imageUrl}
        x={rect[0]}
        y={rect[1]}
        width={rect[2]}
        height={rect[3]}
        preserveAspectRatio="xMidYMid meet"
      />
    ) : null;
  return (
    <section className={styles.canvas} aria-label="Plan canvas">
      <div className={styles.canvasBar}>
        <div>
          <strong>{source?.name || "Plan canvas"}</strong>
          {source?.frame && <span>{source.frame}</span>}
        </div>
        <div className={styles.inline}>
          <Button onClick={() => scale(1.25)} aria-label="Zoom out">
            −
          </Button>
          <span>{Math.round(zoom * 100)}%</span>
          <Button onClick={() => scale(0.8)} aria-label="Zoom in">
            +
          </Button>
          <Button
            onClick={() => {
              setView(base);
              setZoom(1);
            }}
          >
            Fit
          </Button>
        </div>
      </div>
      {source?.kind === "pdf" && (
        <div className={styles.pageBar}>
          <Button
            disabled={page <= 1 || raster.loading}
            onClick={() => onPage(page - 1)}
          >
            Previous page
          </Button>
          <span>
            Page {page} of {raster.pages}
          </span>
          <Button
            disabled={page >= raster.pages || raster.loading}
            onClick={() => onPage(page + 1)}
          >
            Next page
          </Button>
        </div>
      )}
      {!source ? (
        <EmptyState
          title="Add a source plan"
          description="Choose a retained document or add one to this workspace."
        />
      ) : source.kind === "text" ? (
        <div className={styles.textPreview}>
          <h3>{source.name}</h3>
          {source.parts.length ? (
            source.parts.map((part) => (
              <article key={part.id}>
                <strong>{part.locator}</strong>
                <pre>{part.text}</pre>
              </article>
            ))
          ) : (
            <p>No drawable plan was found in this document.</p>
          )}
          {source.url && (
            <a href={source.url} target="_blank" rel="noreferrer">
              Open original document ↗
            </a>
          )}
        </div>
      ) : (
        <div
          className={`${styles.canvasStage} ${mode === "compare" && layout === "side_by_side" ? styles.sideBySide : ""}`}
        >
          {raster.loading && (
            <div className={styles.canvasNotice} role="status">
              Rendering retained source…
            </div>
          )}
          {raster.error && (
            <div className={styles.canvasNotice} role="alert">
              {raster.error}{" "}
              {source.url && (
                <a href={source.url} target="_blank" rel="noreferrer">
                  Open original ↗
                </a>
              )}
            </div>
          )}
          <svg
            ref={svg}
            viewBox={view.join(" ")}
            className={canDraw ? styles.drawing : undefined}
            role="img"
            aria-label={`${source.name}; ${canDraw ? "click to add a point" : "drag to pan"}`}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClear();
              if (event.key === "Enter") {
                event.preventDefault();
                onFinish();
              }
              if (event.key === "Backspace") {
                event.preventDefault();
                onUndo();
              }
            }}
            onPointerDown={(event) => {
              if (raster.loading || raster.error) return;
              if (canDraw) {
                const matrix = event.currentTarget.getScreenCTM();
                if (matrix) {
                  const p = new DOMPoint(
                    event.clientX,
                    event.clientY,
                  ).matrixTransform(matrix.inverse());
                  onPoint([p.x, p.y]);
                }
                return;
              }
              drag.current = { x: event.clientX, y: event.clientY, view };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              const matrix = event.currentTarget.getScreenCTM();
              if (!matrix) return;
              const d = drag.current;
              setView([
                d.view[0] - (event.clientX - d.x) / matrix.a,
                d.view[1] - (event.clientY - d.y) / matrix.d,
                d.view[2],
                d.view[3],
              ]);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <defs>
              <pattern
                id="v2-plan-grid"
                width={metric ? 1 : 50}
                height={metric ? 1 : 50}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={metric ? "M1 0H0V1" : "M50 0H0V50"}
                  fill="none"
                  stroke="#dce6e5"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
              </pattern>
              <clipPath id="v2-compare-clip">
                <rect
                  x={base[0]}
                  y={base[1]}
                  width={(base[2] * swipe) / 100}
                  height={base[3]}
                />
              </clipPath>
            </defs>
            <rect
              x={view[0]}
              y={view[1]}
              width={view[2]}
              height={view[3]}
              fill={metric ? "url(#v2-plan-grid)" : "#fff"}
            />
            {drawLayer(source, raster.url, "#235347", base)}
            {mode === "compare" && secondary && layout !== "side_by_side" && (
              <g
                style={
                  compareMode === "difference"
                    ? { mixBlendMode: "difference" }
                    : undefined
                }
                opacity={compareMode === "overlay" ? opacity / 100 : 1}
                clipPath={
                  compareMode === "split" ? "url(#v2-compare-clip)" : undefined
                }
              >
                {drawLayer(secondary, other.url, "#286a9b", base)}
              </g>
            )}
            {mode !== "compare" &&
              allMeasurements.map((m) => (
                <polyline
                  key={m.id}
                  points={[
                    ...m.points,
                    ...(["area", "perimeter"].includes(m.tool)
                      ? [m.points[0]]
                      : []),
                  ]
                    .map((p) => p.join(","))
                    .join(" ")}
                  fill={m.tool === "area" ? "#357ca822" : "none"}
                  stroke="#347ba2"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {mode !== "compare" &&
              allMeasurements
                .filter((m) => m.tool === "point" && m.points[0])
                .map((m) => (
                  <circle
                    key={`point-${m.id}`}
                    cx={m.points[0][0]}
                    cy={m.points[0][1]}
                    r={Math.max(view[2], view[3]) / 150}
                    fill="#fff"
                    stroke="#347ba2"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{m.label}</title>
                  </circle>
                ))}
            {!!points.length && (
              <g>
                <polyline
                  points={points.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke="#235347"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
                {points.map(([x, y], i) => (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={Math.max(view[2], view[3]) / 100}
                    fill="#fff"
                    stroke="#235347"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )}
          </svg>
          {mode === "compare" && secondary && layout === "side_by_side" && (
            <svg
              viewBox={sourceBounds(secondary, other.width, other.height).join(
                " ",
              )}
              role="img"
              aria-label={`Compared source: ${secondary.name}`}
            >
              {drawLayer(
                secondary,
                other.url,
                "#286a9b",
                sourceBounds(secondary, other.width, other.height),
              )}
            </svg>
          )}
        </div>
      )}
      <footer className={styles.canvasFooter}>
        <span>
          {source?.kind === "geometry"
            ? "Retained geometry · metres"
            : "Original document coordinates"}
        </span>
        <span>
          {mode === "compare"
            ? "Visual comparison · no automatic clearance decision"
            : mode === "calibrate"
              ? `${points.length} / 2 points · apply calibration in Controls`
              : canDraw
                ? `${points.length} points · Enter to finish · Esc to clear`
                : "Drag to pan"}
        </span>
      </footer>
    </section>
  );
}
