import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {RASTER_WINDOW_VERSION,RASTER_WINDOW_LIMITS,RasterRetainSchema,RasterWindowRequestSchema,
  RasterOriginalSchema,RasterWindowInputSchema,RasterWindowResultSchema,RasterWindowStatusSchema,RasterRetainReceiptSchema,
  type RasterWindowInput,type RasterWindowResult} from '@ulpin/contracts/usp';
import {transaction,type DbDeadline} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {originalAttempt} from '../../cases/original-attempt';
import {compareSourcePins} from './source-pin';
import {registerUspJobInputTx} from '../jobs';
import {appendCaseIngestionTx,ingestionBinding,assertIngestionBinding} from './events';
import {readRasterObject,rasterReadDeadline,rasterReadLive} from './raster-window-object';

const uuid=z.uuid(),operation='raster-window';
export const rasterReaderSha=()=>sha256(readFileSync(join(settings.repositoryRoot,'services/geo/geo/raster_window.py')));
export const rasterResultKey=(jobId:string,hash:string)=>`raster-windows/${jobId}/${hash}.json`;
export const rasterArtifactKey=(jobId:string,hash:string)=>`raster-windows/${jobId}/${hash}.tif`;

export async function rasterSourceTx(client:PoolClient,caseId:string,sourceId:string,lock=false){
  const binding=ingestionBinding(caseId);
  const current=(await client.query(`SELECT id,revision,archived,frame,context,site_id FROM cases WHERE id=$1${lock?' FOR SHARE':''}`,[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'RASTER_DENIED','This source case is archived.');
  const source=(await client.query(`SELECT * FROM sources WHERE case_id=$1 AND id=$2${lock?' FOR SHARE':''}`,[caseId,sourceId])).rows[0]??notFound('Raster source not found in this case.');
  const original=RasterOriginalSchema.safeParse(source.inspection?.rasterOriginal);
  if(source.profile!=='geotiff-raster-v1'||!original.success||original.data.subject!==binding.subject)
    throw new AppError(403,'RASTER_DENIED','This retained raster is unavailable to the current local context.');
  if(original.data.sha256!==source.sha256||original.data.bytes!==Number(source.bytes)||source.object_key!==`sources/${sourceId}/${source.sha256}`)
    throw new AppError(422,'RASTER_SOURCE_INTEGRITY','The raster receipt differs from its canonical source.');
  const latest=Number((await client.query('SELECT max(revision) revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision)===source.revision;
  assertIngestionBinding(binding);
  return {current,source,binding,latest,context:fingerprint({frame:current.frame,context:current.context,siteId:current.site_id})};
}
export function rasterInput(ctx:Awaited<ReturnType<typeof rasterSourceTx>>,jobId:string,window:RasterWindowInput['window']):RasterWindowInput{
  return RasterWindowInputSchema.parse({version:RASTER_WINDOW_VERSION,jobId,caseId:ctx.current.id,
    caseRevision:ctx.current.revision,caseContextSha256:ctx.context,sourceId:ctx.source.id,
    sourceFamilyId:ctx.source.family_id,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,
    sourceBytes:Number(ctx.source.bytes),objectKey:ctx.source.object_key,subject:ctx.binding.subject,
    accessSha256:ctx.binding.access,readerSha256:rasterReaderSha(),window});
}
export async function assertRasterInputTx(client:PoolClient,input:RasterWindowInput,lock=false){
  const ctx=await rasterSourceTx(client,input.caseId,input.sourceId,lock);
  if(!ctx.latest||!compareSourcePins(rasterInput(ctx,input.jobId,input.window),input).current)
    conflict('The raster original, case, reader or private access context changed. Retry under current pins.');
  return ctx;
}
async function enqueueTx(client:PoolClient,ctx:Awaited<ReturnType<typeof rasterSourceTx>>,window:RasterWindowInput['window']){
  if(!ctx.latest)conflict('This raster source has a newer retained revision.');
  const jobs=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE source_id=$1 AND operation='raster-window'",[ctx.source.id])).rows[0].n);
  if(jobs>=RASTER_WINDOW_LIMITS.jobsPerSource)throw new AppError(429,'RASTER_HISTORY_LIMIT','The bounded window history for this source is full.');
  const active=Number((await client.query("SELECT count(*)::int n FROM jobs WHERE operation='raster-window' AND status IN ('queued','running')")).rows[0].n);
  if(active>=RASTER_WINDOW_LIMITS.active)throw new AppError(429,'RASTER_WORKER_BUSY','The bounded raster workers are occupied.');
  const jobId=randomUUID(),input=rasterInput(ctx,jobId,window),inputHash=fingerprint(input);
  await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'raster-window',$4,$5,$6)",
    [jobId,ctx.current.id,ctx.source.id,ctx.current.revision,inputHash,input]);
  await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:ctx.current.id,version:ctx.current.revision+1},ctx.source.id,inputHash);
  await appendCaseIngestionTx(client,ctx.current.id,{kind:'raster-window.changed',sourceId:ctx.source.id,
    sourceRevision:ctx.source.revision,jobId,status:'queued'},ctx.binding.subject);
  return jobId;
}
export async function readRasterResult(input:RasterWindowInput,hash:string,bounds:DbDeadline=rasterReadDeadline(),read:typeof readRasterObject=readRasterObject):Promise<RasterWindowResult>{
  const bytes=await read(rasterResultKey(input.jobId,hash),hash,null,bounds);
  if(bytes.length>RASTER_WINDOW_LIMITS.resultBytes||sha256(bytes)!==hash)
    throw new AppError(422,'RASTER_RESULT_INTEGRITY','The private window receipt failed its hash or size check.');
  const result=RasterWindowResultSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(fingerprint(result.input)!==fingerprint(input)||result.artifact.key!==rasterArtifactKey(input.jobId,result.artifact.sha256))
    throw new AppError(422,'RASTER_RESULT_SCOPE','The window receipt belongs to another original or job.');
  const window=input.window??{x:0,y:0,width:Math.min(RASTER_WINDOW_LIMITS.windowSide,result.metadata.sourceWidth),
    height:Math.min(RASTER_WINDOW_LIMITS.windowSide,result.metadata.sourceHeight)};
  if(fingerprint(result.metadata.window)!==fingerprint(window))
    throw new AppError(422,'RASTER_RESULT_SCOPE','The receipt describes another pixel window.');
  rasterReadLive(bounds);
  return result;
}
/** Registered input and exact accepted attempt, never merely succeeded status. */
export function assertRasterJobRow(job:Record<string,any>,input:RasterWindowInput,accepted=false){
  const digest=fingerprint(input);
  if(job.id!==input.jobId||job.operation!==operation||job.case_id!==input.caseId||job.source_id!==input.sourceId||
    job.case_revision!==input.caseRevision||job.input_fingerprint!==digest||job.input_sha256!==digest||
    job.input_manifest_id!==input.sourceId||job.scope?.kind!=='intake'||job.scope.workspaceId!==input.caseId||
    job.scope.version!==input.caseRevision+1||fingerprint(job.payload)!==digest)
    throw new AppError(422,'RASTER_JOB_INTEGRITY','The raster job differs from its source-bound input enrollment.');
  const fence=Number(job.accepted_fence),ref=job.result_ref;
  if(accepted&&(job.status!=='succeeded'||job.logical_state!=='succeeded'||!ref||ref.assetId!==`raster:${input.jobId}`||
    ref.version!==1||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(fence)||fence<1||
    job.attempt_state!=='accepted'||Number(job.attempt_fence)!==fence||job.attempt_input_sha256!==digest||job.completion_sha256!==ref.sha256))
    throw new AppError(409,'RASTER_NOT_ACCEPTED','This raster window has no exact accepted attempt.');
}
async function statusTx(client:PoolClient,caseId:string,sourceId:string,jobId:string){
  const ctx=await rasterSourceTx(client,caseId,sourceId,true);
  const job=(await client.query(`SELECT j.*,m.result_ref,m.input_manifest_id,m.input_sha256,m.scope,m.logical_state,m.accepted_fence,
    a.state attempt_state,a.fence attempt_fence,a.input_sha256 attempt_input_sha256,a.completion_sha256
    FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id
    LEFT JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence
    WHERE j.id=$1 AND j.case_id=$2 AND j.source_id=$3 AND j.operation='raster-window' FOR SHARE OF j,m`,[jobId,caseId,sourceId])).rows[0]??notFound('Raster window job not found.');
  const input=RasterWindowInputSchema.parse(job.payload);
  assertRasterJobRow(job,input,job.status==='succeeded');
  const stale=!ctx.latest||!compareSourcePins(rasterInput(ctx,input.jobId,input.window),input).current,
    capture=fingerprint({input,status:job.status,error:job.error??null,inputManifestId:job.input_manifest_id,inputSha256:job.input_sha256,
      scope:job.scope,logicalState:job.logical_state,acceptedFence:job.accepted_fence,resultRef:job.result_ref,
      attemptState:job.attempt_state,attemptFence:job.attempt_fence,attemptInputSha256:job.attempt_input_sha256,
      completionSha256:job.completion_sha256,sourceRevision:ctx.source.revision,
      sourceSha256:ctx.source.sha256,stale});
  return {ctx,job,input,stale,capture};
}
export {statusTx as rasterWindowCaptureTx};
type ReadDependencies={transaction:typeof transaction;object:typeof readRasterObject};
export class RasterWindowService{
  constructor(private readonly reads:ReadDependencies={transaction,object:readRasterObject}){}
  async retain(caseValue:string,raw:unknown,file:{name:string;bytes:Uint8Array}){
    const caseId=uuid.parse(caseValue),request=RasterRetainSchema.parse(raw),hash=sha256(file.bytes);
    if(!z.string().min(1).max(150).regex(/^[^\\/\u0000-\u001f]+$/).safeParse(file.name).success)
      throw new AppError(422,'RASTER_FILENAME','Use a bounded plain filename without path separators or control characters.');
    if(!file.bytes.length||file.bytes.length>RASTER_WINDOW_LIMITS.originalBytes)
      throw new AppError(413,'RASTER_ORIGINAL_SIZE','Retain a nonempty original of at most 16 MiB. No bytes were truncated.');
    if(!/^II\x2a\x00|^MM\x00\x2a|^II\x2b\x00|^MM\x00\x2b/.test(Buffer.from(file.bytes.subarray(0,4)).toString('latin1')))
      throw new AppError(415,'RASTER_FORMAT','Only TIFF magic bytes are admitted; the reader will check native GeoTIFF support.');
    const sourceId=randomUUID(),key=`sources/${sourceId}/${hash}`,operationKey=`raster-retain:${request.requestKey}`;
    return originalAttempt('sources',sourceId,async remember=>transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('raster-window-admission-v1',0))");
      const binding=ingestionBinding(caseId);
      const current=(await client.query('SELECT id,revision,archived FROM cases WHERE id=$1 FOR UPDATE',[caseId])).rows[0]??notFound('Source case not found.');
      if(current.archived)throw new AppError(403,'RASTER_DENIED','This source case is archived.');
      const digest=fingerprint({request,hash,name:file.name,subject:binding.subject});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='raster-retain'",[caseId,operationKey])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names different raster bytes or lineage.');return RasterRetainReceiptSchema.parse(prior.result);}
      if(current.revision!==request.expectedCaseRevision)conflict('The source case changed before raster receipt.');
      const budget=(await client.query("SELECT count(*)::int sources,coalesce(sum(bytes),0)::text bytes FROM sources WHERE profile='geotiff-raster-v1'")).rows[0];
      if(Number(budget.sources)>=RASTER_WINDOW_LIMITS.retainedSources||Number(budget.bytes)+file.bytes.length>RASTER_WINDOW_LIMITS.retainedBytes)
        throw new AppError(429,'RASTER_RETENTION_BUDGET','The finite retained raster source budget is full; existing originals remain available.');
      const original=RasterOriginalSchema.parse({version:RASTER_WINDOW_VERSION,subject:binding.subject,
        sha256:hash,bytes:file.bytes.length,receivedAt:new Date().toISOString(),lineageState:'caller_declared',lineage:request.lineage});
      remember(key);await putOriginal(key,file.bytes,'image/tiff');
      await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection)
        VALUES($1,$2,$1,1,$3,'geotiff-raster-v1','image/tiff',$4,$5,$6,'received',$7)`,
        [sourceId,caseId,file.name,file.bytes.length,hash,key,{profile:'geotiff-raster-v1',status:'needs_input',issues:[],
          summary:'Unchanged GeoTIFF bytes retained; a bounded native first window is queued.',rasterOriginal:original}]);
      await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1',[caseId]);
      const ctx=await rasterSourceTx(client,caseId,sourceId),jobId=await enqueueTx(client,ctx,null);
      const receipt=RasterRetainReceiptSchema.parse({version:RASTER_WINDOW_VERSION,caseId,caseRevision:ctx.current.revision,
        sourceId,sourceRevision:1,sourceSha256:hash,bytes:file.bytes.length,jobId});
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'raster-retain',$3,$4)",[caseId,operationKey,digest,receipt]);
      return receipt;
    }));
  }
  async enqueue(caseValue:string,sourceValue:string,raw:unknown){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),request=RasterWindowRequestSchema.parse(raw);
    return transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('raster-window-admission-v1',0))");
      const ctx=await rasterSourceTx(client,caseId,sourceId,true),key=`raster-window:${request.requestKey}`,
        digest=fingerprint({request,caseId,sourceId,access:ctx.binding.access,readerSha256:rasterReaderSha()});
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='raster-window'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This request key names a different pixel window.');return prior.result;}
      if(!ctx.latest||ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision||ctx.source.sha256!==request.sourceSha256)
        conflict('Pin the current case and retained raster before requesting a window.');
      const jobId=await enqueueTx(client,ctx,request.window),receipt={version:RASTER_WINDOW_VERSION,caseId,sourceId,jobId};
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'raster-window',$3,$4)",[caseId,key,digest,receipt]);
      return receipt;
    });
  }
  async status(caseValue:string,sourceValue:string,jobValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const bounds=rasterReadDeadline(),row=await this.reads.transaction(client=>statusTx(client,caseId,sourceId,jobId),bounds);
    const result=!row.stale&&row.job.status==='succeeded'&&row.job.result_ref
      ?await readRasterResult(row.input,row.job.result_ref.sha256,bounds,this.reads.object):null;
    await this.reads.transaction(async client=>{const current=await statusTx(client,caseId,sourceId,jobId);
      if(current.capture!==row.capture)throw new AppError(409,'RASTER_READ_CHANGED','The raster status or accepted receipt changed during read.');},bounds);
    rasterReadLive(bounds);
    return RasterWindowStatusSchema.parse({version:RASTER_WINDOW_VERSION,caseId,sourceId,jobId,
      currentCaseRevision:row.ctx.current.revision,sourceRevision:row.ctx.source.revision,sourceSha256:row.ctx.source.sha256,
      status:row.stale?'stale':row.job.status==='succeeded'?'completed':row.job.status,
      code:row.stale?'RASTER_INPUT_STALE':row.job.error??null,
      result:result?{version:result.version,metadata:result.metadata,artifact:result.artifact,createdAt:result.createdAt}:null});
  }
  async artifact(caseValue:string,sourceValue:string,jobValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const bounds=rasterReadDeadline(),row=await this.reads.transaction(client=>statusTx(client,caseId,sourceId,jobId),bounds);
    if(row.stale||row.job.status!=='succeeded'||!row.job.result_ref)
      throw new AppError(409,'RASTER_NOT_ACCEPTED','This window has no current accepted artifact.');
    const result=await readRasterResult(row.input,row.job.result_ref.sha256,bounds,this.reads.object);
    const bytes=await this.reads.object(result.artifact.key,result.artifact.sha256,result.artifact.bytes,bounds);
    if(bytes.length!==result.artifact.bytes||sha256(bytes)!==result.artifact.sha256)
      throw new AppError(422,'RASTER_ARTIFACT_INTEGRITY','The private GeoTIFF differs from its accepted receipt.');
    await this.reads.transaction(async client=>{const current=await statusTx(client,caseId,sourceId,jobId);
      if(current.stale||current.capture!==row.capture)throw new AppError(409,'RASTER_READ_CHANGED','The accepted raster window changed during artifact read.');},bounds);
    rasterReadLive(bounds);
    return {bytes,sha256:result.artifact.sha256};
  }
}
