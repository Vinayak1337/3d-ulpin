import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {GEOPARQUET_VERSION,GeoParquetOriginalSchema} from '../packages/contracts/src/usp/geoparquet-ingestion';
import {CaseIngestionChangeSchema} from '../packages/contracts/src/usp';
import {GeoParquetIngestionService,geoparquetSourceTx,geoparquetInput,assertGeoParquetInputTx,assertGeoParquetJobRow,isGeoParquetProtectedSource,geoparquetResultBytes} from '../packages/server/src/modules/usp/ingestion/geoparquet';
import {failGeoParquetJob,runGeoParquetJob} from '../packages/server/src/modules/usp/ingestion/geoparquet-worker';
import {geoparquetConfig,assertGeoParquetTools} from '../packages/server/src/modules/usp/ingestion/geoparquet-config';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fingerprint,sourceFrom} from '../packages/server/src/modules/cases/domain';
import {CaseIntakeService} from '../packages/server/src/modules/cases/case-intake-service';
import {documentAuthorityTx,captureDocumentSourceTx} from '../packages/server/src/modules/usp/ingestion/document-authority';
import {assertPackageDocumentAuthority} from '../packages/server/src/modules/areas/package-authority';
import {sha256,closeStorageClient} from '../packages/server/src/infrastructure/storage';

// SQL/storage protocol doubles, never persisted records or operational GeoParquet facts.
// Reader metadata reuses unchanged upstream development bytes and accepted output.
const root=process.env.ULPIN_GEOPARQUET_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-geoparquet-native';
const present=existsSync(root+'/originals/example.parquet');
const require=createRequire(new URL('../packages/server/package.json',import.meta.url)),{S3Client}=require('@aws-sdk/client-s3');
const sources=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-geoparquet/sources.json',import.meta.url),'utf8')).sources;
const lineageFor=(name:string)=>{const s=sources.find((s:any)=>s.path.replaceAll('\\','/').endsWith('/'+name));return {issuer:s.issuer,originalUrl:s.originalUrl,
  acquiredAt:new Date(s.acquiredAt).toISOString(),permissionReference:null,geography:s.geography,limitations:['test_only upstream example; independent operational accuracy/redistribution unqualified',s.licence]};};
