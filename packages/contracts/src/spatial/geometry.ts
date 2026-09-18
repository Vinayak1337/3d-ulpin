import { metricTopologyIssue } from "./topology";
import type { PolygonRings, SpatialFrame, SpatialGeometry, SpatialQuantity, SpatialRepresentation, XY } from "./types";
export function signedRingArea(ring: readonly XY[]): number {
    // Translate first to avoid cancellation for survey coordinates far from zero.
    if (ring.length < 3)
        return 0;
    const [ox, oy] = ring[0];
    let twice = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        twice += (a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy);
    }
    return twice / 2;
}
export function polygonArea(rings: PolygonRings): number {
    return Math.abs(signedRingArea(rings[0])) - rings.slice(1).reduce((sum, ring) => sum + Math.abs(signedRingArea(ring)), 0);
}
export function geometryPoints(g: SpatialGeometry): readonly XY[] {
    switch (g.type) {
        case "Point": return [g.coordinates];
        case "LineString": return g.coordinates;
        case "Polygon": return g.coordinates.flat();
        case "MultiPolygon": return g.coordinates.flat(2);
    }
}
export function geometryBounds(g: SpatialGeometry): [
    number,
    number,
    number,
    number
] {
    const points = geometryPoints(g);
    if (!points.length)
        throw new Error("Empty geometry has no bounds");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return [minX, minY, maxX, maxY];
}
export function measureRepresentation(rep: SpatialRepresentation, frame: SpatialFrame, definition: SpatialQuantity["definition"]): SpatialQuantity {
    const base = { definition, unit: definition === "horizontal_area" ? "m2" as const : "m3" as const, representationId: rep.id, representationRevision: rep.revision };
    if (frame.id !== rep.frameId || frame.kind !== "engineering" || frame.horizontalUnit !== "m")
        return { ...base, value: null, reason: "A matching metric analytical frame is required" };
    if (rep.role === "display_only" || rep.role === "unspecified")
        return { ...base, value: null, reason: "Display geometry is not an analytical measurement source" };
    const g = rep.geometry;
    if (g.type !== "Polygon" && g.type !== "MultiPolygon")
        return { ...base, value: null, reason: "Polygon geometry is required" };
    const topologyIssue = metricTopologyIssue(g);
    if (topologyIssue)
        return { ...base, value: null, reason: topologyIssue };
    const area = g.type === "Polygon" ? polygonArea(g.coordinates) : g.coordinates.reduce((sum, p) => sum + polygonArea(p), 0);
    if (!Number.isFinite(area) || area <= 0)
        return { ...base, value: null, reason: "Nonpositive or invalid polygon area" };
    if (definition === "horizontal_area")
        return { ...base, value: area };
    if (!rep.vertical || rep.vertical.reference !== frame.verticalReference)
        return { ...base, value: null, reason: "Compatible lower/upper elevations are required" };
    if (![rep.vertical.lower, rep.vertical.upper].every(Number.isFinite) || rep.vertical.upper < rep.vertical.lower)
        return { ...base, value: null, reason: "Invalid vertical interval" };
    return { ...base, value: area * (rep.vertical.upper - rep.vertical.lower) };
}
/** Stable only for appearance choices. Never use this as a cryptographic content hash or property ID. */
export function appearanceSeed(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++)
        hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0;
}
export function stableEncode(value: unknown): string {
    if (value === undefined)
        throw new Error("Undefined is not a canonical JSON value");
    if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("Non-finite JSON number");
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableEncode).join(",")}]`;
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableEncode((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
