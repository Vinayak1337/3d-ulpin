import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
// Import leaf first: shared-union initialization must remain independent.
import {SourceFusionPointSelectionSchema} from '../packages/contracts/src/source-fusion-point';
import {SOURCE_FUSION_LIMITS,SourceFusionRequestSchema} from '../packages/contracts/src/source-fusion';
import {PointOriginalSchema,PointBatchResultSchema} from '../packages/contracts/src/usp/point-batch';
import {DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {pointInput,pointResultKey,pointArtifactKey,PointBatchService} from '../packages/server/src/modules/usp/ingestion/point-batch';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {readPointObject} from '../packages/server/src/modules/usp/ingestion/point-batch-object';
import {fusionAuthorityBatch,readFusionObject,readFusionResult,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {assembleSourceFusion} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {associationLiterals} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Canonical point capture, complete-set fusion, bounded receipt and projections
// execute over memory SQL/storage/document authority controls. Retained original
// and metadata are unchanged. Input/envelope/fence below are reconstructed controls,
// NOT missing historical accepted proof. No historical record artifact, decoder or native process.
const root='E:/BhuAayam-data/task-data/desktop-ai05b-point',
  originalPath='E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-lidar-2017.laz',
  docPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const present=existsSync(root+'/point-http-final.json')&&existsSync(originalPath)&&existsSync(docPath);
const code=(name:string)=>(e:any)=>e.code===name;
function fixture(technical=false,index=0){
  const oldBytes=readFileSync(root+'/point-http-final.json'),old=JSON.parse(oldBytes.toString('utf8')),retained=old.results[index],
    earlier=JSON.parse(readFileSync(root+'/point-http-source-retain.json','utf8')),original=readFileSync(originalPath),
    manifest=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json','utf8')),
    upstream=manifest.originals.find((v:any)=>v.name==='20170504_980200.copc.laz');
  assert.equal(sha256(oldBytes),'1c9f4f94bf3ebbeacae4549dd582d6fc369bda000b864524d3272114213bf4f2');
  assert.equal(sha256(original),old.sourceSha256);assert.equal(original.length,old.sourceBytes);
  const current={id:old.caseId,revision:earlier.first.currentCaseRevision,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(current.id),
    marker=PointOriginalSchema.parse({version:'point-batch/1',subject:binding.subject,sha256:old.sourceSha256,bytes:old.sourceBytes,
      receivedAt:earlier.first.result.createdAt,lineageState:'caller_declared',lineage:{kind:'native_point_derivative',issuer:'NOAA distribution of NYC 2017 survey',
        originalUrl:upstream.url,acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.coverage,
        upstreamBytes:upstream.bytes,upstreamRetained:true,parentSha256:upstream.sha256,limitations:manifest.limitations,note:'memory-only authority control'}}),
    source={id:old.sourceId,case_id:current.id,family_id:old.sourceId,revision:earlier.first.sourceRevision,profile:'laz-point-v1',
      sha256:old.sourceSha256,bytes:old.sourceBytes,object_key:'sources/'+old.sourceId+'/'+old.sourceSha256,inspection:{pointOriginal:marker}},
    input=pointInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId:null})},retained.jobId,index?retained.metadata.batch:null),
    technicalBytes=Buffer.alloc(retained.artifact.bytes,0x78);
  technicalBytes.write('FUSION-POINT-01 NON-NATIVE RECORD TRANSPORT CONTROL');
  const artifactHash=technical?sha256(technicalBytes):retained.artifact.sha256,
    result=PointBatchResultSchema.parse({version:'point-batch/1',input,metadata:retained.metadata,
      artifact:{key:pointArtifactKey(input.jobId,artifactHash),sha256:artifactHash,bytes:retained.artifact.bytes,mediaType:'application/vnd.las.point-records'},
      createdAt:new Date(0).toISOString()}),bytes=Buffer.from(JSON.stringify(result)),digest=fingerprint(input),
    job={id:input.jobId,operation:'point-batch',case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,
      payload:input,input_fingerprint:digest,input_manifest_id:input.sourceId,input_sha256:digest,scope:{kind:'intake',workspaceId:input.caseId,version:input.caseRevision+1},
      status:'succeeded',error:null,logical_state:'succeeded',result_ref:{assetId:'point:'+input.jobId,version:1,sha256:sha256(bytes)},accepted_fence:1,
      attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:digest,completion_sha256:sha256(bytes)},
    point=SourceFusionPointSelectionSchema.parse({kind:'point',pin:{caseId:input.caseId,caseRevision:input.caseRevision,
      sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,jobId:input.jobId,
      resultSha256:sha256(bytes),resultBytes:bytes.length,readerSha256:input.readerSha256,inputSha256:digest,acceptedFence:1},
      artifactSha256:result.artifact.sha256,metadataSha256:fingerprint(result.metadata),batch:result.metadata.batch});
  const docBytes=readFileSync(docPath),document=DocumentResultSchema.parse(JSON.parse(docBytes.toString('utf8'))),
    entry=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8'))
      .enrollments.find((v:any)=>v.id==='epsg7415');
  assert.equal(sha256(docBytes),entry.resultSha256);assert.equal(fingerprint(document.input),entry.inputSha256);
  const doc={kind:'document' as const,pin:{caseId:entry.caseId,caseRevision:entry.caseRevision,sourceId:entry.sourceId,
    sourceRevision:entry.sourceRevision,sourceSha256:entry.sourceSha256,jobId:entry.jobId,resultSha256:entry.resultSha256,
    resultBytes:entry.resultBytes,readerSha256:entry.readerSha256,inputSha256:entry.inputSha256,acceptedFence:entry.acceptedFence},
    partIds:[entry.selectedParts[0].id]},
    objects=new Map([[pointResultKey(input.jobId,sha256(bytes)),bytes],[documentResultKey(document.input.jobId,entry.resultSha256),docBytes]]);
  if(technical)objects.set(result.artifact.key,technicalBytes);
  return {old,retained,original,current,source,input,result,bytes,job,point,doc,document,objects,technicalBytes};
}
function control(f:ReturnType<typeof fixture>){
  let active=false,captures=0,reservedBytes=0,afterRead:(key:string)=>void=()=>{};
  const reads:string[]=[],queries:string[]=[],streams:Readable[]=[],heads:string[]=[],deadlines:number[]=[];
  const client={query:async(sql:string,args:any[]=[])=>{
    assert(active);queries.push(sql);assert(!/^(INSERT|UPDATE|DELETE)\b/.test(sql));
    if(sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources'))return {rows:[]};
    if(sql.startsWith('SELECT accepted_fence FROM usp_job_metadata'))return {rows:[{accepted_fence:f.doc.pin.acceptedFence}]};
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[structuredClone(f.current)]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[structuredClone(f.source)]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:f.source.revision}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:args[0]===f.input.jobId?[structuredClone(f.job)]:[]};
    assert.fail('unexpected SQL '+sql);
  }};
  const transaction:any=async(work:any,bounds:any)=>{assert(bounds.deadlineAt>Date.now());deadlines.push(bounds.deadlineAt);
    assert(!active);captures++;active=true;try{return await work(client);}finally{active=false;}};
  const authority:typeof fusionAuthorityBatch=(ctx,selections,budget,expected)=>fusionAuthorityBatch(ctx,selections,budget,expected,{
    transaction,
    gate:async()=>{},cityjson:async()=>assert.fail('unexpected CityJSON'),
    document:async(_client,_ctx,pin)=>{assert.equal(pin.inputSha256,fingerprint(f.document.input));return f.document.input;}});
  const read:typeof readFusionObject=(key,size,hash,budget)=>readFusionObject(key,size,hash,budget,async()=>{
    assert(!active,'I/O held complete-set SQL locks');reads.push(key);const bytes=f.objects.get(key);assert(bytes,'unselected batch/pixels fetched');
    const body=Readable.from([bytes]);streams.push(body);return {body,etag:'memory'};
  });
  const deps={authority,read:((selection,a,budget)=>readFusionResult(selection,a,budget,read).then(loaded=>{reservedBytes=budget.reservedBytes;return loaded;})) as typeof readFusionResult};
  const pointObject:typeof readPointObject=async(key,hash,size,bounds)=>{
    assert(!active);deadlines.push(bounds!.deadlineAt);
    const bytes=await readPointObject(key,hash,size,bounds,{head:async key=>{assert(!active);heads.push(key);const bytes=f.objects.get(key);assert(bytes);
      return {bytes:bytes.length,etag:'memory'};},open:async(key,size,_timeout,etag)=>{assert(!active);reads.push(key);const bytes=f.objects.get(key);assert(bytes);
      assert.equal(bytes.length,size);if(key.endsWith('.json'))assert.equal(etag,'memory');const body=Readable.from([bytes]);streams.push(body);return {body,etag:'memory'};}});
    afterRead(key);return bytes;
  };
  return {deps,read,reads,queries,streams,heads,deadlines,service:new PointBatchService({transaction,object:pointObject}),
    setAfterRead:(fn:typeof afterRead)=>{afterRead=fn;},stats:()=>({active,captures,reservedBytes})};
}
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='point-fusion-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function save(name:string,value:unknown){const dir=process.env.ULPIN_FUSION_POINT_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('retained point metadata and EPSG fragment assemble through exact canonical capture without point-record reads',{skip:!present},()=>local(async()=>{
  const f=fixture(),c=control(f),ctx=localRequestContext('point-mixed-control'),selection={sources:[f.point,f.doc]},
    context=await assembleSourceFusion(ctx,selection,c.deps),point=context.sources.find(s=>s.kind==='point'),doc=context.sources.find(s=>s.kind==='document');
  assert(point?.kind==='point'&&doc?.kind==='document');assert.deepEqual(point.metadata,f.retained.metadata);
  assert.equal(point.metadataSha256,fingerprint(point.metadata));assert.equal(point.metadata.sourcePointCount,1726222);
  assert.equal(point.metadata.verticalReference,'NAVD88 height');assert.equal(point.metadata.verticalReferenceStatus,'known');
  assert.equal(point.metadata.globalPlacement,'not_qualified');assert.equal(point.metadata.horizontalAuthority,'EPSG:6347');
  assert.equal(point.metadata.gpsTimeType,'week_time');assert.equal(point.metadata.recordEncoding,'las-1.4-point-format-6-le');
  assert.equal(point.coverage.pointRecords,'not_read');
  assert.equal(doc.parts[0].part.text,f.document.native.parts.find(p=>p.id===f.doc.partIds[0])!.text);
  assert.equal(context.association.state,'not_assessed');assert.equal(context.association.crossSourceFrameAlignment,'not_assessed');
  assert.equal(c.reads.length,2);assert(!c.reads.includes(f.result.artifact.key));assert(c.streams.every(s=>s.destroyed));
  assert.deepEqual(c.stats(),{active:false,captures:2,reservedBytes:[...f.objects.values()].reduce((n,b)=>n+b.length,0)});
  assert.equal(c.queries.filter(s=>s.includes('SELECT j.*,m.result_ref')).length,2);
  assert(c.queries.filter(s=>s.includes('SELECT j.*,m.result_ref')).every(s=>s.includes('FOR SHARE OF j,m')));
  const json=JSON.stringify(context);assert(!json.includes(f.result.artifact.key));assert(!json.includes(f.input.objectKey));
  const repeat=await assembleSourceFusion(ctx,{sources:[f.doc,f.point]},c.deps);assert.deepEqual(repeat,context);
  await assert.rejects(()=>proposeFusionAssociations(ctx,{requestKey:'00000000-0000-4000-8000-000000000001',
    context:{contextSha256:context.contextSha256,selection},scope:null,targets:[]},{} as any),code('SOURCE_FUSION_POINT_CONTEXT_ONLY'));
  await assert.rejects(()=>resolveFusionCitationsTx(null as any,ctx,{contextSha256:context.contextSha256,selection},{} as any,
    '00000000-0000-4000-8000-000000000002'),code('SOURCE_FUSION_POINT_CONTEXT_ONLY'));
  assert.throws(()=>associationLiterals(context),code('SOURCE_FUSION_POINT_CONTEXT_ONLY'));
  // Count the point fragment toward the existing total; no source/batch expansion.
  const parts=Array.from({length:25},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  assert(!SourceFusionRequestSchema.safeParse({sources:[f.point,{...f.doc,partIds:parts}]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[f.point,f.point]}).success);
  save('mixed-context.json',{qualification:'retained original/metadata/document; reconstructed point input/envelope/fence and memory SQL/storage/document authority; no historical native record proof',
    selection,context,initialCaptures:2,initialReads:2,receiptOnly:true,associationAndCitationDenied:true,stableRepeat:true,
    original:{path:originalPath,bytes:f.original.length,sha256:sha256(f.original)},resultObjectUtf8:f.bytes.toString('utf8')});
}));

