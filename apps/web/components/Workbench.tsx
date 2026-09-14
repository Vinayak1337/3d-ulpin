"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CaseDetail,
  CaseRecord,
  Finding,
  SourceProfile,
  SourceRevision,
  UnitSpec,
} from "@ulpin/contracts";
import {
  ArrowLineDown as ArrowDownToLine,
  ArrowRight,
  Cube as Box,
  Check,
  Checks as CheckCheck,
  CaretDown as ChevronDown,
  CaretRight as ChevronRight,
  Circle,
  WarningCircle as CircleAlert,
  Clock as Clock3,
  DownloadSimple as Download,
  FileImage,
  FileJs as FileJson,
  FileCsv as FileSpreadsheet,
  FolderOpen,
  CrosshairSimple as Focus,
  ClockCounterClockwise as History,
  Stack as Layers3,
  SpinnerGap as LoaderCircle,
  MapTrifold as Map,
  ArrowsOutSimple as Maximize2,
  SidebarSimple as PanelRightClose,
  SidebarSimple as PanelRightOpen,
  SidebarSimple,
  ArrowsInSimple,
  IconContext,
  Columns,
  PencilSimple,
  Plus,
  ArrowsClockwise as RefreshCw,
  ArrowCounterClockwise as RotateCcw,
  Scan as ScanLine,
  SlidersHorizontal as Settings2,
  SealCheck as ShieldCheck,
  UploadSimple as Upload,
  X,
} from "@/lib/ui/icons";
import { api, sourceUrl } from "@/lib/client";
import { number, unitColor } from "@/lib/ui/geometry";
import { retainOfficerContext } from "./OfficerNavigation";
import PlanView from "./PlanView";
import SourcePreview from "./SourcePreview";
import PropertyIdentity, { IdentifierValue } from "./PropertyIdentity";
import { identityLevel } from "@/lib/identifiers";
const SourceFileDialog = dynamic(() => import("./SourceFileDialog"), {
  ssr: false,
});

