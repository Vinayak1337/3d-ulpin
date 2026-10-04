import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {OBJ_VERSION,ObjOriginalSchema} from '../packages/contracts/src/usp/obj-ingestion';
import {ObjIngestionService,isObjProtectedSource} from '../packages/server/src/modules/usp/ingestion/obj';
import {runObjJob} from '../packages/server/src/modules/usp/ingestion/obj-worker';
import {objConfig,assertObjTools} from '../packages/server/src/modules/usp/ingestion/obj-config';
import {objSummary} from '../packages/server/src/modules/usp/ingestion/obj-processor';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {sourceFrom} from '../packages/server/src/modules/cases/domain';
import {CaseIntakeService} from '../packages/server/src/modules/cases/case-intake-service';
import {documentAuthorityTx} from '../packages/server/src/modules/usp/ingestion/document-authority';
import {sha256,closeStorageClient} from '../packages/server/src/infrastructure/storage';

// SQL/storage protocol doubles, never persisted records or operational Obj facts.
// Reader metadata reuses unchanged upstream development bytes and accepted output.
const root=process.env.ULPIN_OBJ_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-obj-native';
const present=existsSync(root+'/no_material.obj');
const require=createRequire(new URL('../packages/server/package.json',import.meta.url)),{S3Client}=require('@aws-sdk/client-s3');
const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-obj/sources.json',import.meta.url),'utf8'));
const lineageFor=(name:string)=>{const s=manifest.originals.find((s:any)=>s.path.replaceAll('\\','/').endsWith('/'+name));return {issuer:manifest.publisher,
  originalUrl:s.url,acquiredAt:new Date(s.acquiredAt).toISOString(),permissionReference:manifest.licence.record.url,geography:null,
  limitations:[manifest.attribution,'test_only graphics example; no operational, accuracy or property qualification','Axes/units/CRS/height/object correspondence unknown; companion material files unfetched']};};
const lineage=lineageFor('no_material.obj');
function fixture(sourceName='no_material.obj'){
  const raw=readFileSync(root+'/'+sourceName),hash=sha256(raw),caseId=randomUUID(),sourceId=randomUUID(),binding=ingestionBinding(caseId);
  assert.equal(hash,sourceName==='no_material.obj'?'a57a1c5b94c28f37b6a049e73d6efe1cb293946e9b727b6dd733cc70dcd1974c':
    '0011861ed58098a3524e973547549c4b73f05e3e00eec02d2e98e450a342e988');
  const current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:null};
  const original=ObjOriginalSchema.parse({version:OBJ_VERSION,subject:binding.subject,accessSha256:binding.access,
    sha256:hash,bytes:raw.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage});
  const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,name:'no_material.obj',mime_type:'application/octet-stream',
    sha256:hash,bytes:raw.length,profile:'obj-native-v1',object_key:`sources/${sourceId}/${hash}`,status:'received',
    created_at:new Date(),inspection:{objOriginal:original,objAccepted:{private:'retained'},referenceParts:[{private:'retained'}]}};
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
    else if(sql.startsWith('INSERT INTO jobs'))jobs.set(args[0],{id:args[0],case_id:args[1],source_id:args[2],operation:'obj-native',case_revision:args[3],input_fingerprint:args[4],payload:args[5],status:'queued',logical_state:'queued',result_ref:null});
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
async function isolated(work:(f:ReturnType<typeof fixture>)=>Promise<void>,configured=false,sourceName='no_material.obj'){
  const names=['ULPIN_LOCAL_OPERATOR_SUBJECT','ULPIN_OBJ_PROFILE','ULPIN_OBJ_PROFILE_SHA256','S3_ENDPOINT','S3_ACCESS_KEY','S3_SECRET_KEY'],prior=names.map(n=>process.env[n]);
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='obj-protocol-control';if(!configured){delete process.env.ULPIN_OBJ_PROFILE;delete process.env.ULPIN_OBJ_PROFILE_SHA256;}
  process.env.S3_ENDPOINT='http://127.0.0.1:1';process.env.S3_ACCESS_KEY=process.env.S3_SECRET_KEY='memory-only-control';
  const globals=globalThis as any,pool=globals.ulpinPool,f=fixture(sourceName);globals.ulpinPool={connect:async()=>f.client,query:f.client.query};
  try{await work(f);}finally{if(pool===undefined)delete globals.ulpinPool;else globals.ulpinPool=pool;names.forEach((n,i)=>{if(prior[i]===undefined)delete process.env[n];else process.env[n]=prior[i];});closeStorageClient();}
}

