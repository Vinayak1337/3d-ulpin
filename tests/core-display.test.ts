import assert from "node:assert/strict";
import test from "node:test";
import {inflateSync} from "node:zlib";
import {normalizeLegacySpatialSlice} from "../apps/web/features/spatial/data/core-legacy-adapter";
import {displayProjector,projectCoreNeighbourhood,DISPLAY_REFERENCE} from "../apps/web/features/spatial/data/core-display";
import {compileSpatialSnapshot} from "../apps/web/features/spatial/compiler/compile";
import {materialTexture} from "../apps/web/features/spatial/compiler/texture";
import {handleNeighbourhoodScene,NeighbourhoodSceneCache} from "../apps/web/lib/server/spatial-core-scene";
import {legacySliceFixture} from "./fixtures/core-legacy";
import {measureRepresentation} from "../packages/contracts/src";

test("normalised saved geometry feeds the existing compiler without becoming analytical authority",async()=>{
  const normalized=await normalizeLegacySpatialSlice(legacySliceFixture(),"synthetic"),before=JSON.stringify(normalized),view=projectCoreNeighbourhood(normalized);
  assert.equal(view.items.length,1);assert.equal(view.items[0].canonicalRef.namespace,"physical");assert.equal(view.items[0].horizontalArea,80);
  assert.equal(view.snapshot.frames[0].verticalReference,DISPLAY_REFERENCE);
  assert(view.snapshot.representations.every(r=>r.role==="display_only"));
  assert.equal(measureRepresentation(view.snapshot.representations[0],view.snapshot.frames[0],"horizontal_area").value,null);
  const compiled=compileSpatialSnapshot(view.snapshot,"/test");assert(compiled.assets.size>=3);assert(compiled.summary.renderedEntities>=2);
  assert.equal(JSON.stringify(normalized),before);assert.equal(view.items[0].hasPlacedInteriors,false);
  assert(!JSON.stringify(view).includes("SECRET_OWNER"));
});
test("unknown source height produces selectable flat geometry, not invented levels",async()=>{
  const input=legacySliceFixture();input.features[0].body.height.value=null;delete input.features[0].body.verticalExtent;
  const data=await normalizeLegacySpatialSlice(input,"synthetic"),view=projectCoreNeighbourhood(data);
  assert.equal(view.items[0].height,null);assert.equal(view.items[0].renderStatus,"footprint");assert.equal(view.items[0].prismVolume,null);
  const rep=view.snapshot.representations.find(r=>r.entityId===view.items[0].id)!;assert.equal(rep.vertical!.upper,rep.vertical!.lower);
  const publication=compileSpatialSnapshot(view.snapshot,"/test");const bytes=[...publication.assets].find(([name])=>name.endsWith("-detail.glb"))![1];assert(bytes.length>1000);
});
test("recorded road centerlines survive the display projection without becoming road surfaces",async()=>{
  const input=legacySliceFixture(),entry=input.features[0],id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const coordinates:[number,number][]=[[77,28],[77.0001,28.00005],[77.0002,28.00005]];
  input.features=[{...entry,id,recordId:null,body:{...entry.body,id,kind:"road",name:"Recorded road centerline",geometryRole:"unknown",geometry:{type:"LineString",coordinates:[[0,0],[10,5],[20,5]]},geographicGeometry:{type:"LineString",coordinates},height:{...entry.body.height,value:null,state:"unknown"}}}];
  const normalized=await normalizeLegacySpatialSlice(input,"synthetic"),before=JSON.stringify(normalized),view=projectCoreNeighbourhood(normalized);
  assert.equal(view.items.length,1);assert.equal(view.items[0].canonicalRef.id,id);assert.equal(view.items[0].renderStatus,"alignment");
  const rep=view.snapshot.representations.find(r=>r.entityId===view.items[0].id)!,frame=view.snapshot.frames[0],project=displayProjector(frame.anchor!.longitude,frame.anchor!.latitude);
  assert.deepEqual(rep.geometry,{type:"LineString",coordinates:coordinates.map(project)});assert.equal(rep.role,"display_only");
  assert.equal(rep.vertical!.lower,rep.vertical!.upper);assert.equal(view.items[0].prismVolume,null);
  assert(view.notices.some(notice=>notice.includes("does not establish physical width")));assert(!view.notices.some(notice=>notice.includes("needs review")));
  assert(compileSpatialSnapshot(view.snapshot,"/test").assets.has("context.glb"));assert.equal(JSON.stringify(normalized),before);
});
test("only explicit source floor counts drive synthetic detail and unknown states stay flat",async()=>{
  const input=legacySliceFixture();input.features[0].body.semantics={...input.features[0].body.semantics,floorCount:3};
  const view=projectCoreNeighbourhood(await normalizeLegacySpatialSlice(input,"synthetic"));
  assert.equal(view.snapshot.representations[0].appearance?.storeys,3);assert.equal(view.snapshot.representations[0].appearance?.envelopeOnly,true);
  input.features[0].body.height.state="unknown";
  const unknown=projectCoreNeighbourhood(await normalizeLegacySpatialSlice(input,"synthetic"));assert.equal(unknown.items[0].height,null);assert.equal(unknown.snapshot.representations[0].appearance,undefined);
});
test("display-local conversion has independent equatorial answers and explicit domain limits",()=>{
  const project=displayProjector(0,0);assert.deepEqual(project([0,0]),[0,0]);
  const east=project([180/Math.PI/6378137,0]);assert(Math.abs(east[0]-1)<1e-8&&Math.abs(east[1])<1e-8);
  assert.throws(()=>project([180,90]),/profile/);assert.throws(()=>project([NaN,0]),/Invalid/);
});
test("display projection rejects wide/missing geographic coverage rather than guessing a map",async()=>{
  const data=await normalizeLegacySpatialSlice(legacySliceFixture(),"synthetic");
  const changed:any=JSON.parse(JSON.stringify(data));changed.snapshot.geometry.representations=changed.snapshot.geometry.representations.filter((r:any)=>r.frame?.ref.id!=="legacy:CRS84");
  assert.throws(()=>projectCoreNeighbourhood(changed),/geographic footprint/);
});
test("explicit source credits survive generic dataset namespaces",async()=>{
  const input=legacySliceFixture();input.features[0].body.properties={...input.features[0].body.properties,attribution:"Google Research Open Buildings; OpenStreetMap contributors",license:"ODbL-1.0"};
  const data=await normalizeLegacySpatialSlice(input,"synthetic"),view=projectCoreNeighbourhood(data);
  assert.deepEqual(view.attributions,["google","osm"]);assert.equal(data.legacy.features[0].license,"ODbL-1.0");
});
test("generated material PNGs have deterministic pixels, valid bounded image structure and no scene imagery",()=>{
  for(const kind of ["plaster","mineral","paving"] as const){
    const bytes=materialTexture(kind);assert.deepEqual(bytes,materialTexture(kind));assert.equal(bytes.subarray(1,4).toString(),"PNG");assert.equal(bytes.readUInt32BE(16),128);assert.equal(bytes.readUInt32BE(20),128);
    const compressed:Buffer[]=[];let offset=8;while(offset<bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.subarray(offset+4,offset+8).toString();if(type==="IDAT")compressed.push(bytes.subarray(offset+8,offset+8+length));offset+=length+12;}
    assert.equal(inflateSync(Buffer.concat(compressed)).length,128*(128*3+1));assert(bytes.length<60000);
  }
});
test("derived scene cache isolates area/world/digest and evicts expired entries",async()=>{
  const view=projectCoreNeighbourhood(await normalizeLegacySpatialSlice(legacySliceFixture(),"synthetic")),pub=compileSpatialSnapshot(view.snapshot,"/test");let now=1000;
  const cache=new NeighbourhoodSceneCache(10*1024*1024,()=>now);cache.put(view.areaId,"synthetic",view.readDigest,view,pub);
  assert(cache.get(view.areaId,"synthetic",view.readDigest));assert.equal(cache.get(view.areaId,"observed",view.readDigest),null);
  now+=21*60*1000;assert.equal(cache.get(view.areaId,"synthetic",view.readDigest),null);assert.equal(cache.size,0);
  assert.throws(()=>new NeighbourhoodSceneCache(100).put(view.areaId,"synthetic",view.readDigest,view,pub),/budget/);
});
test("unbounded decorative work is rejected before mesh allocation",async()=>{
  const view=projectCoreNeighbourhood(await normalizeLegacySpatialSlice(legacySliceFixture(),"synthetic"));
  const snapshot:any=JSON.parse(JSON.stringify(view.snapshot)),rep=snapshot.representations[0];
  rep.geometry={type:"Polygon",coordinates:[[[-1000,-1000],[1000,-1000],[1000,1000],[-1000,1000],[-1000,-1000]]]};
  rep.vertical.upper=300;rep.appearance={facade:"schematic",storeys:100};
  assert.throws(()=>compileSpatialSnapshot(snapshot,"/test"),/facade work budget/);
});
test("derived asset boundary rejects external hosts and traversal before database access",async()=>{
  const areaId="0ded05d3-b596-46a8-9918-ab1bc0a433be";
  assert.equal((await handleNeighbourhoodScene(new Request("http://untrusted.example/x"),areaId,["synthetic","descriptor.json"])).status,403);
  assert.equal((await handleNeighbourhoodScene(new Request("http://localhost/x"),areaId,["synthetic","0".repeat(64),"0".repeat(64),"../secret"])).status,404);
  assert.equal((await handleNeighbourhoodScene(new Request("http://localhost/x"),"bad-id",["synthetic","descriptor.json"])).status,400);
});