async function loadSpatialViewer(): Promise<typeof import("./SpatialViewer")> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      import("./SpatialViewer"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The local 3D viewer took too long to load.")),
          20_000,
        );
      }),
    ]);
  } catch {
    return { default: ViewerLoadFailure };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function ViewerLoadFailure() {
  return (
    <div className="viewer-error" role="alert">
      <CircleAlert size={24} />
      <strong>The 3D viewer could not be loaded.</strong>
      <span>
        Reload to retry, or switch to Plan to inspect the saved geometry.
      </span>
      <button className="button small" onClick={() => window.location.reload()}>
        <RefreshCw size={14} /> Reload viewer
      </button>
    </div>
  );
}

const SpatialViewer = dynamic(loadSpatialViewer, {
  ssr: false,
  loading: () => (
    <div className="viewer-loading">
      <LoaderCircle size={20} className="spin" />
      <span>Opening the spatial viewer…</span>
    </div>
  ),
});
type Pane = "spaces" | "sources" | "findings" | "history";
type View = "3d" | "plan" | "split" | "reference";
type Inspection = { type: "unit" | "source" | "finding"; id: string } | null;
type Modal = "upload" | "prepare" | "new" | null;
const profiles: { value: SourceProfile; label: string; extension: string }[] = [
  {
    value: "parcel-local-json-v1",
    label: "Spatial footprints · JSON",
    extension: ".json",
  },
  {
    value: "levels-csv-v1",
    label: "Level measurements · CSV",
    extension: ".csv",
  },
  { value: "control-csv-v1", label: "Control points · CSV", extension: ".csv" },
  { value: "plan-png-v1", label: "Plan reference · PNG", extension: ".png" },
  { value: "plan-pdf-v1", label: "Plan reference · PDF", extension: ".pdf" },
];
const suitable = (s: SourceRevision) =>
  s.status === "ready" || s.status === "needs_input";
const shortTime = (date: string) =>
  new Date(date).toLocaleTimeString("en", {
    hour: "2-digit",
    minute: "2-digit",
  });

function SourceIcon({
  profile,
  size = 16,
}: {
  profile: SourceProfile;
  size?: number;
}) {
  return profile.includes("json") ? (
    <FileJson size={size} />
  ) : profile.includes("csv") ? (
    <FileSpreadsheet size={size} />
  ) : (
    <FileImage size={size} />
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      {value === "ready" || value === "succeeded" ? (
        <Check size={10} />
      ) : value === "processing" ||
        value === "running" ||
        value === "queued" ? (
        <LoaderCircle size={10} className="spin" />
      ) : value === "failed" ? (
        <X size={10} />
      ) : (
        <Circle size={6} fill="currentColor" />
      )}
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Mark({ size = 27 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m16 3 12 7v13l-12 7-12-7V10Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m4 10 12 7 12-7M16 17v13M10 13.5V7l12 7v12.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default function Workbench() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<boolean | null>(null);
  const [pane, setPane] = useState<Pane>("spaces");
  const [view, setView] = useState<View>("3d");
  const [inspection, setInspection] = useState<Inspection>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<SourceRevision | null>(
    null,
  );
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [floor, setFloor] = useState("all");
  const [isolate, setIsolate] = useState(false);
  const [explode, setExplode] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modelFocus, setModelFocus] = useState(false);
  const [collapsedFloors, setCollapsedFloors] = useState<Set<string>>(
    new Set(),
  );
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const modalElement = useRef<HTMLElement>(null);
  const [dataset, setDataset] = useState<"c001" | "c002" | "real-nyc">("c001");
  const [modal, setModal] = useState<Modal>(null);
  const [newName, setNewName] = useState("Untitled property");
  const [uploadProfile, setUploadProfile] = useState<SourceProfile>(
    "parcel-local-json-v1",
  );
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFamily, setUploadFamily] = useState("");
  const [prepareSpatial, setPrepareSpatial] = useState("");
  const [prepareLevels, setPrepareLevels] = useState("");
  const [prepareControl, setPrepareControl] = useState("");
  const [lower, setLower] = useState("");
  const [upper, setUpper] = useState("");
  const currentId = useRef(caseId);
  currentId.current = caseId;

  const refreshCases = useCallback(async () => {
    const result = await api.cases();
    setCases(result);
    return result;
  }, []);
  const refresh = useCallback(async (id?: string) => {
    const target = id || currentId.current;
    if (!target) return;
    const result = await api.detail(target);
    if (target === currentId.current) setDetail(result);
    return result;
  }, []);

  const [blockReturn, setBlockReturn] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search),
      buildingId = q.get("building"),
      areaId = q.get("area"),
      linkedCase = q.get("case");
    if (buildingId && areaId) {
      setBlockReturn(
        `/areas/${encodeURIComponent(areaId)}?feature=${encodeURIComponent(buildingId)}`,
      );
      retainOfficerContext({
        buildingId,
        areaId,
        caseId: linkedCase || undefined,
      });
    }
  }, []);
  useEffect(() => {
    let alive = true;
    refreshCases()
      .then((result) => {
        if (!alive) return;
        const requested = new URLSearchParams(window.location.search).get(
          "case",
        );
        const saved = localStorage.getItem("astra.case");
        setCaseId(
          result.find((c) => c.id === requested)?.id ||
            result.find((c) => c.id === saved && !c.archived)?.id ||
            result.find((c) => !c.archived)?.id ||
            result[0]?.id ||
            null,
        );
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshCases]);
  useEffect(() => {
    let alive = true;
    const update = () =>
      api
        .health()
        .then((result) => {
          if (alive) setHealth(result.ok);
        })
        .catch(() => {
          if (alive) setHealth(false);
        });
    void update();
    const timer = setInterval(update, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!caseId) return;
    localStorage.setItem("astra.case", caseId);
    const url = new URL(window.location.href);
    url.searchParams.set("case", caseId);
    window.history.replaceState(null, "", url.toString());
    setDetail(null);
    setLoading(true);
    setUploadFamily("");
    setUploadFile(null);
    setInspection(null);
    setSelectedId(null);
    setActiveFinding(null);
    setReferenceId(null);
    setFloor("all");
    setIsolate(false);
    setExplode(0);
    setView("3d");
    let alive = true;
    api
      .detail(caseId)
      .then((result) => {
        if (alive) setDetail(result);
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [caseId]);
  const pending =
    detail?.jobs.filter(
      (j) => j.status === "queued" || j.status === "running",
    ) || [];
  useEffect(() => {
    if (!caseId) return;
    const timer = setInterval(
      () => {
        void refresh().catch((cause) => setError(cause.message));
      },
      pending.length ? 1500 : 10000,
    );
    return () => clearInterval(timer);
  }, [caseId, pending.length, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const initial =
      modalElement.current?.querySelector<HTMLElement>(
        "input:not([type=file]):not([type=hidden]):not(:disabled)",
      ) ??
      modalElement.current?.querySelector<HTMLElement>(
        "select:not(:disabled)",
      ) ??
      modalElement.current?.querySelector<HTMLElement>("button:not(:disabled)");
    initial?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setModal(null);
      if (e.key !== "Tab") return;
      const targets = Array.from(
        modalElement.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
        ) || [],
      );
      const first = targets[0],
        last = targets.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [modal, busy]);

  const unit = detail?.units.find(
    (u) => inspection?.type === "unit" && u.id === inspection.id,
  );
  const source = detail?.sources.find(
    (s) => inspection?.type === "source" && s.id === inspection.id,
  );
  const finding = detail?.model?.findings.find(
    (f) => inspection?.type === "finding" && f.id === inspection.id,
  );
  const highlighted =
    detail?.model?.findings.find((f) => f.id === activeFinding) || null;
  const reference = detail?.sources.find((s) => s.id === referenceId);
  const modelFresh =
    !!detail?.model && detail.model.revision === detail.case.revision;
  const overlapFindings =
    detail?.model?.findings.filter((f) => !!f.overlap) || [];
  const computed = detail?.model?.units.find((u) => u.id === unit?.id);
  const floors = [
    ...new Set(detail?.units.map((u) => u.levelLabel || "Unassigned") || []),
  ];
  const inspectedSpatial =
    detail?.sources.filter(
      (s) => s.profile === "parcel-local-json-v1" && suitable(s),
    ) || [];
  const inspectedLevels =
    detail?.sources.filter(
      (s) => s.profile === "levels-csv-v1" && suitable(s),
    ) || [];
  const inspectedControls =
    detail?.sources.filter(
      (s) => s.profile === "control-csv-v1" && suitable(s),
    ) || [];
  const buildPending = pending.some((j) => j.operation === "build");
  useEffect(() => {
    setLower(unit?.lower == null ? "" : String(unit.lower));
    setUpper(unit?.upper == null ? "" : String(unit.upper));
  }, [unit?.id, unit?.revision, unit?.lower, unit?.upper]);

  async function run(
    label: string,
    action: () => Promise<void>,
    success?: string,
  ) {
    setBusy(label);
    setError(null);
    try {
      await action();
      if (success) setNotice(success);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The operation could not be completed.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }
  function selectUnit(id: string) {
    setModelFocus(false);
    setMobileSidebar(false);
    setSelectedId(id);
    setInspection({ type: "unit", id });
    setActiveFinding(null);
    setInspectorOpen(true);
  }
  function selectFinding(f: Finding) {
    setModelFocus(false);
    setMobileSidebar(false);
    setInspection({ type: "finding", id: f.id });
    setSelectedId(f.unitIds[0] || null);
    setActiveFinding(f.id);
    setFloor("all");
    setIsolate(false);
    setExplode(0);
    setView("3d");
    setInspectorOpen(true);
  }
  function selectSource(s: SourceRevision) {
    setModelFocus(false);
    setMobileSidebar(false);
    setInspection({ type: "source", id: s.id });
    setInspectorOpen(true);
    if (s.profile.startsWith("plan-") && suitable(s)) {
      setReferenceId(s.id);
      setView("reference");
    }
  }
  async function loadDemo() {
    await run(
      "Importing sample inputs",
      async () => {
        const target =
          detail && !detail.sources.length
            ? detail.case
            : await api.createCase(
                dataset === "real-nyc"
                  ? "NYC public building · DOITT 353927"
                  : `Demonstration ${dataset === "c001" ? "C-001" : "C-002"}`,
              );
        setCaseId(target.id);
        currentId.current = target.id;
        await api.demo(target.id, dataset);
        await refreshCases();
        await refresh(target.id);
        setPane("sources");
      },
      "Sample files received. Inspection is running; geometry has not been generated.",
    );
  }
  function showPrepare() {
    setPrepareSpatial(inspectedSpatial[0]?.id || "");
    setPrepareLevels(
      inspectedLevels.slice().sort((a, b) => a.revision - b.revision)[0]?.id ||
        "",
    );
    setPrepareControl(inspectedControls[0]?.id || "");
    setModal("prepare");
  }
  async function build() {
    if (detail)
      await run(
        "Queuing geometry build",
        async () => {
          await api.build(detail.case.id, detail.case.revision);
          setView("3d");
          setFloor("all");
          await refresh();
        },
        "Build queued. Computed geometry and checks will appear when processing finishes.",
      );
  }
  async function applyLevels(s: SourceRevision) {
    if (!detail) return;
    await run(
      "Applying revised levels",
      async () => {
        const result = await api.applyLevels(
          detail.case.id,
          s.id,
          detail.case.revision,
        );
        setDetail(result);
      },
      "Evidence applied. Build the model again to refresh geometry and checks.",
    );
  }
  async function reviseDemo() {
    if (!detail) return;
    await run(
      "Receiving revised levels",
      async () => {
        const candidate = detail.case.frame.id.toLowerCase().includes("c002")
          ? "c002"
          : "c001";
        const revision = await api.demoLevels(detail.case.id, candidate);
        await refresh();
        setPane("sources");
        setInspection({ type: "source", id: revision.id });
        setInspectorOpen(true);
        setModelFocus(false);
      },
      "Revised level file received. Inspect its contents, then explicitly apply it.",
    );
  }
  async function saveElevations() {
    if (!detail || !unit) return;
    await run(
      "Saving unit revision",
      async () => {
        if (
          !lower.trim() ||
          !upper.trim() ||
          !Number.isFinite(Number(lower)) ||
          !Number.isFinite(Number(upper)) ||
          Number(upper) <= Number(lower)
        )
          throw new Error(
            "Enter numeric elevations with the upper limit above the lower limit.",
          );
        await api.editUnit(detail.case.id, unit.id, {
          expectedRevision: unit.revision,
          lower: Number(lower),
          upper: Number(upper),
        });
        await refresh();
      },
      "Unit revision saved. Rebuild to compute its effect.",
    );
  }

  const paneOptions: {
    key: Pane;
    icon: typeof Box;
    title: string;
    count: number;
  }[] = [
    {
      key: "spaces",
      icon: Layers3,
      title: "Spaces",
      count: detail?.units.length || 0,
    },
    {
      key: "sources",
      icon: FolderOpen,
      title: "Sources",
      count: detail?.sources.length || 0,
    },
    {
      key: "findings",
      icon: ScanLine,
      title: "Checks",
      count: detail?.model?.findings.length || 0,
    },
    {
      key: "history",
      icon: History,
      title: "History",
      count: detail?.history.length || 0,
    },
  ];

  return (
    <IconContext.Provider value={{ weight: "bold" }}>
      <div className={`workbench ${modelFocus ? "model-focused" : ""}`}>
        <a href="#model-workspace" className="skip-link">
          Skip to model workspace
        </a>
        <header className="topbar">
          {blockReturn && (
            <a className="officer-back-link" href={blockReturn}>
              ← Back to property in block
            </a>
          )}
          <a href="/" className="brand" aria-label="3D ULPIN home">
            <Mark />
            <span>3D ULPIN</span>
          </a>
          <span className="brand-caption">Spatial studio</span>
          <div className="top-divider" />
          <div className="case-picker">
            <FolderOpen size={15} />
            {cases.length ? (
              <select
                aria-label="Open case"
                disabled={!!busy}
                value={caseId || ""}
                onChange={(e) => {
                  if (e.target.value === "toggle-archive") {
                    setShowArchived((value) => !value);
                  } else {
                    setCaseId(e.target.value);
                  }
                }}
              >
                {cases
                  .filter((c) => !c.archived || c.id === caseId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.archived ? " (archived)" : ""}
                    </option>
                  ))}
                {showArchived && (
                  <optgroup label="Archived workspaces">
                    {cases
                      .filter((c) => c.archived && c.id !== caseId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.id.slice(0, 8)}
                        </option>
                      ))}
                  </optgroup>
                )}
                {cases.some((c) => c.archived) && (
                  <option value="toggle-archive">
                    {showArchived
                      ? "Hide archived workspaces"
                      : `Show archived workspaces (${cases.filter((c) => c.archived).length})`}
                  </option>
                )}
              </select>
            ) : (
              <span>Untitled workspace</span>
            )}
            <ChevronDown size={12} />
          </div>
          <button
            className="icon-button new-case-button"
            aria-label="Create new case"
            disabled={!!busy}
            onClick={() => setModal("new")}
          >
            <Plus size={16} />
          </button>
          <div className="topbar-end">
            <span className="local-badge">
              <span />
              Local workspace
            </span>
            <button
              className="button small ghost"
              onClick={() => setModal("upload")}
              disabled={!!busy}
            >
              <Upload size={14} />
              Import files
            </button>
          </div>
        </header>
        <div className="workspace-body">
          <nav className="tool-rail" aria-label="Workspace sections">
            {paneOptions.map((item) => (
              <button
                key={item.key}
                aria-label={item.title}
                title={item.title}
                aria-pressed={pane === item.key}
                className={pane === item.key ? "selected" : ""}
                onClick={() => {
                  setPane(item.key);
                  setSidebarOpen(true);
                  setModelFocus(false);
                  if (window.innerWidth <= 540) {
                    setMobileSidebar(true);
                    setInspectorOpen(false);
                  }
                }}
              >
                <item.icon
                  size={21}
                  weight={pane === item.key ? "fill" : "regular"}
                />
              </button>
            ))}
            <div className="rail-bottom">
              <span title="Local, single-operator workspace">
                <ShieldCheck size={19} />
              </span>
              <span className="rail-version">v0.1</span>
            </div>
          </nav>
          <aside
            className={`sidebar ${mobileSidebar ? "mobile-open" : ""} ${!sidebarOpen || modelFocus ? "collapsed" : ""}`}
          >
            <div className="panel-heading">
              <h2>{paneOptions.find((p) => p.key === pane)?.title}</h2>
              <button
                className="icon-button mobile-sidebar-close"
                aria-label="Close sections"
                onClick={() => setMobileSidebar(false)}
              >
                <X size={14} />
              </button>
              <span className="count">
                {paneOptions.find((p) => p.key === pane)?.count}
              </span>
              {pane === "sources" && (
                <button
                  className="icon-button"
                  aria-label="Import a source"
                  onClick={() => setModal("upload")}
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            <div className="sidebar-content">
              {pane === "spaces" && (
                <>
                  {detail?.units.length ? (
                    <>
                      <div className="tree-context">
                        <ChevronDown size={12} />
                        <Box size={14} />
                        <strong>Building spaces</strong>
                        <span>{detail.units.length}</span>
                      </div>
                      {floors.map((level) => (
                        <div className="floor-group" key={level}>
                          <button
                            className={`floor-group-heading ${floor === level ? "active-floor" : ""}`}
                            aria-expanded={!collapsedFloors.has(level)}
                            onClick={() =>
                              setCollapsedFloors((previous) => {
                                const next = new Set(previous);
                                if (next.has(level)) next.delete(level);
                                else next.add(level);
                                return next;
                              })
                            }
                          >
                            <ChevronDown
                              size={11}
                              className={
                                collapsedFloors.has(level) ? "is-closed" : ""
                              }
                            />
                            <span>{level}</span>
                            <code className="tree-identity-code">
                              {
                                detail.identity?.floors.find(
                                  (f) => f.label === identityLevel(level),
                                )?.code
                              }
                            </code>
                            <span>
                              {
                                detail.units.filter(
                                  (u) =>
                                    (u.levelLabel || "Unassigned") === level,
                                ).length
                              }
                            </span>
                          </button>
                          {!collapsedFloors.has(level) &&
                            detail.units
                              .filter(
                                (u) => (u.levelLabel || "Unassigned") === level,
                              )
                              .map((u) => (
                                <button
                                  key={u.id}
                                  className={`unit-row ${selectedId === u.id ? "selected" : ""}`}
                                  aria-label={`${u.alias} ${u.name}${!u.lowerVerified || !u.upperVerified ? " Unverified elevation" : ""}`}
                                  onClick={() => selectUnit(u.id)}
                                >
                                  <span
                                    className="unit-swatch"
                                    style={{ background: unitColor(u) }}
                                  />
                                  <span>
                                    <strong>{u.alias}</strong>
                                    <small>{u.name}</small>
                                    {detail.identity?.spaces.find(
                                      (s) => s.unitId === u.id,
                                    ) && (
                                      <code className="tree-identity-code">
                                        {
                                          detail.identity.spaces.find(
                                            (s) => s.unitId === u.id,
                                          )!.code
                                        }
                                      </code>
                                    )}
                                  </span>
                                  <span className="unit-meta">
                                    <span>
                                      {number(u.lower)}–{number(u.upper)}
                                      <small>m</small>
                                    </span>
                                    {(!u.lowerVerified || !u.upperVerified) && (
                                      <CircleAlert
                                        size={12}
                                        className="warning-icon"
                                        aria-label="Unverified elevation"
                                      />
                                    )}
                                  </span>
                                </button>
                              ))}
                        </div>
                      ))}
                      {detail.context.length > 0 && (
                        <div className="context-list">
                          <div className="floor-group-heading">
                            Context <span>{detail.context.length}</span>
                          </div>
                          {detail.context.map((c) => (
                            <div key={c.alias}>
                              <Map size={13} />
                              <span>{c.alias}</span>
                              <small>{c.kind}</small>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="sidebar-empty">
                      <Layers3 size={23} />
                      <strong>Your spaces will live here</strong>
                      <p>
                        Import footprints and level evidence, then prepare the
                        draft geometry.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setPane("sources")}
                      >
                        Open sources <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                </>
              )}
              {pane === "sources" && (
                <>
                  <details className="demo-file-library">
                    <summary>Demo files & public data</summary>
                    <p>
                      C-001 / C-002 are synthetic. NYC is a real public
                      footprint converted to our input schema; interior floors
                      are not supplied.
                    </p>
                    <strong>C-001 synthetic files</strong>
                    {[
                      "spatial.json",
                      "levels-r1.csv",
                      "controls.csv",
                      "plan.png",
                      "plan.pdf",
                    ].map((name) => (
                      <a
                        key={name}
                        href={`/api/v1/demo-files/c001/${name}`}
                        download={name}
                      >
                        {name}
                      </a>
                    ))}
                    <strong>NYC public building</strong>
                    <a
                      href="/api/v1/demo-assets/real-nyc/original.geojson"
                      download="original.geojson"
                    >
                      Original geospatial file · GeoJSON
                    </a>
                    <a
                      href="/api/v1/demo-assets/real-nyc/provenance.json"
                      download="provenance.json"
                    >
                      Provenance & conversion details
                    </a>
                    <a
                      href="/api/v1/demo-files/real-nyc/spatial.json"
                      download="spatial.json"
                    >
                      Converted footprints · JSON
                    </a>
                    <a
                      href="/api/v1/demo-files/real-nyc/levels-r1.csv"
                      download="levels-r1.csv"
                    >
                      Converted roof height · CSV
                    </a>
                    <a
                      href="https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue"
                      target="_blank"
                      rel="noreferrer"
                    >
                      NYC Open Data source ↗
                    </a>
                    <strong>Indian building data</strong>
                    <a
                      href="https://sites.research.google/gr/open-buildings/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Open Buildings · India coverage ↗
                    </a>
                    <a
                      href="https://github.com/microsoft/GlobalMLBuildingFootprints"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Microsoft building footprints · India tiles ↗
                    </a>
                    <p>
                      These downloads need conversion to our local-metre schema
                      before upload. Footprints alone do not supply interior
                      floors or rooms; heights need separate evidence.
                    </p>
                  </details>
                  {detail?.sources.length ? (
                    <>
                      <div className="section-note">
                        Originals are preserved. Uploading does not change the
                        model.
                      </div>
                      {detail.sources.map((s) => (
                        <div className="source-file-row" key={s.id}>
                          <button
                            className={`source-row ${inspection?.type === "source" && inspection.id === s.id ? "selected" : ""}`}
                            onClick={() => selectSource(s)}
                          >
                            <span className="file-icon">
                              <SourceIcon profile={s.profile} />
                            </span>
                            <span className="source-row-content">
                              <strong title={s.name}>{s.name}</strong>
                              <span>
                                <small>
                                  r{s.revision} · {number(s.bytes / 1024, 1)} KB
                                </small>
                                <Status value={s.status} />
                              </span>
                            </span>
                          </button>
                          <button
                            className="source-preview-action"
                            aria-label={`Preview ${s.name} revision ${s.revision}`}
                            onClick={() => setPreviewSource(s)}
                          >
                            Preview
                          </button>
                        </div>
                      ))}
                      <button
                        className="source-add"
                        onClick={() => setModal("upload")}
                      >
                        <Plus size={14} />
                        Add another source
                      </button>
                      {!!detail.units.length &&
                        !detail.case.frame.id.startsWith("NYC-") && (
                          <button
                            className="source-add revised"
                            disabled={!!busy}
                            onClick={reviseDemo}
                          >
                            <RefreshCw size={14} />
                            Load revised demo levels
                          </button>
                        )}
                    </>
                  ) : (
                    <div className="sidebar-empty">
                      <FolderOpen size={24} />
                      <strong>Start with the evidence</strong>
                      <p>
                        Spatial JSON, level and control CSVs, PNG or PDF plan
                        references.
                      </p>
                      <button
                        className="button small"
                        onClick={() => setModal("upload")}
                      >
                        <Upload size={13} />
                        Import files
                      </button>
                    </div>
                  )}
                </>
              )}
              {pane === "findings" && (
                <>
                  {detail?.model ? (
                    <>
                      <div
                        className={`check-summary ${overlapFindings.length ? "has-conflict" : ""}`}
                      >
                        <ScanLine size={19} />
                        <div>
                          <strong>
                            {overlapFindings.length
                              ? `${overlapFindings.length} volumetric overlap${overlapFindings.length === 1 ? "" : "s"}`
                              : "No positive-volume overlaps"}
                          </strong>
                          <span>
                            {modelFresh
                              ? "Computed for the current revision"
                              : "Previous revision · rebuild required"}
                          </span>
                        </div>
                      </div>
                      {detail.model.findings.map((f) => (
                        <button
                          key={f.id}
                          className={`finding-row ${activeFinding === f.id ? "selected" : ""}`}
                          onClick={() => selectFinding(f)}
                        >
                          <span className={`finding-dot ${f.severity}`} />
                          <div>
                            <strong>{f.title}</strong>
                            <p>
                              {f.overlap
                                ? `${number(f.overlap.volume, 3)} m³ shared volume`
                                : f.code.replaceAll("_", " ").toLowerCase()}
                            </p>
                          </div>
                          <ChevronRight size={13} />
                        </button>
                      ))}
                      {!detail.model.findings.length && (
                        <div className="sidebar-empty">
                          <CheckCheck size={23} />
                          <strong>Checks completed</strong>
                          <p>No findings were returned for this snapshot.</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="sidebar-empty">
                      <ScanLine size={24} />
                      <strong>Compute before concluding</strong>
                      <p>
                        Build a model to check geometry, evidence, and
                        intersections.
                      </p>
                    </div>
                  )}
                </>
              )}
              {pane === "history" && (
                <>
                  {detail?.history.length ? (
                    <div className="history-list">
                      {detail.history.map((h) => (
                        <div key={h.id}>
                          <span className="history-dot" />
                          <div>
                            <small>
                              {shortTime(h.createdAt)} ·{" "}
                              {h.kind.replaceAll("_", " ")}
                            </small>
                            <p>{h.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="sidebar-empty">
                      <History size={23} />
                      <strong>A traceable working history</strong>
                      <p>
                        Source receipts, edits, and model builds appear here as
                        you work.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="sidebar-bottom">
              <div>
                <span className="eyebrow">WORKING FRAME</span>
                <strong>
                  {detail?.case.frame.id || "Awaiting source frame"}
                </strong>
              </div>
              <div className="frame-foot">
                <span>
                  {detail?.case.frame.benchmark || "Local metric coordinates"}
                </span>
                <span>m</span>
              </div>
            </div>
          </aside>
          <main id="model-workspace" className="main-workspace" tabIndex={-1}>
            <div className="workspace-heading">
              <div>
                <h1>{detail?.case.name || "Untitled property"}</h1>
                <span className="drawing-meta">
                  {detail ? `Draft r${detail.case.revision}` : "New workspace"}
                  <span>·</span>
                  {detail?.units.length || 0} spaces
                </span>
              </div>
              <div className="workflow-actions">
                {detail && !!inspectedSpatial.length && (
                  <button
                    className="button"
                    disabled={!!busy || !!pending.length}
                    onClick={showPrepare}
                  >
                    <Layers3 size={14} />
                    {detail.units.length ? "Prepare again" : "Prepare geometry"}
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={!detail?.units.length || !!busy || buildPending}
                  onClick={build}
                >
                  {buildPending ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Box size={15} />
                  )}
                  {buildPending
                    ? "Building…"
                    : detail?.model && !modelFresh
                      ? "Rebuild model"
                      : "Build model"}
                </button>
              </div>
            </div>
            {detail?.identity && (
              <PropertyIdentity
                key={detail.case.id}
                detail={detail}
                onSelect={selectUnit}
              />
            )}
            <div className="viewport-toolbar">
              <button
                className="icon-button tree-toggle"
                title={
                  sidebarOpen && !modelFocus
                    ? "Hide model tree"
                    : "Show model tree"
                }
                aria-label={
                  sidebarOpen && !modelFocus
                    ? "Hide model tree"
                    : "Show model tree"
                }
                onClick={() => {
                  setSidebarOpen(!(sidebarOpen && !modelFocus));
                  setModelFocus(false);
                }}
              >
                <SidebarSimple size={18} />
              </button>
              <div className="view-tabs" role="tablist" aria-label="Model view">
                {(["3d", "plan", "split"] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                  >
                    {v === "3d" ? (
                      <Box size={13} />
                    ) : v === "plan" ? (
                      <Map size={13} />
                    ) : (
                      <Columns size={14} />
                    )}
                    {v === "3d" ? "3D model" : v === "plan" ? "Plan" : "Split"}
                  </button>
                ))}
                {view === "reference" && (
                  <button
                    role="tab"
                    aria-selected="true"
                    className="reference-tab"
                  >
                    <FileImage size={13} />
                    Reference
                  </button>
                )}
              </div>
              <div className="viewport-options">
                {!!floors.length && (
                  <>
                    <select
                      aria-label="Visible floor"
                      value={floor}
                      onChange={(e) => setFloor(e.target.value)}
                    >
                      <option value="all">All floors</option>
                      {floors.map((f) => (
                        <option value={f} key={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                    <button
                      className={`icon-button ${isolate ? "active" : ""}`}
                      onClick={() => setIsolate(!isolate)}
                      disabled={!selectedId}
                      aria-label="Isolate selected space"
                      aria-pressed={isolate}
                      title="Isolate selected space"
                    >
                      <Focus size={15} />
                    </button>
                    <label
                      className="explode-control"
                      title="Separate floors visually; does not change measurements"
                    >
                      <Layers3 size={14} />
                      <input
                        type="range"
                        min="0"
                        max="3"
                        step="0.25"
                        value={explode}
                        onChange={(e) => {
                          setExplode(Number(e.target.value));
                          setActiveFinding(null);
                        }}
                        aria-label="Separate floors visually"
                      />
                    </label>
                  </>
                )}
                <button
                  className={`icon-button focus-model ${modelFocus ? "active" : ""}`}
                  title={modelFocus ? "Exit model focus" : "Focus model"}
                  aria-label={modelFocus ? "Exit model focus" : "Focus model"}
                  aria-pressed={modelFocus}
                  onClick={() => {
                    setModelFocus(!modelFocus);
                    setMobileSidebar(false);
                  }}
                >
                  {modelFocus ? (
                    <ArrowsInSimple size={18} />
                  ) : (
                    <Maximize2 size={18} />
                  )}
                </button>
                <button
                  className="icon-button inspector-toggle"
                  aria-label={
                    inspectorOpen && !modelFocus
                      ? "Hide inspector"
                      : "Show inspector"
                  }
                  onClick={() => {
                    setInspectorOpen(!(inspectorOpen && !modelFocus));
                    setModelFocus(false);
                  }}
                >
                  {inspectorOpen ? (
                    <PanelRightClose size={16} />
                  ) : (
                    <PanelRightOpen size={16} />
                  )}
                </button>
              </div>
            </div>
            <div className={`viewport ${view === "split" ? "split-view" : ""}`}>
              {loading ? (
                <div className="viewer-loading">
                  <LoaderCircle size={22} className="spin" />
                  <span>Opening workspace…</span>
                </div>
              ) : view === "reference" && reference ? (
                <SourcePreview
                  key={reference.id}
                  source={reference}
                  onOpenPreview={() => setPreviewSource(reference)}
                  controls={inspectedControls.flatMap(
                    (s) => s.inspection?.controls || [],
                  )}
                  busy={!!busy}
                  onTrace={async (value) => {
                    if (!detail) return false;
                    return run(
                      "Saving traced space",
                      async () => {
                        const added = await api.addUnit(detail.case.id, {
                          ...value,
                          kind: "unit",
                          levelLabel: "Traced level",
                        });
                        await refresh();
                        selectUnit(added.id);
                        setPane("spaces");
                        setView("plan");
                      },
                      "Traced space saved as a draft. Build to compute geometry.",
                    );
                  }}
                />
              ) : (
                <>
                  {(view === "plan" || view === "split") &&
                    !!detail?.units.length && (
                      <div className="plan-viewport">
                        <PlanView
                          units={detail.units}
                          context={detail.context}
                          selectedId={selectedId}
                          onSelect={selectUnit}
                          floor={floor}
                          isolate={isolate}
                          finding={highlighted}
                          busy={!!busy}
                          onSave={async (u, footprint) => {
                            return run(
                              "Saving footprint revision",
                              async () => {
                                await api.editUnit(detail.case.id, u.id, {
                                  expectedRevision: u.revision,
                                  footprint,
                                });
                                await refresh();
                              },
                              "Footprint saved. Rebuild to refresh the model.",
                            );
                          }}
                        />
                      </div>
                    )}
                  {(view === "3d" || view === "split") && detail?.model && (
                    <div className="scene-viewport">
                      <SpatialViewer
                        model={detail.model}
                        selectedId={selectedId}
                        onSelect={selectUnit}
                        floor={floor}
                        isolate={isolate}
                        explode={explode}
                        finding={highlighted}
                      />
                      <div className="scene-tag">
                        <span className="scene-status-dot" />
                        {modelFresh ? "Computed geometry" : "Previous geometry"}
                        <span className="tag-divider" />r{detail.model.revision}
                      </div>
                      {!modelFresh && (
                        <div className="stale-banner">
                          <Clock3 size={13} />
                          Draft changed. Rebuild for current geometry and
                          checks.
                        </div>
                      )}
                      {explode > 0 && (
                        <div className="display-warning">
                          Floors separated for display · measurements unchanged
                        </div>
                      )}
                      {highlighted?.overlap && (
                        <div className="overlap-label">
                          <span />
                          <strong>
                            {number(highlighted.overlap.volume, 3)} m³
                          </strong>
                          computed overlap
                          <button
                            aria-label="Clear overlap highlight"
                            onClick={() => setActiveFinding(null)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {(!detail?.units.length ||
                    ((view === "3d" || view === "split") &&
                      !detail?.model)) && (
                    <div
                      className={`empty-viewport ${detail?.units.length ? "prepared-empty" : ""}`}
                    >
                      <div className="empty-grid" />
                      <div className="empty-corner top-left" />
                      <div className="empty-corner bottom-right" />
                      <div className="empty-content">
                        <div className="empty-symbol">
                          <Mark size={55} />
                        </div>
                        <span className="eyebrow">
                          Property modelling workspace
                        </span>
                        <h2>
                          {detail?.units.length
                            ? "Draft geometry is ready."
                            : detail?.sources.length
                              ? "Sources ready for review."
                              : "Create a property model."}
                        </h2>
                        <p>
                          {detail?.units.length
                            ? `${detail.units.length} draft spaces are prepared. Build the model to compute volumes, evidence checks, and intersections.`
                            : detail?.sources.length
                              ? "Inspect your sources, then prepare the footprints and vertical limits. Each step stays explicit and traceable."
                              : blockReturn
                                ? "Add supporting plans in this building’s Plan Workspace."
                                : "Import local footprints and level evidence, or open a sample dataset to explore the complete workflow."}
                        </p>
                        {detail?.units.length ? (
                          <button
                            className="button primary"
                            disabled={!!busy || buildPending}
                            onClick={build}
                          >
                            <Box size={15} />
                            {buildPending
                              ? "Building model…"
                              : "Build 3D model"}
                            <ArrowRight size={15} />
                          </button>
                        ) : detail?.sources.length ? (
                          <button
                            className="button primary"
                            disabled={
                              !inspectedSpatial.length ||
                              !!busy ||
                              !!pending.length
                            }
                            onClick={showPrepare}
                          >
                            {pending.length ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <Layers3 size={15} />
                            )}
                            {pending.length
                              ? "Inspecting source files…"
                              : "Prepare geometry"}
                            <ArrowRight size={15} />
                          </button>
                        ) : (
                          <>
                            {!blockReturn && (
                              <div className="sample-choice">
                                <select
                                  aria-label="Sample dataset"
                                  value={dataset}
                                  onChange={(e) =>
                                    setDataset(
                                      e.target.value as
                                        "c001" | "c002" | "real-nyc",
                                    )
                                  }
                                >
                                  <option value="real-nyc">
                                    NYC · Public building footprint
                                  </option>
                                  <option value="c001">
                                    C-001 · Reference building
                                  </option>
                                  <option value="c002">
                                    C-002 · Alternate footprint
                                  </option>
                                </select>
                                <button
                                  className="button primary"
                                  disabled={!!busy}
                                  onClick={loadDemo}
                                >
                                  {busy ? (
                                    <LoaderCircle size={15} className="spin" />
                                  ) : (
                                    <ArrowDownToLine size={15} />
                                  )}
                                  Load sample inputs
                                </button>
                              </div>
                            )}
                            <button
                              className="text-button"
                              onClick={() => setModal("upload")}
                            >
                              or import your own files <ArrowRight size={13} />
                            </button>
                          </>
                        )}
                        <div className="empty-disclaimer">
                          {dataset === "real-nyc"
                            ? "Public NYC data · converted envelope; interiors unknown"
                            : "Synthetic sample data"}{" "}
                          <span>·</span> Local metres
                        </div>
                      </div>
                      <div className="workflow-strip">
                        <span
                          className={
                            detail?.sources.length ? "done" : "current"
                          }
                        >
                          <span>01</span>Import evidence
                        </span>
                        <ChevronRight size={12} />
                        <span
                          className={
                            detail?.units.length
                              ? "done"
                              : detail?.sources.length
                                ? "current"
                                : ""
                          }
                        >
                          <span>02</span>Prepare spaces
                        </span>
                        <ChevronRight size={12} />
                        <span className={detail?.units.length ? "current" : ""}>
                          <span>03</span>Build & inspect
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="workspace-bottom">
              <span>
                <span
                  className={`connection-dot ${health === true ? "connected" : health === false ? "disconnected" : ""}`}
                />
                {busy ||
                  (pending.length
                    ? `${pending.length} processing job${pending.length === 1 ? "" : "s"} active`
                    : health === true
                      ? "Local services connected"
                      : health === false
                        ? "Services unavailable"
                        : "Checking local services")}
              </span>
              <div>
                {pending.length > 0 && (
                  <LoaderCircle size={11} className="spin" />
                )}
                <span>{detail?.units.length || 0} spaces</span>
                <span>·</span>
                <span>{detail?.sources.length || 0} sources</span>
                <span>·</span>
                <span>metres</span>
                <button
                  className="icon-button"
                  aria-label="Refresh workspace"
                  onClick={() => {
                    void run("Refreshing workspace", async () => {
                      const result = await refreshCases();
                      if (!caseId && result[0]) setCaseId(result[0].id);
                      else await refresh();
                    });
                  }}
                >
                  <RefreshCw size={11} />
                </button>
              </div>
            </div>
          </main>
          {inspectorOpen && !modelFocus && (
            <aside className="inspector">
              <div className="panel-heading">
                <h2>
                  {unit
                    ? "Space inspector"
                    : source
                      ? "Source inspector"
                      : finding
                        ? "Finding inspector"
                        : "Model overview"}
                </h2>
                <button
                  className="icon-button"
                  aria-label="Close inspector"
                  onClick={() => setInspectorOpen(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="inspector-content">
                {unit ? (
                  <>
                    <div className="unit-identity">
                      <span
                        className="unit-large-swatch"
                        style={{ background: unitColor(unit) }}
                      >
                        <Box size={23} />
                      </span>
                      <span className="eyebrow">
                        {unit.kind} · REVISION {unit.revision}
                      </span>
                      <h2
                        className={
                          unit.alias.length > 10 ? "long-unit-alias" : undefined
                        }
                      >
                        {unit.alias}
                      </h2>
                      <p>{unit.name}</p>
                      <span className="subtle-label">
                        {unit.levelLabel || "Unassigned level"}
                      </span>
                    </div>
                    {detail?.identity?.spaces.find(
                      (s) => s.unitId === unit.id,
                    ) && (
                      <section className="inspector-section space-identifier-card">
                        <div className="section-title">
                          <h3>3D ULPIN · space</h3>
                          <span>Prototype</span>
                        </div>
                        <IdentifierValue
                          value={
                            detail.identity.spaces.find(
                              (s) => s.unitId === unit.id,
                            )!.id
                          }
                          label="selected space 3D ULPIN"
                        />
                        <p className="small-note">
                          Floor:{" "}
                          {
                            detail.identity.floors.find(
                              (f) =>
                                f.id ===
                                detail.identity.spaces.find(
                                  (s) => s.unitId === unit.id,
                                )!.parentId,
                            )?.label
                          }
                          . Parent property: {detail.identity.rootId}
                        </p>
                      </section>
                    )}
                    <section className="inspector-section">
                      <div className="section-title">
                        <h3>Computed quantities</h3>
                        {computed && (
                          <small>model r{detail?.model?.revision}</small>
                        )}
                      </div>
                      <div className="quantities">
                        <div>
                          <span>Footprint area</span>
                          <strong>
                            {number(computed?.area)}
                            <small>m²</small>
                          </strong>
                        </div>
                        <div>
                          <span>Volume</span>
                          <strong>
                            {number(computed?.volume)}
                            <small>m³</small>
                          </strong>
                        </div>
                        <div>
                          <span>Height</span>
                          <strong>
                            {number(computed?.height)}
                            <small>m</small>
                          </strong>
                        </div>
                      </div>
                      {!modelFresh && (
                        <p className="small-note">
                          {computed
                            ? "Values belong to the previous model. Rebuild after changes."
                            : "Build a model to compute these values."}
                        </p>
                      )}
                    </section>
                    <section className="inspector-section">
                      <div className="section-title">
                        <h3>Vertical limits</h3>
                        <span>metres</span>
                      </div>
                      <div className="elevation-fields">
                        <label>
                          <span>
                            Lower{" "}
                            <span
                              className={
                                unit.lowerVerified
                                  ? "verified-dot"
                                  : "unverified-dot"
                              }
                              title={
                                unit.lowerVerified
                                  ? "Supported by evidence"
                                  : "Unverified operator value"
                              }
                            />
                          </span>
                          <input
                            aria-label="Lower elevation in metres"
                            type="number"
                            step="0.01"
                            value={lower}
                            onChange={(e) => setLower(e.target.value)}
                          />
                          <small>
                            {unit.lowerVerified
                              ? "Evidence supported"
                              : "Unverified draft"}
                          </small>
                        </label>
                        <label>
                          <span>
                            Upper{" "}
                            <span
                              className={
                                unit.upperVerified
                                  ? "verified-dot"
                                  : "unverified-dot"
                              }
                            />
                          </span>
                          <input
                            aria-label="Upper elevation in metres"
                            type="number"
                            step="0.01"
                            value={upper}
                            onChange={(e) => setUpper(e.target.value)}
                          />
                          <small>
                            {unit.upperVerified
                              ? "Evidence supported"
                              : "Unverified draft"}
                          </small>
                        </label>
                      </div>
                      <button
                        className="button full small"
                        disabled={
                          !!busy ||
                          (lower === String(unit.lower ?? "") &&
                            upper === String(unit.upper ?? ""))
                        }
                        onClick={saveElevations}
                      >
                        <Check size={14} />
                        Save limits
                      </button>
                      <p className="small-note">
                        Manual changes create a draft revision and require fresh
                        checks.
                      </p>
                    </section>
                    <section className="inspector-section">
                      <div className="section-title">
                        <h3>Evidence bindings</h3>
                        <span>4 components</span>
                      </div>
                      {(
                        ["footprint", "lower", "upper", "alignment"] as const
                      ).map((key) => {
                        const binding = unit.bindings[key];
                        const linkedSource = detail?.sources.find(
                          (s) => s.id === binding?.sourceId,
                        );
                        return (
                          <button
                            key={key}
                            className="binding-row"
                            disabled={!linkedSource}
                            onClick={() =>
                              linkedSource && setPreviewSource(linkedSource)
                            }
                          >
                            <span
                              className={
                                binding ? "binding-check" : "binding-missing"
                              }
                            >
                              {binding ? (
                                <Check size={12} />
                              ) : (
                                <Circle size={9} />
                              )}
                            </span>
                            <span>
                              <strong>
                                {key === "lower"
                                  ? "Lower limit"
                                  : key === "upper"
                                    ? "Upper limit"
                                    : key === "alignment"
                                      ? "Horizontal alignment"
                                      : "Footprint"}
                              </strong>
                              <small>
                                {linkedSource
                                  ? `${linkedSource.name} · r${linkedSource.revision}`
                                  : "No source binding"}
                              </small>
                              {binding && <code>{binding.locator}</code>}
                            </span>
                            {binding && <ChevronRight size={12} />}
                          </button>
                        );
                      })}
                    </section>
                    <button
                      className="text-button inspector-plan-link"
                      onClick={() => setView("plan")}
                    >
                      <PencilSimple size={14} />
                      Edit footprint in plan <ArrowRight size={13} />
                    </button>
                  </>
                ) : source ? (
                  <>
                    <div className="source-identity">
                      <span className="document-symbol">
                        <SourceIcon profile={source.profile} size={30} />
                      </span>
                      <h2>{source.name}</h2>
                      <div>
                        <Status value={source.status} />
                        <span className="subtle-label">
                          Revision {source.revision}
                        </span>
                      </div>
                      <p>
                        {source.inspection?.summary ||
                          "File received. Technical inspection has not completed yet."}
                      </p>
                    </div>
                    <section className="inspector-section">
                      <div className="section-title">
                        <h3>Original file</h3>
                        <div className="row">
                          <button
                            className="button small"
                            onClick={() => setPreviewSource(source)}
                          >
                            Preview file
                          </button>
                          <a
                            className="icon-button"
                            href={sourceUrl(source.id)}
                            download={source.name}
                            aria-label="Download source original"
                          >
                            <Download size={14} />
                          </a>
                        </div>
                      </div>
                      <dl className="metadata-list">
                        <div>
                          <dt>Profile</dt>
                          <dd>
                            {
                              profiles.find((p) => p.value === source.profile)
                                ?.label
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>Bytes</dt>
                          <dd>{number(source.bytes, 0)}</dd>
                        </div>
                        <div>
                          <dt>Received</dt>
                          <dd>{shortTime(source.createdAt)}</dd>
                        </div>
                        <div>
                          <dt>SHA-256</dt>
                          <dd>
                            <code title={source.sha256}>
                              {source.sha256.slice(0, 14)}…
                              {source.sha256.slice(-8)}
                            </code>
                          </dd>
                        </div>
                      </dl>
                    </section>
                    {source.inspection?.issues.length ? (
                      <section className="inspector-section">
                        <div className="section-title">
                          <h3>Inspection notes</h3>
                        </div>
                        {source.inspection.issues.map((issue, i) => (
                          <div
                            key={i}
                            className={`inspection-issue ${issue.severity}`}
                          >
                            <CircleAlert size={13} />
                            <div>
                              <strong>
                                {issue.code.replaceAll("_", " ").toLowerCase()}
                              </strong>
                              <p>{issue.message}</p>
                            </div>
                          </div>
                        ))}
                      </section>
                    ) : null}
                    {source.inspection?.levels && (
                      <section className="inspector-section">
                        <div className="section-title">
                          <h3>Level rows</h3>
                          <span>metres</span>
                        </div>
                        <table className="level-table">
                          <thead>
                            <tr>
                              <th>Space</th>
                              <th>Lower</th>
                              <th>Upper</th>
                            </tr>
                          </thead>
                          <tbody>
                            {source.inspection.levels.map((row) => (
                              <tr
                                key={row.alias}
                                title={`${row.locator} · ${row.benchmark} · ${row.method}`}
                              >
                                <td>{row.alias}</td>
                                <td
                                  className={
                                    row.lower === null ? "missing-value" : ""
                                  }
                                >
                                  {number(row.lower)}
                                </td>
                                <td
                                  className={
                                    row.upper === null ? "missing-value" : ""
                                  }
                                >
                                  {number(row.upper)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!!detail?.units.length && (
                          <button
                            className="button primary full small apply-levels"
                            disabled={!!busy || !suitable(source)}
                            onClick={() => applyLevels(source)}
                          >
                            <CheckCheck size={14} />
                            Apply this level evidence
                          </button>
                        )}
                        <p className="small-note">
                          Applying changes the evidence bindings. A new model
                          build is required.
                        </p>
                      </section>
                    )}
                    {source.inspection?.controls && (
                      <section className="inspector-section">
                        <div className="section-title">
                          <h3>Control points</h3>
                        </div>
                        <table className="level-table">
                          <thead>
                            <tr>
                              <th>Point</th>
                              <th>X / m</th>
                              <th>Y / m</th>
                            </tr>
                          </thead>
                          <tbody>
                            {source.inspection.controls.map((c) => (
                              <tr key={c.id}>
                                <td>{c.id}</td>
                                <td>{number(c.x)}</td>
                                <td>{number(c.y)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    )}
                    {source.inspection?.features && (
                      <section className="inspector-section">
                        <div className="section-title">
                          <h3>Spatial contents</h3>
                          <span>
                            {source.inspection.features.length} features
                          </span>
                        </div>
                        {source.inspection.features.map((f) => (
                          <div className="feature-row" key={f.alias}>
                            <Map size={12} />
                            <strong>{f.alias}</strong>
                            <span>{f.kind}</span>
                            <small>{f.footprint.length} points</small>
                          </div>
                        ))}
                      </section>
                    )}
                    {source.profile.startsWith("plan-") && suitable(source) && (
                      <button
                        className="button full small"
                        onClick={() => {
                          setReferenceId(source.id);
                          setView("reference");
                        }}
                      >
                        <FileImage size={14} />
                        Open reference & trace
                      </button>
                    )}
                    <button
                      className="text-button source-revision-link"
                      onClick={() => {
                        setUploadProfile(source.profile);
                        setUploadFamily(source.familyId);
                        setModal("upload");
                      }}
                    >
                      <Upload size={13} />
                      Upload next source revision
                    </button>
                  </>
                ) : finding ? (
                  <>
                    <div className={`finding-identity ${finding.severity}`}>
                      <ScanLine size={25} />
                      <span className="eyebrow">
                        {finding.severity} · {finding.code.replaceAll("_", " ")}
                      </span>
                      <h2>{finding.title}</h2>
                      <p>{finding.description}</p>
                    </div>
                    {finding.overlap && (
                      <div className="overlap-metric">
                        <span>Computed shared volume</span>
                        <strong>
                          {number(finding.overlap.volume, 3)}
                          <small>m³</small>
                        </strong>
                        <p>
                          Lower {number(finding.overlap.lower)} m → upper{" "}
                          {number(finding.overlap.upper)} m
                        </p>
                      </div>
                    )}
                    <section className="inspector-section">
                      <div className="section-title">
                        <h3>Contributing spaces</h3>
                      </div>
                      {finding.unitIds.map((id) => {
                        const u = detail?.units.find((item) => item.id === id);
                        return (
                          u && (
                            <button
                              key={id}
                              className="related-row"
                              onClick={() => selectUnit(id)}
                            >
                              <Box size={15} />
                              <span>
                                <strong>{u.alias}</strong>
                                <small>{u.name}</small>
                              </span>
                              <ChevronRight size={13} />
                            </button>
                          )
                        );
                      })}
                    </section>
                    <section className="inspector-section">
                      <div className="section-title">
                        <h3>Contributing sources</h3>
                      </div>
                      {finding.sourceIds.map((id) => {
                        const s = detail?.sources.find(
                          (item) => item.id === id,
                        );
                        return (
                          s && (
                            <button
                              key={id}
                              className="related-row"
                              onClick={() => setPreviewSource(s)}
                            >
                              <SourceIcon profile={s.profile} />
                              <span>
                                <strong>{s.name}</strong>
                                <small>Original revision {s.revision}</small>
                              </span>
                              <ChevronRight size={13} />
                            </button>
                          )
                        );
                      })}
                    </section>
                    <div className="finding-advice">
                      <Settings2 size={16} />
                      <p>
                        Inspect the source and vertical limits. Save a
                        correction or apply revised evidence, then rebuild to
                        check the result.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="guide-intro">
                      <span className="eyebrow">Model overview</span>
                      <h2>
                        {detail?.units.length
                          ? `${detail.units.length} spaces. One property.`
                          : "Start with source evidence."}
                      </h2>
                      <p>
                        Select a space in the model or tree to inspect its
                        dimensions and source bindings.
                      </p>
                    </div>
                    {detail && (
                      <dl className="overview-metadata metadata-list">
                        <div>
                          <dt>Working frame</dt>
                          <dd>{detail.case.frame.id}</dd>
                        </div>
                        <div>
                          <dt>Vertical benchmark</dt>
                          <dd>{detail.case.frame.benchmark}</dd>
                        </div>
                        <div>
                          <dt>Model revision</dt>
                          <dd>
                            {detail.model
                              ? `r${detail.model.revision}`
                              : "Not built"}
                          </dd>
                        </div>
                        <div>
                          <dt>Source originals</dt>
                          <dd>{detail.sources.length}</dd>
                        </div>
                      </dl>
                    )}
                    <div className="guide-steps">
                      <GuideStep
                        n="01"
                        title="Bring your sources"
                        text="Keep the original footprint, level measurements, and plans together."
                        done={!!detail?.sources.length}
                      />
                      <GuideStep
                        n="02"
                        title="Prepare a draft"
                        text="Join the footprints to their level evidence. Missing support stays visible."
                        done={!!detail?.units.length}
                      />
                      <GuideStep
                        n="03"
                        title="Compute & inspect"
                        text="Select a space. Explore quantities, evidence bindings, and actual intersections."
                        done={!!detail?.model}
                      />
                      <GuideStep
                        n="04"
                        title="Correct & rebuild"
                        text="Apply revised evidence or edit a dimension. Check what changed."
                        done={
                          !!detail?.model &&
                          modelFresh &&
                          detail.model.revision > 1 &&
                          !overlapFindings.length
                        }
                      />
                    </div>
                    {detail?.model && (
                      <button
                        className="button small full"
                        onClick={() => setPane("findings")}
                      >
                        <ScanLine size={14} />
                        Explore computed checks <ArrowRight size={14} />
                      </button>
                    )}
                    <div className="guide-note">
                      <ShieldCheck size={18} />
                      <p>
                        This is a local prototype. Source measurements, derived
                        envelopes and synthetic examples remain distinct. Draft
                        geometry does not establish legal rights or official
                        identity.
                      </p>
                    </div>
                  </>
                )}
                {detail?.jobs.some((j) => j.status === "failed") && (
                  <section className="inspector-section">
                    <div className="section-title">
                      <h3>Processing needs attention</h3>
                    </div>
                    {detail.jobs
                      .filter((j) => j.status === "failed")
                      .map((j) => (
                        <div className="failed-job" key={j.id}>
                          <strong>{j.operation} failed</strong>
                          <p>{j.error}</p>
                          <button
                            className="button small"
                            disabled={!!busy}
                            onClick={() =>
                              run("Retrying processing", async () => {
                                await api.retry(j.id);
                                await refresh();
                              })
                            }
                          >
                            <RotateCcw size={12} />
                            Retry
                          </button>
                        </div>
                      ))}
                  </section>
                )}
              </div>
              <div className="inspector-footer">
                <span className="tiny-mark">
                  <Mark size={15} />
                </span>
                Local metric workspace ·{" "}
                {detail?.case.frame.id.startsWith("NYC-")
                  ? "NYC public data · envelope approximation"
                  : "Prototype demonstration"}
              </div>
            </aside>
          )}
        </div>
        {(error || notice) && (
          <div
            className={`toast ${error ? "error-toast" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error ? <CircleAlert size={17} /> : <Check size={17} />}
            <span>{error || notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => {
                setError(null);
                setNotice(null);
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {previewSource && (
          <SourceFileDialog
            key={previewSource.id}
            source={previewSource}
            onClose={() => setPreviewSource(null)}
          />
        )}
        {modal && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) setModal(null);
            }}
          >
            <section
              ref={modalElement}
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
            >
              <div className="modal-heading">
                <span className="eyebrow">
                  {modal === "new"
                    ? "NEW WORKSPACE"
                    : modal === "prepare"
                      ? "EXPLICIT SOURCE BINDING"
                      : "SOURCE RECEIPT"}
                </span>
                <button
                  className="icon-button"
                  aria-label="Close dialog"
                  onClick={() => setModal(null)}
                  disabled={!!busy}
                >
                  <X size={18} />
                </button>
              </div>
              <h2 id="modal-title">
                {modal === "new"
                  ? "Give the property a workspace."
                  : modal === "prepare"
                    ? "Prepare the geometry."
                    : "Bring the original file."}
              </h2>
              <p className="modal-intro">
                {modal === "new"
                  ? "Each case keeps its own sources, revisions, models, and history."
                  : modal === "prepare"
                    ? "Choose the inspected sources to use. Draft hints remain unverified. This prepares units; the 3D model is computed separately."
                    : "Files are stored privately and inspected before use. Importing a source does not apply it to your model."}
              </p>
              {modal === "new" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("Creating workspace", async () => {
                      if (!newName.trim())
                        throw new Error("Enter a workspace name.");
                      const created = await api.createCase(newName.trim());
                      await refreshCases();
                      setCaseId(created.id);
                      setModal(null);
                    });
                  }}
                >
                  <label className="form-field">
                    Workspace name
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      maxLength={100}
                    />
                  </label>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => setModal(null)}
                    >
                      Cancel
                    </button>
                    <button className="button primary" disabled={!!busy}>
                      Create workspace <ArrowRight size={14} />
                    </button>
                  </div>
                </form>
              ) : modal === "prepare" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!detail) return;
                    void run(
                      "Preparing unit drafts",
                      async () => {
                        const result = await api.prepare(
                          detail.case.id,
                          prepareSpatial,
                          prepareLevels || undefined,
                          prepareControl || undefined,
                        );
                        setDetail(result);
                        setModal(null);
                        setPane("spaces");
                        setView("plan");
                        setFloor(
                          result.units.find((u) => u.kind === "unit")
                            ?.levelLabel || "all",
                        );
                      },
                      "Draft spaces prepared. Review their limits, then build the model.",
                    );
                  }}
                >
                  <label className="form-field">
                    Footprint source
                    <select
                      value={prepareSpatial}
                      onChange={(e) => setPrepareSpatial(e.target.value)}
                      required
                    >
                      {inspectedSpatial.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · r{s.revision}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    Level evidence
                    <select
                      value={prepareLevels}
                      onChange={(e) => setPrepareLevels(e.target.value)}
                    >
                      <option value="">
                        No source · retain unverified draft hints
                      </option>
                      {inspectedLevels.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · r{s.revision}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    Control reference
                    <select
                      value={prepareControl}
                      onChange={(e) => setPrepareControl(e.target.value)}
                    >
                      <option value="">No control source</option>
                      {inspectedControls.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · r{s.revision}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!!detail?.units.length && (
                    <p className="inline-warning">
                      Preparing again reimports the selected footprints and
                      levels. Existing draft edits may be replaced; their
                      history remains preserved.
                    </p>
                  )}
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => setModal(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="button primary"
                      disabled={!prepareSpatial || !!busy}
                    >
                      <Layers3 size={14} />
                      Prepare draft spaces
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      "Uploading original source",
                      async () => {
                        if (!uploadFile)
                          throw new Error("Choose a source file.");
                        if (uploadFile.size > 16 * 1024 * 1024)
                          throw new Error("The maximum source size is 16 MiB.");
                        const target =
                          detail?.case ||
                          (await api.createCase(
                            newName || "Untitled property",
                          ));
                        if (!detail) {
                          setCaseId(target.id);
                          currentId.current = target.id;
                          await refreshCases();
                        }
                        const received = await api.upload(
                          target.id,
                          uploadFile,
                          uploadProfile,
                          uploadFamily || undefined,
                        );
                        await refresh(target.id);
                        setPane("sources");
                        setInspection({ type: "source", id: received.id });
                        setInspectorOpen(true);
                        setModelFocus(false);
                        setUploadFile(null);
                        setUploadFamily("");
                        setModal(null);
                      },
                      "Original file received. Technical inspection is queued.",
                    );
                  }}
                >
                  <label className="form-field">
                    Input profile
                    <select
                      value={uploadProfile}
                      onChange={(e) => {
                        setUploadProfile(e.target.value as SourceProfile);
                        setUploadFile(null);
                        setUploadFamily("");
                      }}
                    >
                      {profiles.map((p) => (
                        <option value={p.value} key={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="upload-drop">
                    <Upload size={25} />
                    <strong>
                      {uploadFile?.name || "Choose the original file"}
                    </strong>
                    <span>
                      {uploadFile
                        ? `${number(uploadFile.size / 1024, 1)} KB · ready to receive`
                        : `${profiles.find((p) => p.value === uploadProfile)?.extension} · maximum 16 MiB`}
                    </span>
                    <input
                      key={uploadProfile}
                      type="file"
                      accept={
                        profiles.find((p) => p.value === uploadProfile)
                          ?.extension
                      }
                      onChange={(e) =>
                        setUploadFile(e.target.files?.[0] || null)
                      }
                      required
                      aria-label="Choose original source file"
                    />
                  </label>
                  {!!detail?.sources.filter((s) => s.profile === uploadProfile)
                    .length && (
                    <label className="form-field">
                      Source family
                      <select
                        value={uploadFamily}
                        onChange={(e) => setUploadFamily(e.target.value)}
                      >
                        <option value="">New independent source</option>
                        {detail.sources
                          .filter(
                            (s, index, all) =>
                              s.profile === uploadProfile &&
                              all.findIndex(
                                (other) => other.familyId === s.familyId,
                              ) === index,
                          )
                          .map((s) => (
                            <option key={s.familyId} value={s.familyId}>
                              Next revision of {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => setModal(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="button primary"
                      disabled={!!busy || !uploadFile}
                    >
                      {busy ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Upload size={14} />
                      )}
                      Receive & inspect
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </IconContext.Provider>
  );
}

function GuideStep({
  n,
  title,
  text,
  done,
}: {
  n: string;
  title: string;
  text: string;
  done: boolean;
}) {
  return (
    <div className={`guide-step ${done ? "done" : ""}`}>
      <span>{done ? <Check size={13} /> : n}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