const lineage=lineageFor('example.parquet'),selection={startRowIndex:0,rowCount:2};
function fixture(sourceName='example.parquet'){
  const raw=readFileSync(root+'/originals/'+sourceName),hash=sha256(raw),caseId=randomUUID(),sourceId=randomUUID(),binding=ingestionBinding(caseId);
  assert.equal(hash,sourceName==='example.parquet'?'f3e4bf0b0376904f851057d2047bb69e81dce913f2ff1aabe8a4dc1ec0789bc2':
    '12a618d20a59ee0967fef45e7ec1ff6d451e724838edc1bbeac780ca15e8fcc4');
  const current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:null};
  const original=GeoParquetOriginalSchema.parse({version:GEOPARQUET_VERSION,subject:binding.subject,accessSha256:binding.access,
    sha256:hash,bytes:raw.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage});
  const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,name:'inspection.parquet',mime_type:'application/octet-stream',
    sha256:hash,bytes:raw.length,profile:'geoparquet-native-v1',object_key:`sources/${sourceId}/${hash}`,status:'received',
    created_at:new Date(),inspection:{geoparquetOriginal:original,geoparquetAccepted:{private:'retained'},referenceParts:[{private:'retained'}]}};
  let latest=1;
  const calls:string[]=[],events:any[]=[],jobs=new Map<string,any>(),operations=new Map<string,any>();
  const query=async(sql:string,args:any[]=[])=>{
    calls.push(sql);let rows:any[]=[];
    if(sql.startsWith('SELECT set_config'))rows=[{deadline_live:Date.now()<Date.parse(args[1])}];
    else if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('FROM cases'))rows=args[0]===caseId?[current]:[];
    else if(sql.includes('max(revision)'))rows=[{revision:latest}];
    else if(sql.includes('count(*)::int sources'))rows=[{sources:1,bytes:String(raw.length)}];
    else if(sql.startsWith('INSERT INTO sources'))Object.assign(source,{id:args[0],family_id:args[0],name:args[2],bytes:args[3],sha256:args[4],object_key:args[5],inspection:args[6]});
    else if(sql.startsWith('UPDATE cases'))current.revision++;
    else if(sql.includes('FROM sources'))rows=args[0]===caseId&&args[1]===source.id||args[0]===source.id||Array.isArray(args[0])&&args[0].includes(source.id)?[source]:[];
    else if(sql.includes('FROM operations'))rows=operations.has(args[1])?[operations.get(args[1])]:[];
    else if(sql.includes('count(*)::int n'))rows=[{n:sql.includes('source_id')?jobs.size:[...jobs.values()].filter(j=>['queued','running'].includes(j.status)).length}];
    else if(sql.startsWith('INSERT INTO jobs'))jobs.set(args[0],{id:args[0],case_id:args[1],source_id:args[2],operation:'geoparquet-native',case_revision:args[3],input_fingerprint:args[4],payload:args[5],status:'queued',logical_state:'queued',result_ref:null});
    else if(sql.includes('FROM jobs')){const job=jobs.get(args[0]);rows=job?[sql.startsWith('SELECT status')?{status:job.status}:{...job,attempt_state:job.attempt?.state,attempt_fence:job.attempt?.fence,attempt_input_sha256:job.attempt?.input_sha256,completion_sha256:job.attempt?.completion_sha256}]:[];}
    else if(sql.startsWith('INSERT INTO usp_job_metadata')){jobs.get(args[0]).input_sha256=args[2];}
    else if(sql.includes('FROM usp_job_metadata')){const job=jobs.get(args[0]);rows=job?.input_sha256?[job]:[];}
    else if(sql.includes('FROM usp_job_attempts')){const job=jobs.get(args[0]);rows=job?.attempt&&(!sql.includes('lease_until>now()')||job.attempt.state==='active'&&new Date(job.attempt.lease_until).getTime()>Date.now())?[job.attempt]:[];}
    else if(sql.startsWith('INSERT INTO usp_job_attempts')){const job=jobs.get(args[0]),lease=new Date(Date.now()+180000);job.attempt={number:args[1],fence:args[2],owner:args[3],input_sha256:args[4],state:'active',lease_until:lease};rows=[{lease_until:lease}];}
    else if(sql.startsWith('UPDATE usp_job_attempts')){const job=jobs.get(args[0]);if(job?.attempt){job.attempt.state=sql.includes("state='accepted'")?'accepted':'fenced';job.attempt.completion_sha256=args[1];}}
    else if(sql.startsWith('UPDATE usp_job_metadata')){const job=jobs.get(args[0]);job.logical_state=sql.includes("logical_state='succeeded'")?'succeeded':sql.includes("logical_state='running'")?'running':'failed';if(job.logical_state==='succeeded')Object.assign(job,{result_ref:args[1],accepted_fence:args[2]});}
    else if(sql.startsWith('UPDATE jobs'))Object.assign(jobs.get(args[0]),{status:sql.includes("status='succeeded'")?'succeeded':sql.includes("status='running'")?'running':args[1],error:sql.includes('error=NULL')?null:args[2]});
    else if(sql.startsWith('INSERT INTO operations'))operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else if(sql.startsWith('INSERT INTO usp_outbox_streams')){}
    else if(sql.startsWith('UPDATE usp_outbox_streams'))rows=[{sequence:String(events.length+1)}];
    else if(sql.startsWith('INSERT INTO usp_outbox'))events.push(args[2]);
    else throw new Error('Unexpected protocol query: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  };
  const client=Object.assign(new EventEmitter(),{query,release:()=>{}});
  return {raw,hash,caseId,sourceId,current,original,source,client,calls,events,jobs,operations,setLatest:(v:number)=>{latest=v;}};
}
async function isolated(work:(f:ReturnType<typeof fixture>)=>Promise<void>,configured=false,sourceName='example.parquet'){
  const names=['ULPIN_LOCAL_OPERATOR_SUBJECT','ULPIN_GEOPARQUET_PROFILE','ULPIN_GEOPARQUET_PROFILE_SHA256','S3_ENDPOINT','S3_ACCESS_KEY','S3_SECRET_KEY'],prior=names.map(n=>process.env[n]);
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='geoparquet-protocol-control';if(!configured){delete process.env.ULPIN_GEOPARQUET_PROFILE;delete process.env.ULPIN_GEOPARQUET_PROFILE_SHA256;}
  process.env.S3_ENDPOINT='http://127.0.0.1:1';process.env.S3_ACCESS_KEY=process.env.S3_SECRET_KEY='memory-only-control';
  const globals=globalThis as any,pool=globals.ulpinPool,f=fixture(sourceName);globals.ulpinPool={connect:async()=>f.client,query:f.client.query};
  try{await work(f);}finally{if(pool===undefined)delete globals.ulpinPool;else globals.ulpinPool=pool;names.forEach((n,i)=>{if(prior[i]===undefined)delete process.env[n];else process.env[n]=prior[i];});closeStorageClient();}
}

