import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import test from 'node:test';
import {DocumentAssociationPreviewRequestSchema,type DocumentAssociationTarget} from '../packages/contracts/src/document-association';
import {DocumentPartSchema,DocumentResultSchema,type DocumentInput} from '../packages/contracts/src/usp/document-ingestion';
import type {SnapshotScope,RequestContext} from '../packages/contracts/src/usp/common';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {associationPreviewProjection,previewDocumentAssociation} from '../packages/server/src/modules/usp/ingestion/document-association';
import {assertCurrentAssociationTarget} from '../packages/server/src/modules/usp/ingestion/document-association-targets';

const digest='a'.repeat(64),sourceId=randomUUID(),jobId=randomUUID(),caseId=randomUUID();
const input:DocumentInput={version:'source-document/1',jobId,caseId,caseRevision:1,caseContextSha256:digest,
  sourceId,familyId:sourceId,sourceRevision:1,sourceSha256:digest,sourceBytes:1,objectKey:'technical-control',
  subject:'association-technical-control',accessSha256:digest,policyVersion:'source-document-native/1',readerSha256:digest,
  gatewayPolicySha256:null,layoutCap:null,mode:'native_only'};
const pin={caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:digest,jobId,resultSha256:digest};
const scope:SnapshotScope={kind:'snapshot',scopeId:randomUUID(),world:{namespace:'world',id:'technical-control'},
  manifestId:randomUUID() as SnapshotScope['manifestId'],snapshotDigest:digest,stage:'recorded'};
function part(text:string,state:'literal'|'formula_uncached'){
  return DocumentPartSchema.parse({id:randomUUID(),sourceId,sourceRevision:1,sourceSha256:digest,text,
    sha256:createHash('sha256').update(text).digest('hex'),method:'native_text',
    locator:{label:'technical workbook cell',sheet:'Control',sheetIndex:1,sheetId:1,cell:'A1',cellState:state,
      row:1,column:1,characterStart:0,characterEnd:text.length}});
}
const literal=part('Technical identifier 0049','literal'),marker=part('[Formula without a cached value]','formula_uncached');
const result=DocumentResultSchema.parse({version:'source-document/1',input,
  native:{status:'extracted',format:'xlsx',readerSha256:digest,code:null,warnings:[],parts:[literal,marker]},
  model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},createdAt:'2026-09-30T00:00:00Z'});
const request={document:pin,partIds:[literal.id,marker.id],scope:null,targets:[]};
function target(kind:'building'|'floor'):DocumentAssociationTarget{
  return {pin:{ref:{namespace:'registry_record',id:randomUUID()},revision:1},kind,label:'Technical control',
    identifiers:[{scheme:'technical-issued-key',value:'0049',issuer:'Technical control',source:null,state:'supplied'}],
    recordState:'recorded',relationsWithinSelection:[],relationshipCoverage:'complete',sourceEvidence:'unavailable',synthetic:true};
}

