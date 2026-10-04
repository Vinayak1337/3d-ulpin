import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {GLTF_VERSION,GltfOriginalSchema} from '../packages/contracts/src/usp/gltf-ingestion';
import {GltfIngestionService,isGltfProtectedSource} from '../packages/server/src/modules/usp/ingestion/gltf';
import {runGltfJob} from '../packages/server/src/modules/usp/ingestion/gltf-worker';
import {gltfConfig,assertGltfTools} from '../packages/server/src/modules/usp/ingestion/gltf-config';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {sourceFrom} from '../packages/server/src/modules/cases/domain';
import {CaseIntakeService} from '../packages/server/src/modules/cases/case-intake-service';
import {documentAuthorityTx} from '../packages/server/src/modules/usp/ingestion/document-authority';
import {sha256,closeStorageClient} from '../packages/server/src/infrastructure/storage';

// SQL/storage protocol doubles, never persisted records or operational Gltf facts.
// Reader metadata reuses unchanged upstream development bytes and accepted output.
const root=process.env.ULPIN_GLTF_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-gltf-native';
const present=existsSync(root+'/originals/Box.glb');
const require=createRequire(new URL('../packages/server/package.json',import.meta.url)),{S3Client}=require('@aws-sdk/client-s3');
const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-gltf/sources.json',import.meta.url),'utf8'));
const lineageFor=(name:string)=>{const s=manifest.sources.find((s:any)=>s.path.replaceAll('\\','/').endsWith('/'+name));return {issuer:manifest.publisher,
  originalUrl:s.originalUrl,acquiredAt:new Date(s.acquiredAt).toISOString(),permissionReference:manifest.licenceUrl,geography:null,
  limitations:[manifest.attribution,'test_only graphics example; no operational, accuracy or property qualification',s.limitations]};};
const lineage=lineageFor('Box.glb');
function fixture(sourceName='Box.glb'){
  const raw=readFileSync(root+'/originals/'+sourceName),hash=sha256(raw),caseId=randomUUID(),sourceId=randomUUID(),binding=ingestionBinding(caseId);
  assert.equal(hash,sourceName==='Box.glb'?'ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e':
    '4a0d69eecfce0672a50b71dc218cbacec6c53fe2445040c235c6314b1b2c41b9');
  const current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:null};
  const original=GltfOriginalSchema.parse({version:GLTF_VERSION,subject:binding.subject,accessSha256:binding.access,
    sha256:hash,bytes:raw.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage});
  const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,name:'Box.glb',mime_type:'application/octet-stream',
    sha256:hash,bytes:raw.length,profile:'gltf-native-v1',object_key:`sources/${sourceId}/${hash}`,status:'received',
    created_at:new Date(),inspection:{gltfOriginal:original,gltfAccepted:{private:'retained'},referenceParts:[{private:'retained'}]}};
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
    else if(sql.startsWith('INSERT INTO jobs'))jobs.set(args[0],{id:args[0],case_id:args[1],source_id:args[2],operation:'gltf-native',case_revision:args[3],input_fingerprint:args[4],payload:args[5],status:'queued',logical_state:'queued',result_ref:null});
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
async function isolated(work:(f:ReturnType<typeof fixture>)=>Promise<void>,configured=false,sourceName='Box.glb'){
  const names=['ULPIN_LOCAL_OPERATOR_SUBJECT','ULPIN_GLTF_PROFILE','ULPIN_GLTF_PROFILE_SHA256','S3_ENDPOINT','S3_ACCESS_KEY','S3_SECRET_KEY'],prior=names.map(n=>process.env[n]);
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='gltf-protocol-control';if(!configured){delete process.env.ULPIN_GLTF_PROFILE;delete process.env.ULPIN_GLTF_PROFILE_SHA256;}
  process.env.S3_ENDPOINT='http://127.0.0.1:1';process.env.S3_ACCESS_KEY=process.env.S3_SECRET_KEY='memory-only-control';
  const globals=globalThis as any,pool=globals.ulpinPool,f=fixture(sourceName);globals.ulpinPool={connect:async()=>f.client,query:f.client.query};
  try{await work(f);}finally{if(pool===undefined)delete globals.ulpinPool;else globals.ulpinPool=pool;names.forEach((n,i)=>{if(prior[i]===undefined)delete process.env[n];else process.env[n]=prior[i];});closeStorageClient();}
}

