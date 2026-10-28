import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {STREAMED_PROFILE_LIMITS as limits,StreamedProfileInputSchema,StreamedProfileGenerationSchema,
  StreamingVectorPayloadSchema,
  type StreamedProfileInput,type StreamedProfileGeneration} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,yieldUspJobAttempt,
  recordUspJobFailure,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {ingestionBinding,assertIngestionBinding} from './events';
import {lockStreamingRowsTx} from './streaming-vector';
import {streamingSlot} from './streaming-vector';
import {advanceStreamedInventory,emptyInventory} from './streamed-profile-inventory';
import {assertStreamedProfileInputTx,readStreamedGenerationTx,streamedGenerationHash} from './streamed-profile';
import {queueIntakeLargeTx} from './intake-large';

type RawChunkPin=Pick<StreamedProfileInput,
  'rawJobId'|'caseId'|'sourceId'|'sourceRevision'|'sourceSha256'|'subject'|'accessBinding'>;
/** Internal read under the caller's source/raw state/slot locks; mapping revalidates again before its write. */
export async function readPinnedRawChunk(input:RawChunkPin,row:Parameters<typeof streamingSlot>[0]){
  const binding=ingestionBinding(input.caseId),slot=streamingSlot(row);
  if(binding.subject!==input.subject||binding.access!==input.accessBinding)
    throw new AppError(403,'STREAMING_READ_BINDING','The draft belongs to another private access context.');
  if(!slot.ref)return {slot,payload:null};
  const bytes=Buffer.from(await readObject(slot.ref.key));
  if(bytes.length!==slot.ref.bytes||sha256(bytes)!==slot.ref.sha256)
    throw new AppError(422,'STREAMING_CHUNK_INTEGRITY','The private draft differs from its immutable receipt.');
  const payload=StreamingVectorPayloadSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(payload.jobId!==input.rawJobId||payload.sourceId!==input.sourceId
    ||payload.sourceRevision!==input.sourceRevision||payload.sourceSha256!==input.sourceSha256
    ||payload.chunkIndex!==slot.chunkIndex)
    throw new AppError(422,'STREAMING_CHUNK_INTEGRITY','The private draft belongs to another source pin.');
  assertIngestionBinding(binding);
  return {slot,payload};
}

