import { SPATIAL_SCHEMA, type SpatialSnapshot, type SpatialGeometry, type XY } from "./types";
import { signedRingArea } from "./geometry";
const kinds = new Set(["building", "building_part", "level", "space", "parcel", "road", "rail", "utility", "public_land", "terrain", "vegetation"]);
const roles = new Set(["unspecified", "design_outline", "recorded_road_land", "restriction", "ground_footprint", "roof_projection", "exterior", "floor_boundary", "unit_boundary", "recorded_parcel", "road_surface", "alignment", "public_land", "terrain_surface", "display_only"]);
function requireValue(ok: unknown, message: string): asserts ok { if (!ok)
    throw new Error(`Spatial contract: ${message}`); }
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 512;
function object(x: unknown): asserts x is Record<string, unknown> { requireValue(x && typeof x === "object" && !Array.isArray(x), "expected an object"); }
function array(x: unknown, label: string, max = 10000): asserts x is unknown[] { requireValue(Array.isArray(x) && x.length <= max, `${label} must be a bounded array`); }
function id(x: unknown, label = "id"): asserts x is string { requireValue(text(x), `${label} is required`); }
function revision(x: unknown) { requireValue(Number.isSafeInteger(x) && (x as number) >= 0, "revision must be a nonnegative integer"); }
function unique(items: unknown[], label: string): Map<string, Record<string, unknown>> {
    const map = new Map<string, Record<string, unknown>>();
    for (const x of items) {
        object(x);
        id(x.id);
        requireValue(!map.has(x.id), `duplicate ${label} ${x.id}`);
        map.set(x.id, x);
    }
    return map;
}
function xy(x: unknown): asserts x is XY { requireValue(Array.isArray(x) && x.length === 2 && x.every(finite), "positions require two finite coordinates; Z/M are not silently dropped"); }
function ring(x: unknown) {
    array(x, "ring", 2048);
    requireValue(x.length >= 4, "rings must be closed with at least four positions");
    x.forEach(xy);
    const p = x as unknown as XY[];
    requireValue(p[0][0] === p.at(-1)![0] && p[0][1] === p.at(-1)![1], "ring is not closed");
    requireValue(Math.abs(signedRingArea(p)) > 1e-12, "ring is degenerate");
}
function polygon(x: unknown) { array(x, "polygon", 128); requireValue(x.length > 0, "polygon has no exterior"); x.forEach(ring); }
export function validateGeometry(x: unknown): asserts x is SpatialGeometry {
    object(x);
    switch (x.type) {
        case "Point":
            xy(x.coordinates);
            break;
        case "LineString":
            array(x.coordinates, "line", 2048);
            requireValue(x.coordinates.length >= 2, "line requires two points");
            x.coordinates.forEach(xy);
            break;
        case "Polygon":
            polygon(x.coordinates);
            break;
        case "MultiPolygon":
            array(x.coordinates, "multipolygon", 128);
            requireValue(x.coordinates.length > 0, "multipolygon is empty");
            x.coordinates.forEach(polygon);
            break;
        default: throw new Error("Spatial contract: unsupported geometry profile");
    }
}
/** Structural and referential gate. Exact topology/solid validation stays in the geometry lane. */
export function validateSpatialSnapshot(value: unknown): asserts value is SpatialSnapshot {
    object(value);
    requireValue(value.schemaVersion === SPATIAL_SCHEMA, "unsupported schema version");
    id(value.id);
    id(value.worldId);
    revision(value.revision);
    requireValue(["observed", "planned", "hypothetical", "synthetic"].includes(value.worldState as string), "unknown world state");
    for (const key of ["frames", "sources", "entities", "representations", "relations", "attachments"])
        array(value[key], key);
    const frames = unique(value.frames as unknown[], "frame"), sources = unique(value.sources as unknown[], "source"), entities = unique(value.entities as unknown[], "entity"), reps = unique(value.representations as unknown[], "representation");
    unique(value.relations as unknown[], "relation");
    unique(value.attachments as unknown[], "attachment");
    for (const f of frames.values()) {
        requireValue((f.kind === "engineering" && f.horizontalUnit === "m" && f.axes === "east-north-up") || (f.kind === "geographic" && f.horizontalUnit === "degree" && f.axes === "longitude-latitude-height"), "incompatible coordinate kind/units/axes");
        requireValue(f.verticalUnit === "m" && (f.verticalReference === null || text(f.verticalReference)), "invalid vertical reference");
        if (f.anchor !== undefined) {
            object(f.anchor);
            requireValue(finite(f.anchor.longitude) && Math.abs(f.anchor.longitude) <= 180 && finite(f.anchor.latitude) && Math.abs(f.anchor.latitude) <= 90 && finite(f.anchor.ellipsoidHeight) && text(f.anchor.provenance), "world anchor requires explicit finite coordinates and provenance");
        }
    }
    for (const s of sources.values()) {
        if (s.revision !== null)
            revision(s.revision);
        id(s.label);
        requireValue(["source", "manual", "derived", "synthetic"].includes(s.method as string), "invalid source method");
        if (s.sha256 !== undefined)
            requireValue(typeof s.sha256 === "string" && /^[a-f0-9]{64}$/.test(s.sha256), "invalid SHA-256");
    }
    const checkSource = (e: Record<string, unknown>) => { id(e.sourceId); const s = sources.get(e.sourceId); requireValue(s && s.revision === e.sourceRevision, "missing or stale source revision"); };
    for (const e of entities.values()) {
        revision(e.revision);
        requireValue(e.worldId === value.worldId, "cross-world entity");
        requireValue(kinds.has(e.kind as string), "unsupported entity kind");
        id(e.label);
        array(e.areaIds, "memberships");
        e.areaIds.forEach(x => id(x));
        requireValue(new Set(e.areaIds).size === e.areaIds.length, "duplicate area membership");
        array(e.identifiers, "identifiers");
        for (const identifier of e.identifiers) {
            object(identifier);
            id(identifier.value);
            id(identifier.scheme);
            id(identifier.issuer);
            requireValue(["supplied", "validated", "prototype"].includes(identifier.status as string), "invalid identifier state");
        }
        array(e.representationIds, "representation IDs");
        requireValue(new Set(e.representationIds).size === e.representationIds.length, "duplicate representation membership");
        for (const rid of e.representationIds) {
            id(rid);
            requireValue(reps.get(rid)?.entityId === e.id, "representation belongs to another/missing entity");
        }
    }
    let positions = 0;
    for (const r of reps.values()) {
        revision(r.revision);
        id(r.entityId);
        id(r.frameId);
        const e = entities.get(r.entityId), f = frames.get(r.frameId);
        requireValue(e && f && (e.representationIds as unknown[]).includes(r.id), "unlinked representation/frame");
        requireValue(roles.has(r.role as string), "unknown geometry role");
        validateGeometry(r.geometry);
        const walk = (x: unknown) => { if (Array.isArray(x)) {
            if (typeof x[0] === "number") {
                positions++;
                if (f.kind === "geographic")
                    requireValue(Math.abs(x[0]) <= 180 && Math.abs(x[1]) <= 90, "geographic coordinate out of range");
            }
            else
                x.forEach(walk);
        } };
        walk(r.geometry.coordinates);
        requireValue(positions <= 500000, "snapshot position budget exceeded");
        if (r.vertical !== null) {
            object(r.vertical);
            requireValue(finite(r.vertical.lower) && finite(r.vertical.upper) && r.vertical.upper >= r.vertical.lower && text(r.vertical.reference), "invalid vertical interval");
            requireValue(r.vertical.reference === f.verticalReference, "vertical frame mismatch");
        }
        array(r.evidence, "evidence");
        for (const evidence of r.evidence) {
            object(evidence);
            checkSource(evidence);
            object(evidence.locator);
            requireValue(["feature", "page", "row", "json_pointer", "manual"].includes(evidence.locator.kind as string) && text(evidence.locator.value), "invalid source locator");
        }
        if (r.appearance !== undefined) {
            object(r.appearance);
            requireValue(["plain", "schematic"].includes(r.appearance.facade as string), "invalid facade recipe");
            if (r.appearance.facade === "schematic")
                requireValue(value.worldState === "synthetic", "schematic architecture requires an explicit synthetic world");
            if (r.appearance.storeys !== undefined)
                requireValue(Number.isSafeInteger(r.appearance.storeys) && (r.appearance.storeys as number) > 0 && (r.appearance.storeys as number) <= 100, "invalid storey count");
            if(r.appearance.envelopeOnly!==undefined)requireValue(typeof r.appearance.envelopeOnly==="boolean","invalid envelope appearance flag");
        }
    }
    for (const relation of value.relations as Record<string, unknown>[]) {
        requireValue(entities.has(relation.fromId as string) && entities.has(relation.toId as string) && relation.fromId !== relation.toId, "invalid relationship endpoints");
        requireValue(["part_of", "occupies_level", "associated_parcel", "serves", "crosses"].includes(relation.kind as string), "unsupported relationship");
    }
    // A containment cycle must never turn a scene explorer into an infinite traversal.
    const parents = new Map<string, string[]>();
    for (const r of value.relations as Record<string, string>[])
        if (r.kind === "part_of")
            parents.set(r.fromId, [...(parents.get(r.fromId) || []), r.toId]);
    const indegree = new Map<string, number>();
    for (const key of entities.keys())
        indegree.set(key, 0);
    for (const values of parents.values())
        for (const p of values)
            indegree.set(p, indegree.get(p)! + 1);
    const ready = [...indegree].filter(([, n]) => n === 0).map(([k]) => k);
    let visited = 0;
    for (let i = 0; i < ready.length; i++) {
        visited++;
        for (const p of parents.get(ready[i]) || []) {
            indegree.set(p, indegree.get(p)! - 1);
            if (indegree.get(p) === 0)
                ready.push(p);
        }
    }
    requireValue(visited === entities.size, "containment cycle");
    for (const link of value.attachments as Record<string, unknown>[]) {
        requireValue(entities.has(link.entityId as string), "attachment target missing");
        checkSource(link);
        requireValue(["context", "geometry", "record"].includes(link.purpose as string), "invalid attachment purpose");
    }
}
