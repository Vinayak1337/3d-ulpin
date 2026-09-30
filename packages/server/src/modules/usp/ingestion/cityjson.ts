import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CITYJSON_VERSION,CITYJSON_LIMITS,CityJSONRetainSchema,CityJSONRequestSchema,
  CityJSONOriginalSchema,CityJSONInputSchema,CityJSONResultSchema,CityJSONStatusSchema,CityJSONRetainReceiptSchema,
  type CityJSONInput,type CityJSONResult} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,readObject,openObjectStream,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {originalAttempt} from '../../cases/original-attempt';
import {registerUspJobInputTx} from '../jobs';
import {appendCaseIngestionTx,ingestionBinding,assertIngestionBinding} from './events';

const uuid=z.uuid().transform(value=>value.toLowerCase());
export const cityjsonReaderSha=()=>sha256(Buffer.concat(['native_cityjson.py','cityjson_processing.py'].map(file=>readFileSync(join(settings.repositoryRoot,'services/geo/geo',file)))));
export const cityjsonResultKey=(jobId:string,hash:string)=>`cityjson-native/${jobId}/${hash}.json`;
export const cityjsonArtifactKey=(jobId:string,hash:string)=>`cityjson-native/${jobId}/${hash}.native.json`;

/** Exact object length is enforced before collecting a bounded original/artifact. */
export async function boundedCityJSONObject(key:string,size:number){
  if(!Number.isSafeInteger(size)||size<1||size>CITYJSON_LIMITS.artifactBytes)
    throw new AppError(422,'CITYJSON_OBJECT_LIMIT','Stored CityJSON object exceeds its private profile.');
  const {body}=await openObjectStream(key,size,30_000),parts:Buffer[]=[];let total=0;
  try{for await(const part of body){const bytes=Buffer.from(part);total+=bytes.length;
    if(total>size)throw new AppError(422,'CITYJSON_OBJECT_LIMIT','Stored object exceeds its receipt.');parts.push(bytes);}
    if(total!==size)throw new AppError(422,'CITYJSON_OBJECT_INTEGRITY','Stored object ended before its receipt.');
    return Buffer.concat(parts,total);
  }finally{body.destroy();}
}

/** Pin the stored payload and accepted attempt, not merely job.status. */
export function assertCityJSONJobRow(job:Record<string,any>,input:CityJSONInput,accepted=false){
  const digest=fingerprint(input);
  if(job.id!==input.jobId||job.operation!=='cityjson-native'||job.case_id!==input.caseId||job.source_id!==input.sourceId
    ||job.case_revision!==input.caseRevision||job.input_fingerprint!==digest||job.input_sha256!==digest
    ||fingerprint(job.payload)!==digest)
    throw new AppError(422,'CITYJSON_JOB_INTEGRITY','Stored job does not match its source-bound input.');
  if(accepted&&(job.status!=='succeeded'||job.logical_state!=='succeeded'||!job.result_ref
    ||job.result_ref.assetId!==`cityjson:${input.jobId}`||job.result_ref.version!==1
    ||job.attempt_state!=='accepted'||Number(job.attempt_fence)!==Number(job.accepted_fence)
    ||job.attempt_input_sha256!==digest||job.completion_sha256!==job.result_ref.sha256))
    conflict('No exact accepted CityJSON attempt is available.');
}

