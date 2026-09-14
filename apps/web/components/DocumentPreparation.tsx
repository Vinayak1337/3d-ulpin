"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AreaGeometry,
  BuildingDossier,
  CanonicalFactProperty,
  FactCandidate,
  ImportPackage,
  PhysicalFeature,
  PreparationCase,
  PreparationRequirements,
  SourceLocator,
} from "@ulpin/contracts";
import type { OfficerAiRun, OfficerAiStatus } from "@/lib/officer-ai-types";
import PreparationPlacement from "./PreparationPlacement";
import PreparationBuild from "./PreparationBuild";
import { registryRequest as request } from "@/lib/registry-client";

const labels: Record<string, string> = {
  "building.exteriorHeight": "Exterior height",
  "building.floorCount": "Number of storeys",
  "space.label": "Space name",
  "space.levelLabel": "Floor name",
  "space.lower": "Space lower level",
  "space.upper": "Space upper level",
  "space.geometry": "Space boundary",
  "outline.geometry": "Outline",
  "outline.role": "Meaning of the outline",
  "placement.controls": "Plan placement",
  "source.date": "Source date",
  "source.status": "Observed or planned",
};
const original = (id: string) => `/api/v1/sources/${id}/file`;
const textValue = (value: unknown) =>
  typeof value === "object" && value !== null
    ? "type" in value
      ? `${String(value.type)} boundary`
      : "Structured source information"
    : String(value ?? "Unknown");
type PreparedPackage = ImportPackage & {
  selectedClaimIds?: string[];
  preparationRequirements?: PreparationRequirements;
};
type SubjectFact = FactCandidate & { subject?: string };

function OutlineInput({
  building,
  preparation,
  onChange,
}: {
  building: PhysicalFeature;
  preparation: PreparationCase;
  onChange: (geometry: AreaGeometry | null) => void;
}) {
  const [a, b, c, d, e, f] = preparation.placement.matrix;
  const inverse = (coordinates: unknown): unknown =>
    Array.isArray(coordinates)
      ? typeof coordinates[0] === "number"
        ? [
            (d * (coordinates[0] - e) - c * (coordinates[1] - f)) /
              (a * d - b * c),
            (-b * (coordinates[0] - e) + a * (coordinates[1] - f)) /
              (a * d - b * c),
          ]
        : coordinates.map(inverse)
      : coordinates;
  const geometry = {
    ...building.geometry,
    coordinates: inverse(building.geometry.coordinates),
  } as AreaGeometry;
  const outline =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates[0]?.[0]
        : [];
  const xs = outline.map((p) => p[0]),
    ys = outline.map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    w = Math.max(10, Math.max(...xs) - minX),
    h = Math.max(10, Math.max(...ys) - minY),
    pad = Math.max(w, h) * 0.15;
  const [corners, setCorners] = useState<number[][]>([]);
  const set = (points: number[][]) => {
    setCorners(points);
    onChange(
      points.length >= 3
        ? { type: "Polygon", coordinates: [[...points, points[0]]] }
        : null,
    );
  };
  if (!outline.length)
    return (
      <p className="area-warning">
        A supported property footprint is needed before tracing a local
        boundary.
      </p>
    );
  const path = (ring: number[][]) =>
    ring.map(([x, y], i) => `${i ? "L" : "M"}${x},${-y}`).join(" ") + " Z";
  return (
    <div className="preparation-outline">
      <p className="area-note">
        Trace the space in this block plan. Corners use the reviewed plan frame;
        the selected source must support this boundary.
      </p>
      <svg
        aria-label="Trace space boundary in the property plan"
        viewBox={`${minX - pad} ${-minY - h - pad} ${w + 2 * pad} ${h + 2 * pad}`}
        onClick={(event) => {
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const point = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(matrix.inverse());
          set([
            ...corners,
            [Number(point.x.toFixed(3)), Number((-point.y).toFixed(3))],
          ]);
        }}
      >
        <path
          d={path(outline)}
          fill="#e4eadf"
          stroke="#81917d"
          vectorEffect="non-scaling-stroke"
        />
        {corners.length > 1 && (
          <path
            d={path(corners)}
            fill="#cd947640"
            stroke="#ac6146"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {corners.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={-y}
            r={Math.max(w, h) * 0.013}
            fill="#aa573e"
          />
        ))}
      </svg>
      <div className="property-action-row">
        <button
          type="button"
          onClick={() => set(corners.slice(0, -1))}
          disabled={!corners.length}
        >
          Undo corner
        </button>
        <button
          type="button"
          onClick={() => set([])}
          disabled={!corners.length}
        >
          Clear
        </button>
        <button
          type="button"
          disabled={
            !(
              (geometry.type === "Polygon" &&
                geometry.coordinates.length === 1) ||
              (geometry.type === "MultiPolygon" &&
                geometry.coordinates.length === 1 &&
                geometry.coordinates[0].length === 1)
            )
          }
          onClick={() => set(outline.slice(0, -1))}
        >
          Use supplied building outline
        </button>
      </div>
      <small>
        {corners.length} corners · close the boundary by saving at least three
        corners
      </small>
    </div>
  );
}

