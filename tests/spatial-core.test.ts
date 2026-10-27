import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  validateSpatialSnapshot, validateGeometry, measureRepresentation, metricTopologyIssue,
  enuToEcef, transformPoint, stableEncode, type SpatialSnapshot, type SpatialRepresentation,
} from "../packages/contracts/src/index";
import { calibrationSnapshot } from "./fixtures/calibration-snapshot";
import { compileSpatialSnapshot } from "@ulpin/server/modules/spatial/scene/compile";
import { buildMeshes } from "@ulpin/server/modules/spatial/scene/architecture";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const rectangle = (x: number, y: number, w: number, h: number) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]] as const;
const small = (): SpatialSnapshot => {
  const snapshot = calibrationSnapshot("garden");
  const ids = new Set([snapshot.entities.find(e => e.kind === "building")!.id, snapshot.entities.find(e => e.kind === "terrain")!.id]);
  return { ...snapshot, entities: snapshot.entities.filter(e => ids.has(e.id)), representations: snapshot.representations.filter(r => ids.has(r.entityId)), relations: [] };
};
const buildingRep = (s: SpatialSnapshot) => s.representations.find(r => r.entityId === s.entities.find(e => e.kind === "building")!.id)!;
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const unglb = (bytes: Buffer) => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()), bin: bytes.subarray(28 + jsonLength) };
};
const view = (doc: ReturnType<typeof unglb>, index: number) => {
  const v = doc.json.bufferViews[index]; return doc.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
};
function propertyStrings(doc: ReturnType<typeof unglb>, name: string): string[] {
  const table = doc.json.extensions.EXT_structural_metadata.propertyTables[0], property = table.properties[name];
  const data = view(doc, property.values), offsets = view(doc, property.stringOffsets);
  return Array.from({ length: table.count }, (_, n) => data.subarray(offsets.readUInt32LE(n * 4), offsets.readUInt32LE((n + 1) * 4)).toString());
}

