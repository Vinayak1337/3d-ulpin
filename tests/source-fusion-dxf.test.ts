import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {DocumentResultSchema,DXFOriginalSchema,DXFResultSchema,DXFStatusSchema} from '../packages/contracts/src/usp';
import {SourceFusionRequestSchema,type SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {assembleSourceFusion,fusionContextProjection,fusionSourceProjection,type SourceFusionDependencies} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,readFusionResult,readFusionObject,type FusionAuthority,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {fusionDXFMetadataProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion-dxf';
import {acceptedFusionDXFTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-dxf-authority';
import {associationLiterals,associationManualSelection} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {dxfInput,dxfArtifactKey,dxfResultKey} from '../packages/server/src/modules/usp/ingestion/dxf';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {dxfSummary} from '../packages/server/src/modules/usp/ingestion/dxf-processor';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// These tests protect literal preservation and whole-context private access.
// Retained native/status/document bytes are real. DXF IDs, job/result envelopes,
// SQL/storage and tool checks are separately labelled memory-only controls:
// the historical full DXF accepted result/input envelope was not retained.
const root=process.env.ULPIN_DXF_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-dxf-private-api/journey-corrected';
const originalRoot=process.env.ULPIN_DXF_ORIGINAL_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-dxf-native/sources';
const documentRoot=process.env.ULPIN_REFERENCE_DOCUMENT_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-reference-document-enrollment';
const samples={
  '1_polylines.dxf':{source:'37f57491672a9b330be08888200a8ad893d15af52af91e1c6be54b0c9cda75de',
    artifact:'1d26c542913cbd51dd35286fb04a0529acca96677e50f943924c4fd73304e285',ordinals:[33]},
  'ASCII_R12.dxf':{source:'b476d3e53fe24c1db3c701d20b2bebd774f7bd7966b12d81891505b9b29e4d21',
    artifact:'e926344244e4a73c6f6fcac93991fb8cd6883473ea88ecdca364eb5ac8d76166',ordinals:[1,0]}
};
const present=Object.keys(samples).every(name=>existsSync(root+'/'+name+'.native.json')&&existsSync(root+'/'+name+'.journey.json')&&
  existsSync(originalRoot+'/'+name))&&existsSync(documentRoot+'/epsg7415-accepted-result.json');
const hash='a'.repeat(64),uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const liveBudget=():FusionBudget=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal,reservedBytes:0});
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='fusion-dxf-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(name:keyof typeof samples='1_polylines.dxf'){
  const sample=samples[name],original=readFileSync(originalRoot+'/'+name),nativeBytes=readFileSync(root+'/'+name+'.native.json'),
    native=JSON.parse(nativeBytes.toString('utf8')),
    journey=JSON.parse(readFileSync(root+'/'+name+'.journey.json','utf8')),saved=DXFStatusSchema.parse(journey.status).result!;
  assert.equal(sha256(original),sample.source);assert.equal(sha256(nativeBytes),sample.artifact);
  assert.equal(saved.artifact.sha256,sample.artifact);assert.equal(saved.artifact.bytes,nativeBytes.length);
  const current={id:uuid(1),revision:1,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(current.id),
    marker=DXFOriginalSchema.parse({version:'dxf-native/1',subject:binding.subject,accessSha256:binding.access,
      sha256:sha256(original),bytes:original.length,receivedAt:'2026-10-03T00:00:00Z',lineageState:'caller_declared',
      lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['memory-only authority control']}}),
    source={id:uuid(2),case_id:current.id,family_id:uuid(2),revision:1,profile:'dxf-native-v1',sha256:sha256(original),bytes:original.length,
      object_key:`sources/${uuid(2)}/${sha256(original)}`,inspection:{dxfOriginal:marker}},
    tools={platform:'windows-x86_64' as const,pythonSha256:hash,profileSha256:hash,readerSha256:hash,
      supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash},
    input=dxfInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId:null})} as any,
      uuid(3),'complete_bounded_source',tools),
    result=DXFResultSchema.parse({version:'dxf-native/1',input,summary:dxfSummary(nativeBytes,input),
      artifact:{...saved.artifact,key:dxfArtifactKey(input.jobId,sample.artifact)},createdAt:'2026-10-03T00:00:00Z'}),
    resultBytes=Buffer.from(JSON.stringify(result)),
    dxfSelection:Extract<SourceFusionSelection,{kind:'dxf'}>={kind:'dxf',pin:{caseId:input.caseId,caseRevision:1,sourceId:input.sourceId,
      sourceRevision:1,sourceSha256:input.sourceSha256,jobId:input.jobId,resultSha256:sha256(resultBytes),resultBytes:resultBytes.length,
      readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1},entityOrdinals:sample.ordinals},
    job={id:input.jobId,operation:'dxf-native',case_id:input.caseId,source_id:input.sourceId,case_revision:1,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`dxf:${input.jobId}:${resultBytes.length}`,version:1,sha256:sha256(resultBytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:sha256(resultBytes)};
  assert.deepEqual(result.summary,saved.summary);
  const documentBytes=readFileSync(documentRoot+'/epsg7415-accepted-result.json'),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    enrollment=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((entry:any)=>entry.id==='epsg7415');
  assert.equal(sha256(documentBytes),enrollment.resultSha256);assert.equal(fingerprint(document.input),enrollment.inputSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:enrollment.caseId,caseRevision:enrollment.caseRevision,
    sourceId:enrollment.sourceId,sourceRevision:enrollment.sourceRevision,sourceSha256:enrollment.sourceSha256,jobId:enrollment.jobId,
    resultSha256:enrollment.resultSha256,resultBytes:enrollment.resultBytes,readerSha256:enrollment.readerSha256,
    inputSha256:enrollment.inputSha256,acceptedFence:enrollment.acceptedFence},partIds:[enrollment.selectedParts[0].id]};
  const objects=new Map([[dxfResultKey(input.jobId,sha256(resultBytes)),resultBytes],[result.artifact.key,nativeBytes],
    [documentResultKey(document.input.jobId,enrollment.resultSha256),documentBytes]]);
  const dxfAuthority:FusionAuthority={kind:'dxf',input,acceptedFence:1},docAuthority:FusionAuthority={kind:'document',input:document.input,acceptedFence:enrollment.acceptedFence};
  const read:typeof readFusionResult=(selection,authority,budget)=>readFusionResult(selection,authority,budget,
    (key,size,digest,bounds)=>readFusionObject(key,size,digest,bounds,async()=>{
      const bytes=objects.get(key);assert(bytes,`unexpected owned key: ${key}`);return {body:Readable.from([bytes]),etag:'memory-control'};
    }));
  return {current,source,job,original,native,nativeBytes,saved,result,dxfSelection,docSelection,document,dxfAuthority,docAuthority,read};
}
function authorityControl(f:ReturnType<typeof fixture>){
  let active=false,transactions=0,writes=0,toolChecks=0;
  const client={query:async(sql:string)=>{
    if(/^(INSERT|UPDATE|DELETE)\b/.test(sql))writes++;
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[f.current]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[f.source]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:1}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:[f.job]};
    if(sql.includes('SELECT accepted_fence'))return {rows:[{accepted_fence:f.docAuthority.acceptedFence}]};
    return {rows:[]};
  }};
  const deps={transaction:async(action:any)=>{transactions++;active=true;try{return await action(client);}finally{active=false;}},
    document:async()=>f.document.input,cityjson:async()=>assert.fail('no CityJSON authority'),gate:async()=>{},
    dxf:acceptedFusionDXFTx,dxfTools:()=>{assert(!active,'tool check held transaction');toolChecks++;}};
  const authority:typeof fusionAuthorityBatch=(ctx,selections,budget,expected)=>fusionAuthorityBatch(ctx,selections,budget,expected,deps as any);
  return {client,authority,stats:()=>({active,transactions,writes,toolChecks})};
}

