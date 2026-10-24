import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {DXFInputSchema,DXFResultSchema,DXF_VERSION,DXF_LIMITS} from '@ulpin/contracts/usp';
import {query,transaction,DbCommitOutcomeUnknown,type DbDeadline} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {putOriginal,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {claimUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,type UspJobAttempt} from '../jobs';
import {assertDXFTools} from './dxf-config';
import {processDXF} from './dxf-processor';
import {assertDXFInputTx,assertDXFJobRow,dxfResultKey,dxfArtifactKey,readDXFResult,boundedDXFObject} from './dxf';
import {appendCaseIngestionTx} from './events';

export function dxfFailureCode(error:unknown){
  if(error instanceof AppError){
    if(error.code==='DB_COMMIT_UNKNOWN')return 'DXF_COMMIT_UNKNOWN';
    if(error.code==='DB_DEADLINE')return 'DXF_TIMEOUT';
    if(/^DXF_[A-Z_]{1,60}$/.test(error.code))return error.code;
    if(error.status===409)return 'DXF_INPUT_STALE';
    if(error.status===403||error.status===404)return 'DXF_ACCESS_REVOKED';
    if(error.code==='STORAGE_TIMEOUT')return 'DXF_STORAGE_UNAVAILABLE';
  }
  return 'DXF_PROCESSING_FAILED';
}
/** Terminal bookkeeping cannot overwrite a newer owner, accepted result or cancellation. */
export async function failDXFJob(jobId:string,caseId:string,code:string,attempt?:UspJobAttempt,
  deadline:DbDeadline={deadlineAt:Date.now()+2000}){
  code=dxfFailureCode(new AppError(422,code,'Controlled DXF failure.'));
  await transaction(async client=>{
    await lockSourceCaseDestinationTx(client,caseId);
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='dxf-native' FOR UPDATE",[jobId])).rows[0];
    if(!job||job.case_id!==caseId||!['queued','running'].includes(job.status))return;
    const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!meta||['succeeded','cancelled','paused'].includes(meta.logical_state))return;
    const latest=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[jobId])).rows[0];
    if(attempt&&(!latest||Number(latest.fence)!==attempt.fence||latest.owner!==attempt.owner
      ||latest.input_sha256!==attempt.inputSha256||latest.state!=='active'))return;
    if(!attempt&&latest?.state==='active'&&new Date(latest.lease_until).getTime()>Date.now())return;
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    const status=code==='DXF_INPUT_STALE'?'stale':'failed';
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,status,code]);
    // Do not publish a private event using a revoked or unavailable binding.
    const parsed=DXFInputSchema.safeParse(job.payload);
    if(parsed.success){
      try{await assertDXFInputTx(client,parsed.data);
        await appendCaseIngestionTx(client,caseId,{kind:'dxf-native.changed',sourceId:parsed.data.sourceId,
          sourceRevision:parsed.data.sourceRevision,jobId,status},parsed.data.subject);
      }catch(error){if(!(error instanceof AppError&&[403,404,409,422].includes(error.status)))throw error;}
    }
  },deadline);
}

