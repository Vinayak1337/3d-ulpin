import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {DXFOriginalSchema} from '../packages/contracts/src/usp/dxf-ingestion';
import {GeoParquetOriginalSchema,GeoParquetResultSchema} from '../packages/contracts/src/usp/geoparquet-ingestion';
import {SufficiencyPlanarProcessingSchema} from '../packages/contracts/src/usp/sufficiency-planar';
import {sufficiencyPlanarOriginalTx,sufficiencyPlanarEvidenceTx,planarGeoParquetReceiptCache} from '../packages/server/src/modules/usp/ingestion/sufficiency-planar';
import {geoparquetSourceTx,geoparquetInput,geoparquetStatusTx,assertGeoParquetInputTx,geoparquetContinuationTx,
  geoparquetReaderSha,geoparquetStatusAuthorityTx} from '../packages/server/src/modules/usp/ingestion/geoparquet';
import {readFusionObject,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

// Real retained test_only originals/producer receipts; disclosed in-memory
// case/source/job/SQL controls. No current accepted envelope is manufactured.
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const geoJourney=()=>JSON.parse(readFileSync('E:/BhuAayam-data/task-data/desktop-geoparquet-continuation/journey-01/continuation.journey.json','utf8'));
const dxfJourney=()=>JSON.parse(readFileSync('E:/BhuAayam-data/task-data/desktop-dxf-private-api/journey-corrected/1_polylines.dxf.journey.json','utf8'));
const budget=():FusionBudget=>({deadlineAt:Date.now()+30_000,signal:AbortSignal.timeout(30_000),reservedBytes:0});
const code=(status:number)=>(error:any)=>error.status===status;
function save(name:string,value:unknown){const root=process.env.ULPIN_PLANAR_SUFFICIENCY_PROOF_DIR;
  if(root)writeFileSync(root+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
async function local(action:()=>Promise<void>,subject='planar-sufficiency-control'){
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await action();}finally{if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
}
function fixture(kind:'dxf'|'geoparquet',retained?:ReturnType<typeof GeoParquetResultSchema.parse>){
  const path=kind==='dxf'?'E:/BhuAayam-data/task-data/desktop-dxf-native/sources/1_polylines.dxf'
    :'E:/BhuAayam-data/task-data/desktop-geoparquet-native/originals/example.parquet',original=readFileSync(path),input=retained?.input;
  assert.equal(sha256(original),kind==='dxf'?'37f57491672a9b330be08888200a8ad893d15af52af91e1c6be54b0c9cda75de'
    :'f3e4bf0b0376904f851057d2047bb69e81dce913f2ff1aabe8a4dc1ec0789bc2');
  const current={id:input?.caseId??id(1),revision:input?.caseRevision??1,archived:false,frame:null,context:null,site_id:null},
    binding=ingestionBinding(current.id),sourceId=input?.sourceId??id(kind==='dxf'?2:3),marker=(kind==='dxf'?DXFOriginalSchema:GeoParquetOriginalSchema).parse({
      version:kind+'-native/1',subject:binding.subject,accessSha256:binding.access,sha256:sha256(original),bytes:original.length,
      receivedAt:'2026-10-04T00:00:00Z',lineageState:'caller_declared',lineage:{issuer:null,originalUrl:null,acquiredAt:null,
        permissionReference:null,geography:null,limitations:['technical in-memory receipt authority over unchanged test_only bytes']}}),
    source:any={id:sourceId,case_id:current.id,family_id:input?.sourceFamilyId??sourceId,revision:input?.sourceRevision??1,
      sha256:marker.sha256,bytes:marker.bytes,profile:kind+'-native-v1',object_key:`sources/${sourceId}/${marker.sha256}`,
      status:'received',inspection:{[kind+'Original']:marker}},state={calls:[] as string[],reads:0,tools:0,job:null as any,parentJob:null as any};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push(sql);let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('FROM cases'))rows=[current];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:source.revision}];
    else if(sql.includes('FROM sources'))rows=[source];
    else if(sql.startsWith('SELECT id FROM jobs'))rows=state.job?[{id:state.job.id}]:[];
    else if(sql.includes('FROM jobs j'))rows=state.job&&args[0]===state.job.id?[state.job]
      :state.parentJob&&args[0]===state.parentJob.id?[state.parentJob]:[];
    else assert.fail('Unexpected planar SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const dependencies={read:async()=>{state.reads++;assert.fail('No admissible accepted result: private I/O forbidden.');},
    dxfTools:()=>{state.tools++;assert.fail('Original/stale authority must not scan tools.');},
    geoparquetTools:()=>{state.tools++;assert.fail('Original/stale authority must not scan tools.');}};
  return {client,current,source,marker,state,dependencies};
}

