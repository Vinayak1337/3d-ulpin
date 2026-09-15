"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  ComputedUnit,
  Finding,
  ModelSnapshot,
  Point2,
  RegistryDetail,
  RegistryDraft,
  RegistryQuery,
  RegistryRecord,
  RegistryReview,
  RegistrySite,
  SourceRevision,
} from "@ulpin/contracts";
import {
  Buildings,
  StackSimple,
  MagnifyingGlass,
  ArrowRight,
  Plus,
  DownloadSimple,
  Copy,
} from "@/lib/ui/icons";
import { registryRequest as request } from "@/lib/registry-client";
import { legacyUrl } from "@/lib/legacy-url";
import { boundsOf, number } from "@/lib/ui/geometry";
import RegistryMap from "./RegistryMap";
import RegistryEditor from "./RegistryEditor";
import RegistryCreate from "./RegistryCreate";
import SourceFileDialog from "./SourceFileDialog";
import "./RegistryWorkbench.css";
const SpatialViewer = dynamic(() => import("./SpatialViewer"), {
  ssr: false,
  loading: () => (
    <div className="registry-loading">Preparing the spatial view…</div>
  ),
});
type Mode = "records" | "drafts" | "point" | "volume" | "add" | "sources";
const EXCAVATION: Point2[] = [
  [10, 11],
  [14, 11],
  [14, 14],
  [10, 14],
];
export default function RegistryWorkbench({
  recordIdentifier,
  initialSiteId,
}: {
  recordIdentifier?: string;
  initialSiteId?: string;
}) {
  const [initialized, setInitialized] = useState(false);
  const [sites, setSites] = useState<RegistrySite[]>([]),
    [detail, setDetail] = useState<RegistryDetail | null>(null);
  const [focusTarget, setFocusTarget] = useState<{
    footprint: Point2[];
    lower?: number;
    upper?: number;
    sequence: number;
  }>();
  const [siteId, setSiteId] = useState(initialSiteId || ""),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("records"),
    [view, setView] = useState<"split" | "plan" | "3d">("3d");
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [search, setSearch] = useState(""),
    [building, setBuilding] = useState("all"),
    [band, setBand] = useState("all"),
    [kind, setKind] = useState("all"),
    [floor, setFloor] = useState("all");
  const [draft, setDraft] = useState<RegistryDraft | null>(null),
    [review, setReview] = useState<RegistryReview | null>(null),
    [finding, setFinding] = useState<Finding | null>(null);
  const [queryResponse, setQuery] = useState<RegistryQuery | null>(null),
    [polygon, setPolygon] = useState<Point2[]>([]),
    [point, setPoint] = useState<Point2>([4, 6]),
    [limits, setLimits] = useState({ lower: -5, upper: 0 });
  // Responses remain tied to the site and tool that issued them even if the
  // operator navigates while a calculation is in flight.
  const querySequence = useRef(0);
  const currentQueryInput =
    mode === "point"
      ? { mode: "point", point }
      : { mode: "volume", footprint: polygon, ...limits };
  const query =
    queryResponse?.siteId === siteId &&
    JSON.stringify(queryResponse.input) === JSON.stringify(currentQueryInput) &&
    queryResponse.mode === (mode === "point" ? "point" : "volume")
      ? queryResponse
      : null;
  const [drawing, setDrawing] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<SourceRevision | null>(null),
    [history, setHistory] = useState<
      { revision: number; created_at: string; body: RegistryRecord }[]
    >([]);
  const refresh = useCallback(async (id: string) => {
    const d = await request<RegistryDetail>(`/sites/${id}`);
    setDetail(d);
    setQuery(null);
    return d;
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await request<RegistrySite[]>("/sites");
      if (!alive) return;
      setSites(s);
      if (recordIdentifier) {
        const resolved = await request<{ record: RegistryRecord }>(
          `/registry/${encodeURIComponent(recordIdentifier)}`,
        );
        if (!alive) return;
        setSiteId(resolved.record.siteId);
        setSelectedId(resolved.record.id);
      } else setSiteId(initialSiteId || s[0]?.id || "");
      setInitialized(true);
    })().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [recordIdentifier, initialSiteId]);
  useEffect(() => {
    if (!siteId) return;
    setFocusTarget(undefined);
    let alive = true;
    setDetail(null);
    request<RegistryDetail>(`/sites/${siteId}`)
      .then((d) => {
        if (alive) {
          setDetail(d);
          setSelectedId((id) =>
            d.records.some((r) => r.id === id) ? id : null,
          );
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [siteId]);
  const selected = detail?.records.find((r) => r.id === selectedId);
  useEffect(() => {
    let alive = true;
    setHistory([]);
    if (selected)
      request<{ history: typeof history }>(
        `/registry/${encodeURIComponent(selected.identifier)}`,
      )
        .then((r) => {
          if (alive) setHistory(r.history);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [selected?.id, selected?.revision]);
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function switchMode(next: Mode) {
    setMode(next);
    setFinding(null);
    setQuery(null);
    if (next !== "volume") setDrawing(false);
    setExplorerOpen(false);
    if (next === "records") setSelectedId(null);
    if (next === "point" || next === "volume") setView("plan");
  }
  function select(id: string) {
    setSelectedId(id);
    setExplorerOpen(false);
    setFinding(null);
  }
  async function startDraft(r: RegistryRecord) {
    await run("Opening draft", async () => {
      const d = await request<RegistryDraft>(`/sites/${siteId}/drafts`, {
        recordId: r.id,
      });
      setDraft(d);
      setReview(null);
      switchMode("drafts");
      await refresh(siteId);
    });
  }
  async function pointQuery(p: Point2) {
    if (!detail) return;
    const sequence = ++querySequence.current;
    setPoint(p);
    await run("Inspecting vertical stack", async () => {
      const result = await request<RegistryQuery>(`/sites/${siteId}/query`, {
        mode: "point",
        frame: detail.site.frame,
        point: p,
      });
      if (sequence === querySequence.current) setQuery(result);
    });
  }
  async function volumeQuery() {
    if (!detail) return;
    const sequence = ++querySequence.current;
    setDrawing(false);
    await run("Checking excavation impact", async () => {
      const result = await request<RegistryQuery>(`/sites/${siteId}/query`, {
        mode: "volume",
        frame: detail.site.frame,
        footprint: polygon,
        ...limits,
      });
      if (sequence === querySequence.current) setQuery(result);
    });
  }
  const workingRecords = useMemo(() => {
    if (!detail) return [];
    if (mode !== "drafts" || !draft) return detail.records;
    const changed = review?.records || draft.records,
      ids = new Set(changed.map((r) => r.id));
    return [...detail.records.filter((r) => !ids.has(r.id)), ...changed];
  }, [detail, mode, draft, review]);
  const filtered = useMemo(
    () =>
      workingRecords.filter((r) => {
        if (r.kind !== "space") return true;
        if (building !== "all" && !r.links.some((l) => l.targetId === building))
          return false;
        if (band === "above" && (r.geometry?.upper ?? 0) <= 0) return false;
        if (band === "below" && (r.geometry?.lower ?? 0) >= 0) return false;
        if (floor !== "all" && !r.links.some((l) => l.targetId === floor))
          return false;
        return true;
      }),
    [workingRecords, building, band, floor],
  );
  const model = useMemo<ModelSnapshot | null>(() => {
    if (!detail) return null;
    return {
      id: `registry-${siteId}-${detail.site.revision}-${draft?.revision || 0}`,
      caseId: siteId,
      revision: detail.site.revision,
      frame: detail.site.frame,
      units: filtered
        .filter((r) => r.kind === "space" && r.geometry)
        .map((r) => r.geometry as ComputedUnit),
      context: workingRecords
        .filter((r) => r.kind === "parcel" || r.kind === "building")
        .map((r) => ({
          alias: r.alias,
          name: r.name,
          kind: r.kind as "parcel" | "building",
          footprint: r.footprint,
        })),
      findings: review?.findings || [],
      inputFingerprint: "registry-view",
      createdAt: "",
      method: "polygon-prism-v1",
    };
  }, [detail, siteId, filtered, workingRecords, draft?.revision, review]);
  const listRecords = filtered.filter(
    (r) =>
      (kind === "all" || r.kind === kind || r.use === kind) &&
      (!search ||
        [
          r.identifier,
          r.alias,
          r.name,
          ...r.rights.map((x) => x.party),
          ...r.links.map(
            (l) => workingRecords.find((x) => x.id === l.targetId)?.name || "",
          ),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const buildings = detail?.records.filter((r) => r.kind === "building") || [];
  const sourceButton = (id: string, locator?: string) => (
    <button
      key={`${id}-${locator}`}
      className="evidence-link"
      onClick={() => {
        const s = detail?.sources.find((s) => s.id === id);
        if (s) setPreview(s);
        else setError("This source is unavailable.");
      }}
    >
      <span>
        {detail?.sources.find((s) => s.id === id)?.name || "Source file"}
      </span>
      <small>{locator}</small>
      <ArrowRight size={13} />
    </button>
  );
  return (
    <main className="registry-app">
      <a className="skip-link" href="#registry-main">
        Skip to property map
      </a>
      <header className="registry-topbar">
        <a className="registry-brand" href={legacyUrl("/")}>
          <Buildings weight="bold" size={23} />
          3D ULPIN<span>Property registry</span>
        </a>
        <div className="header-site">
          {" "}
          <select
            aria-label="Registry site"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setMode("records");
              setDraft(null);
              setQuery(null);
              setBuilding("all");
              setFloor("all");
              setBand("all");
              setKind("all");
              setSearch("");
              setSelectedId(null);
              setExplorerOpen(false);
              setView("3d");
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <span className="status-tag">
          {detail?.site.synthetic
            ? "Synthetic software site"
            : "Retained site records"}
        </span>
        <a className="preparation-link" href={legacyUrl("/workbench")}>
          Preparation
        </a>
      </header>
      <div className="registry-page">
        {error && (
          <div className="registry-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {(busy || notice) && (
          <div className="registry-notice" role="status">
            {busy ? `${busy}…` : notice}
          </div>
        )}
        {!detail && (
          <section className="registry-empty">
            <StackSimple size={42} weight="light" />
            <h2>
              {error
                ? "Records could not be opened"
                : !initialized || siteId
                  ? "Opening site records…"
                  : "Property register"}
            </h2>
            <p>
              Choose a property from 3D Block to open its evidenced register, or
              load the labeled synthetic example below.
            </p>
            {initialized && !siteId && !error && (
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "Inspecting sources and building the neighbourhood",
                    async () => {
                      const d = await request<RegistryDetail>(
                        "/registry-demo",
                        {},
                      );
                      setSites(await request("/sites"));
                      setSiteId(d.site.id);
                      setDetail(d);
                      setSelectedId(null);
                    },
                  )
                }
              >
                Load synthetic neighbourhood
                <ArrowRight size={16} />
              </button>
            )}
          </section>
        )}
        {detail && (
          <>
            {detail.site.revision === 0 &&
              detail.site.name === "Nandan block" && (
                <div className="registry-notice">
                  <span>
                    The synthetic neighbourhood has not finished loading.
                  </span>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() =>
                      run("Resuming source processing", async () => {
                        setDetail(await request("/registry-demo", {}));
                      })
                    }
                  >
                    Resume loading
                  </button>
                </div>
              )}
            <nav className="registry-tabs" aria-label="Registry tools">
              {[
                ["records", "Site map"],
                [
                  "drafts",
                  `Drafts (${detail.drafts.filter((d) => d.status === "draft").length})`,
                ],
                ["point", "Above / below"],
                ["volume", "Excavation impact"],
                ["sources", "Sources"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={mode === key}
                  onClick={() => switchMode(key as Mode)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div
              className={`registry-layout ${mode !== "records" || selected ? "has-inspector" : ""}`}
              id="registry-main"
            >
              {explorerOpen && (
                <aside className="registry-explorer" aria-label="Find records">
                  <div className="drawer-heading">
                    <strong>Records</strong>
                    <button
                      className="text-button"
                      onClick={() => setExplorerOpen(false)}
                      aria-label="Close records"
                    >
                      ×
                    </button>
                  </div>
                  <label className="registry-search">
                    <MagnifyingGlass size={16} />
                    <input
                      aria-label="Search registry"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Find an ID, space or party"
                    />
                  </label>
                  <div className="explorer-filters">
                    <label>
                      Building
                      <select
                        value={building}
                        onChange={(e) => setBuilding(e.target.value)}
                      >
                        <option value="all">All buildings</option>
                        {buildings.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Record type
                      <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value)}
                      >
                        {[
                          "all",
                          "parcel",
                          "building",
                          "floor",
                          "space",
                          "apartment",
                          "common",
                          "basement",
                          "utility",
                        ].map((k) => (
                          <option key={k} value={k}>
                            {k === "all" ? "All records" : k}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="explorer-list">
                    {(["parcel", "building", "floor", "space"] as const).map(
                      (type) => {
                        const list = listRecords.filter((r) => r.kind === type);
                        return list.length ? (
                          <section key={type}>
                            <h3>
                              {type === "space" ? "Spatial units" : `${type}s`}
                              <span>{list.length}</span>
                            </h3>
                            {list.map((r) => (
                              <button
                                className={`registry-row ${r.id === selectedId ? "active" : ""}`}
                                key={r.id}
                                onClick={() => {
                                  switchMode("records");
                                  select(r.id);
                                }}
                              >
                                <span
                                  className={`record-dot ${r.use || r.kind}`}
                                />
                                <span>
                                  <strong>{r.alias}</strong>
                                  <small>{r.name}</small>
                                </span>
                                <code>{r.identifier.split(":").at(-1)}</code>
                              </button>
                            ))}
                          </section>
                        ) : null;
                      },
                    )}
                    {!listRecords.length && (
                      <p className="muted">
                        No matching records. Try an ID, apartment or recorded
                        party.
                      </p>
                    )}
                  </div>
                  <footer className="explorer-footer">
                    <strong>{detail.site.frame.id}</strong>
                    <span>Local metres · {detail.site.frame.benchmark}</span>
                    <span>No geographic location asserted</span>
                  </footer>
                </aside>
              )}
              <section className="registry-stage">
                <div className="map-toolbar">
                  <button
                    className="button browse-button"
                    aria-expanded={explorerOpen}
                    onClick={() => setExplorerOpen(!explorerOpen)}
                  >
                    <MagnifyingGlass size={16} />
                    Find records
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setBuilding("all");
                      setFloor("all");
                      setBand("all");
                      setKind("all");
                      setSelectedId(null);
                      setFocusTarget((previous) => ({
                        footprint: detail.records.flatMap((r) => r.footprint),
                        sequence: (previous?.sequence || 0) + 1,
                      }));
                    }}
                  >
                    Entire site
                  </button>
                  <div className="view-switch">
                    {(["split", "plan", "3d"] as const).map((v) => (
                      <button
                        key={v}
                        aria-pressed={view === v}
                        onClick={() => setView(v)}
                      >
                        {v === "split"
                          ? "Plan + 3D"
                          : v === "plan"
                            ? "Plan"
                            : "3D"}
                      </button>
                    ))}
                  </div>
                  <details className="map-filters">
                    <summary>
                      Filters
                      {building !== "all" || floor !== "all" || band !== "all"
                        ? " · on"
                        : ""}
                    </summary>
                    <div>
                      <label className="compact-select">
                        Building
                        <select
                          aria-label="Map building"
                          value={building}
                          onChange={(e) => setBuilding(e.target.value)}
                        >
                          <option value="all">All buildings</option>
                          {buildings.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compact-select">
                        Levels
                        <select
                          value={floor}
                          onChange={(e) => setFloor(e.target.value)}
                        >
                          <option value="all">All levels</option>
                          {detail.records
                            .filter((r) => r.kind === "floor")
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="compact-select">
                        Elevation
                        <select
                          value={band}
                          onChange={(e) => setBand(e.target.value)}
                        >
                          <option value="all">Above + below</option>
                          <option value="above">Above ground</option>
                          <option value="below">Below ground</option>
                        </select>
                      </label>
                    </div>
                  </details>
                </div>
                <div className={`registry-views ${view}`}>
                  {view !== "3d" && (
                    <div className="plan-panel">
                      <div className="view-caption">
                        <span>Site plan</span>
                        <span>
                          {mode === "point"
                            ? "Click a point to inspect"
                            : drawing
                              ? "Click vertices, then check impact"
                              : "Select a space"}
                        </span>
                      </div>
                      <RegistryMap
                        records={filtered}
                        selectedId={selectedId}
                        onSelect={select}
                        mode={
                          mode === "point"
                            ? "point"
                            : drawing
                              ? "draw"
                              : "select"
                        }
                        onPoint={(p) => void pointQuery(p)}
                        polygon={mode === "volume" ? polygon : []}
                        onPolygon={(p) => {
                          setPolygon(p);
                          setQuery(null);
                        }}
                        result={
                          mode === "point" || mode === "volume" ? query : null
                        }
                      />
                    </div>
                  )}
                  {view !== "plan" && model && !model.units.length && (
                    <div className="registry-map-empty">
                      <p>No volumes match these filters.</p>
                      <button
                        className="button"
                        onClick={() => {
                          setBuilding("all");
                          setFloor("all");
                          setBand("all");
                        }}
                      >
                        Show all spaces
                      </button>
                    </div>
                  )}
                  {view !== "plan" && model && model.units.length > 0 && (
                    <div className="model-panel">
                      <div className="view-caption">
                        <span>
                          {mode === "drafts"
                            ? "Proposed geometry"
                            : "Current property volumes"}
                        </span>
                        <span>Synthetic</span>
                      </div>
                      <SpatialViewer
                        model={model}
                        selectedId={selectedId}
                        onSelect={select}
                        floor="all"
                        isolate={false}
                        explode={0}
                        finding={finding}
                        initialPresentation="volumes"
                        siteView
                        focusTarget={focusTarget}
                      />
                    </div>
                  )}
                </div>
                <div className="map-legend">
                  <span>
                    <i className="legend-apartment" />
                    Apartments
                  </span>
                  <span>
                    <i className="legend-common" />
                    Shared spaces
                  </span>
                  <span>
                    <i className="legend-underground" />
                    Underground
                  </span>
                  <span>
                    <i className="legend-impact" />
                    Intersection
                  </span>
                </div>
              </section>
              {(mode !== "records" || selected) && (
                <aside
                  className="registry-inspector"
                  aria-label="Record and tool details"
                >
                  <div className="drawer-heading">
                    <span>
                      {mode === "records" ? "Property record" : "Site tools"}
                    </span>
                    <button
                      className="text-button"
                      aria-label="Close details"
                      onClick={() => {
                        switchMode("records");
                        setSelectedId(null);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {mode === "records" && selected && (
                    <>
                      <div className="section-heading">
                        <span>Current record</span>
                        <span className="status-tag">
                          Revision {selected.revision}
                        </span>
                      </div>
                      <h2>{selected.name}</h2>
                      <p className="record-type">
                        {selected.use || selected.kind} · synthetic
                      </p>
                      <code className="record-code">{selected.identifier}</code>
                      <div className="record-tools">
                        <button
                          className="text-button"
                          onClick={() => {
                            setBuilding("all");
                            setFloor("all");
                            setBand("all");
                            setView("split");
                            setFocusTarget((previous) => ({
                              footprint: selected.footprint,
                              lower: selected.geometry?.lower,
                              upper: selected.geometry?.upper,
                              sequence: (previous?.sequence || 0) + 1,
                            }));
                            setNotice(
                              `Located ${selected.alias} in plan and 3D.`,
                            );
                          }}
                        >
                          Locate
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            run("Copying record link", async () => {
                              await navigator.clipboard.writeText(
                                `${location.origin}${legacyUrl(`/registry/${encodeURIComponent(selected.identifier)}`)}`,
                              );
                              setNotice("Record link copied.");
                            })
                          }
                        >
                          <Copy size={13} />
                          Copy link
                        </button>
                        <a
                          className="text-button"
                          href={`/api/v1/registry/${encodeURIComponent(selected.identifier)}/export`}
                        >
                          <DownloadSimple size={13} />
                          Download
                        </a>
                      </div>
                      {selected.geometry && (
                        <dl className="record-measures">
                          <div>
                            <dt>Vertical limits</dt>
                            <dd>
                              {number(selected.geometry.lower)}—
                              {number(selected.geometry.upper)} <small>m</small>
                            </dd>
                          </div>
                          <div>
                            <dt>Footprint</dt>
                            <dd>
                              {number(selected.geometry.area)} <small>m²</small>
                            </dd>
                          </div>
                          <div>
                            <dt>Volume</dt>
                            <dd>
                              {number(selected.geometry.volume)}{" "}
                              <small>m³</small>
                            </dd>
                          </div>
                        </dl>
                      )}
                      <details className="record-disclosure">
                        <summary>
                          Related records ({selected.links.length})
                        </summary>
                        {selected.links.length ? (
                          selected.links.map((l, i) => (
                            <button
                              key={i}
                              className="relationship-link"
                              onClick={() => select(l.targetId)}
                            >
                              <span>{l.type}</span>
                              <strong>
                                {detail.records.find((r) => r.id === l.targetId)
                                  ?.name || l.targetId}
                              </strong>
                              <ArrowRight size={13} />
                            </button>
                          ))
                        ) : (
                          <p className="muted">No relationships recorded.</p>
                        )}
                      </details>
                      <details className="record-disclosure" open>
                        <summary>
                          Recorded rights ({selected.rights.length})
                        </summary>
                        {selected.rights.length ? (
                          selected.rights.map((r, i) => (
                            <article className="record-right" key={i}>
                              <strong>{r.party}</strong>
                              <span>
                                {r.type.replaceAll("_", " ")} · fictional
                              </span>
                              {sourceButton(
                                r.evidence.sourceId,
                                r.evidence.locator,
                              )}
                            </article>
                          ))
                        ) : (
                          <p className="muted">
                            No rights asserted for this context record.
                          </p>
                        )}
                      </details>
                      <details className="record-disclosure">
                        <summary>Boundary evidence</summary>
                        {[
                          ...new Map(
                            [
                              ...selected.evidence,
                              ...Object.values(
                                selected.geometry?.bindings || {},
                              ).filter(Boolean),
                            ].map((b) => [`${b!.sourceId}:${b!.locator}`, b]),
                          ).values(),
                        ].map((b, i) => (
                          <div key={i}>
                            {sourceButton(b!.sourceId, b!.locator)}
                          </div>
                        ))}
                      </details>
                      <div className="inspector-actions">
                        <button
                          className="button primary"
                          disabled={!!busy}
                          onClick={() => startDraft(selected)}
                        >
                          Propose correction
                          <ArrowRight size={15} />
                        </button>
                        <button
                          className="button"
                          onClick={() => {
                            const b = boundsOf([selected.footprint]);
                            switchMode("point");
                            void pointQuery([
                              b.minX + b.width / 2,
                              b.minY + b.height / 2,
                            ]);
                          }}
                        >
                          Show above / below
                        </button>
                      </div>
                      <details className="record-history">
                        <summary>Revision history ({history.length})</summary>
                        {history.map((h) => (
                          <article key={h.revision}>
                            <strong>Revision {h.revision}</strong>
                            <small>
                              {new Date(h.created_at).toLocaleString()}
                            </small>
                            <p>
                              {h.body.geometry
                                ? `${number(h.body.geometry.lower)}–${number(h.body.geometry.upper)} m`
                                : h.body.name}
                            </p>
                          </article>
                        ))}
                      </details>
                      <p className="muted">
                        Prototype spatial identity. Technical review does not
                        establish legal ownership.
                      </p>
                    </>
                  )}
                  {mode === "records" && !selected && (
                    <p className="muted">
                      Select a record on the map or in the explorer.
                    </p>
                  )}
                  {mode === "drafts" && (
                    <>
                      <div className="draft-selector">
                        <label>
                          Preparation draft
                          <select
                            value={draft?.id || ""}
                            onChange={(e) => {
                              const d = detail.drafts.find(
                                (d) => d.id === e.target.value,
                              );
                              if (d) {
                                setDraft(d);
                                setReview(null);
                              }
                            }}
                          >
                            <option value="">Choose a draft</option>
                            {detail.drafts
                              .filter((d) => d.status === "draft")
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.records[0]?.alias} · draft {d.revision}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      {draft?.status === "draft" ? (
                        <RegistryEditor
                          key={draft.id}
                          draft={draft}
                          detail={detail}
                          onSaved={(d) => {
                            setDraft(d);
                            void refresh(siteId);
                          }}
                          onReviewed={setReview}
                          onPreview={(id) =>
                            setPreview(
                              detail.sources.find((s) => s.id === id) || null,
                            )
                          }
                          onRecorded={async () => {
                            await refresh(siteId);
                            setSelectedId(draft.records[0]?.id || null);
                            setDraft(null);
                            setReview(null);
                            setFinding(null);
                            setMode("records");
                            setNotice(
                              "Reviewed revision recorded. The permanent identifier is unchanged.",
                            );
                          }}
                          onSelectFinding={(id) => {
                            const f = review?.findings.find((f) => f.id === id);
                            setFinding(f || null);
                            if (f?.unitIds[0]) {
                              setSelectedId(f.unitIds[0]);
                              const affected = workingRecords.find(
                                (r) => r.id === f.unitIds[0],
                              );
                              if (affected)
                                setFocusTarget((previous) => ({
                                  footprint: affected.footprint,
                                  lower: affected.geometry?.lower,
                                  upper: affected.geometry?.upper,
                                  sequence: (previous?.sequence || 0) + 1,
                                }));
                              setBuilding("all");
                              setFloor("all");
                              setBand("all");
                            }
                          }}
                        />
                      ) : (
                        <div className="inspector-empty">
                          <h2>Changes start with a record.</h2>
                          <p>
                            Select a property and choose Propose correction.
                            Your current registry remains available while you
                            prepare the change.
                          </p>
                          {selected && (
                            <button
                              className="button primary"
                              onClick={() => startDraft(selected)}
                            >
                              Correct {selected.alias}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {(mode === "point" || mode === "volume") && (
                    <>
                      <div className="section-heading">
                        <span>Spatial inspection</span>
                        <span className="status-tag">Current records</span>
                      </div>
                      <h2>
                        {mode === "point"
                          ? "Above and below"
                          : "Excavation impact"}
                      </h2>
                      <p className="muted">
                        {mode === "point"
                          ? "Click the plan or enter local coordinates to inspect the vertical stack."
                          : "Draw a proposal footprint and enter its vertical limits. The proposal does not become a property record."}
                      </p>
                      {mode === "point" ? (
                        <>
                          <div className="field-pair">
                            <label>
                              X (m)
                              <input
                                type="number"
                                value={point[0]}
                                onChange={(e) => {
                                  setPoint([Number(e.target.value), point[1]]);
                                  setQuery(null);
                                }}
                              />
                            </label>
                            <label>
                              Y (m)
                              <input
                                type="number"
                                value={point[1]}
                                onChange={(e) => {
                                  setPoint([point[0], Number(e.target.value)]);
                                  setQuery(null);
                                }}
                              />
                            </label>
                          </div>
                          <button
                            className="button primary"
                            disabled={!!busy}
                            onClick={() => pointQuery(point)}
                          >
                            Inspect vertical stack
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="field-pair">
                            <label>
                              Lower (m)
                              <input
                                aria-label="Excavation lower"
                                type="number"
                                value={limits.lower}
                                onChange={(e) => {
                                  setLimits({
                                    ...limits,
                                    lower: Number(e.target.value),
                                  });
                                  setQuery(null);
                                }}
                              />
                            </label>
                            <label>
                              Upper (m)
                              <input
                                aria-label="Excavation upper"
                                type="number"
                                value={limits.upper}
                                onChange={(e) => {
                                  setLimits({
                                    ...limits,
                                    upper: Number(e.target.value),
                                  });
                                  setQuery(null);
                                }}
                              />
                            </label>
                          </div>
                          <div className="editor-actions">
                            <button
                              className="button"
                              onClick={() => {
                                setDrawing(true);
                                setPolygon([]);
                                setQuery(null);
                                setView("split");
                              }}
                            >
                              Draw footprint
                            </button>
                            <button
                              className="text-button"
                              onClick={() => {
                                setPolygon(EXCAVATION);
                                setLimits({ lower: -5, upper: 0 });
                                setQuery(null);
                                setDrawing(false);
                              }}
                            >
                              Load demo proposal
                            </button>
                          </div>
                          <p className="muted">
                            {polygon.length} vertices{" "}
                            {drawing ? "· click the plan to add corners" : ""}
                          </p>
                          {polygon.length > 0 && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setPolygon(polygon.slice(0, -1));
                                setQuery(null);
                              }}
                            >
                              Undo last vertex
                            </button>
                          )}
                          <button
                            className="button primary"
                            disabled={!!busy || polygon.length < 3}
                            onClick={volumeQuery}
                          >
                            Check impact
                          </button>
                        </>
                      )}
                      {query && (
                        <section className="query-results">
                          <h3>
                            {query.mode === "volume"
                              ? `${query.results.filter((r) => r.volume > 0).length} volume intersections`
                              : `${query.results.length} intersecting records`}
                          </h3>
                          <p className="muted">
                            Registry revision {query.registryRevision} ·
                            synthetic
                          </p>
                          {query.results.map((r) => (
                            <article key={r.record.id}>
                              <button
                                className="query-record"
                                onClick={() => {
                                  select(r.record.id);
                                  setBuilding("all");
                                  setFloor("all");
                                  setBand("all");
                                  const overlap = r.overlaps[0];
                                  setFinding(
                                    overlap
                                      ? {
                                          id: `query-${r.record.id}`,
                                          code: "QUERY_INTERSECTION",
                                          severity: "warning",
                                          title: `${r.record.alias}: ${number(r.volume)} m³ intersection`,
                                          description:
                                            "Proposed excavation intersects a known synthetic record.",
                                          unitIds: [r.record.id],
                                          sourceIds: r.record.evidence.map(
                                            (e) => e.sourceId,
                                          ),
                                          overlap,
                                        }
                                      : null,
                                  );
                                }}
                              >
                                <span>
                                  <strong>{r.record.alias}</strong>
                                  <small>{r.record.name}</small>
                                </span>
                                <b>
                                  {query.mode === "volume"
                                    ? `${number(r.volume)} m³`
                                    : `${number(r.record.geometry?.lower)}–${number(r.record.geometry?.upper)} m`}
                                </b>
                              </button>
                              <p>
                                {r.contact
                                  ? "Boundary contact · zero interior volume"
                                  : query.mode === "point"
                                    ? "Point inside footprint"
                                    : "Positive volume intersection"}
                              </p>
                              <details className="record-disclosure">
                                <summary>Record & evidence</summary>
                                <code className="query-identifier">
                                  {r.record.identifier}
                                </code>
                                <p>
                                  {r.record.links
                                    .map((l) =>
                                      detail.records.find(
                                        (x) => x.id === l.targetId,
                                      ),
                                    )
                                    .filter((x) => x?.kind === "building")
                                    .map((x) => x!.name)
                                    .join(" · ") ||
                                    "Cross-parcel / site infrastructure"}
                                </p>
                                <p>
                                  {number(r.record.geometry?.lower)}–
                                  {number(r.record.geometry?.upper)} m ·{" "}
                                  {detail.site.frame.benchmark}
                                </p>
                                <p>
                                  {r.record.rights
                                    .map(
                                      (x) =>
                                        `${x.party} · ${x.type.replaceAll("_", " ")}`,
                                    )
                                    .join("; ") || "No party recorded"}
                                </p>
                                {[
                                  ...new Map(
                                    [
                                      ...r.record.evidence,
                                      ...r.record.rights.map((x) => x.evidence),
                                    ].map((e) => [
                                      `${e.sourceId}:${e.locator}`,
                                      e,
                                    ]),
                                  ).values(),
                                ].map((e) =>
                                  sourceButton(e.sourceId, e.locator),
                                )}
                              </details>
                            </article>
                          ))}
                          {!query.results.length && (
                            <p>No known spaces intersect this query.</p>
                          )}
                          <p className="muted">
                            Known records only. This result does not certify
                            underground coverage or excavation clearance.
                          </p>
                        </section>
                      )}
                    </>
                  )}
                  {mode === "sources" && (
                    <section>
                      <div className="section-heading">
                        <span>Preserved originals</span>
                        <span className="status-tag">Synthetic</span>
                      </div>
                      <h2>Site source files</h2>
                      <p className="muted">
                        Open a source to inspect or download the original bytes.
                        Parsed plans and documents are references; they do not
                        automatically create geometry or rights.
                      </p>
                      {detail.sources.map((source) => (
                        <article className="record-right" key={source.id}>
                          {sourceButton(
                            source.id,
                            `Revision ${source.revision}`,
                          )}
                          <span>
                            {source.profile} ·{" "}
                            {source.status.replaceAll("_", " ")}
                          </span>
                        </article>
                      ))}
                      {!detail.sources.length && (
                        <p className="muted">
                          Use Add records → Import workspace → Prepare source
                          inputs to inspect original files in this site's frame.
                        </p>
                      )}
                    </section>
                  )}
                  {mode === "add" && (
                    <RegistryCreate
                      detail={detail}
                      onDraft={async (d) => {
                        if (d.siteId !== siteId) {
                          setSites(await request("/sites"));
                          setSiteId(d.siteId);
                          setBuilding("all");
                          setFloor("all");
                          setBand("all");
                          setSelectedId(null);
                        }
                        setDraft(d);
                        setReview(null);
                        setMode("drafts");
                        await refresh(d.siteId);
                      }}
                      onSite={async (id) => {
                        setSites(await request("/sites"));
                        setSiteId(id);
                        setMode("records");
                      }}
                    />
                  )}
                </aside>
              )}
            </div>
            <footer className="registry-footer">
              <span>
                {buildings.length} buildings ·{" "}
                {detail.records.filter((r) => r.kind === "space").length} spaces
              </span>
              <details className="site-frame-info">
                <summary>Local metres · site info</summary>
                <div>
                  <strong>{detail.site.name}</strong>
                  <p>
                    {detail.site.frame.id}
                    <br />
                    {detail.site.frame.benchmark}
                  </p>
                  <code>{detail.site.identifier}</code>
                  <p>
                    Synthetic · prototype identifiers
                    <br />
                    No geographic location asserted
                    <br />
                    Registry revision {detail.site.revision}
                  </p>
                </div>
              </details>
              <button className="text-button" onClick={() => switchMode("add")}>
                <Plus size={13} />
                Add records
              </button>
            </footer>
          </>
        )}
      </div>
      {preview && (
        <SourceFileDialog source={preview} onClose={() => setPreview(null)} />
      )}
    </main>
  );
}
