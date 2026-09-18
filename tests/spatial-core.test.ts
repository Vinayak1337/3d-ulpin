import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  validateSpatialSnapshot, validateGeometry, measureRepresentation, metricTopologyIssue,
  enuToEcef, transformPoint, stableEncode, type SpatialSnapshot, type SpatialRepresentation,
  type AreaContext, type PhysicalFeature,
} from "../packages/contracts/src/index";
import { calibrationSnapshot } from "../apps/web/features/spatial/data/calibration";
import { compileSpatialSnapshot } from "../apps/web/features/spatial/compiler/compile";
import { adaptAreaContext } from "../apps/web/features/spatial/data/legacy-adapter";
import { ResourceCache } from "../apps/web/features/spatial/data/resource-cache";
import { MapSessions } from "../apps/web/features/spatial/data/session";

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

const deferred = <T>() => { let resolve!: (value:T)=>void, reject!: (reason:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test("shared resource acquisition deduplicates requests across panels", async () => {
  const cache=new ResourceCache(),d=deferred<object>();let calls=0;
  const loader=()=>{calls++;return d.promise;};const release1=cache.acquire("/same",loader),release2=cache.acquire("/same",loader);
  assert.equal(calls,1);d.resolve({id:"B1"});await tick();assert.deepEqual(cache.read("/same").data,{id:"B1"});
  release1();release2();await tick();cache.dispose();
});
test("mutation replacement cannot be overwritten by an older in-flight GET", async () => {
  const cache=new ResourceCache(),d=deferred<object>();const release=cache.acquire("/same",()=>d.promise);
  cache.replace("/same",{revision:2});d.resolve({revision:1});await tick();assert.deepEqual(cache.read("/same").data,{revision:2});release();cache.dispose();
});
test("forced reload cancels older requests even when loaders ignore AbortSignal", async () => {
  const cache=new ResourceCache(),first=deferred<string>(),second=deferred<string>();let calls=0,signals:AbortSignal[]=[];
  const release=cache.acquire("/key",signal=>{signals.push(signal);return ++calls===1?first.promise:second.promise;});
  const done=cache.load("/key",true);assert.equal(signals[0].aborted,true);second.resolve("new");await done;first.resolve("old");await tick();assert.equal(cache.read("/key").data,"new");release();cache.dispose();
});
test("the final consumer release cancels requests; strict-mode reacquisition does not",async()=>{
  const cache=new ResourceCache(),d=deferred<string>();let signal:AbortSignal|undefined,calls=0;
  const loader=(s:AbortSignal)=>{signal=s;calls++;return d.promise;};const release=cache.acquire("/a",loader);release();const again=cache.acquire("/a",loader);await tick();assert.equal(signal!.aborted,false);assert.equal(calls,1);
  again();await tick();assert.equal(signal!.aborted,true);d.resolve("ignored");await tick();assert.equal(cache.read("/a").data,null);cache.dispose();
});
test("request errors are explicit and inactive cache entries are bounded",async()=>{
  const cache=new ResourceCache(2);const a=cache.acquire("a",async()=>{throw new Error("unavailable");});await tick();assert.equal(cache.read("a").error,"unavailable");a();await tick();
  for(const key of ["b","c","d"]){const release=cache.acquire(key,async()=>key);await tick();release();await tick();}
  assert.ok(cache.size<=2);cache.dispose();
});
test("invalidation reloads active cached resources and publishes one current result",async()=>{
  const cache=new ResourceCache();let revision=0;const release=cache.acquire("/live",async()=>++revision);await tick();cache.invalidate();await tick();assert.equal(cache.read("/live").data,2);release();cache.dispose();
});
test("map sessions keep one selection across panels and isolate different worlds",()=>{
  const sessions=new MapSessions();let calls=0;const unsubscribe=sessions.subscribe("world",()=>calls++);
  sessions.patch("world",{selection:{entityId:"B1"},mode:"2d"});assert.equal(sessions.get("world").selection?.entityId,"B1");assert.equal(sessions.get("world").mode,"2d");assert.equal(sessions.get("other").selection,null);assert.equal(calls,1);unsubscribe();
});
test("map camera snapshots are copied and invalid state is rejected",()=>{
  const sessions=new MapSessions();const camera={longitude:0,latitude:0,height:100,heading:0,pitch:-1,roll:0};sessions.patch("s",{camera});camera.height=999;assert.equal(sessions.get("s").camera?.height,100);assert.throws(()=>sessions.patch("s",{camera:{...camera,latitude:99}}),/Invalid/);
});
const legacyContext=():AreaContext=>({
  area:{id:"area",siteId:"site",revision:1,name:"Area",reference:{sourceCrs:"EPSG:4326",analysisCrs:"EPSG:32643",origin:[0,0],anchor:[77,28],transformVersion:"v1",verticalReference:"unresolved"},extent:[0,0,10,8],geographicExtent:[77,28,77.001,28.001],administrativeUnits:[]},packages:[],latestCheck:null,
  features:[{id:"B",identifier:"0000123",name:"Building",kind:"building",areaId:"owner-area",revision:4,sourceKey:"source-B",sourceRevisionId:"source-revision-id",datasetNamespace:"dataset",worldStatus:"observed",geometryRole:"observed_ground_occupation",geometry:{type:"Polygon",coordinates:[rectangle(0,0,10,8)]},geographicGeometry:{type:"Polygon",coordinates:[rectangle(77,28,.001,.001)]},sourceGeometry:{type:"Polygon",coordinates:[rectangle(77,28,.001,.001)]},height:{value:8,state:"source_supported",unit:"m",meaning:"height",reference:"local-unknown-ground"},properties:{resident:"DO NOT PROJECT THIS FIELD"},evidence:[],areaM2:80,representation:"physical_exterior"} as PhysicalFeature],
});
test("legacy adapter preserves IDs, source revision identity, coordinate meaning and memberships",()=>{
  const c=legacyContext(),before=stableEncode(c),{snapshot:s}=adaptAreaContext(c,"observed");assert.equal(s.entities[0].id,"B");assert.equal(s.entities[0].identifiers[0].value,"0000123");assert.deepEqual(s.entities[0].areaIds,["owner-area","area"]);assert.equal(s.sources[0].revision,null);assert.equal(s.sources[0].id,"source-revision-id");assert.equal(s.representations.length,2);assert.equal(s.frames.some(f=>f.anchor),false);assert.ok(s.representations.every(r=>r.vertical===null));assert.ok(!JSON.stringify(s).includes("DO NOT PROJECT"));assert.equal(stableEncode(c),before);
});
test("legacy adapter filters worlds and never guesses unknown geometry meaning",()=>{
  const c=legacyContext();assert.equal(adaptAreaContext(c,"synthetic").snapshot.entities.length,0);
  delete c.features[0].geometryRole;const {snapshot:s,diagnostics}=adaptAreaContext(c,"observed");assert.equal(s.representations[0].role,"unspecified");assert.ok(diagnostics.some(d=>d.code==="geometry_meaning_unresolved"));
});
test("only the shared runtime constructs Cesium viewers; compatibility components delegate",async()=>{
  const root=path.resolve("apps/web");const found:string[]=[];
  async function scan(dir:string){for(const item of await readdir(dir,{withFileTypes:true})){if(["node_modules",".next","public"].includes(item.name))continue;const file=path.join(dir,item.name);if(item.isDirectory())await scan(file);else if(/\.(tsx?|m?js)$/.test(file)&&/new Cesium\.Viewer\s*\(/.test(await readFile(file,"utf8")))found.push(path.relative(root,file));}}
  await scan(root);assert.deepEqual(found,["features/spatial/engine/runtime.ts"]);
  for(const file of ["AreaViewer.tsx","SpatialViewer.tsx"]){assert.match(await readFile(path.join(root,"components",file),"utf8"),/MapViewport/);}
  assert.match(await readFile(path.join(root,"features/officer/shared/hooks.ts"),"utf8"),/useSharedResource as useResource/);
});
