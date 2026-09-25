"use client";
import type { RegistryRecord } from "@ulpin/contracts";
import { Icon } from "../shared/ui";
import type { BlockController } from "./useBlock";
import { displayClass, recordOutline, rightsClass, utilityType, type ColourBy } from "./mapStyleModel";

const modes: { value: ColourBy; label: string }[] = [
  { value: "none", label: "None" }, { value: "rights", label: "Rights" },
  { value: "readiness", label: "Readiness" }, { value: "findings", label: "Findings" },
  { value: "utilities", label: "Utilities" },
];
const kinds = ["stilt", "basement", "lower_ground", "ground", "mezzanine", "typical", "terrace", "rooftop_structure"] as const;

function namedKind(record: RegistryRecord): string {
  // Older saved records have no levelKind. Their source name remains authoritative.
  const candidate = (record as RegistryRecord & { levelKind?: unknown }).levelKind;
  return typeof candidate === "string" && kinds.includes(candidate as typeof kinds[number])
    ? candidate.replaceAll("_", " ") : "Level kind not supplied";
}

export function LevelRail({ block }: { block: BlockController }) {
  const floors = block.dossier.data?.records.filter(record => record.kind === "floor") ?? [];
  if (block.selected?.kind !== "building") return null;
  const levels = floors.map(record => {
    const detail = block.dossier.data?.detailedScene.find(item => item.record.id === record.id);
    const lower = detail?.lower ?? record.geometry?.lower;
    return { record, lower, reference: detail?.verticalReference };
  });
  const numeric = levels.filter(level => typeof level.lower === "number" && Number.isFinite(level.lower));
  const references = [...new Set(numeric.map(level => level.reference))];
  const sharedReference = references.length === 1 && references[0] ? references[0] : null;
  const selected = block.recordId;
  const move = (index: number, delta: number) => {
    const next = floors[index + delta];
    if (next) { block.selectRecord(next.id); document.getElementById(`ui-level-${next.id}`)?.focus(); }
  };
  return <aside className="ui-level-rail" aria-label="Recorded levels">
    <header><Icon name="layers" size={16}/><span>Levels {numeric.length > 0 && <small>{sharedReference ? `m · ${sharedReference}` : "Per-level source references"}</small>}</span></header>
    {block.dossier.loading ? <p>Loading recorded levels…</p> : !floors.length ? <p>Levels not supplied</p> :
      <div className="ui-level-list">{levels.map(({record,lower,reference}, index) => {
        return <button id={`ui-level-${record.id}`} key={record.id} aria-pressed={selected === record.id} onClick={() => block.selectRecord(record.id)}
          onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(index, event.key === "ArrowDown" ? 1 : -1); } }}>
          <strong>{record.name}</strong><small>{namedKind(record)}</small><span>{typeof lower === "number" && Number.isFinite(lower) ? `${lower} m${sharedReference ? "" : ` · ${reference || "reference not supplied"}`}` : "? · elevation unknown"}</span>
        </button>;
      })}</div>}
  </aside>;
}

