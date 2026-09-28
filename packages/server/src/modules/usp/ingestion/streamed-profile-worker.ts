import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {STREAMED_PROFILE_LIMITS as limits,StreamedProfileInputSchema,StreamedProfileGenerationSchema,
  type StreamedProfileInput,type StreamedProfileGeneration} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,
  type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {StreamingVectorService,lockStreamingRowsTx} from './streaming-vector';
import {advanceStreamedInventory,emptyInventory} from './streamed-profile-inventory';
import {assertStreamedProfileInputTx,readStreamedGenerationTx,streamedGenerationHash} from './streamed-profile';

const rawService=new StreamingVectorService(),pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type RawChunk=Awaited<ReturnType<StreamingVectorService['chunk']>>;
function buildGeneration(input:StreamedProfileInput,index:number,previous:StreamedProfileGeneration|null,
  values:ReturnType<typeof advanceStreamedInventory>['inventory'],locators:StreamedProfileGeneration['quarantineLocators'],
  rawChunkIndex:number|null,rawResultSha256:string|null,coverage:'provisional'|'sealed',sourceCrs:string|null,evidence:string|null){
  const placeholder='0'.repeat(64),candidate={version:limits.version,jobId:input.jobId,rawJobId:input.rawJobId,
    source:{sourceId:input.sourceId,familyId:input.sourceFamilyId,sourceRevision:input.sourceRevision,
      sourceSha256:input.sourceSha256,schemaFingerprint:placeholder},readerSha256:input.readerSha256,
    profilerSha256:input.profilerSha256,generation:index,generationHash:placeholder,
    previousHash:previous?.generationHash??null,coverage,rawChunkIndex,rawResultSha256,
    recordsSeen:values.recordsSeen,accepted:values.accepted,quarantined:values.quarantined,
    paths:values.paths,geometryTypes:values.geometryTypes,
    unknownRemainder:coverage!=='sealed',quarantineLocators:locators,
    reference:{sourceCrs,evidence,globalPlacement:'not_qualified' as const}};
  const generationHash=streamedGenerationHash(candidate),body=StreamedProfileGenerationSchema.parse({...candidate,
    generationHash,source:{...candidate.source,schemaFingerprint:generationHash}});
  if(Buffer.byteLength(JSON.stringify(body))>limits.bodyBytes)
    throw new AppError(413,'STREAMED_PROFILE_BODY_BUDGET','The cumulative source inventory exceeds this bounded profile.');
  return body;
}
async function window(input:StreamedProfileInput){
  return transaction(async client=>{
    await assertStreamedProfileInputTx(client,input);
    const state=(await client.query('SELECT next_raw_index FROM usp_streamed_profile_imports WHERE job_id=$1 FOR SHARE',
      [input.jobId])).rows[0];
    if(!state)conflict('The streamed profile state is unavailable.');
    const raw=(await client.query('SELECT state,issue_code,sealed_chunks,records,accepted,quarantined,unknown_remainder FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
      [input.rawJobId])).rows[0];
    if(!raw)conflict('The source streaming state is unavailable.');
    const slot=(await client.query('SELECT chunk_index,result_sha256 FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 AND published=true FOR SHARE',
      [input.rawJobId,input.sourceRevision,state.next_raw_index])).rows[0]??null;
    return {index:Number(state.next_raw_index),raw,slot};
  });
}
async function publishChunk(input:StreamedProfileInput,attempt:UspJobAttempt,rawChunk:RawChunk){
  const {slot,payload}=rawChunk;
  if(!slot.ref||!payload)conflict('A published source chunk needs its immutable payload.');
  await transaction(async client=>{
    const {ctx}=await assertStreamedProfileInputTx(client,input);
    await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_streamed_profile_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state||state.state!=='running'||state.next_raw_index!==slot.chunkIndex)
      conflict('The profile publication pointer changed.');
    const rawSlot=(await client.query('SELECT result_sha256,published FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 FOR SHARE',
      [input.rawJobId,input.sourceRevision,slot.chunkIndex])).rows[0];
    if(!rawSlot?.published||rawSlot.result_sha256!==slot.resultSha256)
      conflict('The immutable raw slot changed before profile publication.');
    const previous=slot.chunkIndex?await readStreamedGenerationTx(client,input,slot.chunkIndex-1):null;
    const prior=previous??emptyInventory();
    if(prior.recordsSeen!==slot.firstFeatureIndex||payload.records.length!==slot.records)
      conflict('The raw feature index is not contiguous with the profile.');
    const {inventory,quarantineLocators}=advanceStreamedInventory(prior,payload.records);
    const gis=ctx.source.profile==='geojson-manual-v1'?ctx.source.inspection?.gis:null;
    const retainedLocators=[...(previous?.quarantineLocators??[]),...quarantineLocators]
      .slice(0,limits.quarantineLocators);
    const body=buildGeneration(input,slot.chunkIndex,previous,inventory,retainedLocators,slot.chunkIndex,
      slot.resultSha256,'provisional',typeof gis?.sourceCrs==='string'?gis.sourceCrs:null,
      typeof gis?.crsEvidence==='string'?gis.crsEvidence.slice(0,200):null);
    await client.query(`INSERT INTO usp_streamed_profile_generations(job_id,generation,raw_chunk_index,raw_result_sha256,
      body,body_sha256,sealed,attempt,fence) VALUES($1,$2,$3,$4,$5,$6,false,$7,$8)`,
      [input.jobId,slot.chunkIndex,slot.chunkIndex,slot.resultSha256,body,fingerprint(body),attempt.number,attempt.fence]);
    await client.query('UPDATE usp_streamed_profile_imports SET next_raw_index=next_raw_index+1,updated_at=now() WHERE job_id=$1',
      [input.jobId]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.generation',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,generation:body.generation,
      generationHash:body.generationHash,coverage:'provisional',recordsSeen:body.recordsSeen},input.subject);
  });
}
async function seal(input:StreamedProfileInput,attempt:UspJobAttempt){
  const prepared=await transaction(async client=>{
    const {ctx}=await assertStreamedProfileInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_streamed_profile_imports WHERE job_id=$1 FOR SHARE',[input.jobId])).rows[0];
    const raw=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',[input.rawJobId])).rows[0];
    if(!raw||!['completed','completed_with_rejections'].includes(raw.state)||raw.unknown_remainder
      ||state.next_raw_index!==raw.sealed_chunks)conflict('The raw stream has not reached verified closure.');
    const previous=state.next_raw_index?await readStreamedGenerationTx(client,input,state.next_raw_index-1):null;
    const prior=previous??emptyInventory();
    if(prior.recordsSeen!==raw.records||prior.accepted!==raw.accepted||prior.quarantined!==raw.quarantined)
      conflict('The complete profile differs from the sealed raw coverage.');
    const gis=ctx.source.profile==='geojson-manual-v1'?ctx.source.inspection?.gis:null;
    return buildGeneration(input,state.next_raw_index,previous,prior,previous?.quarantineLocators??[],null,null,'sealed',
      typeof gis?.sourceCrs==='string'?gis.sourceCrs:null,
      typeof gis?.crsEvidence==='string'?gis.crsEvidence.slice(0,200):null);
  });
  await acceptUspJobAttempt(attempt,{assetId:`streamed-profile:${input.jobId}`,version:1,sha256:prepared.generationHash},
    async client=>{
      const state=(await client.query('SELECT * FROM usp_streamed_profile_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
      const raw=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',[input.rawJobId])).rows[0];
      if(state?.state!=='running'||state.next_raw_index!==prepared.generation||raw?.sealed_chunks!==prepared.generation
        ||raw?.records!==prepared.recordsSeen||raw?.accepted!==prepared.accepted
        ||raw?.quarantined!==prepared.quarantined||raw?.unknown_remainder)
        conflict('The sealed profile changed before acceptance.');
      const previous=prepared.generation?await readStreamedGenerationTx(client,input,prepared.generation-1):null;
      if((previous?.generationHash??null)!==prepared.previousHash)
        conflict('The profile generation chain changed before acceptance.');
    },client=>assertStreamedProfileInputTx(client,input).then(()=>{}),async client=>{
      await client.query(`INSERT INTO usp_streamed_profile_generations(job_id,generation,raw_chunk_index,raw_result_sha256,
        body,body_sha256,sealed,attempt,fence) VALUES($1,$2,NULL,NULL,$3,$4,true,$5,$6)`,
        [input.jobId,prepared.generation,prepared,fingerprint(prepared),attempt.number,attempt.fence]);
      await client.query("UPDATE usp_streamed_profile_imports SET state='sealed',sealed_generation=$2,issue_code=NULL,updated_at=now() WHERE job_id=$1",
        [input.jobId,prepared.generation]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.generation',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,generation:prepared.generation,
        generationHash:prepared.generationHash,coverage:'sealed',recordsSeen:prepared.recordsSeen},input.subject);
      await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:'sealed'},input.subject);
    });
}
async function fail(input:StreamedProfileInput,attempt:UspJobAttempt|null,code:string,stale=false){
  await transaction(async client=>{
    if(stale)await lockStreamingRowsTx(client,input.caseId,input.sourceId);
    else await assertStreamedProfileInputTx(client,input);
    if(attempt)await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT state FROM usp_streamed_profile_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state||!['queued','running'].includes(state.state))return;
    if(!attempt){
      const active=(await client.query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",
        [input.jobId])).rowCount;
      if(active)return;
    }
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[input.jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
      [input.jobId,stale?'stale':'failed',code]);
    await client.query('UPDATE usp_streamed_profile_imports SET state=$2,issue_code=$3,updated_at=now() WHERE job_id=$1',
      [input.jobId,stale?'stale':'failed',code]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:stale?'stale':'failed'},input.subject);
  });
}
async function retry(input:StreamedProfileInput,attempt:UspJobAttempt,code:string){
  await transaction(async client=>{
    await assertStreamedProfileInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",[input.jobId,attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query("UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds',error=$2 WHERE id=$1",[input.jobId,code]);
    await client.query("UPDATE usp_streamed_profile_imports SET state='queued',issue_code=$2,updated_at=now() WHERE job_id=$1",[input.jobId,code]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:'queued'},input.subject);
  });
}

