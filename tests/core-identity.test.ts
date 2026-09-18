import assert from "node:assert/strict";
import test from "node:test";
import {assertCoreJson,CoreContractError,CoreNumberValueSchema,coreRefKey,parseCore,planCoreIdentityChange,resolveCoreIdentifier,validateCoreIdentityGraph,type CoreIdentityGraph,type CoreIdentityDelta} from "../packages/contracts/src/spatial/core";
import {entity,identityCases,identityFixture,mergeFixture,ref,splitFixture} from "./fixtures/core-identity";
const failure=(code:string)=>(error:unknown)=>error instanceof CoreContractError&&error.code===code;
for(const example of identityCases())test(`identity corpus: ${example.id}`,()=>{
  const before=JSON.stringify(example.value);
  if(example.valid)validateCoreIdentityGraph(example.value);else assert.throws(()=>validateCoreIdentityGraph(example.value),failure(example.code!));
  assert.equal(JSON.stringify(example.value),before);
});
test("same opaque ID in physical and registry namespaces is not a collision",()=>{
  const g=validateCoreIdentityGraph(identityFixture());
  assert.equal(g.entities.filter(e=>e.ref.id==="B1").length,2);
  assert.notEqual(coreRefKey(ref("B1")),coreRefKey(ref("B1","registry")));
  assert.notEqual(coreRefKey(ref("a:b","physical")),coreRefKey(ref("b","physical.a")));
});
test("raw leading-zero identifiers preserve ambiguity instead of selecting the first label",()=>{
  const g=identityFixture(),r=resolveCoreIdentifier(g,{scheme:"source_property_id",issuer:"Fixture issuer",value:"0000123"});
  assert.equal(r.status,"ambiguous");assert.deepEqual(r.matches,[ref("B1"),ref("B2")]);
  assert.equal(resolveCoreIdentifier(g,{scheme:"source_property_id",value:"123"}).status,"missing");
  assert.equal(resolveCoreIdentifier(g,{scheme:"label",value:"Same label"}).status,"missing");
});
test("rename changes only the declared label/revision and preserves identities, links and aliases",()=>{
  const g=identityFixture(),before=JSON.stringify(g);
  const d=planCoreIdentityChange(g,{kind:"rename",changeId:"rename-1",target:ref("B1"),expectedRevision:1,label:"New label",reason:"Reviewed rename"});
  assert.deepEqual(d.before,[{ref:ref("B1"),revision:1}]);assert.deepEqual(d.changed,[{...g.entities[0],revision:2,label:"New label"}]);
  assert.deepEqual(d.created,[]);assert.deepEqual(d.lineage,[]);assert.equal(JSON.stringify(g),before);
  assert(Object.isFrozen(d)&&Object.isFrozen(d.changed[0])&&Object.isFrozen(d.changed[0].memberships));
});
function apply(g:CoreIdentityGraph,d:CoreIdentityDelta):CoreIdentityGraph {
  return {entities:[...g.entities.map(e=>d.changed.find(x=>coreRefKey(x.ref)===coreRefKey(e.ref))||e),...d.created],relations:[...g.relations,...d.lineage]};
}
test("split plans stable new identities and explicit history without inferring geometric children",()=>{
  const g={entities:[entity("P0","parcel")],relations:[]};
  const c={kind:"split",changeId:"split-new",target:ref("P0"),expectedRevision:1,children:[entity("P2","parcel"),entity("P1","parcel")],reason:"Review required before persistence"};
  const d=planCoreIdentityChange(g,c);
  assert.equal(d.changed[0].ref.id,"P0");assert.equal(d.changed[0].revision,2);
  assert.deepEqual(d.created.map(e=>e.ref),[ref("P1"),ref("P2")]);
  assert.deepEqual(d.lineage.map(r=>[r.id,r.kind,r.from.id,r.to.id]),[["split-new:lineage:0:0","split_from","P1","P0"],["split-new:lineage:1:0","split_from","P2","P0"]]);
  assert.deepEqual(planCoreIdentityChange(g,{...c,children:[...c.children].reverse()}),d);
  validateCoreIdentityGraph(apply(g,d));
  assert(!JSON.stringify(d).includes('geometry'));assert(!JSON.stringify(d).includes('rights'));
});
test("merge keeps every original identity retired and one new explicit successor",()=>{
  const g={entities:[entity("P2","parcel"),entity("P1","parcel")],relations:[]};
  const c={kind:"merge",changeId:"merge-new",sources:[{ref:ref("P2"),expectedRevision:1},{ref:ref("P1"),expectedRevision:1}],result:entity("P3","parcel"),reason:"Reviewed merge candidate"};
  const d=planCoreIdentityChange(g,c);assert.deepEqual(d.changed.map(e=>e.ref),[ref("P1"),ref("P2")]);assert.equal(d.created.length,1);
  assert.deepEqual(d.lineage.map(e=>[e.from.id,e.to.id]),[["P3","P1"],["P3","P2"]]);validateCoreIdentityGraph(apply(g,d));
  assert.deepEqual(planCoreIdentityChange({...g,entities:[...g.entities].reverse()},{...c,sources:[...c.sources].reverse()}),d);
});
for(const [name,mutate,code] of [
  ["stale revision",(c:any)=>c.expectedRevision=0,"STALE_REVISION"],
  ["missing target",(c:any)=>c.target=ref("missing"),"ENTITY_NOT_FOUND"],
  ["duplicate output",(c:any)=>c.children[1]=c.children[0],"DUPLICATE_OUTPUT"],
  ["reused old identity",(c:any)=>c.children[0]=entity("P0","parcel"),"IDENTITY_REUSE"],
  ["changed kind",(c:any)=>c.children[0]=entity("new-building"),"IDENTITY_KIND_CHANGE"],
  ["changed namespace",(c:any)=>c.children[0]=entity("P1","parcel","registry"),"IDENTITY_KIND_CHANGE"],
  ["new revision not one",(c:any)=>c.children[0]={...c.children[0],revision:2},"INVALID_NEW_IDENTITY"],
  ["one output only",(c:any)=>c.children.pop(),"INVALID_CONTRACT"],
] as const)test(`identity command rejects ${name}`,()=>{
  const g={entities:[entity("P0","parcel")],relations:[]};const c:any={kind:"split",changeId:"split-command",target:ref("P0"),expectedRevision:1,children:[entity("P1","parcel"),entity("P2","parcel")],reason:"Test"};mutate(c);assert.throws(()=>planCoreIdentityChange(g,c),failure(code));
});
test("retired references, historical allocation and recorded change IDs cannot be reused",()=>{
  const g=splitFixture();
  assert.throws(()=>planCoreIdentityChange(g,{kind:"rename",changeId:"rename-retired",target:ref("P0"),expectedRevision:2,label:"Changed",reason:"Test"}),failure("RETIRED_IDENTITY"));
  assert.throws(()=>planCoreIdentityChange(g,{kind:"rename",changeId:"split-1",target:ref("P1"),expectedRevision:1,label:"Changed",reason:"Test"}),failure("CHANGE_ID_REUSE"));
  assert.throws(()=>planCoreIdentityChange(mergeFixture(),{kind:"split",changeId:"split-reuse",target:ref("P3"),expectedRevision:1,children:[entity("P1","parcel"),entity("P4","parcel")],reason:"Test"}),failure("IDENTITY_REUSE"));
});
test("revision overflow and duplicate merge sources are rejected",()=>{
  assert.throws(()=>planCoreIdentityChange({entities:[{...entity("B"),revision:Number.MAX_SAFE_INTEGER}],relations:[]},{kind:"rename",changeId:"overflow",target:ref("B"),expectedRevision:Number.MAX_SAFE_INTEGER,label:"New",reason:"Test"}),failure("REVISION_OVERFLOW"));
  assert.throws(()=>planCoreIdentityChange({entities:[entity("B")],relations:[]},{kind:"merge",changeId:"duplicate",sources:[{ref:ref("B"),expectedRevision:1},{ref:ref("B"),expectedRevision:1}],result:entity("C"),reason:"Test"}),failure("DUPLICATE_SOURCE"));
});
test("known zero, unknown, withheld, not applicable and conflict remain distinct",()=>{
  assert.deepEqual(parseCore(CoreNumberValueSchema,{state:"known",value:0}),{state:"known",value:0});
  for(const state of ["unknown","withheld","not_applicable"]){assert.equal(parseCore(CoreNumberValueSchema,{state,reason:"Not supplied"}).state,state);assert.throws(()=>parseCore(CoreNumberValueSchema,{state,reason:"Not supplied",value:0}),failure("INVALID_CONTRACT"));}
  assert.equal(parseCore(CoreNumberValueSchema,{state:"conflicting",candidates:[{ref:ref("a","observation"),revision:1},{ref:ref("b","observation"),revision:2}],reason:"Different source claims"}).state,"conflicting");
});
test("bounded JSON guard rejects cycles, non-finite data, accessors and sparse arrays without invoking code",()=>{
  const cyc:any={};cyc.self=cyc;assert.throws(()=>assertCoreJson(cyc),failure("JSON_CYCLE"));
  for(const value of [Infinity,-Infinity,NaN])assert.throws(()=>assertCoreJson({value}),failure("NON_FINITE"));
  for(const value of [undefined,()=>1,1n,new Date(),new Map()])assert.throws(()=>assertCoreJson({value}),failure("NON_JSON"));
  let touched=false;const getter=Object.defineProperty({},"field",{enumerable:true,get(){touched=true;return 1;}});assert.throws(()=>assertCoreJson(getter),failure("NON_JSON"));assert.equal(touched,false);
  const sparse=new Array(2);sparse[1]=1;assert.throws(()=>assertCoreJson(sparse),failure("NON_JSON"));
  const customArray=Object.setPrototypeOf([1],Object.create(Array.prototype));assert.throws(()=>assertCoreJson(customArray),failure("NON_JSON"));
  const shared={value:1};assert.doesNotThrow(()=>assertCoreJson([shared,shared]));
  let nested:any=0;for(let i=0;i<66;i++)nested={value:nested};assert.throws(()=>assertCoreJson(nested),failure("JSON_LIMIT"));
});
