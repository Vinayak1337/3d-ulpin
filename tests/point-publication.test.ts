import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {PointOriginalSchema,PointBatchResultSchema} from '../packages/contracts/src/usp/point-batch';
import {pointInput,pointResultKey} from '../packages/server/src/modules/usp/ingestion/point-batch';
import {readPointObject} from '../packages/server/src/modules/usp/ingestion/point-batch-object';
import {runPointBatchJob,failPointBatchJob} from '../packages/server/src/modules/usp/ingestion/point-batch-worker';
import {pointNativeJson,nativePointBatch,POINT_NATIVE_REPLY_BYTES} from '../packages/server/src/modules/usp/ingestion/point-publication';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Canonical claim/assert/accept/outbox/deadline functions run over SQL doubles.
// Native HTTP and immutable storage are controls, never services or parser runs.
// Retained metadata/original are genuine; all inputs/envelopes/fences and NON-NATIVE
// transport bytes below are separate controls, not absent historical artifact proof.
const root='E:/BhuAayam-data/task-data/desktop-ai05b-point',originalPath='E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-lidar-2017.laz';
const present=existsSync(root+'/point-http-final.json')&&existsSync(originalPath);
function fixture(){
  const oldBytes=readFileSync(root+'/point-http-final.json'),old=JSON.parse(oldBytes.toString('utf8')),retained=old.results[0],
    earlier=JSON.parse(readFileSync(root+'/point-http-source-retain.json','utf8')),
    original=readFileSync(originalPath),manifest=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json','utf8')),
    upstream=manifest.originals.find((v:any)=>v.name==='20170504_980200.copc.laz');
  assert.equal(sha256(oldBytes),'1c9f4f94bf3ebbeacae4549dd582d6fc369bda000b864524d3272114213bf4f2');
  assert.equal(sha256(original),old.sourceSha256);assert.equal(original.length,old.sourceBytes);
  const current={id:old.caseId,revision:earlier.first.currentCaseRevision,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(current.id),
    marker=PointOriginalSchema.parse({version:'point-batch/1',subject:binding.subject,sha256:old.sourceSha256,bytes:old.sourceBytes,
      receivedAt:earlier.first.result.createdAt,lineageState:'caller_declared',lineage:{kind:'native_point_derivative',issuer:'NOAA distribution of NYC 2017 survey',
        originalUrl:upstream.url,acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.coverage,
        upstreamBytes:upstream.bytes,upstreamRetained:true,parentSha256:upstream.sha256,limitations:manifest.limitations,note:'memory-only authority control'}}),
    source={id:old.sourceId,case_id:current.id,family_id:old.sourceId,revision:earlier.first.sourceRevision,profile:'laz-point-v1',sha256:old.sourceSha256,
      bytes:old.sourceBytes,object_key:`sources/${old.sourceId}/${old.sourceSha256}`,inspection:{pointOriginal:marker}},
    input=pointInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId:null})},retained.jobId,null),digest=fingerprint(input),
    job:any={id:input.jobId,case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,operation:'point-batch',
      payload:input,input_fingerprint:digest,status:'queued',error:null,attempts:0},
    meta:any={input_manifest_id:source.id,input_sha256:digest,scope:{kind:'intake',workspaceId:current.id,version:2},
      logical_state:'queued',result_ref:null,accepted_fence:null,version:1},
    attempts:any[]=[],events:any[]=[],objects=new Map<string,Buffer>(),technical=Buffer.alloc(retained.artifact.bytes,0x78);
  technical.write('POINT-02 NON-NATIVE publication transport control');
  const nativeBody=Buffer.from(JSON.stringify({metadata:retained.metadata,artifactBase64:technical.toString('base64'),artifactSha256:sha256(technical),artifactBytes:technical.length}));
  let active=false,snapshot:any,uncertain=false,commitRepliesLost=0,nativeCalls=0,puts=0,replayReads=0,bodyCancelled=false;
  const queries:string[]=[],io:string[]=[],deadlines:number[]=[],streams:Readable[]=[],controller=new AbortController();
  let afterRead:(key:string)=>void=()=>{},mode:'normal'|'replay'|'oversize'|'cancel'|'timeout'='normal';
  const query=async(sql:string,args:any[]=[])=>{
    queries.push(sql);let rows:any[]=[];
    if(sql==='BEGIN'){assert(!active);active=true;snapshot=structuredClone({job,meta,attempts,events});}
    else if(sql==='COMMIT'){active=false;if(uncertain&&job.status==='succeeded'){uncertain=false;commitRepliesLost++;throw new Error('controlled lost COMMIT reply');}}
    else if(sql==='ROLLBACK'){active=false;Object.assign(job,snapshot.job);Object.assign(meta,snapshot.meta);
      attempts.splice(0,attempts.length,...snapshot.attempts);events.splice(0,events.length,...snapshot.events);}
    else if(sql.startsWith('SELECT set_config'))rows=[{deadline_live:Date.now()<Date.parse(args[1])}];
    else if(sql.includes('FROM cases'))rows=[current];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:source.revision}];
    else if(sql.includes('FROM sources'))rows=[source];
    else if(sql.includes('SELECT j.*,m.input_manifest_id'))rows=[{...job,...meta}];
    else if(sql.includes('FROM jobs'))rows=[job];
    else if(sql.includes('FROM usp_job_metadata'))rows=[meta];
    else if(sql.includes('FROM usp_job_attempts'))rows=sql.includes('ORDER BY')?attempts.slice(-1):attempts.filter(a=>a.number===args[1]);
    else if(sql.startsWith('INSERT INTO usp_job_attempts')){const a={number:args[1],fence:args[2],owner:args[3],input_sha256:args[4],
      state:'active',lease_until:new Date(Date.now()+180000),completion_sha256:null};attempts.push(a);rows=[{lease_until:a.lease_until}];}
    else if(sql.startsWith('UPDATE usp_job_attempts')){
      if(sql.includes("state='accepted'")){const a=attempts.find(a=>a.number===args[2])!;a.state='accepted';a.completion_sha256=args[1];}
      else for(const a of attempts)if(a.state==='active')a.state='fenced';
    }else if(sql.startsWith('UPDATE usp_job_metadata')){
      meta.logical_state=sql.includes("logical_state='succeeded'")?'succeeded':sql.includes("logical_state='running'")?'running':'failed';
      if(meta.logical_state==='succeeded'){meta.result_ref=args[1];meta.accepted_fence=args[2];}meta.version++;
    }else if(sql.startsWith('UPDATE jobs')){
      job.status=sql.includes("status='succeeded'")?'succeeded':sql.includes("status='running'")?'running':args[1];
      if(job.status==='running')job.attempts=args[1];job.error=job.status==='failed'||job.status==='stale'?args[2]:null;
    }else if(sql.startsWith('INSERT INTO usp_outbox_streams')){}
    else if(sql.startsWith('UPDATE usp_outbox_streams'))rows=[{sequence:String(events.length+1)}];
    else if(sql.startsWith('INSERT INTO usp_outbox'))events.push(args[2]);
    else assert.fail('unexpected SQL '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  };
  const client=Object.assign(new EventEmitter(),{query,release:()=>{active=false;}}),pool={connect:async()=>client,query};
  const request:typeof fetch=async(_url,options)=>{assert(!active);nativeCalls++;io.push('native');assert(options!.signal);deadlines.push(Date.now());
    assert.deepEqual(JSON.parse(String(options!.body)),{sourceId:input.sourceId,objectKey:input.objectKey,sha256:input.sourceSha256,bytes:input.sourceBytes,batch:null});
    if(mode==='oversize')return new Response(new ReadableStream({cancel(){bodyCancelled=true;}}),{headers:{'content-length':String(POINT_NATIVE_REPLY_BYTES+1)}});
    if(mode==='cancel'||mode==='timeout'){if(mode==='cancel')setTimeout(()=>controller.abort(),10);return new Response(new ReadableStream({
      start(c){c.enqueue(Buffer.from('{"metadata":'));},cancel(){bodyCancelled=true;}}));}
    return new Response(nativeBody,{headers:{'content-length':String(nativeBody.length)}});
  };
  const put=async(key:string,bytes:Uint8Array,_type:string,signal?:AbortSignal)=>{assert(!active);assert(signal);assert(!signal.aborted);puts++;io.push('put:'+key);
    const prior=objects.get(key);if(prior)assert.deepEqual(Buffer.from(bytes),prior);else objects.set(key,Buffer.from(bytes));
    if(mode==='replay')throw Object.assign(new Error('controlled immutable PUT replay'),{$metadata:{httpStatusCode:412}});
  };
  const read:typeof readPointObject=async(key,hash,size,bounds)=>{assert(!active);assert(size!==null,'writer knows staged byte lengths');
    deadlines.push(bounds!.deadlineAt);io.push('read:'+key);const bytes=await readPointObject(key,hash,size,bounds,{head:async()=>assert.fail('no writer HEAD'),
      open:async(key,size)=>{assert(!active);replayReads++;const bytes=objects.get(key);assert(bytes);assert.equal(bytes.length,size);
        const body=Readable.from([bytes]);streams.push(body);return {body,etag:'memory'};}});afterRead(key);return bytes;};
  return {old,retained,original,input,current,source,job,meta,attempts,events,objects,technical,nativeBody,pool,queries,io,deadlines,streams,
    controller,deps:{request,put,read},setMode:(value:typeof mode)=>{mode=value;},setAfterRead:(fn:typeof afterRead)=>{afterRead=fn;},
    loseCommit:()=>{uncertain=true;},stats:()=>({active,nativeCalls,puts,replayReads,bodyCancelled,commitRepliesLost})};
}
async function isolated(work:(f:ReturnType<typeof fixture>)=>Promise<void>){
  const globals=globalThis as any,previousPool=globals.ulpinPool,subject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
    geoUrl=process.env.GEO_URL,geoToken=process.env.GEO_SERVICE_TOKEN,
    sigint=process.listenerCount('SIGINT'),sigterm=process.listenerCount('SIGTERM');
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='point-publication-control';
  process.env.GEO_URL='http://point-publication-control.invalid';process.env.GEO_SERVICE_TOKEN='technical-control';
  const f=fixture();globals.ulpinPool=f.pool;
  try{await work(f);}finally{if(previousPool===undefined)delete globals.ulpinPool;else globals.ulpinPool=previousPool;
    if(subject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
    if(geoUrl===undefined)delete process.env.GEO_URL;else process.env.GEO_URL=geoUrl;
    if(geoToken===undefined)delete process.env.GEO_SERVICE_TOKEN;else process.env.GEO_SERVICE_TOKEN=geoToken;
    assert.equal(process.listenerCount('SIGINT'),sigint);assert.equal(process.listenerCount('SIGTERM'),sigterm);assert(!f.stats().active);}
}
const run=(f:ReturnType<typeof fixture>,deadlineAt?:number)=>runPointBatchJob(f.input.jobId,f.deps,{signal:f.controller.signal,deadlineAt});
function save(name:string,value:unknown){const dir=process.env.ULPIN_POINT_PUBLICATION_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('controlled native reply and immutable replay publish through canonical fenced acceptance with all I/O outside SQL',{skip:!present},()=>isolated(async f=>{
  f.setMode('replay');await run(f);assert.equal(f.job.status,'succeeded');assert.equal(f.meta.logical_state,'succeeded');assert.equal(f.meta.accepted_fence,1);
  assert.equal(f.attempts[0].state,'accepted');const bytes=f.objects.get(pointResultKey(f.input.jobId,f.meta.result_ref.sha256))!,result=PointBatchResultSchema.parse(JSON.parse(bytes.toString('utf8')));
  assert.equal(f.meta.result_ref.sha256,sha256(bytes));assert.equal(f.attempts[0].completion_sha256,sha256(bytes));
  assert.deepEqual(result.metadata,f.retained.metadata);assert.equal(result.input.batch,null);assert.deepEqual(result.input,f.input);
  assert.deepEqual(f.objects.get(result.artifact.key),f.technical);assert.equal(result.artifact.sha256,sha256(f.technical));
  assert(f.events.some(e=>e.type==='job.succeeded'));assert(f.events.some(e=>e.change?.status==='completed'));
  assert.equal(f.stats().replayReads,4);assert(f.streams.every(s=>s.destroyed));assert.equal(new Set(f.deadlines.filter(n=>n>Date.now()+1000)).size,1);
  const before=f.stats();await run(f);assert.deepEqual(f.stats(),before,'accepted job must not reprocess');
  save('controlled-publication.json',{qualification:'NON-NATIVE native/storage controls; canonical job/SQL/outbox over memory transport; no historical artifact proof',
    input:f.input,result,resultObjectUtf8:bytes.toString('utf8'),artifactTransportBase64:f.technical.toString('base64'),
    acceptedRef:f.meta.result_ref,attempt:f.attempts[0],events:f.events,io:f.io,stats:f.stats(),
    original:{path:originalPath,bytes:f.original.length,sha256:sha256(f.original)},historicalArtifactReproduced:false});
}));

test('revision-only receipts before claim and during execution keep the queued point input',{skip:!present},()=>isolated(async f=>{
  const enrolled=fingerprint(f.input);f.current.revision++;
  f.setAfterRead(()=>{f.current.revision++;});await run(f);
  assert.equal(f.job.status,'succeeded');assert.equal(fingerprint(f.input),enrolled);
  assert.equal(f.job.case_revision,f.input.caseRevision);assert.equal(f.attempts[0].state,'accepted');
}));

test('preflight never waives final source, cancellation or newer-attempt authority',{skip:!present},async()=>{
  const outcomes=[];
  for(const mode of ['stale','revoked','cancelled','paused','newer','enrollment'] as const)await isolated(async f=>{
    f.setAfterRead(key=>{if(!key.endsWith('.bin'))return;
      if(mode==='stale')f.current.context={changed:true} as any;
      if(mode==='revoked')f.current.archived=true;
      if(mode==='cancelled')f.meta.logical_state='cancelled';
      if(mode==='paused')f.meta.logical_state='paused';
      if(mode==='newer'){f.attempts[0].state='fenced';f.attempts.push({...f.attempts[0],number:2,fence:2,owner:'other-owner-control',state:'active'});}
      if(mode==='enrollment')f.meta.scope.version++;
    });
    await run(f);assert.equal(f.meta.result_ref,null);assert(!f.events.some(e=>e.type==='job.succeeded'||e.change?.status==='completed'));
    assert.equal(f.objects.size,2,'immutable prepared output stays retained');
    if(mode==='stale'){assert.equal(f.job.status,'stale');assert.equal(f.job.error,'POINT_INPUT_STALE');
      assert(!f.events.some(e=>['stale','failed'].includes(e.change?.status)),'stale source cannot emit private failure event');}
    if(mode==='revoked'){assert.equal(f.job.status,'failed');assert.equal(f.job.error,'POINT_DENIED');
      assert(!f.events.some(e=>['stale','failed'].includes(e.change?.status)),'revoked source cannot emit private failure event');}
    if(mode==='cancelled'){assert.equal(f.meta.logical_state,'cancelled');assert.equal(f.job.status,'running');}
    if(mode==='paused'){assert.equal(f.meta.logical_state,'paused');assert.equal(f.job.status,'running');}
    if(mode==='newer'){assert.equal(f.attempts.at(-1).owner,'other-owner-control');assert.equal(f.attempts.at(-1).state,'active');assert.equal(f.job.status,'running');}
    if(mode==='enrollment'){assert.equal(f.job.status,'failed');assert.equal(f.job.error,'POINT_JOB_INTEGRITY');}
    outcomes.push({mode,status:f.job.status,logicalState:f.meta.logical_state,resultRef:f.meta.result_ref,stats:f.stats(),published:false});
  });
  save('final-authority-denials.json',{qualification:'SQL/source/fence/cancellation controls after bounded immutable preflight',outcomes});
});

test('oversized native reply, cancellation and timeout stop before staged publication',{skip:!present},async()=>{
  const outcomes=[];
  for(const mode of ['oversize','cancel','timeout'] as const)await isolated(async f=>{
    f.setMode(mode);await run(f,mode==='timeout'?Date.now()+100:undefined);assert.equal(f.job.status,'failed');
    assert.equal(f.job.error,mode==='oversize'?'POINT_REPLY_LIMIT':mode==='cancel'?'POINT_CANCELLED':'POINT_TIMEOUT');
    assert.equal(f.stats().puts,0);assert(f.stats().bodyCancelled);assert.equal(f.objects.size,0);
    outcomes.push({mode,code:f.job.error,stats:f.stats(),published:false});
  });
  let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(17));},cancel(){cancelled=true;}}));
  await assert.rejects(()=>pointNativeJson(response,16,{deadlineAt:Date.now()+1000}),(e:any)=>e.code==='POINT_REPLY_LIMIT');assert(cancelled);
  save('bounded-native-denials.json',{qualification:'technical HTTP body controls; no parser or services',outcomes,streamOverrunBeforeJson:true});
});

