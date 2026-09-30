import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CITYJSON_VALIDATION_VERSION,CITYJSON_VALIDATION_LIMITS,RegistryCityJSONValidationRequestSchema,
  RegistryCityJSONValidationInputSchema,RegistryCityJSONValidationReceiptSchema,RegistryCityJSONValidationResultSchema,
  RegistryCityJSONValidationStatusSchema,type RegistryCityJSONValidationInput} from '@ulpin/contracts';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {sha256,openObjectStream} from '../../infrastructure/storage';
import {fingerprint} from '../cases/domain';
import {registerUspJobInputTx} from '../usp/jobs';
import {registryCityJSONAuthorityTx,readRegistryCityJSONDraftTx} from './cityjson-draft';
import {cityjsonValidationConfig} from './cityjson-validation-config';
import {validationSummary} from './cityjson-validation-processor';

const uuid=z.uuid().transform(v=>v.toLowerCase());
export const cityjsonValidationResultKey=(jobId:string,hash:string)=>`cityjson-validation/${jobId}/${hash}.result.json`;
export const cityjsonValidationReportKey=(jobId:string,hash:string,name:string)=>`cityjson-validation/${jobId}/${hash}.${name}`;
type Authority=Awaited<ReturnType<typeof registryCityJSONAuthorityTx>>;
/** Candidate/site/record/footprint identity remains mandatory on replay and after I/O. */
export function assertCityJSONValidationAuthority(input:RegistryCityJSONValidationInput,current:Authority){
  if(input.draftId!==current.draft.id||input.draftRevision!==current.draft.revision||input.siteId!==current.site.id||
    input.recordId!==current.record.id||fingerprint(input.candidate)!==fingerprint(current.candidate)||
    input.footprintSha256!==fingerprint(current.record.footprint))
    conflict('The enrolled native draft, candidate, site or footprint changed.');
}
export async function assertCityJSONValidationInputTx(client:PoolClient,input:RegistryCityJSONValidationInput){
  const current=await registryCityJSONAuthorityTx(client,input.draftId);
  assertCityJSONValidationAuthority(input,current);return current;
}
/** Convert only canonical artifact pointers to source indices; never accept a caller command selection. */
export function validationSelections(candidate:Authority['candidate']){
  const {selection:s}=candidate;
  const geometryIndex=(pointer:string,objectPointer:string)=>{
    const tail=pointer.slice(objectPointer.length),match=/^\/geometry\/(0|[1-9]\d*)(?:\/boundaries(?:\/.*)?)?$/.exec(tail);
    if(!pointer.startsWith(objectPointer)||!match||!Number.isSafeInteger(Number(match[1])))
      throw new AppError(422,'CITYJSON_VALIDATION_SELECTION','Candidate has no supported exact source geometry index.');
    return Number(match[1]);
  };
  const buildingIndex=geometryIndex(s.footprintSurfacePointer,s.buildingPointer);
  const choices=[{objectId:s.buildingObjectId,geometryIndex:buildingIndex,geometryPointer:`${s.buildingPointer}/geometry/${buildingIndex}`},
    {objectId:s.objectId,geometryIndex:geometryIndex(s.geometryPointer,s.objectPointer),geometryPointer:s.geometryPointer}];
  return choices.filter((v,i)=>choices.findIndex(other=>other.objectId===v.objectId&&other.geometryIndex===v.geometryIndex)===i);
}
type EnqueueDependencies={authority:typeof registryCityJSONAuthorityTx;readDraft:typeof readRegistryCityJSONDraftTx;
  register:typeof registerUspJobInputTx;config:typeof cityjsonValidationConfig};
const defaults:EnqueueDependencies={authority:registryCityJSONAuthorityTx,readDraft:readRegistryCityJSONDraftTx,
  register:registerUspJobInputTx,config:cityjsonValidationConfig};