export async function runDXFJob(jobId:string){
  // The 150s total starts before lookup/claim and fits inside the canonical 180s lease.
  const deadlineAt=Date.now()+DXF_LIMITS.workerMs,controller=new AbortController(),deadline={deadlineAt,signal:controller.signal};
  const timer=setTimeout(()=>controller.abort(new AppError(504,'DXF_TIMEOUT','Absolute DXF deadline elapsed.')),DXF_LIMITS.workerMs);
  const stop=()=>controller.abort(new AppError(503,'DXF_CANCELLED','Owned dispatcher is stopping.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await executeDXFJob(jobId,deadline,controller);}
  finally{clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);controller.abort();}
}
async function executeDXFJob(jobId:string,deadline:DbDeadline,controller:AbortController){
  let job;
  try{job=(await query("SELECT j.*,m.input_sha256 FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1 AND j.operation='dxf-native'",[jobId],deadline)).rows[0];}
  catch{console.warn('DXF authority read deferred; canonical job/lease state is retained.');return;}
  if(!job||!['queued','running'].includes(job.status))return;
  const terminal=async(error:unknown,attempt?:UspJobAttempt)=>{
    if(error instanceof DbCommitOutcomeUnknown){
      console.warn('DXF commit outcome requires an authoritative read; no result or attempt is rewritten.');return;
    }
    try{await failDXFJob(jobId,job.case_id,typeof error==='string'?error:dxfFailureCode(error),attempt);}
    catch{console.warn('DXF terminal bookkeeping deferred; canonical fence/lease recovery is retained.');}
  };
  const parsed=DXFInputSchema.safeParse(job.payload);
  if(!parsed.success){await terminal('DXF_JOB_INTEGRITY');return;}
  const input=parsed.data;
  let attempt:UspJobAttempt|undefined;
  const beforeLocks=async(client:PoolClient)=>{
    await assertDXFInputTx(client,input,true);
    assertDXFTools(input.tools,deadline.deadlineAt);
  };
  try{
    assertDXFJobRow(job,input);
    if(job.status==='running'){
      if((await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now()",[jobId],deadline)).rowCount)return;
      await terminal('DXF_INTERRUPTED');return; // recovery is a new explicit job, never silent reparse
    }
    assertDXFTools(input.tools,deadline.deadlineAt);
    attempt=await claimUspJobAttempt(jobId,`dxf:${randomUUID()}`,beforeLocks,deadline);
    if(attempt.inputSha256!==fingerprint(input))throw new AppError(422,'DXF_JOB_INTEGRITY','Claimed metadata differs from the enrolled input.');
  }catch(error){await terminal(error,attempt);return;}
  const owned=attempt;
  const current=()=>transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,owned);},deadline);
  let stopped=false,checking:Promise<void>|undefined,monitorTimer:NodeJS.Timeout|undefined;
  const monitor=()=>{
    if(stopped)return;
    checking=current().catch(error=>controller.abort(error)).finally(()=>{
      if(!stopped&&!controller.signal.aborted)monitorTimer=setTimeout(monitor,5000);
    });
  };
  monitorTimer=setTimeout(monitor,5000);
  try{
    await transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,owned);
      await appendCaseIngestionTx(client,input.caseId,{kind:'dxf-native.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);},deadline);
    const original=await boundedDXFObject(input.objectKey,input.sourceBytes,controller.signal);
    await current();controller.signal.throwIfAborted();
    const native=await processDXF(input,original,controller.signal,deadline.deadlineAt);
    await current();controller.signal.throwIfAborted();
    const artifact={key:dxfArtifactKey(jobId,native.hash),sha256:native.hash,bytes:native.bytes.length,
      mediaType:'application/json' as const,profile:'dxf-native-inspection/1' as const};
    await putOriginal(artifact.key,native.bytes,artifact.mediaType,controller.signal);
    const result=DXFResultSchema.parse({version:DXF_VERSION,input,summary:native.summary,artifact,createdAt:new Date().toISOString()}),
      bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>DXF_LIMITS.resultBytes)throw new AppError(413,'DXF_RESULT_LIMIT','Native receipt exceeds its finite budget.');
    const hash=sha256(bytes),asset={assetId:`dxf:${jobId}:${bytes.length}`,version:1,sha256:hash};
    await putOriginal(dxfResultKey(jobId,hash),bytes,'application/json',controller.signal);
    await current();controller.signal.throwIfAborted();
    await acceptUspJobAttempt(owned,asset,async(client,stored,accepted)=>{
      assertDXFJobRow({...stored,input_sha256:owned.inputSha256},input);
      if(accepted.assetId!==asset.assetId||accepted.sha256!==hash)conflict('Completion differs from the staged DXF receipt.');
      const verified=await readDXFResult(input,hash,bytes.length,controller.signal),
        staged=await boundedDXFObject(verified.artifact.key,verified.artifact.bytes,controller.signal);
      if(sha256(staged)!==verified.artifact.sha256||fingerprint(verified)!==fingerprint(result))
        throw new AppError(422,'DXF_ARTIFACT_INTEGRITY','Staged DXF bytes differ from their pinned result.');
      await beforeLocks(client);await assertUspJobAttemptTx(client,owned);controller.signal.throwIfAborted();
    },beforeLocks,async client=>{
      await appendCaseIngestionTx(client,input.caseId,{kind:'dxf-native.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
    },deadline);
  }catch(error){await terminal(error instanceof DbCommitOutcomeUnknown?error:controller.signal.aborted?controller.signal.reason:error,owned);}
  finally{stopped=true;if(monitorTimer)clearTimeout(monitorTimer);controller.abort();await checking;}
}