test('GeoParquet input/accepted attempts bind exact case, access, source, hash and byte-size pins',{skip:!present},()=>isolated(async f=>{
  const ctx=await geoparquetSourceTx(f.client as any,f.caseId,f.sourceId),input=geoparquetInput(ctx,randomUUID(),selection,null),digest=fingerprint(input);
  const row={id:input.jobId,operation:'geoparquet-native',case_id:f.caseId,source_id:f.sourceId,case_revision:1,payload:input,input_fingerprint:digest,input_sha256:digest,
    status:'succeeded',logical_state:'succeeded',result_ref:{assetId:`geoparquet:${input.jobId}:1024`,version:1,sha256:f.hash},attempt_state:'accepted',attempt_fence:1,accepted_fence:1,attempt_input_sha256:digest,completion_sha256:f.hash};
  assertGeoParquetJobRow(row,input,true);assert.equal(geoparquetResultBytes(row.result_ref,input.jobId),1024);
  for(const patch of [{accepted_fence:2},{attempt_state:'fenced'},{completion_sha256:'0'.repeat(64)},{result_ref:{...row.result_ref,assetId:`geoparquet:${input.jobId}:999999`}}]){
    if(patch.result_ref)assert.throws(()=>geoparquetResultBytes(patch.result_ref!,input.jobId));else assert.throws(()=>assertGeoParquetJobRow({...row,...patch},input,true));
  }
  await assertGeoParquetInputTx(f.client as any,input);
  f.current.revision++;await assert.rejects(()=>assertGeoParquetInputTx(f.client as any,input),(e:any)=>e.status===409);f.current.revision--;
  f.current.context={changed:true} as any;await assert.rejects(()=>assertGeoParquetInputTx(f.client as any,input),(e:any)=>e.status===409);f.current.context=null;
  f.setLatest(2);await assert.rejects(()=>assertGeoParquetInputTx(f.client as any,input),(e:any)=>e.status===409);f.setLatest(1);
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='other';await assert.rejects(()=>geoparquetSourceTx(f.client as any,f.caseId,f.sourceId),(e:any)=>e.status===403);
}));

test('canonical original and general original paths recheck after I/O; snapshots/copies/packages cannot bypass GeoParquet',{skip:!present},()=>isolated(async f=>{
  const send=S3Client.prototype.send;let reads=0,mutate:()=>void=()=>{};
  S3Client.prototype.send=async function(command:any){assert.equal(command.constructor.name,'GetObjectCommand');reads++;mutate();return {Body:Readable.from([f.raw]),ContentLength:f.raw.length,ETag:'memory-etag'};};
  try{
    const service=new CaseIntakeService(),saved=structuredClone(f.source);
    assert.deepEqual((await service.sourceFile(f.sourceId)).bytes,f.raw);
    assert.equal(await service.streamedSourceFile(f.sourceId,new AbortController().signal),null);
    const projected=sourceFrom(f.source as any);assert.equal(JSON.stringify(projected).includes('geoparquetOriginal'),false);assert.equal(JSON.stringify(projected).includes('retained'),false);
    assert.deepEqual(f.source,saved);
    mutate=()=>{f.current.revision++;};await assert.rejects(()=>service.sourceFile(f.sourceId),(e:any)=>e.status===409);
    mutate=()=>{f.current.archived=true;};await assert.rejects(()=>new GeoParquetIngestionService().original(f.caseId,f.sourceId),(e:any)=>e.status===403);
    f.current.archived=false;mutate=()=>{process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='other';};await assert.rejects(()=>service.sourceFile(f.sourceId),(e:any)=>e.status===403);
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='geoparquet-protocol-control';mutate=()=>{};
    for(const marker of [null,false,0,'',{}]){
      const captured={...f.source,profile:'plan-pdf-v1',inspection:{geoparquetOriginal:marker}};
      assert.equal(isGeoParquetProtectedSource(captured),true);
      for(const mode of ['original','snapshot','copy'] as const)await assert.rejects(()=>documentAuthorityTx(f.client as any,captured,mode),(e:any)=>e.code==='GEOPARQUET_CANONICAL_SOURCE_REQUIRED');
      await assert.rejects(()=>captureDocumentSourceTx(f.client as any,captured));
    }
    const legacy={...f.source,inspection:{},profile:'plan-pdf-v1'};
    await assert.rejects(()=>documentAuthorityTx(f.client as any,legacy),(e:any)=>e.code==='GEOPARQUET_CANONICAL_SOURCE_REQUIRED'); // current marker
    const missingClient={query:async()=>({rows:[]})};await assert.rejects(()=>documentAuthorityTx(missingClient as any,f.source)); // captured marker/missing current
    const copied={...legacy,id:randomUUID(),inspection:{copiedFrom:{sourceRevisionId:f.sourceId,caseId:f.caseId,sourceHash:f.hash,sourceRevision:1}}};
    const copyClient={query:async(_sql:string,args:any[])=>({rows:[args[0]===copied.id?copied:f.source]})};
    await assert.rejects(()=>documentAuthorityTx(copyClient as any,copied,'copy'),(e:any)=>e.code==='GEOPARQUET_CANONICAL_SOURCE_REQUIRED');
    await assert.rejects(()=>assertPackageDocumentAuthority(f.client as any,{sourceRevisionIds:[f.sourceId],parts:[]} as any));
    assert.equal(reads,4);
  }finally{S3Client.prototype.send=send;}
}));

