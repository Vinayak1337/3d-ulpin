/** Targeted recovery barriers on unchanged official NWIC bytes; no operational facts are invented. */
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
const allowed=['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'];
const safeEnv=Object.fromEntries(allowed.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const git=args=>execFileSync('git',args,{cwd:root,env:safeEnv,encoding:'utf8',timeout:5000}).trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function run(){
  const dir=realpathSync(process.argv[2]||'');assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8')),owner=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  let scope,operator;try{scope=assertUspIsolation(env);operator=assertLocalOperatorProcess(env);}catch{throw new Error('Private isolation validation failed.');}
  assert.equal(owner.checkout,root);assert.equal(owner.project,scope.project);assert.equal(owner.nonce,env.ULPIN_LOCAL_NONCE);assert.deepEqual(owner.operatorProvenance,operator);
  assert.equal(git(['rev-parse','HEAD']),owner.baseCommit);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');assert(!existsSync(join(root,'.env')));
  const output=join(dir,'large-original-recovery.json');assert(!existsSync(output));
  for(const key of Object.keys(process.env))if(!allowed.includes(key))delete process.env[key];Object.assign(process.env,env);
  const {LargeOriginalService,largeOriginalStorage:storage}=await import('../../packages/server/src/modules/usp/ingestion/large-original.ts');
  const {pool,closePool}=await import('../../packages/server/src/infrastructure/db.ts');
  const {AppError}=await import('../../packages/server/src/infrastructure/errors.ts');
  const requireApi=createRequire(join(root,'apps/api/package.json')),{S3Client,HeadObjectCommand,ListMultipartUploadsCommand}=requireApi('@aws-sdk/client-s3');
  const s3=new S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
  const sourceCheck=JSON.parse(readFileSync(join(root,'docs/evidence/usp/nest-migration/nwic-boundaries/source-check.json'),'utf8')),source=sourceCheck.acquisition;
  assert.equal((await stat(source.privateOriginalPath)).size,source.bytes);const checked=createHash('sha256');for await(const chunk of createReadStream(source.privateOriginalPath,{highWaterMark:1024*1024}))checked.update(chunk);assert.equal(checked.digest('hex'),source.sha256);
  const receipt={version:'large-original-recovery/1',status:'running',codeCommit:owner.baseCommit,project:scope.project,nonce:owner.nonce,source:{bytes:source.bytes,sha256:source.sha256,path:source.privateOriginalPath},checks:[],
    barrierScope:'part producer paused after fresh database validation but before storage dispatch; actual lease expiry; no claim that an already-dispatched remote PUT was held',
    notQualified:['Already-dispatched remote request cancellation or every object-store implementation','Archive parsing/companions/conversion/ownership/learning/publication','Scale/performance/GF gates']};
  const service=new LargeOriginalService(),base=env.ULPIN_TEST_URL+'api/v1';let phase='admission',file,latePromise;
  const release=deferred(),entered=deferred();
  async function api(path,status=200,body){const r=await fetch(base+path,{headers:{Connection:'close',...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(150000)});const value=await r.json();assert.equal(r.status,status,`${phase} ${path}: ${value.error?.code||r.status}`);return value;}
  const guard=u=>({requestKey:randomUUID(),expectedRevision:u.revision,expectedCaseRevision:u.currentCaseRevision});
  const create=()=>({requestKey:randomUUID(),expectedCaseRevision:0,filename:'district_nwic_geojson.zip',mediaType:'application/zip',bytes:source.bytes,sha256:source.sha256,
    provenance:{issuer:sourceCheck.source.issuer,originalUrl:source.finalUrl,acquiredAt:new Date(source.acquiredAtUtc).toISOString(),permissionReference:sourceCheck.termsDecision.termsUrl,limitations:['Deterministic test only; training unconfirmed','Opaque original only; archive and semantic conversion unqualified']}});
  async function partBytes(number){const offset=(number-1)*8*1024*1024,bytes=Buffer.alloc(Math.min(8*1024*1024,source.bytes-offset));const read=await file.read(bytes,0,bytes.length,offset);assert.equal(read.bytesRead,bytes.length);return bytes;}
  async function head(key){return s3.send(new HeadObjectCommand({Bucket:scope.bucket,Key:key}),{abortSignal:AbortSignal.timeout(5000)});}
  async function fence(key,id){const h=await head(key);assert.equal(h.ContentLength,0);assert.equal(h.Metadata?.['upload-tombstone'],id);}
  try{
    file=await open(source.privateOriginalPath,'r');const first=await partBytes(1);
    const sourceCase=await api('/source-cases',201,{requestKey:randomUUID(),name:'NWIC original late-producer recovery'}),caseId=sourceCase.caseId;receipt.lateCaseId=caseId;
    let late=await service.create(caseId,create());receipt.lateUploadId=late.id;
    const lateClaim=await service.claimPart(caseId,late.id,{...guard(late),partNumber:1,sha256:hash(first)});late=await service.read(caseId,late.id);
    const expires=late.parts[0].leaseExpiresAt;receipt.partLeaseExpiresAt=expires;
    const delayed=new LargeOriginalService({...storage,async putPartObject(...args){receipt.partFreshCheckPassedAt=new Date().toISOString();entered.resolve();await release.promise;return storage.putPartObject(...args);}});
    latePromise=delayed.receivePart(lateClaim,first).then(value=>({value}),error=>({error}));await entered.promise;
    console.log(JSON.stringify({phase:'late-part-armed',leaseExpiresAt:expires}));
    phase='cleanup-failure';const other=await api('/source-cases',201,{requestKey:randomUUID(),name:'NWIC original cleanup retry recovery'}),otherCaseId=other.caseId;receipt.cleanupCaseId=otherCaseId;
    let retry=await service.create(otherCaseId,create());receipt.retryUploadId=retry.id;
    const interrupted=await service.claimPart(otherCaseId,retry.id,{...guard(retry),partNumber:1,sha256:hash(first)});
    // A real stored part with durable writing intent, interrupted before metadata publication.
    await storage.putPartObject(interrupted.key,first,hash(first),8*1024*1024);retry=await service.read(otherCaseId,retry.id);
    retry=await service.abort(otherCaseId,retry.id,guard(retry));assert.equal(retry.state,'aborting');assert.equal(retry.cleanupPending,true);
    await service.failPart(interrupted);retry=await service.read(otherCaseId,retry.id);
    const cleanupInput=guard(retry);let calls=0;
    const faulty=new LargeOriginalService({...storage,async sealUploadObject(...args){calls++;if(calls===1)throw new AppError(503,'CONTROLLED_STORAGE_FAILURE','Focused cleanup failure control.');return storage.sealUploadObject(...args);}});
    await assert.rejects(faulty.cleanup(otherCaseId,retry.id,cleanupInput),error=>error instanceof AppError&&error.code==='CONTROLLED_STORAGE_FAILURE');
    const failed=await service.read(otherCaseId,retry.id);assert.equal(failed.cleanupPending,true);assert.equal(failed.lastError,'CLEANUP_PENDING');assert.equal((await head(interrupted.key)).ContentLength,first.length);
    retry=await faulty.cleanup(otherCaseId,retry.id,cleanupInput);assert.equal(retry.state,'aborted');assert.equal(retry.cleanupPending,false);assert(retry.revision>failed.revision);await fence(interrupted.key,retry.id);
    const completedCalls=calls;assert.deepEqual(await faulty.cleanup(otherCaseId,retry.id,cleanupInput),retry);assert.equal(calls,completedCalls);
    await assert.rejects(faulty.cleanup(otherCaseId,retry.id,{...cleanupInput,expectedRevision:retry.revision}),error=>error instanceof AppError&&error.status===409);
    receipt.cleanupRetry={input:cleanupInput,failedRevision:failed.revision,completedRevision:retry.revision,storageCalls:calls};receipt.checks.push('same immutable cleanup request resumes a cleared lease after a real-payload reclaim failure; successful replay performs no I/O; changed request binding conflicts');
    console.log(JSON.stringify({phase:'cleanup-same-key-recovered',revision:retry.revision}));
    phase='expired-part-producer';while(Date.now()<=new Date(expires).getTime()+100)await new Promise(r=>setTimeout(r,Math.min(1000,new Date(expires).getTime()+150-Date.now())));
    late=await service.read(caseId,late.id);assert(new Date(late.parts[0].leaseExpiresAt).getTime()<Date.now());
    late=await service.abort(caseId,late.id,guard(late));assert.equal(late.state,'aborted');assert.equal(late.cleanupPending,false);await fence(lateClaim.key,late.id);
    receipt.cleanupBeforeProducerReleaseAt=new Date().toISOString();release.resolve();const result=await latePromise;assert(result.error instanceof AppError);assert.equal(result.error.code,'SOURCE_INTEGRITY');await service.failPart(lateClaim);
    late=await service.read(caseId,late.id);assert.equal(late.state,'aborted');assert.equal(late.cleanupPending,false);await fence(lateClaim.key,late.id);
    receipt.latePartOutcome={code:result.error.code,receivedBytes:late.receivedBytes,revision:late.revision};receipt.checks.push('producer delayed after fresh validation past the actual180s lease cannot replace the zero-byte cleanup fence; aborted payload reservation stays released');
    phase='late-original-storage';const allocation=(await pool().query('SELECT source_id,body FROM usp_source_uploads WHERE id=$1',[late.id])).rows[0],key=`large-originals/${allocation.source_id}/${allocation.body.input.sha256}`;await fence(key,late.id);
    const lateOriginal=await storage.putOriginalStream(key,createReadStream(source.privateOriginalPath,{highWaterMark:1024*1024}),source.bytes,'application/zip',source.sha256,AbortSignal.timeout(30000));assert.equal(lateOriginal.alreadyExists,true);await fence(key,late.id);
    const mpu=await s3.send(new ListMultipartUploadsCommand({Bucket:scope.bucket,Prefix:key,MaxUploads:16}),{abortSignal:AbortSignal.timeout(5000)});assert(!mpu.IsTruncated);assert.equal((mpu.Uploads||[]).filter(x=>x.Key===key).length,0);
    receipt.lateOriginalOutcome={conditionalPreconditionRejected:true,remainingPayloadBytes:0};receipt.checks.push('the actual configured store rejects the same conditional streaming original PUT after its durable fence; no multipart upload payload exists');
    phase='corrected-finalization';let good=await service.create(caseId,create());receipt.goodUploadId=good.id;
    for(let number=1;number<=good.partCount;number++){const bytes=await partBytes(number),claim=await service.claimPart(caseId,good.id,{...guard(good),partNumber:number,sha256:hash(bytes)});good=await service.receivePart(claim,bytes);}
    const finalizeInput={...guard(good),sha256:source.sha256};good=await service.finalize(caseId,good.id,finalizeInput);assert.equal(good.state,'retained');assert.equal(good.cleanupPending,false);assert.equal(good.verifiedSha256,source.sha256);assert.deepEqual(await service.finalize(caseId,good.id,finalizeInput),good);receipt.sourceId=good.source.sourceId;
    const row=(await pool().query('SELECT object_key FROM sources WHERE id=$1',[receipt.sourceId])).rows[0];assert.equal((await head(row.object_key)).ContentLength,source.bytes);
    const saved=(await pool().query('SELECT object_key FROM usp_source_upload_parts WHERE upload_id=$1',[good.id])).rows;for(const part of saved)await fence(part.object_key,good.id);
    await service.cleanup(caseId,good.id,guard(good));assert.equal((await head(row.object_key)).ContentLength,source.bytes);
    const response=await fetch(base+`/sources/${receipt.sourceId}/file`,{headers:{Connection:'close'},signal:AbortSignal.timeout(150000)});assert.equal(response.status,200);const downloaded=createHash('sha256');let count=0;for await(const chunk of response.body){count+=chunk.length;assert(count<=source.bytes);downloaded.update(chunk);}assert.equal(count,source.bytes);assert.equal(downloaded.digest('hex'),source.sha256);
    receipt.download={bytes:count,sha256:source.sha256};receipt.checks.push('corrected bounded streaming finalization publishes one hash-verified original and replays; temporary payloads become zero-byte fences while canonical cleanup/download preserve exact original bytes');
    receipt.counts=(await pool().query(`SELECT (SELECT count(*)::int FROM sources WHERE case_id IN($1,$2)) sources,
      (SELECT count(*)::int FROM usp_source_uploads WHERE case_id IN($1,$2)) uploads,(SELECT count(*)::int FROM usp_source_uploads WHERE case_id IN($1,$2) AND state='aborted') aborted,
      (SELECT COALESCE(sum(original_bytes) FILTER(WHERE state<>'aborted'),0)::bigint FROM usp_source_uploads WHERE case_id IN($1,$2)) reserved,
      (SELECT count(*)::int FROM jobs WHERE case_id IN($1,$2)) jobs,(SELECT count(*)::int FROM usp_model_calls) "modelCalls"`,[caseId,otherCaseId])).rows[0];
    assert.deepEqual(receipt.counts,{sources:1,uploads:3,aborted:2,reserved:String(source.bytes),jobs:0,modelCalls:0});receipt.checks.push('read-only canonical/quota counts show one retained source, two aborted receipts, exactly one-original reserved payload and zero jobs/model calls');
    receipt.status='passed';receipt.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:receipt.status,checks:receipt.checks.length,counts:receipt.counts,receipt:output}));
  }catch(error){release.resolve();await latePromise;receipt.status='failed';receipt.phase=phase;receipt.error=error.message;writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});throw error;}
  finally{release.resolve();await file?.close();await closePool();s3.destroy();}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
