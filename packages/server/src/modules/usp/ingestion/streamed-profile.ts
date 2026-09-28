import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {STREAMED_PROFILE_LIMITS as limits,StreamedProfileRequestSchema,StreamedProfileInputSchema,
  StreamedProfileGenerationSchema,StreamedProfileStatusSchema,StreamingVectorInputSchema,
  type StreamedProfileInput,type StreamedProfileGeneration} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {registerUspJobInputTx} from '../jobs';
import {appendCaseIngestionTx,ingestionBinding} from './events';
import {assertStreamingInputTx} from './streaming-vector';

const uuid=z.string().uuid();
const profileFiles=['packages/contracts/src/usp/streamed-profile.ts',
  'packages/server/src/modules/usp/ingestion/streamed-profile-inventory.ts',
  'packages/server/src/modules/usp/ingestion/streamed-profile-worker.ts',
  'packages/server/src/modules/usp/ingestion/streamed-profile.ts',
  'database/sql/95-ingestion/streamed-profile.sql'];
export const streamedProfilerSha=()=>fingerprint(profileFiles.map(path=>({path,
  sha256:sha256(readFileSync(join(settings.repositoryRoot,path)))})));

/** The generation hash covers immutable source, reader, coverage and the previous-generation chain. */
export function streamedGenerationHash(body:StreamedProfileGeneration){
  const {generationHash,source,...rest}=body;
  return fingerprint({...rest,source:{...source,schemaFingerprint:null}});
}
async function rawContextTx(client:PoolClient,rawJobId:string){
  const prior=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND operation='streaming-vector'",[rawJobId])).rows[0]
    ??notFound('Source streaming job not found.');
  const raw=StreamingVectorInputSchema.parse(prior.payload),ctx=await assertStreamingInputTx(client,raw);
  const job=(await client.query("SELECT input_fingerprint FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='streaming-vector' FOR SHARE",
    [rawJobId,raw.caseId,raw.sourceId])).rows[0]??notFound('Source streaming job not found.');
  if(job.input_fingerprint!==fingerprint(raw))conflict('The raw reader input changed.');
  return {raw,ctx,rawInputFingerprint:job.input_fingerprint as string};
}
export async function assertStreamedProfileInputTx(client:PoolClient,input:StreamedProfileInput){
  const {raw,ctx,rawInputFingerprint}=await rawContextTx(client,input.rawJobId);
  const {inputFingerprint,...base}=input;
  if(input.version!==limits.version||fingerprint(base)!==inputFingerprint
    ||input.profilerSha256!==streamedProfilerSha()||rawInputFingerprint!==input.rawInputFingerprint
    ||raw.readerSha256!==input.readerSha256||raw.caseId!==input.caseId||raw.caseRevision!==input.caseRevision
    ||raw.sourceId!==input.sourceId||raw.sourceRevision!==input.sourceRevision
    ||raw.sourceFamilyId!==input.sourceFamilyId||raw.sourceSha256!==input.sourceSha256
    ||raw.accessBinding!==input.accessBinding||raw.subject!==input.subject)
    conflict('The pinned original, reader, profiler or private access changed.');
  return {raw,ctx};
}
export async function readStreamedGenerationTx(client:PoolClient,input:StreamedProfileInput,index:number){
  const row=(await client.query('SELECT body,body_sha256,raw_chunk_index,raw_result_sha256,sealed FROM usp_streamed_profile_generations WHERE job_id=$1 AND generation=$2',
    [input.jobId,index])).rows[0]??notFound('This profile generation is not published.');
  const body=StreamedProfileGenerationSchema.parse(row.body);
  if(body.jobId!==input.jobId||body.rawJobId!==input.rawJobId||body.source.sourceId!==input.sourceId
    ||body.source.familyId!==input.sourceFamilyId||body.source.sourceRevision!==input.sourceRevision
    ||body.source.sourceSha256!==input.sourceSha256
    ||body.readerSha256!==input.readerSha256||body.profilerSha256!==input.profilerSha256
    ||body.generation!==index||body.generationHash!==body.source.schemaFingerprint
    ||body.rawChunkIndex!==row.raw_chunk_index||body.rawResultSha256!==row.raw_result_sha256
    ||(body.coverage==='sealed')!==row.sealed
    ||(index===0&&body.previousHash!==null)
    ||streamedGenerationHash(body)!==body.generationHash||fingerprint(body)!==row.body_sha256)
    throw new AppError(422,'STREAMED_PROFILE_INTEGRITY','The immutable field inventory differs from its source pin.');
  if(index>0){
    const previous=(await client.query('SELECT body->>\'generationHash\' AS generation_hash FROM usp_streamed_profile_generations WHERE job_id=$1 AND generation=$2',
      [input.jobId,index-1])).rows[0];
    if(!previous||body.previousHash!==previous.generation_hash)
      throw new AppError(422,'STREAMED_PROFILE_INTEGRITY','The immutable field inventory chain is incomplete.');
  }
  return body;
}
export async function loadSealedStreamedProfileTx(client:PoolClient,profileJobId:string,generation:number,
  expectedHash:string,rawJobId:string,caseId:string,sourceId:string){
  const job=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='streamed-profile' FOR SHARE",
    [profileJobId,caseId,sourceId])).rows[0]??notFound('Streamed profile job not found.');
  const input=StreamedProfileInputSchema.parse(job.payload);
  await assertStreamedProfileInputTx(client,input);
  const state=(await client.query('SELECT state,sealed_generation FROM usp_streamed_profile_imports WHERE job_id=$1 FOR SHARE',
    [profileJobId])).rows[0]??notFound('Streamed profile state unavailable.');
  if(input.rawJobId!==rawJobId||state.state!=='sealed'||state.sealed_generation!==generation)
    conflict('A sealed profile for this exact raw source is required.');
  const body=await readStreamedGenerationTx(client,input,generation);
  if(body.coverage!=='sealed'||body.unknownRemainder||body.generationHash!==expectedHash)
    conflict('The approved profile generation changed or is incomplete.');
  return {input,profile:body};
}
async function statusTx(client:PoolClient,input:StreamedProfileInput){
  await assertStreamedProfileInputTx(client,input);
  const state=(await client.query('SELECT * FROM usp_streamed_profile_imports WHERE job_id=$1',[input.jobId])).rows[0]
    ??notFound('Streamed profile state unavailable.');
  const latest=state.next_raw_index===0&&state.sealed_generation===null?null:
    await readStreamedGenerationTx(client,input,state.sealed_generation??state.next_raw_index-1);
  return StreamedProfileStatusSchema.parse({version:limits.version,jobId:input.jobId,rawJobId:input.rawJobId,
    caseId:input.caseId,sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,
    status:state.state,nextRawIndex:state.next_raw_index,latest,issueCode:state.issue_code,
    sourceComplete:state.state==='sealed'&&latest?.coverage==='sealed',
    usableCoverage:!!latest&&latest.accepted>0,identityComplete:false});
}