test('tool outage fails recoverably, originals stay readable and explicit retry is idempotent; late owners cannot fail a newer fence',{skip:!present},()=>isolated(async f=>{
  const ctx=await geoparquetSourceTx(f.client as any,f.caseId,f.sourceId),input=geoparquetInput(ctx,randomUUID(),selection,null),digest=fingerprint(input),
    job={id:input.jobId,operation:'geoparquet-native',case_id:f.caseId,source_id:f.sourceId,case_revision:1,payload:input,input_fingerprint:digest,input_sha256:digest,status:'queued',logical_state:'queued',result_ref:null} as any;
  f.jobs.set(job.id,job);
  await runGeoParquetJob(job.id);assert.equal(job.status,'failed');assert.equal(job.error,'GEOPARQUET_UNAVAILABLE');assert.equal(f.source.sha256,f.hash);
  const service=new GeoParquetIngestionService(),status=await service.status(f.caseId,f.sourceId,job.id);assert.equal(status.status,'failed');assert.equal(status.result,null);
  const request={requestKey:randomUUID(),expectedCaseRevision:1,expectedSourceRevision:1,sourceSha256:f.hash,selection,continuation:null};
  const retry=await service.enqueue(f.caseId,f.sourceId,request);assert.notEqual(retry.jobId,job.id);assert.deepEqual(await service.enqueue(f.caseId,f.sourceId,request),retry);
  assert.equal(f.jobs.size,2);assert.equal(f.jobs.get(retry.jobId).payload.tools,null);
  assert.throws(()=>CaseIngestionChangeSchema.parse({...f.events.at(-1).change,localPath:'not allowed'}));
  for(const status of ['queued','running','completed','failed','stale'])assert.equal(CaseIngestionChangeSchema.parse({kind:'geoparquet-native.changed',sourceId:f.sourceId,sourceRevision:1,jobId:job.id,status}).kind,'geoparquet-native.changed');
  job.status='running';job.logical_state='running';job.attempt={number:2,fence:2,owner:'current',input_sha256:digest,state:'active',lease_until:new Date(Date.now()+180000)};
  await failGeoParquetJob(job.id,f.caseId,'GEOPARQUET_TIMEOUT',{jobId:job.id,number:1,fence:1,owner:'late',inputSha256:digest,leaseUntil:new Date().toISOString()});assert.equal(job.status,'running');
  job.attempt.lease_until=new Date(Date.now()-1);await runGeoParquetJob(job.id);assert.equal(job.error,'GEOPARQUET_INTERRUPTED');
  assert.equal(f.calls.some(sql=>sql.startsWith('INSERT INTO usp_job_attempts')),false); // no silent native rerun
}));

