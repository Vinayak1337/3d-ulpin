import '../packages/server/src/modules/usp/ingestion/intake-surface';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {RasterOriginalSchema,RasterWindowResultSchema} from '../packages/contracts/src/usp/raster-window';
import {rasterInput,rasterResultKey} from '../packages/server/src/modules/usp/ingestion/raster-window';
import {readRasterObject} from '../packages/server/src/modules/usp/ingestion/raster-window-object';
import {runRasterWindowJob} from '../packages/server/src/modules/usp/ingestion/raster-window-worker';
import {nativeRasterWindow,rasterNativeJson,RASTER_NATIVE_REPLY_BYTES}
  from '../packages/server/src/modules/usp/ingestion/raster-publication';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Canonical claim/assert/accept/outbox/deadline functions run over SQL doubles.
// Native HTTP and immutable storage are controls, never services or parser runs.
// Retained metadata/original are genuine; all inputs/envelopes/fences and default NON-TIFF
// transport bytes are separate controls, not absent historical artifact proof.
const root='E:/BhuAayam-data/task-data/desktop-ai05a-raster',originalPath='E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-dem-2017.tif';
const present=existsSync(root+'/raster-http-receipt.json')&&existsSync(originalPath);
function fixture(nativeReply?:any){
  const oldBytes=readFileSync(root+'/raster-http-receipt.json'),old=JSON.parse(oldBytes.toString('utf8')),
    original=readFileSync(originalPath),manifest=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json','utf8')),
    upstream=manifest.originals.find((v:any)=>v.name==='be_NYC_025.tif');
  assert.equal(sha256(oldBytes),'60d0e8debbb5524e6351e55abdfd561210cf6e9167a703bee9f7da22d5a787ae');
  assert.equal(sha256(original),old.sourceHash);assert.equal(original.length,old.sourceBytes);
  const current={id:old.caseId,revision:1,archived:false,frame:null,context:null,site_id:null},binding=ingestionBinding(current.id),
    marker=RasterOriginalSchema.parse({version:'raster-window/1',subject:binding.subject,sha256:old.sourceHash,bytes:old.sourceBytes,
      receivedAt:old.first.result.createdAt,lineageState:'caller_declared',lineage:{kind:'native_grid_derivative',issuer:'NYS GIS Program Office / NYC survey',
        originalUrl:upstream.url,acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.coverage,
        upstreamBytes:upstream.bytes,upstreamRetained:false,parentSha256:null,limitations:manifest.limitations,note:'memory-only authority control'}}),
    source={id:old.sourceId,case_id:current.id,family_id:old.sourceId,revision:1,profile:'geotiff-raster-v1',sha256:old.sourceHash,
      bytes:old.sourceBytes,object_key:`sources/${old.sourceId}/${old.sourceHash}`,inspection:{rasterOriginal:marker}},
    // Pin the historical crop explicitly: null now means the whole-extent overview.
    input=rasterInput({current,source,binding,latest:true,
      context:fingerprint({frame:null,context:null,siteId:null})},old.first.jobId,
      nativeReply?null:old.first.result.metadata.window),
    digest=fingerprint(input),
    job:any={id:input.jobId,case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,operation:'raster-window',
      payload:input,input_fingerprint:digest,status:'queued',error:null,attempts:0},
    meta:any={input_manifest_id:source.id,input_sha256:digest,scope:{kind:'intake',workspaceId:current.id,version:2},
      logical_state:'queued',result_ref:null,accepted_fence:null,version:1},
    attempts:any[]=[],events:any[]=[],objects=new Map<string,Buffer>(),
    technical=nativeReply?Buffer.from(nativeReply.artifactBase64,'base64'):
      Buffer.from('RASTER-03 NON-TIFF publication transport control'),
    nativeBody=Buffer.from(JSON.stringify(nativeReply??{metadata:old.first.result.metadata,
      artifactBase64:technical.toString('base64'),artifactSha256:sha256(technical),artifactBytes:technical.length}));
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
    else if(sql.includes('pg_advisory_xact_lock')){}
    else if(sql.startsWith('UPDATE sources SET inspection=jsonb_set'))
      Object.assign(source.inspection,{rasterHeader:JSON.parse(args[1])});
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
    // A job of the dedicated route has no batch intake part (SB1).
    else if(sql.includes('FROM usp_intake_parts'))rows=[];
    else assert.fail('unexpected SQL '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  };
  const client=Object.assign(new EventEmitter(),{query,release:()=>{active=false;}}),pool={connect:async()=>client,query};
  const request:typeof fetch=async(_url,options)=>{assert(!active);nativeCalls++;io.push('native');assert(options!.signal);deadlines.push(Date.now());
    assert.deepEqual(JSON.parse(String(options!.body)),{sourceId:input.sourceId,objectKey:input.objectKey,
      sha256:input.sourceSha256,bytes:input.sourceBytes,window:input.window});
    if(mode==='oversize')return new Response(new ReadableStream({cancel(){bodyCancelled=true;}}),{headers:{'content-length':String(RASTER_NATIVE_REPLY_BYTES+1)}});
    if(mode==='cancel'||mode==='timeout'){if(mode==='cancel')setTimeout(()=>controller.abort(),10);return new Response(new ReadableStream({
      start(c){c.enqueue(Buffer.from('{"metadata":'));},cancel(){bodyCancelled=true;}}));}
    return new Response(nativeBody,{headers:{'content-length':String(nativeBody.length)}});
  };
  const put=async(key:string,bytes:Uint8Array,_type:string,signal?:AbortSignal)=>{assert(!active);assert(signal);assert(!signal.aborted);puts++;io.push('put:'+key);
    const prior=objects.get(key);if(prior)assert.deepEqual(Buffer.from(bytes),prior);else objects.set(key,Buffer.from(bytes));
    if(mode==='replay')throw Object.assign(new Error('controlled immutable PUT replay'),{$metadata:{httpStatusCode:412}});
  };
  const read:typeof readRasterObject=async(key,hash,size,bounds)=>{assert(!active);assert(size!==null,'writer knows staged byte lengths');
    deadlines.push(bounds!.deadlineAt);io.push('read:'+key);const bytes=await readRasterObject(key,hash,size,bounds,{head:async()=>assert.fail('no writer HEAD'),
      open:async(key,size)=>{assert(!active);replayReads++;const bytes=objects.get(key);assert(bytes);assert.equal(bytes.length,size);
        const body=Readable.from([bytes]);streams.push(body);return {body,etag:'memory'};}});afterRead(key);return bytes;};
  return {old,original,input,current,source,job,meta,attempts,events,objects,technical,nativeBody,pool,queries,io,deadlines,streams,
    controller,deps:{request,put,read},setMode:(value:typeof mode)=>{mode=value;},setAfterRead:(fn:typeof afterRead)=>{afterRead=fn;},
    loseCommit:()=>{uncertain=true;},stats:()=>({active,nativeCalls,puts,replayReads,bodyCancelled,commitRepliesLost})};
}
async function isolated(work:(f:ReturnType<typeof fixture>)=>Promise<void>,nativeReply?:any){
  const globals=globalThis as any,previousPool=globals.ulpinPool,subject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
    geoUrl=process.env.GEO_URL,geoToken=process.env.GEO_SERVICE_TOKEN,
    sigint=process.listenerCount('SIGINT'),sigterm=process.listenerCount('SIGTERM');
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='raster-publication-control';
  process.env.GEO_URL='http://raster-publication-control.invalid';process.env.GEO_SERVICE_TOKEN='technical-control';
  const f=fixture(nativeReply);globals.ulpinPool=f.pool;
  try{await work(f);}finally{if(previousPool===undefined)delete globals.ulpinPool;else globals.ulpinPool=previousPool;
    if(subject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
    if(geoUrl===undefined)delete process.env.GEO_URL;else process.env.GEO_URL=geoUrl;
    if(geoToken===undefined)delete process.env.GEO_SERVICE_TOKEN;else process.env.GEO_SERVICE_TOKEN=geoToken;
    assert.equal(process.listenerCount('SIGINT'),sigint);assert.equal(process.listenerCount('SIGTERM'),sigterm);assert(!f.stats().active);}
}
const run=(f:ReturnType<typeof fixture>,deadlineAt?:number)=>runRasterWindowJob(f.input.jobId,f.deps,{signal:f.controller.signal,deadlineAt});
function save(name:string,value:unknown){const dir=process.env.ULPIN_RASTER_PUBLICATION_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('controlled native reply and immutable replay publish through canonical fenced acceptance with all I/O outside SQL',{skip:!present},()=>isolated(async f=>{
  f.setMode('replay');await run(f);assert.equal(f.job.status,'succeeded');assert.equal(f.meta.logical_state,'succeeded');assert.equal(f.meta.accepted_fence,1);
  assert.equal(f.attempts[0].state,'accepted');const bytes=f.objects.get(rasterResultKey(f.input.jobId,f.meta.result_ref.sha256))!,result=RasterWindowResultSchema.parse(JSON.parse(bytes.toString('utf8')));
  assert.equal(f.meta.result_ref.sha256,sha256(bytes));assert.equal(f.attempts[0].completion_sha256,sha256(bytes));
  assert.deepEqual(result.metadata,f.old.first.result.metadata);
  assert.deepEqual(result.input.window,f.old.first.result.metadata.window);assert.deepEqual(result.input,f.input);
  assert.deepEqual(f.objects.get(result.artifact.key),f.technical);assert.equal(result.artifact.sha256,sha256(f.technical));
  assert(f.events.some(e=>e.type==='job.succeeded'));assert(f.events.some(e=>e.change?.status==='completed'));
  assert.equal(f.stats().replayReads,4);assert(f.streams.every(s=>s.destroyed));assert.equal(new Set(f.deadlines.filter(n=>n>Date.now()+1000)).size,1);
  const before=f.stats();await run(f);assert.deepEqual(f.stats(),before,'accepted job must not reprocess');
  save('controlled-publication.json',{qualification:'NON-TIFF native/storage controls; canonical job/SQL/outbox over memory transport; no historical artifact proof',
    input:f.input,result,resultObjectUtf8:bytes.toString('utf8'),artifactTransportBase64:f.technical.toString('base64'),
    acceptedRef:f.meta.result_ref,attempt:f.attempts[0],events:f.events,io:f.io,stats:f.stats(),
    original:{path:originalPath,bytes:f.original.length,sha256:sha256(f.original)},historicalArtifactReproduced:false});
}));

test('overview display header is recorded on the source and carried unchanged by later windows',
  {skip:!present},()=>isolated(async f=>{
    const stretch={usage:'display_only' as const,basis:'source_overview_percentile_2_98' as const,
      bands:[{index:1,low:2,high:9}]};
    const metadata={...f.old.first.result.metadata,window:{...f.input.window,step:f.input.window?.step??1},
      display:{bands:[1],scaling:'source_percentile_2_98',usage:'display_only',stretch}};
    const response=()=>Response.json({metadata,artifactBase64:f.technical.toString('base64'),
      artifactSha256:sha256(f.technical),artifactBytes:f.technical.length});
    f.deps.request=async()=>response();
    await run(f);
    assert.equal(f.job.status,'succeeded');
    const header=(f.source.inspection as any).rasterHeader;
    assert.equal(header.sourceSha256,f.input.sourceSha256);
    assert.equal(header.readerSha256,f.input.readerSha256);
    assert.deepEqual(header.display.stretch,stretch);
    const later=rasterInput({current:f.current,source:f.source,binding:ingestionBinding(f.current.id),latest:true,
      context:f.input.caseContextSha256},f.input.jobId,f.input.window);
    assert.deepEqual(later.displayStretch,stretch);
    const writes=f.queries.filter(q=>q.startsWith('UPDATE sources')).length;
    await nativeRasterWindow(later,{deadlineAt:Date.now()+1000},async(_url,options)=>{
      assert.deepEqual(JSON.parse(String(options!.body)).displayStretch,stretch);
      return response();
    });
    assert.equal(f.queries.filter(q=>q.startsWith('UPDATE sources')).length,writes,'header is recorded once');
    const wrong={...metadata,display:{...metadata.display,stretch:{...stretch,bands:[{index:1,low:3,high:9}]}}};
    await assert.rejects(()=>nativeRasterWindow(later,{deadlineAt:Date.now()+1000},async()=>Response.json({
      metadata:wrong,artifactBase64:f.technical.toString('base64'),artifactSha256:sha256(f.technical),
      artifactBytes:f.technical.length})),(e:any)=>e.code==='RASTER_STRETCH_SCOPE');
    const missing={...metadata,display:{bands:[1],scaling:'stored_uint8',usage:'display_only'}};
    await assert.rejects(()=>nativeRasterWindow(later,{deadlineAt:Date.now()+1000},async()=>Response.json({
      metadata:missing,artifactBase64:f.technical.toString('base64'),artifactSha256:sha256(f.technical),
      artifactBytes:f.technical.length})),(e:any)=>e.code==='RASTER_STRETCH_SCOPE');
    assert(!f.input.displayStretch,'recording a header does not mutate earlier enrolled inputs');
    f.source.inspection={...f.source.inspection,rasterHeader:{...header,sourceSha256:'f'.repeat(64)}} as any;
    assert.equal(rasterInput({current:f.current,source:f.source,binding:ingestionBinding(f.current.id),latest:true,
      context:f.input.caseContextSha256},f.input.jobId,f.input.window).displayStretch,undefined);
  }));

// Generated test_only native replies; source authority and SQL remain the controls above, not a live run.
const nativeReplies=JSON.parse(readFileSync('tests/fixtures/raster-window-native.json','utf8'));
for(const name of ['cube','sampled']){
  test(`native ${name} metadata publishes through fenced acceptance`,{skip:!present},()=>isolated(async f=>{
    await run(f);
    assert.equal(f.job.status,'succeeded');
    assert.equal(f.attempts[0].state,'accepted');
    const key=rasterResultKey(f.input.jobId,f.meta.result_ref.sha256),bytes=f.objects.get(key)!;
    const result=RasterWindowResultSchema.parse(JSON.parse(bytes.toString('utf8')));
    assert.deepEqual(result.metadata,nativeReplies[name].metadata);
    assert.deepEqual(f.objects.get(result.artifact.key),f.technical);
    assert(f.events.some(e=>e.change?.status==='completed'));
    if(name==='sampled'){
      assert.equal((f.source.inspection as any).rasterHeader.display.overview,undefined);
      const later=rasterInput({current:f.current,source:f.source,binding:ingestionBinding(f.current.id),
        latest:true,context:f.input.caseContextSha256},f.input.jobId,nativeReplies.later.metadata.window);
      const read=await nativeRasterWindow(later,{deadlineAt:Date.now()+2000},
        async()=>Response.json(nativeReplies.later));
      assert.equal(read.metadata.window.x,228275);
      assert.equal(read.metadata.display?.overview,undefined);
      assert.deepEqual(later.displayStretch,result.metadata.display?.stretch);
      assert.deepEqual(result.metadata.display?.overview,{sampling:'spread_blocks',usage:'display_only'});
    }
  },nativeReplies[name]));
}

test('revision-only receipts before claim and during execution keep the queued raster input',{skip:!present},()=>isolated(async f=>{
  const enrolled=fingerprint(f.input);f.current.revision++;
  f.setAfterRead(()=>{f.current.revision++;});await run(f);
  assert.equal(f.job.status,'succeeded');assert.equal(fingerprint(f.input),enrolled);
  assert.equal(f.job.case_revision,f.input.caseRevision);assert.equal(f.attempts[0].state,'accepted');
}));

test('preflight never waives final source, cancellation or newer-attempt authority',{skip:!present},async()=>{
  const outcomes=[];
  for(const mode of ['stale','cancelled','newer','enrollment'] as const)await isolated(async f=>{
    f.setAfterRead(key=>{if(!key.endsWith('.tif'))return;
      if(mode==='stale')f.current.context={changed:true} as any;
      if(mode==='cancelled')f.meta.logical_state='cancelled';
      if(mode==='newer'){f.attempts[0].state='fenced';f.attempts.push({...f.attempts[0],number:2,fence:2,owner:'other-owner-control',state:'active'});}
      if(mode==='enrollment')f.meta.scope.version++;
    });
    await run(f);assert.equal(f.meta.result_ref,null);assert(!f.events.some(e=>e.type==='job.succeeded'||e.change?.status==='completed'));
    assert.equal(f.objects.size,2,'immutable prepared output stays retained');
    if(mode==='stale'){assert.equal(f.job.status,'stale');assert.equal(f.job.error,'RASTER_INPUT_STALE');
      assert(!f.events.some(e=>['stale','failed'].includes(e.change?.status)),'stale source cannot emit private failure event');}
    if(mode==='cancelled'){assert.equal(f.meta.logical_state,'cancelled');assert.equal(f.job.status,'running');}
    if(mode==='newer'){assert.equal(f.attempts.at(-1).owner,'other-owner-control');assert.equal(f.attempts.at(-1).state,'active');assert.equal(f.job.status,'running');}
    if(mode==='enrollment'){assert.equal(f.job.status,'failed');assert.equal(f.job.error,'RASTER_JOB_INTEGRITY');}
    outcomes.push({mode,status:f.job.status,logicalState:f.meta.logical_state,resultRef:f.meta.result_ref,stats:f.stats(),published:false});
  });
  save('final-authority-denials.json',{qualification:'SQL/source/fence/cancellation controls after bounded immutable preflight',outcomes});
});

test('oversized native reply, cancellation and timeout stop before staged publication',{skip:!present},async()=>{
  const outcomes=[];
  for(const mode of ['oversize','cancel','timeout'] as const)await isolated(async f=>{
    f.setMode(mode);await run(f,mode==='timeout'?Date.now()+100:undefined);assert.equal(f.job.status,'failed');
    assert.equal(f.job.error,mode==='oversize'?'RASTER_REPLY_LIMIT':mode==='cancel'?'RASTER_CANCELLED':'RASTER_TIMEOUT');
    assert.equal(f.stats().puts,0);assert(f.stats().bodyCancelled);assert.equal(f.objects.size,0);
    outcomes.push({mode,code:f.job.error,stats:f.stats(),published:false});
  });
  let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(17));},cancel(){cancelled=true;}}));
  await assert.rejects(()=>rasterNativeJson(response,16,{deadlineAt:Date.now()+1000}),(e:any)=>e.code==='RASTER_REPLY_LIMIT');assert(cancelled);
  save('bounded-native-denials.json',{qualification:'technical HTTP body controls; no parser or services',outcomes,streamOverrunBeforeJson:true});
});

