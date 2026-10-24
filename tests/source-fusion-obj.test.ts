import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {ObjOriginalSchema,ObjResultSchema,OBJ_LIMITS} from '../packages/contracts/src/usp/obj-ingestion';
import {SourceFusionRequestSchema,type SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {assembleSourceFusion,fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,readFusionResult,readFusionObject,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {acceptedFusionObjTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-obj-authority';
import {captureAssociationFusion,proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {associationLiterals,associationManualSelection} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {amendRegistryDocumentCitations,amendRegistryDocumentCitationsTx} from '../packages/server/src/modules/registry/registry-document-evidence';
import {objArtifactKey,objResultKey} from '../packages/server/src/modules/usp/ingestion/obj';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// No enrollment, native execution, network, persisted SQL or real tool admission.
// Reuse exact accepted OBJ-02 originals/results/artifacts and document result.
const root=process.env.ULPIN_OBJ_FUSION_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-obj-api/bridge-run01';
const documentRoot=process.env.ULPIN_REFERENCE_DOCUMENT_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-reference-document-enrollment';
const budget=():FusionBudget=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal,reservedBytes:0});
const ctx=()=>localRequestContext('fusion-obj-protocol-control');
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='obj-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(label='no_material.obj'){
  const journey=JSON.parse(readFileSync(root+'/'+label+'.journey.json','utf8')),result=ObjResultSchema.parse(journey.accepted),input=result.input,
    nativeBytes=readFileSync(root+'/'+label+'.native.json'),native=JSON.parse(nativeBytes.toString('utf8')),
    resultBytes=Buffer.from(JSON.stringify(result)),resultHash=sha256(resultBytes);
  assert.deepEqual(result.input,journey.accepted.input);assert.deepEqual(result.summary,journey.status.result.summary);
  assert.equal(result.artifact.sha256,sha256(nativeBytes));assert.equal(result.artifact.bytes,nativeBytes.length);
  assert.equal(result.artifact.key,objArtifactKey(input.jobId,sha256(nativeBytes)));
  const retainedResult=journey.objectHashes.find((entry:any)=>entry.key===objResultKey(input.jobId,resultHash));assert(retainedResult);
  assert.equal(resultHash,retainedResult.sha256);assert.equal(resultBytes.length,retainedResult.bytes);
  const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-obj/sources.json',import.meta.url),'utf8')),
    originalEntry=manifest.originals.find((s:any)=>s.sha256===input.sourceSha256),original=readFileSync(originalEntry.path);
  assert.equal(sha256(original),input.sourceSha256);assert.equal(original.length,input.sourceBytes);
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null};
  assert.equal(fingerprint({frame:null,context:null,siteId:null}),input.caseContextSha256);
  const binding=ingestionBinding(input.caseId);assert.equal(binding.subject,input.subject);assert.equal(binding.access,input.accessSha256);
  const marker=ObjOriginalSchema.parse({version:input.version,subject:input.subject,accessSha256:input.accessSha256,
    sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:result.createdAt,lineageState:'caller_declared',
    lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['memory-only source authority control']}}),
    source={id:input.sourceId,case_id:input.caseId,family_id:input.sourceFamilyId,revision:input.sourceRevision,
      profile:'obj-native-v1',sha256:input.sourceSha256,bytes:input.sourceBytes,object_key:input.objectKey,inspection:{objOriginal:marker}},
    job={id:input.jobId,operation:'obj-native',case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`obj:${input.jobId}:${resultBytes.length}`,version:1,sha256:resultHash},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:resultHash},
    selection:Extract<SourceFusionSelection,{kind:'obj'}>={kind:'obj',pin:{caseId:input.caseId,caseRevision:input.caseRevision,
      sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,jobId:input.jobId,
      resultSha256:resultHash,resultBytes:resultBytes.length,readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1},polygonIndices:[0,17]};
  const documentBytes=readFileSync(documentRoot+'/epsg7415-accepted-result.json'),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    entry=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((e:any)=>e.id==='epsg7415');
  assert.equal(sha256(documentBytes),entry.resultSha256);assert.equal(fingerprint(document.input),entry.inputSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:entry.caseId,caseRevision:entry.caseRevision,
    sourceId:entry.sourceId,sourceRevision:entry.sourceRevision,sourceSha256:entry.sourceSha256,jobId:entry.jobId,
    resultSha256:entry.resultSha256,resultBytes:entry.resultBytes,readerSha256:entry.readerSha256,inputSha256:entry.inputSha256,acceptedFence:entry.acceptedFence},
    partIds:[entry.selectedParts[0].id]};
  const objects=new Map([[objResultKey(input.jobId,resultHash),resultBytes],[result.artifact.key,nativeBytes],
    [documentResultKey(document.input.jobId,entry.resultSha256),documentBytes]]);
  const read:typeof readFusionResult=(selection,authority,bounds)=>readFusionResult(selection,authority,bounds,
    (key,size,digest,bounds)=>readFusionObject(key,size,digest,bounds,async()=>{
      const bytes=objects.get(key);assert(bytes,`unexpected owned key: ${key}`);return {body:Readable.from([bytes]),etag:'memory-control'};
    }));
  return {current,source,job,result,native,nativeBytes,original,resultBytes,selection,document,docSelection,read};
}
function authorityControl(f:ReturnType<typeof fixture>){
  let active=false,transactions=0,writes=0,tools=0;
  const client={query:async(sql:string)=>{
    if(/^(INSERT|UPDATE|DELETE)\b/.test(sql))writes++;
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[f.current]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[f.source]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:f.source.revision}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:[f.job]};
    if(sql.includes('SELECT accepted_fence'))return {rows:[{accepted_fence:f.docSelection.pin.acceptedFence}]};
    return {rows:[]};
  }};
  const deps={transaction:async(action:any)=>{transactions++;active=true;try{return await action(client);}finally{active=false;}},
    document:async()=>f.document.input,cityjson:async()=>assert.fail('no CityJSON authority'),gate:async()=>{},
    obj:acceptedFusionObjTx,objTools:()=>{assert(!active,'tool inventory held a transaction');tools++;}};
  const authority:typeof fusionAuthorityBatch=(ctx,selections,bounds,expected)=>fusionAuthorityBatch(ctx,selections,bounds,expected,deps as any);
  return {client,authority,stats:()=>({active,transactions,writes,tools})};
}
function save(name:string,value:unknown){const proof=process.env.ULPIN_FUSION_OBJ_PROOF_DIR;
  if(proof)writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const contextOnly=(e:any)=>e.status===422&&e.code==='SOURCE_FUSION_OBJ_CONTEXT_ONLY';
function at(root:any,pointer:string){return pointer.slice(1).split('/').reduce((value,key)=>value[key.replaceAll('~1','/').replaceAll('~0','~')],root);}

test('retained OBJ and document preserve selected literal polygons and context-only boundaries',()=>local(async()=>{
  const f=fixture(),control=authorityControl(f),request={sources:[f.selection,f.docSelection]},events:string[]=[];
  const context=await assembleSourceFusion(ctx(),request,{authority:async(ctx,selections,bounds,expected)=>{
    events.push(expected?'final-all':'initial-all');return control.authority(ctx,selections,bounds,expected);
  },read:async(selection,authority,bounds)=>{assert(!control.stats().active);events.push('read:'+selection.kind);return f.read(selection,authority,bounds);}});
  const obj=context.sources.find(s=>s.kind==='obj')!;assert(obj.kind==='obj');
  assert.equal(events[0],'initial-all');assert.equal(events.at(-1),'final-all');
  assert.deepEqual(events.slice(1,-1).sort(),['read:document','read:obj']);
  assert.deepEqual(control.stats(),{active:false,transactions:2,writes:0,tools:2});
  assert.deepEqual(obj.polygons.map(p=>p.index),[0,17]);assert.equal(obj.summary.polygonCount,18);
  assert.equal(obj.coverage.unselectedPolygons,'not_expanded');assert.equal(obj.coverage.triangulation,'not_performed');
  assert.equal(obj.polygons.every(p=>(p.record.references as any[]).length===4),true);
  const referenced=new Set(obj.polygons.flatMap(p=>(p.record.references as any[]).map(r=>r.vertex.resolvedIndex)));
  assert.deepEqual(obj.vertices.map(v=>v.index),[...referenced].sort((a,b)=>a-b));assert.equal(obj.textures.length,0);assert.equal(obj.normals.length,0);
  for(const record of [...obj.polygons,...obj.vertices,...obj.declarations,...obj.resources,...obj.unsupported]){
    assert.deepEqual(record.record,at(f.native,record.artifactPointer));assert.equal(record.recordSha256,fingerprint(record.record));
  }
  // Validate all disclosed source span hashes against unchanged retained bytes.
  let spans=0;const walk=(v:any)=>{if(!v||typeof v!=='object')return;
    if(typeof v.spanSha256==='string'){assert.equal(sha256(f.original.subarray(v.byteStart,v.byteEnd)),v.spanSha256);spans++;}
    for(const child of Object.values(v))walk(child);};walk(obj);
  assert(spans>0);assert.equal(obj.qualification.axes,'unknown');assert.equal(obj.qualification.learningTruth,false);
  assert.deepEqual(context.association.canonicalTargets,[]);
  const document=context.sources.find(s=>s.kind==='document')!;assert(document.kind==='document');
  assert.equal(document.parts[0].part.text,'  <gml:name>RD + NAP height</gml:name>');
  const contextHash=context.contextSha256;
  assert.throws(()=>associationLiterals(context),contextOnly);assert.throws(()=>associationManualSelection({context:{selection:request}} as any,context,[]),contextOnly);
  await assert.rejects(()=>captureAssociationFusion(ctx(),request,budget()),contextOnly);
  await assert.rejects(()=>proposeFusionAssociations(ctx(),{requestKey:f.selection.pin.jobId,context:{contextSha256:contextHash,selection:request},scope:null,targets:[]},
    {capture:()=>assert.fail('no association capture'),targets:()=>assert.fail('no target'),gateway:()=>assert.fail('no model')} as any),contextOnly);
  // Explicit glTF enablement never admits OBJ into citation handling.
  await assert.rejects(()=>resolveFusionCitationsTx({query:()=>assert.fail('no citation I/O')} as any,ctx(),
    {contextSha256:contextHash,selection:request},{source:()=>assert.fail('no source')} as any,f.selection.pin.caseId,true,true),contextOnly);
  const amendment={requestKey:f.selection.pin.jobId,recordId:f.selection.pin.sourceId,expectedDraftRevision:1,expectedRecordRevision:1,
    addFusion:{contextSha256:contextHash,selection:request,gltfReferences:true}};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx({query:()=>assert.fail('no registry I/O')} as any,f.selection.pin.caseId,amendment),contextOnly);
  await assert.rejects(()=>amendRegistryDocumentCitations(f.selection.pin.caseId,amendment),contextOnly);
  assert.equal(context.contextSha256,contextHash);assert.deepEqual(fusionContextProjection(context.sources),context);
  save('complete-controlled-journey.json',{qualification:'retained exact outputs; memory-only SQL/storage/tool/document authority; no current tool admission/native/HTTP/persistence',
    request,context,events,stats:control.stats(),spanChecks:spans,contextOnlyRefusals:7,nativeRuns:0,originalSha256:sha256(f.original),resultSha256:sha256(f.resultBytes)});
}));