test("both calibration datasets use the same validated zero-document contract", () => {
  for (const kind of ["garden", "dense"] as const) {
    const s = calibrationSnapshot(kind); validateSpatialSnapshot(s);
    assert.equal(s.attachments.length, 0); assert.equal(s.worldState, "synthetic");
    assert.equal(s.entities.filter(e => e.kind === "building").length, kind === "garden" ? 60 : 120);
    assert.ok(s.entities.some(e => e.areaIds.length === 2));
  }
});
test("geometry input rejects silently dropped Z/M and non-finite positions", () => {
  assert.throws(() => validateGeometry({ type: "Point", coordinates: [1, 2, 3] }), /two finite/);
  assert.throws(() => validateGeometry({ type: "Point", coordinates: [1, NaN] }), /finite/);
  assert.throws(() => validateGeometry({ type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1]]] }), /closed/);
});
test("schema rejects cross-world entities and duplicate identities", () => {
  const s: any = clone(small()); s.entities[0].worldId = "another-world";
  assert.throws(() => validateSpatialSnapshot(s), /cross-world/);
  const t: any = clone(small()); t.entities.push(clone(t.entities[0]));
  assert.throws(() => validateSpatialSnapshot(t), /duplicate/);
});
test("schema rejects unrelated geometry links, stale evidence and inferred architecture", () => {
  const s: any = clone(small()); s.representations[0].entityId = "missing";
  assert.throws(() => validateSpatialSnapshot(s), /representation/);
  const t: any = clone(small()); t.representations[0].evidence[0].sourceRevision = 44;
  assert.throws(() => validateSpatialSnapshot(t), /stale source/);
  const u: any = clone(small()); u.worldState = "observed";
  assert.throws(() => validateSpatialSnapshot(u), /synthetic world/);
});
test("vertical mismatch, duplicate memberships and containment cycles are rejected", () => {
  const s: any = clone(small()); s.representations[0].vertical.reference = "different";
  assert.throws(() => validateSpatialSnapshot(s), /mismatch/);
  const t: any = clone(small()); t.entities[0].areaIds = ["A", "A"];
  assert.throws(() => validateSpatialSnapshot(t), /membership/);
  const u: any = clone(small()); const [a,b] = u.entities;
  u.relations = [{ id:"r1",fromId:a.id,toId:b.id,kind:"part_of" },{ id:"r2",fromId:b.id,toId:a.id,kind:"part_of" }];
  assert.throws(() => validateSpatialSnapshot(u), /cycle/);
});
test("polygon holes and vertical bounds produce independently specified quantities", () => {
  const s = small(), rep: SpatialRepresentation = { ...buildingRep(s), geometry: { type: "Polygon", coordinates: [rectangle(0,0,10,10),rectangle(2,2,2,2)] }, vertical: { lower: -1, upper: 2, reference: s.frames[0].verticalReference! } };
  assert.equal(measureRepresentation(rep, s.frames[0], "horizontal_area").value, 96);
  assert.equal(measureRepresentation(rep, s.frames[0], "prism_volume").value, 288);
});
test("large metric coordinate translation does not destroy area precision", () => {
  const s = small(), rep = { ...buildingRep(s), geometry: { type:"Polygon" as const, coordinates:[rectangle(8000000,9000000,10,8)] } };
  assert.equal(measureRepresentation(rep,s.frames[0],"horizontal_area").value,80);
});
test("unqualified roles, frames and vertical references cannot claim measurements", () => {
  const s=small(),rep=buildingRep(s);
  assert.equal(measureRepresentation({...rep,role:"display_only"},s.frames[0],"horizontal_area").value,null);
  assert.equal(measureRepresentation({...rep,role:"unspecified"},s.frames[0],"horizontal_area").value,null);
  assert.equal(measureRepresentation(rep,{...s.frames[0],id:"foreign"},"horizontal_area").value,null);
  assert.equal(measureRepresentation({...rep,vertical:null},s.frames[0],"prism_volume").value,null);
});
test("invalid self-crossing rings and external/overlapping holes do not yield plausible areas", () => {
  assert.match(metricTopologyIssue({type:"Polygon",coordinates:[[[0,0],[4,4],[0,4],[4,0],[0,0]]]})!,/intersect/);
  assert.match(metricTopologyIssue({type:"Polygon",coordinates:[rectangle(0,0,4,4),rectangle(6,6,1,1)]})!,/inside/);
  assert.match(metricTopologyIssue({type:"Polygon",coordinates:[rectangle(0,0,10,10),rectangle(2,2,4,4),rectangle(3,3,2,2)]})!,/holes/);
  assert.match(metricTopologyIssue({type:"MultiPolygon",coordinates:[[rectangle(0,0,4,4)],[rectangle(1,1,1,1)]]})!,/Overlapping/);
});
test("ENU basis and anchor transform to known WGS84 equatorial ECEF coordinates", () => {
  const f = {...small().frames[0], anchor:{longitude:0,latitude:0,ellipsoidHeight:0,provenance:"synthetic test"}};
  const m=enuToEcef(f);
  assert.deepEqual(transformPoint(m,[0,0,0]),[6378137,0,0]);
  assert.deepEqual(transformPoint(m,[10,0,0]),[6378137,10,0]);
  assert.deepEqual(transformPoint(m,[0,10,0]),[6378137,0,10]);
  assert.deepEqual(transformPoint(m,[0,0,10]),[6378147,0,0]);
});
test("unknown global anchor and invalid transforms fail rather than place at 0,0", () => {
  const f={...small().frames[0],anchor:undefined};
  assert.throws(()=>enuToEcef(f),/placement/);
  assert.throws(()=>transformPoint([1,2],[1,2,3]),/transform/);
});
test("compiler produces actual 3D Tiles/GLB with source-neutral canonical metadata", () => {
  const s=small(),p=compileSpatialSnapshot(s,"/test");
  assert.equal((p.manifest.asset as any).version,"1.1");assert.ok(p.assets.size>=3);
  for(const [name,bytes] of p.assets){
    const doc=unglb(bytes);assert.equal(doc.json.asset.version,"2.0");assert.ok(doc.json.meshes[0].primitives.length);
    assert.ok(propertyStrings(doc,"entityId").every(id=>s.entities.some(e=>e.id===id)));
    assert.ok(!bytes.includes(Buffer.from("sourceRevision")));assert.ok(!bytes.includes(Buffer.from("occupant")));
    for(const primitive of doc.json.meshes[0].primitives){
      const index=primitive.attributes.POSITION,ac=doc.json.accessors[index],bv=view(doc,ac.bufferView);
      for(let n=0;n<bv.length;n+=4)assert.ok(Number.isFinite(bv.readFloatLE(n)),name);
      assert.ok(primitive.extensions.EXT_mesh_features.featureIds[0].propertyTable===0);
    }
  }
});
test("compiler output survives input ordering, and never mutates its input", () => {
  const a=small(),before=stableEncode(a),p=compileSpatialSnapshot(a,"/test");
  const b={...a,entities:[...a.entities].reverse(),representations:[...a.representations].reverse()};
  const q=compileSpatialSnapshot(b,"/test");assert.equal(p.id,q.id);
  assert.deepEqual([...p.assets].map(([k,v])=>[k,sha(v)]),[...q.assets].map(([k,v])=>[k,sha(v)]));
  assert.equal(stableEncode(a),before);
});
test("unknown-height footprint styling preserves its flat surface and courtyard hole", () => {
  const s=small(),entity=s.entities.find(e=>e.kind==="building")!;
  const representation:SpatialRepresentation={...buildingRep(s),role:"display_only",geometry:{type:"Polygon",coordinates:[rectangle(0,0,10,8),[...rectangle(2,2,3,2)].reverse()]},vertical:{lower:.08,upper:.08,reference:s.frames[0].verticalReference!}};
  const before=stableEncode(representation),meshes=buildMeshes([{entity,representation}],true),fill=meshes.get(16)!;
  assert.ok(fill);assert.deepEqual([...meshes.keys()],[16,17]);
  let area=0;
  for(let i=0;i<fill.indices.length;i+=3){
    const [a,b,c]=fill.indices.slice(i,i+3).map(index=>fill.positions.slice(index*3,index*3+3));
    assert.equal(a[1],.08);assert.equal(b[1],.08);assert.equal(c[1],.08);
    area+=Math.abs((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/2;
  }
  assert.equal(area,74);assert.equal(stableEncode(representation),before);
});
test("optional document links do not change mesh bytes or measured geometry", () => {
  const a=small();const b={...a,attachments:[{id:"new-attachment",entityId:a.entities[0].id,sourceId:a.sources[0].id,sourceRevision:a.sources[0].revision,purpose:"context" as const}]};
  const p=compileSpatialSnapshot(a,"/test"),q=compileSpatialSnapshot(b,"/test");
  assert.equal(p.id,q.id);assert.equal(sha(p.assets.get("context.glb")!),sha(q.assets.get("context.glb")!));
  assert.deepEqual(measureRepresentation(buildingRep(a),a.frames[0],"prism_volume"),measureRepresentation(buildingRep(b),b.frames[0],"prism_volume"));
});
test("a new snapshot revision produces a different immutable publication", () => {
  const a=small(),b={...a,revision:2};assert.notEqual(compileSpatialSnapshot(a,"/test").id,compileSpatialSnapshot(b,"/test").id);
});
test("a building-only compilation does not emit an invalid empty context GLB", () => {
  const s=small(),building=s.entities.find(e=>e.kind==="building")!;
  const p=compileSpatialSnapshot({...s,entities:[building],representations:s.representations.filter(r=>r.entityId===building.id)},"/test");
  assert.ok(!p.assets.has("context.glb"));assert.equal((p.manifest.root as any).content,undefined);
});
test("compiler rejects unresolved height and oversized local render coordinates", () => {
  const s:any=clone(small());s.representations[1].vertical=null;assert.throws(()=>compileSpatialSnapshot(s,"/test"),/Unresolved/);
  const t:any=clone(small());t.representations[1].geometry={type:"Polygon",coordinates:[rectangle(6000,0,10,10)]};assert.throws(()=>compileSpatialSnapshot(t,"/test"),/5 km/);
});
test("coarse and detailed tile features share canonical IDs and exclude source details", () => {
  const p=compileSpatialSnapshot(small(),"/test");
  for(const [name,bytes]of p.assets){if(!name.endsWith("-coarse.glb"))continue;const detailed=p.assets.get(name.replace("-coarse","-detail"))!;assert.deepEqual(propertyStrings(unglb(bytes),"entityId"),propertyStrings(unglb(detailed),"entityId"));assert.ok(detailed.length>bytes.length);}
});