test('unchanged receipt survives an outage and replays without another object write',{skip:!present},()=>isolated(async f=>{
  const send=S3Client.prototype.send,stored=new Map<string,Buffer>();let puts=0;
  S3Client.prototype.send=async function(command:any){const key=command.input.Key;
    if(command.constructor.name==='PutObjectCommand'){assert.equal(command.input.IfNoneMatch,'*');puts++;stored.set(key,Buffer.from(command.input.Body));return {};}
    if(command.constructor.name==='GetObjectCommand'){const bytes=stored.get(key)!;return {Body:Readable.from([bytes]),ContentLength:bytes.length,ETag:'memory-etag'};}
    throw new Error('Unexpected storage mutation');
  };
  try{
    const service=new GeoParquetIngestionService(),request={requestKey:randomUUID(),expectedCaseRevision:1,lineage,selection},file={name:'inspection.parquet',bytes:f.raw};
    const receipt=await service.retain(f.caseId,request,file);assert.equal(receipt.caseRevision,2);assert.equal(receipt.sourceSha256,f.hash);
    assert.deepEqual(await service.retain(f.caseId,request,file),receipt);assert.equal(puts,1);
    assert.equal(f.jobs.get(receipt.jobId).payload.tools,null);await runGeoParquetJob(receipt.jobId);assert.equal(f.jobs.get(receipt.jobId).error,'GEOPARQUET_UNAVAILABLE');
    assert.deepEqual((await service.original(f.caseId,receipt.sourceId)).bytes,f.raw);assert.equal(stored.size,1);
    f.current.revision++;await assert.rejects(()=>service.retain(f.caseId,request,file),(e:any)=>e.status===409);assert.equal(puts,1);
  }finally{S3Client.prototype.send=send;}
}));

test('generic retry caller refuses failed GeoParquet jobs before any copy, source update or capacity mutation',{skip:!present},()=>isolated(async f=>{
  const service=new CaseIntakeService(),saved=structuredClone(f.source);
  for(let i=0;i<2;i++){
    const id=randomUUID(),input=geoparquetInput(await geoparquetSourceTx(f.client as any,f.caseId,f.sourceId),id,selection,null);
    f.jobs.set(id,{id,operation:'geoparquet-native',case_id:f.caseId,source_id:f.sourceId,status:'failed',payload:input});
    const before=f.calls.length;
    await assert.rejects(()=>service.retry(id),(e:any)=>e.status===422&&e.code==='GEOPARQUET_CANONICAL_RETRY_REQUIRED'&&e.message.includes('source-bound GeoParquet'));
    assert.equal(f.calls.slice(before).some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)||sql.includes('FROM cases')),false);
  }
  assert.equal(f.jobs.size,2);assert.equal([...f.jobs.values()].filter(j=>['queued','running'].includes(j.status)).length,0);
  assert.deepEqual(f.source,saved);assert.equal(f.events.length,0);
}));