export function MapColourControl({ block }: { block: BlockController }) {
  const mode = block.preferences.colourBy;
  return <div className="ui-map-presentation" role="group" aria-label="Map presentation">
    <label>Colour by <select aria-label="Colour by" value={mode} onChange={event => block.setPreferences({ colourBy: event.target.value as ColourBy })}>
      {modes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <label className="ui-underground-switch" title="The saved source does not link ground level to this scene's vertical frame"><input type="checkbox" checked={false} disabled aria-describedby="ui-underground-reason"/><span>Underground<small id="ui-underground-reason">No scene ground tie</small></span></label>
  </div>;
}

export function MapLegend({ block }: { block: BlockController }) {
  const mode = block.preferences.colourBy;
  const features = block.visibleFeatures;
  const records = block.dossier.data?.records.filter(record => record.kind === "space") ?? [];
  const counts = {
    claim: records.filter(record => rightsClass(record) === "claim").length,
    shared_use: records.filter(record => rightsClass(record) === "shared_use").length,
    easement: records.filter(record => rightsClass(record) === "easement").length,
  };
  const utilityTypes = [...new Set(features.filter(feature => feature.kind === "utility").map(utilityType))];
  const findings = block.context.data?.latestCheck;
  const legend = mode === "rights" ? [
    ["claim", "Ownership claim"], ["shared_use", "Shared use"], ["easement", "Easement"], ["unknown", "Unknown"]
  ] : mode === "findings" ? [["finding", "Saved finding participant"], ["unknown", "Not highlighted"]]
    : mode === "utilities" ? utilityTypes.filter(type => type !== "unknown").map(type => [type, type.charAt(0).toUpperCase() + type.slice(1)])
    : [];
  const unknownHeight = features.filter(feature => feature.kind === "building" && (feature.height.value == null || feature.height.state === "unknown" || feature.height.state === "unresolved")).length;
  const estimated = features.filter(feature => displayClass(feature) === "estimated").length;
  const illustrative = features.filter(feature => displayClass(feature) === "illustrative").length;
  const evidenceLinked = features.filter(feature => displayClass(feature) === "evidence_linked").length;
  const evidenceUnknown = features.filter(feature => displayClass(feature) === "unknown").length;
  const statuses = [...new Set(features.map(recordOutline))];
  return <aside className="ui-presentation-legend" aria-label="Map legend" tabIndex={0}>
      {mode !== "none" && <section><h2>{modes.find(item => item.value === mode)?.label}</h2>
        {mode === "readiness" ? <p>Not assessed for a named task in this area.</p> :
          mode === "findings" && (!findings || findings.stale) ? <p>{findings?.stale ? "Saved check out of date" : "Not assessed"}</p> :
          mode === "utilities" && !utilityTypes.length ? <p>No utility survey supplied</p> :
          mode === "utilities" && utilityTypes.every(type => type === "unknown") ? <p>Utility type not supplied</p> :
          mode === "rights" && !records.length ? <p>Select a building with recorded spaces to inspect rights.</p> :
          <ul>{legend.map(([key, label]) => <li key={key}><i className={`ui-legend-swatch ui-legend-${key}`}/>{label}{mode === "rights" && key in counts ? ` · ${counts[key as keyof typeof counts]}` : ""}</li>)}</ul>}
      </section>}
      <section><h2>Geometry and records</h2><ul>
        {evidenceLinked > 0 && <li><i className="ui-legend-swatch ui-legend-evidence"/>Evidence linked · {evidenceLinked}</li>}
        {estimated > 0 && <li><i className="ui-legend-swatch ui-legend-estimated"/>Estimated · {estimated}</li>}
        {illustrative > 0 && <li><i className="ui-legend-swatch ui-legend-illustrative"/>Illustrative · {illustrative}</li>}
        {evidenceUnknown > 0 && <li><i className="ui-legend-swatch ui-legend-unknown"/>Evidence class unknown · {evidenceUnknown}</li>}
        {statuses.includes("recorded") && <li><i className="ui-legend-outline"/>Recorded outline</li>}
        {statuses.includes("draft") && <li><i className="ui-legend-outline ui-legend-draft"/>Draft outline</li>}
        {statuses.includes("retired") && <li><i className="ui-legend-outline ui-legend-retired"/>Retired outline</li>}
        {statuses.includes("unknown") && <li><i className="ui-legend-outline ui-legend-unknown-outline"/>Record status unknown</li>}
        {unknownHeight > 0 && <li>{unknownHeight} building{unknownHeight === 1 ? "" : "s"} · height unknown</li>}
        {mode === "utilities" && features.some(feature => feature.kind === "utility" && !feature.verticalExtent) && <li>Depth not supplied for some utilities</li>}
      </ul></section>
    </aside>;
}