test('explicit selection is bounded, unique and cannot carry caller labels or broaden a missing scope',()=>{
  assert(DocumentAssociationPreviewRequestSchema.safeParse(request).success);
  assert(!DocumentAssociationPreviewRequestSchema.safeParse({...request,partIds:[literal.id,literal.id]}).success);
  assert(!DocumentAssociationPreviewRequestSchema.safeParse({...request,partIds:Array.from({length:26},()=>randomUUID())}).success);
  const floor=target('floor');
  assert(!DocumentAssociationPreviewRequestSchema.safeParse({...request,targets:[floor.pin]}).success);
  assert(!DocumentAssociationPreviewRequestSchema.safeParse({...request,scope,targets:[floor.pin,{...floor.pin,revision:2}]}).success);
  assert(!DocumentAssociationPreviewRequestSchema.safeParse({...request,label:'Caller supplied association'}).success);
});
test('native citations preserve exact literal zeros and markers without proposing links; multiple floors and duplicate keys stay explicit',()=>{
  const floors=[target('floor'),target('floor')],selected={...request,scope,targets:floors.map(floor=>floor.pin)};
  const preview=associationPreviewProjection(selected,result,floors);
  assert.deepEqual(preview.citations.map(cite=>cite.part),[literal,marker]);
  assert.equal(preview.citations[0].identifierEligibility.state,'available');
  assert.equal(preview.citations[1].identifierEligibility.state,'not_assessed');
  assert.equal(preview.ambiguities.duplicateIdentifiers[0].value,'0049');
  assert.equal(preview.ambiguities.multipleFloors.length,2);
  assert.equal(preview.ambiguities.floorsWithoutSelectedParent.length,2);
  assert.equal(preview.association.state,'not_assessed');
  assert.equal(preview.association.identifierOverlap.reasonCode,'source_key_namespace_unqualified');
  assert.equal(associationPreviewProjection(request,result,[]).state,'needs_input');
  const scanned=DocumentResultSchema.parse({...result,native:{...result.native,format:'pdf',status:'needs_ocr',parts:[]}});
  assert.equal(associationPreviewProjection({...request,partIds:[]},scanned,[]).state,'not_assessed');
  assert.throws(()=>associationPreviewProjection({...request,partIds:[randomUUID()]},result,[]),
    (e:any)=>e.code==='DOCUMENT_ASSOCIATION_PART_SELECTION');
});
test('current target checks reject same-revision body/identity drift and wrong-site targets',()=>{
  const selected=target('floor'),captured={id:selected.pin.ref.id,site_id:scope.scopeId,kind:'floor',identifier:'0049',
    revision:1,body:{name:'Technical control',links:[]},projectIdentity:null};
  assert.doesNotThrow(()=>assertCurrentAssociationTarget(captured,captured,selected.pin,scope));
  for(const changed of [{...captured,revision:2},{...captured,site_id:randomUUID()},
    {...captured,body:{...captured.body,name:'Changed'}},{...captured,project_code:'changed',project_status:'assigned'}])
    assert.throws(()=>assertCurrentAssociationTarget(captured,changed,selected.pin,scope),(e:any)=>e.status===409);
});
test('source/target denial happens before object reads; revocation after I/O prevents returning citations',async()=>{
  const priorSubject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=input.subject;
  const ctx:RequestContext={requestId:randomUUID(),principal:{mode:'local_demo',subject:input.subject,roles:['operator'],
    entitlementVersion:'local-1'},accessViewId:'local-demo-view-1',policyVersion:'usp-local-1'};
  let reads=0;
  const dependencies={source:async()=>input,targets:async()=>[],result:async()=>{reads++;return result;}};
  try{
    await assert.rejects(()=>previewDocumentAssociation(ctx,request,{...dependencies,source:async()=>{throw new AppError(403,'DOCUMENT_DENIED','Denied');}}),
      (e:any)=>e.status===403);assert.equal(reads,0);
    await assert.rejects(()=>previewDocumentAssociation(ctx,request,{...dependencies,targets:async()=>{throw new AppError(409,'USP_STALE_TARGET','Changed');}}),
      (e:any)=>e.status===409);assert.equal(reads,0);
    let sourceChecks=0;
    await assert.rejects(()=>previewDocumentAssociation(ctx,request,{...dependencies,source:async()=>{
      if(++sourceChecks>1)throw new AppError(403,'DOCUMENT_DENIED','Revoked');return input;}}),(e:any)=>e.status===403);
    assert.equal(reads,1);
    let targetChecks=0;
    const selected=target('building');
    await assert.rejects(()=>previewDocumentAssociation(ctx,{...request,scope,targets:[selected.pin]},
      {...dependencies,targets:async()=>[++targetChecks>1?{...selected,label:'Changed'}:selected]}),(e:any)=>e.status===409);
  }finally{if(priorSubject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=priorSubject;}
});
