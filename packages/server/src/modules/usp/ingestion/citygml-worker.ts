import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {CityGMLInputSchema,CityGMLResultSchema,CITYGML_VERSION,CITYGML_LIMITS} from '../../../../../contracts/src/usp/citygml-ingestion';
import {query,transaction,DbCommitOutcomeUnknown,type DbDeadline} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {putOriginal,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {claimUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,type UspJobAttempt} from '../jobs';
import {assertCityGMLTools} from './citygml-config';
import {processCityGML} from './citygml-processor';
import {assertCityGMLInputTx,assertCityGMLJobRow,citygmlResultKey,citygmlArtifactKey,readCityGMLResult,boundedCityGMLObject} from './citygml';
import {appendCaseIngestionTx} from './events';

export function citygmlFailureCode(error:unknown){
  if(error instanceof AppError){
    if(error.code==='DB_COMMIT_UNKNOWN')return 'CITYGML_COMMIT_UNKNOWN';
    if(error.code==='DB_DEADLINE')return 'CITYGML_TIMEOUT';
    if(/^CITYGML_[A-Z_]{1,60}$/.test(error.code))return error.code;
    if(error.status===409)return 'CITYGML_INPUT_STALE';
    if(error.status===403||error.status===404)return 'CITYGML_ACCESS_REVOKED';
    if(error.code==='STORAGE_TIMEOUT')return 'CITYGML_STORAGE_UNAVAILABLE';
  }
  return 'CITYGML_PROCESSING_FAILED';
}
/** Terminal bookkeeping cannot overwrite a newer owner, accepted result or cancellation. */
export async function failCityGMLJob(jobId:string,caseId:string,code:string,attempt?:UspJobAttempt,
  deadline:DbDeadline={deadlineAt:Date.now()+2000}){
  code=citygmlFailureCode(new AppError(422,code,'Controlled CityGML failure.'));
  await transaction(async client=>{
    await lockSourceCaseDestinationTx(client,caseId);
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='citygml-native' FOR UPDATE",[jobId])).rows[0];
    if(!job||job.case_id!==caseId||!['queued','running'].includes(job.status))return;
    const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!meta||['succeeded','cancelled','paused'].includes(meta.logical_state))return;
    const latest=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[jobId])).rows[0];
    if(attempt&&(!latest||Number(latest.fence)!==attempt.fence||latest.owner!==attempt.owner
      ||latest.input_sha256!==attempt.inputSha256||latest.state!=='active'))return;
    if(!attempt&&latest?.state==='active'&&new Date(latest.lease_until).getTime()>Date.now())return;
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    const status=code==='CITYGML_INPUT_STALE'?'stale':'failed';
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,status,code]);
    // Do not publish a private event using a revoked or unavailable binding.
    const parsed=CityGMLInputSchema.safeParse(job.payload);
    if(parsed.success){
      try{await assertCityGMLInputTx(client,parsed.data);
        await appendCaseIngestionTx(client,caseId,{kind:'citygml-native.changed',sourceId:parsed.data.sourceId,
          sourceRevision:parsed.data.sourceRevision,jobId,status},parsed.data.subject);
      }catch(error){if(!(error instanceof AppError&&[403,404,409,422].includes(error.status)))throw error;}
    }
  },deadline);
}