export async function enqueueCityJSONValidationTx(client:PoolClient,draftValue:string,raw:unknown,dependencies:EnqueueDependencies=defaults){
  const draftId=uuid.parse(draftValue),request=RegistryCityJSONValidationRequestSchema.parse(raw),config=dependencies.config();
  const current=await dependencies.authority(client,draftId);
  if(current.draft.revision!==request.expectedDraftRevision)conflict('Pin the current native draft revision.');
  // Existing reader verifies exact selected geometry/derived footprint and repeats accepted authority after artifact I/O.
  await dependencies.readDraft(client,draftId);
  const checked=await dependencies.authority(client,draftId),candidate=current.candidate;
  const jobId=randomUUID(),input=RegistryCityJSONValidationInputSchema.parse({version:CITYJSON_VALIDATION_VERSION,jobId,
    draftId,draftRevision:current.draft.revision,siteId:current.site.id,recordId:current.record.id,candidate,
    footprintSha256:fingerprint(current.record.footprint),selections:validationSelections(candidate),validator:config.pins});
  assertCityJSONValidationAuthority(input,checked);
  if(fingerprint(dependencies.config().pins)!==fingerprint(config.pins))conflict('Validator configuration changed during admission.');
  const caseId=candidate.input.caseId,key=`registry-cityjson-validation:${request.requestKey}`,
    digest=fingerprint({draftId,request,candidate,footprintSha256:input.footprintSha256,validator:input.validator});
  const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='registry-cityjson-validation'",[caseId,key])).rows[0];
  if(prior){
    if(prior.payload_hash!==digest)conflict('This request key names different native draft or validator pins.');
    const receipt=RegistryCityJSONValidationReceiptSchema.parse(prior.result);
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='cityjson-validation'",[receipt.jobId])).rows[0]??notFound();
    const priorInput=RegistryCityJSONValidationInputSchema.parse(job.payload);
    assertCityJSONValidationAuthority(priorInput,checked);assertCityJSONValidationJob(job,priorInput);
    if(fingerprint({...priorInput,jobId})!==fingerprint(input)||receipt.draftId!==draftId||receipt.draftRevision!==current.draft.revision)
      conflict('This validation replay no longer names its exact enrolled job.');
    return receipt;
  }
  // Serialize bounded admission globally only after the per-case/destination gate, before job rows.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cityjson-validation-admission-v1',0))");
  const history=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE operation='cityjson-validation' AND payload->>'draftId'=$1",[draftId])).rows[0].n);
  const active=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE operation='cityjson-validation' AND status IN ('queued','running')")).rows[0].n);
  if(history>=CITYJSON_VALIDATION_LIMITS.jobsPerDraft)throw new AppError(429,'CITYJSON_VALIDATION_HISTORY_LIMIT','Validation history is full; prior results and original remain available.');
  if(active>=CITYJSON_VALIDATION_LIMITS.active)throw new AppError(429,'CITYJSON_VALIDATION_BUSY','Bounded validation jobs are occupied.');
  const inputHash=fingerprint(input);
  await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'cityjson-validation',$4,$5,$6)",
    [jobId,caseId,candidate.input.sourceId,candidate.input.caseRevision,inputHash,input]);
  await dependencies.register(client,jobId,{kind:'intake',workspaceId:caseId,version:candidate.input.caseRevision+1},candidate.input.sourceId,inputHash);
  const receipt=RegistryCityJSONValidationReceiptSchema.parse({version:CITYJSON_VALIDATION_VERSION,draftId,draftRevision:current.draft.revision,jobId});
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'registry-cityjson-validation',$3,$4)",[caseId,key,digest,receipt]);
  return receipt;
}
export const enqueueCityJSONValidation=(draftId:string,raw:unknown)=>transaction(client=>enqueueCityJSONValidationTx(client,draftId,raw));