/** A bounded consumer of published immutable AI-02 chunks, never the original byte stream. */
export async function runStreamedProfileJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='streamed-profile'",[jobId])).rows[0];
  if(!job||!['queued','running'].includes(job.status))return;
  const input=StreamedProfileInputSchema.parse(job.payload);
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`streamed-profile:${randomUUID()}`,
    client=>assertStreamedProfileInputTx(client,input).then(()=>{}));}
  catch(error){
    const stale=error instanceof AppError&&[403,404,409].includes(error.status);
    if(stale||error instanceof AppError&&error.code==='USP_JOB_ATTEMPTS')
      await fail(input,null,stale?'STREAMED_PROFILE_CONTEXT_STALE':'STREAMED_PROFILE_ATTEMPTS',stale);
    return;
  }
  let lastHeartbeat=Date.now(),waitStarted=Date.now();
  const pulse=async()=>{if(Date.now()-lastHeartbeat<30000)return;
    await heartbeatUspJobAttempt(attempt,client=>assertStreamedProfileInputTx(client,input).then(()=>{}));
    await transaction(async client=>{
      await assertStreamedProfileInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
      await client.query("UPDATE jobs SET next_attempt_at=now()+interval '180 seconds' WHERE id=$1",[jobId]);
    });lastHeartbeat=Date.now();};
  try{
    await transaction(async client=>{
      await assertStreamedProfileInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
      await client.query("UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()),next_attempt_at=now()+interval '180 seconds' WHERE id=$1",[jobId]);
      await client.query("UPDATE usp_streamed_profile_imports SET state='running',issue_code=NULL,updated_at=now() WHERE job_id=$1",[jobId]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,rawJobId:input.rawJobId,status:'running'},input.subject);
    });
    while(true){
      await pulse();const next=await window(input);
      if(next.slot){
        const rawChunk=await rawService.chunk(input.caseId,input.sourceId,input.rawJobId,next.index);
        if(rawChunk.slot.resultSha256!==next.slot.result_sha256)
          conflict('The published raw result changed.');
        if(!rawChunk.slot.ref){await fail(input,attempt,rawChunk.slot.issueCode??'RAW_STREAM_FAILED');return;}
        await publishChunk(input,attempt,rawChunk);waitStarted=Date.now();continue;
      }
      if(['completed','completed_with_rejections'].includes(next.raw.state)){await seal(input,attempt);return;}
      if(['failed','stale'].includes(next.raw.state)){
        await fail(input,attempt,next.raw.issue_code??'RAW_STREAM_FAILED',next.raw.state==='stale');return;
      }
      if(Date.now()-waitStarted>limits.waitMs)
        throw new AppError(503,'STREAMED_PROFILE_SOURCE_WAIT','The raw stream did not publish another chunk in time.');
      await pause(1000);
    }
  }catch(error){
    const code=error instanceof AppError?error.code:'STREAMED_PROFILE_WORKER_ERROR';
    const stale=error instanceof AppError&&[403,404,409].includes(error.status);
    try{if(stale||attempt.number>=3||error instanceof AppError&&[413,422].includes(error.status))
      await fail(input,attempt,stale?'STREAMED_PROFILE_CONTEXT_STALE':code,stale);
    else await retry(input,attempt,code);}catch{/* A newer fence owns durable state. */}
  }
}