type RawChunk=Awaited<ReturnType<typeof readPinnedRawChunk>>;
function buildGeneration(input:StreamedProfileInput,index:number,previous:StreamedProfileGeneration|null,
  values:ReturnType<typeof advanceStreamedInventory>['inventory'],locators:StreamedProfileGeneration['quarantineLocators'],
  rawChunkIndex:number|null,rawResultSha256:string|null,coverage:'provisional'|'sealed',
  reference:Omit<StreamedProfileGeneration['reference'],'globalPlacement'>){
  const placeholder='0'.repeat(64),candidate={version:limits.version,jobId:input.jobId,rawJobId:input.rawJobId,
    source:{sourceId:input.sourceId,familyId:input.sourceFamilyId,sourceRevision:input.sourceRevision,
      sourceSha256:input.sourceSha256,schemaFingerprint:placeholder},readerSha256:input.readerSha256,
    profilerSha256:input.profilerSha256,generation:index,generationHash:placeholder,
    previousHash:previous?.generationHash??null,coverage,rawChunkIndex,rawResultSha256,
    recordsSeen:values.recordsSeen,accepted:values.accepted,quarantined:values.quarantined,
    paths:values.paths,geometryTypes:values.geometryTypes,
    unknownRemainder:coverage!=='sealed',quarantineLocators:locators,
    reference:{...reference,globalPlacement:'not_qualified' as const}};
  const generationHash=streamedGenerationHash(candidate),body=StreamedProfileGenerationSchema.parse({...candidate,
    generationHash,source:{...candidate.source,schemaFingerprint:generationHash}});
  if(Buffer.byteLength(JSON.stringify(body))>limits.bodyBytes)
    throw new AppError(413,'STREAMED_PROFILE_BODY_BUDGET','The cumulative source inventory exceeds this bounded profile.');
  return body;
}
/** A small file's inspection, or a large file's sealed map receipt, states the declared system and its unit. */
function sourceReference(source:{profile:string;inspection:any}){
  const text=(value:unknown,limit:number)=>typeof value==='string'?value.slice(0,limit):null;
  const gis=source.profile==='geojson-manual-v1'?source.inspection?.gis:null;
  if(gis)return {sourceCrs:text(gis.sourceCrs,100),evidence:text(gis.crsEvidence,200),unit:text(gis.crsUnit,80)};
  const receipt=source.profile==='large-original-v1'?source.inspection?.streamedMapReceipt?.reference:null;
  if(!receipt)return {sourceCrs:null,evidence:null};
  return {sourceCrs:text(receipt.authority??receipt.sourceCrs,100),evidence:text(receipt.evidence,200),
    unit:receipt.coordinateUnit==='unknown'?null:text(receipt.coordinateUnit,80)};
}
async function window(input:StreamedProfileInput,prepare=false,attempt?:UspJobAttempt){
  const result=await transaction(async client=>{
    const {ctx}=await assertStreamedProfileInputTx(client,input);
    if(attempt)await assertUspJobAttemptTx(client,attempt);
    if(prepare){
      const job=(await client.query('SELECT status,dispatched_at FROM jobs WHERE id=$1 FOR UPDATE',[input.jobId])).rows[0];
      await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[input.jobId]);
      const active=(await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
        AND state='active' AND lease_until>now() LIMIT 1`,[input.jobId])).rowCount;
      if(active||!['queued','running'].includes(job?.status))return null;
      if(!job.dispatched_at)
        await client.query('UPDATE usp_streamed_profile_imports SET updated_at=now() WHERE job_id=$1',[input.jobId]);
      await client.query('UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()) WHERE id=$1',[input.jobId]);
    }
    const state=(await client.query(`SELECT *,updated_at<=now()-($2*interval '1 millisecond') expired
      FROM usp_streamed_profile_imports WHERE job_id=$1 FOR ${attempt?'UPDATE':'SHARE'}`,
      [input.jobId,limits.waitMs])).rows[0];
    if(!state)conflict('The streamed profile state is unavailable.');
    const raw=(await client.query('SELECT state,issue_code,sealed_chunks,records,accepted,quarantined,unknown_remainder FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
      [input.rawJobId])).rows[0];
    if(!raw)conflict('The source streaming state is unavailable.');
    const slot=(await client.query(`SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1
      AND source_revision=$2 AND chunk_index=$3 AND published=true FOR SHARE`,
      [input.rawJobId,input.sourceRevision,state.next_raw_index])).rows[0]??null;
    if(attempt&&raw.issue_code==='STREAMING_SOURCE_INTEGRITY')
      throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The retained original failed its pinned integrity check.');
    if(attempt&&slot?.object_key&&state.state!=='running')conflict('The profile publication pointer changed.');
    const progress=attempt&&slot?.object_key
      ?await publishReadyTx(client,input,attempt,slot,Number(state.next_raw_index),ctx.source)
      :{consumed:0,failure:undefined};
    return {index:Number(state.next_raw_index),expired:state.expired,raw,slot,...progress};
  });
  // A bad part cannot roll back the already published neighbouring prefix, or be skipped on retry.
  if(result?.failure)throw result.failure;
  return result;
}
/** At most eight ready parts share source/attempt locks, with no wait for unpublished data. */
async function publishReadyTx(client:PoolClient,input:StreamedProfileInput,attempt:UspJobAttempt,
  first:Parameters<typeof readPinnedRawChunk>[1],index:number,source:Parameters<typeof sourceReference>[0]){
  let consumed=0,failure:unknown;
  for(let row=first;row?.object_key&&consumed<8;){
    await client.query('SAVEPOINT profile_part');
    try{
      const chunk=await readPinnedRawChunk(input,row);
      await assertUspJobAttemptTx(client,attempt);
      await publishChunkTx(client,input,attempt,chunk,source);
    }catch(error){
      await client.query('ROLLBACK TO SAVEPOINT profile_part');
      failure=error;
      break;
    }
    await client.query('RELEASE SAVEPOINT profile_part');
    consumed++;
    if(consumed<8)row=(await client.query(`SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1
      AND source_revision=$2 AND chunk_index=$3 AND published=true FOR SHARE`,
      [input.rawJobId,input.sourceRevision,index+consumed])).rows[0];
  }
  return {consumed,failure};
}
async function publishChunkTx(client:PoolClient,input:StreamedProfileInput,attempt:UspJobAttempt,
  rawChunk:RawChunk,source:Parameters<typeof sourceReference>[0]){
  const {slot,payload}=rawChunk;
  if(!slot.ref||!payload)conflict('A published source chunk needs its immutable payload.');
  const previous=slot.chunkIndex?await readStreamedGenerationTx(client,input,slot.chunkIndex-1):null;
  const prior=previous??emptyInventory();
  if(prior.recordsSeen!==slot.firstFeatureIndex||payload.records.length!==slot.records)
    conflict('The raw feature index is not contiguous with the profile.');
  const {inventory,quarantineLocators}=advanceStreamedInventory(prior,payload.records);
  const retainedLocators=[...(previous?.quarantineLocators??[]),...quarantineLocators]
    .slice(0,limits.quarantineLocators);
  const body=buildGeneration(input,slot.chunkIndex,previous,inventory,retainedLocators,slot.chunkIndex,
    slot.resultSha256,'provisional',sourceReference(source));
  await client.query(`INSERT INTO usp_streamed_profile_generations(job_id,generation,raw_chunk_index,raw_result_sha256,
    body,body_sha256,sealed,attempt,fence) VALUES($1,$2,$3,$4,$5,$6,false,$7,$8)`,
    [input.jobId,slot.chunkIndex,slot.chunkIndex,slot.resultSha256,body,fingerprint(body),
      attempt.number,attempt.fence]);
  await client.query(`UPDATE usp_streamed_profile_imports
    SET next_raw_index=next_raw_index+1,updated_at=clock_timestamp() WHERE job_id=$1`,[input.jobId]);
  await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.generation',sourceId:input.sourceId,
    sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,generation:body.generation,
    generationHash:body.generationHash,coverage:'provisional',recordsSeen:body.recordsSeen},input.subject);
  await queueIntakeLargeTx(client,input.sourceId);
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
    return buildGeneration(input,state.next_raw_index,previous,prior,previous?.quarantineLocators??[],null,null,'sealed',
      sourceReference(ctx.source));
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
      await queueIntakeLargeTx(client,input.sourceId);
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
    await queueIntakeLargeTx(client,input.sourceId);
  });
}
/** Waiting returns admission after 2 seconds; only publication advances the live no-chunk clock. */
async function waitForSource(input:StreamedProfileInput,attempt?:UspJobAttempt){
  await transaction(async client=>{
    await assertStreamedProfileInputTx(client,input);
    if(attempt)await assertUspJobAttemptTx(client,attempt);
    else{
      const job=(await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE',[input.jobId])).rows[0];
      await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[input.jobId]);
      const active=(await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
        AND state='active' AND lease_until>now() LIMIT 1`,[input.jobId])).rowCount;
      if(active||!['queued','running'].includes(job?.status))return;
      await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",
        [input.jobId]);
      await client.query(`UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds',error=NULL
        WHERE id=$1`,[input.jobId]);
    }
    await client.query("UPDATE usp_streamed_profile_imports SET state='queued',issue_code=NULL WHERE job_id=$1",
      [input.jobId]);
  });
  if(attempt)await yieldUspJobAttempt(attempt);
}
async function retry(input:StreamedProfileInput,attempt:UspJobAttempt,code:string){
  await transaction(async client=>{
    await assertStreamedProfileInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",[input.jobId,attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query("UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds',error=$2 WHERE id=$1",[input.jobId,code]);
    await client.query("UPDATE usp_streamed_profile_imports SET state='queued',issue_code=$2 WHERE job_id=$1",[input.jobId,code]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:'queued'},input.subject);
  });
}

