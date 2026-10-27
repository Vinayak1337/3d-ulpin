import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {GLTF_VERSION,GLTF_LIMITS,GltfRetainSchema,GltfRequestSchema,
  GltfOriginalSchema,GltfInputSchema,GltfResultSchema,GltfStatusSchema,GltfRetainReceiptSchema,GltfQueueReceiptSchema,
  type GltfInput,type GltfResult} from '../../../../../contracts/src/usp/gltf-ingestion';
import {transaction,query,DbCommitOutcomeUnknown,type DbDeadline} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,openObjectStream,removeOrphan,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {compareSourcePins} from './source-pin';
import {registerUspJobInputTx} from '../jobs';
import {gltfConfig,assertGltfReadTools} from './gltf-config';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {appendCaseIngestionTx,ingestionBinding,assertIngestionBinding} from './events';

const uuid=z.uuid().transform(value=>value.toLowerCase());
/** A present malformed/null marker is protected, never a legacy fallback. */
export function isGltfProtectedSource(source:{profile?:unknown;inspection?:unknown}){
  return source.profile==='gltf-native-v1'||Boolean(source.inspection&&typeof source.inspection==='object'
    &&Object.prototype.hasOwnProperty.call(source.inspection,'gltfOriginal'));
}
export const gltfReaderSha=()=>sha256(Buffer.concat(['services/geo/geo/native_gltf.py','scripts/usp/desktop-gltf-read.py'].flatMap(file=>[Buffer.from(file+'\0'),readFileSync(join(settings.repositoryRoot,file))])));
export const gltfResultKey=(jobId:string,hash:string)=>`gltf-native/${jobId}/${hash}.json`;
export const gltfArtifactKey=(jobId:string,hash:string)=>`gltf-native/${jobId}/${hash}.native.json`;

/** Exact object length is enforced before collecting a bounded original/artifact. */
export async function boundedGltfObject(key:string,size:number,signal?:AbortSignal){
  const cap=key.startsWith('sources/')?GLTF_LIMITS.originalBytes:GLTF_LIMITS.artifactBytes;
  if(!Number.isSafeInteger(size)||size<1||size>cap)
    throw new AppError(422,'GLTF_OBJECT_LIMIT','Stored Gltf object exceeds its private profile.');
  const {body}=await openObjectStream(key,size,30_000,undefined,signal),parts:Buffer[]=[];let total=0;
  try{for await(const part of body){const bytes=Buffer.from(part);total+=bytes.length;
    if(total>size)throw new AppError(422,'GLTF_OBJECT_LIMIT','Stored object exceeds its receipt.');parts.push(bytes);}
    if(total!==size)throw new AppError(422,'GLTF_OBJECT_INTEGRITY','Stored object ended before its receipt.');
    return Buffer.concat(parts,total);
  }finally{body.destroy();}
}

/** Pin the stored payload and accepted attempt, not merely job.status. */
export function assertGltfJobRow(job:Record<string,any>,input:GltfInput,accepted=false){
  const digest=fingerprint(input);
  if(job.id!==input.jobId||job.operation!=='gltf-native'||job.case_id!==input.caseId||job.source_id!==input.sourceId
    ||job.case_revision!==input.caseRevision||job.input_fingerprint!==digest||job.input_sha256!==digest
    ||fingerprint(job.payload)!==digest)
    throw new AppError(422,'GLTF_JOB_INTEGRITY','Stored job does not match its source-bound input.');
  if(accepted&&(job.status!=='succeeded'||job.logical_state!=='succeeded'||!job.result_ref
    ||!new RegExp(`^gltf:${input.jobId}:[1-9][0-9]{0,5}$`).test(job.result_ref.assetId)||job.result_ref.version!==1
    ||job.attempt_state!=='accepted'||Number(job.attempt_fence)!==Number(job.accepted_fence)
    ||job.attempt_input_sha256!==digest||job.completion_sha256!==job.result_ref.sha256))
    conflict('No exact accepted Gltf attempt is available.');
}