test('retained DXF and document combined context preserves drawing literals; DXF is context-only', {skip:!present},()=>local(async()=>{
  const f=fixture(),control=authorityControl(f),ctx=localRequestContext(uuid(999)),events:string[]=[],request={sources:[f.docSelection,f.dxfSelection]};
  const deps:SourceFusionDependencies={authority:async(ctx,selections,budget,expected)=>{
    events.push(expected?'final-all':'initial-all');return control.authority(ctx,selections,budget,expected);
  },read:async(selection,authority,budget)=>{assert(!control.stats().active);events.push(`read:${selection.kind}`);return f.read(selection,authority,budget);}};
  const context=await assembleSourceFusion(ctx,request,deps),dxf=context.sources[0];assert(dxf.kind==='dxf');
  assert.deepEqual(events,['initial-all','read:dxf','read:document','final-all']);
  assert.deepEqual(control.stats(),{active:false,transactions:2,writes:0,toolChecks:2});
  assert.deepEqual(dxf.entities[0].record,f.native.entities[33]);assert.equal(dxf.entities[0].pointer,'/entities/33');
  assert.equal(dxf.entities[0].recordSha256,fingerprint(f.native.entities[33]));
  const fields=dxf.entities[0].record.fields as any;
  assert.equal(fields.handle.tags[0].value,'CB');assert.equal(fields.text.tags[0].value,'5 overlapping rectangles: lines');
  const tag=fields.text.tags[0],lines=f.original.toString('utf8').split(/\r?\n/);
  assert.equal(lines[tag.locator.valueLine-1],tag.rawValue);assert.equal(Number(lines[tag.locator.codeLine-1]),tag.code);
  assert.deepEqual(tag.locator,{tagIndex:1468,codeLine:2937,valueLine:2938});
  assert.deepEqual(dxf.reference.units,f.native.units);assert.equal(dxf.summary.units.name,'m');
  assert.deepEqual(dxf.reference.encoding,f.native.encoding);assert.deepEqual(dxf.reference.layers,f.native.layers);
  assert.equal(dxf.nativeIdentifierScope,'source_native_only; not_canonical_registry_ids');
  assert.equal(dxf.coverage.propertyMatching,'unsupported');assert.equal(context.association.state,'not_assessed');
  assert.deepEqual(context.association.canonicalTargets,[]);
  const doc=context.sources[1];assert(doc.kind==='document');assert.equal(doc.parts[0].part.text,'  <gml:name>RD + NAP height</gml:name>');
  const retained=fusionDXFMetadataProjection([33],f.native,f.saved.summary,f.saved.artifact);
  assert.equal(retained.selectionSha256,dxf.selectionSha256,'storage key must not change a source/artifact selection hash');
  const old=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/desktop-source-fusion-ocr/mixed-context.json','utf8'));
  assert.deepEqual(fusionContextProjection(old.sources),old);
  const contextOnly=(error:any)=>error.status===422&&error.code==='SOURCE_FUSION_DXF_CONTEXT_ONLY';
  assert.throws(()=>associationLiterals(context),contextOnly);
  assert.throws(()=>associationManualSelection({context:{selection:request}} as any,context,[]),contextOnly);
  await assert.rejects(()=>resolveFusionCitationsTx({query:()=>assert.fail('no citation I/O')} as any,ctx,
    {contextSha256:context.contextSha256,selection:request},{source:()=>assert.fail('no document authority')} as any),contextOnly);
  const proof=process.env.ULPIN_FUSION_DXF_PROOF_DIR;
  if(proof){mkdirSync(proof,{recursive:true});const save=(name:string,value:unknown)=>writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n');
    save('controlled-selection.json',SourceFusionRequestSchema.parse(request));save('controlled-context.json',context);
    save('retained-projection.json',{scope:'retained_DXF_native_and_status_plus_saved_document; historical_DXF_input_result_not_retained',
      dxf:{selectedEntityOrdinals:[33],metadata:retained},document:{selection:f.docSelection,projection:doc},association:'not_assessed'});
  }
}));

