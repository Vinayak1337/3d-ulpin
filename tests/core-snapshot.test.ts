import assert from "node:assert/strict";
import test from "node:test";
import {CoreContractError,buildCoreSnapshot,canonicalCoreText,coreInputDigest,measureCoreRepresentation,validateCorePublicationCandidate} from "../packages/contracts/src/spatial/core";
import {publicationCases,signatureCases,snapshotCases,snapshotFixture,snapshotRef} from "./fixtures/core-snapshot";

const failure=(code:string)=>(error:unknown)=>error instanceof CoreContractError&&error.code===code;
for(const row of signatureCases)test(`signature oracle: ${row.id}`,async()=>{
  assert.equal(canonicalCoreText(row.value),row.expectedEncoding);assert.equal(await coreInputDigest(row.value),row.expectedDigest);
});
test("publication corpus enforces compatibility without pretending bytes were checked",async()=>{
  for(const row of await publicationCases()){
    if(row.valid)validateCorePublicationCandidate(row.snapshot,row.candidate);
    else assert.throws(()=>validateCorePublicationCandidate(row.snapshot,row.candidate),failure(row.code!));
  }
});
for(const row of snapshotCases())test(`snapshot corpus: ${row.id}`,async()=>{
  const x:any=row.input,before=JSON.stringify(x);
  if(!row.valid)await assert.rejects(()=>buildCoreSnapshot(x),failure(row.code!));
  else{
    const result=await buildCoreSnapshot(x);
    assert.deepEqual(result.geometry.representations.map(r=>r.ref.id),row.representationIds);
    assert.equal(result.manifest.state,"candidate");assert.equal(result.manifest.retainedObservations.length,x.observations.filter((o:any)=>o.world.ref.id===x.context.world.ref.id).length);
    if(row.reportedIds)assert.deepEqual(result.geometry.reportedQuantities.map(q=>q.ref.id).sort(),row.reportedIds);
    if(row.volume!==undefined){const q=measureCoreRepresentation(result.geometry,x.identity,x.sources,x.frames,{representation:snapshotRef("representation","exterior"),definition:"prism_volume"});assert.equal(q.value,row.volume);}
    if(row.unavailable)assert(result.results.some(r=>r.reasonCode===row.unavailable));
    if(row.temporalCoverage)assert(result.results.every(r=>r.temporalCoverage===row.temporalCoverage));
    assert.match(result.manifest.inputDigest,/^[a-f0-9]{64}$/);assert.match(result.manifest.geometryDigest,/^[a-f0-9]{64}$/);
  }
  assert.equal(JSON.stringify(x),before);
});
test("source-record ordering does not change the selected geometry or signatures",async()=>{
  const x:any=snapshotFixture(),a=await buildCoreSnapshot(x);
  for(const key of ["observations","resolutions","compositions","worlds"])x[key].reverse();
  for(const key of ["assets","sources","parts"])x.sources[key].reverse();
  x.identity.entities.reverse();x.geometry.representations.reverse();x.resolutions.forEach((r:any)=>r.candidates.reverse());
  const b=await buildCoreSnapshot(x);assert.deepEqual(b,a);
});
test("evidence-only names invalidate input state but not mesh dependencies",async()=>{
  const x:any=snapshotFixture(),a=await buildCoreSnapshot(x);x.sources.sources[0].label="Renamed optional source";
  const b=await buildCoreSnapshot(x);assert.notEqual(a.manifest.inputDigest,b.manifest.inputDigest);assert.equal(a.manifest.geometryDigest,b.manifest.geometryDigest);
});
test("scope isolation survives identical geometry",async()=>{
  const x:any=snapshotFixture(),a=await buildCoreSnapshot(x);x.context.scope.id="different-authorized-principal";
  const b=await buildCoreSnapshot(x);assert.notEqual(a.manifest.inputDigest,b.manifest.inputDigest);assert.equal(a.manifest.geometryDigest,b.manifest.geometryDigest);
});
test("changed geometry, mapping and units change the relevant dependency keys",async()=>{
  const x:any=snapshotFixture(),a=await buildCoreSnapshot(x);x.resolutions[1].selected=snapshotRef("observation","height-nine");
  const b=await buildCoreSnapshot(x);assert.notEqual(a.manifest.inputDigest,b.manifest.inputDigest);assert.notEqual(a.manifest.geometryDigest,b.manifest.geometryDigest);
  x.frames.frames[0].horizontalUnit="ft";const c=await buildCoreSnapshot(x);assert.notEqual(b.manifest.geometryDigest,c.manifest.geometryDigest);
});
test("caller mutation during hashing cannot change the captured snapshot",async()=>{
  const x:any=snapshotFixture(),pending=buildCoreSnapshot(x);x.observations[1].payload.interval.upperMetres=100;
  const result=await pending;const rep=result.geometry.representations.find(r=>r.ref.id==="exterior")!;
  assert(rep.geometry.profile==="prism");assert.equal(rep.geometry.interval!.upperMetres,6);
  assert(result.results.every(Object.isFrozen));
});
test("canonical encoding distinguishes types and normalizes binary64 numeric equality",async()=>{
  assert.equal(canonicalCoreText(null),"z");assert.equal(canonicalCoreText(1),"n3ff0000000000000");assert.equal(canonicalCoreText("1"),"s1:1");
  assert.equal(canonicalCoreText([null,true,""]),"a3:zts0:");assert.equal(canonicalCoreText({b:true,a:1}),"o2:s1:an3ff0000000000000s1:bt");
  assert.equal(await coreInputDigest(-0),await coreInputDigest(0));assert.notEqual(await coreInputDigest("1"),await coreInputDigest(1));
  assert.equal(canonicalCoreText("é"),"s2:é");assert.throws(()=>canonicalCoreText("\ud800"),failure("SIGNATURE_UNICODE"));
  assert.throws(()=>canonicalCoreText(Array.from({length:17},()=>"x".repeat(1000000))),failure("SIGNATURE_LIMIT"));
});
test("candidate publication cannot claim active status or mix asset feature revisions",async()=>{
  const snapshot=(await buildCoreSnapshot(snapshotFixture())).manifest;
  const candidate={schemaVersion:"ulpin-core-publication/1",state:"candidate",scope:snapshot.context.scope,snapshotDigest:snapshot.inputDigest,geometryDigest:snapshot.geometryDigest,compiler:"qualified-test-compiler/1",assets:[{id:"tile",sha256:"a".repeat(64),bytes:100,mediaType:"model/gltf-binary"}],bindings:[{assetId:"tile",featureId:"building-1",representation:snapshotRef("representation","exterior")}]};
  validateCorePublicationCandidate(snapshot,candidate);
  assert.throws(()=>validateCorePublicationCandidate(snapshot,{...candidate,state:"active"}),failure("INVALID_CONTRACT"));
  assert.throws(()=>validateCorePublicationCandidate(snapshot,{...candidate,snapshotDigest:"b".repeat(64)}),failure("PUBLICATION_SNAPSHOT"));
  assert.throws(()=>validateCorePublicationCandidate(snapshot,{...candidate,scope:{...candidate.scope,id:"different"}}),failure("ACCESS_SCOPE"));
  assert.throws(()=>validateCorePublicationCandidate(snapshot,{...candidate,assets:[]}),failure("MISSING_REFERENCE"));
  assert.throws(()=>validateCorePublicationCandidate(snapshot,{...candidate,bindings:[{...candidate.bindings[0],representation:snapshotRef("representation","exterior",2)}]}),failure("STALE_REFERENCE"));
  assert.throws(()=>validateCorePublicationCandidate(snapshot,{...candidate,bindings:[candidate.bindings[0],candidate.bindings[0]]}),failure("DUPLICATE_REFERENCE"));
});
