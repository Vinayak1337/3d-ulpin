"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Point2 } from "@ulpin/contracts";
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Icon,
  LoadingState,
} from "../shared/ui";
import { routes } from "../shared/routes";
import { useQueryState } from "../shared/hooks";
import { useWorkspace } from "./useWorkspace";
import { calibrationKey, useMeasurements } from "./useMeasurements";
import { currentCalibration, makeMeasurement } from "./measurement";
import type { MeasureTool, WorkspaceMode } from "./types";
import SourceCanvas from "./SourceCanvas";
import MeasurePanel from "./MeasurePanel";
import CalibratePanel from "./CalibratePanel";
import ComparePanel from "./ComparePanel";
import BuildPanel from "./BuildPanel";
import AssignDialog from "./AssignDialog";
import styles from "./Workspace.module.css";
const SpatialViewer = dynamic(() => import("@/components/SpatialViewer"), {
  ssr: false,
  loading: () => <LoadingState label="Opening actual 3D draft" />,
});
const modes: WorkspaceMode[] = ["measure", "calibrate", "compare", "build"];
const tools: MeasureTool[] = [
  "pan",
  "distance",
  "area",
  "perimeter",
  "angle",
  "height",
  "point",
];
const title = (text: string) => text[0].toUpperCase() + text.slice(1);
export default function WorkspacePage({
  buildingId,
  caseId,
}: {
  buildingId?: string;
  caseId?: string;
}) {
  const workspace = useWorkspace(buildingId, caseId);
  const notes = useMeasurements(buildingId || caseId || "new");
  const [mode, setMode] = useQueryState("mode", modes, "measure");
  const [sourceId, setSourceId] = useState(""),
    [secondaryId, setSecondaryId] = useState(""),
    [page, setPage] = useState(1);
  const [tool, setTool] = useState<MeasureTool>("pan"),
    [points, setPoints] = useState<Point2[]>([]),
    [error, setError] = useState("");
  const [compareMode, setCompareMode] = useState<
      "overlay" | "split" | "side_by_side" | "difference"
    >("side_by_side"),
    [opacity, setOpacity] = useState(50),
    [swipe, setSwipe] = useState(50);
  const [documentsOpen, setDocumentsOpen] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(false),
    [assign, setAssign] = useState(false),
    [uploadOpen, setUploadOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [childBusy, setChildBusy] = useState(""),
    [showModel, setShowModel] = useState(false),
    [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const source =
    workspace.sources.find((s) => s.id === sourceId) ||
    workspace.sources.find((s) => ["image", "pdf"].includes(s.kind)) ||
    workspace.sources[0];
  const secondary = workspace.sources.find(
    (s) => s.id === secondaryId && s.id !== source?.id,
  );
  const calibration = currentCalibration(
    source,
    page,
    notes.calibrations[calibrationKey(source?.id || "", page)],
  );
  const calibrated =
    !!calibration || (source?.kind === "geometry" && !!source.frame);
  const busy = workspace.busy || !!childBusy;
  useEffect(() => {
    setPoints([]);
    setError("");
    setPage(1);
  }, [source?.id]);
  const changeMode = (next: WorkspaceMode) => {
    setMode(next);
    setPoints([]);
    setError("");
    if (next !== "build") setShowModel(false);
  };
  const finish = (value = points) => {
    if (mode === "calibrate" || !source) return;
    try {
      notes.addMeasurement(
        makeMeasurement(source, page, tool, value, calibration),
      );
      setPoints([]);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Check the measurement points.",
      );
      if (compact) setInspectorOpen(true);
    }
  };
  const addPoint = (point: Point2) => {
    const next =
      mode === "calibrate" && points.length >= 2 ? [point] : [...points, point];
    setPoints(next);
    if (
      mode !== "calibrate" &&
      ((tool === "distance" && next.length === 2) ||
        (tool === "angle" && next.length === 3) ||
        (tool === "point" && next.length === 1))
    )
      finish(next);
  };
  const documentList = (
    <>
      <div className={styles.railHeading}>
        <h2>Sources</h2>
        <Badge>{workspace.sources.filter((s) => s.url).length}</Badge>
      </div>
      <Button icon="upload" onClick={() => setUploadOpen(true)} disabled={busy}>
        Add documents
      </Button>
      <div className={styles.documents}>
        {workspace.sources.map((item) => (
          <button
            key={item.id}
            aria-pressed={source?.id === item.id}
            onClick={() => {
              setSourceId(item.id);
              setDocumentsOpen(false);
            }}
          >
            <span className={styles.sourceIcon}>
              <Icon
                name={
                  item.kind === "image"
                    ? "photo"
                    : item.kind === "geometry"
                      ? "layers"
                      : "document"
                }
              />
            </span>
            <span>
              <strong>{item.name}</strong>
              <small>
                {{
                  needs_input: "Needs review",
                  received: "Retained",
                  inspected: "Inspected",
                  suitable: "Source ready",
                  unsupported: "Review format",
                }[item.status || ""] ||
                  item.status ||
                  "Retained"}
                {item.kind === "geometry" ? " · geometry" : ""}
              </small>
            </span>
            {source?.id === item.id && <Icon name="check" />}
          </button>
        ))}
      </div>
      {!workspace.sources.length && (
        <p className={styles.muted}>Add the first plan to begin.</p>
      )}
      <div className={styles.sourceMeta}>
        {source?.url && (
          <Link href={source.url} target="_blank" rel="noreferrer">
            <Icon name="external" /> Open original
          </Link>
        )}
        {source?.hash && !source.id.startsWith("outline:") && (
          <small title={source.hash}>
            SHA-256 · {source.hash.slice(0, 14)}…
          </small>
        )}
        <p>Originals stay unchanged. Measurements are saved on this device.</p>
      </div>
    </>
  );
  const panel =
    mode === "measure" ? (
      <MeasurePanel
        source={source}
        page={page}
        tool={tool}
        calibrated={calibrated}
        points={points.length}
        measurements={notes.measurements}
        error={error}
        onCalibrate={() => changeMode("calibrate")}
        onFinish={() => finish()}
        onClear={() => setPoints([])}
        onUndo={() => setPoints((old) => old.slice(0, -1))}
        onDelete={notes.removeMeasurement}
        onNote={notes.noteMeasurement}
        onExport={notes.exportNotes}
        onHeight={(lower, upper, reference) => {
          if (!source) return;
          notes.addMeasurement({
            id: crypto.randomUUID(),
            sourceId: source.id,
            sourceHash: source.hash,
            page,
            tool: "height",
            points: [],
            value: upper - lower,
            unit: "m",
            label: `Height · ${lower} to ${upper} m`,
            reference,
            noted: false,
            createdAt: new Date().toISOString(),
          });
        }}
      />
    ) : mode === "calibrate" ? (
      <CalibratePanel
        key={`${workspace.caseId || buildingId || caseId}:${source?.id}:${source?.hash}:${page}`}
        source={source}
        page={page}
        points={points}
        calibration={calibration}
        onSave={(value) => {
          if (source) notes.setCalibration(source.id, page, value);
          setPoints([]);
          setError("");
        }}
        onReset={() => source && notes.setCalibration(source.id, page)}
        onClear={() => setPoints([])}
      />
    ) : mode === "compare" ? (
      <ComparePanel
        source={source}
        sources={workspace.sources}
        secondaryId={secondaryId}
        onSecondary={setSecondaryId}
        mode={compareMode}
        onMode={setCompareMode}
        opacity={opacity}
        onOpacity={setOpacity}
        swipe={swipe}
        onSwipe={setSwipe}
      />
    ) : (
      <BuildPanel
        workspace={workspace}
        source={source}
        measurements={notes.measurements}
        disabled={busy}
        onBusy={setChildBusy}
        onModel={() => {
          setShowModel(true);
          setInspectorOpen(false);
        }}
        onAssign={() => setAssign(true)}
      />
    );
  const property = workspace.dossier?.building;
  return (
    <div className={styles.workspace}>
      <header className={styles.workspaceHeading}>
        <div className={styles.headingIdentity}>
          <Link
            href={
              workspace.dossier
                ? routes.block(workspace.backArea?.id, buildingId)
                : routes.workspace()
            }
            aria-label={workspace.dossier ? "Back to block" : "All workspaces"}
          >
            <Icon name="back" />
          </Link>
          <div>
            <p className={styles.eyebrow}>
              {property?.identifier || "UNASSIGNED DRAFT"}
            </p>
            <h1>
              {property?.name ||
                workspace.detail?.case.name ||
                "Plan workspace"}
            </h1>
          </div>
          <Badge tone={property ? "info" : "neutral"}>
            {property ? "Property workspace" : "Unassigned"}
          </Badge>
        </div>
        <div className={styles.inline}>
          {property ? (
            <Link
              className={styles.registerLink}
              href={routes.register(buildingId, workspace.backArea?.id)}
            >
              Property register <Icon name="arrow" />
            </Link>
          ) : (
            <Button
              icon="building"
              disabled={!workspace.detail?.sources.length || busy}
              onClick={() => setAssign(true)}
            >
              Assign property
            </Button>
          )}
          <span className={styles.saved}>
            <Icon name="check" />{" "}
            {notes.loaded ? "Notes saved locally" : "Opening notes"}
          </span>
        </div>
      </header>
      {workspace.contextWarning && (
        <p className={styles.notice}>{workspace.contextWarning}</p>
      )}
      {(workspace.error || notes.storageError) && (
        <ErrorState
          message={workspace.error || notes.storageError}
          retry={() => void workspace.refresh()}
        />
      )}
      <div className={styles.workspaceToolbar}>
        <div
          className={styles.modes}
          role="tablist"
          aria-label="Workspace mode"
        >
          {modes.map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => changeMode(value)}
            >
              <Icon
                name={
                  value === "measure"
                    ? "measure"
                    : value === "calibrate"
                      ? "target"
                      : value === "compare"
                        ? "layers"
                        : "cube"
                }
              />
              {value === "build" ? "Build details" : title(value)}
            </button>
          ))}
        </div>
        <div className={styles.mobileTools}>
          <Button icon="document" onClick={() => setDocumentsOpen(true)}>
            Sources
          </Button>
          <Button icon="settings" onClick={() => setInspectorOpen(true)}>
            Controls
          </Button>
        </div>
        <span className={styles.toolbarStatus}>
          {childBusy ||
            (workspace.preparation
              ? `Draft revision ${workspace.pkg?.revision || "…"}`
              : "Originals retained")}
        </span>
      </div>
      <div className={styles.workspaceGrid}>
        <aside className={styles.documentRail}>{documentList}</aside>
        <main className={styles.canvasColumn}>
          {mode === "measure" && (
            <div className={styles.measureTools} aria-label="Measurement tools">
              {tools.map((value) => (
                <button
                  key={value}
                  aria-pressed={tool === value}
                  onClick={() => {
                    setTool(value);
                    setPoints([]);
                    setError("");
                  }}
                >
                  {title(value)}
                </button>
              ))}
            </div>
          )}
          {mode === "build" && workspace.detail?.model && (
            <div className={styles.modelToggle}>
              <Button
                variant={!showModel ? "primary" : "secondary"}
                onClick={() => setShowModel(false)}
              >
                Source plan
              </Button>
              <Button
                icon="cube"
                variant={showModel ? "primary" : "secondary"}
                onClick={() => setShowModel(true)}
              >
                3D draft
              </Button>
              <span>{workspace.detail.model.units.length} computed spaces</span>
            </div>
          )}
          <div
            className={styles.stageWrapper}
            hidden={showModel && mode === "build"}
          >
            <SourceCanvas
              source={source}
              secondary={secondary}
              page={page}
              mode={mode}
              tool={tool}
              points={points}
              measurements={notes.measurements}
              compareMode={compareMode}
              opacity={opacity}
              swipe={swipe}
              onPoint={addPoint}
              onClear={() => setPoints([])}
              onUndo={() => setPoints((old) => old.slice(0, -1))}
              onFinish={() => finish()}
              onPage={(value) => {
                setPage(value);
                setPoints([]);
              }}
            />
          </div>
          {showModel && mode === "build" && workspace.detail?.model && (
            <div className={styles.modelStage}>
              <SpatialViewer
                model={workspace.detail.model}
                selectedId={selectedUnit}
                onSelect={setSelectedUnit}
                floor="all"
                isolate={false}
                explode={0}
                finding={null}
                initialPresentation="volumes"
              />
              <div className={styles.modelCaption}>
                Computed model · {workspace.detail.model.frame.benchmark}
              </div>
            </div>
          )}
          {workspace.loading && !source && (
            <LoadingState label="Opening retained documents" />
          )}
        </main>
        <aside className={styles.inspector}>{!compact && panel}</aside>
      </div>
      <Dialog
        open={documentsOpen}
        title="Source documents"
        onClose={() => setDocumentsOpen(false)}
      >
        <div className={styles.drawerContents}>{documentList}</div>
      </Dialog>
      <Dialog
        open={compact && inspectorOpen}
        title={mode === "build" ? "Build details" : title(mode)}
        onClose={() => setInspectorOpen(false)}
      >
        {compact && inspectorOpen && panel}
      </Dialog>
      <Dialog
        open={uploadOpen}
        title="Add source documents"
        onClose={() => setUploadOpen(false)}
      >
        <div className={styles.form}>
          {buildingId && !workspace.pkg ? (
            <>
              <p>
                Create a preparation draft for this property before adding
                documents.
              </p>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void workspace.open()}
              >
                Create workspace
              </Button>
            </>
          ) : (
            <>
              <p>
                {buildingId
                  ? "PDF, images, CSV, text or DOCX"
                  : "PDF, PNG or level CSV"}
                . The original file is retained before suitability is assessed.
              </p>
              <input
                ref={fileRef}
                aria-label="Source documents"
                type="file"
                multiple
                accept={
                  buildingId
                    ? ".pdf,.png,.jpg,.jpeg,.csv,.txt,.docx"
                    : ".pdf,.png,.csv"
                }
              />
              <Button
                variant="primary"
                icon="upload"
                disabled={busy}
                onClick={() => {
                  const files = Array.from(fileRef.current?.files || []);
                  if (!files.length) return;
                  void workspace.upload(files).then((uploaded) => {
                    if (!uploaded || !fileRef.current) return;
                    fileRef.current.value = "";
                  });
                }}
              >
                Retain documents
              </Button>
              {workspace.sources.some((s) => s.url) && (
                <p role="status">
                  {workspace.sources.filter((s) => s.url).length} retained
                  source
                  {workspace.sources.filter((s) => s.url).length === 1
                    ? ""
                    : "s"}{" "}
                  in this workspace.
                </p>
              )}
            </>
          )}
          {workspace.error && <ErrorState message={workspace.error} />}
          <Button onClick={() => setUploadOpen(false)}>Done</Button>
        </div>
      </Dialog>
      <AssignDialog
        open={assign}
        onClose={() => setAssign(false)}
        detail={workspace.detail}
      />
    </div>
  );
}