export async function gltfSourceTx(client:PoolClient,caseId:string,sourceId:string,lock=false){
  if(lock)await lockSourceCaseDestinationTx(client,caseId);
  const binding=ingestionBinding(caseId);
  const current=(await client.query(`SELECT id,revision,archived,frame,context,site_id FROM cases WHERE id=$1${lock?' FOR SHARE':''}`,[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'GLTF_DENIED','This source case is archived.');
  const source=(await client.query(`SELECT * FROM sources WHERE case_id=$1 AND id=$2${lock?' FOR SHARE':''}`,[caseId,sourceId])).rows[0]??notFound('Gltf source not found in this case.');
  const original=GltfOriginalSchema.safeParse(source.inspection?.gltfOriginal);
  if(source.profile!=='gltf-native-v1'||!original.success||original.data.subject!==binding.subject||original.data.accessSha256!==binding.access)
    throw new AppError(403,'GLTF_DENIED','This retained Gltf is unavailable to the current local context.');
  if(original.data.sha256!==source.sha256||original.data.bytes!==Number(source.bytes)||source.object_key!==`sources/${sourceId}/${source.sha256}`)
    throw new AppError(422,'GLTF_SOURCE_INTEGRITY','The Gltf receipt differs from its canonical source.');
  const latest=Number((await client.query('SELECT max(revision) revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision)===source.revision;
  assertIngestionBinding(binding);
  return {current,source,binding,latest,context:fingerprint({frame:current.frame,context:current.context,siteId:current.site_id})};
}
export function nullableGltfTools(){try{return gltfConfig().pins;}catch(error){if(error instanceof AppError&&error.status===503)return null;throw error;}}
export function gltfInput(ctx:Awaited<ReturnType<typeof gltfSourceTx>>,jobId:string,tools=nullableGltfTools(),sceneIndex:number|null=null):GltfInput{
  return GltfInputSchema.parse({version:GLTF_VERSION,jobId,caseId:ctx.current.id,
    caseRevision:ctx.current.revision,caseContextSha256:ctx.context,sourceId:ctx.source.id,
    sourceFamilyId:ctx.source.family_id,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,
    sourceBytes:Number(ctx.source.bytes),objectKey:ctx.source.object_key,subject:ctx.binding.subject,
    accessSha256:ctx.binding.access,readerSha256:gltfReaderSha(),tools,sceneIndex});
}
export async function assertGltfInputTx(client:PoolClient,input:GltfInput,lock=false){
  const ctx=await gltfSourceTx(client,input.caseId,input.sourceId,lock);
  if(!ctx.latest||!compareSourcePins(gltfInput(ctx,input.jobId,input.tools,input.sceneIndex),input).current)
    conflict('The Gltf original, case, reader or private access context changed. Retry under current pins.');
  return ctx;
}
async function enqueueTx(client:PoolClient,ctx:Awaited<ReturnType<typeof gltfSourceTx>>,sceneIndex:number|null){
  if(!ctx.latest)conflict('This Gltf source has a newer retained revision.');
  const jobs=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE source_id=$1 AND operation='gltf-native'",[ctx.source.id])).rows[0].n);
  if(jobs>=GLTF_LIMITS.jobsPerSource)throw new AppError(429,'GLTF_HISTORY_LIMIT','The bounded inspection history for this source is full.');
  const active=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE operation='gltf-native' AND status IN ('queued','running')")).rows[0].n);
  if(active>=GLTF_LIMITS.active)throw new AppError(429,'GLTF_WORKER_BUSY','The bounded Gltf workers are occupied.');
  const jobId=randomUUID(),input=gltfInput(ctx,jobId,nullableGltfTools(),sceneIndex),inputHash=fingerprint(input);
  await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'gltf-native',$4,$5,$6)",
    [jobId,ctx.current.id,ctx.source.id,ctx.current.revision,inputHash,input]);
  await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:ctx.current.id,version:ctx.current.revision+1},ctx.source.id,inputHash);
  await appendCaseIngestionTx(client,ctx.current.id,{kind:'gltf-native.changed',sourceId:ctx.source.id,
    sourceRevision:ctx.source.revision,jobId,status:'queued'},ctx.binding.subject);
  return jobId;
}
export function gltfResultBytes(asset:{assetId:string},jobId:string){
  const match=new RegExp(`^gltf:${jobId}:([1-9][0-9]{0,5})$`).exec(asset.assetId),size=Number(match?.[1]);
  if(!match||size>GLTF_LIMITS.resultBytes)throw new AppError(422,'GLTF_RESULT_INTEGRITY','Stored Gltf result byte pin is invalid.');
  return size;
}
export async function readGltfResult(input:GltfInput,hash:string,size:number,signal?:AbortSignal):Promise<GltfResult>{
  if(size>GLTF_LIMITS.resultBytes)throw new AppError(422,'GLTF_RESULT_INTEGRITY','Stored Gltf result exceeds its receipt.');
  const bytes=await boundedGltfObject(gltfResultKey(input.jobId,hash),size,signal);
  if(bytes.length>GLTF_LIMITS.resultBytes||sha256(bytes)!==hash)
    throw new AppError(422,'GLTF_RESULT_INTEGRITY','The private inspection receipt failed its hash or size check.');
  const result=GltfResultSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==gltfArtifactKey(input.jobId,result.artifact.sha256))
    throw new AppError(422,'GLTF_RESULT_SCOPE','The inspection receipt belongs to another original or job.');
  return result;
}
export async function gltfStatusTx(client:PoolClient,caseId:string,sourceId:string,jobId:string,lock=false){
  const ctx=await gltfSourceTx(client,caseId,sourceId,lock);
  const job=(await client.query(`SELECT j.*,m.result_ref,m.input_sha256,m.logical_state,m.accepted_fence,
    a.state attempt_state,a.fence attempt_fence,a.input_sha256 attempt_input_sha256,a.completion_sha256
    FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id LEFT JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence
    WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='gltf-native'${lock?' FOR SHARE OF j,m':''}`,[jobId,caseId,sourceId])).rows[0]??notFound('Gltf inspection job not found.');
  const input=GltfInputSchema.parse(job.payload);
  assertGltfJobRow(job,input);
  if(job.status==='succeeded')assertGltfJobRow(job,input,true);
  let stale=false;try{await assertGltfInputTx(client,input,lock);}catch(error){if(error instanceof AppError&&error.status===409)stale=true;else throw error;}
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
export class GltfIngestionService{
  async retain(caseValue:string,raw:unknown,file:{name:string;bytes:Uint8Array},bounds:DbDeadline=deadline(GLTF_LIMITS.requestMs)){
    const caseId=uuid.parse(caseValue),request=GltfRetainSchema.parse(raw),hash=sha256(file.bytes);
    if(!z.string().min(1).max(150).regex(/^[^\\/\u0000-\u001f]+$/).safeParse(file.name).success)
      throw new AppError(422,'GLTF_FILENAME','Use a bounded plain filename without path separators or control characters.');
    if(!file.bytes.length||file.bytes.length>GLTF_LIMITS.originalBytes)
      throw new AppError(413,'GLTF_ORIGINAL_SIZE','Retain a nonempty original of at most 16 MiB. No bytes were truncated.');
    // Retain bounded bytes first; native content parsing, not filename, owns format recognition.
    const sourceId=randomUUID(),key=`sources/${sourceId}/${hash}`,operationKey=`gltf-retain:${request.requestKey}`;
    return retainAttempt(sourceId,key,()=>transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('gltf-native-admission-v1',0))");
      const binding=ingestionBinding(caseId);
      const current=(await client.query('SELECT id,revision,archived FROM cases WHERE id=$1 FOR UPDATE',[caseId])).rows[0]??notFound('Source case not found.');
      if(current.archived)throw new AppError(403,'GLTF_DENIED','This source case is archived.');
      const digest=fingerprint({request,hash,name:file.name,subject:binding.subject,access:binding.access});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='gltf-retain'",[caseId,operationKey])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names different Gltf bytes or lineage.');
        const receipt=GltfRetainReceiptSchema.parse(prior.result);
        const priorRow=await gltfStatusTx(client,caseId,receipt.sourceId,receipt.jobId);
        if(priorRow.stale)conflict('The Gltf receipt context changed; use a new explicit request.');return receipt;}
      if(current.revision!==request.expectedCaseRevision)conflict('The source case changed before Gltf receipt.');
      const budget=(await client.query("SELECT count(*)::int sources,coalesce(sum(bytes),0)::text bytes FROM sources WHERE profile='gltf-native-v1'")).rows[0];
      if(Number(budget.sources)>=GLTF_LIMITS.retainedSources||Number(budget.bytes)+file.bytes.length>GLTF_LIMITS.retainedBytes)
        throw new AppError(429,'GLTF_RETENTION_BUDGET','The finite retained Gltf source budget is full; existing originals remain available.');
      const original=GltfOriginalSchema.parse({version:GLTF_VERSION,subject:binding.subject,
        accessSha256:binding.access,sha256:hash,bytes:file.bytes.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage:request.lineage});
      await putOriginal(key,file.bytes,'application/octet-stream',bounds.signal);
      assertIngestionBinding(binding);
      await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection)
        VALUES($1,$2,$1,1,$3,'gltf-native-v1','application/octet-stream',$4,$5,$6,'received',$7)`,
        [sourceId,caseId,file.name,file.bytes.length,hash,key,{profile:'gltf-native-v1',status:'needs_input',issues:[],
          summary:'Unchanged source bytes retained; a bounded native Gltf metadata read is queued.',gltfOriginal:original}]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const ctx=await gltfSourceTx(client,caseId,sourceId),jobId=await enqueueTx(client,ctx,request.sceneIndex??null);
      const receipt=GltfRetainReceiptSchema.parse({version:GLTF_VERSION,caseId,caseRevision:ctx.current.revision,
        sourceId,sourceRevision:1,sourceSha256:hash,bytes:file.bytes.length,jobId});
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'gltf-retain',$3,$4)",[caseId,operationKey,digest,receipt]);
      return receipt;
    },bounds));
  }
  async enqueue(caseValue:string,sourceValue:string,raw:unknown,bounds:DbDeadline=deadline(GLTF_LIMITS.requestMs)){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),request=GltfRequestSchema.parse(raw);
    return transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('gltf-native-admission-v1',0))");
      const ctx=await gltfSourceTx(client,caseId,sourceId,true),key=`gltf-native:${request.requestKey}`,
        digest=fingerprint({request,caseId,sourceId,access:ctx.binding.access,readerSha256:gltfReaderSha()});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='gltf-native'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names a different Gltf inspection.');
        const receipt=GltfQueueReceiptSchema.parse(prior.result),row=await gltfStatusTx(client,caseId,sourceId,receipt.jobId);
        if(row.stale)conflict('The explicit Gltf retry context changed.');return receipt;}
      if(!ctx.latest||ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision||ctx.source.sha256!==request.sourceSha256)
        conflict('Pin the current case and retained Gltf before requesting a inspection.');
      const jobId=await enqueueTx(client,ctx,request.sceneIndex??null),receipt={version:GLTF_VERSION,caseId,sourceId,jobId};
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'gltf-native',$3,$4)",[caseId,key,digest,receipt]);
      return receipt;
    },bounds);
  }
  async status(caseValue:string,sourceValue:string,jobValue:string){
    const bounds=deadline(GLTF_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>gltfStatusTx(client,caseId,sourceId,jobId),bounds);
    if(!row.stale&&row.job.status==='succeeded')assertGltfReadTools(row.input.tools,bounds.deadlineAt);
    const result=!row.stale&&row.job.status==='succeeded'&&row.job.result_ref
      ?await readGltfResult(row.input,row.job.result_ref.sha256,gltfResultBytes(row.job.result_ref,jobId),bounds.signal):null;
    await transaction(async client=>{const current=await gltfStatusTx(client,caseId,sourceId,jobId);
      if(fingerprint(current.input)!==fingerprint(row.input)||current.stale!==row.stale||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.status!==row.job.status)
        conflict('Gltf job changed while reading its status.');},bounds);
    if(result)assertGltfReadTools(row.input.tools,bounds.deadlineAt);
    const response=GltfStatusSchema.parse({version:GLTF_VERSION,caseId,sourceId,jobId,
      currentCaseRevision:row.ctx.current.revision,sourceRevision:row.ctx.source.revision,sourceSha256:row.ctx.source.sha256,
      status:row.stale?'stale':result?result.summary.status==='inspected_local'?'completed':'partial':row.job.status,
      code:row.stale?'GLTF_INPUT_STALE':(row.job.error?( /^GLTF_[A-Z_]{1,60}$/.test(row.job.error)?row.job.error:'GLTF_JOB_FAILED'):null),
      result:result?{summary:result.summary,artifact:result.artifact,createdAt:result.createdAt}:null});
    if(Buffer.byteLength(JSON.stringify(response))>GLTF_LIMITS.statusBytes)
      throw new AppError(413,'GLTF_STATUS_LIMIT','Private status exceeds its bounded response profile.');
    return response;
  }
  async artifact(caseValue:string,sourceValue:string,jobValue:string){
    const bounds=deadline(GLTF_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>gltfStatusTx(client,caseId,sourceId,jobId),bounds);
    if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
      throw new AppError(409,'GLTF_NOT_ACCEPTED','This inspection has no current accepted artifact.');
    assertGltfReadTools(row.input.tools,bounds.deadlineAt);
    const result=await readGltfResult(row.input,row.job.result_ref.sha256,gltfResultBytes(row.job.result_ref,jobId),bounds.signal);
    const bytes=await boundedGltfObject(result.artifact.key,result.artifact.bytes,bounds.signal);
    if(bytes.length!==result.artifact.bytes||sha256(bytes)!==result.artifact.sha256)
      throw new AppError(422,'GLTF_ARTIFACT_INTEGRITY','The private native Gltf records differ from their accepted receipt.');
    await transaction(async client=>{const current=await gltfStatusTx(client,caseId,sourceId,jobId);
      if(current.stale||fingerprint(current.input)!==fingerprint(row.input)||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.accepted_fence!==row.job.accepted_fence)
        conflict('The accepted Gltf attempt changed during artifact read.');},bounds);
    assertGltfReadTools(row.input.tools,bounds.deadlineAt);
    return {bytes,sha256:result.artifact.sha256};
  }
  async original(caseValue:string,sourceValue:string){
    const bounds=deadline(GLTF_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue);
    const ctx=await transaction(client=>gltfSourceTx(client,caseId,sourceId),bounds);
    if(!ctx.latest)conflict('This original has a newer source revision.');
    const bytes=await boundedGltfObject(ctx.source.object_key,Number(ctx.source.bytes),bounds.signal);
    if(sha256(bytes)!==ctx.source.sha256)
      throw new AppError(422,'GLTF_SOURCE_INTEGRITY','Retained original differs from its immutable source receipt.');
    await transaction(async client=>{const current=await gltfSourceTx(client,caseId,sourceId);
      if(!current.latest||!compareSourcePins({caseRevision:current.current.revision},{caseRevision:ctx.current.revision}).current
        ||current.context!==ctx.context||
        current.source.sha256!==ctx.source.sha256||current.source.revision!==ctx.source.revision||
        current.source.object_key!==ctx.source.object_key||Number(current.source.bytes)!==Number(ctx.source.bytes))
        conflict('The original changed during download.');},bounds);
    return {bytes,name:ctx.source.name,mimeType:'application/octet-stream',sha256:ctx.source.sha256};
  }
}