/** A bounded consumer of published immutable AI-02 chunks, never the original byte stream. */
export async function runStreamedProfileJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='streamed-profile'",[jobId])).rows[0];
  if(!job||!['queued','running'].includes(job.status))return;
  const input=StreamedProfileInputSchema.parse(job.payload);
  try{
    const next=await window(input,true);
    if(!next)return;
    if(!next.slot&&!['completed','completed_with_rejections','failed','stale'].includes(next.raw.state)){
      if(next.expired)await fail(input,null,'STREAMED_PROFILE_SOURCE_WAIT');
      else await waitForSource(input);
      return;
    }
  }catch(error){
    if(error instanceof AppError&&[403,404,409].includes(error.status))
      await fail(input,null,'STREAMED_PROFILE_CONTEXT_STALE',true);
    else throw error;
    return;
  }
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`streamed-profile:${randomUUID()}`,
    client=>assertStreamedProfileInputTx(client,input).then(()=>{}));}
  catch(error){
    const stale=error instanceof AppError&&[403,404,409].includes(error.status);
    if(stale||error instanceof AppError&&error.code==='USP_JOB_ATTEMPTS')
      await fail(input,null,stale?'STREAMED_PROFILE_CONTEXT_STALE':'STREAMED_PROFILE_ATTEMPTS',stale);
    return;
  }
  let lastHeartbeat=Date.now();
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
      await client.query("UPDATE usp_streamed_profile_imports SET state='running',issue_code=NULL WHERE job_id=$1",[jobId]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'streamed-profile.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,rawJobId:input.rawJobId,status:'running'},input.subject);
    });
    while(true){
      await pulse();const next=await window(input,false,attempt);
      if(!next)return;
      if(next.consumed)continue;
      if(next.slot){await fail(input,attempt,next.slot.issue_code??'RAW_STREAM_FAILED');return;}
      if(['completed','completed_with_rejections'].includes(next.raw.state)){await seal(input,attempt);return;}
      if(['failed','stale'].includes(next.raw.state)){
        await fail(input,attempt,next.raw.issue_code??'RAW_STREAM_FAILED',next.raw.state==='stale');return;
      }
      if(next.expired){await fail(input,attempt,'STREAMED_PROFILE_SOURCE_WAIT');return;}
      await waitForSource(input,attempt);return;
    }
  }catch(error){
    const code=error instanceof AppError?error.code:'STREAMED_PROFILE_WORKER_ERROR';
    const stale=error instanceof AppError&&[403,404,409].includes(error.status);
    try{
      await recordUspJobFailure(attempt,code,error);
      const spent=Number((await query('SELECT attempts FROM jobs WHERE id=$1',[jobId])).rows[0]?.attempts??3);
      if(stale||spent>=3||error instanceof AppError&&[413,422].includes(error.status))
      await fail(input,attempt,stale?'STREAMED_PROFILE_CONTEXT_STALE':code,stale);
    else await retry(input,attempt,code);}catch{/* A newer fence owns durable state. */}
  }
}
