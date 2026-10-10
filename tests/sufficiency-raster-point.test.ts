import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
// Leaf first: this detail contract must not depend on the root sufficiency union.
import {SufficiencyRasterDetailSchema,SufficiencyPointDetailSchema} from '../packages/contracts/src/usp/sufficiency-raster-point';
import {RasterOriginalSchema} from '../packages/contracts/src/usp/raster-window';
import {PointOriginalSchema} from '../packages/contracts/src/usp/point-batch';
import {sufficiencyRasterPointOriginalTx,sufficiencyRasterPointEvidenceTx} from '../packages/server/src/modules/usp/ingestion/sufficiency-raster-point';
import {rasterInput} from '../packages/server/src/modules/usp/ingestion/raster-window';
import {pointInput} from '../packages/server/src/modules/usp/ingestion/point-batch';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import type {FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';

// Originals/old metadata are unchanged real inputs. SQL/source markers/queued
// enrollment below are memory-only controls. Historical complete accepted input,
// fence and receipt bytes are absent: no current accepted envelope is fabricated.
const base='E:/BhuAayam-data/task-data/',originalRoot=base+'nyc-10013-multimodal/',
  rasterPath=base+'desktop-ai05a-raster/raster-http-receipt.json',
  pointPath=base+'desktop-ai05b-point/point-http-final.json',pointRetain=base+'desktop-ai05b-point/point-http-source-retain.json';
const present=[rasterPath,pointPath,pointRetain,originalRoot+'manifest.json',
  originalRoot+'upload/nyc-10013-dem-2017.tif',originalRoot+'upload/nyc-10013-lidar-2017.laz'].every(existsSync);
const code=(value:string)=>(error:any)=>error.code===value;
function fixture(kind:'raster'|'point'){
  const receiptBytes=readFileSync(kind==='raster'?rasterPath:pointPath),old=JSON.parse(receiptBytes.toString('utf8')),
    first=kind==='raster'?old.first:JSON.parse(readFileSync(pointRetain,'utf8')).first,
    original=readFileSync(originalRoot+'upload/'+(kind==='raster'?'nyc-10013-dem-2017.tif':'nyc-10013-lidar-2017.laz')),
    manifest=JSON.parse(readFileSync(originalRoot+'manifest.json','utf8')),
    upstream=manifest.originals.find((r:any)=>r.name===(kind==='raster'?'be_NYC_025.tif':'20170504_980200.copc.laz')),
    sourceHash=kind==='raster'?old.sourceHash:old.sourceSha256;
  assert.equal(sha256(receiptBytes),kind==='raster'?'60d0e8debbb5524e6351e55abdfd561210cf6e9167a703bee9f7da22d5a787ae':
    '1c9f4f94bf3ebbeacae4549dd582d6fc369bda000b864524d3272114213bf4f2');
  assert.equal(sha256(original),sourceHash);assert.equal(original.length,old.sourceBytes);
  const current={id:old.caseId,revision:first.currentCaseRevision,archived:false,frame:null,context:null,site_id:null},
    binding=ingestionBinding(current.id),marker=(kind==='raster'?RasterOriginalSchema:PointOriginalSchema).parse({
      version:kind==='raster'?'raster-window/1':'point-batch/1',subject:binding.subject,sha256:sourceHash,bytes:original.length,
      receivedAt:first.result.createdAt,lineageState:'caller_declared',lineage:{
        kind:kind==='raster'?'native_grid_derivative':'native_point_derivative',issuer:kind==='raster'?'NYS GIS Program Office / NYC survey':'NOAA distribution of NYC 2017 survey',
        originalUrl:upstream.url,acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.coverage,
        upstreamBytes:upstream.bytes,upstreamRetained:kind==='point',parentSha256:upstream.sha256??null,
        limitations:manifest.limitations,note:'memory-only original retention authority control'}}),
    source={id:old.sourceId,case_id:current.id,family_id:old.sourceId,revision:first.sourceRevision,
      profile:kind==='raster'?'geotiff-raster-v1':'laz-point-v1',sha256:sourceHash,bytes:original.length,
      object_key:'sources/'+old.sourceId+'/'+sourceHash,inspection:{[kind+'Original']:marker}},
    ctx={current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId:null})},
    input=kind==='raster'?rasterInput(ctx,first.jobId,null):pointInput(ctx,old.results[0].jobId,null),digest=fingerprint(input),
    job={id:input.jobId,operation:kind==='raster'?'raster-window':'point-batch',case_id:input.caseId,source_id:input.sourceId,
      case_revision:input.caseRevision,payload:input,input_fingerprint:digest,input_sha256:digest,input_manifest_id:input.sourceId,
      scope:{kind:'intake',workspaceId:input.caseId,version:input.caseRevision+1},status:'queued',logical_state:'queued',error:null,
      accepted_fence:null,result_ref:null,attempt_state:null,attempt_fence:null,attempt_input_sha256:null,completion_sha256:null};
  return {kind,old,first,current,source,input,job,original,receiptBytes};
}
function control(f:ReturnType<typeof fixture>){
  let job:any=f.job,latestRevision=f.source.revision;const sql:string[]=[],reads:string[]=[],
    budget:FusionBudget={deadlineAt:Date.now()+30000,signal:AbortSignal.timeout(30000),reservedBytes:0};
  const client:any={query:async(query:string,args:any[])=>{
    sql.push(query);assert(!/^(INSERT|UPDATE|DELETE)\b/.test(query));
    if(query==='SELECT * FROM sources WHERE id=$1'||query.startsWith('SELECT * FROM sources WHERE case_id='))return {rows:[structuredClone(f.source)]};
    if(query.startsWith('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[structuredClone(f.current)]};
    if(query.startsWith('SELECT max(revision)'))return {rows:[{revision:latestRevision}]};
    if(query.startsWith('SELECT id FROM jobs'))return {rows:job?[{id:job.id}]:[]};
    if(query.includes('SELECT j.*,m.result_ref'))return {rows:job&&job.id===args[0]?[structuredClone(job)]:[]};
    assert.fail('Unexpected SQL '+query);
  }},object:any=async(key:string)=>{reads.push(key);assert.fail('Pending/stale/unaccepted authority must refuse result/artifact reads');};
  return {client,sql,reads,budget,options:{budget,dependencies:{rasterObject:object,pointObject:object}},
    setJob:(value:any)=>{job=value;},setLatestRevision:(value:number)=>{latestRevision=value;}};
}
async function local(work:()=>Promise<void>){
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='raster-point-sufficiency-control';
  try{await work();}finally{if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
}
function save(name:string,value:unknown){const dir=process.env.ULPIN_RASTER_POINT_SUFFICIENCY_PROOF_DIR;
  if(dir)writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('real raster/point originals retain independent authority and queued guidance without native I/O',{skip:!present},()=>local(async()=>{
  const outcomes=[];
  for(const kind of ['raster','point'] as const){
    const f=fixture(kind),captured=structuredClone(f.source),c=control(f),original=await sufficiencyRasterPointOriginalTx(c.client,captured),
      evidence=await sufficiencyRasterPointEvidenceTx(c.client,captured,c.options);
    assert(original&&evidence);assert.equal(original.source.sha256,sha256(f.original));
    assert.equal(evidence.processing.state,'pending');assert.equal(evidence.processing.resultSha256,null);
    assert.equal(evidence.processing.rasterPoint.metadata,null);assert.equal(evidence.processing.rasterPoint.installedInventory,'not_read');
    assert.equal(evidence.processing.rasterPoint.tools,'not_checked');assert.equal(evidence.processing.nativeStatus,null);
    assert.equal(evidence.processing.modelStatus,null);assert.equal(evidence.processing.rasterPoint.measuredResultBytes,null);
    assert.deepEqual(evidence.finalLockPlan.jobIds,[f.job.id]);assert.deepEqual(evidence.finalLockPlan.attemptJobIds,[f.job.id]);
    assert.deepEqual(evidence.finalLockPlan.caseDestinationIds,[f.current.id]);assert.equal(evidence.finalLockPlan.caseLock,'FOR UPDATE');
    assert.equal(evidence.finalLockPlan.observations.enqueueAdmissionKey,f.job.operation+'-admission-v1');
    assert(c.sql.some(s=>s.endsWith('FOR SHARE OF j,m')));assert(c.sql.some(s=>s.includes('FROM cases')&&s.endsWith('FOR SHARE')));
    await evidence.revalidate(true);assert.equal(c.budget.reservedBytes,0);assert.equal(c.reads.length,0);
    // A retained original remains useful when there is no job at all.
    c.setJob(null);const noJob=await sufficiencyRasterPointEvidenceTx(c.client,captured,c.options);
    assert(noJob);assert.equal(noJob.processing.state,'pending');assert.equal(noJob.processing.jobId,null);
    outcomes.push({kind,sourceSha256:sha256(f.original),sourceBytes:f.original.length,
      inputSha256:fingerprint(f.input),evidence: {processing:evidence.processing,recordPins:evidence.recordPins,
        evidenceSha256:evidence.evidenceSha256,finalLockPlan:evidence.finalLockPlan},
      proofScope:'memory SQL/source/queued enrollment; unchanged real original; no accepted/native/HTTP/SQL/storage qualification'});
  }
  save('original-pending.json',outcomes);
}));

test('retained metadata schema fallback preserves complete declarations without inventing accepted envelopes',{skip:!present},()=>local(async()=>{
  const r=fixture('raster'),p=fixture('point'),raster=SufficiencyRasterDetailSchema.shape.metadata.parse(r.old.first.result.metadata),
    point=SufficiencyPointDetailSchema.shape.metadata.parse(p.old.results[0].metadata);
  assert(raster&&point);assert.deepEqual(raster,r.old.first.result.metadata);assert.deepEqual(point,p.old.results[0].metadata);
  assert.equal(raster.sourceCrsAuthority,'EPSG:2263');assert.equal(raster.bands[0].nodataKind,'finite');
  assert.equal(raster.verticalReference,null);assert.equal(raster.verticalReferenceStatus,'unknown');
  assert.equal(point.horizontalAuthority,'EPSG:6347');assert.equal(point.verticalReferenceStatus,'known');
  assert.deepEqual(point.scale,[0.01,0.01,0.01]);assert.equal(point.dimensions.length,18);
  assert.equal(raster.globalPlacement,'not_qualified');assert.equal(point.globalPlacement,'not_qualified');
  save('metadata-schema-only.json',{qualification:'schema_only; historical accepted full input/envelope/fence absent; current admission not assessed',
    raster,point,rasterMetadataSha256:fingerprint(raster),pointMetadataSha256:fingerprint(point)});
}));

test('canonical stale/access/fence and captured/current marker refusals survive final recapture',{skip:!present},()=>local(async()=>{
  const outcomes=[];
  for(const kind of ['raster','point'] as const){
    const f=fixture(kind),captured=structuredClone(f.source),c=control(f),evidence=await sufficiencyRasterPointEvidenceTx(c.client,captured,c.options);
    assert(evidence);
    f.current.revision++;await assert.rejects(evidence.revalidate(),code('STALE_REVISION'));
    const stale=await sufficiencyRasterPointEvidenceTx(c.client,captured,c.options);assert.equal(stale?.processing.state,'stale');
    f.current.revision--;f.current.archived=true;
    await assert.rejects(evidence.revalidate(),code(kind==='raster'?'RASTER_DENIED':'POINT_DENIED'));f.current.archived=false;
    c.setJob({...f.job,status:'succeeded',logical_state:'succeeded'});
    await assert.rejects(sufficiencyRasterPointEvidenceTx(c.client,captured,c.options),code(kind==='raster'?'RASTER_NOT_ACCEPTED':'POINT_NOT_ACCEPTED'));
    c.setJob(f.job);f.job.input_manifest_id='00000000-0000-4000-8000-000000000000';
    await assert.rejects(sufficiencyRasterPointEvidenceTx(c.client,captured,c.options),code(kind==='raster'?'RASTER_JOB_INTEGRITY':'POINT_JOB_INTEGRITY'));
    f.job.input_manifest_id=f.source.id;
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='revoked-raster-point-sufficiency-control';
    await assert.rejects(evidence.revalidate(),code(kind==='raster'?'RASTER_DENIED':'POINT_DENIED'));
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='raster-point-sufficiency-control';
    const nullCaptured=structuredClone(captured);nullCaptured.inspection[kind+'Original']=null;
    await assert.rejects(sufficiencyRasterPointOriginalTx(c.client,nullCaptured),code('STALE_REVISION'));
    const copied=structuredClone(captured);copied.inspection.copiedFrom=null;
    await assert.rejects(sufficiencyRasterPointOriginalTx(c.client,copied),code('SUFFICIENCY_RASTER_POINT_DENIED'));
    const mixed=structuredClone(captured);mixed.inspection.documentOriginal=null;
    await assert.rejects(sufficiencyRasterPointOriginalTx(c.client,mixed),code('SUFFICIENCY_RASTER_POINT_DENIED'));
    const originalMarker=f.source.inspection[kind+'Original'];f.source.inspection[kind+'Original']=null;
    await assert.rejects(evidence.revalidate(),code(kind==='raster'?'RASTER_DENIED':'POINT_DENIED'));
    f.source.inspection[kind+'Original']=originalMarker;
    c.setLatestRevision(f.source.revision+1);await assert.rejects(evidence.revalidate(),code('STALE_REVISION'));
    assert.equal(c.reads.length,0);assert.equal(c.budget.reservedBytes,0);
    const cancelled=AbortSignal.abort();await assert.rejects(sufficiencyRasterPointEvidenceTx(c.client,captured,
      {...c.options,budget:{...c.budget,signal:cancelled}}),code('RASTER_READ_DEADLINE'));
    outcomes.push({kind,refusals:['late case drift','stale guidance','archive','unaccepted fence','wrong enrollment','access change',
      'captured null','captured copied','competing marker','current null','later source revision','cancelled deadline'],
      resultReads:c.reads.length,proofScope:'memory SQL/source/enrollment controls only'});
  }
  save('refusals.json',outcomes);
}));
