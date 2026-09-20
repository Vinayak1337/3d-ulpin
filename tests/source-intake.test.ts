import test from "node:test";
import assert from "node:assert/strict";
import type { AreaReference, CoordinateFrame, ImportPackage } from "@ulpin/contracts";
import { documentFormat, documentProfileFormats } from "../apps/web/lib/document-formats";
import { sourceWorkspaceSchema } from "../apps/web/lib/server/source-workspaces";
import { assertSourceWorkspaceReference } from "../apps/web/lib/server/source-workspace-policy";
import { fingerprint } from "../apps/web/lib/server/domain";
const id = "10000000-0000-4000-8000-000000000000";
const frame: CoordinateFrame = {id:"retained-frame",horizontalUnit:"m",verticalUnit:"m",benchmark:"declared-benchmark"};
const reference = {analysisCrs:"EPSG:32643",origin:[500000,2800000]} as AreaReference;
const workspace: NonNullable<ImportPackage["sourceWorkspace"]> = {caseId:id,frame,worldStatus:"synthetic",areaReferenceFingerprint:fingerprint(reference)};
test("six supported document formats use the same profile map for receipt and assignment",()=>{
  for(const [name,format] of [["plan.PDF","pdf"],["image.PNG","png"],["overhead.jpg","jpeg"],["overhead.jpeg","jpeg"],["levels.csv","csv"],["notes.txt","text"],["schedule.docx","docx"]]) {
    assert.equal(documentFormat(name),format);
    assert.equal(documentProfileFormats[`${format}-reference-v2`],format);
  }
  for(const name of ["plan.tif","document.doc","image.webp","data.xlsx","zip.pdf.exe"]) assert.equal(documentFormat(name),undefined);
  assert.equal(documentProfileFormats["plan-pdf-v1"],"pdf");
  assert.equal(documentProfileFormats["levels-csv-v1"],"csv");
});
test("source workspace requires explicit origin, destination, revision and stable identity",()=>{
  const input={requestKey:id,areaId:id,expectedAreaRevision:0,name:"Source review",worldStatus:"synthetic"};
  assert(sourceWorkspaceSchema.safeParse(input).success);
  for(const key of Object.keys(input)) { const invalid={...input} as Record<string,unknown>; delete invalid[key];assert(!sourceWorkspaceSchema.safeParse(invalid).success,key); }
  assert(!sourceWorkspaceSchema.safeParse({...input,buildingId:id}).success);
  assert(!sourceWorkspaceSchema.safeParse({...input,worldStatus:"survey-approved"}).success);
  assert(sourceWorkspaceSchema.safeParse({...input,caseId:id}).success);
});
test("source-only extraction pins complete named frame and area origin independently of unrelated revision",()=>{
  assert.doesNotThrow(()=>assertSourceWorkspaceReference(workspace,{...frame},{...reference}));
  assert.throws(()=>assertSourceWorkspaceReference(workspace,{...frame,benchmark:"changed-benchmark"},reference),/frame changed/);
  assert.throws(()=>assertSourceWorkspaceReference(workspace,{...frame,horizontalUnit:"ft" as "m"},reference),/frame changed/);
  assert.throws(()=>assertSourceWorkspaceReference(workspace,frame,{...reference,origin:[500001,2800000]}),/frame changed/);
  assert.throws(()=>assertSourceWorkspaceReference(workspace,frame,{...reference,analysisCrs:"EPSG:32644"}),/frame changed/);
  assert.throws(()=>assertSourceWorkspaceReference(workspace,frame,undefined),/frame changed/);
});

test("unassigned receipt does not ask for invented spatial reference or property",async()=>{
  const {sourceCaseSchema}=await import("../apps/web/lib/server/source-cases");
  assert(sourceCaseSchema.safeParse({requestKey:id,name:"Plans before placement"}).success);
  assert(!sourceCaseSchema.safeParse({requestKey:id,name:"Plans before placement",frame:{id:"invented"}}).success);
  assert(!sourceCaseSchema.safeParse({requestKey:id,name:"Plans before placement",buildingId:id}).success);
});
test("adopting an unassigned document keeps original part identity and native text",async()=>{
  const {sourceWorkspaceParts}=await import("../apps/web/lib/server/source-workspaces");
  const part={id:"retained-part",sourceRevisionId:id,locator:"page 3",text:"Actual retained native text",entityIds:[]};
  const sources=[{id,profile:"pdf-reference-v2",inspection:{referenceParts:[part]}}];
  assert.deepEqual(sourceWorkspaceParts(sources),[part]);
  assert.equal(sourceWorkspaceParts(sources)[0].id,part.id);
  assert.deepEqual(sourceWorkspaceParts([{id,profile:"parcel-local-json-v1"}]),[]);
});

test("document byte limits match native processing and allow exact size boundary",async()=>{
  const {documentSizeError,documentLimitMiB}=await import("../apps/web/lib/document-formats");
  for(const extension of ["pdf","docx","csv","txt","png","jpg","jpeg"]){
    const name=`source.${extension}`,format=documentFormat(name)!,limit=documentLimitMiB(format);
    assert.equal(limit,["png","jpeg"].includes(format)?16:10);
    assert.equal(documentSizeError({name,size:limit*1024*1024}),undefined);
    assert.match(documentSizeError({name,size:limit*1024*1024+1})!,new RegExp(`${limit} MiB`));
    assert.match(documentSizeError({name,size:0})!,/empty/);
  }
});
