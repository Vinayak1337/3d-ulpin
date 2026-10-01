import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {RegistryCityJSONValidationInputSchema,CITYJSON_VALIDATION_VERSION} from '@ulpin/contracts';
import {query,transaction,DbCommitOutcomeUnknown,type DbDeadline} from '../../infrastructure/db';
import {AppError,conflict} from '../../infrastructure/errors';
import {putOriginal,sha256} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {lockSourceCaseDestinationTx} from '../cases/source-case-lock';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,type UspJobAttempt} from '../usp/jobs';
import {cityjsonValidationConfig,validationUnavailable} from './cityjson-validation-config';
import {processCityJSONValidation} from './cityjson-validation-processor';
import {assertCityJSONValidationInputTx,assertCityJSONValidationJob,cityjsonValidationResultKey,
  cityjsonValidationReportKey,readCityJSONValidationResult,encodeCityJSONValidationResult,boundedCityJSONValidationObject} from './cityjson-validation';
import {controlledCityJSONValidationError} from './cityjson-validation';

export function cityjsonValidationFailureCode(error:unknown){
  if(error instanceof AppError){
    if(error.code==='DB_COMMIT_UNKNOWN')return 'CITYJSON_VALIDATION_COMMIT_UNKNOWN';
    if(error.code==='DB_DEADLINE')return 'CITYJSON_VALIDATION_TIMEOUT';
    if(error.code.startsWith('CITYJSON_VALIDATION_'))return controlledCityJSONValidationError(error.code);
    if(error.status===409)return 'CITYJSON_VALIDATION_STALE';
    if(error.status===403)return 'CITYJSON_VALIDATION_ACCESS_REVOKED';
    if(error.code==='STORAGE_TIMEOUT')return 'CITYJSON_VALIDATION_STORAGE_UNAVAILABLE';
  }
  return 'CITYJSON_VALIDATION_TOOL_FAILURE';
}
/** Persist only controlled codes; never change source/candidate geometry or revive a terminal job. */
export async function failCityJSONValidationJob(jobId:string,caseId:string,code:string,attempt?:UspJobAttempt,
  deadline:DbDeadline={deadlineAt:Date.now()+2000}){
  await transaction(async client=>{
    await lockSourceCaseDestinationTx(client,caseId);
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='cityjson-validation' FOR UPDATE",[jobId])).rows[0];
    if(!job||!['queued','running'].includes(job.status))return;
    // Failed authority may have expired: persist only if this exact attempt still owns the latest fence.
    const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!meta||['succeeded','cancelled','paused'].includes(meta.logical_state))return;
    const latest=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[jobId])).rows[0];
    if(attempt&&(!latest||Number(latest.fence)!==attempt.fence||latest.owner!==attempt.owner||latest.input_sha256!==attempt.inputSha256||latest.state!=='active'))return;
    if(!attempt&&latest?.state==='active'&&new Date(latest.lease_until).getTime()>Date.now())return;
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,code==='CITYJSON_VALIDATION_STALE'?'stale':'failed',code]);
  },deadline);
}
export async function runCityJSONValidationJob(jobId:string){
  // Install stop/deadline before acquisition, initial lookup or claim. One absolute
  // bound flows through SQL, object/process I/O, accepted writes and COMMIT.
  const deadlineAt=Date.now()+300_000,controller=new AbortController(),deadline={deadlineAt,signal:controller.signal};
  const totalDeadline=setTimeout(()=>controller.abort(new AppError(504,'CITYJSON_VALIDATION_TIMEOUT','Absolute worker deadline elapsed.')),Math.max(0,deadlineAt-Date.now()));
  const stop=()=>controller.abort(new AppError(503,'CITYJSON_VALIDATION_CANCELLED','Owned dispatcher is stopping.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await executeCityJSONValidationJob(jobId,deadline,controller);}
  finally{clearTimeout(totalDeadline);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);controller.abort();}
}
async function executeCityJSONValidationJob(jobId:string,deadline:DbDeadline,controller:AbortController){
  let job;
  try{job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='cityjson-validation'",[jobId],deadline)).rows[0];}
  catch{console.warn('CityJSON validation initial authority read did not finish; canonical job/lease state is retained.');return;}
  if(!job||!['queued','running'].includes(job.status))return;
  const terminal=async(code:string,attempt?:UspJobAttempt)=>{
    try{await failCityJSONValidationJob(jobId,job.case_id,code,attempt);}
    catch{console.warn('CityJSON validation terminal bookkeeping deferred; canonical fence/lease recovery is retained.');}
  };
  const parsed=RegistryCityJSONValidationInputSchema.safeParse(job.payload);
  if(!parsed.success){await terminal('CITYJSON_VALIDATION_INTEGRITY');return;}
  const input=parsed.data;
  let attempt:UspJobAttempt|undefined;
  const beforeLocks=async(client:PoolClient)=>{
    await assertCityJSONValidationInputTx(client,input);
    if(fingerprint(cityjsonValidationConfig().pins)!==fingerprint(input.validator))validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
  };
  try{
    assertCityJSONValidationJob(job,input);
    if(job.status==='running'){
      const active=(await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now()",[jobId],deadline)).rowCount;
      if(active)return;
      // A crash/expired worker never silently reruns native tools. An explicit request creates new history.
      await terminal('CITYJSON_VALIDATION_INTERRUPTED');return;
    }
    if(fingerprint(cityjsonValidationConfig().pins)!==fingerprint(input.validator))validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
    attempt=await claimUspJobAttempt(jobId,`cityjson-validation:${randomUUID()}`,beforeLocks,deadline);
    if(attempt.inputSha256!==fingerprint(input))throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Claimed metadata is not the enrolled input.');
  }catch(error){
    await terminal(cityjsonValidationFailureCode(error),attempt);return;
  }
  const ownedAttempt=attempt;
  let stopped=false,checking:Promise<void>|undefined,timer:NodeJS.Timeout|undefined,lastHeartbeat=Date.now();
  const assertAttempt=async(client:PoolClient)=>{
    try{await assertUspJobAttemptTx(client,ownedAttempt);}catch(error){
      if(error instanceof AppError&&error.status===409)throw new AppError(409,'CITYJSON_VALIDATION_INTERRUPTED','Validation attempt expired or was fenced.');throw error;
    }
  };
  const current=async()=>transaction(async client=>{await beforeLocks(client);await assertAttempt(client);},deadline);
  const monitor=()=>{
    if(stopped)return;
    checking=(async()=>{
      await current();
      if(Date.now()-lastHeartbeat>=30_000){await heartbeatUspJobAttempt(ownedAttempt,beforeLocks,deadline);lastHeartbeat=Date.now();}
    })().catch(error=>{controller.abort(error);}).finally(()=>{if(!stopped&&!controller.signal.aborted)timer=setTimeout(monitor,5000);});
  };
  timer=setTimeout(monitor,5000);
  try{
    const original=await boundedCityJSONValidationObject(input.candidate.input.objectKey,input.candidate.input.sourceBytes,controller.signal);
    await current();controller.signal.throwIfAborted();
    const processed=await processCityJSONValidation(input,original,controller.signal);
    await current();controller.signal.throwIfAborted();
    const reports=[];
    for(const report of processed.reports){
      controller.signal.throwIfAborted();
      const hash=sha256(report.bytes),key=cityjsonValidationReportKey(jobId,hash,report.name);
      await putOriginal(key,report.bytes,'application/octet-stream',controller.signal);
      reports.push({name:report.name,key,sha256:hash,bytes:report.bytes.length});
    }
    const resultBytes=encodeCityJSONValidationResult({version:CITYJSON_VALIDATION_VERSION,input,summary:processed.summary,reports,createdAt:new Date().toISOString()}),
      hash=sha256(resultBytes),asset={assetId:`cityjson-validation:${jobId}`,version:1,sha256:hash};
    await putOriginal(cityjsonValidationResultKey(jobId,hash),resultBytes,'application/json',controller.signal);
    controller.signal.throwIfAborted();await current();
    if(fingerprint(cityjsonValidationConfig().pins)!==fingerprint(input.validator))validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
    await acceptUspJobAttempt(ownedAttempt,asset,async(client,stored,accepted)=>{
      assertCityJSONValidationJob(stored,input);
      if(accepted.assetId!==asset.assetId||accepted.sha256!==hash)conflict('Completion is not the staged validation result.');
      await readCityJSONValidationResult(input,accepted.sha256,controller.signal);
      // After report I/O: source/candidate and live lease are rechecked before accepted publication.
      await beforeLocks(client);await assertAttempt(client);controller.signal.throwIfAborted();
      if(fingerprint(cityjsonValidationConfig().pins)!==fingerprint(input.validator))validationUnavailable('CITYJSON_VALIDATION_TOOL_CHANGED');
    },beforeLocks,undefined,deadline);
  }catch(error){await terminal(cityjsonValidationFailureCode(error instanceof DbCommitOutcomeUnknown?error:
    controller.signal.aborted?controller.signal.reason:error),ownedAttempt);}
  finally{stopped=true;if(timer)clearTimeout(timer);controller.abort();await checking;}
}
