import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {DocumentResultSchema,IFCOriginalSchema,IFCResultSchema} from '../packages/contracts/src/usp';
import {SourceFusionRequestSchema,type SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {assembleSourceFusion,fusionContextProjection,type SourceFusionDependencies} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,readFusionResult,readFusionObject,type FusionAuthority,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {fusionIFCMetadataProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion-ifc';
import {acceptedFusionIFCTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-ifc-authority';
import {associationLiterals,associationManualSelection} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {ifcInput} from '../packages/server/src/modules/usp/ingestion/ifc';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ifcSummary} from '../packages/server/src/modules/usp/ingestion/ifc-processor';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Unchanged development artifacts and one authentic saved document output.
// IFC canonical IDs/accepted rows below are explicitly in-memory protocol
// controls, not a retained accepted job, operational property or learning label.
const root=process.env.ULPIN_IFC_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-ifc-native';
const documentRoot=process.env.ULPIN_REFERENCE_DOCUMENT_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-reference-document-enrollment';
const present=existsSync(root+'/outputs/final/ifc2x3.json')&&existsSync(documentRoot+'/epsg7415-accepted-result.json');
const hash='a'.repeat(64),uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const liveBudget=():FusionBudget=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal,reservedBytes:0});
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='fusion-ifc-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(){
  const original=readFileSync(root+'/originals/ifc2x3-building-architecture.ifc'),nativeBytes=readFileSync(root+'/outputs/final/ifc2x3.json'),
    native=JSON.parse(nativeBytes.toString('utf8'));
  assert.equal(sha256(original),'c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885');
  assert.equal(sha256(nativeBytes),'66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a');
  const current={id:uuid(1),revision:1,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(current.id),
    marker=IFCOriginalSchema.parse({version:'ifc-native/1',subject:binding.subject,accessSha256:binding.access,
      sha256:sha256(original),bytes:original.length,receivedAt:'2026-10-01T00:00:00Z',lineageState:'caller_declared',
      lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['in-memory authority control only']}}),
    source={id:uuid(2),case_id:current.id,family_id:uuid(2),revision:1,profile:'ifc-native-v1',sha256:sha256(original),bytes:original.length,
      object_key:`sources/${uuid(2)}/${sha256(original)}`,inspection:{ifcOriginal:marker}},
    tools={platform:'windows-x86_64' as const,pythonSha256:hash,profileSha256:hash,readerSha256:hash,
      supervisorSha256:hash,dependencyLockSha256:hash,codeSha256:hash},
    input=ifcInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId:null})} as any,uuid(3),'complete_bounded_source',tools),
    result=IFCResultSchema.parse({version:'ifc-native/1',input,summary:ifcSummary(nativeBytes,input),
      artifact:{key:`ifc-native/${input.jobId}/${sha256(nativeBytes)}.native.json`,sha256:sha256(nativeBytes),bytes:nativeBytes.length,
        profile:'ulpin-native-ifc/1',mediaType:'application/json'},createdAt:'2026-10-01T00:00:00Z'}),
    resultBytes=Buffer.from(JSON.stringify(result)),
    ifcSelection:Extract<SourceFusionSelection,{kind:'ifc'}>={kind:'ifc',pin:{caseId:input.caseId,caseRevision:1,sourceId:input.sourceId,
      sourceRevision:1,sourceSha256:input.sourceSha256,jobId:input.jobId,resultSha256:sha256(resultBytes),resultBytes:resultBytes.length,
      readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1},stepIds:[183,25,36]},
    job={id:input.jobId,operation:'ifc-native',case_id:input.caseId,source_id:input.sourceId,case_revision:1,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`ifc:${input.jobId}:${resultBytes.length}`,version:1,sha256:sha256(resultBytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:sha256(resultBytes)};
  const documentBytes=readFileSync(documentRoot+'/epsg7415-accepted-result.json'),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    enrollment=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((entry:any)=>entry.id==='epsg7415');
  assert.equal(sha256(documentBytes),enrollment.resultSha256);assert.equal(fingerprint(document.input),enrollment.inputSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:enrollment.caseId,caseRevision:enrollment.caseRevision,
    sourceId:enrollment.sourceId,sourceRevision:enrollment.sourceRevision,sourceSha256:enrollment.sourceSha256,jobId:enrollment.jobId,
    resultSha256:enrollment.resultSha256,resultBytes:enrollment.resultBytes,readerSha256:enrollment.readerSha256,
    inputSha256:enrollment.inputSha256,acceptedFence:enrollment.acceptedFence},partIds:[enrollment.selectedParts[0].id]};
  const objects=new Map([[`ifc-native/${input.jobId}/${sha256(resultBytes)}.json`,resultBytes],[result.artifact.key,nativeBytes],
    [documentResultKey(document.input.jobId,enrollment.resultSha256),documentBytes]]);
  const ifcAuthority:FusionAuthority={kind:'ifc',input,acceptedFence:1},docAuthority:FusionAuthority={kind:'document',input:document.input,acceptedFence:enrollment.acceptedFence};
  const read:typeof readFusionResult=(selection,authority,budget)=>readFusionResult(selection,authority,budget,
    (key,size,digest,bounds)=>readFusionObject(key,size,digest,bounds,async()=>{
      const bytes=objects.get(key);assert(bytes,`unexpected owned object key: ${key}`);return {body:Readable.from([bytes]),etag:'memory-control'};
    }));
  return {current,source,job,original,native,nativeBytes,result,ifcSelection,docSelection,document,documentBytes,ifcAuthority,docAuthority,read};
}

