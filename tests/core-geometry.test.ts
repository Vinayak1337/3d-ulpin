import assert from "node:assert/strict";
import test from "node:test";
import {CoreContractError,evaluateCoreGeometry,measureCoreRepresentation} from "../packages/contracts/src/spatial/core";
import {geometryCases,geometryFixture} from "./fixtures/core-geometry";
const failure=(code:string)=>(error:unknown)=>error instanceof CoreContractError&&error.code===code;
for(const row of geometryCases())test(`geometry corpus: ${row.id}`,()=>{
  const x:any=row.input,before=JSON.stringify(x);
  const execute=()=>measureCoreRepresentation(x.geometry,x.identity,x.sources,x.frames,x.request);
  if(!row.valid)assert.throws(execute,failure(row.code!));
  else {
    const result=execute();
    if(row.value===null)assert.equal(result.value,null);
    else assert(result.value!==null&&Math.abs(result.value-row.value!)<1e-8,`${result.value} != ${row.value}`);
    assert.equal(result.reasonCode,row.reasonCode);
    if(row.capabilities){const actual=evaluateCoreGeometry(x.geometry,x.identity,x.sources,x.frames)[0].capabilities;
      for(const [key,value] of Object.entries(row.capabilities))assert.equal(actual[key as keyof typeof actual].available,value,key);
    }
  }
  assert.equal(JSON.stringify(x),before);
});
test("source name and evidence unlink cannot change analytical quantities",()=>{
  const x:any=geometryFixture();const first=measureCoreRepresentation(x.geometry,x.identity,x.sources,x.frames,x.request);
  x.sources.sources[0].label="Renamed optional document";x.geometry.representations[0].sourceParts=[];
  const next=measureCoreRepresentation(x.geometry,x.identity,x.sources,x.frames,x.request);
  assert.equal(first.value,next.value);assert.deepEqual(first.representation,next.representation);
});
test("non-finite coordinates are rejected before geometry code",()=>{
  const x:any=geometryFixture();x.geometry.representations[0].geometry.footprint.coordinates[0][1][0]=NaN;
  assert.throws(()=>measureCoreRepresentation(x.geometry,x.identity,x.sources,x.frames,x.request),failure("NON_FINITE"));
});
test("capability flags cannot be injected by a caller",()=>{
  const x:any=geometryFixture();x.geometry.representations[0].ready=true;
  assert.throws(()=>evaluateCoreGeometry(x.geometry,x.identity,x.sources,x.frames),failure("INVALID_CONTRACT"));
});