test('retained R12 DXF keeps absent units and INSERT transforms and exact referenced block', {skip:!present},()=>local(async()=>{
  const f=fixture('ASCII_R12.dxf'),metadata=fusionDXFMetadataProjection([1,0],f.native,f.saved.summary,f.saved.artifact);
  assert.deepEqual(metadata.entities.map(entry=>entry.ordinal),[0,1]);
  for(const entry of metadata.entities)assert.deepEqual(entry.record,f.native.entities[entry.ordinal]);
  assert.deepEqual(metadata.summary.units,{state:'absent',code:null,name:null});assert.deepEqual(metadata.reference.units,f.native.units);
  assert.deepEqual(metadata.reference.encoding,f.native.encoding);assert.equal(metadata.reference.units.conversion,null);
  const text=metadata.entities[0].record.fields as any,insert=metadata.entities[1].record.fields as any;
  assert.equal(text.handle.tags[0].value,'4A2');assert.equal(text.text.tags[0].value,f.native.entities[0].fields.text.tags[0].value);
  assert.deepEqual(insert.scaleX,{state:'absent',tags:[]});assert.deepEqual(insert.rotationDegrees,{state:'absent',tags:[]});
  const referenced=f.native.blocks.filter((block:any)=>block.fields.name.tags.some((tag:any)=>tag.value==='*U1'));
  assert.equal(referenced.length,1);assert.deepEqual(metadata.reference.blocks,referenced);
  assert.equal(metadata.coverage.blockExpansion,'not_performed');assert.equal(metadata.coverage.unselectedEntities,'not_expanded');
  const projected=fusionSourceProjection(f.dxfSelection,{kind:'dxf',result:f.result,native:f.native});assert(projected.kind==='dxf');
  assert.equal(projected.selectionSha256,metadata.selectionSha256);
  const proof=process.env.ULPIN_FUSION_DXF_PROOF_DIR;
  if(proof)writeFileSync(proof+'/retained-r12-projection.json',JSON.stringify({scope:'retained_native_status_only; no_canonical_job_envelope',metadata},null,2)+'\n');
}));

