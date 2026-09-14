"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ControlPoint,
  PlanCalibration,
  Point2,
  SourceRevision,
} from "@ulpin/contracts";
import {
  Check,
  Crosshair,
  DownloadSimple as Download,
  FileImage,
  SpinnerGap as LoaderCircle,
  PencilSimple as Pencil,
  ArrowUUpLeft as Undo2,
  X,
} from "@/lib/ui/icons";
import { sourceUrl } from "@/lib/client";
import { transformPoint } from "@/lib/ui/geometry";

interface Props {
  source: SourceRevision;
  controls: ControlPoint[];
  busy: boolean;
  readOnly?: boolean;
  onOpenPreview?: () => void;
  onTrace?: (value: {
    alias: string;
    name: string;
    lower: number;
    upper: number;
    footprint: Point2[];
    calibration: PlanCalibration;
  }) => Promise<boolean>;
}

export default function SourcePreview({
  source,
  controls,
  busy,
  onTrace,
  readOnly = false,
  onOpenPreview,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bodyHost = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState<number>();
  const [dimensions, setDimensions] = useState({
    width: source.inspection?.image?.width || 1000,
    height: source.inspection?.image?.height || 700,
  });
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(source.inspection?.image?.pages || 1);
  const [loading, setLoading] = useState(source.profile === "plan-pdf-v1");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "calibrate" | "trace">(
    "preview",
  );
  const [imagePoints, setImagePoints] = useState<Point2[]>([]);
  const [worldPoints, setWorldPoints] = useState<[Point2, Point2]>([
    [controls[0]?.x ?? 0, controls[0]?.y ?? 0],
    [controls[1]?.x ?? 10, controls[1]?.y ?? 0],
  ]);
  const [points, setPoints] = useState<Point2[]>([]);
  const [alias, setAlias] = useState("TRACE-01");
  const [name, setName] = useState("Traced space");
  const [lower, setLower] = useState("0");
  const [upper, setUpper] = useState("3");
  const isPdf = source.profile === "plan-pdf-v1";
  useEffect(() => {
    const body = bodyHost.current;
    if (!body || readOnly) return;
    const observer = new ResizeObserver(() => {
      const width = Math.max(1, body.clientWidth - 56),
        height = Math.max(1, body.clientHeight - 56);
      setFitWidth(
        Math.min(width, (height * dimensions.width) / dimensions.height),
      );
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [readOnly, dimensions.width, dimensions.height]);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | undefined;
    setLoading(true);
    setError(null);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjs.getDocument({ url: sourceUrl(source.id) });
      loadingTask = task;
      const pdf = await task.promise;
      if (cancelled) return;
      setPages(pdf.numPages);
      const pdfPage = await pdf.getPage(page);
      const viewport = pdfPage.getViewport({ scale: 1.5 });
      const target = canvas.current;
      if (!target || cancelled) return;
      target.width = viewport.width;
      target.height = viewport.height;
      setDimensions({ width: viewport.width, height: viewport.height });
      const context = target.getContext("2d");
      if (!context) throw new Error("Cannot render this PDF in the browser.");
      await pdfPage.render({ canvas: target, canvasContext: context, viewport })
        .promise;
      if (!cancelled) setLoading(false);
    })().catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Preview failed.");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [source.id, page, isPdf]);

  function click(event: React.MouseEvent<SVGSVGElement>) {
    if (mode === "preview" || loading) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    const value: Point2 = [
      Math.round(point.x * 100) / 100,
      Math.round(point.y * 100) / 100,
    ];
    if (mode === "calibrate")
      setImagePoints((old) => (old.length < 2 ? [...old, value] : [value]));
    else setPoints((old) => [...old, value]);
  }
  function calibrate() {
    try {
      transformPoint(
        imagePoints[0],
        imagePoints as [Point2, Point2],
        worldPoints,
      );
      setMode("trace");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid calibration.");
    }
  }
  async function save() {
    if (!onTrace || readOnly) return;
    try {
      if (!alias.trim() || !name.trim())
        throw new Error("Give the new space an alias and a name.");
      if (
        !lower.trim() ||
        !upper.trim() ||
        !Number.isFinite(Number(lower)) ||
        !Number.isFinite(Number(upper)) ||
        Number(upper) <= Number(lower)
      )
        throw new Error(
          "Enter finite elevations with the upper limit above the lower limit.",
        );
      const calibration: PlanCalibration = {
        sourceId: source.id,
        page,
        imagePoints: imagePoints as [Point2, Point2],
        worldPoints,
      };
      const footprint = points.map((p) =>
        transformPoint(p, calibration.imagePoints, worldPoints),
      );
      const saved = await onTrace({
        alias: alias.trim(),
        name: name.trim(),
        lower: Number(lower),
        upper: Number(upper),
        footprint,
        calibration,
      });
      if (!saved) return;
      setMode("preview");
      setPoints([]);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the traced space.",
      );
    }
  }

  return (
    <div className="reference-view">
      <div className="reference-toolbar">
        <div>
          <FileImage size={15} />
          <strong>{source.name}</strong>
          <span>Original reference</span>
        </div>
        <div className="row">
          {readOnly && (
            <div className="row" role="group" aria-label="Preview zoom">
              <button
                className="icon-button"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((value) => value - 0.25)}
              >
                −
              </button>
              <button
                className="button small"
                aria-label="Fit preview to width"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="Zoom in"
                disabled={zoom >= 4}
                onClick={() => setZoom((value) => value + 0.25)}
              >
                +
              </button>
            </div>
          )}
          {isPdf && (
            <label className="page-picker">
              Page{" "}
              <select
                value={page}
                disabled={mode !== "preview"}
                onChange={(e) => setPage(Number(e.target.value))}
              >
                {Array.from({ length: pages }, (_, i) => (
                  <option value={i + 1} key={i}>
                    {i + 1}
                  </option>
                ))}
              </select>{" "}
              of {pages}
            </label>
          )}
          <a
            className="icon-button"
            href={sourceUrl(source.id)}
            download={source.name}
            aria-label="Download original"
          >
            <Download size={16} />
          </a>
          {onOpenPreview && (
            <button className="button small" onClick={onOpenPreview}>
              Preview file
            </button>
          )}
          {!readOnly && (
            <button
              className="button small"
              disabled={loading || (!!error && mode === "preview")}
              onClick={() => {
                setMode(mode === "preview" ? "calibrate" : "preview");
                setImagePoints([]);
                setPoints([]);
                setError(null);
              }}
            >
              {mode === "preview" ? (
                <>
                  <Pencil size={13} />
                  Calibrate & trace
                </>
              ) : (
                <>
                  <X size={13} />
                  Close trace
                </>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="reference-body" ref={bodyHost}>
        <div
          className="reference-paper"
          style={
            readOnly
              ? { width: `${zoom * 100}%`, maxWidth: "none" }
              : fitWidth
                ? { width: fitWidth, maxWidth: "100%" }
                : undefined
          }
        >
          <div
            className={`reference-sheet ${mode !== "preview" ? "crosshair" : ""}`}
          >
            {isPdf ? (
              <canvas ref={canvas} />
            ) : (
              <img
                src={sourceUrl(source.id)}
                alt={`Original plan: ${source.name}`}
                onLoad={(e) =>
                  setDimensions({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
                onError={() => setError("Could not display this plan image.")}
              />
            )}
            {!readOnly && (
              <svg
                viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                onClick={click}
                aria-label={
                  mode === "calibrate"
                    ? "Click two known points on the plan"
                    : "Click vertices to trace a new footprint"
                }
              >
                {imagePoints.length === 2 && (
                  <line
                    x1={imagePoints[0][0]}
                    y1={imagePoints[0][1]}
                    x2={imagePoints[1][0]}
                    y2={imagePoints[1][1]}
                    stroke="#e19b30"
                    strokeWidth={dimensions.width / 350}
                    strokeDasharray="8 6"
                  />
                )}
                {points.length > 0 && (
                  <polygon
                    points={points.map((p) => p.join(",")).join(" ")}
                    fill="#398b7760"
                    stroke="#247662"
                    strokeWidth={dimensions.width / 300}
                  />
                )}
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p[0]}
                    cy={p[1]}
                    r={dimensions.width / 160}
                    fill="#fffefa"
                    stroke="#247662"
                    strokeWidth={dimensions.width / 400}
                  />
                ))}
                {imagePoints.map((p, i) => (
                  <g key={i}>
                    <circle
                      cx={p[0]}
                      cy={p[1]}
                      r={dimensions.width / 100}
                      fill="#d8871f"
                      stroke="white"
                      strokeWidth={dimensions.width / 400}
                    />
                    <text
                      x={p[0]}
                      y={p[1]}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={dimensions.width / 80}
                      fontWeight="700"
                      fill="white"
                    >
                      {i === 0 ? "A" : "B"}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>
        {loading && (
          <div className="preview-loading">
            <LoaderCircle className="spin" size={18} />
            Rendering PDF page…
          </div>
        )}
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {mode === "calibrate" && (
        <div className="trace-panel">
          <div className="trace-heading">
            <Crosshair size={17} />
            <div>
              <strong>01 / Align the reference</strong>
              <span>
                Click two known points, then enter their local coordinates in
                metres. Rendered plan: {Math.round(dimensions.width)} ×{" "}
                {Math.round(dimensions.height)} px.
              </span>
            </div>
          </div>
          <div className="control-points">
            {worldPoints.map((point, i) => (
              <div key={i}>
                <span className="control-letter">{i === 0 ? "A" : "B"}</span>
                <span className="control-picked">
                  {imagePoints[i] ? "Point selected" : "Pick on plan"}
                </span>
                {(["X", "Y"] as const).map((axis, j) => (
                  <label key={axis}>
                    {axis}
                    <input
                      type="number"
                      step="any"
                      value={point[j]}
                      onChange={(e) =>
                        setWorldPoints(
                          (old) =>
                            old.map((p, n) =>
                              n === i
                                ? (p.map((v, a) =>
                                    a === j ? Number(e.target.value) : v,
                                  ) as Point2)
                                : p,
                            ) as [Point2, Point2],
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>
          <button
            className="button primary small"
            disabled={imagePoints.length !== 2}
            onClick={calibrate}
          >
            Use calibration <Check size={14} />
          </button>
        </div>
      )}
      {mode === "trace" && (
        <div className="trace-panel">
          <div className="trace-heading">
            <Pencil size={17} />
            <div>
              <strong>02 / Trace a space</strong>
              <span>
                Click each corner in order. {points.length} vertices ·
                elevations are unverified operator input.
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Undo last vertex"
              disabled={!points.length}
              onClick={() => setPoints((old) => old.slice(0, -1))}
            >
              <Undo2 size={15} />
            </button>
          </div>
          <div className="trace-fields">
            <label>
              Alias
              <input value={alias} onChange={(e) => setAlias(e.target.value)} />
            </label>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Lower / m
              <input
                type="number"
                step="any"
                value={lower}
                onChange={(e) => setLower(e.target.value)}
              />
            </label>
            <label>
              Upper / m
              <input
                type="number"
                step="any"
                value={upper}
                onChange={(e) => setUpper(e.target.value)}
              />
            </label>
          </div>
          <button
            className="button primary small"
            disabled={points.length < 3 || busy}
            onClick={save}
          >
            <Check size={14} />
            Save traced space
          </button>
        </div>
      )}
      {mode === "preview" && !readOnly && (
        <div className="reference-note">
          Reference pixels are not geometry. Calibrate with two control points
          before tracing.
        </div>
      )}
    </div>
  );
}
