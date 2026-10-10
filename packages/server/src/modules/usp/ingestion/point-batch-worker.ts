import {randomUUID} from 'node:crypto';
import {POINT_BATCH_VERSION,POINT_BATCH_LIMITS,PointBatchInputSchema,PointBatchResultSchema,type PointBatchInput} from '@ulpin/contracts/usp';
import {query,transaction,DbCommitOutcomeUnknown,type DbDeadline} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {putOriginal,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,acceptUspJobAttempt,assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {assertPointInputTx,assertPointJobRow,pointArtifactKey,pointResultKey,readPointResult} from './point-batch';
import {readPointObject} from './point-batch-object';
import {nativePointBatch,pointPublicationLive} from './point-publication';

type Dependencies={request:typeof fetch;put:typeof putOriginal;read:typeof readPointObject};
const defaults:Dependencies={request:fetch,put:putOriginal,read:readPointObject};
function failureCode(error:unknown){
  if(error instanceof AppError){
    if(error.code==='DB_DEADLINE'||error.code==='POINT_READ_DEADLINE')return 'POINT_TIMEOUT';
    if(/^POINT_[A-Z_]{1,60}$/.test(error.code))return error.code;
    if(error.status===409)return 'POINT_INPUT_STALE';
    if(error.status===403||error.status===404)return 'POINT_ACCESS_REVOKED';
    if(error.code==='STORAGE_TIMEOUT')return 'POINT_STORAGE_UNAVAILABLE';
  }
  return 'POINT_PROCESSING_FAILED';
}
/** A successful/replayed conditional PUT verifies pinned bounded bytes. An
 * uncertain PUT recovers only by verifying the same immutable address. */
async function putPointExact(key:string,bytes:Buffer,mediaType:string,bounds:DbDeadline,deps:Dependencies=defaults){
  pointPublicationLive(bounds);const digest=sha256(bytes),cap=key.endsWith('.json')?POINT_BATCH_LIMITS.resultBytes:POINT_BATCH_LIMITS.artifactBytes;
  const receipt=key.endsWith('.json');
  if(!new RegExp(`^point-batches/[a-f0-9-]{36}/${digest}\\.${receipt?'json':'bin'}$`).test(key)||mediaType!==(receipt?'application/json':'application/vnd.las.point-records'))
    throw new AppError(422,'POINT_OBJECT_SCOPE','Stage an exact content-addressed point receipt or artifact.');
  if(!bytes.length||bytes.length>cap)throw new AppError(413,'POINT_RESULT_LIMIT','Staged point output exceeds its bounded profile.');
  const signal=bounds.signal??AbortSignal.timeout(Math.max(1,bounds.deadlineAt-Date.now()));
  try{await deps.put(key,bytes,mediaType,signal);pointPublicationLive(bounds);}
  catch(error){pointPublicationLive(bounds);
    try{await deps.read(key,digest,bytes.length,bounds);}catch{throw error;}}
  pointPublicationLive(bounds);
}
/** Terminal bookkeeping cannot overwrite accepted/cancelled state or another
 * owner. Expired owned work may be fenced; ambiguous commits never enter here. */
export async function failPointBatchJob(jobId:string,code:string,attempt?:UspJobAttempt,bounds:DbDeadline={deadlineAt:Date.now()+2000}){
  await transaction(async client=>{
    // Acquire source/case authority before job locks, in the same order as
    // claim/accept. Revoked/stale authority may still fence owned work, but
    // cannot publish an event to the private source stream.
    const candidate=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='point-batch'",[jobId])).rows[0];
    if(!candidate)return;
    const parsed=PointBatchInputSchema.safeParse(candidate.payload);let canEmit=false;
    if(parsed.success){try{await assertPointInputTx(client,parsed.data,true);canEmit=true;}
      catch(error){if(!(error instanceof AppError&&[403,404,409,422].includes(error.status)))throw error;}}
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='point-batch' FOR UPDATE",[jobId])).rows[0];
    if(!job||!['queued','running'].includes(job.status))return;
    const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!meta||['succeeded','cancelled','paused'].includes(meta.logical_state))return;
    const latest=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[jobId])).rows[0];
    if(attempt&&(!latest||Number(latest.fence)!==attempt.fence||latest.owner!==attempt.owner||latest.state!=='active'||
      latest.input_sha256!==attempt.inputSha256||meta.input_sha256!==attempt.inputSha256))return;
    if(!attempt&&latest?.state==='active')return;
    const stale=code==='POINT_INPUT_STALE';
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,stale?'stale':'failed',code]);
    if(canEmit&&parsed.success&&fingerprint(job.payload)===fingerprint(parsed.data)){try{await assertPointInputTx(client,parsed.data);
      await appendCaseIngestionTx(client,parsed.data.caseId,{kind:'point-batch.changed',sourceId:parsed.data.sourceId,
        sourceRevision:parsed.data.sourceRevision,jobId,status:stale?'stale':'failed'},parsed.data.subject);
    }catch(error){if(!(error instanceof AppError&&[403,404,409,422].includes(error.status)))throw error;}}
  },bounds);
}
export async function runPointBatchJob(jobId:string,deps:Dependencies=defaults,options:{signal?:AbortSignal;deadlineAt?:number}={}){
  if(options.deadlineAt!==undefined&&!Number.isFinite(options.deadlineAt))
    throw new AppError(422,'POINT_DEADLINE','Supply a finite absolute point operation deadline.');
  // One 150s operation starts before lookup/claim, within the canonical 180s lease.
  const deadlineAt=Math.min(Date.now()+150000,options.deadlineAt??Infinity),controller=new AbortController(),bounds={deadlineAt,signal:controller.signal};
  const stop=()=>controller.abort(new AppError(503,'POINT_CANCELLED','Owned point processing stopped.'));
  const timer=setTimeout(()=>controller.abort(new AppError(504,'POINT_TIMEOUT','Absolute point deadline elapsed.')),Math.max(0,deadlineAt-Date.now()));
  options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await executePointBatchJob(jobId,deps,bounds);}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',stop);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);controller.abort();}
}
async function executePointBatchJob(jobId:string,deps:Dependencies,bounds:DbDeadline){
  let job;
  try{pointPublicationLive(bounds);job=(await query(`SELECT j.*,m.input_manifest_id,m.input_sha256,m.scope FROM jobs j
    JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1 AND j.operation='point-batch'`,[jobId],bounds)).rows[0];}
  catch{console.warn('Point authority read deferred; canonical job/lease state is retained.');return;}
  if(!job||!['queued','running'].includes(job.status))return;
  const terminal=async(error:unknown,attempt?:UspJobAttempt)=>{
    if(error instanceof DbCommitOutcomeUnknown){console.warn('Point commit outcome requires an authoritative read; no output or attempt is rewritten.');return;}
    try{await failPointBatchJob(jobId,typeof error==='string'?error:failureCode(bounds.signal?.aborted?bounds.signal.reason:error),attempt);}
    catch{console.warn('Point terminal bookkeeping deferred; canonical fence/lease recovery is retained.');}
  };
  const parsed=PointBatchInputSchema.safeParse(job.payload);if(!parsed.success){await terminal('POINT_JOB_INTEGRITY');return;}
  const input:PointBatchInput=parsed.data;
  const beforeLocks=async(client:Parameters<typeof assertPointInputTx>[0])=>{pointPublicationLive(bounds);await assertPointInputTx(client,input,true);};
  let attempt:UspJobAttempt|undefined;
  try{
    assertPointJobRow(job,input);attempt=await claimUspJobAttempt(jobId,`point:${randomUUID()}`,beforeLocks,bounds);
    if(attempt.inputSha256!==fingerprint(input))throw new AppError(422,'POINT_JOB_INTEGRITY','Claimed metadata differs from the enrolled point input.');
  }catch(error){
    if(error instanceof DbCommitOutcomeUnknown){await terminal(error);return;}
    // A failed claim cannot fence an active/newer owner, cancellation or acceptance.
    await terminal(error,attempt);return;
  }
  const owned=attempt;
  const current=()=>transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,owned);},bounds);
  try{
    await transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,owned);
      await appendCaseIngestionTx(client,input.caseId,{kind:'point-batch.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);},bounds);
    const native=await nativePointBatch(input,bounds,deps.request);
    await current();pointPublicationLive(bounds);
    const artifact={key:pointArtifactKey(jobId,native.hash),sha256:native.hash,bytes:native.bytes.length,mediaType:'application/vnd.las.point-records' as const};
    await putPointExact(artifact.key,native.bytes,artifact.mediaType,bounds,deps);
    const result=PointBatchResultSchema.parse({version:POINT_BATCH_VERSION,input,metadata:native.metadata,artifact,createdAt:new Date().toISOString()}),
      bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>POINT_BATCH_LIMITS.resultBytes)throw new AppError(413,'POINT_RESULT_LIMIT','The batch metadata exceeds the bounded result budget.');
    const hash=sha256(bytes),asset={assetId:`point:${jobId}`,version:1,sha256:hash};
    await putPointExact(pointResultKey(jobId,hash),bytes,'application/json',bounds,deps);
    // Immutable receipt and artifact I/O completes before acceptance takes locks.
    const verified=await readPointResult(input,hash,bounds,(key,digest,size,deadline)=>deps.read(key,digest,size??bytes.length,deadline));
    if(fingerprint(verified)!==fingerprint(result))throw new AppError(422,'POINT_RESULT_INTEGRITY','The staged receipt differs from its prepared result.');
    const stored=await deps.read(verified.artifact.key,verified.artifact.sha256,verified.artifact.bytes,bounds);
    if(stored.length!==artifact.bytes||sha256(stored)!==artifact.sha256)
      throw new AppError(422,'POINT_ARTIFACT_INTEGRITY','The staged native batch differs from its receipt.');
    const preflight=Object.freeze({inputSha256:fingerprint(input),resultSha256:hash,artifactSha256:sha256(stored),artifactBytes:stored.length});
    pointPublicationLive(bounds);
    await acceptUspJobAttempt(owned,asset,async(client,currentJob,accepted)=>{
      pointPublicationLive(bounds);
      const enrollment=(await client.query('SELECT input_manifest_id,input_sha256,scope FROM usp_job_metadata WHERE job_id=$1',[jobId])).rows[0];
      assertPointJobRow({...currentJob,...enrollment},input);
      if(fingerprint(accepted)!==fingerprint(asset)||accepted.sha256!==preflight.resultSha256||currentJob.input_fingerprint!==preflight.inputSha256||
        owned.inputSha256!==preflight.inputSha256||artifact.sha256!==preflight.artifactSha256||artifact.bytes!==preflight.artifactBytes)
        conflict('The exact prepared point publication or enrolled input changed.');
      await assertPointInputTx(client,input);await assertUspJobAttemptTx(client,owned);pointPublicationLive(bounds);
    },beforeLocks,async client=>{
      await appendCaseIngestionTx(client,input.caseId,{kind:'point-batch.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
    },bounds);
  }catch(error){await terminal(error,owned);}
}
