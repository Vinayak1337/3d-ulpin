import type { MeshData } from "./mesh";
import { materials } from "./materials";
import {materialTexture,materialTextureProfile} from "./texture";
export interface RenderFeature {
    entityId: string;
    representationId: string;
    revision: number;
    kind: string;
}
/** glTF 2.0 + 3D Tiles 1.1 feature metadata. No source URLs or party data enter this payload. */
export function encodeGlb(groups: Map<number, MeshData>, features: RenderFeature[]): Buffer {
    const chunks: Buffer[] = [], bufferViews: Record<string, unknown>[] = [], accessors: Record<string, unknown>[] = [], primitives: Record<string, unknown>[] = [];
    let offset = 0;
    const append = (data: Uint8Array, target?: number) => { const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength), index = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) }); chunks.push(bytes); offset += bytes.length; const pad = (4 - offset % 4) % 4; if (pad) {
        chunks.push(Buffer.alloc(pad));
        offset += pad;
    } return index; };
    const accessor = (data: Float32Array | Uint32Array | Uint16Array, type: string, components: number, componentType: number, target: number, bounds = false) => {
        const bufferView = append(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), target), index = accessors.length;
        const minimum = Array(components).fill(Infinity), maximum = Array(components).fill(-Infinity);
        if (bounds)
            for (let i = 0; i < data.length; i++) {
                minimum[i % components] = Math.min(minimum[i % components], data[i]);
                maximum[i % components] = Math.max(maximum[i % components], data[i]);
            }
        accessors.push({ bufferView, componentType, count: data.length / components, type, ...(bounds ? { min: minimum, max: maximum } : {}) });
        return index;
    };
    for (const [material, mesh] of [...groups].sort((a, b) => a[0] - b[0])) {
        if (!mesh.indices.length)
            continue;
        const position = accessor(new Float32Array(mesh.positions), "VEC3", 3, 5126, 34962, true), normal = accessor(new Float32Array(mesh.normals), "VEC3", 3, 5126, 34962);
        const feature = accessor(new Uint16Array(mesh.featureIds), "SCALAR", 1, 5123, 34962), indices = accessor(new Uint32Array(mesh.indices), "SCALAR", 1, 5125, 34963);
        const profile=materialTextureProfile(material),uv:number[]=[];
        if(profile)for(let i=0;i<mesh.positions.length;i+=3){const n=mesh.normals,p=mesh.positions;
            uv.push((Math.abs(n[i])>.5?-p[i+2]:p[i])/profile.metres,(Math.abs(n[i+1])>.5?-p[i+2]:p[i+1])/profile.metres);
        }
        const texcoord=profile?accessor(new Float32Array(uv),"VEC2",2,5126,34962):undefined;
        primitives.push({ attributes: { POSITION: position, NORMAL: normal, _FEATURE_ID_0: feature,...(texcoord===undefined?{}:{TEXCOORD_0:texcoord}) }, indices, material, mode: 4, extensions: { EXT_mesh_features: { featureIds: [{ featureCount: features.length, attribute: 0, propertyTable: 0, label: "entity" }] } } });
    }
    const stringProperty = (key: "entityId" | "representationId" | "kind") => {
        const encoded = features.map(feature => Buffer.from(feature[key], "utf8")), starts = new Uint32Array(encoded.length + 1);
        for (let i = 0; i < encoded.length; i++)
            starts[i + 1] = starts[i] + encoded[i].length;
        return { values: append(Buffer.concat(encoded)), stringOffsets: append(new Uint8Array(starts.buffer)) };
    };
    const properties = { entityId: stringProperty("entityId"), representationId: stringProperty("representationId"), kind: stringProperty("kind"), revision: { values: append(new Uint8Array(new Uint32Array(features.map(f => f.revision)).buffer)) } };
    const images=(["plaster","mineral","paving"] as const).map(kind=>({bufferView:append(materialTexture(kind)),mimeType:"image/png",name:`Generated ${kind} microtexture`}));
    const doc = { asset: { version: "2.0", generator: "3d-ulpin shared scene compiler" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }], buffers: [{ byteLength: offset }], bufferViews, accessors,
        images,samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],textures:images.map((_,index)=>({sampler:0,source:index})),
        materials: materials.map((m,index) => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: m.color, roughnessFactor: m.roughness, metallicFactor: m.metallic,...(materialTextureProfile(index)?{baseColorTexture:{index:materialTextureProfile(index)!.texture}}:{}) }, doubleSided: false })),
        extensionsUsed: ["EXT_mesh_features", "EXT_structural_metadata"], extensions: { EXT_structural_metadata: { schema: { id: "ulpin-safe-features", classes: { feature: { properties: { entityId: { type: "STRING" }, representationId: { type: "STRING" }, kind: { type: "STRING" }, revision: { type: "SCALAR", componentType: "UINT32" } } } } }, propertyTables: [{ class: "feature", count: features.length, properties }] } } };
    const json = Buffer.from(JSON.stringify(doc)), jp = (4 - json.length % 4) % 4, jsonChunk = Buffer.concat([json, Buffer.alloc(jp, 32)]), bin = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
    const jh = Buffer.alloc(8);
    jh.writeUInt32LE(jsonChunk.length, 0);
    jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(bin.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jh, jsonChunk, bh, bin]);
}
