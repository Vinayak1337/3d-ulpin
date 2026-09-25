"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SavedSceneViewport from "../../studio/product/SavedSceneViewport";
import { useBlock } from "./useBlock";
import { BlockLeftRail, BlockInspector } from "./BlockRails";
import MapPlan from "./MapPlan";
import FindingsTray from "./FindingsTray";
import { LevelRail, MapColourControl, MapLegend } from "./MapPresentation";
import { rightsClass } from "./mapStyleModel";
import DataTools from "./DataTools";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
} from "../shared/ui";
import { request, useMutation } from "../shared/hooks";
import { routes } from "../shared/routes";
import "./block.css";
import "./data-tools.css";
import "./frame.css";
import "./area-map.css";
export default function BlockPage({ areaId }: { areaId: string }) {
  const block = useBlock(areaId);
  const [tools, setTools] = useState<"import" | "export" | null>(null),
    [packageId, setPackageId] = useState<string>(),
    [panel, setPanel] = useState<"layers" | "spaces" | "sources" | "checks" | null>(null),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [compact, setCompact] = useState(false),
    [sourceDialogOpen, setSourceDialogOpen] = useState(false),
    [explode,setExplode]=useState(0);
  const checksButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null);
  const panelButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const media = window.matchMedia("(max-width: 620px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { setInspectorOpen(true); }, [block.selectedId, block.recordId]);
  const closeChecks = () => { block.setPreferences({ findingsOpen: false }); checksButton.current?.focus(); };
  const togglePanel = (next: NonNullable<typeof panel>) => {
    setPanel(current => current === next ? null : next);
    if (next === "checks") block.setPreferences({ findingsOpen: true });
  };
  const closePanel = () => {
    const previous = panel;
    setPanel(null);
    requestAnimationFrame(() => { if (previous) panelButtons.current[previous]?.focus(); });
  };
  const sheetOpen = compact && (!!panel || (inspectorOpen && !!block.selected));
  useEffect(() => {
    if (!compact || !sheetOpen || sourceDialogOpen || tools) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(panel ? `.ui-on-demand-panel button[aria-label="Close ${panel} panel"]` : '.ui-block-inspector button[aria-label="Close inspector"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [compact, sheetOpen, panel, sourceDialogOpen, tools]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (panel) {
        event.preventDefault();
        setPanel(null);
        if (!compact || !inspectorOpen) requestAnimationFrame(() => panelButtons.current[panel]?.focus());
      } else if (compact && inspectorOpen && block.selected) {
        event.preventDefault();
        setInspectorOpen(false);
        requestAnimationFrame(() => inspectorButton.current?.focus());
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [panel, compact, inspectorOpen, block.selected]);
  const check = useMutation();
  const context = block.context.data;
  useEffect(() => {
    if (block.preferences.underground) block.setPreferences({ underground: false });
    // No dossier field currently ties a saved grade to this scene's display frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, block.world, block.selectedId, block.preferences.underground]);
  const runCheck = () => {
    void check.run(async () => {
      if (!context) return;
      await request("/area-checks", {
        areaId,
        expectedRevision: context.area.revision,
      });
      await block.context.reload();
      block.setPreferences({ findingsOpen: true });
    });
  };
  if (!context)
    return (
      <main className="ui-block-page">
        {block.context.error ? (
          <ErrorState
            message={block.context.error}
            retry={block.context.reload}
          />
        ) : (
          <LoadingState label="Loading the block" />
        )}
        <Link className="ui-button" href={routes.block()}>
          Choose another block
        </Link>
      </main>
    );
  return (
    <main className="ui-block-page">
      {check.error && <ErrorState message={check.error} />}
      {block.context.error && (
        <ErrorState
          message={block.context.error}
          retry={block.context.reload}
        />
      )}
      {block.selectionError && <p className="ui-stale-check" role="alert">{block.selectionError}</p>}
      <div
        className={`ui-block-grid ui-focused-map ${inspectorOpen && block.selected ? "" : "ui-inspector-closed"}`}
      >
        <section className="ui-map-column" aria-label="Shared block map">
          <div className="ui-contextbar" aria-label="Area scope">
            <div className="ui-block-title">
              <Link href={routes.block()} aria-label="Back to all areas"><Icon name="back" size={17} /></Link>
              <h1 title={context.area.name}>{context.area.name}</h1>
              <span className="ui-scope-classification">{context.area.dataKind === "real" ? "Observed" : context.area.dataKind === "demonstration" ? "Synthetic" : context.area.dataKind === "mixed" ? "Mixed" : context.area.dataKind === "empty" ? "No mapped source" : "Unknown"}</span>
              <span className="ui-scope-revision">Revision {context.area.revision}</span>
              {block.selected && <span className="ui-scope-selection" title={block.selectedRecord ? `${block.selected.name} / ${block.selectedRecord.name}` : block.selected.name}>/ {block.selected.name}{block.selectedRecord ? ` / ${block.selectedRecord.name}` : ""}</span>}
            </div>
            <div className="ui-context-actions">
              {sheetOpen && <Button icon="back" aria-label="Back to map" onClick={() => { setPanel(null); setInspectorOpen(false); requestAnimationFrame(() => inspectorButton.current?.focus()); }}><span>Map</span></Button>}
              <Link className="ui-button" href={routes.addFiles(areaId)} aria-label="Add files"><Icon name="upload" size={16} /><span>Add files</span></Link>
              <Button icon="download" aria-label="Export" onClick={() => setTools("export")}><span>Export</span></Button>
            </div>
          </div>
          <div className="area-map-surface" aria-label="Area map canvas">
            <div className="area-map-toolbar" role="group" aria-label="Map controls" tabIndex={0} inert={sheetOpen} aria-hidden={sheetOpen}>
              <div className="ui-map-mode">
                <button
                  aria-pressed={block.preferences.mode === "3d"}
                  onClick={() => block.setPreferences({ mode: "3d" })}
                >
                  <Icon name="cube" size={16} />
                  3D
                </button>
                <button
                  aria-pressed={block.preferences.mode === "2d"}
                  onClick={() => block.setPreferences({ mode: "2d" })}
                >
                  2D Map
                </button>
              </div>
              <div className="ui-panel-switches" role="group" aria-label="Map panels">
                {(["layers", "spaces", "sources", "checks"] as const).map(item => (
                  <button key={item} ref={element => { panelButtons.current[item] = element; }} aria-label={item.charAt(0).toUpperCase() + item.slice(1)} aria-expanded={panel === item} aria-pressed={panel === item} onClick={() => togglePanel(item)}>
                    <Icon name={item === "layers" ? "layers" : item === "spaces" ? "building" : item === "sources" ? "document" : "warning"} size={16} />
                    <span>{item.charAt(0).toUpperCase() + item.slice(1)}</span>
                  </button>
                ))}
              </div>
              <MapColourControl block={block}/>
              <span className="ui-toolbar-spacer" />
              <Button icon="expand" onClick={() => block.navigate("fit")}>
                Fit block
              </Button>
              <Button
                icon="target"
                disabled={!block.selected}
                onClick={() => block.navigate("focus")}
                aria-label="Focus selected property"
              />
            </div>
            <div className="area-map-canvas" inert={sheetOpen} aria-hidden={sheetOpen}>
            {!block.features.length ? (
              <div inert={sheetOpen} aria-hidden={sheetOpen}>
                <EmptyState
                  title="This block has no recorded geometry"
                  description="Import a source, review its mapping and record the observations."
                  icon="map"
                  action={
                    <Button onClick={() => setTools("import")}>
                      Import sources
                    </Button>
                  }
                />
              </div>
            ) : (
              <>
                <div
                  className="ui-renderer"
                  inert={sheetOpen}
                  style={{
                    visibility:
                      block.preferences.mode === "3d" ? "visible" : "hidden",
                  }}
                  aria-hidden={block.preferences.mode !== "3d"}
                >
                  <SavedSceneViewport block={block} world={block.world} recordId={block.recordId} onRecord={block.selectRecord} explode={explode} opacityByKind={block.preferences.opacity}/>

                </div>
                <div
                  className="ui-renderer"
                  inert={sheetOpen}
                  style={{
                    visibility:
                      block.preferences.mode === "2d" ? "visible" : "hidden",
                  }}
                  aria-hidden={block.preferences.mode !== "2d"}
                >
                  <MapPlan
                    features={block.visibleFeatures}
                    extent={context.area.extent}
                    selectedId={block.selectedId}
                    onSelect={(id) => {
                      block.select(id);
                      setInspectorOpen(true);
                    }}
                    navigation={block.navigation}
                    issueGeometry={block.issueGeometry}
                    highlightedIds={block.highlightedIds}
                    featureLabels={block.featureLabels}
                    details={block.recordId?block.details.filter(d=>d.id===block.recordId||block.dossier.data?.records.find(r=>r.id===d.id)?.links.some(l=>l.type==='floor'&&l.targetId===block.recordId)):[]}
                    selectedDetailId={block.recordId}
                    onSelectDetail={block.selectRecord}
                    opacityByKind={block.preferences.opacity}
                    labels={block.preferences.labels}
                    colourBy={block.preferences.colourBy}
                    findingFeatureIds={context.latestCheck?.stale ? [] : context.latestCheck?.findings.flatMap(finding => finding.featureIds) ?? []}
                    detailRights={Object.fromEntries(block.dossier.data?.records.filter(record => record.kind === "space").map(record => [record.id, rightsClass(record)]) ?? [])}
                  />
                </div>
              </>
            )}
            </div>
            {panel && <aside className="ui-on-demand-panel" aria-label={`${panel.charAt(0).toUpperCase() + panel.slice(1)} panel`}>
              <header><h2>{panel.charAt(0).toUpperCase() + panel.slice(1)}</h2><Button variant="ghost" icon="close" aria-label={`Close ${panel} panel`} onClick={closePanel} /></header>
              {panel === "layers" && <BlockLeftRail block={block} mode="layers" />}
              {panel === "spaces" && <div className="ui-panel-list">
                {!block.selected || block.selected.kind !== "building" ? <EmptyState title="Choose a building" description="Its saved floors and spaces will appear here." icon="building" /> : block.dossier.loading ? <LoadingState label="Loading saved spaces" /> : block.dossier.error ? <ErrorState message={block.dossier.error} retry={block.dossier.reload} /> : block.dossier.data?.records.filter(record => record.kind === "floor" || record.kind === "space").length ? block.dossier.data.records.filter(record => record.kind === "floor" || record.kind === "space").map(record => <button key={record.id} aria-current={block.recordId === record.id ? "true" : undefined} onClick={() => { block.selectRecord(record.id); closePanel(); }}><Icon name={record.kind === "floor" ? "layers" : "building"} size={16} /><span><strong>{record.name}</strong><small>{record.identifier} · {record.kind}</small></span></button>) : <EmptyState title="Interior records not supplied" description="Missing floors and spaces are not inferred." icon="layers" />}
              </div>}
              {panel === "sources" && <div className="ui-panel-list">
                {block.dossier.loading && <LoadingState label="Loading source evidence" />}
                {block.dossier.error && <ErrorState message={`Source evidence unavailable: ${block.dossier.error}`} retry={block.dossier.reload} />}
                {block.dossier.data?.sources.map(source => <div className="ui-panel-source" key={source.id}><Icon name="document" size={17} /><span><strong>{source.name}</strong><small>Revision {source.revision} · {source.profile}</small></span></div>)}
                {context.packages.map(pkg => <div className="ui-panel-source" key={pkg.id}><Icon name="upload" size={17} /><span><strong>{pkg.name}</strong><small>{pkg.state.replaceAll("_", " ").toLowerCase()} · revision {pkg.revision}</small></span></div>)}
                {!block.dossier.loading && !block.dossier.error && !block.dossier.data?.sources.length && !context.packages.length && <EmptyState title={block.selected ? "No sources in this scope" : "No source listed"} description={block.selected ? "Import a source to begin an evidence review." : "Select a property to inspect its source evidence, or import a package."} icon="document" />}
              </div>}
              {panel === "checks" && <div className="ui-panel-checks">
                <p>{context.latestCheck ? `${context.latestCheck.findings.length} findings · ${context.latestCheck.stale ? "out of date" : "current saved check"}` : "Not assessed"}</p>
                <Button icon="check" disabled={check.busy} onClick={runCheck}>{check.busy ? "Checking…" : "Run check"}</Button>
                <Button icon="eye" aria-pressed={block.showConflicts} disabled={!block.conflictCount} onClick={block.toggleConflicts}>{block.showConflicts ? "Hide conflicts" : "Show conflicts"}</Button>
              </div>}
            </aside>}
            <div className="area-map-world" inert={sheetOpen} aria-hidden={sheetOpen}><label>Source world <select aria-label="Source world" value={block.world} onChange={e=>block.setWorld(e.target.value)}>{block.worlds.map(w=><option key={w} value={w}>{w==='synthetic'?'Synthetic · test fixture':w==='observed'?'Observed':w==='planned'?'Planned':'Hypothetical'}</option>)}</select></label>{block.selected?.kind==='building'&&block.details.length>0&&<button className="ui-button" aria-pressed={explode>0} onClick={()=>setExplode(v=>v?0:1.8)}>{explode?'Stack floors':'Separate floors'}</button>}{explode > 0 && <span role="status">Display only. Measurements unchanged.</span>}</div>
            <div className="area-map-level" inert={sheetOpen} aria-hidden={sheetOpen}><LevelRail block={block}/></div>
            <div className="area-map-legend" inert={sheetOpen} aria-hidden={sheetOpen}><MapLegend block={block}/></div>
            <div className="area-map-nav" inert={sheetOpen} aria-hidden={sheetOpen}>
            <div className="ui-map-compass">
              <Button
                aria-label="Orient north"
                onClick={() => block.navigate("north")}
              >
                <span>N</span>
                <span className="ui-north-arrow">▲</span>
              </Button>
            </div>
            <div className="ui-map-zoom" inert={sheetOpen} aria-hidden={sheetOpen}>
              <Button
                icon="plus"
                aria-label="Zoom in"
                onClick={() => block.navigate("zoom_in")}
              />
              <Button
                icon="minus"
                aria-label="Zoom out"
                onClick={() => block.navigate("zoom_out")}
              />
              <Button
                icon="back"
                aria-label="Return to block view"
                onClick={() => block.navigate("return")}
              />
            </div>
            </div>
            <div className="area-map-actions" inert={sheetOpen} aria-hidden={sheetOpen}>
              {!inspectorOpen && block.selected && (
                <button className="ui-button" ref={inspectorButton} onClick={() => setInspectorOpen(true)}><Icon name="info" />Inspector</button>
              )}
              <button
                className="ui-button"
                ref={checksButton}
                aria-expanded={block.preferences.findingsOpen}
                onClick={() =>
                  block.setPreferences({
                    findingsOpen: !block.preferences.findingsOpen,
                  })
                }
              >
                <Icon name="warning" />Checks{" "}
                <Badge
                  tone={context.latestCheck?.stale ? "warning" : "neutral"}
                >
                  {context.latestCheck?.stale
                    ? "Out of date"
                    : (context.latestCheck?.findings.length ?? "Not checked")}
                </Badge>
              </button>
            </div>
            {block.finding && (
              <div className="area-map-finding" inert={sheetOpen} aria-hidden={sheetOpen}>
                <Badge tone="danger">Finding selected</Badge>
                <span>
                  {block.finding.geometry
                    ? "Exact check geometry highlighted"
                    : "Evidence notice · no exact geometry"}
                </span>
                <Button
                  variant="ghost"
                  icon="close"
                  aria-label="Clear selected finding"
                  onClick={() => block.selectFinding(null)}
                />
              </div>
            )}
          </div>
          {block.preferences.findingsOpen && <FindingsTray block={block} onClose={closeChecks} obscured={sheetOpen} />}
          <footer className="ui-map-status area-map-readout" role="group" aria-label="Map readout" inert={sheetOpen} aria-hidden={sheetOpen}>
            {context.features.some((feature) =>
              String(feature.properties.source_provider || "").includes("OpenStreetMap"),
            ) && (
              <span>
                © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL
              </span>
            )}
            <span>
              <i />
              Saved block · revision {context.area.revision}
            </span>
            <span>
              Area CRS: {context.area.reference?.analysisCrs || "Reference not supplied"}{" "}
              · metres
            </span>
          </footer>
        </section>
        {inspectorOpen && block.selected && (
          <BlockInspector
            block={block}
            hiddenBySheet={compact && !!panel && !sourceDialogOpen}
            onSourceDialogChange={setSourceDialogOpen}
            onClose={() => { setInspectorOpen(false); requestAnimationFrame(() => inspectorButton.current?.focus()); }}
            onImport={(id) => {
              setPackageId(id);
              setTools("import");
            }}
          />
        )}
      </div>
      <DataTools
        open={tools !== null}
        initialMode={tools || "import"}
        onClose={() => setTools(null)}
        context={context}
        selectedId={block.selectedId}
        initialPackageId={packageId}
        onChanged={() => void block.context.reload()}
      />
    </main>
  );
}