test('private first/later point status preserves retained metadata; exact enrollment/attempt and post-I/O recapture protect reads',{skip:!present},()=>local(async()=>{
  const outputs=[];
  for(const index of [0,1]){
    const f=fixture(false,index),c=control(f),status=await c.service.status(f.input.caseId,f.input.sourceId,f.input.jobId);
    assert.equal(status.status,'completed');assert.deepEqual(status.result!.metadata,f.retained.metadata);
    assert.equal(c.reads.length,1);assert(c.reads[0].endsWith('.json'));assert.equal(c.heads.length,1);assert.equal(new Set(c.deadlines).size,1);
    assert(c.streams.every(s=>s.destroyed));outputs.push({index,status,reads:c.reads});
  }
  const f=fixture(),c=control(f),call=()=>c.service.status(f.input.caseId,f.input.sourceId,f.input.jobId);
  f.job.input_manifest_id='00000000-0000-4000-8000-000000000001';await assert.rejects(call,code('POINT_JOB_INTEGRITY'));assert.equal(c.reads.length,0);
  f.job.input_manifest_id=f.input.sourceId;f.job.completion_sha256='0'.repeat(64);
  await assert.rejects(call,code('POINT_NOT_ACCEPTED'));assert.equal(c.reads.length,0);f.job.completion_sha256=f.point.pin.resultSha256;
  c.setAfterRead(()=>{f.job.accepted_fence=f.job.attempt_fence=2;});await assert.rejects(call,code('POINT_READ_CHANGED'));
  save('private-read-authority.json',{qualification:'retained first/later metadata; reconstructed input/envelope/fence; SQL/storage controls',
    outputs,unenrolledDenied:true,unacceptedCompletionDenied:true,finalFenceChangedDenied:true,historicalNativeRecordsReproduced:false});
}));

