"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { useBlock } from "./useBlock";
import { BlockLeftRail, BlockInspector } from "./BlockRails";
import MapPlan from "./MapPlan";
import FindingsTray from "./FindingsTray";
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
const AreaViewer = dynamic(() => import("@/components/AreaViewer"), {
  ssr: false,
  loading: () => <LoadingState label="Preparing 3D block" />,
});
export default function BlockPage({ areaId }: { areaId: string }) {
  const block = useBlock(areaId);
  const [tools, setTools] = useState<"import" | "export" | null>(null),
    [packageId, setPackageId] = useState<string>(),
    [leftOpen, setLeftOpen] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(true);
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
        <Link className="ui-button" href={routes.home}>
          Choose another block
        </Link>
      </main>
    );
  return (
    <main className="ui-block-page">
      <div className="ui-contextbar">
        <div className="ui-block-title">
          <Link href={routes.home} aria-label="All blocks">
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
          <Link className="ui-button" href={`/map-lab?area=${encodeURIComponent(areaId)}&world=${encodeURIComponent(block.selected?.worldStatus??context.features[0]?.worldStatus??"synthetic")}`}><Icon name="cube"/>Enhanced 3D</Link>
          <Button
            icon="upload"
            onClick={() => {
              setPackageId(undefined);
              setTools("import");
            }}
          >
            Import
          </Button>
          <Button
            icon="check"
            variant="primary"
            disabled={check.busy}
            onClick={runCheck}
          >
            {check.busy ? "Checking…" : "Run check"}
          </Button>
          <Button
            icon="warning"
            aria-pressed={block.showConflicts}
            disabled={!block.conflictCount}
            onClick={block.toggleConflicts}
          >
            {block.showConflicts ? "Hide conflicts" : "Show conflicts"}
            {block.conflictCount ? ` (${block.conflictCount})` : ""}
          </Button>
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
      <div
        className={`ui-block-grid ${leftOpen ? "ui-left-open" : ""} ${inspectorOpen ? "" : "ui-inspector-closed"}`}
      >
        <BlockLeftRail block={block} onClose={() => setLeftOpen(false)} />
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
                icon="layers"
                onClick={() => setLeftOpen(!leftOpen)}
              >
                Layers
              </Button>
              <Button
                icon="layers"
                aria-pressed={block.preferences.underground}
                onClick={() =>
                  block.setPreferences({
                    underground: !block.preferences.underground,
                  })
                }
              >
                Underground
              </Button>
              <Button
                icon="eye"
                aria-pressed={block.preferences.labels}
                onClick={() =>
                  block.setPreferences({ labels: !block.preferences.labels })
                }
              >
                Labels
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
                  <AreaViewer
                    frameScale={2.0}
                    sceneAssets={context.sceneAssets}
                    features={block.visibleFeatures}
                    geographicExtent={context.area.geographicExtent}
                    selectedId={block.selectedId}
                    onSelect={(id) => {
                      block.select(id);
                      setInspectorOpen(true);
                    }}
                    navigation={block.navigation}
                    sceneKey={`block:${areaId}`}
                    highlightedIds={block.highlightedIds}
                    featureLabels={block.featureLabels}
                    issueGeometry={block.geographicIssueGeometry}
                    details={block.preferences.underground ? block.details : []}
                    boundaries={block.boundaries}
                    labels={block.preferences.labels}
                    underground={block.preferences.underground}
                  />
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
                    details={block.preferences.underground ? block.details : []}
                    labels={block.preferences.labels}
                  />
                </div>
              </>
            )}
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
              {!inspectorOpen && (
                <Button icon="info" onClick={() => setInspectorOpen(true)}>
                  Inspector
                </Button>
              )}
              <Button
                icon="warning"
                aria-pressed={block.preferences.findingsOpen}
                onClick={() =>
                  block.setPreferences({
                    findingsOpen: !block.preferences.findingsOpen,
                  })
                }
              >
                Findings{" "}
                <Badge
                  tone={context.latestCheck?.stale ? "warning" : "neutral"}
                >
                  {context.latestCheck?.stale
                    ? "Out of date"
                    : (context.latestCheck?.findings.length ?? "Not checked")}
                </Badge>
              </Button>
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
          {block.preferences.findingsOpen && <FindingsTray block={block} />}
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
        {inspectorOpen && (
          <BlockInspector
            block={block}
            onClose={() => setInspectorOpen(false)}
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