export function assertCityJSONValidationJob(job:Record<string,any>,input:RegistryCityJSONValidationInput,accepted=false){
  const digest=fingerprint(input),source=input.candidate.input;
  if(job.id!==input.jobId||job.operation!=='cityjson-validation'||job.case_id!==source.caseId||job.source_id!==source.sourceId||
    job.case_revision!==source.caseRevision||job.input_fingerprint!==digest||fingerprint(job.payload)!==digest||
    (job.input_sha256!==undefined&&job.input_sha256!==digest))
    throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Validation job is not its enrolled input.');
  if(accepted&&(job.status!=='succeeded'||job.logical_state!=='succeeded'||job.input_sha256!==digest||
    job.result_ref?.assetId!==`cityjson-validation:${input.jobId}`||job.result_ref?.version!==1||
    job.attempt_state!=='accepted'||Number(job.attempt_fence)!==Number(job.accepted_fence)||
    job.attempt_input_sha256!==digest||job.completion_sha256!==job.result_ref?.sha256))
    conflict('No exact accepted validation attempt is available.');
}
/** Existing private streaming authority, with an optional worker cancellation signal. */
export async function boundedCityJSONValidationObject(key:string,size:number,signal?:AbortSignal){
  if(!Number.isSafeInteger(size)||size<0||size>8*1024*1024)
    throw new AppError(413,'CITYJSON_VALIDATION_RESULT_LIMIT','Object exceeds its bounded validation profile.');
  signal?.throwIfAborted();
  const {body}=await openObjectStream(key,size,30_000,undefined,signal),parts:Buffer[]=[];let total=0;
  try{
    for await(const part of body){const data=Buffer.from(part);total+=data.length;
      if(total>size)throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Private object exceeds its receipt.');parts.push(data);}
    if(total!==size)throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Private object ended before its receipt.');
    signal?.throwIfAborted();return Buffer.concat(parts,total);
  }catch(error){signal?.throwIfAborted();throw error;}finally{body.destroy();}
}
export async function readCityJSONValidationResult(input:RegistryCityJSONValidationInput,hash:string,signal?:AbortSignal){
  // A fixed-size JSON envelope permits exact bounded streaming without a second manifest/store.
  const bytes=await boundedCityJSONValidationObject(cityjsonValidationResultKey(input.jobId,hash),CITYJSON_VALIDATION_LIMITS.resultBytes,signal);
  if(bytes.length>CITYJSON_VALIDATION_LIMITS.resultBytes||sha256(bytes)!==hash)
    throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Private result failed its byte/hash receipt.');
  const result=RegistryCityJSONValidationResultSchema.parse(JSON.parse(bytes.toString('utf8')));
  if(fingerprint(result.input)!==fingerprint(input))conflict('Private result belongs to another candidate or job.');
  const reports=[];
  for(const report of result.reports){
    if(report.key!==cityjsonValidationReportKey(input.jobId,report.sha256,report.name))conflict('Private report key is not derived from its immutable receipt.');
    const data=await boundedCityJSONValidationObject(report.key,report.bytes,signal);
    if(data.length!==report.bytes||sha256(data)!==report.sha256)throw new AppError(422,'CITYJSON_VALIDATION_INTEGRITY','Private report differs from its byte/hash receipt.');
    reports.push({name:report.name,bytes:Buffer.from(data)});
  }
  if(new Set(result.reports.map(v=>v.name)).size!==result.reports.length)conflict('Duplicate private report names.');
  const receipt=reports.find(v=>v.name==='receipt.json');if(!receipt)conflict('Private validation receipt is absent.');
  if(fingerprint(validationSummary(JSON.parse(receipt.bytes.toString('utf8')),input,reports))!==fingerprint(result.summary))
    conflict('Result summary is not its bound local reports.');
  return result;
}
export function encodeCityJSONValidationResult(raw:unknown){
  const result=RegistryCityJSONValidationResultSchema.parse(raw),json=Buffer.from(JSON.stringify(result));
  if(json.length>CITYJSON_VALIDATION_LIMITS.resultBytes)throw new AppError(413,'CITYJSON_VALIDATION_RESULT_LIMIT','Private result exceeds its bounded profile.');
  return Buffer.concat([json,Buffer.alloc(CITYJSON_VALIDATION_LIMITS.resultBytes-json.length,0x20)]);
}

export async function cityjsonValidationStatusTx(client:PoolClient,draftId:string,jobId:string){
  const current=await registryCityJSONAuthorityTx(client,draftId);
  const job=(await client.query(`SELECT j.*,m.result_ref,m.input_sha256,m.logical_state,m.accepted_fence,
    a.state attempt_state,a.fence attempt_fence,a.input_sha256 attempt_input_sha256,a.completion_sha256
    FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id LEFT JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence
    WHERE j.id=$1 AND j.operation='cityjson-validation' FOR SHARE OF j,m`,[jobId])).rows[0]??notFound('Validation job not found.');
  const input=RegistryCityJSONValidationInputSchema.parse(job.payload);
  assertCityJSONValidationAuthority(input,current);assertCityJSONValidationJob(job,input,job.status==='succeeded');
  if(job.status==='succeeded'){
    const attempt=(await client.query('SELECT state,input_sha256,completion_sha256 FROM usp_job_attempts WHERE job_id=$1 AND fence=$2 FOR SHARE',
      [jobId,job.accepted_fence])).rows[0];
    if(attempt?.state!=='accepted'||attempt.input_sha256!==fingerprint(input)||attempt.completion_sha256!==job.result_ref.sha256)
      conflict('Accepted validation attempt changed.');
  }
  return {input,job};
}
export async function readCityJSONValidationStatus(draftValue:string,jobValue:string){
  const draftId=uuid.parse(draftValue),jobId=uuid.parse(jobValue);
  const row=await transaction(client=>cityjsonValidationStatusTx(client,draftId,jobId));
  const result=row.job.status==='succeeded'?await readCityJSONValidationResult(row.input,row.job.result_ref.sha256):null;
  if(result&&fingerprint(cityjsonValidationConfig().pins)!==fingerprint(row.input.validator))conflict('Validator configuration changed; result is historical.');
  await transaction(async client=>{
    const after=await cityjsonValidationStatusTx(client,draftId,jobId);
    if(fingerprint(after.input)!==fingerprint(row.input)||after.job.status!==row.job.status||
      fingerprint(after.job.result_ref)!==fingerprint(row.job.result_ref)||after.job.accepted_fence!==row.job.accepted_fence)
      conflict('Validation status changed during private report I/O.');
  });
  const response=RegistryCityJSONValidationStatusSchema.parse({version:CITYJSON_VALIDATION_VERSION,draftId,draftRevision:row.input.draftRevision,jobId,
    status:row.job.status==='succeeded'?'completed':row.job.status,code:row.job.error??null,
    result:result?{summary:result.summary,createdAt:result.createdAt,resultSha256:row.job.result_ref.sha256}:null});
  if(Buffer.byteLength(JSON.stringify(response))>CITYJSON_VALIDATION_LIMITS.statusBytes)throw new AppError(413,'CITYJSON_VALIDATION_RESULT_LIMIT','Status exceeds its bounded profile.');
  return response;
}