test('technical point artifact transport recaptures exact result and denies source revocation; pending/outage statuses need no objects',{skip:!present},()=>local(async()=>{
  const f=fixture(true),c=control(f),call=()=>c.service.artifact(f.input.caseId,f.input.sourceId,f.input.jobId),output=await call();
  assert.deepEqual(output.bytes,f.technicalBytes);assert.equal(output.sha256,sha256(f.technicalBytes));assert(c.streams.every(s=>s.destroyed));
  c.setAfterRead(key=>{if(key.endsWith('.bin'))f.job.error='changed-result-capture-control';});await assert.rejects(call,code('POINT_READ_CHANGED'));
  f.job.error=null;c.setAfterRead(key=>{if(key.endsWith('.bin'))f.current.archived=true;});await assert.rejects(call,code('POINT_DENIED'));
  const pending=fixture(),p=control(pending),statuses=[];
  for(const state of ['queued','running','failed'] as const){pending.job.status=state;pending.job.logical_state=state;
    pending.job.error=state==='failed'?'POINT_PROCESSOR_UNAVAILABLE':null;
    const s=await p.service.status(pending.input.caseId,pending.input.sourceId,pending.input.jobId);assert.equal(s.status,state);assert.equal(s.result,null);statuses.push(s.status);}
  pending.current.revision++;const stale=await p.service.status(pending.input.caseId,pending.input.sourceId,pending.input.jobId);
  assert.equal(stale.status,'stale');assert.equal(stale.code,'POINT_INPUT_STALE');assert.equal(p.reads.length,0);
  save('technical-artifact-and-outage.json',{qualification:'explicit NON-NATIVE record transport bytes; no historical/native accuracy proof',
    bytes:output.bytes.length,sha256:output.sha256,finalCaptureDenied:true,revocationDenied:true,statuses,staleStatus:stale.status,noPendingObjectReads:true});
}));

