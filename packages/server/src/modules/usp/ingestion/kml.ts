import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {KML_VERSION,KML_LIMITS,KMLRetainSchema,KMLRequestSchema,
  KMLOriginalSchema,KMLInputSchema,KMLResultSchema,KMLStatusSchema,KMLRetainReceiptSchema,KMLQueueReceiptSchema,
  type KMLInput,type KMLResult} from '../../../../../contracts/src/usp/kml-ingestion';
import {transaction,query,DbCommitOutcomeUnknown,type DbDeadline} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,openObjectStream,removeOrphan,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {registerUspJobInputTx} from '../jobs';
import {kmlConfig,assertKMLTools} from './kml-config';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {appendCaseIngestionTx,ingestionBinding,assertIngestionBinding} from './events';

const uuid=z.uuid().transform(value=>value.toLowerCase());
/** A present malformed/null marker is protected, never a legacy fallback. */
export function isKMLProtectedSource(source:{profile?:unknown;inspection?:unknown}){
  return source.profile==='kml-native-v1'||Boolean(source.inspection&&typeof source.inspection==='object'
    &&Object.prototype.hasOwnProperty.call(source.inspection,'kmlOriginal'));
}
export const kmlReaderSha=()=>sha256(Buffer.concat(['services/geo/geo/native_kml.py','scripts/usp/desktop-kml-read.py'].flatMap(file=>[Buffer.from(file+'\0'),readFileSync(join(settings.repositoryRoot,file))])));
export const kmlResultKey=(jobId:string,hash:string)=>`kml-native/${jobId}/${hash}.json`;
export const kmlArtifactKey=(jobId:string,hash:string)=>`kml-native/${jobId}/${hash}.native.json`;

/** Exact object length is enforced before collecting a bounded original/artifact. */
export async function boundedKMLObject(key:string,size:number,signal?:AbortSignal){
  const cap=key.startsWith('sources/')?KML_LIMITS.originalBytes:KML_LIMITS.artifactBytes;
  if(!Number.isSafeInteger(size)||size<1||size>cap)
    throw new AppError(422,'KML_OBJECT_LIMIT','Stored KML object exceeds its private profile.');
  const {body}=await openObjectStream(key,size,30_000,undefined,signal),parts:Buffer[]=[];let total=0;
  try{for await(const part of body){const bytes=Buffer.from(part);total+=bytes.length;
    if(total>size)throw new AppError(422,'KML_OBJECT_LIMIT','Stored object exceeds its receipt.');parts.push(bytes);}
    if(total!==size)throw new AppError(422,'KML_OBJECT_INTEGRITY','Stored object ended before its receipt.');
    return Buffer.concat(parts,total);
  }finally{body.destroy();}
}

/** Pin the stored payload and accepted attempt, not merely job.status. */
export function assertKMLJobRow(job:Record<string,any>,input:KMLInput,accepted=false){
  const digest=fingerprint(input);
  if(job.id!==input.jobId||job.operation!=='kml-native'||job.case_id!==input.caseId||job.source_id!==input.sourceId
    ||job.case_revision!==input.caseRevision||job.input_fingerprint!==digest||job.input_sha256!==digest
    ||fingerprint(job.payload)!==digest)
    throw new AppError(422,'KML_JOB_INTEGRITY','Stored job does not match its source-bound input.');
  if(accepted&&(job.status!=='succeeded'||job.logical_state!=='succeeded'||!job.result_ref
    ||!new RegExp(`^kml:${input.jobId}:[1-9][0-9]{0,5}$`).test(job.result_ref.assetId)||job.result_ref.version!==1
    ||job.attempt_state!=='accepted'||Number(job.attempt_fence)!==Number(job.accepted_fence)
    ||job.attempt_input_sha256!==digest||job.completion_sha256!==job.result_ref.sha256))
    conflict('No exact accepted KML attempt is available.');
}