test('unchanged DXF/GeoParquet originals retain pending metadata independently of tools and artifacts',()=>local(async()=>{
  const results=[];
  for(const kind of ['dxf','geoparquet'] as const){
    const f=fixture(kind),before=structuredClone(f.source),original=await sufficiencyPlanarOriginalTx(f.client,f.source);
    assert.equal(original?.kind,kind);assert.equal(original?.latest,true);
    const result=await sufficiencyPlanarEvidenceTx(f.client,f.source,{dependencies:f.dependencies});assert(result);
    assert(SufficiencyPlanarProcessingSchema.safeParse(result.processing).success);
    assert.equal(result.processing.state,'pending');assert.equal(result.processing.jobId,null);
    assert.equal(result.processing.planar.summary,null);assert.equal(result.processing.planar.tools,'not_checked');
    assert.deepEqual(result.jobIds,[]);assert.deepEqual(result.recordPins,[]);
    await result.revalidate(true);assert.equal(f.state.reads,0);assert.equal(f.state.tools,0);assert.deepEqual(f.source,before);
    f.current.archived=true;await assert.rejects(()=>result.revalidate(true),code(403));
    results.push({kind,sourceSha256:markerHash(f),processing:result.processing,finalAccess:'403',reads:0,tools:0});
  }
  save('originals-pending.json',{qualification:'Unchanged real originals; controlled SQL/source/case authority, no accepted-job or live-persistence claim.',results});
}));
function markerHash(f:ReturnType<typeof fixture>){return f.marker.sha256;}

test('captured/current malformed, copied, competing and changed planar authority fails closed',()=>local(async()=>{
  for(const kind of ['dxf','geoparquet'] as const){
    const f=fixture(kind);
    for(const value of [null,false,{}]){
      const bad={...f.source,inspection:{[kind+'Original']:value}};
      await assert.rejects(()=>sufficiencyPlanarOriginalTx(f.client,bad),e=>(e as any).status===403||(e as any).status===409);
      f.source.inspection=bad.inspection;await assert.rejects(()=>sufficiencyPlanarOriginalTx(f.client,f.source),code(403));
      f.source.inspection={[kind+'Original']:f.marker};
    }
    for(const extra of [{copiedFrom:null},{documentOriginal:null},{ifcOriginal:{}},{[kind==='dxf'?'geoparquetOriginal':'dxfOriginal']:null}]){
      const captured={...f.source,inspection:{...f.source.inspection,...extra}};
      await assert.rejects(()=>sufficiencyPlanarOriginalTx(f.client,captured),code(403));
      f.source.inspection=captured.inspection;await assert.rejects(()=>sufficiencyPlanarOriginalTx(f.client,f.source),code(403));
      f.source.inspection={[kind+'Original']:f.marker};
    }
    await assert.rejects(()=>sufficiencyPlanarOriginalTx(f.client,{...f.source,object_key:'changed'}),code(409));
    f.source.inspection[kind+'Original']={...f.marker,subject:'revoked'};
    await assert.rejects(()=>sufficiencyPlanarEvidenceTx(f.client,f.source,{dependencies:f.dependencies}),code(403));
    assert.equal(f.state.reads,0);assert.equal(f.state.tools,0);
  }
  save('authority-denials.json',{capturedCurrentNullMalformed:'refused',copiedCompeting:'403',changedCaptured:'409',revoked:'403',privateReads:0});
}));

