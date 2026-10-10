import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CITYGML_VERSION,CITYGML_LIMITS,CityGMLRetainSchema,CityGMLRequestSchema,
  CityGMLOriginalSchema,CityGMLInputSchema,CityGMLResultSchema,CityGMLStatusSchema,CityGMLRetainReceiptSchema,CityGMLQueueReceiptSchema,
  type CityGMLInput,type CityGMLResult} from '../../../../../contracts/src/usp/citygml-ingestion';
import {transaction,query,DbCommitOutcomeUnknown,type DbDeadline} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,openObjectStream,removeOrphan,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {compareSourcePins} from './source-pin';
import {registerUspJobInputTx} from '../jobs';
import {citygmlConfig,assertCityGMLReadTools} from './citygml-config';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {appendCaseIngestionTx,ingestionBinding,assertIngestionBinding} from './events';

const uuid=z.uuid().transform(value=>value.toLowerCase());
/** A present malformed/null marker is protected, never a legacy fallback. */
export function isCityGMLProtectedSource(source:{profile?:unknown;inspection?:unknown}){
  return source.profile==='citygml-native-v1'||Boolean(source.inspection&&typeof source.inspection==='object'
    &&Object.prototype.hasOwnProperty.call(source.inspection,'citygmlOriginal'));
}
export const citygmlReaderSha=()=>sha256(Buffer.concat(['services/geo/geo/native_citygml.py','scripts/usp/desktop-citygml-read.py'].flatMap(file=>[Buffer.from(file+'\0'),readFileSync(join(settings.repositoryRoot,file))])));
export const citygmlResultKey=(jobId:string,hash:string)=>`citygml-native/${jobId}/${hash}.json`;
export const citygmlArtifactKey=(jobId:string,hash:string)=>`citygml-native/${jobId}/${hash}.native.json`;

/** Exact object length is enforced before collecting a bounded original/artifact. */
export async function boundedCityGMLObject(key:string,size:number,signal?:AbortSignal){
  const cap=key.startsWith('sources/')?CITYGML_LIMITS.originalBytes:CITYGML_LIMITS.artifactBytes;
  if(!Number.isSafeInteger(size)||size<1||size>cap)
    throw new AppError(422,'CITYGML_OBJECT_LIMIT','Stored CityGML object exceeds its private profile.');
  const {body}=await openObjectStream(key,size,30_000,undefined,signal),parts:Buffer[]=[];let total=0;
  try{for await(const part of body){const bytes=Buffer.from(part);total+=bytes.length;
    if(total>size)throw new AppError(422,'CITYGML_OBJECT_LIMIT','Stored object exceeds its receipt.');parts.push(bytes);}
    if(total!==size)throw new AppError(422,'CITYGML_OBJECT_INTEGRITY','Stored object ended before its receipt.');
    return Buffer.concat(parts,total);
  }finally{body.destroy();}
}

/** Pin the stored payload and accepted attempt, not merely job.status. */
export function assertCityGMLJobRow(job:Record<string,any>,input:CityGMLInput,accepted=false){
  const digest=fingerprint(input);
  if(job.id!==input.jobId||job.operation!=='citygml-native'||job.case_id!==input.caseId||job.source_id!==input.sourceId
    ||job.case_revision!==input.caseRevision||job.input_fingerprint!==digest||job.input_sha256!==digest
    ||fingerprint(job.payload)!==digest)
    throw new AppError(422,'CITYGML_JOB_INTEGRITY','Stored job does not match its source-bound input.');
  if(accepted&&(job.status!=='succeeded'||job.logical_state!=='succeeded'||!job.result_ref
    ||!new RegExp(`^citygml:${input.jobId}:[1-9][0-9]{0,5}$`).test(job.result_ref.assetId)||job.result_ref.version!==1
    ||job.attempt_state!=='accepted'||Number(job.attempt_fence)!==Number(job.accepted_fence)
    ||job.attempt_input_sha256!==digest||job.completion_sha256!==job.result_ref.sha256))
    conflict('No exact accepted CityGML attempt is available.');
}