export async function cityjsonSourceTx(client:PoolClient,caseId:string,sourceId:string,lock=false){
  const binding=ingestionBinding(caseId);
  const current=(await client.query(`SELECT id,revision,archived,frame,context,site_id FROM cases WHERE id=$1${lock?' FOR SHARE':''}`,[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'CITYJSON_DENIED','This source case is archived.');
  const source=(await client.query(`SELECT * FROM sources WHERE case_id=$1 AND id=$2${lock?' FOR SHARE':''}`,[caseId,sourceId])).rows[0]??notFound('CityJSON source not found in this case.');
  const original=CityJSONOriginalSchema.safeParse(source.inspection?.cityjsonOriginal);
  if(source.profile!=='cityjson-native-v1'||!original.success||original.data.subject!==binding.subject||original.data.accessSha256!==binding.access)
    throw new AppError(403,'CITYJSON_DENIED','This retained CityJSON is unavailable to the current local context.');
  if(original.data.sha256!==source.sha256||original.data.bytes!==Number(source.bytes)||source.object_key!==`sources/${sourceId}/${source.sha256}`)
    throw new AppError(422,'CITYJSON_SOURCE_INTEGRITY','The CityJSON receipt differs from its canonical source.');
  const latest=Number((await client.query('SELECT max(revision) revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision)===source.revision;
  assertIngestionBinding(binding);
  return {current,source,binding,latest,context:fingerprint({frame:current.frame,context:current.context,siteId:current.site_id})};
}
export function cityjsonInput(ctx:Awaited<ReturnType<typeof cityjsonSourceTx>>,jobId:string,selection:CityJSONInput['selection']):CityJSONInput{
  return CityJSONInputSchema.parse({version:CITYJSON_VERSION,jobId,caseId:ctx.current.id,
    caseRevision:ctx.current.revision,caseContextSha256:ctx.context,sourceId:ctx.source.id,
    sourceFamilyId:ctx.source.family_id,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,
    sourceBytes:Number(ctx.source.bytes),objectKey:ctx.source.object_key,subject:ctx.binding.subject,
    accessSha256:ctx.binding.access,readerSha256:cityjsonReaderSha(),selection});
}
export async function assertCityJSONInputTx(client:PoolClient,input:CityJSONInput,lock=false){
  const ctx=await cityjsonSourceTx(client,input.caseId,input.sourceId,lock);
  if(!ctx.latest||fingerprint(cityjsonInput(ctx,input.jobId,input.selection))!==fingerprint(input))
    conflict('The CityJSON original, case, reader or private access context changed. Retry under current pins.');
  return ctx;
}
async function enqueueTx(client:PoolClient,ctx:Awaited<ReturnType<typeof cityjsonSourceTx>>,selection:CityJSONInput['selection']){
  if(!ctx.latest)conflict('This CityJSON source has a newer retained revision.');
  const jobs=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE source_id=$1 AND operation='cityjson-native'",[ctx.source.id])).rows[0].n);
  if(jobs>=CITYJSON_LIMITS.jobsPerSource)throw new AppError(429,'CITYJSON_HISTORY_LIMIT','The bounded selection history for this source is full.');
  const active=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE operation='cityjson-native' AND status IN ('queued','running')")).rows[0].n);
  if(active>=CITYJSON_LIMITS.active)throw new AppError(429,'CITYJSON_WORKER_BUSY','The bounded CityJSON workers are occupied.');
  const jobId=randomUUID(),input=cityjsonInput(ctx,jobId,selection),inputHash=fingerprint(input);
  await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'cityjson-native',$4,$5,$6)",
    [jobId,ctx.current.id,ctx.source.id,ctx.current.revision,inputHash,input]);
  await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:ctx.current.id,version:ctx.current.revision+1},ctx.source.id,inputHash);
  await appendCaseIngestionTx(client,ctx.current.id,{kind:'cityjson-native.changed',sourceId:ctx.source.id,
    sourceRevision:ctx.source.revision,jobId,status:'queued'},ctx.binding.subject);
  return jobId;
}
export async function readCityJSONResult(input:CityJSONInput,hash:string):Promise<CityJSONResult>{
  const bytes=Buffer.from(await readObject(cityjsonResultKey(input.jobId,hash)));
  if(bytes.length>CITYJSON_LIMITS.resultBytes||sha256(bytes)!==hash)
    throw new AppError(422,'CITYJSON_RESULT_INTEGRITY','The private selection receipt failed its hash or size check.');
  const result=CityJSONResultSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==cityjsonArtifactKey(input.jobId,result.artifact.sha256))
    throw new AppError(422,'CITYJSON_RESULT_SCOPE','The selection receipt belongs to another original or job.');
  return result;
}
async function statusTx(client:PoolClient,caseId:string,sourceId:string,jobId:string){
  const ctx=await cityjsonSourceTx(client,caseId,sourceId);
  const job=(await client.query(`SELECT j.*,m.result_ref,m.input_sha256,m.logical_state,m.accepted_fence,
    a.state attempt_state,a.fence attempt_fence,a.input_sha256 attempt_input_sha256,a.completion_sha256
    FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id LEFT JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence
    WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='cityjson-native'`,[jobId,caseId,sourceId])).rows[0]??notFound('CityJSON selection job not found.');
  const input=CityJSONInputSchema.parse(job.payload);
  assertCityJSONJobRow(job,input);
  if(job.status==='succeeded')assertCityJSONJobRow(job,input,true);
  let stale=false;try{await assertCityJSONInputTx(client,input);}catch(error){if(error instanceof AppError&&error.status===409)stale=true;else throw error;}
  return {ctx,job,input,stale};
}
export class CityJSONIngestionService{
  async retain(caseValue:string,raw:unknown,file:{name:string;bytes:Uint8Array}){
    const caseId=uuid.parse(caseValue),request=CityJSONRetainSchema.parse(raw),hash=sha256(file.bytes);
    if(!z.string().min(1).max(150).regex(/^[^\\/\u0000-\u001f]+$/).safeParse(file.name).success)
      throw new AppError(422,'CITYJSON_FILENAME','Use a bounded plain filename without path separators or control characters.');
    if(!file.bytes.length||file.bytes.length>CITYJSON_LIMITS.originalBytes)
      throw new AppError(413,'CITYJSON_ORIGINAL_SIZE','Retain a nonempty original of at most 8 MiB. No bytes were truncated.');
    // Retain bounded bytes first; native content parsing, not filename, owns format recognition.
    const sourceId=randomUUID(),key=`sources/${sourceId}/${hash}`,operationKey=`cityjson-retain:${request.requestKey}`;
    return originalAttempt('sources',sourceId,async remember=>transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cityjson-native-admission-v1',0))");
      const binding=ingestionBinding(caseId);
      const current=(await client.query('SELECT id,revision,archived FROM cases WHERE id=$1 FOR UPDATE',[caseId])).rows[0]??notFound('Source case not found.');
      if(current.archived)throw new AppError(403,'CITYJSON_DENIED','This source case is archived.');
      const digest=fingerprint({request,hash,name:file.name,subject:binding.subject,access:binding.access});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='cityjson-retain'",[caseId,operationKey])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names different CityJSON bytes or lineage.');
        const receipt=CityJSONRetainReceiptSchema.parse(prior.result);
        await cityjsonSourceTx(client,caseId,receipt.sourceId);return receipt;}
      if(current.revision!==request.expectedCaseRevision)conflict('The source case changed before CityJSON receipt.');
      const budget=(await client.query("SELECT count(*)::int sources,coalesce(sum(bytes),0)::text bytes FROM sources WHERE profile='cityjson-native-v1'")).rows[0];
      if(Number(budget.sources)>=CITYJSON_LIMITS.retainedSources||Number(budget.bytes)+file.bytes.length>CITYJSON_LIMITS.retainedBytes)
        throw new AppError(429,'CITYJSON_RETENTION_BUDGET','The finite retained CityJSON source budget is full; existing originals remain available.');
      const original=CityJSONOriginalSchema.parse({version:CITYJSON_VERSION,subject:binding.subject,
        accessSha256:binding.access,sha256:hash,bytes:file.bytes.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage:request.lineage});
      remember(key);await putOriginal(key,file.bytes,'application/json');
      await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection)
        VALUES($1,$2,$1,1,$3,'cityjson-native-v1','application/json',$4,$5,$6,'received',$7)`,
        [sourceId,caseId,file.name,file.bytes.length,hash,key,{profile:'cityjson-native-v1',status:'needs_input',issues:[],
          summary:'Unchanged source bytes retained; a bounded native CityJSON structural read is queued.',cityjsonOriginal:original}]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const ctx=await cityjsonSourceTx(client,caseId,sourceId),jobId=await enqueueTx(client,ctx,'complete_bounded_source');
      const receipt=CityJSONRetainReceiptSchema.parse({version:CITYJSON_VERSION,caseId,caseRevision:ctx.current.revision,
        sourceId,sourceRevision:1,sourceSha256:hash,bytes:file.bytes.length,jobId});
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'cityjson-retain',$3,$4)",[caseId,operationKey,digest,receipt]);
      return receipt;
    }));
  }
  async enqueue(caseValue:string,sourceValue:string,raw:unknown){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),request=CityJSONRequestSchema.parse(raw);
    return transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('cityjson-native-admission-v1',0))");
      const ctx=await cityjsonSourceTx(client,caseId,sourceId,true),key=`cityjson-native:${request.requestKey}`,
        digest=fingerprint({request,caseId,sourceId,access:ctx.binding.access,readerSha256:cityjsonReaderSha()});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='cityjson-native'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names a different CityJSON selection.');return prior.result;}
      if(!ctx.latest||ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision||ctx.source.sha256!==request.sourceSha256)
        conflict('Pin the current case and retained CityJSON before requesting a selection.');
      const jobId=await enqueueTx(client,ctx,'complete_bounded_source'),receipt={version:CITYJSON_VERSION,caseId,sourceId,jobId};
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'cityjson-native',$3,$4)",[caseId,key,digest,receipt]);
      return receipt;
    });
  }
  async status(caseValue:string,sourceValue:string,jobValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>statusTx(client,caseId,sourceId,jobId));
    const result=!row.stale&&row.job.status==='succeeded'&&row.job.result_ref
      ?await readCityJSONResult(row.input,row.job.result_ref.sha256):null;
    await transaction(async client=>{const current=await statusTx(client,caseId,sourceId,jobId);
      if(fingerprint(current.input)!==fingerprint(row.input)||current.stale!==row.stale||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.status!==row.job.status)
        conflict('CityJSON job changed while reading its status.');});
    const response=CityJSONStatusSchema.parse({version:CITYJSON_VERSION,caseId,sourceId,jobId,
      currentCaseRevision:row.ctx.current.revision,sourceRevision:row.ctx.source.revision,sourceSha256:row.ctx.source.sha256,
      status:row.stale?'stale':row.job.status==='succeeded'?'completed':row.job.status,
      code:row.stale?'CITYJSON_INPUT_STALE':row.job.error??null,
      result:result?{summary:result.summary,artifact:result.artifact,createdAt:result.createdAt}:null});
    if(Buffer.byteLength(JSON.stringify(response))>CITYJSON_LIMITS.statusBytes)
      throw new AppError(413,'CITYJSON_STATUS_LIMIT','Private status exceeds its bounded response profile.');
    return response;
  }
  async artifact(caseValue:string,sourceValue:string,jobValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const row=await transaction(client=>statusTx(client,caseId,sourceId,jobId));
    if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
      throw new AppError(409,'CITYJSON_NOT_ACCEPTED','This selection has no current accepted artifact.');
    const result=await readCityJSONResult(row.input,row.job.result_ref.sha256);
    const bytes=await boundedCityJSONObject(result.artifact.key,result.artifact.bytes);
    if(bytes.length!==result.artifact.bytes||sha256(bytes)!==result.artifact.sha256)
      throw new AppError(422,'CITYJSON_ARTIFACT_INTEGRITY','The private native CityJSON records differ from their accepted receipt.');
    await transaction(async client=>{const current=await statusTx(client,caseId,sourceId,jobId);
      if(current.stale||fingerprint(current.input)!==fingerprint(row.input)||
        fingerprint(current.job.result_ref)!==fingerprint(row.job.result_ref)||current.job.accepted_fence!==row.job.accepted_fence)
        conflict('The accepted CityJSON attempt changed during artifact read.');});
    return {bytes,sha256:result.artifact.sha256};
  }
  async original(caseValue:string,sourceValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue);
    const ctx=await transaction(client=>cityjsonSourceTx(client,caseId,sourceId));
    const bytes=await boundedCityJSONObject(ctx.source.object_key,Number(ctx.source.bytes));
    if(sha256(bytes)!==ctx.source.sha256)
      throw new AppError(422,'CITYJSON_SOURCE_INTEGRITY','Retained original differs from its immutable source receipt.');
    await transaction(async client=>{const current=await cityjsonSourceTx(client,caseId,sourceId);
      if(current.source.sha256!==ctx.source.sha256||current.source.revision!==ctx.source.revision||
        current.source.object_key!==ctx.source.object_key||Number(current.source.bytes)!==Number(ctx.source.bytes))
        conflict('The original changed during download.');});
    return {bytes,name:ctx.source.name,mimeType:'application/json',sha256:ctx.source.sha256};
  }
}