export async function kmlSourceTx(client:PoolClient,caseId:string,sourceId:string,lock=false){
  if(lock)await lockSourceCaseDestinationTx(client,caseId);
  const binding=ingestionBinding(caseId);
  const current=(await client.query(`SELECT id,revision,archived,frame,context,site_id FROM cases WHERE id=$1${lock?' FOR SHARE':''}`,[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'KML_DENIED','This source case is archived.');
  const source=(await client.query(`SELECT * FROM sources WHERE case_id=$1 AND id=$2${lock?' FOR SHARE':''}`,[caseId,sourceId])).rows[0]??notFound('KML source not found in this case.');
  const original=KMLOriginalSchema.safeParse(source.inspection?.kmlOriginal);
  if(source.profile!=='kml-native-v1'||!original.success||original.data.subject!==binding.subject||original.data.accessSha256!==binding.access)
    throw new AppError(403,'KML_DENIED','This retained KML is unavailable to the current local context.');
  if(original.data.sha256!==source.sha256||original.data.bytes!==Number(source.bytes)||source.object_key!==`sources/${sourceId}/${source.sha256}`)
    throw new AppError(422,'KML_SOURCE_INTEGRITY','The KML receipt differs from its canonical source.');
  const latest=Number((await client.query('SELECT max(revision) revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision)===source.revision;
  assertIngestionBinding(binding);
  return {current,source,binding,latest,context:fingerprint({frame:current.frame,context:current.context,siteId:current.site_id})};
}
export function nullableKMLTools(){try{return kmlConfig().pins;}catch(error){if(error instanceof AppError&&error.status===503)return null;throw error;}}
export function kmlInput(ctx:Awaited<ReturnType<typeof kmlSourceTx>>,jobId:string,selection:KMLInput['selection'],tools=nullableKMLTools()):KMLInput{
  return KMLInputSchema.parse({version:KML_VERSION,jobId,caseId:ctx.current.id,
    caseRevision:ctx.current.revision,caseContextSha256:ctx.context,sourceId:ctx.source.id,
    sourceFamilyId:ctx.source.family_id,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,
    sourceBytes:Number(ctx.source.bytes),objectKey:ctx.source.object_key,subject:ctx.binding.subject,
    accessSha256:ctx.binding.access,readerSha256:kmlReaderSha(),tools,selection});
}
export async function assertKMLInputTx(client:PoolClient,input:KMLInput,lock=false){
  const ctx=await kmlSourceTx(client,input.caseId,input.sourceId,lock);
  if(!ctx.latest||fingerprint(kmlInput(ctx,input.jobId,input.selection,input.tools))!==fingerprint(input))
    conflict('The KML original, case, reader or private access context changed. Retry under current pins.');
  return ctx;
}
async function enqueueTx(client:PoolClient,ctx:Awaited<ReturnType<typeof kmlSourceTx>>,selection:KMLInput['selection']){
  if(!ctx.latest)conflict('This KML source has a newer retained revision.');
  const jobs=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE source_id=$1 AND operation='kml-native'",[ctx.source.id])).rows[0].n);
  if(jobs>=KML_LIMITS.jobsPerSource)throw new AppError(429,'KML_HISTORY_LIMIT','The bounded selection history for this source is full.');
  const active=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE operation='kml-native' AND status IN ('queued','running')")).rows[0].n);
  if(active>=KML_LIMITS.active)throw new AppError(429,'KML_WORKER_BUSY','The bounded KML workers are occupied.');
  const jobId=randomUUID(),input=kmlInput(ctx,jobId,selection),inputHash=fingerprint(input);
  await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'kml-native',$4,$5,$6)",
    [jobId,ctx.current.id,ctx.source.id,ctx.current.revision,inputHash,input]);
  await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:ctx.current.id,version:ctx.current.revision+1},ctx.source.id,inputHash);
  await appendCaseIngestionTx(client,ctx.current.id,{kind:'kml-native.changed',sourceId:ctx.source.id,
    sourceRevision:ctx.source.revision,jobId,status:'queued'},ctx.binding.subject);
  return jobId;
}
export function kmlResultBytes(asset:{assetId:string},jobId:string){
  const match=new RegExp(`^kml:${jobId}:([1-9][0-9]{0,5})$`).exec(asset.assetId),size=Number(match?.[1]);
  if(!match||size>KML_LIMITS.resultBytes)throw new AppError(422,'KML_RESULT_INTEGRITY','Stored KML result byte pin is invalid.');
  return size;
}
export async function readKMLResult(input:KMLInput,hash:string,size:number,signal?:AbortSignal):Promise<KMLResult>{
  if(size>KML_LIMITS.resultBytes)throw new AppError(422,'KML_RESULT_INTEGRITY','Stored KML result exceeds its receipt.');
  const bytes=await boundedKMLObject(kmlResultKey(input.jobId,hash),size,signal);
  if(bytes.length>KML_LIMITS.resultBytes||sha256(bytes)!==hash)
    throw new AppError(422,'KML_RESULT_INTEGRITY','The private selection receipt failed its hash or size check.');
  const result=KMLResultSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==kmlArtifactKey(input.jobId,result.artifact.sha256))
    throw new AppError(422,'KML_RESULT_SCOPE','The selection receipt belongs to another original or job.');
  return result;
}
export async function kmlStatusTx(client:PoolClient,caseId:string,sourceId:string,jobId:string,lock=false){
  const ctx=await kmlSourceTx(client,caseId,sourceId,lock);
  const job=(await client.query(`SELECT j.*,m.result_ref,m.input_sha256,m.logical_state,m.accepted_fence,
    a.state attempt_state,a.fence attempt_fence,a.input_sha256 attempt_input_sha256,a.completion_sha256
    FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id LEFT JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence
    WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='kml-native'${lock?' FOR SHARE OF j,m':''}`,[jobId,caseId,sourceId])).rows[0]??notFound('KML selection job not found.');
  const input=KMLInputSchema.parse(job.payload);
  assertKMLJobRow(job,input);
  if(job.status==='succeeded')assertKMLJobRow(job,input,true);
  let stale=false;try{await assertKMLInputTx(client,input,lock);}catch(error){if(error instanceof AppError&&error.status===409)stale=true;else throw error;}
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
export class KMLIngestionService{
  async retain(caseValue:string,raw:unknown,file:{name:string;bytes:Uint8Array},bounds:DbDeadline=deadline(KML_LIMITS.requestMs)){
    const caseId=uuid.parse(caseValue),request=KMLRetainSchema.parse(raw),hash=sha256(file.bytes);
    if(!z.string().min(1).max(150).regex(/^[^\\/\u0000-\u001f]+$/).safeParse(file.name).success)
      throw new AppError(422,'KML_FILENAME','Use a bounded plain filename without path separators or control characters.');
    if(!file.bytes.length||file.bytes.length>KML_LIMITS.originalBytes)
      throw new AppError(413,'KML_ORIGINAL_SIZE','Retain a nonempty original of at most 16 MiB. No bytes were truncated.');
    // Retain bounded bytes first; native content parsing, not filename, owns format recognition.
    const sourceId=randomUUID(),key=`sources/${sourceId}/${hash}`,operationKey=`kml-retain:${request.requestKey}`;
    return retainAttempt(sourceId,key,()=>transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('kml-native-admission-v1',0))");
      const binding=ingestionBinding(caseId);
      const current=(await client.query('SELECT id,revision,archived FROM cases WHERE id=$1 FOR UPDATE',[caseId])).rows[0]??notFound('Source case not found.');
      if(current.archived)throw new AppError(403,'KML_DENIED','This source case is archived.');
      const digest=fingerprint({request,hash,name:file.name,subject:binding.subject,access:binding.access});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='kml-retain'",[caseId,operationKey])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names different KML bytes or lineage.');
        const receipt=KMLRetainReceiptSchema.parse(prior.result);
        const priorRow=await kmlStatusTx(client,caseId,receipt.sourceId,receipt.jobId);
        if(priorRow.stale)conflict('The KML receipt context changed; use a new explicit request.');return receipt;}
      if(current.revision!==request.expectedCaseRevision)conflict('The source case changed before KML receipt.');
      const budget=(await client.query("SELECT count(*)::int sources,coalesce(sum(bytes),0)::text bytes FROM sources WHERE profile='kml-native-v1'")).rows[0];
      if(Number(budget.sources)>=KML_LIMITS.retainedSources||Number(budget.bytes)+file.bytes.length>KML_LIMITS.retainedBytes)
        throw new AppError(429,'KML_RETENTION_BUDGET','The finite retained KML source budget is full; existing originals remain available.');
      const original=KMLOriginalSchema.parse({version:KML_VERSION,subject:binding.subject,
        accessSha256:binding.access,sha256:hash,bytes:file.bytes.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage:request.lineage});
      await putOriginal(key,file.bytes,'application/octet-stream',bounds.signal);
      assertIngestionBinding(binding);
      await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection)
        VALUES($1,$2,$1,1,$3,'kml-native-v1','application/octet-stream',$4,$5,$6,'received',$7)`,
        [sourceId,caseId,file.name,file.bytes.length,hash,key,{profile:'kml-native-v1',status:'needs_input',issues:[],
          summary:'Unchanged source bytes retained; a bounded native KML metadata read is queued.',kmlOriginal:original}]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const ctx=await kmlSourceTx(client,caseId,sourceId),jobId=await enqueueTx(client,ctx,null);
      const receipt=KMLRetainReceiptSchema.parse({version:KML_VERSION,caseId,caseRevision:ctx.current.revision,
        sourceId,sourceRevision:1,sourceSha256:hash,bytes:file.bytes.length,jobId});
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'kml-retain',$3,$4)",[caseId,operationKey,digest,receipt]);
      return receipt;
    },bounds));
  }
  async enqueue(caseValue:string,sourceValue:string,raw:unknown,bounds:DbDeadline=deadline(KML_LIMITS.requestMs)){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),request=KMLRequestSchema.parse(raw);
    return transaction(async client=>{
      await lockSourceCaseDestinationTx(client,caseId);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('kml-native-admission-v1',0))");
      const ctx=await kmlSourceTx(client,caseId,sourceId,true),key=`kml-native:${request.requestKey}`,
        digest=fingerprint({request,caseId,sourceId,access:ctx.binding.access,readerSha256:kmlReaderSha()});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='kml-native'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names a different KML selection.');
        const receipt=KMLQueueReceiptSchema.parse(prior.result),row=await kmlStatusTx(client,caseId,sourceId,receipt.jobId);
        if(row.stale)conflict('The explicit KML retry context changed.');return receipt;}
      if(!ctx.latest||ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision||ctx.source.sha256!==request.sourceSha256)
        conflict('Pin the current case and retained KML before requesting a selection.');
      const jobId=await enqueueTx(client,ctx,request.member),receipt={version:KML_VERSION,caseId,sourceId,jobId};
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'kml-native',$3,$4)",[caseId,key,digest,receipt]);
      return receipt;
    },bounds);
  }
  async status(caseValue:string,sourceValue:string,jobValue:string){
    const bounds=deadline(KML_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>kmlStatusTx(client,caseId,sourceId,jobId),bounds);
    if(!row.stale&&row.job.status==='succeeded')assertKMLTools(row.input.tools,bounds.deadlineAt);
    const result=!row.stale&&row.job.status==='succeeded'&&row.job.result_ref
      ?await readKMLResult(row.input,row.job.result_ref.sha256,kmlResultBytes(row.job.result_ref,jobId),bounds.signal):null;
    await transaction(async client=>{const current=await kmlStatusTx(client,caseId,sourceId,jobId);
      if(fingerprint(current.input)!==fingerprint(row.input)||current.stale!==row.stale||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.status!==row.job.status)
        conflict('KML job changed while reading its status.');},bounds);
    if(result)assertKMLTools(row.input.tools,bounds.deadlineAt);
    const response=KMLStatusSchema.parse({version:KML_VERSION,caseId,sourceId,jobId,
      currentCaseRevision:row.ctx.current.revision,sourceRevision:row.ctx.source.revision,sourceSha256:row.ctx.source.sha256,
      status:row.stale?'stale':result?result.summary.status==='inspected'?'completed':result.summary.status:row.job.status,
      code:row.stale?'KML_INPUT_STALE':result?.summary.selectionCode??(row.job.error?( /^KML_[A-Z_]{1,60}$/.test(row.job.error)?row.job.error:'KML_JOB_FAILED'):null),
      result:result?{summary:result.summary,artifact:result.artifact,createdAt:result.createdAt}:null});
    if(Buffer.byteLength(JSON.stringify(response))>KML_LIMITS.statusBytes)
      throw new AppError(413,'KML_STATUS_LIMIT','Private status exceeds its bounded response profile.');
    return response;
  }
  async artifact(caseValue:string,sourceValue:string,jobValue:string){
    const bounds=deadline(KML_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>kmlStatusTx(client,caseId,sourceId,jobId),bounds);
    if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
      throw new AppError(409,'KML_NOT_ACCEPTED','This selection has no current accepted artifact.');
    assertKMLTools(row.input.tools,bounds.deadlineAt);
    const result=await readKMLResult(row.input,row.job.result_ref.sha256,kmlResultBytes(row.job.result_ref,jobId),bounds.signal);
    const bytes=await boundedKMLObject(result.artifact.key,result.artifact.bytes,bounds.signal);
    if(bytes.length!==result.artifact.bytes||sha256(bytes)!==result.artifact.sha256)
      throw new AppError(422,'KML_ARTIFACT_INTEGRITY','The private native KML records differ from their accepted receipt.');
    await transaction(async client=>{const current=await kmlStatusTx(client,caseId,sourceId,jobId);
      if(current.stale||fingerprint(current.input)!==fingerprint(row.input)||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.accepted_fence!==row.job.accepted_fence)
        conflict('The accepted KML attempt changed during artifact read.');},bounds);
    assertKMLTools(row.input.tools,bounds.deadlineAt);
    return {bytes,sha256:result.artifact.sha256};
  }
  async original(caseValue:string,sourceValue:string){
    const bounds=deadline(KML_LIMITS.readMs);
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue);
    const ctx=await transaction(client=>kmlSourceTx(client,caseId,sourceId),bounds);
    if(!ctx.latest)conflict('This original has a newer source revision.');
    const bytes=await boundedKMLObject(ctx.source.object_key,Number(ctx.source.bytes),bounds.signal);
    if(sha256(bytes)!==ctx.source.sha256)
      throw new AppError(422,'KML_SOURCE_INTEGRITY','Retained original differs from its immutable source receipt.');
    await transaction(async client=>{const current=await kmlSourceTx(client,caseId,sourceId);
      if(!current.latest||current.current.revision!==ctx.current.revision||current.context!==ctx.context||
        current.source.sha256!==ctx.source.sha256||current.source.revision!==ctx.source.revision||
        current.source.object_key!==ctx.source.object_key||Number(current.source.bytes)!==Number(ctx.source.bytes))
        conflict('The original changed during download.');},bounds);
    return {bytes,name:ctx.source.name,mimeType:'application/octet-stream',sha256:ctx.source.sha256};
  }
}
