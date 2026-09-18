import assert from "node:assert/strict";
import test from "node:test";
import {CoreContractError,projectLegacyCoreFrame,transformCorePoint,validateCoreFrameCatalog} from "../packages/contracts/src/spatial/core";
import {frameCases,frameFixture,frameRef,frameRequest,opRef} from "./fixtures/core-frames";
const failure=(code:string)=>(error:unknown)=>error instanceof CoreContractError&&error.code===code;
for(const row of frameCases())test(`frame corpus: ${row.id}`,()=>{
  const before=JSON.stringify([row.catalog,row.request]);
  if(!row.valid)assert.throws(()=>transformCorePoint(row.catalog,row.request),failure(row.code!));
  else {
    const result=transformCorePoint(row.catalog,row.request);
    assert.equal(result.point.length,row.expectedPoint!.length);
    for(let i=0;i<result.point.length;i++)assert(Math.abs(result.point[i]-row.expectedPoint![i])<=row.tolerance!,`Coordinate ${i}: ${result.point[i]} != ${row.expectedPoint![i]}`);
  }
  assert.equal(JSON.stringify([row.catalog,row.request]),before);
});
test("transform outcomes preserve declared uncertainties and do not manufacture accuracy",()=>{
  const result=transformCorePoint(frameFixture(),frameRequest());
  assert.deepEqual(result.declaredAccuraciesMetres,[null]);assert(Object.isFrozen(result.point));
});
test("non-finite coordinate and overflowing arithmetic fail explicitly",()=>{
  assert.throws(()=>transformCorePoint(frameFixture(),{...frameRequest(),point:[Infinity,0]}),failure("NON_FINITE"));
  const c:any=JSON.parse(JSON.stringify(frameFixture()));c.operations[0].sourceDomain=null;c.frames[0].horizontalUnit="m";c.operations[0].rotationDegrees=45;
  assert.throws(()=>transformCorePoint(c,{...frameRequest(),point:[1.79e308,1.79e308]}),failure("NON_FINITE_RESULT"));
});
test("inverse registration round trips diverse finite points without changing identity",()=>{
  const catalog=frameFixture();
  for(const point of [[0,0,0],[1,2,3],[-30,40,-5],[100,-100,20]]) {
    const forward=transformCorePoint(catalog,{...frameRequest(),point});
    const inverse=transformCorePoint(catalog,{from:frameRef("metric"),to:frameRef("feet"),point:forward.point,steps:[{operation:opRef("registration"),direction:"inverse"}]});
    for(let i=0;i<3;i++)assert(Math.abs(point[i]-inverse.point[i])<1e-10);
  }
});
test("legacy benchmark labels remain frame-scoped and the supplied anchor stays metadata",()=>{
  const legacy={id:"local-one",kind:"engineering",horizontalUnit:"m",verticalUnit:"m",axes:"east-north-up",verticalReference:"ground",anchor:{longitude:77,latitude:28,ellipsoidHeight:200,provenance:"Supplied anchor"}};
  const a=projectLegacyCoreFrame(legacy),b=projectLegacyCoreFrame({...legacy,id:"local-two"});
  assert.notDeepEqual(a.frame.vertical,b.frame.vertical);
  assert.deepEqual(a.legacyAnchor,legacy.anchor);
  const unknown=projectLegacyCoreFrame({...legacy,verticalReference:null});assert.equal(unknown.frame.kind,"engineering");
  validateCoreFrameCatalog({frames:[a.frame,b.frame,unknown.frame].slice(0,2),operations:[]});
  assert.throws(()=>projectLegacyCoreFrame({...legacy,horizontalUnit:"degree"}),failure("FRAME_PROFILE"));
});
