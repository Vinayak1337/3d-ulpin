"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import type {
  AreaCheck,
  AreaContext,
  AreaGeometry,
  EvidenceQuestion,
  FactCandidate,
  ImportPackage,
  MapArea,
  PhysicalFeature,
} from "@ulpin/contracts";
import type { SourceCatalogEntry } from "@/lib/source-catalog";
import { registryRequest as request } from "@/lib/registry-client";
import "./AreaWorkbench.css";

const AreaViewer = dynamic(() => import("./AreaViewer"), {
  ssr: false,
  loading: () => (
    <div className="area-loading">Preparing geographic 3D view…</div>
  ),
});
const fmt = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const originalUrl = (id: string) =>
  `/api/v1/sources/${encodeURIComponent(id)}/file`;
type Navigation = { action: "fit" | "focus"; sequence: number };
type ResolveMatch = {
  kind: string;
  feature?: PhysicalFeature;
  areaIds: string[];
  url: string;
  matchEvidence: unknown[];
};

function points(geometry: AreaGeometry): number[][] {
  const visit = (v: unknown): number[][] =>
    !Array.isArray(v)
      ? []
      : typeof v[0] === "number"
        ? [v as number[]]
        : v.flatMap(visit);
  return visit(geometry.coordinates);
}
function bounds(
  features: PhysicalFeature[],
  extent?: MapArea["extent"],
): [number, number, number, number] {
  const all = features.flatMap((f) => points(f.geometry));
  if (extent) all.push([extent[0], extent[1]], [extent[2], extent[3]]);
  if (!all.length) return [0, 0, 200, 200];
  const x = all.map((p) => p[0]),
    y = all.map((p) => -p[1]);
  const width = Math.max(15, Math.max(...x) - Math.min(...x)),
    height = Math.max(15, Math.max(...y) - Math.min(...y));
  const pad = Math.max(width, height) * 0.13;
  return [
    Math.min(...x) - pad,
    Math.min(...y) - pad,
    width + pad * 2,
    height + pad * 2,
  ];
}
function path(geometry: AreaGeometry): string {
  const ring = (p: number[][], close = true) =>
    p.map(([x, y], i) => `${i ? "L" : "M"}${x},${-y}`).join(" ") +
    (close ? " Z" : "");
  if (geometry.type === "Polygon")
    return geometry.coordinates.map((p) => ring(p)).join(" ");
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.flatMap((p) => p.map((r) => ring(r))).join(" ");
  if (geometry.type === "LineString") return ring(geometry.coordinates, false);
  if (geometry.type === "MultiLineString")
    return geometry.coordinates.map((p) => ring(p, false)).join(" ");
  return "";
}

function AreaPlan({
  features,
  extent,
  selectedId,
  onSelect,
  navigation,
}: {
  features: PhysicalFeature[];
  extent?: MapArea["extent"];
  selectedId: string | null;
  onSelect: (id: string) => void;
  navigation: Navigation;
}) {
  const [view, setView] = useState<[number, number, number, number]>(() =>
    bounds(features, extent),
  );
  const drag = useRef<{ x: number; y: number; view: typeof view } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const selected = useRef(selectedId);
  selected.current = selectedId;
  useEffect(() => {
    setView(
      bounds(
        navigation.action === "focus"
          ? features.filter((f) => f.id === selected.current)
          : features,
        navigation.action === "fit" ? extent : undefined,
      ),
    );
  }, [features, extent, navigation]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.12 : 0.88;
      setView(([x, y, w, h]) => [
        x + (w * (1 - factor)) / 2,
        y + (h * (1 - factor)) / 2,
        w * factor,
        h * factor,
      ]);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const zoom = (factor: number) =>
    setView(([x, y, w, h]) => [
      x + (w * (1 - factor)) / 2,
      y + (h * (1 - factor)) / 2,
      w * factor,
      h * factor,
    ]);
  return (
    <div className="area-plan">
      <svg
        ref={svg}
        role="img"
        aria-label="Area plan in local analytical metres. Select a feature from the map or the feature list."
        viewBox={view.join(" ")}
        onPointerDown={(event) => {
          if ((event.target as Element).getAttribute("data-feature")) return;
          drag.current = { x: event.clientX, y: event.clientY, view };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const current = drag.current;
          setView([
            current.view[0] - (event.clientX - current.x) / matrix.a,
            current.view[1] - (event.clientY - current.y) / matrix.d,
            current.view[2],
            current.view[3],
          ]);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <pattern
            id="area-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#dedfd5"
              strokeWidth="0.3"
            />
          </pattern>
        </defs>
        <rect
          x={view[0]}
          y={view[1]}
          width={view[2]}
          height={view[3]}
          fill="url(#area-grid)"
        />
        {features.map((feature) =>
          geometryElement(feature, selectedId, onSelect),
        )}
      </svg>
      <div className="area-plan-controls">
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoom(0.8)}>
          +
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoom(1.25)}
        >
          −
        </button>
      </div>
      <span className="area-north" aria-label="Analytical grid north">
        N ↑
      </span>
      <span className="area-scene-note">
        Local metres · drag to pan · scroll to zoom
      </span>
    </div>
  );
}
function geometryElement(
  feature: PhysicalFeature,
  selectedId: string | null,
  onSelect: (id: string) => void,
) {
  const shared = {
    "data-feature": feature.id,
    onClick: () => onSelect(feature.id),
    className: `area-shape ${feature.kind} ${feature.worldStatus === "synthetic" ? "synthetic" : ""} ${feature.height.state === "estimated" ? "estimated" : ""} ${selectedId === feature.id ? "selected" : ""}`,
  };
  if (feature.geometry.type === "Point")
    return (
      <circle
        key={feature.id}
        {...shared}
        cx={feature.geometry.coordinates[0]}
        cy={-feature.geometry.coordinates[1]}
        r={1.8}
      >
        <title>{feature.name}</title>
      </circle>
    );
  if (feature.geometry.type === "MultiPoint")
    return (
      <g key={feature.id}>
        {feature.geometry.coordinates.map(([x, y], index) => (
          <circle
            {...shared}
            key={`${feature.id}:${index}`}
            cx={x}
            cy={-y}
            r={1.8}
          >
            <title>{feature.name}</title>
          </circle>
        ))}
      </g>
    );
  return (
    <path
      key={feature.id}
      {...shared}
      d={path(feature.geometry)}
      fillRule="evenodd"
      vectorEffect="non-scaling-stroke"
    >
      <title>
        {feature.name} · {feature.identifier}
      </title>
    </path>
  );
}
function Dialog({
  title,
  close,
  children,
  status,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  status?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="area-dialog" onCancel={close}>
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" title="Close dialog" onClick={close}>
          ×
        </button>
      </header>
      {status && (
        <p role="status" className="area-warning">
          {status}
        </p>
      )}
      {children}
    </dialog>
  );
}
async function upload(path: string, data: FormData): Promise<ImportPackage> {
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    body: data,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || result.detail || "Upload failed.");
  return result;
}