test('retained producer summaries/windows stay literal; inadmissible raw identity and accepted-fence drift refuse',()=>local(async()=>{
  const dxf=dxfJourney(),journey=geoJourney(),initial=GeoParquetResultSchema.parse(journey.initialAccepted),continued=GeoParquetResultSchema.parse(journey.continuedAccepted),
    common={inputSha256:null,readerSha256:null,acceptedFence:null,tools:'not_checked',code:null,
      coverage:'accepted_result_metadata_only; native_artifact_not_read'};
  // Schema control only, NOT a current accepted-result service journey.
  const detail=SufficiencyPlanarProcessingSchema.parse({state:'inspected_metadata',jobId:null,resultSha256:null,nativeStatus:null,modelStatus:null,
    planar:{...common,kind:'geoparquet',summary:continued.summary,selection:continued.input.selection,
      continuation:continued.input.continuation,sourceUnits:'native_artifact_not_read'}});
  assert.deepEqual(detail.planar.summary,continued.summary);assert.equal(continued.summary.status,'partial');
  assert.equal(continued.summary.window.nextRowIndex,4);assert.equal(continued.summary.window.totalRows,5);
  const drawing=SufficiencyPlanarProcessingSchema.parse({state:'inspected_metadata',jobId:null,resultSha256:null,nativeStatus:null,modelStatus:null,
    planar:{...common,kind:'dxf',summary:dxf.status.result.summary,selection:'complete_bounded_source',sourceUnits:'result_summary'}});
  assert.deepEqual(drawing.planar.summary,dxf.status.result.summary);
  assert(!SufficiencyPlanarProcessingSchema.safeParse({...drawing,planar:{...drawing.planar,summary:{...drawing.planar.summary,rights:'qualified'}}}).success);
  const f=fixture('geoparquet',initial),ctx=await geoparquetSourceTx(f.client,f.current.id,f.source.id),
    currentInput=geoparquetInput(ctx,initial.input.jobId,initial.input.selection,initial.input.tools,initial.input.continuation);
  const differences=Object.keys(initial.input).filter(key=>fingerprint((initial.input as any)[key])!==fingerprint((currentInput as any)[key]));
  assert.deepEqual(differences,['readerSha256']);assert.notEqual(initial.input.readerSha256,geoparquetReaderSha());
  const resultBytes=Buffer.from(JSON.stringify(initial)),hash=sha256(resultBytes);assert.equal(hash,journey.initialResultSha256);
  const inputHash=fingerprint(initial.input);f.state.job={id:initial.input.jobId,case_id:initial.input.caseId,source_id:initial.input.sourceId,
    operation:'geoparquet-native',case_revision:initial.input.caseRevision,input_fingerprint:inputHash,input_sha256:inputHash,payload:initial.input,
    status:'succeeded',logical_state:'succeeded',accepted_fence:journey.initialAcceptedFence,attempt_state:'accepted',
    attempt_fence:journey.initialAcceptedFence,attempt_input_sha256:inputHash,completion_sha256:hash,
    result_ref:{assetId:`geoparquet:${initial.input.jobId}:${resultBytes.length}`,sha256:hash,version:1}};
  const inspected=await sufficiencyPlanarEvidenceTx(f.client,f.source,{dependencies:f.dependencies});assert(inspected);
  assert.equal(inspected.processing.state,'stale');assert.equal(inspected.processing.planar.summary,null);
  assert.deepEqual(inspected.jobIds,[initial.input.jobId]);assert.equal(f.state.reads,0);assert.equal(f.state.tools,0);
  f.state.job.attempt_fence++;await assert.rejects(()=>inspected.revalidate(),code(409));
  save('metadata-stale-fence.json',{qualification:'Retained summaries are schema controls; original accepted envelope remains stale under exact raw reader identity.',
    dxf:drawing.planar,geoparquet:detail.planar,differences,retainedReader:initial.input.readerSha256,currentReader:geoparquetReaderSha(),
    stale:inspected.processing,fenceDrift:'409 before private reads'});
},'geoparquet-protocol-control'));