test('point receipt HEAD/ETag and native-artifact byte caps refuse before buffering and streams enforce exact hash/length',{skip:!present},()=>local(async()=>{
  const f=fixture(),bounds={deadlineAt:Date.now()+1000},key=pointResultKey(f.input.jobId,f.point.pin.resultSha256);let opened=0;
  await assert.rejects(()=>readPointObject(key,f.point.pin.resultSha256,null,bounds,{head:async()=>({bytes:32769,etag:'memory'}),
    open:async()=>{opened++;assert.fail('oversized receipt GET');}}),code('POINT_OBJECT_LIMIT'));assert.equal(opened,0);
  await assert.rejects(()=>readPointObject(key,f.point.pin.resultSha256,null,bounds,{head:async()=>({bytes:f.bytes.length,etag:undefined}),
    open:async()=>assert.fail('missing ETag GET')}),code('POINT_RESULT_INTEGRITY'));
  await assert.rejects(()=>readPointObject(f.result.artifact.key,f.result.artifact.sha256,524289,bounds),code('POINT_OBJECT_LIMIT'));
  const body=Readable.from([Buffer.concat([f.bytes,Buffer.from('excess')])]);
  await assert.rejects(()=>readPointObject(key,f.point.pin.resultSha256,f.bytes.length,bounds,{head:async()=>assert.fail('known-size HEAD'),
    open:async()=>({body,etag:'memory'})}),code('POINT_OBJECT_INTEGRITY'));assert(body.destroyed);
  await assert.rejects(()=>readPointObject(key,f.point.pin.resultSha256,f.bytes.length,{deadlineAt:Date.now()-1}),code('POINT_READ_DEADLINE'));
  save('bounded-point-read.json',{qualification:'technical receipt/artifact transport bounds; no services',oversizedHeadBeforeGet:true,
    missingETagDenied:true,artifactCapBeforeGet:true,excessBytesDenied:true,streamDestroyed:true,expiredBeforeIo:true});
}));

