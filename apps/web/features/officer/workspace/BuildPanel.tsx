"use client";
import { useMemo, useState } from "react";
import type {
  CanonicalFactProperty,
  FactCandidate,
  ImportPackage,
  SourceLocator,
} from "@ulpin/contracts";
import { evidenceLabel, evidencePage, groupPreparationFacts } from "./fact-review";
import AssistancePanel from "./AssistancePanel";
import SpatialExtractionPanel from "./ml/SpatialExtractionPanel";
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
  onSource,
}: {
  workspace: Workspace;
  source?: CanvasSource;
  measurements: Measurement[];
  disabled: boolean;
  onBusy: (message: string) => void;
  onModel: () => void;
  onAssign: () => void;
  onSource?: (id: string, page?: number) => void;
}) {
  const [partId, setPartId] = useState(""),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<FactCandidate | null>(null),
    [correction, setCorrection] = useState<FactCandidate | null>(null),
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
    : ["Checking required source details…"];
  const facts =
    pkg?.factCandidates.filter((f) => f.entityId === workspace.buildingId) ||
    [];
  const grouped = groupPreparationFacts(facts, pkg?.selectedClaimIds);
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
        <h2>Review source details</h2>
        {!pkg && <p><a className="ui-button ui-button--primary" href={`${routes.addFiles(workspace.intakeAreaId, undefined, workspace.caseId)}&context=1`}>Choose a block for imagery extraction</a></p>}
        {pkg?.sourceWorkspace && <SpatialExtractionPanel pkg={pkg} sources={workspace.sources} disabled={disabled} onUpdated={workspace.updatePackage} />}
        <details>
          <summary>Link sources to an existing property</summary>
          <p>Optional for imagery. Floor-plan regions need a property and reviewed placement before they can become detailed records.</p>
          <Button variant="ghost" onClick={onAssign}>Choose property</Button>
        </details>
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
  const sourceOptions = (
    <label className={styles.field}>
      Cited source location
      <select value={part?.id || ""} onChange={(event) => setPartId(event.target.value)}>
        <option value="">Select a source location</option>
        {pkg.parts.map((p) => <option key={p.id} value={p.id}>
          {evidenceLabel({ sourceRevisionId: p.sourceRevisionId, partId: p.id }, pkg, workspace.sources)} · {p.locator}
        </option>)}
      </select>
      {part && <a href={routes.source(part.sourceRevisionId)} target="_blank" rel="noreferrer">Open cited original ↗</a>}
    </label>
  );
  const factCard = (fact: FactCandidate) => {
    const reviewed = pkg.selectedClaimIds?.includes(fact.id);
    return <article key={fact.id} className={styles.fact}>
      <div><strong>{label(fact)}</strong><Badge tone={reviewed ? "success" : grouped.conflictingIds.has(fact.id) ? "warning" : "info"}>
        {reviewed ? "Reviewed" : grouped.conflictingIds.has(fact.id) ? "Conflicting values" : "Suggested"}
      </Badge></div>
      <small>{fact.subject || workspace.dossier?.building.name}</small>
      <b>{displayValue(fact.value)} {fact.unit || ""}</b>
      {fact.referenceFrameId && <small>Reference: {fact.referenceFrameId}</small>}
      {fact.evidence.map((evidence, index) => <div className={styles.factSource} key={index}>
        <a href={routes.source(evidence.sourceRevisionId)} target="_blank" rel="noreferrer">
          {evidenceLabel(evidence, pkg, workspace.sources)} ↗
        </a>
        {onSource && workspace.sources.some((value) => value.id === evidence.sourceRevisionId) &&
          <Button variant="ghost" onClick={() => onSource(evidence.sourceRevisionId, evidencePage(evidence, pkg))}>Show source</Button>}
      </div>)}
      <footer><Button variant={!reviewed && fact.id === grouped.pending[0]?.id ? "primary" : "ghost"}
        disabled={disabled} onClick={() => setSelected(fact)}>{reviewed ? "Review / change value" : "Review value"}</Button></footer>
    </article>;
  };
  return (
    <div className={styles.modePanel}>
      <div className={styles.panelHeading}>
        <h2>Review details</h2>
        <Badge tone={missing.length ? "warning" : "info"}>
          {missing.length ? `${missing.length} to resolve` : "Source details ready"}
        </Badge>
      </div>
      <p className={styles.muted}>Draft changes are saved. The register changes only after explicit recording.</p>
      {!missing.length && <div className={styles.flow}>
        <PreparationBuild preparation={prep} pkg={pkg} disabled={disabled} onBusy={onBusy}
          editorUrl={`${routes.case(prep.caseId)}/geometry?building=${prep.buildingId}&area=${prep.areaId}`}
          recordUrl={routes.register(prep.buildingId, prep.areaId)}
          missing={missing} onPackage={workspace.updatePackage} onRecorded={() => void workspace.refresh()} />
      </div>}
      {!!missing.length && <div className={styles.notice}>
        <h3>Still needed</h3><p>{missing[0]}</p>
        {missing.length > 1 && <details><summary>{missing.length - 1} more requirements</summary><ul>
          {missing.slice(1).map((item, index) => <li key={index}>{item}</li>)}
        </ul></details>}
      </div>}
      <div className={styles.panelHeading}><h3>Source facts</h3><span>{grouped.reviewed.length} reviewed</span></div>
      {!facts.length && <p className={styles.muted}>Add source schedules or enter a supported fact.</p>}
      {!!grouped.pending.length && <div className={styles.facts} aria-label="Source facts needing review">
        {grouped.pending.map(factCard)}
      </div>}
      {!!grouped.reviewed.length && <details className={styles.factDisclosure}>
        <summary>Reviewed details ({grouped.reviewed.length})</summary>
        <div className={styles.facts}>{grouped.reviewed.map(factCard)}</div>
      </details>}
      {!!grouped.alternatives.length && <details className={styles.factDisclosure}>
        <summary>Other source values ({grouped.alternatives.length})</summary>
        <p className={styles.muted}>These alternatives remain retained. Reviewing one replaces the selected value for that subject and fact.</p>
        <div className={styles.facts}>{grouped.alternatives.map(factCard)}</div>
      </details>}
      <Button disabled={disabled || !part} onClick={() => { setCorrection(null); setEditing(true); }} icon="plus">Add source fact</Button>
      <details className={styles.factDisclosure}>
        <summary>Read details from a source</summary>
        <AssistancePanel key={pkg.id} pkg={pkg} buildingId={workspace.buildingId} source={source}
          onUpdated={workspace.updatePackage} disabled={disabled} onBusy={onBusy} />
        <SpatialExtractionPanel key={`spatial-${pkg.id}`} pkg={pkg} buildingId={workspace.buildingId}
          preparation={prep} sources={workspace.sources} onUpdated={workspace.updatePackage} disabled={disabled} />
      </details>
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
      <div className={styles.flow}>
        <details className={styles.factDisclosure} open={prep.placement.status !== "reviewed"}>
          <summary>{prep.placement.status === "reviewed" ? "Reviewed placement" : "Confirm source placement"}</summary>
          <p className={styles.muted}>{prep.placement.verticalReference}</p>
          {sourceOptions}
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
        </details>
      </div>
      {workspace.detail?.model && (
        <Button icon="cube" onClick={onModel}>
          Inspect computed 3D model
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
          {selected && properties[selected.property as CanonicalFactProperty] && <Button
            disabled={disabled} onClick={() => {
              setCorrection(selected);
              setProperty(selected.property as CanonicalFactProperty);
              setPartId(selected.evidence[0]?.partId || "");
              setSelected(null);
              setEditing(true);
            }}>Enter a corrected candidate</Button>}
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
          {sourceOptions}
          <label>
            Space or subject
            <input
              name="subject"
              defaultValue={correction?.subject}
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
              defaultValue={correction?.property === property ? String(correction.value) : undefined}
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
          {sourceOptions}
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
