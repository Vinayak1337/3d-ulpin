"use client";
import { useMemo, useState } from "react";
import type {
  CanonicalFactProperty,
  FactCandidate,
  ImportPackage,
  SourceLocator,
} from "@ulpin/contracts";
import AssistancePanel from "./AssistancePanel";
import PreparationBuild from "@/components/PreparationBuild";
import PreparationPlacement from "@/components/PreparationPlacement";
import { Button, Badge, Dialog, EmptyState } from "../shared/ui";
import { request } from "../shared/hooks";
import { routes } from "../shared/routes";
import { metricPoints } from "./measurement";
import type { CanvasSource, Measurement } from "./types";
import type { Workspace } from "./useWorkspace";
import styles from "./Workspace.module.css";
const properties: Partial<Record<CanonicalFactProperty, string>> = {
  "space.label": "Space name",
  "space.levelLabel": "Floor name",
  "space.lower": "Lower level",
  "space.upper": "Upper level",
  "building.exteriorHeight": "Exterior height",
  "building.floorCount": "Storeys",
  "source.date": "Source date",
};
const label = (fact: FactCandidate) =>
  properties[fact.property as CanonicalFactProperty] ||
  fact.property.split(".").at(-1)?.replace("geometry", "Boundary") ||
  fact.property;
const displayValue = (value: unknown) =>
  typeof value === "object" && value !== null
    ? (value as { type?: string }).type
      ? `${(value as { type: string }).type} source geometry`
      : "Structured source value"
    : String(value);