test('raster 422 keeps each specific code and plain reason, including an older processor reply',async()=>{
  const previousUrl=process.env.GEO_URL,previousToken=process.env.GEO_SERVICE_TOKEN;
  process.env.GEO_URL='http://raster-publication-control.invalid';process.env.GEO_SERVICE_TOKEN='technical-control';
  try{
    for(const code of ['RASTER_SAMPLE_TYPE','RASTER_COMPRESSION','RASTER_PREDICTOR','RASTER_UNREADABLE',
      'RASTER_METADATA_LIMIT','RASTER_WINDOW_OUT_OF_BOUNDS','RASTER_SOURCE_INTEGRITY']){
      const sentence='This technical raster cannot be read for the stated reason.';
      const request:typeof fetch=async()=>Response.json({detail:`${code}: ${sentence}`},{status:422});
      await assert.rejects(()=>nativeRasterWindow({} as never,{deadlineAt:Date.now()+1000},request),
        (error:any)=>error.code===code&&error.message===sentence);
    }
    for(const [detail,code] of [
      ['Source hash or byte count differs from its retained receipt.','RASTER_SOURCE_INTEGRITY'],
      ['Pixel window is outside the retained raster dimensions.','RASTER_WINDOW_OUT_OF_BOUNDS'],
      ['An older reader explains its refusal.','RASTER_READER_REJECTION']]){
      const request:typeof fetch=async()=>Response.json({detail},{status:422});
      await assert.rejects(()=>nativeRasterWindow({} as never,{deadlineAt:Date.now()+1000},request),
        (error:any)=>error.code===code&&error.message.length>0);
    }
  }finally{
    if(previousUrl===undefined)delete process.env.GEO_URL;else process.env.GEO_URL=previousUrl;
    if(previousToken===undefined)delete process.env.GEO_SERVICE_TOKEN;else process.env.GEO_SERVICE_TOKEN=previousToken;
  }
});

test('lost canonical acceptance COMMIT reply preserves possibly committed output and avoids terminal rewrite',{skip:!present},()=>isolated(async f=>{
  f.loseCommit();await run(f);assert.equal(f.stats().commitRepliesLost,1);assert.equal(f.job.status,'succeeded');
  assert.equal(f.meta.logical_state,'succeeded');assert.equal(f.objects.size,2);assert.equal(f.attempts[0].state,'accepted');
  assert(!f.queries.some(q=>q.includes("logical_state='failed'")||q.includes("state='fenced'")));
  save('ambiguous-publication-control.json',{qualification:'memory SQL outcome models possibly durable COMMIT with lost reply; no real PostgreSQL durability claim',
    stats:f.stats(),retainedObjects:[...f.objects.keys()],resultRef:f.meta.result_ref,terminalRewrite:false,possiblyCommitted:true});
}));
