import type { PolygonRings, SpatialGeometry, XY } from "./types";
const EPS = 1e-9;
const orient = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: XY, b: XY, p: XY) => Math.abs(orient(a, b, p)) <= EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
function touches(a: XY, b: XY, c: XY, d: XY): boolean {
    const u = orient(a, b, c), v = orient(a, b, d), w = orient(c, d, a), x = orient(c, d, b);
    return ((u > EPS && v < -EPS || u < -EPS && v > EPS) &&
        (w > EPS && x < -EPS || w < -EPS && x > EPS)) ||
        onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
/** -1 outside, 0 boundary, 1 strictly inside. This is a bounded planar profile, not geodesic topology. */
function contains(ring: readonly XY[], p: XY): number {
    let inside = false;
    for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        if (onSegment(a, b, p))
            return 0;
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])
            inside = !inside;
    }
    return inside ? 1 : -1;
}
/** Reject unsupported/invalid topology instead of reporting plausible but false areas.
 * Complex shapes exceeding the comparison budget belong in the existing geometry worker.
 */
export function metricTopologyIssue(geometry: SpatialGeometry): string | null {
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
        return "Polygon geometry is required";
    const polygons: readonly PolygonRings[] = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let remaining = 200000;
    const compare = (a: XY, b: XY, c: XY, d: XY) => {
        if (--remaining < 0)
            throw new Error("Topology budget exceeded; use the geometry worker");
        return touches(a, b, c, d);
    };
    const ringsTouch = (a: readonly XY[], b: readonly XY[]) => {
        for (let i = 0; i < a.length - 1; i++)
            for (let j = 0; j < b.length - 1; j++) {
                if (compare(a[i], a[i + 1], b[j], b[j + 1]))
                    return true;
            }
        return false;
    };
    try {
        for (const polygon of polygons) {
            if (!polygon.length)
                return "Missing polygon shell";
            for (const ring of polygon) {
                if (ring.length < 4 || ring.some(p => p.length !== 2 || !p.every(Number.isFinite)))
                    return "Invalid finite polygon coordinates";
                const n = ring.length - 1;
                if (ring[0][0] !== ring[n][0] || ring[0][1] !== ring[n][1])
                    return "Unclosed polygon ring";
                for (let i = 0; i < n; i++) {
                    if (Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]) <= EPS)
                        return "Repeated polygon vertex";
                    for (let j = i + 1; j < n; j++) {
                        if (j === i + 1 || i === 0 && j === n - 1)
                            continue;
                        if (compare(ring[i], ring[i + 1], ring[j], ring[j + 1]))
                            return "Self-intersecting or self-touching ring";
                    }
                }
            }
            for (let h = 1; h < polygon.length; h++) {
                if (contains(polygon[0], polygon[h][0]) !== 1 || ringsTouch(polygon[0], polygon[h]))
                    return "Hole is not strictly inside the shell";
                for (let k = 1; k < h; k++) {
                    if (ringsTouch(polygon[k], polygon[h]) || contains(polygon[k], polygon[h][0]) >= 0 || contains(polygon[h], polygon[k][0]) >= 0)
                        return "Overlapping or nested holes";
                }
            }
        }
        for (let a = 0; a < polygons.length; a++)
            for (let b = a + 1; b < polygons.length; b++) {
                // This first profile requires disjoint parts; touching parts need a worker-qualified representation.
                for (const r of polygons[a])
                    for (const s of polygons[b])
                        if (ringsTouch(r, s))
                            return "Touching multipart boundaries require worker validation";
                const inPolygon = (rings: PolygonRings, p: XY) => contains(rings[0], p) === 1 && !rings.slice(1).some(r => contains(r, p) >= 0);
                if (inPolygon(polygons[a], polygons[b][0][0]) || inPolygon(polygons[b], polygons[a][0][0]))
                    return "Overlapping polygon parts";
            }
        return null;
    }
    catch (error) {
        return error instanceof Error ? error.message : "Unsupported topology";
    }
}
