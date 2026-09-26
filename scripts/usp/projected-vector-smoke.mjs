/** Guarded unchanged NWIC source→queue→records, partial-staging recovery and later re-admission. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createReadStream,existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {open,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertUspIsolation,assertLocalOperatorProcess} from './local-isolation.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const safeEnv=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const git=args=>execFileSync('git',args,{cwd:root,env:safeEnv,encoding:'utf8',timeout:5000}).trim();
const hash=raw=>createHash('sha256').update(raw).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fileHash(path){const h=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path,{highWaterMark:1048576})){h.update(chunk);bytes+=chunk.length;}return {bytes,sha256:h.digest('hex')};}
async function run(){
  const dir=realpathSync(process.argv[2]||'');assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8')),owner=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  let scope,operator;try{scope=assertUspIsolation(env);operator=assertLocalOperatorProcess(env);}catch{throw new Error('Private isolation validation failed.');}
  assert.equal(owner.checkout,root);assert.equal(owner.project,scope.project);assert.equal(owner.nonce,env.ULPIN_LOCAL_NONCE);assert.deepEqual(owner.operatorProvenance,operator);
  assert.equal(git(['rev-parse','HEAD']),owner.baseCommit);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');assert(!existsSync(join(root,'.env')));
  const output=join(dir,'projected-vector-smoke.json');assert(!existsSync(output));
  const sourceCheck=JSON.parse(readFileSync(join(root,'docs/evidence/usp/nest-migration/nwic-boundaries/source-check.json'),'utf8')),
    source=sourceCheck.acquisition,profile=JSON.parse(readFileSync(join(root,'fixtures/usp/D3/nwic-boundaries-v1/vector-admission-profile.json'),'utf8'));
  const original=await fileHash(source.privateOriginalPath),member=await fileHash(profile.source.outsideGitPath);
  assert.deepEqual(original,{bytes:source.bytes,sha256:source.sha256});assert.deepEqual(member,{bytes:profile.source.bytes,sha256:profile.source.sha256});
  const {Client}=createRequire(join(root,'packages/server/package.json'))('pg'),observer=new Client({connectionString:env.DATABASE_URL,application_name:'projected-vector-observer',statement_timeout:5000}),barrier=new Client({connectionString:env.DATABASE_URL,application_name:'projected-vector-barrier',statement_timeout:5000});
  await observer.connect();await barrier.connect();const base=env.ULPIN_TEST_URL+'api/v1';let held=false,file,phase='retention';
  const receipt={version:'projected-vector-smoke/1',status:'running',codeCommit:owner.baseCommit,project:scope.project,nonce:owner.nonce,
    original,member,issuer:sourceCheck.source.issuer,url:source.finalUrl,sourceCheck:'docs/evidence/usp/nest-migration/nwic-boundaries/source-check.json',checks:[],
    notQualified:['Boundary positional/legal/currentness accuracy, parcels/rights/height or survey controls','Generic archives/CRS/format coverage','Tiles/progressive scene generations/GF-STREAM/GF-SCALE/UI','Multiuser/replica authorization or provider/learning qualification']};
  async function api(path,status=200,body,method,headers={}){const r=await fetch(base+path,{headers:{Connection:'close',...(body?{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'}:{}),...headers},
    ...(body?{method:method??'POST',body:body instanceof Uint8Array?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(150000)});const value=await r.json();assert.equal(r.status,status,`${phase} ${path}: ${value.error?.code||r.status}`);return value;}
  async function geo(id){const r=await fetch(env.GEO_URL+'/internal/jobs/'+id,{headers:{Authorization:'Bearer '+env.GEO_SERVICE_TOKEN,Connection:'close'},signal:AbortSignal.timeout(5000)});if(!r.ok)return null;return r.json();}
  async function until(action,seconds=150){const end=Date.now()+seconds*1000;while(Date.now()<end){const value=await action();if(value)return value;await delay(500);}throw new Error(`Timed out in ${phase}.`);}
  // Use the existing fenced authority against only this guarded nonce's real
  // logical job. The control changes lease/context state, never source facts.
  function attemptControl(action,jobId,attempt){
    const program=`import {claimUspJobAttempt} from ${JSON.stringify(join(root,'packages/server/src/modules/usp/jobs.ts'))};
      import {failProjectedJob} from ${JSON.stringify(join(root,'packages/server/src/modules/usp/ingestion/projected-publication.ts'))};
      import {closePool} from ${JSON.stringify(join(root,'packages/server/src/infrastructure/db.ts'))};
      void(async()=>{try{const id=process.env.ULPIN_PROJECTED_CONTROL_JOB,action=process.env.ULPIN_PROJECTED_CONTROL_ACTION;
        const result=action==='claim'?await claimUspJobAttempt(id,process.env.ULPIN_PROJECTED_CONTROL_OWNER):
          await failProjectedJob(id,action==='stale'?'PROJECTED_CONTEXT_STALE':'PROJECTED_PUBLICATION_TIMEOUT',action==='stale'?'stale':'failed',JSON.parse(process.env.ULPIN_PROJECTED_CONTROL_ATTEMPT));
        console.log(JSON.stringify(result));}finally{await closePool();}})().catch(()=>{console.error('Guarded attempt control failed.');process.exitCode=1;});`;
    const controlPath=join(dir,'projected-attempt-control.ts');
    if(!existsSync(controlPath))writeFileSync(controlPath,program,{flag:'wx',mode:0o600});else assert.equal(readFileSync(controlPath,'utf8'),program);
    receipt.attemptControlSha256=hash(program);
    return JSON.parse(execFileSync('pnpm',['exec','tsx','--tsconfig','apps/api/tsconfig.json',controlPath],{cwd:root,
      env:{...safeEnv,...env,ULPIN_PROJECTED_CONTROL_JOB:jobId,ULPIN_PROJECTED_CONTROL_ACTION:action,ULPIN_PROJECTED_CONTROL_OWNER:randomUUID(),
        ULPIN_PROJECTED_CONTROL_ATTEMPT:JSON.stringify(attempt??null)},encoding:'utf8',timeout:10000,maxBuffer:8192}).trim());
  }
  try{
    const {caseId}=await api('/source-cases',201,{requestKey:randomUUID(),name:'NWIC India district boundary administrative context'});receipt.caseId=caseId;
    let upload=await api(`/ingestion/cases/${caseId}/uploads`,201,{requestKey:randomUUID(),expectedCaseRevision:0,filename:'district_nwic_geojson.zip',mediaType:'application/zip',bytes:source.bytes,sha256:source.sha256,
      provenance:{issuer:sourceCheck.source.issuer,originalUrl:source.finalUrl,acquiredAt:new Date(source.acquiredAtUtc).toISOString(),permissionReference:sourceCheck.termsDecision.termsUrl,
        limitations:['Source administrative boundary accuracy/currentness and training permission remain unqualified; no parcel/ownership/height inference']}});
    file=await open(source.privateOriginalPath,'r');
    for(let part=1;part<=upload.partCount;part++){
      const offset=(part-1)*upload.partBytes,bytes=Buffer.alloc(Math.min(upload.partBytes,source.bytes-offset));assert.equal((await file.read(bytes,0,bytes.length,offset)).bytesRead,bytes.length);
      upload=await api(`/ingestion/cases/${caseId}/uploads/${upload.id}/parts/${part}`,200,bytes,'PUT',{'X-Request-Key':randomUUID(),'X-Upload-Revision':String(upload.revision),'X-Case-Revision':String(upload.currentCaseRevision),'X-Part-Sha256':hash(bytes)});
    }
    upload=await api(`/ingestion/cases/${caseId}/uploads/${upload.id}/finalize`,200,{requestKey:randomUUID(),expectedRevision:upload.revision,expectedCaseRevision:upload.currentCaseRevision,sha256:source.sha256});
    assert.equal(upload.state,'retained');assert.equal(upload.verifiedSha256,source.sha256);receipt.sourceId=upload.source.sourceId;receipt.uploadId=upload.id;
    const path=`/ingestion/cases/${caseId}/sources/${receipt.sourceId}/projected-vector`;
    const request=revision=>({requestKey:randomUUID(),expectedCaseRevision:revision,expectedSourceRevision:1,sourceSha256:source.sha256});
    const firstRequest=request(upload.currentCaseRevision),first=await api(path,202,firstRequest);receipt.staleJobId=first.jobId;
    assert.equal((await api(path,202,firstRequest)).jobId,first.jobId);
    // Hold only the existing job metadata row: the worker can finish real source processing,
    // but no publisher attempt can adopt records before the explicit case-context change.
    await barrier.query('BEGIN');held=true;await barrier.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[first.jobId]);
    phase='stale-result-barrier';console.log(JSON.stringify({phase,jobId:first.jobId}));
    const produced=await until(async()=>{const job=await geo(first.jobId);if(job?.status==='failed')throw new Error('Projected worker failed; inspect private worker logs.');return job?.status==='succeeded'?job:null;});
    assert.equal(produced.result.totals.features,733);assert.equal(produced.result.totals.nativeInvalid,13);
    assert.equal((await observer.query('SELECT count(*)::int count FROM administrative_unit_observations WHERE job_id=$1',[first.jobId])).rows[0].count,0);
    await api(path+'/units',409);
    await barrier.query('COMMIT');held=false;
    await until(async()=>{const job=await api(path);if(['failed','stale'].includes(job.status))throw new Error('Initial staging failed: '+job.errorCode);const count=(await observer.query('SELECT count(*)::int count FROM administrative_unit_observations WHERE job_id=$1',[first.jobId])).rows[0].count;return count>0?count:null;});
    await barrier.query('BEGIN');held=true;await barrier.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[caseId]);
    receipt.retiredStagingRows=(await observer.query('SELECT count(*)::int count FROM administrative_unit_observations WHERE job_id=$1',[first.jobId])).rows[0].count;
    assert(receipt.retiredStagingRows>0&&receipt.retiredStagingRows<733);await api(path+'/units',409);
    const row=(await observer.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1',[first.jobId])).rows[0],
      oldAttempt={jobId:first.jobId,number:row.number,fence:Number(row.fence),owner:row.owner,inputSha256:row.input_sha256,leaseUntil:row.lease_until.toISOString()};
    await observer.query("UPDATE usp_job_attempts SET lease_until=now()-interval '1 second' WHERE job_id=$1 AND number=$2",[first.jobId,oldAttempt.number]);
    const newer=attemptControl('claim',first.jobId);assert.equal(newer.number,oldAttempt.number+1);assert(newer.fence>oldAttempt.fence);
    await delay(2500);await barrier.query('COMMIT');held=false;
    assert.equal(attemptControl('expired',first.jobId,oldAttempt),false);await delay(1000);
    const protectedJob=(await observer.query(`SELECT j.status,j.error,j.attempts,a.state,a.fence,
      (SELECT count(*)::int FROM administrative_unit_observations WHERE job_id=j.id) observations
      FROM jobs j JOIN usp_job_attempts a ON a.job_id=j.id AND a.number=$2 WHERE j.id=$1`,[first.jobId,newer.number])).rows[0];
    assert.equal(protectedJob.status,'running');assert.equal(protectedJob.error,null);assert.equal(protectedJob.attempts,newer.number);
    assert.equal(protectedJob.state,'active');assert.equal(Number(protectedJob.fence),newer.fence);assert.equal(protectedJob.observations,receipt.retiredStagingRows);
    receipt.attemptHandover={oldNumber:oldAttempt.number,newNumber:newer.number,oldFence:oldAttempt.fence,newFence:newer.fence,protectedStagingRows:protectedJob.observations};
    await barrier.query('BEGIN');held=true;await barrier.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[caseId]);
    await barrier.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);await barrier.query('COMMIT');held=false;
    assert.equal(attemptControl('stale',first.jobId,oldAttempt),true);
    await until(async()=>{const job=await api(path);if(job.status==='failed')throw new Error('Stale completion failed unexpectedly.');return job.status==='stale'?job:null;});
    await api(path+'/units',409);
    const retired=(await observer.query("SELECT result FROM operations WHERE case_id=$1 AND kind='projected-vector-staging-retired' AND result->>'jobId'=$2",[caseId,first.jobId])).rows;
    assert.equal(retired.length,1);assert.equal(retired[0].result.rows,receipt.retiredStagingRows);assert.equal(retired[0].result.policy,'never_accepted_terminal_staging/1');
    assert.equal((await observer.query('SELECT count(*)::int count FROM administrative_unit_observations WHERE job_id=$1',[first.jobId])).rows[0].count,0);
    receipt.checks.push('unchanged retained source reaches Celery; exact replay preserves the job; expired publisher A cannot fail or retire real staged rows while newer fenced owner B is active; a real case revision still authoritatively fences the job and exactly retires only its never-accepted staging, retaining compact retirement/job history');
    phase='retry-and-publication';const secondRequest=request(upload.currentCaseRevision+1),second=await api(path,202,secondRequest);receipt.acceptedJobId=second.jobId;assert.notEqual(second.jobId,first.jobId);
    const accepted=await until(async()=>{const job=await api(path);if(['failed','stale'].includes(job.status))throw new Error('Accepted projected journey failed: '+job.errorCode);return job.status==='succeeded'?job:null;});
    assert.equal(accepted.totals.features,733);assert.equal(accepted.totals.positions,3125505);assert.equal(accepted.totals.nativeInvalid,13);assert.equal(accepted.totals.admitted+accepted.totals.quarantined,733);
    assert.equal((await api(path,202,secondRequest)).jobId,second.jobId);assert.equal((await api(path,202,request(upload.currentCaseRevision+1))).jobId,second.jobId);
    assert.equal((await api(path,202,firstRequest)).jobId,first.jobId);await api(path,409,{...secondRequest,sourceSha256:'0'.repeat(64)});
    await api(path,403,undefined,undefined,{'Sec-Fetch-Site':'cross-site'});await api(`/ingestion/cases/${randomUUID()}/sources/${receipt.sourceId}/projected-vector`,404);
    const all=[];let cursor=0;do{const page=await api(path+'/units?limit=25&cursor='+cursor+(cursor?'&jobId='+second.jobId:''));assert(page.records.length<=25);assert.equal(page.jobId,second.jobId);all.push(...page.records);cursor=page.next;}while(cursor!==null);
    assert.equal(all.length,733);assert.equal(new Set(all.map(row=>row.id)).size,733);assert(all.every(row=>row.kind==='district'&&row.nativeKey.type==='number'&&row.sourceId===receipt.sourceId));
    const duplicateCode=all.filter(row=>row.code==='999');assert.equal(duplicateCode.length,2);assert.notEqual(duplicateCode[0].id,duplicateCode[1].id);assert.notEqual(duplicateCode[0].nativeKey.value,duplicateCode[1].nativeKey.value);
    await api(path+'/units?limit=26',422);await api(path+'/units?cursor=1',422);await api(path+'/units?cursor=0&cursor=0',422);await api(path+'/units?jobId='+first.jobId,409);
    const valid=all.find(row=>row.disposition==='admitted'),quarantine=all.find(row=>row.disposition==='quarantined');assert(valid&&quarantine);
    async function artifact(row,representation){const r=await fetch(base+path+`/units/${row.id}/geometry?jobId=${second.jobId}&representation=${representation}`,{headers:{Connection:'close'},signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert(bytes.length<=(representation==='native'?1048576:2097152));assert.equal(hash(bytes),r.headers.get('x-content-sha256'));return bytes;}
    const raw=await artifact(valid,'native'),native=JSON.parse(raw);const sourceMember=await open(profile.source.outsideGitPath,'r');
    try{for(const row of [valid,quarantine]){const derived=row===valid?raw:await artifact(row,'native'),exact=Buffer.alloc(row.locator.end-row.locator.start);assert.equal((await sourceMember.read(exact,0,exact.length,row.locator.start)).bytesRead,exact.length);assert.deepEqual(derived,exact);}}finally{await sourceMember.close();}
    const geographic=JSON.parse(await artifact(valid,'geographic'));assert.deepEqual(geographic.properties,native.properties);assert.equal(geographic.geometry.type,'MultiPolygon');
    const xy=geographic.geometry.coordinates[0][0][0];assert(xy[0]>=-180&&xy[0]<=180&&xy[1]>=-90&&xy[1]<=90);assert.notDeepEqual(xy,native.geometry.coordinates[0][0][0]);
    await api(path+`/units/${quarantine.id}/geometry?jobId=${second.jobId}`,422);
    const box=valid.geographicBounds,bbox=await api(path+'/units?limit=25&bbox='+box.join(','));assert(bbox.records.some(row=>row.id===valid.id));assert(bbox.records.every(row=>row.disposition==='admitted'));
    receipt.totals=accepted.totals;receipt.transform=accepted.transform;receipt.sample={admitted:valid,quarantined:quarantine,duplicatedDtcode:duplicateCode.map(row=>({id:row.id,nativeKey:row.nativeKey,code:row.code}))};
    receipt.checks.push('retry from the same retained source atomically adopts all 733 immutable dispositions; typed numeric id namespace preserves both real duplicated dtcode rows; bounded private metadata/native/geographic reads and quarantine exclusion pass');
    phase='later-re-admission';
    await observer.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
    await api(path+'/units',409);const thirdRequest=request(upload.currentCaseRevision+2),third=await api(path,202,thirdRequest);receipt.readmittedJobId=third.jobId;assert.notEqual(third.jobId,second.jobId);
    console.log(JSON.stringify({phase,jobId:third.jobId}));
    const readmitted=await until(async()=>{const job=await api(path);if(['failed','stale'].includes(job.status))throw new Error('Later re-admission failed: '+job.errorCode);return job.status==='succeeded'?job:null;});
    assert.deepEqual(readmitted.totals,accepted.totals);assert.equal((await api(path,202,thirdRequest)).jobId,third.jobId);assert.equal((await api(path,202,secondRequest)).jobId,second.jobId);
    await api(path+'/units?jobId='+second.jobId,409);const current=await api(path+'/units?jobId='+third.jobId);
    assert.equal(current.jobId,third.jobId);assert.equal(current.records[0].id,all[0].id);assert.equal(current.records[0].rawSha256,all[0].rawSha256);
    const history=(await observer.query(`SELECT count(*)::int observations,count(*) FILTER(WHERE a.raw_ref=b.raw_ref AND a.geographic_ref IS NOT DISTINCT FROM b.geographic_ref)::int shared_artifacts
      FROM administrative_unit_observations a JOIN administrative_unit_observations b ON b.unit_id=a.unit_id WHERE a.job_id=$1 AND b.job_id=$2`,[second.jobId,third.jobId])).rows[0];
    assert.equal(history.observations,733);assert.equal(history.shared_artifacts,733);receipt.acceptedHistory=history;
    receipt.checks.push('a third current-context job successfully re-admits the unchanged original after an accepted generation becomes context-stale; all 733 earlier accepted observations and logical receipts survive, canonical identities and immutable feature artifacts are reused');
    phase='durable-records';receipt.database=(await observer.query(`SELECT (SELECT count(*)::int FROM administrative_unit_observations WHERE job_id=$1) observations,
      (SELECT count(*)::int FROM administrative_unit_observations WHERE job_id=$1 AND disposition='admitted') admitted,
      (SELECT count(*)::int FROM administrative_unit_observations WHERE job_id=$1 AND NOT ST_IsValid(native_geometry)) native_invalid,
      (SELECT count(*)::int FROM administrative_unit_observations WHERE job_id=$1 AND geographic_geometry IS NOT NULL AND NOT ST_IsValid(geographic_geometry)) invalid_geographic,
      (SELECT count(*)::int FROM administrative_unit_observations WHERE job_id=$2) stale_observations,
      (SELECT count(*)::int FROM sources WHERE case_id=$3) originals,(SELECT count(*)::int FROM usp_model_calls) model_calls,
      (SELECT count(*)::int FROM jobs WHERE operation='projected-vector') jobs`,[third.jobId,first.jobId,caseId])).rows[0];
    assert.equal(receipt.database.observations,733);assert.equal(receipt.database.native_invalid,13);assert.equal(receipt.database.invalid_geographic,0);assert.equal(receipt.database.stale_observations,0);assert.equal(receipt.database.originals,1);assert.equal(receipt.database.model_calls,0);assert.equal(receipt.database.jobs,3);
    const events=(await observer.query("SELECT body FROM usp_outbox WHERE stream_id LIKE $1 AND body->'change'->>'kind'='projected-vector.changed' ORDER BY sequence",[`case-ingestion:${caseId}:%`])).rows.map(row=>row.body.change);
    assert.deepEqual(events.map(e=>e.status),['queued','running','stale','queued','running','succeeded','queued','running','succeeded']);assert(events.every(e=>Object.keys(e).sort().join(',')==='jobId,kind,status'));
    const worker=await geo(third.jobId);receipt.execution=worker.result.execution;
    assert.deepEqual(await fileHash(source.privateOriginalPath),original);assert.deepEqual(await fileHash(profile.source.outsideGitPath),member);
    receipt.checks.push('database has 13 preserved native-invalid dispositions and no invalid global geometry per accepted generation; one original, three existing-authority jobs and exactly nine committed compact lifecycle events; originals remain byte-identical and no model call occurred');
    receipt.status='passed';writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:'passed',codeCommit:receipt.codeCommit,checks:receipt.checks.length,totals:receipt.totals,database:receipt.database,execution:receipt.execution,receipt:output}));
  }catch(error){receipt.status='failed';receipt.phase=phase;receipt.failure='Guarded projected journey failed; inspect private logs without exporting configuration.';writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});throw error;}
  finally{if(held)await barrier.query('ROLLBACK').catch(()=>{});await file?.close();await barrier.end();await observer.end();}
}
run().catch(error=>{console.error(JSON.stringify({status:'failed',name:error.name,message:error.message}));process.exitCode=1;});
