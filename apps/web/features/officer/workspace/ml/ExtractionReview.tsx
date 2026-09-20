"use client";
import { useState } from "react";
import type {
  Point2,
  PreparationCase,
  SpatialMlApplyRequest,
  SpatialMlItem,
  SpatialMlComponent,
} from "@ulpin/contracts";
import { Button } from "../../shared/ui";

function pathOf(geometry: SpatialMlComponent["geometry"]) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .flatMap((rings) =>
      rings.map(
        (ring) =>
          ring.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ") + "Z",
      ),
    )
    .join(" ");
}

export default function ExtractionReview({
  item,
  preparation,
  sourceFrame,
  buildingId,
  revision,
  busy,
  onApply,
}: {
  item: SpatialMlItem;
  preparation?: PreparationCase;
  sourceFrame?: string;
  buildingId?: string;
  revision: number;
  busy: boolean;
  onApply: (payload: SpatialMlApplyRequest) => Promise<void>;
}) {
  const result = item.result!;
  const retained = item.task === "building" ? item.retainedFootprintCalibration : item.applications.at(-1)?.calibration;
  const expectedFrame = item.task === "building" ? (sourceFrame || preparation?.placement.targetFrame) : preparation?.placement.sourceFrame;
  const previous = retained?.rasterSha256 === result.raster.sha256 && retained.frame === expectedFrame ? retained : undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  const [overlay, setOverlay] = useState(true);
  const [pickControl, setPickControl] = useState<0 | 1 | null>(null);
  const [imagePoints, setImagePoints] = useState<[Point2, Point2]>(
    previous?.imagePoints || [
      [0, 0],
      [0, 0],
    ],
  );
  const [worldPoints, setWorldPoints] = useState<[Point2, Point2]>(
    previous?.worldPoints || [
      [0, 0],
      [0, 0],
    ],
  );
  const [frame, setFrame] = useState(
    previous?.frame ||
      expectedFrame || "",
  );
  const [reason, setReason] = useState(previous?.reason || "");
  const [request, setRequest] = useState<{
    signature: string;
    key: string;
  } | null>(null);
  const selectable = (component: SpatialMlComponent) =>
    item.task !== "floor-plan" ||
    !/^(outdoor|wall|walls|railing|background|outside)$/i.test(
      component.className,
    );
  const toggle = (id: string) => {
    if (!selectable(result.components.find((c) => c.id === id)!)) return;
    setSelected((old) =>
      old.includes(id) ? old.filter((v) => v !== id) : [...old, id],
    );
  };
  function changePoint(
    kind: "pixel" | "metre",
    point: number,
    axis: number,
    value: string,
  ) {
    const setter = kind === "pixel" ? setImagePoints : setWorldPoints;
    setter(
      (old) =>
        old.map((p, i) =>
          i === point ? p.map((n, a) => (a === axis ? Number(value) : n)) : p,
        ) as [Point2, Point2],
    );
  }
  async function apply() {
    const payload = {
      expectedRevision: revision,
      entityId: buildingId || "",
      selections: selected.map((componentId) => ({
        componentId,
        subject:
          subjects[componentId]?.trim() ||
          `${result.components.find((c) => c.id === componentId)!.className} ${componentId}`,
      })),
      property:
        item.task === "floor-plan"
          ? ("space.geometry" as const)
          : ("outline.geometry" as const),
      calibration: {
        rasterSha256: result.raster.sha256,
        imagePoints,
        worldPoints,
        frame: frame.trim(),
        reason: reason.trim(),
      },
    };
    const signature = JSON.stringify(payload);
    const key =
      request?.signature === signature ? request.key : crypto.randomUUID();
    setRequest({ signature, key });
    await onApply({ ...payload, requestKey: key });
  }
  return (
    <div className="ml-review">
      <div className="ml-raster-column">
        <div className="ml-toolbar">
          <strong>{result.components.length} suggested regions</strong>
          <label>
            <input
              type="checkbox"
              checked={overlay}
              onChange={(e) => setOverlay(e.target.checked)}
            />{" "}
            Show regions
          </label>
          <a href={result.raster.url} target="_blank" rel="noreferrer">
            Open retained raster ↗
          </a>
        </div>
        <svg
          className="ml-raster"
          aria-label="Retained inference raster and suggested regions"
          viewBox={`0 0 ${result.raster.width} ${result.raster.height}`}
          onClick={(e) => {
            if (pickControl === null) return;
            const svg = e.currentTarget,
              point = svg.createSVGPoint();
            point.x = e.clientX;
            point.y = e.clientY;
            const matrix = svg.getScreenCTM();
            if (!matrix) return;
            const pixel = point.matrixTransform(matrix.inverse());
            if (
              pixel.x < 0 ||
              pixel.y < 0 ||
              pixel.x > result.raster.width ||
              pixel.y > result.raster.height
            )
              return;
            setImagePoints(
              (old) =>
                old.map((p, i) =>
                  i === pickControl
                    ? [Number(pixel.x.toFixed(3)), Number(pixel.y.toFixed(3))]
                    : p,
                ) as [Point2, Point2],
            );
            setPickControl(null);
          }}
        >
          <image
            href={result.raster.url}
            width={result.raster.width}
            height={result.raster.height}
          />
          {overlay &&
            result.components.map((c) => (
              <path
                key={c.id}
                d={pathOf(c.geometry)}
                fillRule="evenodd"
                className={
                  selected.includes(c.id) ? "ml-region selected" : "ml-region"
                }
                vectorEffect="non-scaling-stroke"
                onClick={(e) => {
                  if (pickControl !== null) return;
                  e.stopPropagation();
                  toggle(c.id);
                }}
              >
                <title>
                  {c.className} · model score {c.score.toFixed(3)}
                </title>
              </path>
            ))}
          {imagePoints.map((point, i) => (
            <g
              key={i}
              transform={`translate(${point.join(" ")})`}
              pointerEvents="none"
            >
              <circle
                r={Math.max(result.raster.width / 150, 4)}
                fill={i ? "#be6423" : "#176258"}
                stroke="white"
                strokeWidth="2"
              />
              <text
                y={-result.raster.width / 80}
                fontSize={Math.max(result.raster.width / 50, 12)}
                textAnchor="middle"
                fill="#182f2a"
                stroke="white"
                strokeWidth="1"
                paintOrder="stroke"
              >
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
        <p className="ml-note">
          Pixels · {result.raster.width} × {result.raster.height}.{" "}
          {pickControl === null
            ? "Select regions on the image or in the list."
            : `Choose control ${pickControl + 1} on the retained image.`}{" "}
          Model scores describe the model output, not survey accuracy.
        </p>
        <details>
          <summary>Inference receipt and exact inputs</summary>
          <pre>
            {JSON.stringify(
              {
                sourceRevisionId: item.sourceRevisionId,
                sourceSha256: item.sourceSha256,
                page: item.page,
                inputFingerprint: item.inputFingerprint,
                rasterSha256: result.raster.sha256,
                model: result.model,
                receipt: result.receipt,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
      <div className="ml-review-controls">
        <h3>Review the regions</h3>
        <p>
          {item.task === "building"
            ? "Suggested roof outlines may merge buildings or include other objects. Choose only boundaries supported by this source."
            : "Room and wall classes are suggestions and may merge adjacent spaces. Choose only boundaries supported by this source."}
        </p>
        <div className="ml-components">
          {result.components.map((c, i) => (
            <div key={c.id} className="ml-component">
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  disabled={!selectable(c)}
                  onChange={() => toggle(c.id)}
                />{" "}
                <span>
                  {i + 1}. {c.className}
                  <small>
                    Model score {c.score.toFixed(3)}
                    {!selectable(c) ? " · context only" : ""}
                  </small>
                </span>
              </label>
              {selected.includes(c.id) && (
                <label>
                  Space or outline name
                  <input
                    aria-label={`Name for region ${i + 1}`}
                    value={subjects[c.id] ?? `${c.className} ${c.id}`}
                    onChange={(e) =>
                      setSubjects({ ...subjects, [c.id]: e.target.value })
                    }
                    maxLength={60}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
        <h3>Documented control points</h3>
        {previous && <p role="status">Controls restored from the matching retained source, raster and metre frame.</p>}
        <p>
          Enter two corresponding controls in the named metre frame. This
          transform cannot correct perspective or uneven scan distortion.
        </p>
        {[0, 1].map((i) => (
          <fieldset key={i} className="ml-control-pair">
            <legend>Control {i + 1}</legend>
            <Button
              variant="ghost"
              onClick={() => setPickControl(i as 0 | 1)}
              aria-pressed={pickControl === i}
            >
              Pick control {i + 1} on image
            </Button>
            <div className="ml-coordinate-row">
              {(["pixel", "metre"] as const).map((kind) =>
                [0, 1].map((axis) => (
                  <label key={`${kind}-${axis}`}>
                    {kind === "pixel" ? "Image" : "Metres"} {axis ? "Y" : "X"}
                    <input
                      type="number"
                      step="any"
                      aria-label={`Control ${i + 1} ${kind} ${axis ? "y" : "x"}`}
                      value={
                        (kind === "pixel" ? imagePoints : worldPoints)[i][axis]
                      }
                      onChange={(e) =>
                        changePoint(kind, i, axis, e.target.value)
                      }
                    />
                  </label>
                )),
              )}
            </div>
          </fieldset>
        ))}
        <label>
          Named metre frame
          <input
            value={frame}
            onChange={(e) => setFrame(e.target.value)}
            maxLength={160}
          />
        </label>
        <label>
          Control evidence and review note
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Identify the documented controls and their source."
            maxLength={2000}
          />
        </label>
        {item.task === "floor-plan" && preparation?.placement.status !== "reviewed" && (
          <p className="ml-warning">
            Assign a property and review its placement before applying floor regions.
          </p>
        )}
        <Button
          variant="primary"
          disabled={
            busy ||
            !selected.length ||
            !reason.trim() ||
            !frame.trim() ||
            Math.hypot(imagePoints[1][0]-imagePoints[0][0], imagePoints[1][1]-imagePoints[0][1]) <= 0 ||
            Math.hypot(worldPoints[1][0]-worldPoints[0][0], worldPoints[1][1]-worldPoints[0][1]) <= 0 ||
            (item.task === "floor-plan" &&
              preparation?.placement.status !== "reviewed")
          }
          onClick={() => void apply()}
        >
          {item.task === "building"
            ? `Create footprint draft (${selected.length})`
            : `Send ${selected.length || "selected"} to fact review`}
        </Button>
        <p className="ml-note">
          {item.task === "building"
            ? "Creates a draft for ordinary area review. Roof outlines do not establish parcels, ownership or building heights."
            : "This adds unreviewed geometry facts. Floor levels and heights need separate evidence before building volumes."}
        </p>
        {item.applications.length > 0 && (
          <p role="status">
            {item.applications.length} retained application
            {item.applications.length === 1 ? "" : "s"}. Review the added facts
            in Build details.
          </p>
        )}
      </div>
    </div>
  );
}
