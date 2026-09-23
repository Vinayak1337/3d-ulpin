"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SavedSceneViewport from "../../studio/product/SavedSceneViewport";
import { useBlock } from "./useBlock";
import { BlockLeftRail, BlockInspector } from "./BlockRails";
import MapPlan from "./MapPlan";
import FindingsTray from "./FindingsTray";
import DataTools from "./DataTools";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
} from "../shared/ui";
import { request, useMutation } from "../shared/hooks";
import { routes } from "../shared/routes";
import "./block.css";
import "./data-tools.css";
export default function BlockPage({ areaId }: { areaId: string }) {
  const block = useBlock(areaId);
  const [tools, setTools] = useState<"import" | "export" | null>(null),
    [packageId, setPackageId] = useState<string>(),
    [leftOpen, setLeftOpen] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [explode,setExplode]=useState(0);
  const checksButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setInspectorOpen(true); }, [block.selectedId, block.recordId]);
  const closeChecks = () => { block.setPreferences({ findingsOpen: false }); checksButton.current?.focus(); };
  const check = useMutation();
  const context = block.context.data;
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
      <div className="ui-contextbar">
        <div className="ui-block-title">
          <Link href={routes.block()} aria-label="All blocks">
            <Icon name="back" />
          </Link>
          <div>
            <div className="ui-breadcrumb">
              Blocks <Icon name="chevron" size={12} />{" "}
              {context.area.administrativeUnits.at(-1)?.name || "Saved area"}
            </div>
            <h1>{context.area.name}</h1>
          </div>
          <Badge>{context.features.length} features</Badge>
        </div>
        <div className="ui-context-actions">

          <Link className="ui-button" href={routes.addFiles(areaId)}><Icon name="upload" />Add files</Link>
          <Button icon="download" onClick={() => setTools("export")}>
            Export
          </Button>
        </div>
      </div>
      {check.error && <ErrorState message={check.error} />}
      {block.context.error && (
        <ErrorState
          message={block.context.error}
          retry={block.context.reload}
        />
      )}
      {block.selectionError && <p className="ui-stale-check" role="alert">{block.selectionError}</p>}
      <div
        className={`ui-block-grid ui-focused-map ${block.preferences.findingsOpen || (inspectorOpen && block.selected) ? "" : "ui-inspector-closed"}`}
      >
        <section className="ui-map-column" aria-label="Shared block map">
          <div className="ui-map-stage">
            <div className="ui-map-toolbar">
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
              <Button
                className="ui-mobile-layers"
                aria-expanded={leftOpen}
                icon="layers"
                onClick={() => setLeftOpen(!leftOpen)}
              >
                Layers
              </Button>
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
            {!block.features.length ? (
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
            ) : (
              <>
                <div
                  className="ui-renderer"
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
                    details={block.recordId?block.details.filter(d=>d.id===block.recordId||block.dossier.data?.records.find(r=>r.id===d.id)?.links.some(l=>l.type==='floor'&&l.targetId===block.recordId)):block.preferences.underground?block.details:[]}
                    selectedDetailId={block.recordId}
                    onSelectDetail={block.selectRecord}
                    opacityByKind={block.preferences.opacity}
                    labels={block.preferences.labels}
                  />
                </div>
              </>
            )}
            <div className="ui-map-world"><label>Source world <select aria-label="Source world" value={block.world} onChange={e=>block.setWorld(e.target.value)}>{block.worlds.map(w=><option key={w} value={w}>{w==='synthetic'?'Fictional scenario':w==='observed'?'Observed sources':w}</option>)}</select></label>{block.selected?.kind==='building'&&block.details.length>0&&<button className="ui-button" aria-pressed={explode>0} onClick={()=>setExplode(v=>v?0:1.8)}>{explode?'Stack floors':'Separate floors'}</button>}</div>
            <div className="ui-map-compass">
              <Button
                aria-label="Orient north"
                onClick={() => block.navigate("north")}
              >
                <span>N</span>
                <span className="ui-north-arrow">▲</span>
              </Button>
            </div>
            <div className="ui-map-zoom">
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
            <div className="ui-map-bottom">
              <div className="ui-map-legend">
                <span>
                  <i style={{ background: "#b9cbbb" }} />
                  Buildings
                </span>
                <span>
                  <i style={{ background: "#cfbb88" }} />
                  Parcels
                </span>
                <span>
                  <i style={{ background: "#6596af" }} />
                  Utilities
                </span>
              </div>
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
              <div className="ui-active-finding">
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
          <footer className="ui-map-status">
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
              {context.area.reference?.analysisCrs || "Reference not supplied"}{" "}
              · metres
            </span>
          </footer>
        </section>
        {block.preferences.findingsOpen ? (
          <aside className="ui-block-inspector ui-checks-panel" aria-label="Block checks">
            <div className="ui-check-actions">
              <Button icon="check" disabled={check.busy} onClick={runCheck}>{check.busy ? "Checking…" : "Run check"}</Button>
              <Button icon="eye" aria-pressed={block.showConflicts} disabled={!block.conflictCount} onClick={block.toggleConflicts}>{block.showConflicts ? "Hide conflicts" : "Show conflicts"}</Button>
            </div>
            <FindingsTray block={block} onClose={closeChecks} />
          </aside>
        ) : inspectorOpen && block.selected && (
          <BlockInspector
            block={block}
            onClose={() => { setInspectorOpen(false); requestAnimationFrame(() => inspectorButton.current?.focus()); }}
            onImport={(id) => {
              setPackageId(id);
              setTools("import");
            }}
          />
        )}
      </div>
      <Dialog open={leftOpen} title="Map layers & properties" onClose={() => setLeftOpen(false)}>
        <BlockLeftRail block={block} onClose={() => { setLeftOpen(false); setInspectorOpen(true); }} />
      </Dialog>
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