test('lost canonical acceptance COMMIT reply preserves possibly committed output and avoids terminal rewrite',{skip:!present},()=>isolated(async f=>{
  f.loseCommit();await run(f);assert.equal(f.stats().commitRepliesLost,1);assert.equal(f.job.status,'succeeded');
  assert.equal(f.meta.logical_state,'succeeded');assert.equal(f.objects.size,2);assert.equal(f.attempts[0].state,'accepted');
  assert(!f.queries.some(q=>q.includes("logical_state='failed'")||q.includes("state='fenced'")));
  save('ambiguous-publication-control.json',{qualification:'memory SQL outcome models possibly durable COMMIT with lost reply; no real PostgreSQL durability claim',
    stats:f.stats(),retainedObjects:[...f.objects.keys()],resultRef:f.meta.result_ref,terminalRewrite:false,possiblyCommitted:true});
}));

test('bounded point error replies and default/explicit batches keep exact semantics; terminal work preserves unknown owners',{skip:!present},()=>isolated(async f=>{
  const bounds={deadlineAt:Date.now()+1000},outcomes=[];
  for(const [detail,expected] of [
    ['Point batch is outside the retained source point count.','POINT_BATCH_OUT_OF_BOUNDS'],
    ['Point source hash or byte count differs from its retained receipt.','POINT_SOURCE_INTEGRITY'],
    ['unsupported retained format control','POINT_UNSUPPORTED']]){
    await assert.rejects(()=>nativePointBatch(f.input,bounds,async()=>new Response(JSON.stringify({detail}),{status:422})),(e:any)=>e.code===expected);
    outcomes.push({detail,code:expected});
  }
  let errorCancelled=false;
  await assert.rejects(()=>nativePointBatch(f.input,bounds,async()=>new Response(new ReadableStream({cancel(){errorCancelled=true;}}),
    {status:422,headers:{'content-length':'32769'}})),(e:any)=>e.code==='POINT_REPLY_LIMIT');assert(errorCancelled);
  const reply=JSON.parse(f.nativeBody.toString('utf8'));reply.metadata.batch.start=1;
  for(const batch of [null,{start:8192,count:8192}])await assert.rejects(
    ()=>nativePointBatch({...f.input,batch},bounds,async()=>new Response(JSON.stringify(reply))),
    (e:any)=>e.code==='POINT_BATCH_SCOPE');
  await assert.rejects(()=>runPointBatchJob(f.input.jobId,f.deps,{deadlineAt:NaN}),(e:any)=>e.code==='POINT_DEADLINE');
  f.job.status='running';f.meta.logical_state='running';
  f.attempts.push({number:2,fence:2,owner:'unknown-expired-owner-control',input_sha256:f.meta.input_sha256,
    state:'active',lease_until:new Date(Date.now()-1)});
  await failPointBatchJob(f.input.jobId,'POINT_PROCESSING_FAILED');
  assert.equal(f.job.status,'running');assert.equal(f.attempts[0].state,'active');
  assert(!f.events.length);assert(!f.queries.some(q=>q.startsWith('UPDATE jobs')));
  save('exact-batch-error-terminal-control.json',{qualification:'technical HTTP and unknown-owner SQL controls; no native/services',
    outcomes,errorReplyCapBeforeJson:true,wrongFirstAndExplicitBatchDenied:true,nonfiniteDeadlineBeforeIo:true,
    unownedExpiredAttemptPreserved:true,privateEvents:0});
}));