// Exactly one current adapter invocation for each retained unchanged original.
// SQL/storage envelopes below are in-memory controls, never live persisted records.
test('OBJ status derives complete counts from the retained actual native artifacts',()=>{
  for(const [name,run] of [['no_material.obj','complete-run01'],['missing_material_file.obj','partial-run01']]){
    const raw=readFileSync(root+'/'+name),bytes=readFileSync(root+'/'+run+'/obj.json');
    const summary=objSummary(bytes,{sourceSha256:sha256(raw),sourceBytes:raw.length} as any);
    assert.equal(summary.vertexCount,76);assert.equal(summary.polygonCount,18);
    assert.equal(summary.status,name==='no_material.obj'?'inspected_local':'inspected_partial');
  }
});
test('OBJ canonical intake retains complete/partial native context and rejects revoked disclosure',async()=>{
  assert(present,'Retained unchanged OBJ originals are required.');
  assert.equal(process.env.ULPIN_OBJ_LOCAL_PROCESS,'1','Explicit current-profile admission is required.');
  for(const sourceName of ['no_material.obj','missing_material_file.obj'])await isolated(async f=>{
    const originalSend=S3Client.prototype.send,stored=new Map<string,Buffer>();let mutate:()=>void=()=>{};
    S3Client.prototype.send=async function(command:any){const key=command.input.Key;
      if(command.constructor.name==='PutObjectCommand'){assert.equal(command.input.IfNoneMatch,'*');stored.set(key,Buffer.from(command.input.Body));return {};}
      if(command.constructor.name==='GetObjectCommand'){const bytes=stored.get(key)!;mutate();return {Body:Readable.from([bytes]),ContentLength:bytes.length,ETag:'memory-etag'};}
      throw Error('Unexpected storage command');
    };
    try{
      const service=new ObjIngestionService(),config=objConfig(),request={requestKey:randomUUID(),expectedCaseRevision:1,lineage:lineageFor(sourceName)};
      const receipt=await service.retain(f.caseId,request,{name:sourceName,bytes:f.raw});assert.equal(receipt.caseRevision,2);
      assert.deepEqual(await service.retain(f.caseId,request,{name:sourceName,bytes:f.raw}),receipt);assert.equal(stored.size,1);
      const job=f.jobs.get(receipt.jobId)!;await runObjJob(job.id);assert.equal(job.status,'succeeded',job.error);assert.equal(job.attempt.state,'accepted');
      const status=await service.status(f.caseId,f.source.id,job.id),artifact=await service.artifact(f.caseId,f.source.id,job.id),native=JSON.parse(artifact.bytes.toString('utf8'));
      assert.equal(status.status,sourceName==='no_material.obj'?'completed':'partial');assert.equal(status.code,null);
      assert.equal(native.sourceSha256,f.hash);assert.equal(native.representation,'context_mesh');assert.equal(native.qualification.globalPlacement,'unknown');
      assert.deepEqual(artifact.bytes,readFileSync(root+'/'+(sourceName==='no_material.obj'?'complete-run01':'partial-run01')+'/obj.json'));
      assert.equal(sha256(artifact.bytes),status.result!.artifact.sha256);
      assert.equal(status.result!.summary.vertexCount,76);assert.equal(status.result!.summary.polygonCount,18);assert.equal(status.result!.summary.faceReferenceCount,72);
      assert.equal(status.result!.summary.missingCompanionDeclarationCount,sourceName==='no_material.obj'?0:10);
      assert.equal(status.result!.summary.analyticEligible,false);assert.equal(status.result!.summary.learningLabels,false);
      assert.equal(native.faces.every((face:any)=>face.references.length===4),true); // unchanged source polygons, never triangulated
      const profile=process.env.ULPIN_OBJ_PROFILE;delete process.env.ULPIN_OBJ_PROFILE;
      try{assert.deepEqual((await service.original(f.caseId,f.source.id)).bytes,f.raw);
        assert.deepEqual((await new CaseIntakeService().sourceFile(f.source.id)).bytes,f.raw);
      }finally{process.env.ULPIN_OBJ_PROFILE=profile;}
      assert.equal(await new CaseIntakeService().streamedSourceFile(f.source.id,new AbortController().signal),null);
      assert.equal(JSON.stringify(sourceFrom(f.source as any)).includes('objOriginal'),false);
      const size=stored.size,savedJob=structuredClone(job);
      mutate=()=>{process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='other';};
      await assert.rejects(()=>service.artifact(f.caseId,f.source.id,job.id),(e:any)=>e.status===403);
      process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='obj-protocol-control';mutate=()=>{};
      assert.equal(stored.size,size);assert.deepEqual(job,savedJob);
      const retryRequest={requestKey:randomUUID(),expectedCaseRevision:2,expectedSourceRevision:1,sourceSha256:f.hash};
      const retry=await service.enqueue(f.caseId,f.source.id,retryRequest);assert.deepEqual(await service.enqueue(f.caseId,f.source.id,retryRequest),retry);
      assert.notEqual(retry.jobId,job.id);assert.equal(stored.size,size); // new canonical input; no extra native execution
      const writes=f.calls.filter(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)).length;
      await assert.rejects(()=>new CaseIntakeService().retry(job.id),(e:any)=>e.code==='OBJ_CANONICAL_RETRY_REQUIRED');
      const legacyId=randomUUID();f.jobs.set(legacyId,{...job,id:legacyId,operation:'inspect',status:'failed',payload:{profile:'csv'}});
      try{await assert.rejects(()=>new CaseIntakeService().retry(legacyId),(e:any)=>e.code==='OBJ_CANONICAL_RETRY_REQUIRED');}
      finally{f.jobs.delete(legacyId);}
      await assert.rejects(()=>documentAuthorityTx(f.client as any,{...f.source,profile:'csv',inspection:{}},'snapshot'),(e:any)=>e.code==='OBJ_CANONICAL_SOURCE_REQUIRED');
      await assert.rejects(()=>documentAuthorityTx(f.client as any,{...f.source,profile:'csv',inspection:{objOriginal:null}},'copy'),(e:any)=>e.code==='OBJ_CANONICAL_SOURCE_REQUIRED');
      assert.equal(f.calls.filter(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)).length,writes);
      assert.equal(isObjProtectedSource({inspection:{objOriginal:null}}),true);assert.equal(isObjProtectedSource({profile:'obj-native-v1'}),true);
      assertObjTools(config.pins);
      if(process.env.ULPIN_OBJ_PROOF_ROOT){
        const proof=process.env.ULPIN_OBJ_PROOF_ROOT;
        writeFileSync(proof+'/'+sourceName+'.native.json',artifact.bytes,{flag:'wx'});
        const accepted=JSON.parse([...stored.entries()].find(([key])=>key.startsWith('obj-native/'+job.id+'/')&&!key.endsWith('.native.json'))![1].toString());
        writeFileSync(proof+'/'+sourceName+'.journey.json',JSON.stringify({qualification:'controlled SQL/storage; actual accepted CLI/current wrapper; no live HTTP/persistence',
          receipt,status,accepted,retry,events:f.events,objectHashes:[...stored].map(([key,bytes])=>({key,bytes:bytes.length,sha256:sha256(bytes)})),revokedDisclosureRefused:true},null,2)+'\n',{flag:'wx'});
      }
    }finally{S3Client.prototype.send=originalSend;}
  },true,sourceName);
});