test('technical continuation tool outage retains the original without metadata; complete parent/access recapture refuses drift',()=>local(async()=>{
  const journey=geoJourney(),initial=GeoParquetResultSchema.parse(journey.initialAccepted),continued=GeoParquetResultSchema.parse(journey.continuedAccepted);
  const job=(result:typeof initial,fence:number,hash:string)=>{
    const bytes=Buffer.from(JSON.stringify(result));assert.equal(sha256(bytes),hash);const inputHash=fingerprint(result.input);
    return {id:result.input.jobId,case_id:result.input.caseId,source_id:result.input.sourceId,operation:'geoparquet-native',
      case_revision:result.input.caseRevision,input_fingerprint:inputHash,input_sha256:inputHash,payload:result.input,
      status:'succeeded',logical_state:'succeeded',accepted_fence:fence,attempt_state:'accepted',attempt_fence:fence,
      attempt_input_sha256:inputHash,completion_sha256:hash,result_ref:{assetId:`geoparquet:${result.input.jobId}:${bytes.length}`,sha256:hash,version:1}};
  };
  const f=fixture('geoparquet',continued);f.state.job=job(continued,journey.continuedAcceptedFence,journey.continuedResultSha256);
  f.state.parentJob=job(initial,journey.initialAcceptedFence,journey.initialResultSha256);
  const actual=await geoparquetStatusAuthorityTx(f.client,f.current.id,f.source.id,f.state.job.id);
  assert.equal(actual.stale,true);assert.equal(actual.parent?.job.id,initial.input.jobId);
  let statusCalls=0,captureCalls=0;
  // Deliberately injected availability-path control: the real retained input
  // remains unchanged and stale. Only the capture's stale outcome is controlled
  // to reach the 503 branch; this is NOT current accepted-source qualification.
  const dependencies={...f.dependencies,geoparquetAuthority:async(...args:Parameters<typeof geoparquetStatusAuthorityTx>)=>{
    captureCalls++;const captured=await geoparquetStatusAuthorityTx(...args);return {...captured,stale:false};
  },geoparquetStatus:async()=>{statusCalls++;throw new AppError(503,'GEOPARQUET_TOOL_CHANGED','Injected parent-tool outage.');}};
  const result=await sufficiencyPlanarEvidenceTx(f.client,f.source,{dependencies});assert(result);
  assert.equal(result.processing.state,'unavailable');assert.equal(result.processing.planar.tools,'unavailable');
  assert.equal(result.processing.planar.code,'GEOPARQUET_TOOL_CHANGED');assert.equal(result.processing.planar.summary,null);
  assert.equal(result.processing.resultSha256,null);assert.deepEqual(result.jobIds,[initial.input.jobId,continued.input.jobId].sort());
  assert.deepEqual(result.recordPins.map(pin=>pin.id).sort(),result.jobIds);
  await result.revalidate(true);assert(statusCalls>=3);assert(captureCalls>=3);assert.equal(f.state.reads,0);assert.equal(f.state.tools,0);
  const saved=structuredClone(f.state.parentJob.result_ref),size=Number(saved.assetId.split(':').at(-1));
  f.state.parentJob.result_ref.assetId=`geoparquet:${initial.input.jobId}:${size+1}`;
  await assert.rejects(()=>result.revalidate(true),code(409));f.state.parentJob.result_ref=saved;
  f.current.archived=true;await assert.rejects(()=>result.revalidate(true),code(403));assert.equal(f.state.reads,0);
  save('continuation-unavailable-correction.json',{qualification:'Technical capture/status injection only; unchanged retained accepted input remains raw-stale, no current accepted envelope was manufactured.',
    actualRawStale:actual.stale,processing:result.processing,recordPins:result.recordPins,jobIds:result.jobIds,
    statusCalls,captureCalls,privateReads:0,parentResultByteDrift:'409',revokedSourceCase:'403'});
},'geoparquet-protocol-control'));

test('bounded receipt cache uses exact retained pins; cancellation and drift cannot start final I/O',()=>local(async()=>{
  const journey=geoJourney(),result=GeoParquetResultSchema.parse(journey.initialAccepted),bytes=Buffer.from(JSON.stringify(result)),hash=sha256(bytes);
  assert.equal(hash,journey.initialResultSha256);let reads=0;const bounds=budget();
  const cache=planarGeoParquetReceiptCache(bounds,async(key,size,digest,shared)=>readFusionObject(key,size,digest,shared,async(_key,_size,_ms,_unused,signal)=>{
    reads++;assert.equal(signal,bounds.signal);assert(key.endsWith(hash+'.json'));return {body:Readable.from([bytes])} as any;
  }));
  const first=await cache.read(result.input,hash,bytes.length,bounds.signal);cache.close();
  first.summary.window.nextRowIndex=null;
  assert.deepEqual(await cache.read(result.input,hash,bytes.length,bounds.signal),result);assert.equal(reads,1);
  assert.equal(bounds.reservedBytes,bytes.length);
  await assert.rejects(()=>cache.read(result.input,'a'.repeat(64),bytes.length,bounds.signal),code(409));
  await assert.rejects(()=>cache.read({...result.input,sourceRevision:2},hash,bytes.length,bounds.signal),code(409));
  await assert.rejects(()=>cache.read(result.input,hash,512*1024+1,bounds.signal),code(413));assert.equal(reads,1);
  const cancelled=new AbortController();cancelled.abort();const options={deadlineAt:Date.now()+30_000,signal:cancelled.signal,
    readResult:async()=>{assert.fail('Cancelled status must not invoke the parent reader.');}},f=fixture('geoparquet',result),before=f.state.calls.length;
  await assert.rejects(()=>geoparquetStatusTx(f.client,result.input.caseId,result.input.sourceId,result.input.jobId,false,options),code(408));
  await assert.rejects(()=>assertGeoParquetInputTx(f.client,result.input,false,options),code(408));
  await assert.rejects(()=>geoparquetContinuationTx(f.client,{} as any,{} as any,0,false,options),code(408));
  assert.equal(f.state.calls.length,before);
  await assert.rejects(()=>cache.read(result.input,hash,bytes.length,cancelled.signal),code(408));
  save('receipt-cache-bounds.json',{qualification:'Exact retained receipt byte/schema cache over controlled stream; not current source/reader acceptance.',
    resultSha256:hash,bytes:bytes.length,reads,reservedBytes:bounds.reservedBytes,sealedHashInputDrift:'409 without reads',
    oversized:'413 without reads',cancelledStatusInputContinuation:'408 before SQL/reader',noArtifactReads:true});
},'geoparquet-protocol-control'));