export async function citygmlSourceTx(client:PoolClient,caseId:string,sourceId:string,lock=false){
  if(lock)await lockSourceCaseDestinationTx(client,caseId);
  const binding=ingestionBinding(caseId);
  const current=(await client.query(`SELECT id,revision,archived,frame,context,site_id FROM cases WHERE id=$1${lock?' FOR SHARE':''}`,[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'CITYGML_DENIED','This source case is archived.');
  const source=(await client.query(`SELECT * FROM sources WHERE case_id=$1 AND id=$2${lock?' FOR SHARE':''}`,[caseId,sourceId])).rows[0]??notFound('CityGML source not found in this case.');
  const original=CityGMLOriginalSchema.safeParse(source.inspection?.citygmlOriginal);
  if(source.profile!=='citygml-native-v1'||!original.success||original.data.subject!==binding.subject||original.data.accessSha256!==binding.access)
    throw new AppError(403,'CITYGML_DENIED','This retained CityGML is unavailable to the current local context.');
  if(original.data.sha256!==source.sha256||original.data.bytes!==Number(source.bytes)||source.object_key!==`sources/${sourceId}/${source.sha256}`)
    throw new AppError(422,'CITYGML_SOURCE_INTEGRITY','The CityGML receipt differs from its canonical source.');
  const latest=Number((await client.query('SELECT max(revision) revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision)===source.revision;
  assertIngestionBinding(binding);
  return {current,source,binding,latest,context:fingerprint({frame:current.frame,context:current.context,siteId:current.site_id})};
}
export function nullableCityGMLTools(){try{return citygmlConfig().pins;}catch(error){if(error instanceof AppError&&error.status===503)return null;throw error;}}
export function citygmlInput(ctx:Awaited<ReturnType<typeof citygmlSourceTx>>,jobId:string,tools=nullableCityGMLTools()):CityGMLInput{
  return CityGMLInputSchema.parse({version:CITYGML_VERSION,jobId,caseId:ctx.current.id,
    caseRevision:ctx.current.revision,caseContextSha256:ctx.context,sourceId:ctx.source.id,
    sourceFamilyId:ctx.source.family_id,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,
    sourceBytes:Number(ctx.source.bytes),objectKey:ctx.source.object_key,subject:ctx.binding.subject,
    accessSha256:ctx.binding.access,readerSha256:citygmlReaderSha(),tools});
}
export async function assertCityGMLInputTx(client:PoolClient,input:CityGMLInput,lock=false){
  const ctx=await citygmlSourceTx(client,input.caseId,input.sourceId,lock);
  if(!ctx.latest||!compareSourcePins(citygmlInput(ctx,input.jobId,input.tools),input).current)
    conflict('The CityGML original, case, reader or private access context changed. Retry under current pins.');
  return ctx;
}
async function enqueueTx(client:PoolClient,ctx:Awaited<ReturnType<typeof citygmlSourceTx>>){
  if(!ctx.latest)conflict('This CityGML source has a newer retained revision.');
  const jobs=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE source_id=$1 AND operation='citygml-native'",[ctx.source.id])).rows[0].n);
  if(jobs>=CITYGML_LIMITS.jobsPerSource)throw new AppError(429,'CITYGML_HISTORY_LIMIT','The bounded inspection history for this source is full.');
  const active=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE operation='citygml-native' AND status IN ('queued','running')")).rows[0].n);
  if(active>=CITYGML_LIMITS.active)throw new AppError(429,'CITYGML_WORKER_BUSY','The bounded CityGML workers are occupied.');
  const jobId=randomUUID(),input=citygmlInput(ctx,jobId),inputHash=fingerprint(input);
  await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'citygml-native',$4,$5,$6)",
    [jobId,ctx.current.id,ctx.source.id,ctx.current.revision,inputHash,input]);
  await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:ctx.current.id,version:ctx.current.revision+1},ctx.source.id,inputHash);
  await appendCaseIngestionTx(client,ctx.current.id,{kind:'citygml-native.changed',sourceId:ctx.source.id,
    sourceRevision:ctx.source.revision,jobId,status:'queued'},ctx.binding.subject);
  return jobId;
}
export function citygmlResultBytes(asset:{assetId:string},jobId:string){
  const match=new RegExp(`^citygml:${jobId}:([1-9][0-9]{0,5})$`).exec(asset.assetId),size=Number(match?.[1]);
  if(!match||size>CITYGML_LIMITS.resultBytes)throw new AppError(422,'CITYGML_RESULT_INTEGRITY','Stored CityGML result byte pin is invalid.');
  return size;
}
export async function readCityGMLResult(input:CityGMLInput,hash:string,size:number,signal?:AbortSignal):Promise<CityGMLResult>{
  if(size>CITYGML_LIMITS.resultBytes)throw new AppError(422,'CITYGML_RESULT_INTEGRITY','Stored CityGML result exceeds its receipt.');
  const bytes=await boundedCityGMLObject(citygmlResultKey(input.jobId,hash),size,signal);
  if(bytes.length>CITYGML_LIMITS.resultBytes||sha256(bytes)!==hash)
    throw new AppError(422,'CITYGML_RESULT_INTEGRITY','The private inspection receipt failed its hash or size check.');
  const result=CityGMLResultSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==citygmlArtifactKey(input.jobId,result.artifact.sha256))
    throw new AppError(422,'CITYGML_RESULT_SCOPE','The inspection receipt belongs to another original or job.');
  return result;
}
export async function citygmlStatusTx(client:PoolClient,caseId:string,sourceId:string,jobId:string,lock=false){
  const ctx=await citygmlSourceTx(client,caseId,sourceId,lock);
  const job=(await client.query(`SELECT j.*,m.result_ref,m.input_sha256,m.logical_state,m.accepted_fence,
    a.state attempt_state,a.fence attempt_fence,a.input_sha256 attempt_input_sha256,a.completion_sha256
    FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id LEFT JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence
    WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='citygml-native'${lock?' FOR SHARE OF j,m':''}`,[jobId,caseId,sourceId])).rows[0]??notFound('CityGML inspection job not found.');
  const input=CityGMLInputSchema.parse(job.payload);
  assertCityGMLJobRow(job,input);
  if(job.status==='succeeded')assertCityGMLJobRow(job,input,true);
  let stale=false;try{await assertCityGMLInputTx(client,input,lock);}catch(error){if(error instanceof AppError&&error.status===409)stale=true;else throw error;}
  return {ctx,job,input,stale};
}
function deadline(ms:number):DbDeadline{return {deadlineAt:Date.now()+ms,signal:AbortSignal.timeout(ms)};}
async function retainAttempt<T>(sourceId:string,key:string,action:()=>Promise<T>){
  try{return await action();}catch(error){
    // An ambiguous COMMIT preserves the original for authoritative recovery.
    if(!(error instanceof DbCommitOutcomeUnknown))try{
      const bounds=deadline(2000),saved=await query('SELECT id FROM sources WHERE id=$1',[sourceId],bounds);
      if(!saved.rows.length)await removeOrphan(key,bounds.signal);
    }catch{/* Uncertain ownership keeps bytes; never delete a possibly saved original. */}
    throw error;
  }
}
export class CityGMLIngestionService{
  async retain(caseValue:string,raw:unknown,file:{name:string;bytes:Uint8Array},bounds:DbDeadline=deadline(CITYGML_LIMITS.requestMs)){
    const caseId=uuid.parse(caseValue),request=CityGMLRetainSchema.parse(raw),hash=sha256(file.bytes);
    if(!z.string().min(1).max(150).regex(/^[^\\/\u0000-\u001f]+$/).safeParse(file.name).success)
      throw new AppError(422,'CITYGML_FILENAME','Use a bounded plain filename without path separators or control characters.');
    if(!file.bytes.length||file.bytes.length>CITYGML_LIMITS.originalBytes)
      throw new AppError(413,'CITYGML_ORIGINAL_SIZE','Retain a nonempty original of at most 32 MiB. No bytes were truncated.');
    // Retain bounded bytes first; native content parsing, not filename, owns format recognition.
    const sourceId=randomUUID(),key=`sources/${sourceId}/${hash}`,operationKey=`citygml-retain:${request.requestKey}`;
    return retainAttempt(sourceId,key,()=>transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('citygml-native-admission-v1',0))");
      const binding=ingestionBinding(caseId);
      const current=(await client.query('SELECT id,revision,archived FROM cases WHERE id=$1 FOR UPDATE',[caseId])).rows[0]??notFound('Source case not found.');
      if(current.archived)throw new AppError(403,'CITYGML_DENIED','This source case is archived.');
      const digest=fingerprint({request,hash,name:file.name,subject:binding.subject,access:binding.access});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='citygml-retain'",[caseId,operationKey])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names different CityGML bytes or lineage.');
        const receipt=CityGMLRetainReceiptSchema.parse(prior.result);
        const priorRow=await citygmlStatusTx(client,caseId,receipt.sourceId,receipt.jobId);
        if(priorRow.stale)conflict('The CityGML receipt context changed; use a new explicit request.');return receipt;}
      if(current.revision!==request.expectedCaseRevision)conflict('The source case changed before CityGML receipt.');
      const budget=(await client.query("SELECT count(*)::int sources,coalesce(sum(bytes),0)::text bytes FROM sources WHERE profile='citygml-native-v1'")).rows[0];
      if(Number(budget.sources)>=CITYGML_LIMITS.retainedSources||Number(budget.bytes)+file.bytes.length>CITYGML_LIMITS.retainedBytes)
        throw new AppError(429,'CITYGML_RETENTION_BUDGET','The finite retained CityGML source budget is full; existing originals remain available.');
      const original=CityGMLOriginalSchema.parse({version:CITYGML_VERSION,subject:binding.subject,
        accessSha256:binding.access,sha256:hash,bytes:file.bytes.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage:request.lineage});
      await putOriginal(key,file.bytes,'application/octet-stream',bounds.signal);
      assertIngestionBinding(binding);
      await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection)
        VALUES($1,$2,$1,1,$3,'citygml-native-v1','application/octet-stream',$4,$5,$6,'received',$7)`,
        [sourceId,caseId,file.name,file.bytes.length,hash,key,{profile:'citygml-native-v1',status:'needs_input',issues:[],
          summary:'Unchanged source bytes retained; a bounded native CityGML metadata read is queued.',citygmlOriginal:original}]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const ctx=await citygmlSourceTx(client,caseId,sourceId),jobId=await enqueueTx(client,ctx);
      const receipt=CityGMLRetainReceiptSchema.parse({version:CITYGML_VERSION,caseId,caseRevision:ctx.current.revision,
        sourceId,sourceRevision:1,sourceSha256:hash,bytes:file.bytes.length,jobId});
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'citygml-retain',$3,$4)",[caseId,operationKey,digest,receipt]);
      return receipt;
    },bounds));
  }
  async enqueue(caseValue:string,sourceValue:string,raw:unknown,bounds:DbDeadline=deadline(CITYGML_LIMITS.requestMs)){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),request=CityGMLRequestSchema.parse(raw);
    return transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('citygml-native-admission-v1',0))");
      const ctx=await citygmlSourceTx(client,caseId,sourceId,true),key=`citygml-native:${request.requestKey}`,
        digest=fingerprint({request,caseId,sourceId,access:ctx.binding.access,readerSha256:citygmlReaderSha()});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='citygml-native'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names a different CityGML inspection.');
        const receipt=CityGMLQueueReceiptSchema.parse(prior.result),row=await citygmlStatusTx(client,caseId,sourceId,receipt.jobId);
        if(row.stale)conflict('The explicit CityGML retry context changed.');return receipt;}
      if(!ctx.latest||ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision||ctx.source.sha256!==request.sourceSha256)
        conflict('Pin the current case and retained CityGML before requesting a inspection.');
      const jobId=await enqueueTx(client,ctx),receipt={version:CITYGML_VERSION,caseId,sourceId,jobId};
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'citygml-native',$3,$4)",[caseId,key,digest,receipt]);
      return receipt;
    },bounds);
  }
  async status(caseValue:string,sourceValue:string,jobValue:string){
    const bounds=deadline(CITYGML_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>citygmlStatusTx(client,caseId,sourceId,jobId),bounds);
    if(!row.stale&&row.job.status==='succeeded')assertCityGMLReadTools(row.input.tools,bounds.deadlineAt);
    const result=!row.stale&&row.job.status==='succeeded'&&row.job.result_ref
      ?await readCityGMLResult(row.input,row.job.result_ref.sha256,citygmlResultBytes(row.job.result_ref,jobId),bounds.signal):null;
    await transaction(async client=>{const current=await citygmlStatusTx(client,caseId,sourceId,jobId);
      if(fingerprint(current.input)!==fingerprint(row.input)||current.stale!==row.stale||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.status!==row.job.status)
        conflict('CityGML job changed while reading its status.');},bounds);
    if(result)assertCityGMLReadTools(row.input.tools,bounds.deadlineAt);
    const response=CityGMLStatusSchema.parse({version:CITYGML_VERSION,caseId,sourceId,jobId,
      currentCaseRevision:row.ctx.current.revision,sourceRevision:row.ctx.source.revision,sourceSha256:row.ctx.source.sha256,
      status:row.stale?'stale':result?result.summary.status==='available'?'completed':result.summary.status:row.job.status,
      code:row.stale?'CITYGML_INPUT_STALE':(row.job.error?( /^CITYGML_[A-Z_]{1,60}$/.test(row.job.error)?row.job.error:'CITYGML_JOB_FAILED'):null),
      result:result?{summary:result.summary,artifact:result.artifact,createdAt:result.createdAt}:null});
    if(Buffer.byteLength(JSON.stringify(response))>CITYGML_LIMITS.statusBytes)
      throw new AppError(413,'CITYGML_STATUS_LIMIT','Private status exceeds its bounded response profile.');
    return response;
  }
  async artifact(caseValue:string,sourceValue:string,jobValue:string){
    const bounds=deadline(CITYGML_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>citygmlStatusTx(client,caseId,sourceId,jobId),bounds);
    if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
      throw new AppError(409,'CITYGML_NOT_ACCEPTED','This inspection has no current accepted artifact.');
    assertCityGMLReadTools(row.input.tools,bounds.deadlineAt);
    const result=await readCityGMLResult(row.input,row.job.result_ref.sha256,citygmlResultBytes(row.job.result_ref,jobId),bounds.signal);
    const bytes=await boundedCityGMLObject(result.artifact.key,result.artifact.bytes,bounds.signal);
    if(bytes.length!==result.artifact.bytes||sha256(bytes)!==result.artifact.sha256)
      throw new AppError(422,'CITYGML_ARTIFACT_INTEGRITY','The private native CityGML records differ from their accepted receipt.');
    await transaction(async client=>{const current=await citygmlStatusTx(client,caseId,sourceId,jobId);
      if(current.stale||fingerprint(current.input)!==fingerprint(row.input)||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.accepted_fence!==row.job.accepted_fence)
        conflict('The accepted CityGML attempt changed during artifact read.');},bounds);
    assertCityGMLReadTools(row.input.tools,bounds.deadlineAt);
    return {bytes,sha256:result.artifact.sha256};
  }
  async original(caseValue:string,sourceValue:string){
    const bounds=deadline(CITYGML_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue);
    const ctx=await transaction(client=>citygmlSourceTx(client,caseId,sourceId),bounds);
    if(!ctx.latest)conflict('This original has a newer source revision.');
    const bytes=await boundedCityGMLObject(ctx.source.object_key,Number(ctx.source.bytes),bounds.signal);
    if(sha256(bytes)!==ctx.source.sha256)
      throw new AppError(422,'CITYGML_SOURCE_INTEGRITY','Retained original differs from its immutable source receipt.');
    await transaction(async client=>{const current=await citygmlSourceTx(client,caseId,sourceId);
      if(!current.latest||!compareSourcePins({caseRevision:current.current.revision},{caseRevision:ctx.current.revision}).current
        ||current.context!==ctx.context||
        current.source.sha256!==ctx.source.sha256||current.source.revision!==ctx.source.revision||
        current.source.object_key!==ctx.source.object_key||Number(current.source.bytes)!==Number(ctx.source.bytes))
        conflict('The original changed during download.');},bounds);
    return {bytes,name:ctx.source.name,mimeType:'application/octet-stream',sha256:ctx.source.sha256};
  }
}
