import earcut from "earcut";
import { signedRingArea, type XY, type XYZ, type PolygonRings } from "@ulpin/contracts";
export interface MeshData {
    positions: number[];
    normals: number[];
    indices: number[];
    featureIds: number[];
}
export const emptyMesh = (): MeshData => ({ positions: [], normals: [], indices: [], featureIds: [] });
export class MeshBuilder {
    constructor(readonly mesh: MeshData = emptyMesh()) { }
    face(points: readonly XYZ[], normal: XYZ, feature: number) {
        const first = this.mesh.positions.length / 3;
        const u = points[1].map((v, i) => v - points[0][i]), v = points[2].map((a, i) => a - points[0][i]);
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const reverse = cross.reduce((s, n, i) => s + n * normal[i], 0) < 0;
        // glTF Y-up: ENU (east,north,up) -> (east,up,-north). Cesium performs Y-up -> Z-up.
        for (const [x, y, z] of points) {
            this.mesh.positions.push(x, z, -y);
            this.mesh.normals.push(normal[0], normal[2], -normal[1]);
            this.mesh.featureIds.push(feature);
        }
        for (let i = 1; i < points.length - 1; i++)
            this.mesh.indices.push(first, first + (reverse ? i + 1 : i), first + (reverse ? i : i + 1));
    }
    prism(rings: PolygonRings, lower: number, upper: number, feature: number) {
        const open = rings.map(r => r.slice(0, -1)), points = open.flat(), holes: number[] = [];
        let count = open[0].length;
        for (const ring of open.slice(1)) {
            holes.push(count);
            count += ring.length;
        }
        const tris = earcut(points.flat(), holes, 2);
        for (let i = 0; i < tris.length; i += 3) {
            const tri = tris.slice(i, i + 3).map(index => points[index]);
            this.face(tri.map(([x, y]) => [x, y, upper]), [0, 0, 1], feature);
            if (upper > lower)
                this.face(tri.map(([x, y]) => [x, y, lower]), [0, 0, -1], feature);
        }
        if (upper <= lower)
            return;
        rings.forEach((ring, r) => { const sign = (signedRingArea(ring) >= 0 ? 1 : -1) * (r === 0 ? 1 : -1); for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i], b = ring[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (len < 1e-9)
                continue;
            this.face([[...a, lower], [...b, lower], [...b, upper], [...a, upper]], [sign * (b[1] - a[1]) / len, -sign * (b[0] - a[0]) / len, 0], feature);
        } });
    }
    box(x: number, y: number, z: number, w: number, d: number, h: number, feature: number) { const ring: XY[] = [[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]]; this.prism([ring], z, z + h, feature); }
    /** Diagram stroke only. Its width must not be used as a physical measurement. */
    stroke(points:readonly XY[],z:number,width:number,feature:number) {
        for(let i=1;i<points.length;i++){
            const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-6)continue;
            const nx=-(b[1]-a[1])/length*width/2,ny=(b[0]-a[0])/length*width/2;
            this.face([[a[0]+nx,a[1]+ny,z],[b[0]+nx,b[1]+ny,z],[b[0]-nx,b[1]-ny,z],[a[0]-nx,a[1]-ny,z]],[0,0,1],feature);
        }
    }
    ellipsoid(center: XYZ, radius: XYZ, feature: number, segments = 9, rings = 6) {
        const vertex = (i: number, j: number): XYZ => { const a = i * 2 * Math.PI / segments, p = -Math.PI / 2 + j * Math.PI / rings; return [center[0] + radius[0] * Math.cos(p) * Math.cos(a), center[1] + radius[1] * Math.cos(p) * Math.sin(a), center[2] + radius[2] * Math.sin(p)]; };
        for (let j = 0; j < rings; j++)
            for (let i = 0; i < segments; i++) {
                const pts = [vertex(i, j), vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j + 1)];
                const a = (i + 0.5) * 2 * Math.PI / segments, p = -Math.PI / 2 + (j + 0.5) * Math.PI / rings;
                const n = [Math.cos(p) * Math.cos(a) / radius[0], Math.cos(p) * Math.sin(a) / radius[1], Math.sin(p) / radius[2]], len = Math.hypot(...n);
                this.face(pts, [n[0] / len, n[1] / len, n[2] / len], feature);
            }
    }
}