export class StreamedProfileService{
  async enqueue(caseValue:string,sourceValue:string,value:unknown){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),request=StreamedProfileRequestSchema.parse(value);
    const binding=ingestionBinding(caseId),profilerSha256=streamedProfilerSha();
    return transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('streamed-profile-admission-v1',0))");
      const {raw,ctx,rawInputFingerprint}=await rawContextTx(client,request.rawJobId);
      if(raw.caseId!==caseId||raw.sourceId!==sourceId)notFound('Source streaming job not found in this case.');
      const digest=fingerprint({request,access:binding.access,profilerSha256}),key=`streamed-profile:${request.requestKey}`;
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='streamed-profile'",
        [caseId,key])).rows[0];
      if(prior){
        if(prior.payload_hash!==digest)conflict('The profile request key names different inputs.');
        const job=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND operation='streamed-profile'",[prior.result.jobId])).rows[0]
          ??notFound('Streamed profile job not found.');
        return statusTx(client,StreamedProfileInputSchema.parse(job.payload));
      }
      if(ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision
        ||ctx.source.sha256!==request.sourceSha256)conflict('The retained source changed before profile admission.');
      const rawState=(await client.query('SELECT state,issue_code FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
        [request.rawJobId])).rows[0]??notFound('Raw streaming state unavailable.');
      if(rawState.issue_code==='STREAMING_SOURCE_INTEGRITY')
        throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The retained original failed integrity verification.');
      const active=Number((await client.query("SELECT count(*)::int n FROM usp_streamed_profile_imports WHERE state IN ('queued','running')")).rows[0].n);
      if(active>=limits.active)throw new AppError(429,'STREAMED_PROFILE_CAPACITY','The bounded profiler is occupied.');
      const history=Number((await client.query('SELECT count(*)::int n FROM usp_streamed_profile_imports')).rows[0].n);
      if(history>=128)throw new AppError(429,'STREAMED_PROFILE_HISTORY','The finite profile history is full.');
      const jobId=randomUUID(),base={version:limits.version,jobId,caseId,caseRevision:raw.caseRevision,
        sourceId,sourceRevision:raw.sourceRevision,sourceFamilyId:raw.sourceFamilyId,sourceSha256:raw.sourceSha256,
        rawJobId:request.rawJobId,rawInputFingerprint,readerSha256:raw.readerSha256,
        profilerSha256,subject:binding.subject,accessBinding:binding.access};
      const input=StreamedProfileInputSchema.parse({...base,inputFingerprint:fingerprint(base)}),inputHash=fingerprint(input);
      await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'streamed-profile',$4,$5,$6)",
        [jobId,caseId,sourceId,raw.caseRevision,inputHash,input]);
      await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:caseId,version:raw.caseRevision+1},sourceId,inputHash);
      await client.query("INSERT INTO usp_streamed_profile_imports(job_id,raw_job_id,case_id,source_id,source_revision,input_sha256,state) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [jobId,input.rawJobId,caseId,sourceId,input.sourceRevision,inputHash]);
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'streamed-profile',$3,$4)",
        [caseId,key,digest,{jobId}]);
      await appendCaseIngestionTx(client,caseId,{kind:'streamed-profile.changed',sourceId,
        sourceRevision:input.sourceRevision,jobId,rawJobId:input.rawJobId,status:'queued'},binding.subject);
      return statusTx(client,input);
    });
  }
  async status(caseValue:string,sourceValue:string,jobValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    return transaction(async client=>{
      const job=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='streamed-profile'",
        [jobId,caseId,sourceId])).rows[0]??notFound('Streamed profile job not found.');
      return statusTx(client,StreamedProfileInputSchema.parse(job.payload));
    });
  }
  async generation(caseValue:string,sourceValue:string,jobValue:string,indexValue:number){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const index=z.number().int().nonnegative().max(limits.generations).parse(indexValue);
    return transaction(async client=>{
      const job=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='streamed-profile'",
        [jobId,caseId,sourceId])).rows[0]??notFound('Streamed profile job not found.');
      const input=StreamedProfileInputSchema.parse(job.payload);
      await assertStreamedProfileInputTx(client,input);
      return readStreamedGenerationTx(client,input,index);
    });
  }
}