test('IFC plus retained document preserves selected native literals, hierarchy, units and naturally missing frame', {skip:!present},()=>local(async()=>{
  const f=fixture(),ctx=localRequestContext(uuid(999)),events:string[]=[],request={sources:[f.docSelection,f.ifcSelection]};
  const deps:SourceFusionDependencies={authority:async(_ctx,selections,_budget,expected)=>{
    events.push(expected?'final-all':'initial-all');return selections.map(selection=>selection.kind==='ifc'?f.ifcAuthority:f.docAuthority);
  },read:async(selection,authority,budget)=>{events.push(`read:${selection.kind}`);return f.read(selection,authority,budget);}};
  const context=await assembleSourceFusion(ctx,request,deps),ifc=context.sources[0];assert.equal(ifc.kind,'ifc');assert(ifc.kind==='ifc');
  assert.deepEqual(events,['initial-all','read:ifc','read:document','final-all']);
  assert.deepEqual(ifc.entities.map(entry=>entry.record.stepId),[25,36,183]);
  for(const entry of [...ifc.entities,...ifc.relations,...ifc.supportRecords]){
    assert.deepEqual(entry.record,f.native.records[Number(entry.pointer.split('/').at(-1))]);
    for(const attribute of Object.values(entry.record.attributes) as any[])
      if(attribute.rawLiteral!==null)assert.equal(f.original.subarray(attribute.locator.byteStart,attribute.locator.byteEnd).toString('latin1'),attribute.rawLiteral);
  }
  assert.deepEqual(ifc.entities[0].record.attributes.Elevation,{state:'absent',value:null,rawLiteral:null,
    locator:{attribute:'Elevation',stepId:25},reason:'not_in_schema_entity'});
  assert.equal((ifc.entities[0].record.attributes.ElevationOfRefHeight as any).state,'null');
  assert.equal((ifc.entities[1].record.attributes.Elevation as any).value,0);
  assert.equal((ifc.entities[0].record.attributes.GlobalId as any).value,'0c$N1CTon2BB2Sp89385G8');
  assert.equal(ifc.nativeIdentifierScope,'source_native_only; not_canonical_registry_ids');
  assert.deepEqual(ifc.hierarchy.map(entry=>entry.parentStepIds),[[18],[25],[36]]);
  assert.equal(ifc.reference.georeference.state,'missing_or_unqualified');assert.equal(ifc.reference.georeference.globalTransformApplied,false);
  assert(ifc.supportRecords.some(entry=>entry.record.entityType==='IfcSIUnit'));
  assert(![...ifc.supportRecords,...ifc.entities].some(entry=>entry.record.stepId===296));
  assert.equal(context.association.crossSourceFrameAlignment,'not_assessed');assert.deepEqual(context.association.canonicalTargets,[]);
  const oldContext=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/desktop-source-fusion-ocr/mixed-context.json','utf8'));
  assert.deepEqual(fusionContextProjection(oldContext.sources),oldContext);
  assert.throws(()=>associationLiterals(context),(error:any)=>error.code==='SOURCE_FUSION_IFC_CONTEXT_ONLY');
  assert.throws(()=>associationManualSelection({context:{selection:request}} as any,context,[]),(error:any)=>error.code==='SOURCE_FUSION_IFC_CONTEXT_ONLY');
  await assert.rejects(()=>resolveFusionCitationsTx({query:()=>assert.fail('no citation I/O')} as any,ctx,
    {contextSha256:context.contextSha256,selection:request},{source:()=>assert.fail('no document authority')} as any),
    (error:any)=>error.code==='SOURCE_FUSION_IFC_CONTEXT_ONLY');
  const proof=process.env.ULPIN_FUSION_IFC_PROOF_DIR;
  if(proof){mkdirSync(proof,{recursive:true});const save=(name:string,value:unknown)=>writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n');
    save('controlled-selection.json',SourceFusionRequestSchema.parse(request));save('controlled-context.json',context);
    save('retained-projection.json',{scope:'retained_native_metadata_plus_saved_document; canonical_IFC_envelope_not_retained',
      ifc:{selectedStepIds:f.ifcSelection.stepIds,metadata:fusionIFCMetadataProjection(f.ifcSelection.stepIds,f.native,f.result.summary,f.result.artifact)},
      document:{selection:f.docSelection,projection:context.sources[1]},association:'not_assessed'});
  }
}));

