import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {STREAMING_VECTOR_LIMITS as limits,StreamingVectorRequestSchema,StreamingVectorInputSchema,
  StreamingVectorStatusSchema,StreamingVectorSlotSchema,StreamingVectorPayloadSchema,StreamingVectorChunkResponseSchema,
  type StreamingVectorInput} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {localOperatorSubject} from '../principal';
import {registerUspJobInputTx} from '../jobs';
import {appendCaseIngestionTx,assertIngestionBinding,ingestionBinding} from './events';

const uuid=z.string().uuid();
export const streamingReaderSha=()=>sha256(readFileSync(join(settings.repositoryRoot,
  'packages/server/src/modules/usp/ingestion/streaming-vector-reader.ts')));

/** A retained source and current local access are checked before every mutation/read. */
export async function streamingContextTx(client:PoolClient,caseId:string,sourceId:string){
  const binding=ingestionBinding(caseId),subject=localOperatorSubject();
  const current=(await client.query('SELECT id,revision,archived FROM cases WHERE id=$1',[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'STREAMING_CASE_ARCHIVED','The source case is archived.');
  const source=(await client.query('SELECT * FROM sources WHERE case_id=$1 AND id=$2',[caseId,sourceId])).rows[0]??notFound('Retained source not found.');
  const owner=source.profile==='geojson-manual-v1'?source.inspection?.actor:source.profile==='large-original-v1'?source.inspection?.largeOriginal?.operatorSubject:null;
  if(owner!==subject)throw new AppError(403,'STREAMING_SOURCE_OPERATOR','This original belongs to another configured local context.');
  if(!['geojson-manual-v1','large-original-v1'].includes(source.profile))throw new AppError(422,'STREAMING_PROFILE','This reader requires a retained GeoJSON original.');
  const latest=(await client.query('SELECT max(revision)::int revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision;
  return {current,source,binding,latest:Number(latest)===Number(source.revision)};
}
export async function assertStreamingInputTx(client:PoolClient,input:StreamingVectorInput){
  const ctx=await streamingContextTx(client,input.caseId,input.sourceId);
  const {inputFingerprint,...base}=input;
  if(!ctx.latest||ctx.current.revision!==input.caseRevision||ctx.source.revision!==input.sourceRevision
    ||ctx.source.family_id!==input.sourceFamilyId||ctx.source.sha256!==input.sourceSha256
    ||Number(ctx.source.bytes)!==input.sourceBytes||ctx.source.object_key!==input.objectKey
    ||ctx.binding.access!==input.accessBinding||ctx.binding.subject!==input.subject
    ||input.readerSha256!==streamingReaderSha()||fingerprint(base)!==inputFingerprint)
    conflict('The retained original, reader, case or private access context changed.');
  return ctx;
}

export function streamingSlot(row:any){return StreamingVectorSlotSchema.parse({
  chunkIndex:row.chunk_index,status:row.status,published:row.published,
  firstFeatureIndex:row.first_feature_index,lastFeatureIndex:row.last_feature_index,
  records:row.records,accepted:row.accepted,quarantined:row.quarantined,bytes:row.bytes,
  ref:row.object_key?{key:row.object_key,sha256:row.object_sha256,bytes:row.bytes}:null,
  issueCode:row.issue_code,resultSha256:row.result_sha256,attempt:row.attempt,fence:Number(row.fence),
});}
async function statusTx(client:PoolClient,caseId:string,sourceId:string,jobId:string){
  const ctx=await streamingContextTx(client,caseId,sourceId);
  const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='streaming-vector'",[jobId,caseId,sourceId])).rows[0]??notFound('Streaming import not found.');
  const input=StreamingVectorInputSchema.parse(job.payload),row=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1',[jobId])).rows[0]??notFound('Streaming import state unavailable.');
  if(input.sourceSha256!==ctx.source.sha256||input.sourceRevision!==ctx.source.revision||input.accessBinding!==ctx.binding.access)
    conflict('The pinned source or private access context changed.');
  const slots=(await client.query('SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1 AND published=true ORDER BY chunk_index DESC LIMIT 32',[jobId])).rows.reverse().map(streamingSlot);
  const crs=ctx.source.profile==='geojson-manual-v1'?ctx.source.inspection?.gis:null;
  return StreamingVectorStatusSchema.parse({version:limits.version,jobId,caseId,sourceId,sourceRevision:input.sourceRevision,
    sourceSha256:input.sourceSha256,framing:input.framing,status:row.state,nextPublishIndex:row.next_publish_index,
    sealedChunks:row.sealed_chunks,records:row.records,accepted:row.accepted,quarantined:row.quarantined,
    issueCode:row.issue_code,unknownRemainder:row.unknown_remainder,
    reference:{sourceCrs:typeof crs?.sourceCrs==='string'?crs.sourceCrs:null,
      evidence:typeof crs?.crsEvidence==='string'?crs.crsEvidence.slice(0,200):null,globalPlacement:'not_qualified'},slots});
}

export class StreamingVectorService{
  async enqueue(caseIdValue:string,sourceIdValue:string,value:unknown){
    const caseId=uuid.parse(caseIdValue),sourceId=uuid.parse(sourceIdValue),request=StreamingVectorRequestSchema.parse(value);
    const binding=ingestionBinding(caseId),readerSha256=streamingReaderSha();
    return transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('streaming-vector-admission-v1',0))");
      const ctx=await streamingContextTx(client,caseId,sourceId);
      const digest=fingerprint({request,caseId,sourceId,access:binding.access,readerSha256}),key=`streaming-vector:${request.requestKey}`;
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='streaming-vector'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('The import request key names different inputs.');return statusTx(client,caseId,sourceId,prior.result.jobId);}
      if(!ctx.latest||ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision||ctx.source.sha256!==request.sourceSha256)
        conflict('The source/case revision changed before streaming admission.');
      if(Number(ctx.source.bytes)>limits.sourceBytes||Number(ctx.source.bytes)<=0)throw new AppError(413,'STREAMING_SOURCE_BUDGET','This reader profile supports retained originals up to 128 MiB.');
      if(ctx.source.profile==='geojson-manual-v1'&&request.framing!=='feature-collection')throw new AppError(422,'STREAMING_FRAMING','The manual GeoJSON receipt is a FeatureCollection.');
      if(ctx.source.profile==='large-original-v1'&&ctx.source.mime_type!=='application/octet-stream')throw new AppError(422,'STREAMING_FRAMING','This retained source is not declared as JSON bytes.');
      const active=Number((await client.query("SELECT count(*)::int n FROM usp_streaming_vector_imports WHERE state IN ('queued','running')")).rows[0].n);
      if(active>=2)throw new AppError(429,'STREAMING_CAPACITY','The bounded streaming workers are occupied.');
      const requests=Number((await client.query("SELECT count(*)::int n FROM operations WHERE kind='streaming-vector'")).rows[0].n);
      if(requests>=128)throw new AppError(429,'STREAMING_HISTORY_CAPACITY','The finite streaming import history is full.');
      const jobId=randomUUID(),base={version:limits.version,jobId,caseId,caseRevision:ctx.current.revision,
        sourceId,sourceRevision:ctx.source.revision,sourceFamilyId:ctx.source.family_id,sourceSha256:ctx.source.sha256,
        sourceBytes:Number(ctx.source.bytes),objectKey:ctx.source.object_key,framing:request.framing,
        subject:binding.subject,accessBinding:binding.access,readerSha256};
      const input=StreamingVectorInputSchema.parse({...base,inputFingerprint:fingerprint(base)}),inputHash=fingerprint(input);
      await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'streaming-vector',$4,$5,$6)",
        [jobId,caseId,sourceId,ctx.current.revision,inputHash,input]);
      await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:caseId,version:ctx.current.revision+1},sourceId,inputHash);
      await client.query("INSERT INTO usp_streaming_vector_imports(job_id,case_id,source_id,source_revision,input_sha256,state) VALUES($1,$2,$3,$4,$5,'queued')",
        [jobId,caseId,sourceId,input.sourceRevision,inputHash]);
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'streaming-vector',$3,$4)",[caseId,key,digest,{jobId}]);
      await appendCaseIngestionTx(client,caseId,{kind:'streaming-vector.changed',sourceId,sourceRevision:input.sourceRevision,jobId,status:'queued'},binding.subject);
      return statusTx(client,caseId,sourceId,jobId);
    });
  }
  async status(caseIdValue:string,sourceIdValue:string,jobIdValue:string){
    const caseId=uuid.parse(caseIdValue),sourceId=uuid.parse(sourceIdValue),jobId=uuid.parse(jobIdValue);
    return transaction(client=>statusTx(client,caseId,sourceId,jobId));
  }
  async chunk(caseIdValue:string,sourceIdValue:string,jobIdValue:string,indexValue:number){
    const caseId=uuid.parse(caseIdValue),sourceId=uuid.parse(sourceIdValue),jobId=uuid.parse(jobIdValue);
    const index=z.number().int().min(0).max(limits.chunks).parse(indexValue);
    const binding=ingestionBinding(caseId);
    const row=await transaction(async client=>{
      const ctx=await streamingContextTx(client,caseId,sourceId);
      const job=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='streaming-vector'",[jobId,caseId,sourceId])).rows[0]??notFound('Streaming import not found.');
      const input=StreamingVectorInputSchema.parse(job.payload);
      if(input.accessBinding!==ctx.binding.access||input.sourceSha256!==ctx.source.sha256||input.sourceRevision!==ctx.source.revision)
        conflict('The pinned original or access context changed.');
      const slot=(await client.query('SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 AND published=true',
        [jobId,input.sourceRevision,index])).rows[0]??notFound('This indexed draft slot is not published.');
      const state=(await client.query('SELECT state,unknown_remainder,sealed_chunks FROM usp_streaming_vector_imports WHERE job_id=$1',[jobId])).rows[0];
      return {input,slot:streamingSlot(slot),state};
    });
    let payload=null;
    if(row.slot.ref){
      const bytes=Buffer.from(await readObject(row.slot.ref.key));
      if(bytes.length!==row.slot.ref.bytes||sha256(bytes)!==row.slot.ref.sha256)
        throw new AppError(422,'STREAMING_CHUNK_INTEGRITY','The private draft payload differs from its immutable receipt.');
      payload=StreamingVectorPayloadSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
      if(payload.jobId!==jobId||payload.sourceId!==sourceId||payload.sourceRevision!==row.input.sourceRevision
        ||payload.sourceSha256!==row.input.sourceSha256||payload.chunkIndex!==index)
        throw new AppError(422,'STREAMING_CHUNK_INTEGRITY','The private draft payload belongs to another source pin.');
    }
    assertIngestionBinding(binding);
    const current=(await query('SELECT sha256,revision FROM sources WHERE id=$1 AND case_id=$2',[sourceId,caseId])).rows[0];
    if(current?.sha256!==row.input.sourceSha256||current?.revision!==row.input.sourceRevision)conflict('The source changed during draft read.');
    return StreamingVectorChunkResponseSchema.parse({slot:row.slot,payload,
      sourceComplete:row.state.sealed_chunks!==null&&['completed','completed_with_rejections'].includes(row.state.state),
      unknownRemainder:row.state.unknown_remainder});
  }
}