test('missing OBJ materials remain unresolved and final source revocation refuses publication',()=>local(async()=>{
  const f=fixture('missing_material_file.obj'),control=authorityControl(f),request={sources:[f.selection,f.docSelection]};
  const context=await assembleSourceFusion(ctx(),request,{authority:control.authority,read:f.read}),obj=context.sources.find(s=>s.kind==='obj')!;assert(obj.kind==='obj');
  assert.equal(obj.summary.status,'inspected_partial');assert.equal(obj.summary.missingCompanionDeclarationCount,10);
  assert(obj.resources.length>0);assert(obj.resources.every(r=>r.record.state==='needs_input'));
  assert.equal(obj.coverage.externalResources,'not_fetched');assert.equal(obj.qualification.materialsAndTextures,'declarations_only; companions_not_resolved');
  for(const polygonIndices of [[],[0,0],[-1],[100000],[0.5],Array.from({length:25},(_,i)=>i)])
    assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.selection,polygonIndices},f.docSelection]}).success);
  assert.throws(()=>fusionSourceProjection({...f.selection,polygonIndices:[18]},{kind:'obj',result:f.result,native:f.native}),(e:any)=>e.status===422);
  let reads=0;const revoked=authorityControl(f);
  await assert.rejects(()=>assembleSourceFusion(ctx(),request,{authority:revoked.authority,read:async(selection,authority,bounds)=>{
    const loaded=await f.read(selection,authority,bounds);if(++reads===2)f.current.archived=true;return loaded;
  }}),(e:any)=>e.status===403&&e.code==='SOURCE_FUSION_UNAVAILABLE');
  assert.equal(reads,2);assert.equal(revoked.stats().writes,0);
  save('partial-and-denial-controlled-journey.json',{qualification:'retained incomplete source; memory-only SQL/storage/tool/document controls',request,context,
    selectedResources:obj.resources.length,revokedAfterReads:reads,publishedAfterRevocation:false,stats:revoked.stats(),nativeRuns:0,externalFetches:0,
    originalSha256:sha256(f.original),resultSha256:sha256(f.resultBytes)});
}));
