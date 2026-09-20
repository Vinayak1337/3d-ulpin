import { createHash } from "node:crypto";
import { enuToEcef, geometryBounds, geometryPoints, metricTopologyIssue, stableEncode, validateSpatialSnapshot, type SpatialSnapshot } from "@ulpin/contracts";
import { buildMeshes, type RenderInput } from "./architecture";
import { encodeGlb } from "./glb";
import { STYLE_VERSION } from "./materials";
export interface CompiledPublication {
    id: string;
    manifest: Record<string, unknown>;
    assets: ReadonlyMap<string, Buffer>;
    summary: {
        entities: number;
        renderedEntities: number;
        tiles: number;
        bytes: number;
        style: string;
    };
}
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
function boxFor(meshes: ReturnType<typeof buildMeshes>): number[] {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const mesh of meshes.values())
        for (let i = 0; i < mesh.positions.length; i += 3) {
            const p = [mesh.positions[i], -mesh.positions[i + 2], mesh.positions[i + 1]];
            for (let j = 0; j < 3; j++) {
                min[j] = Math.min(min[j], p[j]);
                max[j] = Math.max(max[j], p[j]);
            }
        }
    if (!min.every(Number.isFinite))
        return [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const mid = min.map((m, i) => (m + max[i]) / 2), half = min.map((m, i) => Math.max((max[i] - m) / 2, .05));
    return [...mid, half[0], 0, 0, 0, half[1], 0, 0, 0, half[2]];
}
function unionBoxes(boxes: number[][]): number[] {
    if(!boxes.length) throw new Error("No geometry bounds");
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const b of boxes)for(let i=0;i<3;i++){const half=b[[3,7,11][i]];lo[i]=Math.min(lo[i],b[i]-half);hi[i]=Math.max(hi[i],b[i]+half);}
    const c=lo.map((x,i)=>(x+hi[i])/2),h=lo.map((x,i)=>(hi[i]-x)/2);
    return [...c,h[0],0,0,0,h[1],0,0,0,h[2]];
}
/** Bounded compilation profile. General CRS, mesh booleans and bulk-world publishing are deliberately separate. */
export function compileSpatialSnapshot(snapshot: SpatialSnapshot, baseUrl: string): CompiledPublication {
    validateSpatialSnapshot(snapshot);
    if (snapshot.frames.length !== 1)
        throw new Error("This compiler profile requires one explicitly placed engineering frame");
    const frame = snapshot.frames[0], transform = enuToEcef(frame);
    if (!frame.verticalReference)
        throw new Error("World compilation needs an explicit vertical reference");
    const byId = new Map(snapshot.entities.map(e => [e.id, e]));
    const inputs: RenderInput[] = snapshot.representations.filter(r => {
        const e = byId.get(r.entityId)!;
        return e.kind !== "level" && e.kind !== "space";
    }).map(r => ({ entity: byId.get(r.entityId)!, representation: r })).sort((a, b) => a.entity.id.localeCompare(b.entity.id));
    const seen = new Set<string>();
    if(inputs.length>2000)throw new Error("The neighbourhood compiler supports at most 2000 visible entities per publication");
    let vertices=0,facadeBays=0;
    for (const input of inputs) {
        const r = input.representation;
        if (seen.has(input.entity.id))
            throw new Error("Select one exterior representation per entity before compiling");
        seen.add(input.entity.id);
        if (r.frameId !== frame.id || !r.vertical || r.vertical.reference !== frame.verticalReference)
            throw new Error(`Unresolved frame/vertical placement: ${r.id}`);
        if (!["Polygon", "MultiPolygon", "Point"].includes(r.geometry.type)&&!(r.geometry.type==="LineString"&&r.role==="display_only"&&["road","rail","utility"].includes(input.entity.kind)))
            throw new Error("Alignment needs a supported surface/profile derivative before mesh compilation");
        vertices+=geometryPoints(r.geometry).length;
        if(vertices>50000)throw new Error("The neighbourhood compiler vertex budget was exceeded; select a smaller area");
        if(r.appearance?.facade==="schematic"){
            const polygons=r.geometry.type==="Polygon"?[r.geometry.coordinates]:r.geometry.type==="MultiPolygon"?r.geometry.coordinates:[];
            for(const polygon of polygons)for(const ring of polygon)for(let i=1;i<ring.length;i++)facadeBays+=Math.max(1,Math.floor(Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1])/3.15))*(r.appearance.storeys||1);
            if(facadeBays>12000)throw new Error("The neighbourhood facade work budget was exceeded; use a bounded view or simpler detail profile");
        }
    }
    if (!inputs.length)
        throw new Error("The selected snapshot has no renderable exterior content");
    for (const { entity, representation: r } of inputs) {
        if (r.geometry.type === "Point" && entity.kind !== "vegetation")
            throw new Error("This compiler point profile supports authored vegetation only");
        if (r.geometry.type === "Polygon" || r.geometry.type === "MultiPolygon") {
            const issue = metricTopologyIssue(r.geometry);
            if (issue)
                throw new Error(`${r.id}: ${issue}`);
        }
        const b = geometryBounds(r.geometry);
        if (b.some(x => Math.abs(x) > 5000))
            throw new Error("This compilation profile is bounded to 5 km from its engineering origin");
    }
    const supportedKinds = new Set(["building", "building_part", "parcel", "road", "rail", "utility", "public_land", "terrain", "vegetation"]);
    for(const {entity,representation} of inputs) {
        if(!supportedKinds.has(entity.kind)) throw new Error(`No qualified render profile for ${entity.kind}`);
        if(representation.appearance?.facade === "schematic" && (representation.vertical!.upper - representation.vertical!.lower) / (representation.appearance.storeys || 1) < 1) throw new Error("Schematic storey height must be at least one metre");
    }
    const assets = new Map<string, Buffer>();
    const make = (name: string, items: RenderInput[], detail: boolean) => {
        const meshes = buildMeshes(items, detail,snapshot.worldState==="synthetic");
        const features = items.map(({ entity: e, representation: r }) => ({ entityId: e.id, representationId: r.id, revision: r.revision, kind: e.kind }));
        const bytes=encodeGlb(meshes, features);
        if(bytes.length+[...assets.values()].reduce((n,b)=>n+b.length,0)>80*1024*1024)throw new Error("The neighbourhood tile byte budget was exceeded");
        assets.set(name, bytes);
        return boxFor(meshes);
    };
    const context = inputs.filter(i => !["building", "building_part", "vegetation"].includes(i.entity.kind));
    const detailInputs = inputs.filter(i => ["building", "building_part", "vegetation"].includes(i.entity.kind));
    const groups = new Map<string, RenderInput[]>();
    for (const input of detailInputs) {
        const b = geometryBounds(input.representation.geometry), key = `${Math.floor((b[0] + b[2]) / 2 / 100)}_${Math.floor((b[1] + b[3]) / 2 / 100)}`;
        groups.set(key, [...(groups.get(key) || []), input]);
    }
    const contextBox = context.length ? make("context.glb", context, false) : null;
    const nodes = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => { const coarse=make(`${key}-coarse.glb`, items, false); const box=unionBoxes([coarse,make(`${key}-detail.glb`,items,true)]); return { key, box }; });
    // Actual asset bytes participate in identity: a compiler/material change cannot reuse a stale URL.
    const id = hash(stableEncode({ schema: snapshot.schemaVersion, world: snapshot.worldId, revision: snapshot.revision, transform, style: STYLE_VERSION, assets: [...assets].map(([key, data]) => [key, hash(data)]) }));
    const url = (name: string) => `${baseUrl}/${id}/${name}`;
    const fullBox = unionBoxes([...(contextBox ? [contextBox] : []), ...nodes.map(n => n.box)]);
    const root = { boundingVolume: { box: fullBox }, transform, geometricError: 120, refine: "ADD", ...(contextBox ? { content: { uri: url("context.glb"), boundingVolume: { box: contextBox } } } : {}), children: nodes.map(n => ({ boundingVolume: { box: n.box }, geometricError: 36, refine: "REPLACE", content: { uri: url(`${n.key}-coarse.glb`) }, children: [{ boundingVolume: { box: n.box }, geometricError: 0, content: { uri: url(`${n.key}-detail.glb`) } }] })) };
    return { id, assets, manifest: { asset: { version: "1.1", tilesetVersion: id }, geometricError: 200, root, extras: { worldId: snapshot.worldId, worldState: snapshot.worldState, snapshotId: snapshot.id, snapshotRevision: snapshot.revision, style: STYLE_VERSION } }, summary: { entities: snapshot.entities.length, renderedEntities: inputs.length, tiles: assets.size, bytes: [...assets.values()].reduce((n, b) => n + b.length, 0), style: STYLE_VERSION } };
}
