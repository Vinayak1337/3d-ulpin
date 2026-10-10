import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {RasterOriginalSchema,RasterWindowResultSchema,RASTER_WINDOW_LIMITS} from '../packages/contracts/src/usp/raster-window';
import {RasterWindowService,rasterInput,rasterResultKey,rasterArtifactKey} from '../packages/server/src/modules/usp/ingestion/raster-window';
import {readRasterObject} from '../packages/server/src/modules/usp/ingestion/raster-window-object';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Historical status metadata and original crop are retained. The full accepted
// envelope/input/fence and downloaded TIFF are NOT retained. All reconstructed
// input/envelope/job/SQL/storage values are authority controls, not old job proof.
// Non-TIFF transport bytes below are explicit technical controls only.
const root=process.env.ULPIN_RASTER_READ_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-ai05a-raster';
const originalPath=process.env.ULPIN_RASTER_READ_ORIGINAL??'E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-dem-2017.tif';
const present=existsSync(root+'/raster-http-receipt.json')&&existsSync(originalPath);
async function local(work:()=>Promise<void>){
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='raster-read-authority-control';
  try{await work();}finally{if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
}
function fixture(technical=false){
  const savedBytes=readFileSync(root+'/raster-http-receipt.json'),saved=JSON.parse(savedBytes.toString('utf8'));
  assert.equal(sha256(savedBytes),'60d0e8debbb5524e6351e55abdfd561210cf6e9167a703bee9f7da22d5a787ae');
  const manifest=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json','utf8')),
    upstream=manifest.originals.find((e:any)=>e.name==='be_NYC_025.tif'),originalBytes=readFileSync(originalPath);
  assert.equal(sha256(originalBytes),saved.sourceHash);assert.equal(originalBytes.length,saved.sourceBytes);
  const current={id:saved.caseId,revision:saved.first.currentCaseRevision,archived:false,frame:null,context:null,site_id:null},
    binding=ingestionBinding(current.id),marker=RasterOriginalSchema.parse({version:'raster-window/1',subject:binding.subject,
      sha256:saved.sourceHash,bytes:saved.sourceBytes,receivedAt:saved.first.result.createdAt,lineageState:'caller_declared',
      lineage:{kind:'native_grid_derivative',issuer:'NYS GIS Program Office / NYC 2017 survey',originalUrl:upstream.url,
        acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.coverage,
        upstreamBytes:upstream.bytes,upstreamRetained:false,parentSha256:null,limitations:manifest.limitations,note:'Memory-only source authority control'}}),
    source={id:saved.sourceId,case_id:current.id,family_id:saved.sourceId,revision:saved.first.sourceRevision,profile:'geotiff-raster-v1',
      sha256:saved.sourceHash,bytes:saved.sourceBytes,object_key:`sources/${saved.sourceId}/${saved.sourceHash}`,inspection:{rasterOriginal:marker}},
    input=rasterInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId:null})},saved.first.jobId,null);
  const technicalBytes=Buffer.from('RASTER-02 non-TIFF transport authority control; never source evidence'),
    result=RasterWindowResultSchema.parse({...saved.first.result,input,artifact:technical?
      {key:rasterArtifactKey(input.jobId,sha256(technicalBytes)),sha256:sha256(technicalBytes),bytes:technicalBytes.length,mediaType:'image/tiff'}:saved.first.result.artifact}),
    resultBytes=Buffer.from(JSON.stringify(result)),digest=fingerprint(input),
    job={id:input.jobId,case_id:input.caseId,source_id:input.sourceId,operation:'raster-window',case_revision:input.caseRevision,
      payload:input,input_fingerprint:digest,input_manifest_id:input.sourceId,input_sha256:digest,
      scope:{kind:'intake',workspaceId:input.caseId,version:input.caseRevision+1},status:'succeeded',error:null,logical_state:'succeeded',
      result_ref:{assetId:`raster:${input.jobId}`,version:1,sha256:sha256(resultBytes)},accepted_fence:1,
      attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:digest,completion_sha256:sha256(resultBytes)},
    objects=new Map([[rasterResultKey(input.jobId,sha256(resultBytes)),resultBytes]]);
  if(technical)objects.set(result.artifact.key,technicalBytes);
  return {saved,savedBytes,current,source,input,result,resultBytes,job,objects,originalBytes,technicalBytes};
}
function control(f:ReturnType<typeof fixture>){
  let active=false,transactions=0,afterRead:(key:string)=>void=()=>{};const reads:string[]=[],queries:string[]=[],heads:string[]=[],streams:Readable[]=[];
  const client={query:async(sql:string)=>{
    assert(active);queries.push(sql);assert(!/^(INSERT|UPDATE|DELETE)\b/.test(sql));
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[structuredClone(f.current)]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[structuredClone(f.source)]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:f.source.revision}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:[structuredClone(f.job)]};
    assert.fail('unexpected SQL: '+sql);
  }};
  const transaction=async(action:any,bounds:any)=>{assert(bounds.deadlineAt>Date.now());assert(!active);transactions++;active=true;
    try{return await action(client);}finally{active=false;}};
  const object:typeof readRasterObject=async(key,digest,size,bounds)=>{
    assert(!active,'object read held locks');reads.push(key);
    const bytes=await readRasterObject(key,digest,size,bounds,{head:async(key)=>{assert(!active);heads.push(key);
      const data=f.objects.get(key);assert(data,'historical artifact is deliberately unavailable');return {bytes:data.length,etag:'memory-etag'};},
      open:async(key,size,_timeout,etag)=>{assert(!active);const data=f.objects.get(key);assert(data,'unknown object '+key);assert.equal(size,data.length);
        if(key.endsWith('.json'))assert.equal(etag,'memory-etag');const body=Readable.from([data]);streams.push(body);return {body,etag:'memory-etag'};}});
    afterRead(key);return bytes;
  };
  const service=new RasterWindowService({transaction,object} as any);
  return {service,reads,heads,queries,streams,setAfterRead:(fn:typeof afterRead)=>{afterRead=fn;},stats:()=>({active,transactions})};
}
const code=(value:string)=>(e:any)=>e.code===value;
const status=(c:ReturnType<typeof control>,f:ReturnType<typeof fixture>)=>c.service.status(f.input.caseId,f.input.sourceId,f.input.jobId);
const artifact=(c:ReturnType<typeof control>,f:ReturnType<typeof fixture>)=>c.service.artifact(f.input.caseId,f.input.sourceId,f.input.jobId);
function save(name:string,value:unknown){const dir=process.env.ULPIN_RASTER_READ_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('retained first-window metadata is unchanged through controlled exact status authority; missing historical TIFF remains explicit',{skip:!present},()=>local(async()=>{
  const f=fixture(),c=control(f),returned=await status(c,f);
  assert.equal(f.input.window,null);assert.deepEqual(returned,f.saved.first);
  assert.equal(returned.result!.metadata.sourceCrsAuthority,'EPSG:2263');assert.equal(returned.result!.metadata.verticalReferenceStatus,'unknown');
  assert.equal(returned.result!.metadata.globalPlacement,'not_qualified');assert.deepEqual(c.stats(),{active:false,transactions:2});
  assert.equal(c.reads.length,1);assert.equal(c.heads.length,1);assert(c.streams.every(s=>s.destroyed));
  assert(c.queries.filter(q=>q.includes('SELECT j.*,m.result_ref')).every(q=>q.includes('FOR SHARE OF j,m')&&q.includes('a.completion_sha256')));
  save('retained-metadata-control.json',{qualification:'retained metadata/original; reconstructed current input/result envelope and SQL/storage/accepted fence controls',
    original:{path:originalPath,bytes:f.originalBytes.length,sha256:sha256(f.originalBytes)},historicalArtifact:{...f.saved.first.result.artifact,bytesRetained:false},
    reconstructedInput:f.input,reconstructedEnvelopeSha256:sha256(f.resultBytes),returned,reads:c.reads,stats:c.stats(),nativeRuns:0});
}));

test('unenrolled inputs and unaccepted attempts refuse before reads; accepted status fence drift and revocation refuse after reads',{skip:!present},()=>local(async()=>{
  const invalid=fixture(),ci=control(invalid);invalid.job.input_sha256='0'.repeat(64);
  await assert.rejects(()=>status(ci,invalid),code('RASTER_JOB_INTEGRITY'));assert.equal(ci.reads.length,0);
  invalid.job.input_sha256=fingerprint(invalid.input);invalid.job.attempt_state='fenced';
  await assert.rejects(()=>artifact(ci,invalid),code('RASTER_NOT_ACCEPTED'));assert.equal(ci.reads.length,0);
  const f=fixture(),c=control(f);c.setAfterRead(()=>{f.job.accepted_fence=f.job.attempt_fence=2;});
  await assert.rejects(()=>status(c,f),code('RASTER_READ_CHANGED'));assert.equal(c.reads.length,1);
  const revoked=fixture(),cr=control(revoked);cr.setAfterRead(()=>{revoked.current.archived=true;});
  await assert.rejects(()=>status(cr,revoked),code('RASTER_DENIED'));assert.equal(cr.reads.length,1);
  save('status-denials.json',{qualification:'source/input/attempt/fence/revocation authority controls',
    unenrolledBeforeRead:true,unacceptedBeforeRead:true,fenceChangedAfterReceipt:true,revokedAfterReceipt:true,published:false});
}));

test('technical non-TIFF artifact transport preserves exact final result authority and denies post-I/O result drift/revocation',{skip:!present},()=>local(async()=>{
  const f=fixture(true),c=control(f),healthy=await artifact(c,f);assert.deepEqual(healthy.bytes,f.technicalBytes);assert.equal(c.reads.length,2);
  assert.deepEqual(c.stats(),{active:false,transactions:2});
  const changed=fixture(true),cc=control(changed);cc.setAfterRead(key=>{if(key.endsWith('.tif')){
    changed.job.result_ref.sha256=changed.job.completion_sha256='0'.repeat(64);}});
  await assert.rejects(()=>artifact(cc,changed),code('RASTER_READ_CHANGED'));assert.equal(cc.reads.length,2);
  const revoked=fixture(true),cr=control(revoked);cr.setAfterRead(key=>{if(key.endsWith('.tif'))revoked.current.archived=true;});
  await assert.rejects(()=>artifact(cr,revoked),code('RASTER_DENIED'));assert.equal(cr.reads.length,2);
  save('artifact-authority-control.json',{qualification:'NON-TIFF technical transport bytes; not historical artifact/native/source proof',
    technicalBytes:healthy.bytes.length,technicalSha256:healthy.sha256,healthyReadControl:true,resultChangedAfterArtifact:true,revokedAfterArtifact:true,
    deniedControlPublished:false,historicalArtifactReproduced:false});
}));

test('queued/running/failed reader outage and stale status stay useful without object reads',{skip:!present},()=>local(async()=>{
  const rows=[];
  for(const state of ['queued','running','failed']){const f=fixture(),c=control(f);f.job.status=f.job.logical_state=state;
    f.job.result_ref=null as any;f.job.accepted_fence=null as any;f.job.attempt_state=f.job.attempt_fence=f.job.attempt_input_sha256=f.job.completion_sha256=null as any;
    f.job.error=state==='failed'?'RASTER_PROCESSOR_UNAVAILABLE':null as any;
    const result=await status(c,f);assert.equal(result.status,state);assert.equal(result.code,f.job.error);assert.equal(result.result,null);assert.equal(c.reads.length,0);rows.push(result);
    await assert.rejects(()=>artifact(c,f),code('RASTER_NOT_ACCEPTED'));assert.equal(c.reads.length,0);}
  const f=fixture(),c=control(f);f.current.context={changed:true} as any;const stale=await status(c,f);assert.equal(stale.status,'stale');assert.equal(stale.result,null);
  assert.equal(c.reads.length,0);save('pending-outage-control.json',{qualification:'memory SQL controls; no object/native calls',rows,stale});
}));

test('legacy receipt streaming refuses oversized HEAD before GET, excess/hash bytes and expired deadline',async()=>{
  const bytes=Buffer.from('bounded transport control'),digest=sha256(bytes),key=rasterResultKey('7ba606ae-05f2-4701-b3de-1d407aba904e',digest),
    bounds=()=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal});let opens=0;
  const deps={head:async()=>({bytes:RASTER_WINDOW_LIMITS.resultBytes+1,etag:'control'}),open:async()=>{opens++;assert.fail('oversized receipt opened');}};
  await assert.rejects(()=>readRasterObject(key,digest,null,bounds(),deps as any),code('RASTER_OBJECT_LIMIT'));assert.equal(opens,0);
  for(const supplied of [Buffer.concat([bytes,Buffer.from('x')]),Buffer.from(bytes).fill(32,0,1)]){
    const body=Readable.from([supplied]);await assert.rejects(()=>readRasterObject(key,digest,bytes.length,bounds(),
      {head:deps.head,open:async()=>({body,etag:'control'})}),code('RASTER_OBJECT_INTEGRITY'));assert(body.destroyed);}
  await assert.rejects(()=>readRasterObject(key,digest,null,{deadlineAt:Date.now()-1},deps as any),code('RASTER_READ_DEADLINE'));
  save('bounded-storage-control.json',{qualification:'technical transport only',oversizedBeforeGet:true,excessDenied:true,hashDenied:true,expiredDenied:true});
});