test('DXF stale pin rejects and revocation during later document I/O denies the whole response', {skip:!present},()=>local(async()=>{
  const f=fixture(),control=authorityControl(f),ctx=localRequestContext(uuid(999)),request={sources:[f.dxfSelection,f.docSelection]};
  await acceptedFusionDXFTx(control.client as any,f.dxfSelection.pin);
  await assert.rejects(()=>acceptedFusionDXFTx(control.client as any,{...f.dxfSelection.pin,resultSha256:hash}),
    (error:any)=>error.status===409&&error.code==='SOURCE_FUSION_STALE');
  for(const entityOrdinals of [[],[33,33],[33.5],[-1],[10000]])
    assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.dxfSelection,entityOrdinals},f.docSelection]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.dxfSelection,pin:{...f.dxfSelection.pin,resultBytes:16385}},f.docSelection]}).success);
  assert.throws(()=>fusionDXFMetadataProjection([9999],f.native,f.saved.summary,f.saved.artifact),(error:any)=>error.status===422);
  let reads=0;
  await assert.rejects(()=>assembleSourceFusion(ctx,request,{authority:control.authority,read:async(selection,authority,budget)=>{
    assert(!control.stats().active);const loaded=await f.read(selection,authority,budget);reads++;
    if(selection.kind==='document')f.current.archived=true;return loaded;
  }}),(error:any)=>error.status===403&&error.code==='SOURCE_FUSION_UNAVAILABLE');
  assert.equal(reads,2);assert.deepEqual(control.stats(),{active:false,transactions:2,writes:0,toolChecks:1});
  const bytes=Buffer.from(JSON.stringify({...f.result,artifact:{...f.result.artifact,key:'wrong-job-artifact'}}));
  await assert.rejects(()=>readFusionResult({...f.dxfSelection,pin:{...f.dxfSelection.pin,resultBytes:bytes.length,resultSha256:sha256(bytes)}},
    f.dxfAuthority,liveBudget(),async()=>bytes),(error:any)=>error.status===422);
}));
