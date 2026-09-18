import assert from "node:assert/strict";
import test from "node:test";
import {CoreContractError,measureCoreRepresentation} from "../packages/contracts/src";
import {normalizeLegacySpatialSlice} from "../apps/web/features/spatial/data/core-legacy-adapter";
import {legacySliceFixture,LEGACY_IDS} from "./fixtures/core-legacy";

// Workspace ESM/CJS consumers can have distinct constructor identities. The
// published error name/code is the boundary contract, not a realm-local instanceof.
const failure=(code:string)=>(error:unknown)=>error instanceof Error&&error.name==="CoreContractError"&&"code" in error&&error.code===code;
test("legacy physical, registered and source identities retain their actual namespaces/revisions",async()=>{
  const input=legacySliceFixture(),before=JSON.stringify(input),result=await normalizeLegacySpatialSlice(input,"synthetic");
  assert.equal(JSON.stringify(input),before);
  const entities=result.input.identity.entities;
  assert.equal(entities.filter(e=>e.ref.id===LEGACY_IDS.building).length,2);
  assert(entities.some(e=>e.ref.namespace==="physical"&&e.revision===2));
  assert(entities.some(e=>e.ref.namespace==="registry"&&e.revision===3));
  assert(result.input.identity.relations.some(r=>r.kind==="recorded_by"&&r.from.namespace!==r.to.namespace));
  const original=result.input.sources.sources.find(s=>s.ref.id===LEGACY_IDS.source)!;
  assert.equal(original.familyOrdinal,7);assert.equal(original.revision,1);
  assert.equal(result.input.sources.assets.find(a=>a.ref.id===LEGACY_IDS.source)!.sha256,"a".repeat(64));
  assert.equal(result.input.sources.assets.find(a=>a.ref.id===LEGACY_IDS.source)!.bytes,1200);
  assert(result.legacy.locators.some(l=>JSON.stringify(l.legacy).includes('/features/0')));
  assert(!JSON.stringify(result).includes("NEVER_COPY_RAW_PROPERTIES"));
});
test("one entity keeps local and geographic representations without duplicate or competing identity",async()=>{
  const result=await normalizeLegacySpatialSlice(legacySliceFixture(),"synthetic");
  const reps=result.snapshot.geometry.representations.filter(r=>r.entity.namespace==="physical");
  assert.equal(reps.length,2);assert.equal(reps[0].entity.id,reps[1].entity.id);
  const local=reps.find(r=>r.ref.id.includes(":local:"))!;
  const quantity=measureCoreRepresentation(result.snapshot.geometry,result.input.identity,result.input.sources,result.input.frames,{representation:{ref:local.ref,revision:local.revision},definition:"horizontal_area"});
  assert.equal(quantity.value,80);
  assert(result.input.resolutions.some(r=>r.purpose==="display"));assert(result.input.resolutions.some(r=>r.purpose==="analysis"));
});
test("recorded flat uses the stored frame and exact existing bounds",async()=>{
  const result=await normalizeLegacySpatialSlice(legacySliceFixture(),"synthetic"),unit=result.snapshot.geometry.representations.find(r=>r.entity.id===LEGACY_IDS.unit)!;
  const quantity=measureCoreRepresentation(result.snapshot.geometry,result.input.identity,result.input.sources,result.input.frames,{representation:{ref:unit.ref,revision:unit.revision},definition:"prism_volume"});
  assert.equal(quantity.value,120);
  assert(result.input.identity.relations.some(r=>r.kind==="occupies_level"&&r.to.id===LEGACY_IDS.level));
});
test("height alone is not invented as an absolute zero-to-height prism",async()=>{
  const result=await normalizeLegacySpatialSlice(legacySliceFixture(),"synthetic");
  assert(result.snapshot.geometry.representations.filter(r=>r.entity.namespace==="physical").every(r=>r.geometry.profile==="planar"));
  assert(result.diagnostics.some(d=>d.code==="HEIGHT_NOT_VERTICAL_PLACEMENT"));
});
test("revision zero remains representable when explicitly supplied by a compatible source",async()=>{
  const x=legacySliceFixture();x.features[0].revision=0;x.features[0].body.revision=0;x.records[0].revision=0;
  const result=await normalizeLegacySpatialSlice(x,"synthetic");
  assert(result.input.identity.entities.filter(e=>e.ref.id===LEGACY_IDS.building).every(e=>e.revision===0));
});
test("unknown original metadata preserves source ID without fabricating bytes or a file locator",async()=>{
  const x=legacySliceFixture();x.sources=[];
  const result=await normalizeLegacySpatialSlice(x,"synthetic");
  assert.equal(result.input.sources.assets.length,0);
  assert(result.input.sources.sources.some(s=>s.ref.id===LEGACY_IDS.source&&s.familyOrdinal===null));
  assert(result.diagnostics.some(d=>d.code==="SOURCE_METADATA_UNAVAILABLE"));
  assert.equal(result.snapshot.geometry.representations.filter(r=>r.entity.namespace==="physical").length,2);
});
test("unqualified registry datum keeps footprint without claiming volume",async()=>{
  const x=legacySliceFixture();x.sites[0].frame.benchmark="unknown";
  const result=await normalizeLegacySpatialSlice(x,"synthetic"),unit=result.snapshot.geometry.representations.find(r=>r.entity.id===LEGACY_IDS.unit)!;
  assert.equal(unit.geometry.profile,"planar");assert(result.diagnostics.some(d=>d.code==="REGISTRY_SOLID_PROFILE_UNQUALIFIED"));
});
test("non-synthetic does not fabricate observed registry geometry",async()=>{
  const x=legacySliceFixture();x.features[0].body.worldStatus="observed";x.records.forEach(r=>r.synthetic=false);
  const result=await normalizeLegacySpatialSlice(x,"observed");
  assert(result.snapshot.geometry.representations.every(r=>r.entity.namespace==="physical"));
  assert.equal(result.input.identity.entities.filter(e=>e.ref.namespace==="registry").length,3);
  assert(result.diagnostics.some(d=>d.code==="REGISTRY_WORLD_UNRESOLVED"));
});
test("row/body identity contradiction is an error, not a new ID",async()=>{
  const x=legacySliceFixture();x.features[0].revision=99;
  await assert.rejects(()=>normalizeLegacySpatialSlice(x,"synthetic"),failure("LEGACY_RECORD_CONFLICT"));
});
test("invalid geometry stays unavailable while its entity, source and other geometry survive",async()=>{
  const x=legacySliceFixture();x.features[0].body.geometry={type:"Polygon",coordinates:[[[0,0],[10,8],[0,8],[8,0],[0,0]]]};
  const result=await normalizeLegacySpatialSlice(x,"synthetic");
  assert(result.snapshot.geometry.representations.some(r=>r.entity.namespace==="physical"&&r.geometry.profile==="unavailable"));
  assert(result.snapshot.geometry.representations.some(r=>r.entity.namespace==="physical"&&r.geometry.profile==="planar"));
  assert(result.diagnostics.some(d=>d.code==="GEOMETRY_TOPOLOGY"));
});
test("Z/M legacy coordinates are not silently flattened",async()=>{
  const x=legacySliceFixture();x.features[0].body.geometry={type:"Polygon",coordinates:[[[0,0,1],[10,0,1],[10,8,1],[0,0,1]]]};
  const result=await normalizeLegacySpatialSlice(x,"synthetic");assert(result.diagnostics.some(d=>d.code==="GEOMETRY_PROFILE_UNSUPPORTED"));
});
test("registry XYZ rings are not silently flattened into trusted footprints",async()=>{
  const x=legacySliceFixture();(x.records[2].geometry!.footprint as number[][])[1].push(10);
  const result=await normalizeLegacySpatialSlice(x,"synthetic");
  const unit=result.snapshot.geometry.representations.find(r=>r.entity.id===LEGACY_IDS.unit)!;
  assert.equal(unit.geometry.profile,"unavailable");assert(result.diagnostics.some(d=>d.code==="GEOMETRY_PROFILE_UNSUPPORTED"));
});
test("height evidence and owner-origin metadata survive independently of display geometry",async()=>{
  const x=legacySliceFixture();x.features[0].body.height.evidence=[{sourceRevisionId:LEGACY_IDS.source,row:29}];
  const result=await normalizeLegacySpatialSlice(x,"synthetic");
  assert(result.legacy.locators.some(l=>(l.legacy as {row?:number}).row===29));
  assert.deepEqual(result.legacy.features[0].ownerReference?.origin,x.features[0].ownerReference?.origin);
});
test("shared feature keeps its original frame and identity when queried from another member area",async()=>{
  const x=legacySliceFixture(),a=await normalizeLegacySpatialSlice(x,"synthetic");
  const y=JSON.parse(JSON.stringify(x));y.area.id=LEGACY_IDS.otherArea;y.area.reference.origin=[1,2];
  const b=await normalizeLegacySpatialSlice(y,"synthetic");
  const physical=(v:typeof a)=>v.snapshot.geometry.representations.filter(r=>r.entity.namespace==="physical");
  assert.deepEqual(physical(a),physical(b));assert.notEqual(a.readDigest,b.readDigest);
});
test("record/source/order changes cannot silently masquerade as an unchanged read",async()=>{
  const x=legacySliceFixture(),a=await normalizeLegacySpatialSlice(x,"synthetic");x.area.revision++;
  const b=await normalizeLegacySpatialSlice(x,"synthetic");assert.notEqual(a.readDigest,b.readDigest);assert.equal(a.snapshot.manifest.geometryDigest,b.snapshot.manifest.geometryDigest);
});
test("equivalent legacy collections have identical read and snapshot signatures",async()=>{
  const x=legacySliceFixture(),a=await normalizeLegacySpatialSlice(x,"synthetic");
  const y=JSON.parse(JSON.stringify(x));y.records.reverse();y.sites.reverse();y.sources.reverse();y.features.reverse();
  y.records.forEach((r:any)=>{r.links.reverse();r.evidence.reverse();});y.features[0].memberAreaIds.reverse();
  const b=await normalizeLegacySpatialSlice(y,"synthetic");assert.equal(a.readDigest,b.readDigest);assert.deepEqual(a,b);
});
test("stored quantities and verification flags are retained without overriding computed geometry",async()=>{
  const x=legacySliceFixture();x.features[0].body.areaM2=81;x.records[2].geometry!.volume=121;x.records[2].geometry!.lowerVerified=false;
  const result=await normalizeLegacySpatialSlice(x,"synthetic");
  const reported=result.snapshot.geometry.reportedQuantities;
  assert(reported.some(q=>q.definition==="horizontal_area"&&q.amount.state==="known"&&q.amount.value===81));
  assert(reported.some(q=>q.definition==="prism_volume"&&q.amount.state==="known"&&q.amount.value===121));
  const local=result.snapshot.geometry.representations.find(r=>r.entity.namespace==="physical"&&r.ref.id.includes(":local:"))!;
  const q=measureCoreRepresentation(result.snapshot.geometry,result.input.identity,result.input.sources,result.input.frames,{representation:{ref:local.ref,revision:local.revision},definition:"horizontal_area"});
  assert.equal(q.value,80);
  assert.equal(result.legacy.records.find(r=>r.ref.id===LEGACY_IDS.unit)!.geometryQuality!.lowerVerified,false);
});