export default function BuildPanel({
  workspace,
  source,
  measurements,
  disabled,
  onBusy,
  onModel,
  onAssign,
}: {
  workspace: Workspace;
  source?: CanvasSource;
  measurements: Measurement[];
  disabled: boolean;
  onBusy: (message: string) => void;
  onModel: () => void;
  onAssign: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [partId, setPartId] = useState(""),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<FactCandidate | null>(null),
    [trace, setTrace] = useState<Measurement | null>(null);
  const [property, setProperty] =
    useState<CanonicalFactProperty>("space.label");
  const pkg = workspace.pkg,
    prep = workspace.preparation;
  const part = useMemo(
    () =>
      pkg?.parts.find((p) => p.id === partId) ||
      source?.parts[0] ||
      pkg?.parts[0],
    [pkg?.parts, source?.parts, partId],
  );
  const evidence: SourceLocator[] = part
    ? [{ sourceRevisionId: part.sourceRevisionId, partId: part.id }]
    : [];
  const missing = workspace.requirements
    ? Object.entries(workspace.requirements)
        .filter(([key]) => ["detailedSpaces", "placement"].includes(key))
        .flatMap(([, items]) => items)
    : [];
  const facts =
    pkg?.factCandidates.filter((f) => f.entityId === workspace.buildingId) ||
    [];
  const subjects = [...new Set(facts.map((f) => f.subject || "Building"))];
  const activeSubject = subjects.includes(subject) ? subject : subjects[0];
  const shownFacts = facts.filter(
    (f) => (f.subject || "Building") === activeSubject,
  );
  const selectedCount = facts.filter((f) =>
    pkg?.selectedClaimIds?.includes(f.id),
  ).length;
  const numeric = [
    "space.lower",
    "space.upper",
    "building.exteriorHeight",
    "building.floorCount",
  ].includes(property);
  const level = [
    "space.lower",
    "space.upper",
    "building.exteriorHeight",
  ].includes(property);
  const traces = measurements.filter(
    (m) =>
      m.tool === "area" &&
      m.calibration?.method === "control_points" &&
      m.calibration.frame === prep?.placement.sourceFrame &&
      m.sourceId === source?.id &&
      m.sourceHash === source?.hash,
  );
  if (!workspace.buildingId)
    return (
      <div className={styles.modePanel}>
        <h2>Build details</h2>
        <EmptyState
          title="Assign a property first"
          description="Originals and local measurements stay in this draft."
          action={
            <Button variant="primary" onClick={onAssign}>
              Assign property
            </Button>
          }
        />
      </div>
    );
  if (!pkg || !prep)
    return (
      <div className={styles.modePanel}>
        <h2>Build details</h2>
        <EmptyState
          title="Create the preparation draft"
          description="The recorded property remains unchanged."
          action={
            <Button
              variant="primary"
              disabled={workspace.busy}
              onClick={() => void workspace.open()}
            >
              Create workspace
            </Button>
          }
        />
      </div>
    );
  return (
    <div className={styles.modePanel}>
      <div className={styles.panelHeading}>
        <h2>Build details</h2>
        <Badge tone={missing.length ? "warning" : "info"}>
          {missing.length ? `${missing.length} to resolve` : "Review ready"}
        </Badge>
      </div>
      <div className={styles.progressSteps}>
        <span>Documents</span>
        <span>Facts</span>
        <span>Placement</span>
        <span>Review</span>
      </div>
      <label className={styles.field}>
        Evidence for a new fact
        <select
          value={part?.id || ""}
          onChange={(event) => setPartId(event.target.value)}
        >
          <option value="">Select a source part</option>
          {pkg.parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.locator} · {p.text.slice(0, 48) || "Original image"}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.panelHeading}>
        <h3>Source facts</h3>
        <span>
          {selectedCount} / {facts.length} reviewed
        </span>
      </div>
      {!facts.length && (
        <p className={styles.muted}>
          Upload source schedules or enter a supported fact.
        </p>
      )}
      <AssistancePanel
        key={pkg.id}
        pkg={pkg}
        buildingId={workspace.buildingId}
        source={source}
        onUpdated={workspace.updatePackage}
        disabled={disabled}
        onBusy={onBusy}
      />
      {subjects.length > 1 && (
        <label className={styles.field}>
          Review a space
          <select
            aria-label="Space to review"
            value={activeSubject}
            onChange={(e) => setSubject(e.target.value)}
          >
            {subjects.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      )}
      <div className={styles.facts}>
        {shownFacts.map((fact) => (
          <article key={fact.id} className={styles.fact}>
            <div>
              <strong>{label(fact)}</strong>
              <Badge
                tone={
                  pkg.selectedClaimIds?.includes(fact.id)
                    ? "success"
                    : "warning"
                }
              >
                {pkg.selectedClaimIds?.includes(fact.id)
                  ? "Selected"
                  : "Review"}
              </Badge>
            </div>
            <small>{fact.subject || workspace.dossier?.building.name}</small>
            <b>
              {displayValue(fact.value)} {fact.unit || ""}
            </b>
            {fact.referenceFrameId && <small>{fact.referenceFrameId}</small>}
            <footer>
              <a
                href={routes.source(fact.evidence[0]?.sourceRevisionId || "")}
                target="_blank"
                rel="noreferrer"
              >
                Source ↗
              </a>
              {!pkg.selectedClaimIds?.includes(fact.id) && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => setSelected(fact)}
                >
                  Review value
                </Button>
              )}
            </footer>
          </article>
        ))}
      </div>
      <Button
        disabled={disabled || !part}
        onClick={() => setEditing(true)}
        icon="plus"
      >
        Add source fact
      </Button>
      {!!traces.length && (
        <details>
          <summary>Use a calibrated trace</summary>
          <p className={styles.muted}>
            Control points and the traced outline will be retained as
            candidates.
          </p>
          {traces.map((m) => (
            <Button
              key={m.id}
              disabled={disabled || !part}
              onClick={() => setTrace(m)}
            >
              {m.label} · {m.value?.toFixed(2)} m²
            </Button>
          ))}
        </details>
      )}
      {!!missing.length && (
        <div className={styles.notice}>
          <h3>Still needed</h3>
          <ul>
            {missing.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.flow}>
        <PreparationPlacement
          preparation={prep}
          evidence={evidence}
          disabled={disabled}
          onBusyChange={(busy) => onBusy(busy ? "Saving placement…" : "")}
          onSaved={async (value) => {
            workspace.setPreparation(value);
            await workspace.refresh();
          }}
        />
        <PreparationBuild
          preparation={prep}
          editorUrl={`${routes.case(prep.caseId)}/geometry?building=${prep.buildingId}&area=${prep.areaId}`}
          pkg={pkg}
          disabled={disabled}
          onBusy={onBusy}
          onPackage={workspace.updatePackage}
          onRecorded={() => void workspace.refresh()}
        />
      </div>
      {workspace.detail?.model && (
        <Button icon="cube" onClick={onModel}>
          Inspect actual 3D draft
        </Button>
      )}
      <Dialog
        open={!!selected}
        title="Review source value"
        onClose={() => setSelected(null)}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected) return;
            const reason = String(
              new FormData(event.currentTarget).get("reason"),
            );
            void workspace.run(async () => {
              const updated = await request<ImportPackage>(
                `/import-packages/${pkg.id}/resolve-fact`,
                {
                  expectedRevision: pkg.revision,
                  claimId: selected.id,
                  reason,
                },
              );
              await workspace.updatePackage(updated);
              setSelected(null);
            });
          }}
        >
          {selected && (
            <>
              <strong>
                {label(selected)} · {displayValue(selected.value)}{" "}
                {selected.unit}
              </strong>
              <p>{selected.referenceFrameId}</p>
              {selected.evidence.map((e, i) => (
                <a
                  key={i}
                  href={routes.source(e.sourceRevisionId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open cited source {i + 1} ↗
                </a>
              ))}
            </>
          )}
          <label>
            Why does the source support this value?
            <textarea name="reason" required />
          </label>
          {workspace.error && (
            <p role="alert" className={styles.error}>
              {workspace.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={disabled}>
            Use reviewed value
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={editing}
        title="Add a supported source fact"
        onClose={() => setEditing(false)}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void workspace.run(async () => {
              const value = await request<ImportPackage>(
                `/import-packages/${pkg.id}/preparation-facts`,
                {
                  expectedRevision: pkg.revision,
                  subject: String(data.get("subject")),
                  property,
                  value: numeric
                    ? Number(data.get("value"))
                    : String(data.get("value")),
                  ...(level
                    ? {
                        unit: "m",
                        referenceFrameId: String(data.get("reference")),
                      }
                    : {}),
                  evidence,
                },
              );
              await workspace.updatePackage(value);
              setEditing(false);
            });
          }}
        >
          <label>
            Space or subject
            <input
              name="subject"
              maxLength={60}
              required
              placeholder="Space alias from the plan"
            />
          </label>
          <label>
            Source fact
            <select
              value={property}
              onChange={(event) =>
                setProperty(event.target.value as CanonicalFactProperty)
              }
            >
              {Object.entries(properties).map(([key, value]) => (
                <option value={key} key={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Value{level ? " · metres" : ""}
            <input
              key={property}
              name="value"
              type={numeric ? "number" : "text"}
              step="any"
              required
            />
          </label>
          {level && (
            <label>
              Level reference
              <input
                name="reference"
                required
                defaultValue={
                  prep.placement.sourceVerticalReference ||
                  prep.placement.verticalReference
                }
                placeholder="Reference named on source"
              />
            </label>
          )}
          <p className={styles.muted}>
            Cites {part?.locator}. A new candidate still needs review.
          </p>
          {workspace.error && (
            <p role="alert" className={styles.error}>
              {workspace.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={disabled || !part}>
            Save candidate
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={!!trace}
        title="Retain the calibrated boundary"
        onClose={() => setTrace(null)}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!trace || !source || !trace.calibration) return;
            const subject = String(
              new FormData(event.currentTarget).get("subject"),
            );
            void workspace.run(async () => {
              const ps = metricPoints(source, trace.points, trace.calibration);
              let current = await request<ImportPackage>(
                `/import-packages/${pkg.id}/preparation-facts`,
                {
                  expectedRevision: pkg.revision,
                  subject,
                  property: "placement.controls",
                  value: trace.calibration,
                  unit: "m",
                  referenceFrameId: trace.calibration!.frame,
                  evidence,
                },
              );
              current = await request<ImportPackage>(
                `/import-packages/${pkg.id}/preparation-facts`,
                {
                  expectedRevision: current.revision,
                  subject,
                  property: "space.geometry",
                  value: { type: "Polygon", coordinates: [[...ps, ps[0]]] },
                  unit: "m",
                  referenceFrameId: trace.calibration!.frame,
                  evidence,
                },
              );
              await workspace.updatePackage(current);
              setTrace(null);
            });
          }}
        >
          <p>
            Retains the original pixel controls, documented metre coordinates
            and traced boundary. It remains a candidate until reviewed.
          </p>
          <label>
            Space alias
            <input name="subject" maxLength={60} required />
          </label>
          <p className={styles.muted}>
            The plan must evidence this space; an exterior outline alone does
            not establish an interior unit.
          </p>
          {workspace.error && (
            <p role="alert" className={styles.error}>
              {workspace.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={disabled}>
            Save trace and controls
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