export default function AreaWorkbench({
  initialAreaId,
  initialFeatureId,
}: {
  initialAreaId?: string;
  initialFeatureId?: string;
}) {
  const [areas, setAreas] = useState<MapArea[]>([]),
    [areaId, setAreaId] = useState(initialAreaId || "");
  const [context, setContext] = useState<AreaContext | null>(null),
    [catalog, setCatalog] = useState<SourceCatalogEntry[]>([]);
  const [pkg, setPackage] = useState<ImportPackage | null>(null),
    [selectedId, setSelected] = useState<string | null>(
      initialFeatureId || null,
    );
  const [view, setView] = useState<"3d" | "plan">("3d"),
    [navigation, setNavigation] = useState<Navigation>({
      action: "fit",
      sequence: 0,
    });
  const [drawer, setDrawer] = useState<
    "sources" | "upload" | "document" | null
  >(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""),
    [matches, setMatches] = useState<ResolveMatch[]>([]),
    [filter, setFilter] = useState("");
  const [acknowledgement, setAcknowledgement] = useState(""),
    [showCandidate, setShowCandidate] = useState(true);
  const [tab, setTab] = useState<"feature" | "review" | "findings">("feature");
  const [loaded, setLoaded] = useState(false);
  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed.");
    } finally {
      setBusy("");
    }
  };
  const refreshAreas = useCallback(async () => {
    const rows = await request<MapArea[]>("/areas");
    setAreas(rows);
    return rows;
  }, []);
  const refreshContext = useCallback(async (id: string) => {
    const result = await request<AreaContext>(`/areas/${id}/context`);
    setContext(result);
    return result;
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      request<MapArea[]>("/areas"),
      request<SourceCatalogEntry[]>("/source-catalog"),
    ])
      .then(([rows, sources]) => {
        if (!active) return;
        setAreas(rows);
        setCatalog(sources);
        if (!initialAreaId)
          setAreaId(rows.find((a) => a.reference)?.id || rows[0]?.id || "");
      })
      .catch((cause) => {
        if (active) setError(String(cause.message));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [initialAreaId]);
  useEffect(() => {
    if (!areaId) return;
    let active = true;
    setContext(null);
    request<AreaContext>(`/areas/${areaId}/context`)
      .then((result) => {
        if (active) setContext(result);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [areaId]);
  const features = useMemo(() => {
    const current = context?.features || [];
    if (
      !pkg ||
      pkg.areaId !== areaId ||
      pkg.state === "COMMITTED" ||
      !showCandidate
    )
      return current;
    const candidates = new Map(pkg.features.map((f) => [f.id, f]));
    return [...current.filter((f) => !candidates.has(f.id)), ...pkg.features];
  }, [context, pkg, areaId, showCandidate]);
  const findingText = (message: string) =>
    features.reduce(
      (text, feature) => text.replaceAll(feature.id, feature.name),
      message,
    );
  const selected = features.find((f) => f.id === selectedId) || null;
  const filtered = features.filter((f) =>
    `${f.name} ${f.identifier} ${f.sourceKey}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const area = context?.area || areas.find((a) => a.id === areaId);
  const pending =
    pkg && pkg.areaId === areaId && pkg.state !== "COMMITTED" ? pkg : null;
  const findings = context?.latestCheck?.findings || [];
  const fit = (action: Navigation["action"]) =>
    setNavigation((old) => ({ action, sequence: old.sequence + 1 }));
  const adopt = async (next: ImportPackage) => {
    setPackage(next);
    setAreaId(next.areaId);
    setSelected(next.features[0]?.id || null);
    setShowCandidate(true);
    setTab("review");
    setAcknowledgement("");
    await refreshAreas();
    await refreshContext(next.areaId);
    setDrawer(null);
  };
  const acquire = (source: SourceCatalogEntry, mode: "saved" | "refresh") =>
    run(
      mode === "saved"
        ? "Opening saved snapshot…"
        : "Acquiring bounded source…",
      async () => {
        const acquisition = await request<{ id: string }>("/acquisitions", {
          sourceId: source.id,
          mode,
          requestKey: crypto.randomUUID(),
        });
        const next = await request<ImportPackage>("/import-packages", {
          acquisitionId: acquisition.id,
          name: source.snapshot?.name || source.name,
        });
        await adopt(next);
      },
    );
  const searchIdentifier = (event: FormEvent) => {
    event.preventDefault();
    void run("Resolving identifier…", async () => {
      const result = await request<{ status: string; matches: ResolveMatch[] }>(
        `/resolve?identifier=${encodeURIComponent(search.trim())}`,
      );
      setMatches(result.matches);
      if (result.status === "not_found")
        setNotice("Not present in loaded data.");
      else if (result.status === "matched" && result.matches.length === 1)
        await openMatch(result.matches[0]);
      else
        setNotice(
          "Several source associations match. Choose the intended record.",
        );
    });
  };
  const openMatch = async (match: ResolveMatch) => {
    if (!match.feature) {
      window.location.assign(match.url);
      return;
    }
    setPackage(null);
    setAreaId(match.areaIds[0] || match.feature.areaId);
    setSelected(match.feature.id);
    setMatches([]);
    setTab("feature");
    fit("fit");
  };
  const reviewPackage = () =>
    pending &&
    run("Reviewing proposed observations…", async () => {
      const next = await request<ImportPackage>(
        `/import-packages/${pending.id}/review`,
        { expectedRevision: pending.revision },
      );
      setPackage(next);
    });
  const commitPackage = () =>
    pending &&
    run("Recording reviewed observations…", async () => {
      const next = await request<ImportPackage>(
        `/import-packages/${pending.id}/commit`,
        { expectedRevision: pending.revision, acknowledgement },
      );
      setPackage(next);
      await refreshContext(next.areaId);
      await refreshAreas();
      setNotice(
        "Observations recorded. Original sources and this review remain in the area history.",
      );
    });
  const answerQuestion = (
    question: EvidenceQuestion,
    choice: "keep_2d" | "estimate" | "select_claim",
    value: string,
    reason: string,
  ) =>
    pending &&
    run("Saving evidence answer…", async () => {
      const next = await request<ImportPackage>(
        `/import-packages/${pending.id}/answers`,
        {
          expectedRevision: pending.revision,
          questionId: question.id,
          answer: {
            choice,
            ...(choice === "estimate"
              ? { value: Number(value) }
              : choice === "select_claim"
                ? { claimId: value }
                : {}),
            reason,
          },
        },
      );
      setPackage(next);
    });

  return (
    <main className="area-app">
      <header className="area-topbar">
        <a className="area-brand" href="/">
          3D ULPIN<span>Local registry</span>
        </a>
        <nav>
          <a href="/areas" aria-current="page">
            Area explorer
          </a>
          <a href="/registry">Detailed registry</a>
        </nav>
        <span className="area-local">● Local workspace</span>
      </header>
      <section className="area-heading">
        <div>
          <div className="area-eyebrow">GEOGRAPHIC AREA REGISTRY</div>
          <h1>{area?.name || "A place to begin."}</h1>
          <p>
            {area?.administrativeUnits.map((a) => a.name).join(" / ") ||
              "Bring real sources together, inspect the area, and review each change."}
          </p>
        </div>
        <div className="area-heading-actions">
          <button onClick={() => setDrawer("upload")} disabled={!!busy}>
            Import GIS
          </button>
          <button
            className="area-primary"
            onClick={() => setDrawer("sources")}
            disabled={!!busy}
          >
            Data sources <span>↗</span>
          </button>
        </div>
      </section>
      <div className="area-command">
        <label className="area-picker">
          <span>Map area</span>
          <select
            aria-label="Map area"
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setPackage(null);
              setSelected(null);
              fit("fit");
            }}
          >
            <option value="">Choose an area</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <form onSubmit={searchIdentifier} className="area-global-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Global identifier search"
            placeholder="Find a 3D ID, ULPIN, or source identifier"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button disabled={!!busy || !search.trim()} type="submit">
            Find →
          </button>
        </form>
        <span className="area-revision">
          {area ? `Area revision ${area.revision}` : "No area selected"}
        </span>
      </div>
      {(busy || error || notice) && (
        <div
          className={`area-message ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {busy || error || notice}
          {error && (
            <button title="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          )}
        </div>
      )}
      {!!matches.length && (
        <div className="area-matches">
          {matches.map((match, i) => (
            <button
              key={i}
              onClick={() => void run("Opening match…", () => openMatch(match))}
            >
              {match.feature?.name || match.kind} ·{" "}
              {match.feature?.identifier || match.url} →
            </button>
          ))}
        </div>
      )}
      <section className="area-workspace">
        <aside className="area-explorer">
          <div className="area-panel-title">
            <h2>Area contents</h2>
            <span>{features.length}</span>
          </div>
          <label className="area-filter">
            <input
              aria-label="Filter area features"
              placeholder="Filter buildings and context"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="area-feature-list">
            {filtered.map((feature, index) => (
              <button
                key={feature.id}
                className={`area-feature ${selectedId === feature.id ? "active" : ""}`}
                onClick={() => {
                  setSelected(feature.id);
                  setTab("feature");
                }}
              >
                <span className="area-feature-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{feature.name}</strong>
                  <small>
                    {feature.worldStatus === "synthetic" ? "Synthetic · " : ""}
                    {feature.kind.replace("_", " ")} ·{" "}
                    {feature.height.value !== null
                      ? `${fmt(feature.height.value)} m`
                      : "height unknown"}
                  </small>
                </span>
                <span
                  className={`area-dot ${feature.height.state}`}
                  title={feature.height.state.replace("_", " ")}
                />
              </button>
            ))}
            {!filtered.length && (
              <p className="area-muted">
                {features.length
                  ? "No matching features in this area."
                  : "Acquired observations will appear here."}
              </p>
            )}
          </div>
          <div className="area-explorer-foot">
            <span>● Source supported</span>
            <span className="estimate">● Estimated</span>
            <span className="unknown">○ Unknown</span>
          </div>
        </aside>
        <section className="area-stage">
          <header className="area-map-toolbar">
            <div className="area-view-switch">
              <button
                aria-pressed={view === "3d"}
                onClick={() => setView("3d")}
              >
                3D exterior
              </button>
              <button
                aria-pressed={view === "plan"}
                onClick={() => setView("plan")}
              >
                2D plan
              </button>
            </div>
            <div>
              <button
                title="Fit all features in area"
                onClick={() => fit("fit")}
                disabled={!features.length}
              >
                Fit area
              </button>
              <button
                title="Focus selected feature"
                onClick={() => fit("focus")}
                disabled={!selected}
              >
                Focus selection
              </button>
            </div>
          </header>
          {pending && (
            <div className="area-candidate-banner">
              <span>
                Proposed update · {pending.features.length} observations
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={showCandidate}
                  onChange={(e) => setShowCandidate(e.target.checked)}
                />{" "}
                Preview candidates
              </label>
            </div>
          )}
          <div className="area-map">
            {features.length ? (
              view === "3d" ? (
                <AreaViewer
                  features={features}
                  geographicExtent={area?.geographicExtent}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelected(id);
                    setTab("feature");
                  }}
                  navigation={navigation}
                />
              ) : (
                <AreaPlan
                  features={features}
                  extent={area?.extent}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelected(id);
                    setTab("feature");
                  }}
                  navigation={navigation}
                />
              )
            ) : (
              <div className="area-empty">
                <div className="area-empty-mark">⌑</div>
                <div className="area-eyebrow">ONE AREA. EVERY SOURCE.</div>
                <h2>
                  {!loaded
                    ? "Opening your workspace…"
                    : areaId && !context
                      ? "Loading this area…"
                      : "Start with a real place."}
                </h2>
                <p>
                  A saved Bronx snapshot brings 62 real building footprints into
                  one shared geographic frame. Review the source and heights
                  before recording it.
                </p>
                <button
                  className="area-primary"
                  onClick={() => setDrawer("sources")}
                  disabled={!loaded || !!busy}
                >
                  Explore data sources →
                </button>
                <a href="/registry">Open existing detailed cases</a>
              </div>
            )}
          </div>
          <footer className="area-map-footer">
            <span>{features.length} physical observations</span>
            <span>
              {area?.reference?.analysisCrs || "No geographic reference"}
            </span>
            <span>
              {pending ? "Candidate layer · not recorded" : "Current area"}
            </span>
          </footer>
        </section>
        <aside className="area-inspector">
          <div className="area-inspector-tabs">
            <button
              aria-pressed={tab === "feature"}
              onClick={() => setTab("feature")}
            >
              Inspect
            </button>
            <button
              aria-pressed={tab === "review"}
              onClick={() => setTab("review")}
            >
              Review{pending ? " •" : ""}
            </button>
            <button
              aria-pressed={tab === "findings"}
              onClick={() => setTab("findings")}
            >
              Findings
            </button>
          </div>
          <div className="area-inspector-body">
            {tab === "feature" &&
              (selected ? (
                <>
                  <div className="area-eyebrow">
                    {selected.representation.replaceAll("_", " ")}
                  </div>
                  <h2>{selected.name}</h2>
                  <p className="area-identifier">{selected.identifier}</p>
                  <dl className="area-facts">
                    <dt>Source key</dt>
                    <dd>{selected.sourceKey}</dd>
                    <dt>Classification</dt>
                    <dd>{selected.worldStatus}</dd>
                    <dt>Footprint area</dt>
                    <dd>
                      {selected.areaM2 === null
                        ? "Not applicable"
                        : `${fmt(selected.areaM2)} m²`}
                    </dd>
                    <dt>Roof height</dt>
                    <dd>
                      {selected.height.value === null
                        ? "Unknown · 2D only"
                        : `${fmt(selected.height.value)} m`}
                    </dd>
                    <dt>Evidence</dt>
                    <dd>{selected.height.state.replaceAll("_", " ")}</dd>
                    <dt>Vertical reference</dt>
                    <dd>{selected.height.reference}</dd>
                  </dl>
                  <p className="area-note">{selected.height.meaning}</p>
                  <p className="area-note">
                    Exterior geometry does not establish interior floors,
                    ownership or legal boundaries.
                  </p>
                  <h3>Footprint evidence</h3>
                  {selected.evidence.map((e, i) => (
                    <a
                      className="area-evidence-link"
                      key={i}
                      href={originalUrl(e.sourceRevisionId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Original source ↗
                      <small>
                        {e.jsonPointer ||
                          e.featureId ||
                          e.partId ||
                          `Source revision ${e.sourceRevisionId.slice(0, 8)}`}
                      </small>
                    </a>
                  ))}
                  <h3>Height evidence</h3>
                  {(
                    selected.height.evidence ||
                    (selected.height.state === "source_supported"
                      ? selected.evidence
                      : [])
                  ).map((e, i) => (
                    <a
                      className="area-evidence-link"
                      key={i}
                      href={`${originalUrl(e.sourceRevisionId)}${e.page ? `#page=${e.page}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Height source ↗
                      <small>
                        {e.page
                          ? `Page ${e.page}`
                          : e.jsonPointer ||
                            e.featureId ||
                            (e.partId
                              ? `Document part ${e.partId.slice(0, 8)}`
                              : "Original source")}
                      </small>
                    </a>
                  ))}
                  {selected.height.method && (
                    <p className="area-note">
                      Height method:{" "}
                      {selected.height.method.replaceAll("_", " ")}
                    </p>
                  )}
                  {(selected.height.state === "estimated" ||
                    selected.height.state === "unknown") && (
                    <p className="area-note">
                      This height has no source-supported measurement.
                    </p>
                  )}
                  <button onClick={() => fit("focus")}>
                    Focus this feature
                  </button>
                </>
              ) : (
                <div className="area-inspector-empty">
                  <span>↖</span>
                  <h2>Read the place.</h2>
                  <p>
                    Select a building to inspect its geometry, height meaning
                    and original source.
                  </p>
                </div>
              ))}
            {tab === "review" && (
              <>
                {pending ? (
                  <>
                    <div className="area-eyebrow">
                      IMPORT PACKAGE · REVISION {pending.revision}
                    </div>
                    <h2>{pending.name}</h2>
                    <span className="area-status">
                      {pending.state.replaceAll("_", " ")}
                    </span>
                    <p>
                      {pending.features.length} proposed physical observations
                    </p>
                    {pending.warnings.map((warning, i) => (
                      <p className="area-warning" key={i}>
                        {warning}
                      </p>
                    ))}
                    {pending.questions.map((question) => (
                      <Question
                        key={`${question.id}:${pending.revision}`}
                        question={question}
                        claims={pending.factCandidates.filter(
                          (claim) =>
                            claim.entityId === question.entityId &&
                            claim.property === question.property,
                        )}
                        busy={!!busy}
                        onAnswer={(choice, value, reason) =>
                          void answerQuestion(question, choice, value, reason)
                        }
                      />
                    ))}
                    <h3>Supporting documents</h3>
                    <p className="area-note">
                      Attach evidence to the selected feature. Text parts retain
                      their source locators.
                    </p>
                    <button
                      disabled={!!busy || !selected}
                      onClick={() => setDrawer("document")}
                    >
                      Attach document
                    </button>
                    {pending.parts.map((part) => (
                      <details key={part.id}>
                        <summary>{part.locator}</summary>
                        <p className="area-document-text">
                          {part.text ||
                            "Image evidence requires operator interpretation."}
                        </p>
                        <a
                          href={originalUrl(part.sourceRevisionId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open original ↗
                        </a>
                        <form
                          className="area-claim-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            const value = String(data.get("value"));
                            void run(
                              "Recording document fact candidate…",
                              async () => {
                                const next = await request<ImportPackage>(
                                  `/import-packages/${pending.id}/facts`,
                                  {
                                    expectedRevision: pending.revision,
                                    claim: {
                                      entityId: data.get("entityId"),
                                      property: data.get("property"),
                                      value:
                                        data.get("valueType") === "number"
                                          ? Number(value)
                                          : value,
                                      unit: data.get("unit") || undefined,
                                      referenceFrameId:
                                        data.get("reference") || undefined,
                                      evidence: [
                                        {
                                          sourceRevisionId:
                                            part.sourceRevisionId,
                                          partId: part.id,
                                        },
                                      ],
                                    },
                                  },
                                );
                                setPackage(next);
                                setAcknowledgement("");
                              },
                            );
                          }}
                        >
                          <h3>Record a fact from this part</h3>
                          <label>
                            Associated feature
                            <select
                              required
                              name="entityId"
                              defaultValue={
                                part.entityIds.includes(selectedId || "")
                                  ? selectedId!
                                  : part.entityIds[0]
                              }
                            >
                              {part.entityIds.map((id) => (
                                <option key={id} value={id}>
                                  {pending.features.find((f) => f.id === id)
                                    ?.name || id}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Property
                            <input
                              required
                              name="property"
                              defaultValue="building.exteriorHeight"
                              pattern="[a-zA-Z]+\.[a-zA-Z][a-zA-Z0-9.]*"
                            />
                          </label>
                          <label>
                            Value
                            <input required name="value" />
                          </label>
                          <label>
                            Value type
                            <select name="valueType">
                              <option value="number">Number</option>
                              <option value="string">Text</option>
                            </select>
                          </label>
                          <label>
                            Unit
                            <input name="unit" defaultValue="m" />
                          </label>
                          <label>
                            Reference frame
                            <input
                              name="reference"
                              defaultValue={
                                pending.features.find((f) =>
                                  part.entityIds.includes(f.id),
                                )?.height.reference || ""
                              }
                            />
                          </label>
                          <p className="area-note">
                            Human transcription linked to this original part.
                            Different meanings or reference frames remain
                            separate claims.
                          </p>
                          <button disabled={!!busy}>
                            Record fact candidate
                          </button>
                        </form>
                      </details>
                    ))}
                    {!!pending.factCandidates.length && (
                      <details>
                        <summary>
                          Fact candidates ({pending.factCandidates.length})
                        </summary>
                        {pending.factCandidates.map((fact) => (
                          <p key={fact.id} className="area-note">
                            {fact.property}:{" "}
                            {typeof fact.value === "number"
                              ? fmt(fact.value)
                              : String(fact.value)}{" "}
                            {fact.unit} · {fact.method.replaceAll("_", " ")} ·{" "}
                            {fact.evidenceState.replaceAll("_", " ")}
                          </p>
                        ))}
                      </details>
                    )}
                    {pending.review && (
                      <>
                        <h3>Review coverage</h3>
                        {pending.review.coverage.map((coverage, i) => (
                          <p key={i} className="area-note">
                            {coverage}
                          </p>
                        ))}
                        {pending.review.findings.map((finding) => (
                          <p className="area-warning" key={finding.id}>
                            {findingText(finding.message)}
                          </p>
                        ))}
                      </>
                    )}
                    <div className="area-review-actions">
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void run(
                            "Refreshing area revision for review…",
                            async () => {
                              setPackage(
                                await request<ImportPackage>(
                                  `/import-packages/${pending.id}/rebase`,
                                  { expectedRevision: pending.revision },
                                ),
                              );
                              setAcknowledgement("");
                              await refreshContext(areaId);
                            },
                          )
                        }
                      >
                        Refresh review baseline
                      </button>
                      <button
                        className="area-primary"
                        disabled={
                          !!busy ||
                          pending.questions.some(
                            (q) => q.kind === "conflicting_claims" && !q.answer,
                          )
                        }
                        onClick={() => void reviewPackage()}
                      >
                        Review proposed update
                      </button>
                      {pending.state === "REVIEWED" && (
                        <>
                          <label>
                            Acknowledgement
                            <textarea
                              value={acknowledgement}
                              onChange={(e) =>
                                setAcknowledgement(e.target.value)
                              }
                              placeholder="Acknowledge source limitations and the review findings."
                            />
                          </label>
                          <button
                            className="area-primary"
                            disabled={!!busy || !acknowledgement.trim()}
                            onClick={() => void commitPackage()}
                          >
                            Record observations
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <h2>Area history</h2>
                    <p className="area-note">
                      Imports pass through source inspection and technical
                      review before they become current observations.
                    </p>
                    {context?.packages.map((item) => (
                      <div key={item.id}>
                        <button
                          className="area-history-item"
                          onClick={() =>
                            void run("Opening import package…", async () => {
                              setPackage(
                                await request<ImportPackage>(
                                  `/import-packages/${item.id}`,
                                ),
                              );
                              setAcknowledgement("");
                            })
                          }
                        >
                          <strong>{item.name}</strong>
                          <small>
                            {item.state.replaceAll("_", " ")} · revision{" "}
                            {item.revision}
                          </small>
                        </button>
                        {item.state === "COMMITTED" && (
                          <button
                            className="area-correction"
                            disabled={!!busy}
                            onClick={() =>
                              void run(
                                "Preparing correction package…",
                                async () => {
                                  await adopt(
                                    await request<ImportPackage>(
                                      `/import-packages/${item.id}/correction`,
                                      { requestKey: crypto.randomUUID() },
                                    ),
                                  );
                                },
                              )
                            }
                          >
                            Create correction / attach evidence
                          </button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setDrawer("sources")}>
                      Add source observations
                    </button>
                  </>
                )}
              </>
            )}
            {tab === "findings" && (
              <>
                <h2>Area checks</h2>
                <details>
                  <summary>Synthetic crossing scenario</summary>
                  <p className="area-note">
                    Create a clearly labeled hypothetical crossing for this
                    demo. This is invented context, not an actual road, utility
                    or encroachment.
                  </p>
                  <div className="area-source-actions">
                    {(["road", "utility"] as const).map((kind) => (
                      <button
                        key={kind}
                        disabled={
                          !!busy ||
                          !area ||
                          !context?.features.some((f) => f.kind === "building")
                        }
                        onClick={() =>
                          void run(
                            "Preparing synthetic scenario…",
                            async () => {
                              await adopt(
                                await request<ImportPackage>(
                                  `/areas/${areaId}/scenario`,
                                  { expectedRevision: area!.revision, kind },
                                ),
                              );
                            },
                          )
                        }
                      >
                        {kind === "road"
                          ? "Synthetic road"
                          : "Synthetic utility"}
                      </button>
                    ))}
                  </div>
                </details>
                <p className="area-note">
                  Checks distinguish geometric observations from missing
                  evidence. They do not establish a legal encroachment.
                </p>
                <button
                  className="area-primary"
                  disabled={!area || !context?.features.length || !!busy}
                  onClick={() =>
                    void run("Checking current area…", async () => {
                      await request<AreaCheck>("/area-checks", {
                        areaId,
                        expectedRevision: area!.revision,
                      });
                      await refreshContext(areaId);
                    })
                  }
                >
                  Check current area
                </button>
                {context?.latestCheck && (
                  <>
                    <p className="area-note">
                      {context.latestCheck.status} · area revision{" "}
                      {context.latestCheck.areaRevision}
                      {context.latestCheck.stale ? " · stale" : ""}
                    </p>
                    {context.latestCheck.coverage.map((coverage, i) => (
                      <p className="area-note" key={i}>
                        {coverage}
                      </p>
                    ))}
                    {!findings.length &&
                      context.latestCheck.status === "completed" && (
                        <p>
                          No findings within the checks and coverage listed
                          above.
                        </p>
                      )}
                    {findings.map((finding) => (
                      <button
                        key={finding.id}
                        className="area-finding"
                        onClick={() => {
                          if (finding.featureIds[0])
                            setSelected(finding.featureIds[0]);
                        }}
                      >
                        <small>
                          {finding.category} · {finding.code}
                        </small>
                        <strong>{findingText(finding.message)}</strong>
                        {finding.areaM2 !== undefined && (
                          <span>{fmt(finding.areaM2)} m²</span>
                        )}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      </section>
      {drawer === "sources" && (
        <Dialog
          status={busy || error}
          title="Data sources"
          close={() => setDrawer(null)}
        >
          <p className="area-dialog-intro">
            Choose a verified snapshot or refresh its bounded source. Receipt,
            suitability and recording remain separate steps.
          </p>
          {catalog.map((source) => (
            <section className="area-source-card" key={source.id}>
              <div className="area-eyebrow">
                {source.status.replaceAll("_", " ")}
              </div>
              <h3>{source.name}</h3>
              <p>{source.coverage}</p>
              <dl className="area-facts">
                <dt>Provider</dt>
                <dd>{source.provider}</dd>
                <dt>Coordinates</dt>
                <dd>{source.sourceCRS}</dd>
                <dt>Reuse</dt>
                <dd>{source.license.status.replaceAll("_", " ")}</dd>
              </dl>
              <p className="area-note">{source.license.note}</p>
              {source.snapshot && (
                <p className="area-snapshot">
                  Saved {source.retrievedAt} · {source.snapshot.featureCount}{" "}
                  features
                  <br />
                  <span>{source.snapshot.name}</span>
                </p>
              )}
              <div className="area-source-links">
                <a target="_blank" rel="noreferrer" href={source.metadataUrl}>
                  Source metadata ↗
                </a>
                <a target="_blank" rel="noreferrer" href={source.license.url}>
                  Terms ↗
                </a>
              </div>
              <div className="area-source-actions">
                <button
                  className="area-primary"
                  disabled={
                    !!busy || !source.acquisitionEnabled || !source.snapshot
                  }
                  onClick={() => void acquire(source, "saved")}
                >
                  Open saved snapshot
                </button>
                <button
                  disabled={!!busy || !source.acquisitionEnabled}
                  onClick={() => void acquire(source, "refresh")}
                >
                  Refresh source
                </button>
              </div>
              {!source.acquisitionEnabled && (
                <p className="area-warning">
                  Feature acquisition is unavailable until reuse and source
                  semantics are resolved.
                </p>
              )}
            </section>
          ))}
        </Dialog>
      )}
      {drawer === "upload" && (
        <Dialog
          status={busy || error}
          title="Import geographic data"
          close={() => setDrawer(null)}
        >
          <p className="area-dialog-intro">
            Preserve an original GeoJSON or ArcGIS JSON export and map its
            stable source ID. Unsupported geometry remains an explicit ingestion
            error.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const mapping = {
                idField: data.get("idField"),
                nameField: data.get("nameField") || undefined,
                kind: data.get("kind"),
                heightField: data.get("heightField") || undefined,
                heightUnit: data.get("heightUnit"),
                heightMeaning: data.get("heightMeaning") || undefined,
              };
              data.set("mapping", JSON.stringify(mapping));
              if (data.get("destination") === "current" && area) {
                data.set("areaId", area.id);
                data.set("expectedAreaRevision", String(area.revision));
              }
              void run("Inspecting original GIS source…", async () =>
                adopt(await upload("/import-packages", data)),
              );
            }}
          >
            <label>
              Original file
              <input
                required
                type="file"
                name="file"
                accept=".json,.geojson,application/json,application/geo+json"
              />
            </label>
            <div className="area-form-grid">
              <label>
                Format
                <select name="format">
                  <option value="geojson">GeoJSON</option>
                  <option value="arcgis">ArcGIS JSON</option>
                </select>
              </label>
              <label>
                Source CRS
                <input
                  name="sourceCrs"
                  placeholder="EPSG:4326"
                  defaultValue="EPSG:4326"
                  required
                />
              </label>
              <label>
                Dataset namespace
                <input
                  name="namespace"
                  required
                  placeholder="provider-dataset"
                />
              </label>
              <label>
                Area / package name
                <input name="name" required placeholder="Survey area name" />
              </label>
              <label>
                Stable ID field
                <input name="idField" required placeholder="e.g. doitt_id" />
              </label>
              <label>
                Feature name field
                <input name="nameField" placeholder="Optional" />
              </label>
              <label>
                Physical feature type
                <select name="kind">
                  <option value="building">Building exterior</option>
                  <option value="parcel">Parcel context</option>
                  <option value="road">Road</option>
                  <option value="public_land">Public land</option>
                  <option value="utility">Utility</option>
                </select>
              </label>
              <label>
                Height field
                <input
                  name="heightField"
                  placeholder="Optional; otherwise unknown"
                />
              </label>
              <label>
                Height unit
                <select name="heightUnit">
                  <option value="m">Metres</option>
                  <option value="ft">Feet</option>
                </select>
              </label>
              <label>
                Destination
                <select name="destination">
                  <option value="new">New map area</option>
                  {area && (
                    <option value="current">
                      Current area revision {area.revision}
                    </option>
                  )}
                </select>
              </label>
            </div>
            <label>
              Height meaning
              <input
                name="heightMeaning"
                placeholder="e.g. roof above building ground"
              />
            </label>
            <button className="area-primary" type="submit" disabled={!!busy}>
              Inspect and prepare update
            </button>
          </form>
        </Dialog>
      )}
      {drawer === "document" && pending && selected && (
        <Dialog
          status={busy || error}
          title="Attach supporting evidence"
          close={() => setDrawer(null)}
        >
          <p className="area-dialog-intro">
            Associate this original document with {selected.name}. Parsed text
            becomes evidence parts; it does not automatically become a verified
            claim.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set("expectedRevision", String(pending.revision));
              data.set("entityIds", JSON.stringify([selected.id]));
              void run("Inspecting supporting document…", async () => {
                setPackage(
                  await upload(
                    `/import-packages/${pending.id}/documents`,
                    data,
                  ),
                );
                setDrawer(null);
              });
            }}
          >
            <label>
              Original document
              <input
                required
                type="file"
                name="file"
                accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
              />
            </label>
            <label>
              Document format
              <select name="format">
                <option value="pdf">PDF</option>
                <option value="docx">Word document</option>
                <option value="text">Plain text</option>
                <option value="png">PNG image</option>
                <option value="jpeg">JPEG image</option>
              </select>
            </label>
            <button className="area-primary" type="submit" disabled={!!busy}>
              Attach and inspect
            </button>
          </form>
        </Dialog>
      )}
    </main>
  );
}
function Question({
  question,
  claims,
  busy,
  onAnswer,
}: {
  question: EvidenceQuestion;
  claims: FactCandidate[];
  busy: boolean;
  onAnswer: (
    choice: "keep_2d" | "estimate" | "select_claim",
    value: string,
    reason: string,
  ) => void;
}) {
  const [choice, setChoice] = useState<"keep_2d" | "estimate" | "select_claim">(
      question.kind === "conflicting_claims" ? "select_claim" : "keep_2d",
    ),
    [value, setValue] = useState(""),
    [reason, setReason] = useState("");
  return (
    <section className="area-question">
      <h3>{question.property.replaceAll("_", " ")}</h3>
      <p>{question.message}</p>
      {question.answer ? (
        <p className="area-note">
          Answered: {question.answer.choice.replaceAll("_", " ")} ·{" "}
          {question.answer.reason}
        </p>
      ) : (
        <>
          {question.kind === "conflicting_claims" ? (
            <label>
              Choose a source claim
              <select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Select the supported claim</option>
                {claims.map((claim) => (
                  <option key={claim.id} value={claim.id}>
                    {String(claim.value)} {claim.unit} ·{" "}
                    {claim.method.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              How should this be represented?
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value as typeof choice)}
              >
                <option value="keep_2d">Keep as 2D; height unknown</option>
                <option value="estimate">
                  Use an explicit estimated height
                </option>
              </select>
            </label>
          )}
          {choice === "estimate" && (
            <label>
              Estimated height in metres
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          )}
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Record the basis of this decision"
            />
          </label>
          <button
            disabled={
              busy ||
              !reason.trim() ||
              (choice === "estimate" && !(Number(value) > 0)) ||
              (choice === "select_claim" && !value)
            }
            onClick={() => onAnswer(choice, value, reason)}
          >
            {choice === "select_claim"
              ? "Use this claim in proposal"
              : "Save answer"}
          </button>
        </>
      )}
    </section>
  );
}
