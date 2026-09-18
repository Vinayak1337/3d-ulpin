import assert from "node:assert/strict";
import test from "node:test";
import {CoreContractError,corePublicSourceIndex,planCoreEvidenceUnlink,projectLegacySourceLocator,projectLegacySourceMetadata,validateCoreSourceCatalog} from "../packages/contracts/src/spatial/core";
import {identityFixture} from "./fixtures/core-identity";
import {evidence,revisionRef,sourceCases,sourceFixture} from "./fixtures/core-sources";
const failure=(code:string)=>(error:unknown)=>error instanceof CoreContractError&&error.code===code;
for(const row of sourceCases())test(`source corpus: ${row.id}`,()=>{
  const before=JSON.stringify([row.catalog,row.identity]);
  if(row.valid)validateCoreSourceCatalog(row.catalog,row.identity);else assert.throws(()=>validateCoreSourceCatalog(row.catalog,row.identity),failure(row.code!));
  assert.equal(JSON.stringify([row.catalog,row.identity]),before);
});
test("unlink changes one association while preserving originals, source ordinals and other associations",()=>{
  const source=sourceFixture(),before=JSON.stringify(source),command={link:revisionRef("other-building","evidence_link")};
  const result=planCoreEvidenceUnlink(source,identityFixture(),command);
  assert(result.changed);assert.deepEqual(result.storageDeletes,[]);assert.deepEqual(result.catalog.assets,source.assets);assert.deepEqual(result.catalog.sources,source.sources);assert.deepEqual(result.catalog.parts,source.parts);
  assert.deepEqual(result.catalog.links[0],source.links[0]);assert.deepEqual(result.catalog.links[2],source.links[2]);
  assert.equal(result.catalog.links[1].state,"unlinked");assert.equal(result.catalog.links[1].revision,2);assert.equal(JSON.stringify(source),before);
  assert.equal(planCoreEvidenceUnlink(result.catalog,identityFixture(),{link:revisionRef("other-building","evidence_link",2)}).changed,false);
  assert.throws(()=>planCoreEvidenceUnlink(result.catalog,identityFixture(),command),failure("STALE_REFERENCE"));
});
test("parent unlink is blocked instead of silently invalidating inherited evidence",()=>{
  assert.throws(()=>planCoreEvidenceUnlink(sourceFixture(),identityFixture(),{link:revisionRef("building","evidence_link")}),failure("INHERITANCE_DEPENDENTS"));
});
test("unlinking child then parent retains exact historical associations without stale-reference deadlock",()=>{
  const source=sourceFixture();
  const child=planCoreEvidenceUnlink(source,identityFixture(),{link:revisionRef("inherited-unit","evidence_link")});
  const parent=planCoreEvidenceUnlink(child.catalog,identityFixture(),{link:revisionRef("building","evidence_link")});
  assert.equal(parent.catalog.links[0].state,"unlinked");
  assert.deepEqual(parent.catalog.links[2],child.catalog.links[2]);
  assert.deepEqual(parent.catalog.assets,source.assets);
  assert.deepEqual(parent.storageDeletes,[]);
  assert.deepEqual(parent.catalog.linkHistory,[source.links[2],source.links[0]]);
  assert.equal(parent.catalog.links.filter(link=>link.state==="active").length,1);
  validateCoreSourceCatalog(parent.catalog,identityFixture());
});
test("removing the final direct link still never deletes an original",()=>{
  const source=sourceFixture(),one={...source,links:[evidence("only")]};
  const result=planCoreEvidenceUnlink(one,identityFixture(),{link:revisionRef("only","evidence_link")});
  assert.equal(result.catalog.links.filter(l=>l.state==="active").length,0);assert.equal(result.catalog.assets.length,1);assert.deepEqual(result.storageDeletes,[]);
});
test("public source index omits private names, locators, blob handles and file content",()=>{
  const source:any=JSON.parse(JSON.stringify(sourceFixture()));assert.deepEqual(corePublicSourceIndex(source,identityFixture()),[]);
  source.sources[0].access="public";assert.deepEqual(corePublicSourceIndex(source,identityFixture()),[]);
  source.datasets[0].access="public";source.assets[0].access="public";
  const index=corePublicSourceIndex(source,identityFixture());assert.deepEqual(index,[{ref:{namespace:"source_revision",id:"s1"},revision:1}]);
  assert(!JSON.stringify(index).includes("Private filename"));assert(!JSON.stringify(index).includes("source-original"));assert(!JSON.stringify(index).includes("locator"));
});
test("same bytes in distinct receipts do not merge private source identity",()=>{
  const first=projectLegacySourceMetadata({id:"s1",caseId:"case1",familyId:"family1",revision:3,name:"Plan",profile:"plan-pdf-v1",mimeType:"application/pdf",bytes:123,sha256:'a'.repeat(64)});
  const second=projectLegacySourceMetadata({id:"s2",caseId:"case2",familyId:"family2",revision:1,name:"Plan",profile:"plan-pdf-v1",mimeType:"application/pdf",bytes:123,sha256:'a'.repeat(64)});
  const joined=validateCoreSourceCatalog({datasets:[],parts:[],links:[],sources:[...first.sources,...second.sources],assets:[...first.assets,...second.assets]},identityFixture());
  assert.equal(joined.assets.length,2);assert.notDeepEqual(joined.assets[0].ref,joined.assets[1].ref);assert.equal(first.sources[0].revision,1);assert.equal(first.sources[0].familyOrdinal,3);
  assert.equal(first.assets[0].integrity,"metadata_only");assert.equal(first.sources[0].dataset,null);assert.equal(first.sources[0].workflows[0].namespace,"case");
  assert.equal(first.assets[0].retention.legalHold,null,"No legal-hold state was supplied by the legacy source DTO");
});
test("legacy projection validates selected metadata without copying inspection text or executing getters",()=>{
  const source={id:"s1",caseId:"case1",familyId:"family1",revision:2,name:"Original",profile:"plan-pdf-v1",mimeType:"application/pdf",bytes:12,sha256:'a'.repeat(64),inspection:{text:"PRIVATE SOURCE CONTENT"}};
  const result=projectLegacySourceMetadata(source);assert(!JSON.stringify(result).includes("PRIVATE SOURCE CONTENT"));assert.equal(source.inspection.text,"PRIVATE SOURCE CONTENT");
  assert.throws(()=>projectLegacySourceMetadata({...source,bytes:"12"}),failure("INVALID_CONTRACT"));
  let ran=false;Object.defineProperty(source,"name",{get(){ran=true;return "bad";}});assert.throws(()=>projectLegacySourceMetadata(source),failure("INVALID_CONTRACT"));assert.equal(ran,false);
});
test("combined legacy feature/pointer/page/region/row locators are preserved, not reduced to a filename",()=>{
  const source={sourceRevisionId:"s1",partId:"p1",featureId:"0000123",jsonPointer:"/features/0",page:2,row:4,region:{x:0,y:0,width:0.5,height:1,unit:"normalized"}};
  const result=projectLegacySourceLocator(source);assert.equal(result.legacyPartId,"p1");assert.deepEqual(result.sourceRef,{namespace:"source_revision",id:"s1"});assert.deepEqual(result.locators.map(l=>l.kind),["feature","json_pointer","page","rows"]);
  assert.deepEqual(projectLegacySourceLocator({sourceRevisionId:"s1"}).locators,[{kind:"whole_asset"}]);
  assert.throws(()=>projectLegacySourceLocator({...source,jsonPointer:"/bad~escape"}),failure("INVALID_CONTRACT"));
});
test("unavailable original metadata and unknown family ordinal remain explicit",()=>{
  const source:any=JSON.parse(JSON.stringify(sourceFixture()));source.assets[0].storage={state:"unavailable",reason:"Object not reachable"};source.sources[0].familyOrdinal=null;
  const result=validateCoreSourceCatalog(source,identityFixture());assert.equal(result.sources[0].familyOrdinal,null);assert.equal(result.assets[0].sha256,'a'.repeat(64));assert.equal(result.assets[0].storage.state,"unavailable");
});