test('selected upstream rows and absent-geo inventory pass actual bounded worker; exact continuation queues without another parser',
 {skip:process.env.ULPIN_GEOPARQUET_LOCAL_PROCESS!=='1'||!present},async()=>{
 for(const sourceName of ['example.parquet','alltypes_plain.parquet'])await isolated(async f=>{
   const originalSend=S3Client.prototype.send,stored=new Map<string,Buffer>();let mutate:()=>void=()=>{};
   S3Client.prototype.send=async function(command:any){const key=command.input.Key;
     if(command.constructor.name==='PutObjectCommand'){assert.equal(command.input.IfNoneMatch,'*');stored.set(key,Buffer.from(command.input.Body));return {};}
     if(command.constructor.name==='GetObjectCommand'){const bytes=stored.get(key)!;mutate();return {Body:Readable.from([bytes]),ContentLength:bytes.length,ETag:'memory-etag'};}
     throw Error('Unexpected storage command');
   };
   try{
     const service=new GeoParquetIngestionService(),config=geoparquetConfig(),request={requestKey:randomUUID(),expectedCaseRevision:1,lineage:lineageFor(sourceName),selection};
     const receipt=await service.retain(f.caseId,request,{name:sourceName,bytes:f.raw});assert.equal(receipt.caseRevision,2);
     assert.deepEqual(await service.retain(f.caseId,request,{name:sourceName,bytes:f.raw}),receipt);assert.equal(stored.size,1);
     const job=f.jobs.get(receipt.jobId)!;await runGeoParquetJob(job.id);assert.equal(job.status,'succeeded',job.error);assert.equal(job.attempt.state,'accepted');
     const status=await service.status(f.caseId,f.source.id,job.id),artifact=await service.artifact(f.caseId,f.source.id,job.id),native=JSON.parse(artifact.bytes.toString('utf8'));
     assert.equal(status.status,sourceName==='example.parquet'?'partial':'unsupported');assert.equal(native.source.sha256,f.hash);
     const expected=sourceName==='example.parquet'?'final-example':'final-absent-geo';
     assert.deepEqual(artifact.bytes,readFileSync(root+'/evidence/'+expected+'/projection.json'));
     assert.deepEqual(native.window.requestedRows,selection.rowCount);assert.equal(native.window.requestedStartRowIndex,selection.startRowIndex);
     assert.deepEqual((await service.original(f.caseId,f.source.id)).bytes,f.raw);
     const accepted=JSON.parse(stored.get(`geoparquet-native/${job.id}/${job.result_ref.sha256}.json`)!.toString('utf8'));
     assert.equal(accepted.summary.registryAdmission,false);assert.equal(accepted.summary.learningLabels,false);
     const retryRequest={requestKey:randomUUID(),expectedCaseRevision:2,expectedSourceRevision:1,sourceSha256:f.hash,
       selection:status.continuation?{startRowIndex:status.continuation.nextRowIndex,rowCount:2}:selection,continuation:status.continuation};
     if(sourceName==='example.parquet'){
       assert.equal(native.rows[0].columns.name.value,'Fiji');assert.equal(native.rows[1].columns.name.value,'Tanzania');
       assert.equal(native.rows[0].columns.gdp_md_est.value.decimalInteger,'5496');assert.equal(native.rows[1].columns.gdp_md_est.value.decimalInteger,'63177');
       assert.equal(status.continuation!.nextRowIndex,2);assert.equal(native.window.coordinateValues,148);
       for(const patch of [{resultSha256:'0'.repeat(64)},{artifactSha256:'0'.repeat(64)},{nextRowIndex:3}])
         await assert.rejects(()=>service.enqueue(f.caseId,f.source.id,{...retryRequest,continuation:{...retryRequest.continuation,...patch}}));
     }else{assert.equal(native.geoMetadata.state,'absent');assert.deepEqual(native.profile.reasons,['geo_absent']);assert.equal(status.continuation,null);assert.equal(native.rows.length,0);}
     const retry=await service.enqueue(f.caseId,f.source.id,retryRequest);assert.deepEqual(await service.enqueue(f.caseId,f.source.id,retryRequest),retry);
     const nextInput=f.jobs.get(retry.jobId).payload;
     assert.deepEqual(nextInput.selection,retryRequest.selection);
     if(status.continuation){assert.equal(nextInput.continuation.inputSha256,fingerprint(job.payload));assert.equal(nextInput.continuation.acceptedFence,1);}
     // Exactly one native invocation per original. A revocation after original I/O blocks this retry before parsing/staging.
     mutate=()=>{f.current.archived=true;};await runGeoParquetJob(retry.jobId);
     assert.equal(f.jobs.get(retry.jobId).error,'GEOPARQUET_DENIED');assert.equal(f.jobs.get(retry.jobId).result_ref,null);assert.equal(stored.size,3);
     f.current.archived=false;mutate=()=>{};
     const proof=process.env.ULPIN_GEOPARQUET_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
       writeFileSync(proof+'/'+sourceName+'.native.json',artifact.bytes,{flag:'wx'});
       writeFileSync(proof+'/'+sourceName+'.journey.json',JSON.stringify({scope:'actual bounded native execution over unchanged test_only bytes; SQL/storage memory controls; continuation queued but denied before second parser',
         receipt,status,accepted,retryRequest,retry,nextInput,retryFailure:f.jobs.get(retry.jobId).error,artifactSha256:sha256(artifact.bytes),artifactBytes:artifact.bytes.length,pins:config.pins},null,2)+'\n',{flag:'wx'});
     }
     console.log(JSON.stringify({sourceName,status:status.status,artifactSha256:sha256(artifact.bytes),artifactBytes:artifact.bytes.length,summary:accepted.summary,continuation:status.continuation,supervision:accepted.supervision}));
     mutate=()=>{f.current.archived=true;};await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.status===403);
     f.current.archived=false;mutate=()=>{};job.attempt.state='fenced';await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.status===409);job.attempt.state='accepted';
     f.current.revision++;assert.equal((await service.status(f.caseId,f.source.id,job.id)).status,'stale');
     await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.status===409);
   }finally{S3Client.prototype.send=originalSend;}
 },true,sourceName);
});