// One actual accepted supervisor invocation per unchanged retained format.
// All database/object operations below are explicit in-memory protocol doubles.
test('glTF canonical producer/consumer keeps exact originals and partial companions; refusals make no writes',async()=>{
  assert(present,'Retained Box originals are required; no replacement source is generated.');
  assert.equal(process.env.ULPIN_GLTF_LOCAL_PROCESS,'1','Explicit current-profile native bridge admission is required.');
  for(const sourceName of ['Box.glb','Box.gltf'])await isolated(async f=>{
    const originalSend=S3Client.prototype.send,stored=new Map<string,Buffer>();let mutate:()=>void=()=>{};
    S3Client.prototype.send=async function(command:any){const key=command.input.Key;
      if(command.constructor.name==='PutObjectCommand'){assert.equal(command.input.IfNoneMatch,'*');stored.set(key,Buffer.from(command.input.Body));return {};}
      if(command.constructor.name==='GetObjectCommand'){const bytes=stored.get(key)!;mutate();return {Body:Readable.from([bytes]),ContentLength:bytes.length,ETag:'memory-etag'};}
      throw Error('Unexpected storage command');
    };
    try{
      const service=new GltfIngestionService(),config=gltfConfig(),request={requestKey:randomUUID(),expectedCaseRevision:1,lineage:lineageFor(sourceName)};
      const receipt=await service.retain(f.caseId,request,{name:sourceName,bytes:f.raw});assert.equal(receipt.caseRevision,2);
      assert.deepEqual(await service.retain(f.caseId,request,{name:sourceName,bytes:f.raw}),receipt);assert.equal(stored.size,1);
      const job=f.jobs.get(receipt.jobId)!;await runGltfJob(job.id);assert.equal(job.status,'succeeded',job.error);assert.equal(job.attempt.state,'accepted');
      const status=await service.status(f.caseId,f.source.id,job.id),artifact=await service.artifact(f.caseId,f.source.id,job.id),native=JSON.parse(artifact.bytes.toString('utf8'));
      assert.equal(status.status,sourceName==='Box.glb'?'completed':'partial');assert.equal(status.code,null);
      assert.equal(native.sourceSha256,f.hash);assert.equal(native.representation,'context_mesh');assert.equal(native.qualification.globalPlacement,'unknown');
      assert.deepEqual(artifact.bytes,readFileSync(root+'/'+(sourceName==='Box.glb'?'final-glb':'final-external-gltf')+'/gltf.json'));
      assert.equal(sha256(artifact.bytes),status.result!.artifact.sha256);assert.equal(status.result!.summary.analyticEligible,false);
      assert.equal(status.result!.summary.learningLabels,false);assert.equal(status.result!.summary.projectedPositions,sourceName==='Box.glb'?24:0);
      if(sourceName==='Box.gltf'){
        assert.equal(status.result!.summary.missingCompanionCount,1);assert.equal(native.buffers[0].uri,'Box0.bin');assert.equal(native.buffers[0].fetched,false);
      }
      assert.deepEqual((await service.original(f.caseId,f.source.id)).bytes,f.raw);
      assert.deepEqual((await new CaseIntakeService().sourceFile(f.source.id)).bytes,f.raw);
      assert.equal(await new CaseIntakeService().streamedSourceFile(f.source.id,new AbortController().signal),null);
      const projected=sourceFrom(f.source as any);assert.equal(JSON.stringify(projected).includes('gltfOriginal'),false);
      const savedStatus=structuredClone(status),savedJob=structuredClone(job),size=stored.size;
      // Post-object-I/O revocation, changed case and accepted-fence mismatch
      // refuse disclosure without adding or replacing any object/result.
      mutate=()=>{process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='other';};await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.status===403);
      process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='gltf-protocol-control';mutate=()=>{};
      f.current.revision++;assert.equal((await service.status(f.caseId,f.source.id,job.id)).status,'stale');await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.status===409);f.current.revision--;
      job.accepted_fence++;await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.status===409);job.accepted_fence--;
      const artifactBytes=stored.get(status.result!.artifact.key)!;stored.set(status.result!.artifact.key,Buffer.from(artifactBytes).fill(0));
      await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.code==='GLTF_ARTIFACT_INTEGRITY');stored.set(status.result!.artifact.key,artifactBytes);
      assert.equal(stored.size,size);assert.deepEqual(job,savedJob);assert.deepEqual(await service.status(f.caseId,f.source.id,job.id),savedStatus);
      assert.deepEqual(await service.retain(f.caseId,request,{name:sourceName,bytes:f.raw}),receipt);assert.equal(stored.size,size);
      const nativePuts=stored.size;
      const retryRequest={requestKey:randomUUID(),expectedCaseRevision:2,expectedSourceRevision:1,sourceSha256:f.hash,sceneIndex:0};
      const retry=await service.enqueue(f.caseId,f.source.id,retryRequest);assert.deepEqual(await service.enqueue(f.caseId,f.source.id,retryRequest),retry);
      assert.notEqual(retry.jobId,job.id);assert.equal(f.jobs.get(retry.jobId).payload.sceneIndex,0);assert.equal(stored.size,nativePuts);
      const writes=f.calls.filter(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)).length;
      await assert.rejects(()=>new CaseIntakeService().retry(job.id),(e:any)=>e.code==='GLTF_CANONICAL_RETRY_REQUIRED');
      await assert.rejects(()=>documentAuthorityTx(f.client as any,{...f.source,profile:'csv',inspection:{}},'snapshot'),(e:any)=>e.code==='GLTF_CANONICAL_SOURCE_REQUIRED');
      await assert.rejects(()=>documentAuthorityTx(f.client as any,{...f.source,profile:'csv',inspection:{gltfOriginal:null}},'copy'),(e:any)=>e.code==='GLTF_CANONICAL_SOURCE_REQUIRED');
      assert.equal(f.calls.filter(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)).length,writes);
      assert.equal(isGltfProtectedSource({inspection:{gltfOriginal:null}}),true);
      assert.equal(isGltfProtectedSource({profile:'gltf-native-v1'}),true);
      assertGltfTools(config.pins);
      if(process.env.ULPIN_GLTF_PROOF_ROOT){
        const proof=process.env.ULPIN_GLTF_PROOF_ROOT;
        writeFileSync(proof+'/'+sourceName+'.native.json',artifact.bytes,{flag:'wx'});
        const accepted=JSON.parse([...stored.entries()].find(([key])=>key.startsWith('gltf-native/'+job.id+'/')&&!key.endsWith('.native.json'))![1].toString());
        writeFileSync(proof+'/'+sourceName+'.journey.json',JSON.stringify({qualification:'controlled SQL/storage; actual unchanged local supervisor/reader execution',
          receipt,status,accepted,retry,events:f.events,objectHashes:[...stored].map(([key,bytes])=>({key,bytes:bytes.length,sha256:sha256(bytes)})),refusalsPassed:true},null,2)+'\n',{flag:'wx'});
      }
    }finally{S3Client.prototype.send=originalSend;}
  },true,sourceName);
});