export async function runCityGMLJob(jobId:string){
  // The 150s total starts before lookup/claim and fits inside the canonical 180s lease.
  const deadlineAt=Date.now()+CITYGML_LIMITS.workerMs,controller=new AbortController(),deadline={deadlineAt,signal:controller.signal};
  const timer=setTimeout(()=>controller.abort(new AppError(504,'CITYGML_TIMEOUT','Absolute CityGML deadline elapsed.')),CITYGML_LIMITS.workerMs);
  const stop=()=>controller.abort(new AppError(503,'CITYGML_CANCELLED','Owned dispatcher is stopping.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await executeCityGMLJob(jobId,deadline,controller);}
  finally{clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);controller.abort();}
}
async function executeCityGMLJob(jobId:string,deadline:DbDeadline,controller:AbortController){
  let job;
  try{job=(await query("SELECT j.*,m.input_sha256 FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1 AND j.operation='citygml-native'",[jobId],deadline)).rows[0];}
  catch{console.warn('CityGML authority read deferred; canonical job/lease state is retained.');return;}
  if(!job||!['queued','running'].includes(job.status))return;
  const terminal=async(error:unknown,attempt?:UspJobAttempt)=>{
    if(error instanceof DbCommitOutcomeUnknown){
      console.warn('CityGML commit outcome requires an authoritative read; no result or attempt is rewritten.');return;
    }
    try{await failCityGMLJob(jobId,job.case_id,typeof error==='string'?error:citygmlFailureCode(error),attempt);}
    catch{console.warn('CityGML terminal bookkeeping deferred; canonical fence/lease recovery is retained.');}
  };
  const parsed=CityGMLInputSchema.safeParse(job.payload);
  if(!parsed.success){await terminal('CITYGML_JOB_INTEGRITY');return;}
  const input=parsed.data;
  let attempt:UspJobAttempt|undefined;
  const beforeLocks=async(client:PoolClient)=>{
    await assertCityGMLInputTx(client,input,true);
    assertCityGMLTools(input.tools,deadline.deadlineAt);
  };
  try{
    assertCityGMLJobRow(job,input);
    if(job.status==='running'){
      if((await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now()",[jobId],deadline)).rowCount)return;
      await terminal('CITYGML_INTERRUPTED');return; // recovery is a new explicit job, never silent reparse
    }
    assertCityGMLTools(input.tools,deadline.deadlineAt);
    attempt=await claimUspJobAttempt(jobId,`citygml:${randomUUID()}`,beforeLocks,deadline);
    if(attempt.inputSha256!==fingerprint(input))throw new AppError(422,'CITYGML_JOB_INTEGRITY','Claimed metadata differs from the enrolled input.');
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
      await appendCaseIngestionTx(client,input.caseId,{kind:'citygml-native.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);},deadline);
    const original=await boundedCityGMLObject(input.objectKey,input.sourceBytes,controller.signal);
    await current();controller.signal.throwIfAborted();
    const native=await processCityGML(input,original,controller.signal,deadline.deadlineAt);
    await current();controller.signal.throwIfAborted();
    const artifact={key:citygmlArtifactKey(jobId,native.hash),sha256:native.hash,bytes:native.bytes.length,
      mediaType:'application/json' as const,profile:'ulpin-native-citygml/1' as const};
    await putOriginal(artifact.key,native.bytes,artifact.mediaType,controller.signal);
    const result=CityGMLResultSchema.parse({version:CITYGML_VERSION,input,summary:native.summary,supervision:native.supervision,artifact,createdAt:new Date().toISOString()}),
      bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>CITYGML_LIMITS.resultBytes)throw new AppError(413,'CITYGML_RESULT_LIMIT','Native receipt exceeds its finite budget.');
    const hash=sha256(bytes),asset={assetId:`citygml:${jobId}:${bytes.length}`,version:1,sha256:hash};
    await putOriginal(citygmlResultKey(jobId,hash),bytes,'application/json',controller.signal);
    await current();controller.signal.throwIfAborted();
    await acceptUspJobAttempt(owned,asset,async(client,stored,accepted)=>{
      assertCityGMLJobRow({...stored,input_sha256:owned.inputSha256},input);
      if(accepted.assetId!==asset.assetId||accepted.sha256!==hash)conflict('Completion differs from the staged CityGML receipt.');
      const verified=await readCityGMLResult(input,hash,bytes.length,controller.signal),
        staged=await boundedCityGMLObject(verified.artifact.key,verified.artifact.bytes,controller.signal);
      if(sha256(staged)!==verified.artifact.sha256||fingerprint(verified)!==fingerprint(result))
        throw new AppError(422,'CITYGML_ARTIFACT_INTEGRITY','Staged CityGML bytes differ from their pinned result.');
      await beforeLocks(client);await assertUspJobAttemptTx(client,owned);controller.signal.throwIfAborted();
    },beforeLocks,async client=>{
      await appendCaseIngestionTx(client,input.caseId,{kind:'citygml-native.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
    },deadline);
  }catch(error){await terminal(error instanceof DbCommitOutcomeUnknown?error:controller.signal.aborted?controller.signal.reason:error,owned);}
  finally{stopped=true;if(monitorTimer)clearTimeout(monitorTimer);controller.abort();await checking;}
}
