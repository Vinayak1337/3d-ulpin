import { appearanceSeed, geometryBounds, signedRingArea, type SpatialEntity, type SpatialRepresentation, type XY, type XYZ } from "@ulpin/contracts";
import { MeshBuilder, type MeshData } from "./mesh";
export interface RenderInput {
    entity: SpatialEntity;
    representation: SpatialRepresentation;
}
export function buildMeshes(inputs: readonly RenderInput[], detail: boolean): Map<number, MeshData> {
    const builders = new Map<number, MeshBuilder>();
    const material = (m: number) => { let b = builders.get(m); if (!b) {
        b = new MeshBuilder();
        builders.set(m, b);
    } return b; };
    inputs.forEach(({ entity: e, representation: r }, feature) => {
        const seed = appearanceSeed(e.id), g = r.geometry, lower = r.vertical?.lower ?? 0, upper = r.vertical?.upper ?? lower;
        if (e.kind === "vegetation" && g.type === "Point") {
            const [x, y] = g.coordinates, h = upper - lower;
            material(13).box(x - .16, y - .16, lower, .32, .32, h * .64, feature);
            if (detail)
                for (let n = 0; n < 7; n++) {
                    const a = (n + seed % 9) * 2.4, rad = n === 0 ? 0 : 1.35;
                    material(n % 2 ? 11 : 12).ellipsoid([x + Math.cos(a) * rad, y + Math.sin(a) * rad, lower + h * .72 + (n % 3) * .38], [1.55, 1.55, 1.8], feature);
                }
            else
                material(11).ellipsoid([x, y, lower + h * .7], [2.6, 2.6, h * .36], feature, 6, 4);
            return;
        }
        if (g.type !== "Polygon" && g.type !== "MultiPolygon")
            return;
        const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        if (e.kind !== "building" && e.kind !== "building_part") {
            const m = e.kind === "road" ? 7 : e.kind === "parcel" ? 8 : e.kind === "public_land" ? 10 : 9;
            for (const p of polygons)
                material(m).prism(p, lower, upper, feature);
            return;
        }
        const color = seed % 3, h = upper - lower;
        if (h <= 0)
            return;
        for (const p of polygons) {
            const roofDepth=Math.min(.08,h*.1);
            material(color).prism(p, lower, upper - roofDepth, feature);
            material(4).prism(p, upper - roofDepth, upper, feature);
            if (!detail || r.appearance?.facade !== "schematic")
                continue;
            const storeys = r.appearance.storeys || 1, step = h / storeys;
            p.forEach((ring, ringIndex) => {
                const sign = (signedRingArea(ring) >= 0 ? 1 : -1) * (ringIndex ? -1 : 1);
                for (let edge = 0; edge < ring.length - 1; edge++) {
                    const a = ring[edge], b = ring[edge + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
                    if (len < .8)
                        continue;
                    const nx = sign * dy / len, ny = -sign * dx / len;
                    const point = (s: number, depth: number): XY => [a[0] + dx * s / len + nx * depth, a[1] + dy * s / len + ny * depth];
                    const bar = (start: number, end: number, inside: number, outside: number, z: number, thickness: number, m: number) => {
                        const q = [point(start, inside), point(end, inside), point(end, outside), point(start, outside)];
                        material(m).prism([[...q, q[0]]], z, z + thickness, feature);
                    };
                    for (let floor = 0; floor < storeys; floor++) {
                        const z = lower + floor * step;
                        bar(0, len, -.04, .09, z + .02, .14, 3);
                        const bays = Math.max(1, Math.floor(len / 3.15)), pitch = len / bays;
                        for (let bay = 0; bay < bays; bay++) {
                            const start = bay * pitch + pitch * .23, end = (bay + 1) * pitch - pitch * .23, base = z + .72, top = z + Math.min(step - .45, 2.65);
                            if (end - start < .35 || top <= base)
                                continue;
                            bar(start - .09, end + .09, .015, .13, base - .09, .09, 3);
                            bar(start - .09, end + .09, .015, .13, top, .09, 3);
                            bar(start - .09, start, .015, .13, base, top - base, 3);
                            bar(end, end + .09, .015, .13, base, top - base, 3);
                            const v = (s: number, z: number): XYZ => [...point(s, .045), z];
                            material(5).face([v(start, base), v(end, base), v(end, top), v(start, top)], [nx, ny, 0], feature);
                            bar((start + end) / 2 - .025, (start + end) / 2 + .025, .045, .10, base, top - base, 6);
                            if (floor > 0 && bay % 3 === 1 && ringIndex === 0) {
                                // Explicit synthetic decorative projection, never the analytical footprint.
                                bar(start - .24, end + .24, .0, .52, z + .12, .12, 3);
                                bar(start - .24, end + .24, .44, .50, z + .24, .72, 6);
                            }
                        }
                    }
                    bar(0, len, -.18, 0, upper - .42, .42, 3);
                }
            });
            // Roof props are only authored visual treatment and remain inside each polygon's simple rectangular envelope where supported.
            if (p.length === 1 && p[0].length === 5 && p[0].slice(0,-1).every((point,i)=>point[0]===p[0][i+1][0]||point[1]===p[0][i+1][1])) {
                const [x, y, maxX, maxY] = geometryBounds({ type: "Polygon", coordinates: p }), w = maxX - x, d = maxY - y;
                if (w > 6 && d > 6) {
                    material(3).box(x + w * .14, y + d * .16, upper, w * .20, d * .18, .62, feature);
                    material(6).ellipsoid([x + w * .72, y + d * .75, upper + .55], [.65, .65, .65], feature, 10, 6);
                    for (let i = 0; i < 2; i++)
                        for (let j = 0; j < 3; j++)
                            material(14).box(x + w * .45 + i * 1.65, y + d * .22 + j * .90, upper + .05, 1.55, .82, .07, feature);
                }
            }
        }
    });
    return new Map([...builders].map(([m, b]) => [m, b.mesh]));
}