test('wrong accepted pins/batch and final point revocation or recapture drift deny the entire mixed context',{skip:!present},()=>local(async()=>{
  const ctx=localRequestContext('point-denial-control'),outcomes=[];
  for(const mode of ['fence','batch','metadata','revoked','capture'] as const){
    const f=fixture(),c=control(f);let point=f.point;
    if(mode==='fence')point={...point,pin:{...point.pin,acceptedFence:2}};
    if(mode==='batch')point={...point,batch:{...point.batch,start:1}};
    if(mode==='metadata')point={...point,metadataSha256:'0'.repeat(64)};
    const deps={...c.deps,read:async(s:any,a:any,b: any)=>{const loaded=await c.deps.read(s,a,b);
      if(s.kind==='point'){if(mode==='revoked')f.current.archived=true;if(mode==='capture')f.job.error='changed-after-read-control';}return loaded;}};
    await assert.rejects(()=>assembleSourceFusion(ctx,{sources:[point,f.doc]},deps),
      (e:any)=>e.code===(mode==='fence'||mode==='capture'?'SOURCE_FUSION_STALE':'SOURCE_FUSION_UNAVAILABLE'));
    assert(!c.reads.includes(f.result.artifact.key));assert(!c.stats().active);
    if(mode==='fence')assert.equal(c.reads.length,0);
    outcomes.push({mode,published:false,reads:c.reads,stats:c.stats()});
  }
  const f=fixture(),c=control(f),b:FusionBudget={deadlineAt:Date.now()+1000,signal:new AbortController().signal,reservedBytes:SOURCE_FUSION_LIMITS.aggregateArtifactBytes};
  await assert.rejects(()=>c.read(pointResultKey(f.input.jobId,f.point.pin.resultSha256),f.bytes.length,f.point.pin.resultSha256,b),
    code('SOURCE_FUSION_ARTIFACT_LIMIT'));assert.equal(c.reads.length,0);
  save('authority-denials.json',{qualification:'memory source/batch/fence/metadata/full-capture and aggregate-budget controls',outcomes,aggregateLimitBeforeOpen:true});
}));