export default function DocumentPreparation({
  preparation,
  building,
  onRefresh,
}: {
  preparation: PreparationCase;
  building: PhysicalFeature;
  onRefresh: () => void;
}) {
  const [pkg, setPackage] = useState<PreparedPackage | null>(null),
    [requirements, setRequirements] = useState<PreparationRequirements | null>(
      null,
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [partId, setPart] = useState(""),
    [property, setProperty] = useState<CanonicalFactProperty>("space.label"),
    [outline, setOutline] = useState<AreaGeometry | null>(null),
    [preview, setPreview] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<OfficerAiStatus | null>(null),
    [aiRun, setAiRun] = useState<OfficerAiRun | null>(null),
    [aiSelected, setAiSelected] = useState<string[]>([]);
  const [currentPreparation, setPreparation] = useState(preparation);
  const [imagePart, setImagePart] = useState(false),
    [imageApproved, setImageApproved] = useState(false),
    [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 }),
    [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => {
    setImagePart(false);
    setImageApproved(false);
    setAnswers({});
  }, [partId]);
  const operation = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    setPackage(null);
    setError("");
    Promise.all([
      request<PreparedPackage>(`/import-packages/${preparation.packageId}`),
      request<PreparationRequirements>(
        `/import-packages/${preparation.packageId}/requirements`,
      ).catch(() => null),
      request<OfficerAiStatus>("/ai/status").catch(() => null),
    ])
      .then(([result, needs, status]) => {
        if (active) {
          setPackage(result);
          setRequirements(needs);
          setPart(result.parts[0]?.id || "");
          setAiStatus(status);
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [preparation.packageId]);
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      onRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Preparation could not be updated.",
      );
    } finally {
      setBusy("");
    }
  };
  const update = async (next: PreparedPackage) => {
    setPackage(next);
    setRequirements(
      await request<PreparationRequirements>(
        `/import-packages/${next.id}/requirements`,
      ).catch(() => next.preparationRequirements || null),
    );
  };
  const selectedPart = pkg?.parts.find((part) => part.id === partId);
  const evidence: SourceLocator[] = selectedPart
    ? [
        {
          sourceRevisionId: selectedPart.sourceRevisionId,
          partId: selectedPart.id,
        },
      ]
    : [];
  const aiInput = {
    partIds: partId ? [partId] : [],
    ...(imagePart
      ? {
          imageContentApproved: imageApproved,
          imageRegions: [
            {
              partId,
              region: {
                x: crop.x / 100,
                y: crop.y / 100,
                width: crop.width / 100,
                height: crop.height / 100,
              },
            },
          ],
        }
      : {}),
    ...(Object.keys(answers).length
      ? {
          answers: Object.entries(answers)
            .filter(([, answer]) => answer.trim())
            .map(([question, answer]) => ({ question, answer })),
        }
      : {}),
  };
  const numeric = [
    "building.exteriorHeight",
    "building.floorCount",
    "space.lower",
    "space.upper",
  ].includes(property);
  const facts = (pkg?.factCandidates || []) as SubjectFact[];
  const missing = useMemo(
    () =>
      requirements
        ? Object.entries(requirements).filter(([, items]) => items.length)
        : [],
    [requirements],
  );
  return (
    <section className="document-preparation">
      <h3>Plans for this building</h3>
      <p className="area-note">
        Add the plan, section and measurement references together. Original
        files and reviewed answers stay with this property.
      </p>
      {busy && (
        <p role="status" className="property-progress">
          {busy}
        </p>
      )}
      {error && (
        <div role="alert" className="area-warning">
          {error}
          <button
            disabled={!!busy}
            onClick={() =>
              void run("Refreshing the current draft…", async () => {
                const [value, dossier] = await Promise.all([
                  request<PreparedPackage>(
                    `/import-packages/${preparation.packageId}`,
                  ),
                  request<BuildingDossier>(`/buildings/${building.id}/dossier`),
                ]);
                await update(value);
                const current = dossier.preparations.find(
                  (item) => item.id === preparation.id,
                );
                if (current) setPreparation(current);
              })
            }
          >
            Refresh draft
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="property-progress">
          {notice}
        </p>
      )}
      {!pkg ? (
        <p role="status">Opening preparation…</p>
      ) : (
        <>
          <form
            className="officer-form"
            onSubmit={(event) => {
              event.preventDefault();
              const files = (
                new FormData(event.currentTarget).getAll("files") as File[]
              ).filter((file) => file.size);
              void run("Reading related documents…", async () => {
                let current = pkg;
                for (const [index, file] of files.entries()) {
                  setBusy(
                    `Reading document ${index + 1} of ${files.length}: ${file.name}`,
                  );
                  const suffix = file.name.split(".").pop()?.toLowerCase();
                  const format =
                    suffix === "jpg"
                      ? "jpeg"
                      : suffix === "txt"
                        ? "text"
                        : suffix;
                  if (
                    !["pdf", "docx", "text", "csv", "png", "jpeg"].includes(
                      format || "",
                    )
                  )
                    throw new Error(
                      `${file.name}: this document type is not supported here. GIS packages belong in Import GIS.`,
                    );
                  const form = new FormData();
                  form.set("file", file);
                  form.set("format", format!);
                  form.set("entityIds", JSON.stringify([building.id]));
                  form.set("expectedRevision", String(current.revision));
                  const response = await fetch(
                    `/api/v1/import-packages/${current.id}/documents`,
                    { method: "POST", body: form },
                  );
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(
                      result.error?.message || `Could not read ${file.name}`,
                    );
                  current = result;
                  setPackage(current);
                }
                await update(current);
                setPart(current.parts[0]?.id || "");
                setNotice(
                  `${files.length} document${files.length === 1 ? "" : "s"} retained. Review extracted parts below.`,
                );
              });
            }}
          >
            <label>
              Plans, sections and references
              <input
                name="files"
                type="file"
                multiple
                required
                accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg"
              />
            </label>
            <button disabled={!!busy} className="area-primary">
              Add related documents
            </button>
          </form>
          {!!pkg.parts.length && (
            <>
              <h3>Source parts</h3>
              <label>
                Evidence for the next fact
                <select
                  value={partId}
                  onChange={(event) => setPart(event.target.value)}
                >
                  {pkg.parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.locator} · {part.text.slice(0, 45)}
                    </option>
                  ))}
                </select>
              </label>
              {selectedPart && (
                <div className="preparation-source">
                  <p>
                    {selectedPart.text ||
                      "This part needs manual interpretation."}
                  </p>
                  <button
                    onClick={() =>
                      setPreview(original(selectedPart.sourceRevisionId))
                    }
                  >
                    Open original source ↗
                  </button>
                </div>
              )}
            </>
          )}
          <details className="preparation-ai">
            <summary>
              Nous assistance{" "}
              <span>
                {aiStatus?.freeVerified
                  ? "Zero-price route listed"
                  : "Setup required"}
              </span>
            </summary>
            <p className="area-note">
              {aiStatus?.message ||
                "Provider status is unavailable. Native preparation remains available."}
            </p>
            <p className="area-note">
              Only the evidence part selected above is included. Source facts
              remain candidates until you review them.
            </p>
            <label className="property-checkbox">
              <input
                type="checkbox"
                checked={imagePart}
                onChange={(event) => {
                  setImagePart(event.target.checked);
                  setImageApproved(false);
                }}
              />
              <span>Include a crop from this PNG or JPEG part</span>
            </label>
            {imagePart && (
              <div className="preparation-image-crop">
                <p className="area-note">
                  Percentages of the original image. PDF image pages need a
                  supported derivative before they can be sent.
                </p>
                <div className="officer-form-pair">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <label key={key}>
                      {
                        {
                          x: "Left",
                          y: "Top",
                          width: "Width",
                          height: "Height",
                        }[key]
                      }{" "}
                      (%)
                      <input
                        type="number"
                        min={key === "width" || key === "height" ? 1 : 0}
                        max="100"
                        value={crop[key]}
                        onChange={(event) => {
                          setCrop((value) => ({
                            ...value,
                            [key]: Number(event.target.value),
                          }));
                          setImageApproved(false);
                        }}
                      />
                    </label>
                  ))}
                </div>
                {selectedPart && (
                  <div className="preparation-crop-preview">
                    <img
                      src={original(selectedPart.sourceRevisionId)}
                      alt="Selected original image for crop review"
                    />
                    <span
                      style={{
                        left: `${crop.x}%`,
                        top: `${crop.y}%`,
                        width: `${crop.width}%`,
                        height: `${crop.height}%`,
                      }}
                    />
                  </div>
                )}
                <label className="property-checkbox">
                  <input
                    type="checkbox"
                    checked={imageApproved}
                    onChange={(event) => setImageApproved(event.target.checked)}
                  />
                  <span>
                    I reviewed this crop and it excludes personal fields.
                  </span>
                </label>
              </div>
            )}
            <div className="property-action-row">
              <button
                disabled={
                  !!busy ||
                  !partId ||
                  (imagePart && !imageApproved) ||
                  !aiStatus?.configured ||
                  !aiStatus.freeVerified
                }
                onClick={() =>
                  void run("Extracting source-linked candidates…", async () => {
                    const result = await request<OfficerAiRun>(
                      `/import-packages/${pkg.id}/ai-extractions`,
                      {
                        expectedRevision: pkg.revision,
                        ...aiInput,
                        entityIds: [building.id],
                        requestKey: operation.current,
                        mode: "live",
                      },
                    );
                    setAiRun(result);
                    setAiSelected(
                      result.candidates.map((candidate) => candidate.id),
                    );
                    operation.current = crypto.randomUUID();
                  })
                }
              >
                Suggest source facts
              </button>
              <button
                disabled={!!busy || !partId || (imagePart && !imageApproved)}
                onClick={() =>
                  void run("Opening prior extraction…", async () => {
                    const result = await request<OfficerAiRun>(
                      `/import-packages/${pkg.id}/ai-extractions`,
                      {
                        expectedRevision: pkg.revision,
                        ...aiInput,
                        entityIds: [building.id],
                        requestKey: crypto.randomUUID(),
                        mode: "cached",
                      },
                    );
                    setAiRun(result);
                    setAiSelected(
                      result.candidates.map((candidate) => candidate.id),
                    );
                  })
                }
              >
                Open cached result
              </button>
            </div>
            {aiRun && (
              <>
                <p className="area-note">
                  {aiRun.cached ? "Cached prior run" : "Extraction run"} ·{" "}
                  {aiRun.state} · {aiRun.model || "No model run"}
                </p>
                {aiRun.message && <p>{aiRun.message}</p>}
                {(aiRun.suggestions ?? []).map((suggestion) => (
                  <div className="area-note" key={suggestion.id}>
                    <strong>
                      Unreviewed {suggestion.kind === "source_role" ? "document role" : "source association"} suggestion
                    </strong>
                    <p>
                      {suggestion.kind === "source_role"
                        ? suggestion.role?.replaceAll("_", " ")
                        : `Entity ${suggestion.matchedIdentifier} (${suggestion.entityId})`}
                    </p>
                    <p>“{suggestion.quote}”</p>
                    <p>{suggestion.rationale}</p>
                    <a href={`/api/v1/sources/${suggestion.sourceRevisionId}/file`} target="_blank" rel="noreferrer">
                      Source {suggestion.locator} ↗
                    </a>
                    {suggestion.imageRegion && <small>Selected crop: {JSON.stringify(suggestion.imageRegion)}</small>}
                    <p>No source role or building association has changed. Review the original evidence in the property preparation.</p>
                  </div>
                ))}
                {aiRun.questions.map((question, index) => (
                  <label key={index}>
                    {question}
                    <textarea
                      value={answers[question] || ""}
                      onChange={(event) =>
                        setAnswers((value) => ({
                          ...value,
                          [question]: event.target.value,
                        }))
                      }
                      placeholder="Clarification only; measurements still require cited source evidence"
                    />
                  </label>
                ))}
                {aiRun.candidates.map((candidate) => (
                  <label className="property-checkbox" key={candidate.id}>
                    <input
                      type="checkbox"
                      checked={aiSelected.includes(candidate.id)}
                      onChange={(event) =>
                        setAiSelected((ids) =>
                          event.target.checked
                            ? [...ids, candidate.id]
                            : ids.filter((id) => id !== candidate.id),
                        )
                      }
                    />
                    <span>
                      {labels[candidate.property] || candidate.property}:{" "}
                      {textValue(candidate.value)} {candidate.unit || ""}
                      <small>
                        {candidate.referenceFrameId
                          ? `Reference: ${candidate.referenceFrameId} · `
                          : ""}
                        {candidate.citations
                          .map((citation) => `“${citation.quote}”`)
                          .join(" · ")}
                      </small>
                    </span>
                  </label>
                ))}
                {!!aiRun.candidates.length && (
                  <button
                    disabled={!!busy || !aiSelected.length}
                    onClick={() =>
                      void run("Adding unresolved candidates…", async () =>
                        update(
                          await request<PreparedPackage>(
                            `/import-packages/${pkg.id}/ai-extractions/${aiRun.id}/apply`,
                            {
                              expectedRevision: pkg.revision,
                              candidateIds: aiSelected,
                            },
                          ),
                        ),
                      )
                    }
                  >
                    Add selected candidates for review
                  </button>
                )}
              </>
            )}
          </details>
          <PreparationPlacement
            disabled={!!busy}
            onBusyChange={(value) => setBusy(value ? "Saving placement…" : "")}
            preparation={currentPreparation}
            evidence={evidence}
            onSaved={async (next) => {
              setPreparation(next);
              await update(
                await request<PreparedPackage>(`/import-packages/${pkg.id}`),
              );
            }}
          />
          <details>
            <summary>Add a source fact</summary>
            <form
              className="officer-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const value =
                  property === "space.geometry"
                    ? outline
                    : numeric
                      ? Number(data.get("value"))
                      : String(data.get("value"));
                if (!evidence.length || value === null) return;
                void run("Saving source fact…", async () =>
                  update(
                    await request<PreparedPackage>(
                      `/import-packages/${pkg.id}/preparation-facts`,
                      {
                        expectedRevision: pkg.revision,
                        subject: String(data.get("subject")),
                        property,
                        value,
                        ...(numeric && property !== "building.floorCount"
                          ? {
                              unit: "m",
                              referenceFrameId:
                                currentPreparation.placement
                                  .sourceVerticalReference ||
                                currentPreparation.placement.verticalReference,
                            }
                          : {}),
                        ...(property === "space.geometry"
                          ? {
                              referenceFrameId:
                                currentPreparation.placement.sourceFrame,
                            }
                          : {}),
                        evidence,
                      },
                    ),
                  ),
                );
              }}
            >
              <label>
                Space or subject
                <input
                  name="subject"
                  required
                  maxLength={60}
                  placeholder="e.g. Ground floor shop 01"
                />
              </label>
              <label>
                What does the source show?
                <select
                  value={property}
                  onChange={(event) =>
                    setProperty(event.target.value as CanonicalFactProperty)
                  }
                >
                  {Object.entries(labels)
                    .filter(
                      ([key]) =>
                        ![
                          "outline.geometry",
                          "outline.role",
                          "placement.controls",
                        ].includes(key),
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              {property === "space.geometry" ? (
                <OutlineInput
                  key={currentPreparation.revision}
                  building={building}
                  preparation={currentPreparation}
                  onChange={setOutline}
                />
              ) : (
                <label>
                  {labels[property]}
                  {numeric && property !== "building.floorCount"
                    ? " (metres)"
                    : ""}
                  <input
                    name="value"
                    type={
                      numeric
                        ? "number"
                        : property === "source.date"
                          ? "date"
                          : "text"
                    }
                    step={numeric ? "any" : undefined}
                    required
                  />
                </label>
              )}
              <button
                disabled={
                  !!busy ||
                  !evidence.length ||
                  (property === "space.geometry" && !outline)
                }
              >
                Save candidate fact
              </button>
              {!evidence.length && (
                <small>Add and select a source part first.</small>
              )}
            </form>
          </details>
          <h3>Review candidates</h3>
          {!facts.length && (
            <p className="area-note">
              No facts have been prepared. Add sources or enter a supported
              value.
            </p>
          )}
          {facts.map((fact) => (
            <div className="preparation-fact" key={fact.id}>
              <strong>
                {labels[fact.property] || fact.property}
                {fact.subject ? ` · ${fact.subject}` : ""}
              </strong>
              <p>
                {textValue(fact.value)} {fact.unit || ""}
              </p>
              <small>
                {fact.method.replaceAll("_", " ")} ·{" "}
                {fact.evidenceState.replaceAll("_", " ")}
              </small>
              {fact.referenceFrameId && (
                <small className="preparation-reference">
                  Reference: {fact.referenceFrameId}
                </small>
              )}
              <div className="property-action-row">
                {fact.evidence.map((location, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() =>
                      setPreview(
                        original(location.sourceRevisionId) +
                          (location.page ? `#page=${location.page}` : ""),
                      )
                    }
                  >
                    Source{" "}
                    {location.page
                      ? `page ${location.page}`
                      : location.row
                        ? `row ${location.row}`
                        : pkg.parts.find((part) => part.id === location.partId)
                            ?.locator || "part"}{" "}
                    ↗
                  </button>
                ))}
              </div>
              {pkg.selectedClaimIds?.includes(fact.id) ? (
                <span className="property-selected-claim">
                  Selected for preparation
                </span>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run("Saving reviewed fact…", async () =>
                      update(
                        await request<PreparedPackage>(
                          `/import-packages/${pkg.id}/resolve-fact`,
                          {
                            expectedRevision: pkg.revision,
                            claimId: fact.id,
                            reason: data.get("reason"),
                          },
                        ),
                      ),
                    );
                  }}
                >
                  <label>
                    Why does this source support the value?
                    <input name="reason" required />
                  </label>
                  <button disabled={!!busy}>Use this fact</button>
                </form>
              )}
            </div>
          ))}
          {!!missing.length && (
            <details open>
              <summary>What is still needed</summary>
              {missing.map(([capability, items]) => (
                <div key={capability}>
                  <h4>
                    {{
                      footprint: "Footprint",
                      exterior: "Exterior",
                      detailedSpaces: "Detailed spaces",
                      placement: "Plan placement",
                      utility: "Utility checks",
                    }[capability] || capability}
                  </h4>
                  {(items as string[]).map((item, index) => (
                    <p className="area-note" key={index}>
                      {item}
                    </p>
                  ))}
                </div>
              ))}
            </details>
          )}
          <PreparationBuild
            preparation={currentPreparation}
            pkg={pkg}
            onPackage={update}
            onRecorded={onRefresh}
            disabled={!!busy}
            onBusy={setBusy}
          />
          <details>
            <summary>Placement and source limits</summary>
            <p className="area-note">
              {currentPreparation.placement.status === "reviewed"
                ? "A reviewed placement is retained."
                : "Placement still needs supporting control evidence."}{" "}
              Heights use {currentPreparation.placement.verticalReference}. No
              global terrain elevation is implied.
            </p>
            {pkg.warnings.slice(-5).map((warning, index) => (
              <p className="area-note" key={index}>
                {warning}
              </p>
            ))}
          </details>
        </>
      )}
      {preview && (
        <div className="property-source-overlay">
          <header>
            <strong>Original source</strong>
            <button
              onClick={() => setPreview(null)}
              aria-label="Close source preview"
            >
              ×
            </button>
          </header>
          <iframe src={preview} title="Original building source" />
          <a href={preview} target="_blank" rel="noreferrer">
            Open source in new tab ↗
          </a>
        </div>
      )}
    </section>
  );
}
