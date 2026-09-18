"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { enuToEcef, geometryBounds, measureRepresentation, transformPoint, validateSpatialSnapshot, type SpatialSnapshot, type SpatialEntity } from "@ulpin/contracts";
import { useSharedResource } from "../data/useResource";
import { useMapSession } from "../data/useMapSession";
import type { TileNavigation, TileTelemetry } from "../layers/TileLayer";
import { Icon } from "@/features/officer/shared/ui";
import "./lab.css";
const MapViewport = dynamic(() => import("../MapViewport").then(m => m.MapViewport), { ssr: false, loading: () => <div className="lab-engine-loading">Loading map engine…</div> });
const layerGroups = [
    { kind: "building", label: "Buildings", icon: "building" },
    { kind: "parcel", label: "Parcel surfaces", icon: "map" },
    { kind: "road", label: "Roads & paths", icon: "utility" },
    { kind: "public_land", label: "Public space", icon: "layers" },
    { kind: "vegetation", label: "Trees", icon: "home" },
] as const;
const fmt = (n: number | null | undefined) => n == null ? "Unavailable" : n.toLocaleString("en", { maximumFractionDigits: 2 });
export default function MapLab() {
    const [kind, setKind] = useState<"garden" | "dense">("garden");
    const [tab, setTab] = useState<"map" | "building" | "sources">("map");
    const [filter, setFilter] = useState("");
    const [layers, setLayers] = useState<string[]>(["building", "building_part", "parcel", "road", "public_land", "vegetation", "terrain"]);
    const [navigation, setNavigation] = useState<TileNavigation>({ action: "fit", sequence: 0 });
    const [telemetry, setTelemetry] = useState<TileTelemetry | null>(null);
    const resource = useSharedResource<SpatialSnapshot>(`/spatial/calibration/${kind}/snapshot.json`);
    const [session, updateSession] = useMapSession(`calibration:${kind}`);
    const validated = useMemo(() => {
        if (!resource.data)
            return { snapshot: null, error: "" };
        try {
            validateSpatialSnapshot(resource.data);
            return { snapshot: resource.data, error: "" };
        }
        catch (error) {
            return { snapshot: null, error: error instanceof Error ? error.message : "Invalid snapshot" };
        }
    }, [resource.data]);
    const snapshot = validated.snapshot;
    const buildings = useMemo(() => snapshot?.entities.filter(e => e.kind === "building") || [], [snapshot]);
    useEffect(() => {
        if (!session.selection && buildings.length)
            updateSession({ selection: { entityId: buildings[0].id } });
    }, [buildings, session.selection, updateSession]);
    const selected = snapshot?.entities.find(e => e.id === session.selection?.entityId);
    const rep = snapshot?.representations.find(r => r.entityId === selected?.id);
    const frame = snapshot?.frames.find(f => f.id === rep?.frameId);
    const area = rep && frame ? measureRepresentation(rep, frame, "horizontal_area") : null;
    const volume = rep && frame ? measureRepresentation(rep, frame, "prism_volume") : null;
    const buildingId = selected?.kind === "building" ? selected.id : snapshot?.relations.find(r => r.fromId === selected?.id && r.kind === "part_of")?.toId;
    const inspection = useMemo(() => (selected?.kind === "level" || selected?.kind === "space") && rep && frame ? { representation: rep, frame, parentId: buildingId } : undefined, [selected?.kind, rep, frame, buildingId]);
    const levels = snapshot?.entities.filter(e => e.kind === "level" && snapshot.relations.some(r => r.fromId === e.id && r.toId === buildingId && r.kind === "part_of")) || [];
    const select = useCallback((entity: SpatialEntity) => { updateSession({ selection: { entityId: entity.id } }); }, [updateSession]);
    const runCommand = (action: TileNavigation["action"]) => {
        let target: readonly [
            number,
            number,
            number
        ] | undefined;
        if (action === "focus" && rep && frame) {
            const b = geometryBounds(rep.geometry);
            target = transformPoint(enuToEcef(frame), [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, rep.vertical ? (rep.vertical.lower + rep.vertical.upper) / 2 : 0]);
        }
        setNavigation(n => ({ action, sequence: n.sequence + 1, ...(target ? { target } : {}) }));
    };
    const onTelemetry = useCallback((state: TileTelemetry) => setTelemetry(state), []);
    const onSelect = useCallback((selection: typeof session.selection) => updateSession({ selection }), [updateSession]);
    const visibleBuildings = buildings.filter(e => `${e.label} ${e.id}`.toLowerCase().includes(filter.toLowerCase()));
    return <main className="map-lab" data-map-lab>
    <header className="lab-context">
      <div><span className="lab-eyebrow">RENDERER CALIBRATION</span><h1>One map. Connected places.</h1></div>
      <div className="lab-dataset"><label htmlFor="lab-dataset">Scene</label><select id="lab-dataset" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setTelemetry(null); setFilter(""); setNavigation({ action: "fit", sequence: 0 }); }}><option value="garden">Garden neighbourhood</option><option value="dense">Dense neighbourhood</option></select><span className="lab-demo">Synthetic</span></div>
    </header>
    <div className="lab-layout">
      <aside className="lab-left">
        <div className="lab-tabs" role="tablist" aria-label="Map panels">
          {(["map", "building", "sources"] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}><Icon name={t === "map" ? "layers" : t === "building" ? "building" : "document"}/>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        <div className="lab-panel-content">
        {tab === "map" && <><h2>Map layers</h2><div className="lab-layers">{layerGroups.map(layer => <label key={layer.kind}><Icon name={layer.icon}/><span>{layer.label}</span><input type="checkbox" checked={layers.includes(layer.kind)} onChange={e => setLayers(old => e.target.checked ? [...old, layer.kind] : old.filter(k => k !== layer.kind))}/></label>)}</div><div className="lab-divider"/><h2>Buildings <span>{buildings.length}</span></h2><label className="lab-search"><Icon name="search"/><input placeholder="Find in this scene" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Find in scene"/></label><div className="lab-buildings">{visibleBuildings.map(e => <button key={e.id} className={selected?.id === e.id ? "is-selected" : ""} onClick={() => select(e)}><span className="lab-building-icon"><Icon name="building"/></span><span><strong>{e.label.replace("building ", "Building ")}</strong><small>{e.identifiers[0]?.value.split(":").at(-1)}</small></span><Icon name="chevron" size={14}/></button>)}</div></>}
        {tab === "building" && <><h2>Linked geometry</h2><p className="lab-muted">Selection, level records and measurements use this scene’s shared snapshot. Switching panels does not recreate the map.</p>{levels.length ? levels.map(level => <section className="lab-level" key={level.id}><button onClick={() => select(level)}><Icon name="layers"/><strong>{level.label.split("level ").at(-1) === "0" ? "Ground floor" : `Floor ${level.label.split("level ").at(-1)}`}</strong></button>{snapshot!.relations.filter(r => r.toId === level.id && r.kind === "occupies_level").map(link => { const unit = snapshot!.entities.find(e => e.id === link.fromId)!; return <button className="lab-unit" key={unit.id} onClick={() => select(unit)}><Icon name="home"/>Unit {unit.label.split("unit ").at(-1)}</button>; })}</section>) : <div className="lab-empty"><Icon name="register" size={30}/><strong>No detailed floors supplied</strong><p>Choose Building 1 for the authored floor fixture. Other buildings retain only their exterior data.</p><button onClick={() => buildings[0] && select(buildings[0])}>Select Building 1</button></div>}</>}
        {tab === "sources" && <><h2>Source contributions</h2>{snapshot?.sources.map(source => <article className="lab-source" key={source.id}><Icon name="document" size={22}/><strong>{source.label}</strong><small>Revision {source.revision} · {source.method}</small><p>Geometry and levels are authored calibration inputs, not measurements of a real locality.</p></article>)}<div className="lab-source"><strong>{snapshot?.attachments.length || 0} attached PDFs</strong><p>Documents are optional. The original registry and uploaded files are not modified by this calibration screen.</p></div></>}
        </div>
        <footer className="lab-left-footer"><span className="lab-status-dot"/> Shared canonical snapshot</footer>
      </aside>
      <section className="lab-map" aria-label="Shared 3D map">
        {resource.error || validated.error ? <div className="lab-engine-loading" role="alert">{resource.error || validated.error}<button onClick={() => void resource.reload()}>Retry</button></div> : snapshot ? <MapViewport source={{ kind: "tiles", props: { manifestUrl: `/api/v1/spatial/calibration/${kind}/manifest.json`, sessionKey: `calibration:${kind}`, selection: session.selection, onSelect, mode: session.mode, navigation, visibleKinds: layers, inspection, onTelemetry } }}/> : <div className="lab-engine-loading">Preparing canonical data…</div>}
        <div className="lab-map-tools"><div className="lab-mode"><button aria-pressed={session.mode === "3d"} onClick={() => updateSession({ mode: "3d" })}>3D</button><button aria-pressed={session.mode === "2d"} onClick={() => updateSession({ mode: "2d" })}>2D</button></div><button onClick={() => runCommand("neighbourhood")}><Icon name="target"/>Neighbourhood</button><button onClick={() => runCommand("fit")}><Icon name="expand"/>Fit scene</button></div>
        <div className="lab-camera-tools"><button title="North" aria-label="North" onClick={() => runCommand("north")}>N</button><button aria-label="Zoom in" onClick={() => runCommand("zoom_in")}><Icon name="plus"/></button><button aria-label="Zoom out" onClick={() => runCommand("zoom_out")}><Icon name="minus"/></button><button aria-label="Focus selection" onClick={() => runCommand("focus")}><Icon name="target"/></button></div>
        <div className="lab-map-caption"><strong>{kind === "garden" ? "Garden neighbourhood" : "Dense neighbourhood"}</strong><span>{buildings.length} buildings · authored geometry · one shared renderer</span></div>
        <div className="lab-telemetry" aria-label="Map loading status"><span className="lab-status-dot"/>{telemetry?.ready ? "View ready" : "Loading spatial tiles"}<span>{telemetry?.loadedTiles ?? 0} cached tiles</span><span>{((telemetry?.tileBytes || 0) / 1024 / 1024).toFixed(1)} MiB tile estimate</span></div>
      </section>
      <aside className="lab-inspector" data-selected-entity={selected?.id || ""}>
        <div className="lab-inspector-heading"><Icon name="building"/><h2>Selected object</h2></div>
        <div className="lab-inspector-body"><div className="lab-selection-mark"><Icon name={selected?.kind === "space" ? "home" : "building"} size={34}/></div><span className="lab-eyebrow">PROTOTYPE REFERENCE</span><h3>{selected?.label || "Select a building"}</h3><code>{selected?.id}</code><div className="lab-pills"><span>{selected?.kind}</span><span>Revision {selected?.revision}</span><span>Fictional</span></div><div className="lab-divider"/><h2>Canonical measurements</h2><div className="lab-metrics"><div><small>Horizontal area</small><strong data-metric-area>{fmt(area?.value)} <em>m²</em></strong></div><div><small>Prism volume</small><strong data-metric-volume>{fmt(volume?.value)} <em>m³</em></strong></div><div><small>Lower / upper</small><strong>{rep?.vertical ? `${fmt(rep.vertical.lower)} / ${fmt(rep.vertical.upper)}` : "Unknown"} <em>m</em></strong></div></div><p className="lab-muted">Analytical fixture geometry. Facade and roof details are display-only, not additional surveyed volume.</p><div className="lab-divider"/><h2>Coordinate reference</h2><p className="lab-muted">Local metres · east, north, up<br />{frame?.verticalReference || "Unresolved"}</p><h2>Authoring memberships</h2><div className="lab-memberships">{selected?.areaIds.map(id => <span key={id}>{id.split(":").at(-1)}</span>)}</div><div className="lab-notice"><Icon name="info"/><p>One identity remains the same across panels, detail levels and tile boundaries.</p></div></div>
        <div className="lab-inspector-actions"><button onClick={() => runCommand("focus")}><Icon name="target"/>Focus object</button><button onClick={() => setTab("building")}><Icon name="register"/>Inspect records</button></div>
      </aside>
    </div>
  </main>;
}