test('IFC wrong selection and accepted pins deny; revocation during later document I/O denies the complete context', {skip:!present},()=>local(async()=>{
  const f=fixture(),ctx=localRequestContext(uuid(999));let active=false,transactions=0,reads=0,writes=0,toolChecks=0;
  const client={query:async(sql:string)=>{
    if(/^(INSERT|UPDATE|DELETE)\b/.test(sql))writes++;
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[f.current]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[f.source]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:1}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:[f.job]};
    if(sql.includes('SELECT accepted_fence'))return {rows:[{accepted_fence:1}]};
    return {rows:[]};
  }};
  await acceptedFusionIFCTx(client as any,f.ifcSelection.pin);
  await assert.rejects(()=>acceptedFusionIFCTx(client as any,{...f.ifcSelection.pin,resultBytes:f.ifcSelection.pin.resultBytes+1}),
    (error:any)=>error.status===409);
  await assert.rejects(()=>acceptedFusionIFCTx(client as any,{...f.ifcSelection.pin,resultSha256:hash}),(error:any)=>error.status===409);
  const request={sources:[f.ifcSelection,f.docSelection]};
  for(const stepIds of [[],[25,25],[25.5]])assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.ifcSelection,stepIds},f.docSelection]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.ifcSelection,pin:{...f.ifcSelection.pin,resultBytes:16385}},f.docSelection]}).success);
  assert.throws(()=>fusionIFCMetadataProjection([7],f.native,f.result.summary,f.result.artifact),(error:any)=>error.status===422);
  assert.throws(()=>fusionIFCMetadataProjection([999999],f.native,f.result.summary,f.result.artifact),(error:any)=>error.status===422);
  const authorityDeps={transaction:async(action:any)=>{transactions++;active=true;try{return await action(client);}finally{active=false;}},
    document:async()=>f.document.input,cityjson:async()=>assert.fail('no CityJSON authority'),gate:async()=>{},
    ifc:acceptedFusionIFCTx,ifcTools:()=>{assert(!active);toolChecks++;}};
  const deps:SourceFusionDependencies={authority:(ctx,selections,budget,expected)=>fusionAuthorityBatch(ctx,selections,budget,expected,authorityDeps as any),
    read:async(selection,authority,budget)=>{assert(!active);const loaded=await f.read(selection,authority,budget);reads++;
      if(selection.kind==='document')f.current.archived=true;return loaded;}};
  await assert.rejects(()=>assembleSourceFusion(ctx,request,deps),(error:any)=>error.status===403&&error.code==='SOURCE_FUSION_UNAVAILABLE');
  assert.equal(transactions,2);assert.equal(reads,2);assert.equal(toolChecks,1);assert.equal(writes,0);
  const bytes=Buffer.from(JSON.stringify({...f.result,artifact:{...f.result.artifact,key:'wrong-job-artifact'}}));
  await assert.rejects(()=>readFusionResult({...f.ifcSelection,pin:{...f.ifcSelection.pin,resultBytes:bytes.length,resultSha256:sha256(bytes)}},
    f.ifcAuthority,liveBudget(),async()=>bytes),(error:any)=>error.status===422);
}));
