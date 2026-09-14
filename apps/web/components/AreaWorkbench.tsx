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
  AreaFinding,
  BuildingDossier,
  RegistryRecord,
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
import { geometryParts, utilityScene } from "@/lib/officer-scene";
import AreaSection from "./AreaSection";
import PropertyDossierPanel, {
  type PropertyPanelMode,
} from "./PropertyDossierPanel";
import { retainOfficerContext } from "./OfficerNavigation";
import type { AreaNavigation, SceneDetail, SceneBoundary } from "./AreaViewer";

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
type Navigation = AreaNavigation;
type ResolveMatch = {
  kind: string;
  feature?: PhysicalFeature;
  areaIds: string[];
  url: string;
  matchEvidence: unknown[];
  buildingId?: string;
  canonicalBuildingId?: string;
  relatedBuildings?: { feature?: PhysicalFeature; id?: string }[];
};

function points(geometry: AreaGeometry): number[][] {
  const visit = (v: unknown): number[][] =>
    !Array.isArray(v)
      ? []
      : typeof v[0] === "number"
        ? [v as number[]]
        : v.flatMap(visit);
  return geometry.type === "GeometryCollection"
    ? geometry.geometries.flatMap(points)
    : visit(geometry.coordinates);
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
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.map(path).join(" ");
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
  issueGeometry,
  highlightedIds = [],
  details = [],
  boundaries = [],
  selectedDetailId,
  onDetail,
  labels = true,
}: {
  features: PhysicalFeature[];
  extent?: MapArea["extent"];
  selectedId: string | null;
  onSelect: (id: string) => void;
  navigation: Navigation;
  issueGeometry?: AreaGeometry;
  highlightedIds?: string[];
  details?: SceneDetail[];
  boundaries?: SceneBoundary[];
  selectedDetailId?: string;
  onDetail?: (id: string) => void;
  labels?: boolean;
}) {
  const [view, setView] = useState<[number, number, number, number]>(() =>
    bounds(features, extent),
  );
  const drag = useRef<{ x: number; y: number; view: typeof view } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const selected = useRef(selectedId);
  selected.current = selectedId;
  const planInputs = useRef({ features, extent, highlightedIds });
  planInputs.current = { features, extent, highlightedIds };
  const previousPlan = useRef<typeof view | null>(null);
  useEffect(() => {
    const input = planInputs.current;
    if (navigation.action === "return" && previousPlan.current) {
      setView(previousPlan.current);
      previousPlan.current = null;
      return;
    }
    if (navigation.action === "zoom_in" || navigation.action === "zoom_out") {
      const factor = navigation.action === "zoom_in" ? 0.8 : 1.25;
      setView(([x, y, w, h]) => [
        x + (w * (1 - factor)) / 2,
        y + (h * (1 - factor)) / 2,
        w * factor,
        h * factor,
      ]);
      return;
    }
    if (navigation.action === "north" || navigation.action === "angle") return;
    if (navigation.action === "focus" || navigation.action === "issue")
      setView((current) => {
        previousPlan.current ||= current;
        return bounds(
          input.features.filter((f) =>
            navigation.action === "focus"
              ? f.id === selected.current
              : input.highlightedIds.includes(f.id),
          ),
        );
      });
    else setView(bounds(input.features, input.extent));
  }, [navigation]);
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
          geometryElement(
            feature,
            selectedId,
            onSelect,
            highlightedIds.includes(feature.id),
          ),
        )}
        {boundaries
          .filter((boundary) => boundary.localGeometry)
          .map((boundary) => (
            <g key={boundary.id} pointerEvents="none">
              <path
                d={path(boundary.localGeometry!)}
                fill="none"
                stroke="#687c83"
                strokeWidth="2"
                strokeDasharray="7 5"
                vectorEffect="non-scaling-stroke"
              >
                <title>{boundary.name}</title>
              </path>
              {labels &&
                view[2] < 350 &&
                points(boundary.localGeometry!).length > 0 && (
                  <text
                    x={points(boundary.localGeometry!)[0][0]}
                    y={-points(boundary.localGeometry!)[0][1] - view[2] / 70}
                    fontSize={Math.max(1.5, view[2] / 80)}
                    fill="#52686d"
                  >
                    {boundary.name}
                  </text>
                )}
            </g>
          ))}
        {details
          .filter((detail) => detail.localGeometry)
          .map((detail) => (
            <path
              key={detail.id}
              d={path(detail.localGeometry!)}
              fill={detail.id === selectedDetailId ? "#c5734ccc" : "#60979970"}
              stroke="#3e625f"
              vectorEffect="non-scaling-stroke"
              onClick={() => onDetail?.(detail.id)}
            >
              <title>{detail.name} · retained space boundary</title>
            </path>
          ))}
        {labels &&
          view[2] < 350 &&
          features.map((feature) => {
            const ps = points(feature.geometry);
            if (
              !ps.length ||
              (feature.kind === "parcel" &&
                view[2] > 45 &&
                selectedId !== feature.id &&
                !highlightedIds.includes(feature.id))
            )
              return null;
            return (
              <text
                key={`label:${feature.id}`}
                className="area-plan-label"
                x={ps.reduce((n, p) => n + p[0], 0) / ps.length}
                y={-ps.reduce((n, p) => n + p[1], 0) / ps.length}
                fontSize={Math.max(1.5, view[2] / 80)}
                textAnchor="middle"
                pointerEvents="none"
              >
                {feature.kind === "utility" && feature.name.length > 24
                  ? `${feature.name.slice(0, 23)}…`
                  : feature.name}
              </text>
            );
          })}
        {issueGeometry &&
          geometryParts(issueGeometry).map((geometry, index) =>
            geometry.type === "Point" || geometry.type === "MultiPoint" ? (
              (geometry.type === "Point"
                ? [geometry.coordinates]
                : geometry.coordinates
              ).map(([x, y], j) => (
                <circle
                  key={`${index}:${j}`}
                  cx={x}
                  cy={-y}
                  r={Math.max(1, view[2] / 150)}
                  className="area-issue-shape"
                />
              ))
            ) : (
              <path
                key={index}
                d={path(geometry)}
                className="area-issue-shape"
                fillRule="evenodd"
                vectorEffect="non-scaling-stroke"
              >
                <title>Exact discrepancy geometry</title>
              </path>
            ),
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
  affected = false,
) {
  const shared = {
    "data-feature": feature.id,
    onClick: () => onSelect(feature.id),
    className: `area-shape ${feature.kind} ${feature.worldStatus === "synthetic" ? "synthetic" : ""} ${feature.height.state === "estimated" ? "estimated" : ""} ${selectedId === feature.id ? "selected" : ""} ${affected ? "affected" : ""}`,
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
  initialPanel,
  initialRecordId,
}: {
  initialAreaId?: string;
  initialFeatureId?: string;
  initialPanel?: PropertyPanelMode;
  initialRecordId?: string;
}) {
  const [areas, setAreas] = useState<MapArea[]>([]),
    [areaId, setAreaId] = useState(initialAreaId || "");
  const [context, setContext] = useState<AreaContext | null>(null),
    [catalog, setCatalog] = useState<SourceCatalogEntry[]>([]);
  const [pkg, setPackage] = useState<ImportPackage | null>(null),
    [selectedId, setSelected] = useState<string | null>(
      initialFeatureId || null,
    );
  const [requestedRecord, setRequestedRecord] = useState(initialRecordId);
  const [explorerOpen, setExplorerOpen] = useState(false),
    [labelsVisible, setLabelsVisible] = useState(true),
    [underground, setUnderground] = useState(false);
  const [dossier, setDossier] = useState<BuildingDossier | null>(null),
    [selectedDetail, setSelectedDetail] = useState<RegistryRecord | null>(null),
    [selectedIssue, setSelectedIssue] = useState<AreaFinding | null>(null);
  const [view, setView] = useState<"3d" | "plan" | "section">("3d"),
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
  const currentAreaRef = useRef(areaId);
  currentAreaRef.current = areaId;
  const refreshContext = useCallback(async (id: string) => {
    const result = await request<AreaContext>(`/areas/${id}/context`);
    if (id === currentAreaRef.current) setContext(result);
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
  const sceneFeatures = useMemo(() => {
    const additional = (selectedIssue?.participants || []).filter(
      (f) => !features.some((current) => current.id === f.id),
    );
    return [...features, ...additional];
  }, [features, selectedIssue]);
  const selected = sceneFeatures.find((f) => f.id === selectedId) || null;
  const selectedProfile =
    selected?.kind === "utility" ? utilityScene(selected) : null;
  const selectionRef = useRef(selectedId);
  selectionRef.current = selectedId;
  const acceptDossier = useCallback((next: BuildingDossier | null) => {
    if (next && next.canonicalBuildingId !== selectionRef.current) return;
    setDossier(next);
  }, []);
  const chooseFeature = useCallback((id: string) => {
    setSelected(id);
    setRequestedRecord(undefined);
    setSelectedDetail(null);
    setDossier(null);
    setTab("feature");
  }, []);
  const inspectIssue = useCallback((finding: AreaFinding) => {
    setSelectedIssue(finding);
    setTab("findings");
    setNavigation((old) => ({ action: "issue", sequence: old.sequence + 1 }));
  }, []);
  const sceneDetails = useMemo<SceneDetail[]>(() => {
    if (!dossier || dossier.canonicalBuildingId !== selectedId) return [];
    return dossier.detailedScene
      .filter(
        (detail) =>
          detail.geographicGeometry &&
          Number.isFinite(detail.lower) &&
          Number.isFinite(detail.upper) &&
          detail.upper! > detail.lower!,
      )
      .map((detail) => ({
        id: detail.record.id,
        name:
          detail.record.kind === "floor"
            ? detail.record.name.replace(/^property\s*\/\s*/i, "")
            : detail.record.name,
        geographicGeometry: detail.geographicGeometry!,
        localGeometry: detail.localGeometry,
        verticalReference: detail.verticalReference,
        lower: detail.lower!,
        upper: detail.upper!,
        kind: detail.record.kind === "floor" ? "floor" : "space",
      }));
  }, [dossier, selectedId]);
  useEffect(() => {
    if (areaId && !selected)
      retainOfficerContext({
        areaId,
        buildingId: undefined,
        caseId: undefined,
      });
  }, [areaId, selected?.id]);
  useEffect(() => {
    if (selected?.kind === "building")
      retainOfficerContext({
        buildingId: selected.id,
        areaId: selected.areaId,
        caseId: undefined,
      });
  }, [selected?.id, selected?.areaId, selected?.kind]);
  const filtered = features.filter((f) =>
    `${f.name} ${f.identifier} ${f.sourceKey}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const area = context?.area || areas.find((a) => a.id === areaId);
  const sceneBoundaries = useMemo<SceneBoundary[]>(() => {
    const groups =
      dossier?.canonicalBuildingId === selectedId ? dossier.groups : [];
    const stored = [
      ...new Map(groups.map((group) => [group.id, group])).values(),
    ].map((group) => ({
      id: group.id,
      name: group.name,
      geographicGeometry: group.geographicBoundary,
      localGeometry: group.areaId === areaId ? group.boundary : undefined,
    }));
    if (stored.length || !area?.geographicExtent) return stored;
    const rectangle = ([w, s, e, n]: [
      number,
      number,
      number,
      number,
    ]): AreaGeometry => ({
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    });
    return [
      {
        id: `analysis:${area.id}`,
        name: "Analysis extent",
        geographicGeometry: rectangle(area.geographicExtent),
        localGeometry: area.extent ? rectangle(area.extent) : undefined,
      },
    ];
  }, [dossier, selectedId, areaId, area]);
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
      const buildingId =
        match.canonicalBuildingId ||
        match.buildingId ||
        match.relatedBuildings?.[0]?.feature?.id ||
        match.relatedBuildings?.[0]?.id;
      if (buildingId && match.areaIds[0]) {
        setAreaId(match.areaIds[0]);
        chooseFeature(buildingId);
        setMatches([]);
        return;
      }
      window.location.assign(match.url);
      return;
    }
    setPackage(null);
    setAreaId(match.areaIds[0] || match.feature.areaId);
    chooseFeature(match.feature.id);
    setRequestedRecord(
      new URL(match.url, window.location.origin).searchParams.get("record") ||
        undefined,
    );
    setMatches([]);
    setTab("feature");
    setSelectedIssue(null);
    if ((match.areaIds[0] || match.feature.areaId) !== areaId) fit("fit");
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
    <main
      data-panel={tab}
      className={`area-app officer-area ${explorerOpen ? "explorer-open" : ""} ${selected ? "has-property" : ""}`}
    >
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
        <button
          className="area-explorer-toggle"
          aria-expanded={explorerOpen}
          onClick={() => setExplorerOpen((value) => !value)}
          aria-label="Toggle block explorer"
        >
          ☰
        </button>
        <div>
          <div className="area-eyebrow">3D BLOCK</div>
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
            placeholder="Find a property"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button disabled={!!busy || !search.trim()} type="submit">
            Find →
          </button>
        </form>
        <span className="area-revision">
          {area ? `Revision ${area.revision}` : "Choose a block"}
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
                  chooseFeature(feature.id);
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
                3D block
              </button>
              <button
                aria-pressed={view === "plan"}
                onClick={() => setView("plan")}
              >
                Plan
              </button>
              <button
                aria-pressed={view === "section"}
                onClick={() => setView("section")}
              >
                Section
              </button>
            </div>
            <div hidden={view === "section"}>
              <button
                title="Fit all features in area"
                onClick={() => fit("fit")}
                disabled={!features.length}
              >
                Fit block
              </button>
              <button
                title="Focus selected feature"
                onClick={() => fit("focus")}
                disabled={!selected}
              >
                Focus property
              </button>
              <button
                title="Return to previous block view"
                onClick={() => fit("return")}
              >
                ↩ Block
              </button>
              <button
                title="Reset north"
                aria-label="Reset north"
                onClick={() => fit("north")}
              >
                N ↑
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
              <>
                <div className="area-view-pane" hidden={view !== "3d"}>
                  <AreaViewer
                    features={sceneFeatures}
                    geographicExtent={area?.geographicExtent}
                    sceneKey={areaId}
                    selectedId={selectedId}
                    onSelect={chooseFeature}
                    navigation={navigation}
                    highlightedIds={selectedIssue?.featureIds}
                    issueGeometry={selectedIssue?.geographicGeometry}
                    details={sceneDetails}
                    boundaries={sceneBoundaries}
                    selectedDetailId={selectedDetail?.id}
                    onSelectDetail={(id) =>
                      setSelectedDetail(
                        dossier?.records.find((record) => record.id === id) ||
                          null,
                      )
                    }
                    underground={underground}
                    labels={labelsVisible}
                  />
                </div>
                <div className="area-view-pane" hidden={view !== "plan"}>
                  <AreaPlan
                    key={areaId}
                    features={sceneFeatures}
                    extent={area?.extent}
                    selectedId={selectedId}
                    onSelect={chooseFeature}
                    navigation={navigation}
                    highlightedIds={selectedIssue?.featureIds}
                    issueGeometry={selectedIssue?.geometry}
                    details={dossier?.area.id === areaId ? sceneDetails : []}
                    boundaries={sceneBoundaries}
                    selectedDetailId={selectedDetail?.id}
                    onDetail={(id) =>
                      setSelectedDetail(
                        dossier?.records.find((record) => record.id === id) ||
                          null,
                      )
                    }
                    labels={labelsVisible}
                  />
                </div>
                {view === "section" && (
                  <AreaSection
                    selected={selected}
                    details={sceneDetails}
                    selectedDetailId={selectedDetail?.id}
                    onSelect={(id) =>
                      setSelectedDetail(
                        dossier?.records.find((record) => record.id === id) ||
                          null,
                      )
                    }
                  />
                )}
                <div
                  className="area-display-controls"
                  hidden={view === "section"}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={labelsVisible}
                      onChange={(event) =>
                        setLabelsVisible(event.target.checked)
                      }
                    />{" "}
                    Labels
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={underground}
                      onChange={(event) => setUnderground(event.target.checked)}
                    />{" "}
                    Underground
                  </label>
                  <button aria-label="Zoom in" onClick={() => fit("zoom_in")}>
                    +
                  </button>
                  <button aria-label="Zoom out" onClick={() => fit("zoom_out")}>
                    −
                  </button>
                  <button title="Oblique angle" onClick={() => fit("angle")}>
                    ↗
                  </button>
                </div>
                {selectedIssue && view !== "section" && (
                  <div className="area-issue-banner">
                    <span>
                      Exact issue · {selectedIssue.featureIds.length}{" "}
                      participants
                      {selectedIssue.areaM2 !== undefined
                        ? ` · ${fmt(selectedIssue.areaM2)} m²`
                        : ""}
                    </span>
                    <button
                      aria-label="Clear issue overlay"
                      onClick={() => setSelectedIssue(null)}
                    >
                      ×
                    </button>
                  </div>
                )}
              </>
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
                  Open a permitted area package, or import supplied building and
                  context layers.
                </p>
                <button
                  className="area-primary"
                  onClick={() => setDrawer("sources")}
                  disabled={!loaded || !!busy}
                >
                  Explore data sources →
                </button>
                <a href="/registry">Browse property records</a>
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
              (selected?.kind === "building" ? (
                <PropertyDossierPanel
                  checkId={
                    selected?.areaId === areaId
                      ? context?.latestCheck?.id
                      : undefined
                  }
                  key={selected.id}
                  building={selected}
                  initialMode={initialPanel}
                  initialRecordId={requestedRecord}
                  refreshKey={context?.area.revision}
                  onDossier={acceptDossier}
                  onDetail={setSelectedDetail}
                  onInspect={inspectIssue}
                  onFocus={() => fit("focus")}
                />
              ) : selected ? (
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
                    {selected.kind === "utility" && (
                      <>
                        <dt>Source levels</dt>
                        <dd>
                          {selectedProfile
                            ? `${fmt(selectedProfile.positions[0][2])} to ${fmt(selectedProfile.positions.at(-1)![2])} m`
                            : "Depth unknown · alignment only"}
                        </dd>
                        {selectedProfile && (
                          <>
                            <dt>Level reference</dt>
                            <dd>{selectedProfile.verticalReference}</dd>
                            <dt>Cross section</dt>
                            <dd>
                              {selectedProfile.shape} ·{" "}
                              {fmt(selectedProfile.width)} ×{" "}
                              {fmt(selectedProfile.height)} m
                            </dd>
                          </>
                        )}
                      </>
                    )}
                  </dl>
                  <p className="area-note">
                    {selected.kind === "utility"
                      ? selectedProfile
                        ? "Supplied levels position this profile. Open Section to inspect them."
                        : "No depth is inferred from a horizontal utility alignment."
                      : "Recorded source geometry; any relationship to a property requires evidence and review."}
                  </p>
                  <h3>Geometry evidence</h3>
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
                  {selectedProfile && (
                    <p className="area-note">
                      {selectedProfile.limitation ||
                        selectedProfile.solidMeaning}
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
                        <details>
                          <summary>Review coverage and limits</summary>
                          {pending.review.coverage.map((coverage, i) => (
                            <p key={i} className="area-note">
                              {coverage}
                            </p>
                          ))}
                        </details>
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
                    <details>
                      <summary>Check coverage and limits</summary>
                      {context.latestCheck.coverage.map((coverage, i) => (
                        <p className="area-note" key={i}>
                          {coverage}
                        </p>
                      ))}
                    </details>
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
                        onClick={() => inspectIssue(finding)}
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
            Upload a source dataset, identify its records, and declare what the
            geometry represents. Originals are retained before review.
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
                geometryRole: data.get("geometryRole"),
                levelReference: data.get("levelReference") || undefined,
                floorCountField: data.get("floorCountField") || undefined,
                sourceDateField: data.get("sourceDateField") || undefined,
                approvalStatusField:
                  data.get("approvalStatusField") || undefined,
                ...(data.get("kind") === "utility" &&
                data.get("startLevelField")
                  ? {
                      utility: {
                        startLevelField: data.get("startLevelField"),
                        endLevelField: data.get("endLevelField") || undefined,
                        levelUnit: data.get("utilityUnit"),
                        levelMeaning: data.get("levelMeaning"),
                        verticalReference: data.get("utilityReference") || null,
                        interpolation: "linear_endpoints",
                        crossSection: data.get("crossSection") || undefined,
                        diameterField: data.get("diameterField") || undefined,
                        widthField: data.get("widthField") || undefined,
                        heightField:
                          data.get("utilityHeightField") || undefined,
                        dimensionUnit: data.get("utilityUnit"),
                      },
                    }
                  : {}),
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
                accept=".json,.geojson,.gpkg,.zip,application/json,application/geo+json"
              />
            </label>
            <div className="area-form-grid">
              <label>
                Format
                <select name="format">
                  <option value="geojson">GeoJSON</option>
                  <option value="arcgis">ArcGIS JSON</option>
                  <option value="gpkg">GeoPackage</option>
                  <option value="shapefile_zip">Shapefile ZIP</option>
                </select>
              </label>
              <label>
                Layer name
                <input
                  name="layer"
                  placeholder="Required when a package contains several layers"
                />
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
                Dataset name / stable source group
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
                Column containing the stable ID
                <input name="idField" required placeholder="e.g. property_id" />
              </label>
              <label>
                Name column
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
            <div className="area-form-grid">
              <label>
                What does the outline represent?
                <select name="geometryRole">
                  <option value="unknown">Not established by source</option>
                  <option value="observed_ground_occupation">
                    Observed ground occupation
                  </option>
                  <option value="observed_roof_projection">
                    Roof projection
                  </option>
                  <option value="approved_building_outline">
                    Approved building outline
                  </option>
                  <option value="recorded_parcel">Recorded parcel</option>
                  <option value="public_road_land">
                    Recorded public road land
                  </option>
                  <option value="road_surface">Observed road surface</option>
                  <option value="public_land">Public land</option>
                  <option value="physical_utility">
                    Physical utility alignment
                  </option>
                  <option value="documented_restriction">
                    Documented restriction
                  </option>
                </select>
              </label>
              <label>
                Source status
                <select name="worldStatus">
                  <option value="observed">Observed source data</option>
                  <option value="planned">Planned</option>
                  <option value="hypothetical">Hypothetical proposal</option>
                  <option value="synthetic">Synthetic software fixture</option>
                </select>
              </label>
            </div>
            <details>
              <summary>Dates, storeys and level reference</summary>
              <div className="area-form-grid">
                <label>
                  Source date column
                  <input name="sourceDateField" />
                </label>
                <label>
                  Storey count column
                  <input name="floorCountField" />
                </label>
                <label>
                  Approval status column
                  <input name="approvalStatusField" />
                </label>
                <label>
                  Named vertical reference
                  <input
                    name="levelReference"
                    placeholder="Only if supplied by the source"
                  />
                </label>
              </div>
            </details>
            <details>
              <summary>Utility levels and dimensions</summary>
              <p className="area-note">
                Leave unknown fields empty. A surface alignment never
                establishes underground depth.
              </p>
              <div className="area-form-grid">
                <label>
                  Start level column
                  <input name="startLevelField" />
                </label>
                <label>
                  End level column
                  <input name="endLevelField" />
                </label>
                <label>
                  Levels describe
                  <select name="levelMeaning">
                    <option value="centre">Centre line</option>
                    <option value="invert">Invert</option>
                    <option value="crown">Crown</option>
                  </select>
                </label>
                <label>
                  Level reference
                  <input name="utilityReference" />
                </label>
                <label>
                  Units
                  <select name="utilityUnit">
                    <option value="m">Metres</option>
                    <option value="ft">Feet</option>
                  </select>
                </label>
                <label>
                  Cross section
                  <select name="crossSection">
                    <option value="">Unknown</option>
                    <option value="circular">Circular</option>
                    <option value="rectangular">Rectangular corridor</option>
                  </select>
                </label>
                <label>
                  Diameter column
                  <input name="diameterField" />
                </label>
                <label>
                  Width column
                  <input name="widthField" />
                </label>
                <label>
                  Section height column
                  <input name="utilityHeightField" />
                </label>
              </div>
            </details>
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
