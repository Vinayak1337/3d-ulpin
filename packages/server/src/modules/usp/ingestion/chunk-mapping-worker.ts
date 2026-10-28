import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {AnyStreamingInputSchema,CHUNK_MAPPING_LIMITS as limits,ChunkMappingInputSchema,ChunkMappingPayloadSchema,
  type ChunkMappingInput,type ChunkMappingPayload,type StreamingVectorRecord,type AdaptiveMappingResponse} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,yieldUspJobAttempt,
  recordUspJobFailure,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {assertIngestionBinding} from './events';
import {AdaptiveMappingService,caseOriginalTeacherGate} from './adaptive-mapping-service';
import {StreamingVectorService,lockStreamingRowsTx} from './streaming-vector';
import {assertChunkMappingInputTx} from './chunk-mapping';
import {readPinnedRawChunk} from './streamed-profile-worker';
import {TabularChunkMapper} from './chunk-mapping-agent';
import {acceptTableWindow,acceptTabularDataSlot,proposeFromTableWindow} from './chunk-mapping-tabular';
import {settleTableMeaningsTx} from './chunk-mapping-tabular';
import {isWindowedTable} from './table-windows';
import {candidateKeyHashes,normalizeMappedChunk,type KeyRow,type KeyDecision} from './chunk-mapping-normalizer';
import {queueIntakeLargeTx} from './intake-large';

const rawService=new StreamingVectorService(),adaptive=new AdaptiveMappingService();
type Stored={payload:ChunkMappingPayload;bytes:number;hash:string;key:string};
/** The same durable no-chunk clock as streamed profiles: only first dispatch and publication advance it. */
async function mappingState(client:PoolClient,input:ChunkMappingInput,prepare=false){
  if(prepare){
    const job=(await client.query('SELECT status,dispatched_at FROM jobs WHERE id=$1 FOR UPDATE',[input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[input.jobId]);
    const active=(await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`,[input.jobId])).rowCount;
    if(active||!['queued','running'].includes(job?.status))return null;
    if(!job.dispatched_at)
      await client.query('UPDATE usp_chunk_mapping_imports SET updated_at=now() WHERE job_id=$1',[input.jobId]);
    await client.query('UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()) WHERE id=$1',[input.jobId]);
  }
  const state=(await client.query(`SELECT next_publish_index,updated_at<=now()-($2*interval '1 millisecond') expired
    FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR SHARE`,[input.jobId,limits.readMs])).rows[0];
  if(!state)conflict('The mapping state is unavailable.');
  return state;
}
async function keyRows(client:PoolClient,jobId:string,hashes:string[]):Promise<KeyRow[]>{
  if(!hashes.length)return [];
  return (await client.query('SELECT source_key_sha256,source_key,first_feature_index FROM usp_chunk_mapping_keys WHERE job_id=$1 AND source_key_sha256=ANY($2::text[])',
    [jobId,hashes])).rows as KeyRow[];
}
async function storePayload(payload:ChunkMappingPayload):Promise<Stored>{
  const bytes=Buffer.from(JSON.stringify(payload));
  if(bytes.length>limits.chunkBytes)throw new AppError(413,'MAPPING_CHUNK_BUDGET','A complete mapped draft chunk exceeds this profile.');
  const hash=sha256(bytes),key=`chunk-mapping/${payload.jobId}/${payload.chunkIndex}/${hash}.json`;
  try{await putOriginal(key,bytes,'application/json');}
  catch(error){
    const prior=Buffer.from(await readObject(key).catch(()=>{throw error;}));
    if(prior.length!==bytes.length||sha256(prior)!==hash)throw error;
  }
  return {payload,bytes:bytes.length,hash,key};
}
type MappingContext=Awaited<ReturnType<typeof assertChunkMappingInputTx>>;
async function window(input:ChunkMappingInput,prepare=false,attempt?:UspJobAttempt){
  const result=await transaction(async client=>{
    const current=await assertChunkMappingInputTx(client,input);
    const state=await mappingState(client,input,prepare);
    if(!state)return null;
    const raw=(await client.query('SELECT state,issue_code,sealed_chunks,records,unknown_remainder,next_publish_index FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
      [input.rawJobId])).rows[0];
    if(!raw)conflict('The source streaming state is unavailable.');
    const slot=(await client.query(`SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1
      AND source_revision=$2 AND chunk_index=$3 AND published=true FOR SHARE`,
      [input.rawJobId,input.sourceRevision,state.next_publish_index])).rows[0]??null;
    if(!prepare&&raw.issue_code==='STREAMING_SOURCE_INTEGRITY')
      throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The retained original failed its pinned integrity check.');
    const progress=slot?.object_key&&!prepare&&!input.tabular&&attempt
      ?await publishReadyMappingTx(client,input,attempt,current,slot,Number(state.next_publish_index))
      :{consumed:0,failure:undefined};
    return {index:Number(state.next_publish_index),expired:state.expired,raw,slot,...progress};
  });
  if(result?.failure)throw result.failure;
  return result;
}
/** Share source/recipe locks over at most sixteen ready parts, never waiting for a future part. A failed part
 * rolls back alone; the good prefix commits before the failure reaches retry/terminal handling. */
async function publishReadyMappingTx(client:PoolClient,input:ChunkMappingInput,attempt:UspJobAttempt,
  current:MappingContext,first:Parameters<typeof readPinnedRawChunk>[1],index:number){
  let consumed=0,failure:unknown;
  await assertUspJobAttemptTx(client,attempt);
  for(let row=first;row?.object_key&&consumed<16;){
    await client.query('SAVEPOINT mapping_part');
    try{
      const chunk=await readPinnedRawChunk(input,row);
      await acceptDataSlotTx(client,input,attempt,current,chunk);
    }catch(error){
      await client.query('ROLLBACK TO SAVEPOINT mapping_part');
      failure=error;
      break;
    }
    await client.query('RELEASE SAVEPOINT mapping_part');
    consumed++;
    if(consumed<16)row=(await client.query(`SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1
      AND source_revision=$2 AND chunk_index=$3 AND published=true FOR SHARE`,
      [input.rawJobId,input.sourceRevision,index+consumed])).rows[0];
  }
  // Database pins stayed locked across storage I/O; recheck deployed code and access before committing.
  await assertChunkMappingInputTx(client,input);
  if(consumed)await queueIntakeLargeTx(client,input.sourceId);
  return {consumed,failure};
}
async function acceptDataSlotTx(client:PoolClient,input:ChunkMappingInput,attempt:UspJobAttempt,
  current:MappingContext,rawChunk:Awaited<ReturnType<typeof readPinnedRawChunk>>){
  const {profile,approved}=current;
  if(!profile||!approved||profile.version==='manual-tabular/1'||approved.receipt.plan.version==='manual-tabular/1')
    conflict('An approved GIS source recipe is required.');
  const slot=rawChunk.slot,payload=rawChunk.payload;
  if(!payload||!slot.ref)conflict('A data slot requires its immutable raw payload.');
  const prepared=normalizeMappedChunk(payload.records,approved.receipt.plan,profile,input.rawJobId,slot.chunkIndex,
    await keyRows(client,input.jobId,candidateKeyHashes(payload.records,approved.receipt.plan)));
  const mapped=ChunkMappingPayloadSchema.parse({version:limits.version,jobId:input.jobId,rawJobId:input.rawJobId,
    sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,
    chunkIndex:slot.chunkIndex,rawResultSha256:slot.resultSha256,schemaFingerprint:prepared.schemaFingerprint,
    recipeRevision:input.recipeRevision,
    converterSha256:input.converterSha256,
    ...(input.profileHash?{profileHash:input.profileHash}:{}),
    ...(input.prefixAdmissionVersion?{prefixAdmissionVersion:input.prefixAdmissionVersion}:{}),
    records:prepared.records});
  const stored=await storePayload(mapped);
  // The source, recipe and this job's key writer remain locked in the same transaction as preparation.
  assertIngestionBinding(current.ctx.binding);
  await assertUspJobAttemptTx(client,attempt);
  const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',
    [input.jobId])).rows[0];
  if(!state||state.state!=='running'||state.next_publish_index!==slot.chunkIndex
    ||state.records!==slot.firstFeatureIndex)
    conflict('The mapped publication pointer or source index changed.');
  // The raw slot's SHARE lock and the job's exclusive attempt lock span preparation and storage. Neither
  // the raw receipt nor another fenced key writer can move, so the same decisions need no second read/fold.
  const normalized=prepared.records.filter(item=>item.disposition==='observed').length;
  const quarantined=prepared.records.filter(item=>item.disposition==='quarantined').length;
  const unresolved=prepared.records.length-normalized-quarantined;
  await client.query(`INSERT INTO usp_chunk_mapping_slots(job_id,chunk_index,status,published,raw_result_sha256,
    schema_fingerprint,schema_drift,first_feature_index,last_feature_index,records,normalized,quarantined,unresolved,
    bytes,object_key,object_sha256,issue_code,result_sha256,attempt,fence)
    VALUES($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL,$16,$17,$18)`,
    [input.jobId,slot.chunkIndex,normalized?'ready':'quarantined',slot.resultSha256,prepared.schemaFingerprint,
      prepared.schemaDrift,slot.firstFeatureIndex,slot.lastFeatureIndex,prepared.records.length,normalized,quarantined,
      unresolved,stored.bytes,stored.key,stored.hash,stored.hash,attempt.number,attempt.fence]);
  await reserveMappedKeysTx(client,input.jobId,prepared.keys);
  await client.query(`UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1,records=records+$2,
    normalized=normalized+$3,quarantined=quarantined+$4,unresolved=unresolved+$5,duplicate_keys=duplicate_keys+$6,
    baseline_schema_fingerprint=COALESCE(baseline_schema_fingerprint,$7),schema_drift_chunks=schema_drift_chunks+$8,
    updated_at=clock_timestamp() WHERE job_id=$1`,[input.jobId,prepared.records.length,normalized,quarantined,
    unresolved,prepared.keys.filter(item=>item.laterIndex!==null).length,prepared.schemaFingerprint,
    prepared.schemaDrift?1:0]);
  await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.chunk',sourceId:input.sourceId,
    sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,
    chunkIndex:slot.chunkIndex,status:normalized?'ready':'quarantined',resultSha256:stored.hash,
    records:prepared.records.length,sourceComplete:false},input.subject);
}
/** The bounded chunk's decisions are already reproduced under the publication lock, in source order. */
export async function reserveMappedKeysTx(client:PoolClient,jobId:string,keys:KeyDecision[]){
  const first=keys.filter(key=>key.laterIndex===null),later=keys.filter(key=>key.laterIndex!==null);
  if(first.length)await client.query(`INSERT INTO usp_chunk_mapping_keys
    (job_id,source_key_sha256,source_key,first_feature_index)
    SELECT $1,hash,value,first_index FROM unnest($2::text[],$3::text[],$4::int[]) AS k(hash,value,first_index)`,
    [jobId,first.map(key=>key.hash),first.map(key=>key.value),first.map(key=>key.firstIndex)]);
  if(!later.length)return;
  await client.query(`UPDATE usp_chunk_mapping_keys SET conflicted=true
    FROM unnest($2::text[],$3::text[]) AS k(hash,value)
    WHERE job_id=$1 AND source_key_sha256=k.hash AND source_key=k.value`,
    [jobId,later.map(key=>key.hash),later.map(key=>key.value)]);
  await client.query(`INSERT INTO usp_chunk_mapping_conflicts
    (job_id,later_feature_index,first_feature_index,source_key_sha256)
    SELECT $1,later_index,first_index,hash FROM unnest($2::int[],$3::int[],$4::text[])
    AS k(later_index,first_index,hash)`,
    [jobId,later.map(key=>key.laterIndex),later.map(key=>key.firstIndex),later.map(key=>key.hash)]);
}

async function terminal(input:ChunkMappingInput,attempt:UspJobAttempt,code:string,stale=false,rawResultSha:string|null=null){
  await transaction(async client=>{
    if(stale||code==='STREAMING_SOURCE_INTEGRITY')await lockStreamingRowsTx(client,input.caseId,input.sourceId);
    else await assertChunkMappingInputTx(client,input);
    if(code==='STREAMING_SOURCE_INTEGRITY'){
      const raw=(await client.query('SELECT issue_code FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
        [input.rawJobId])).rows[0];
      if(raw?.issue_code!==code)conflict('The raw source integrity issue changed.');
    }
    await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state)conflict('The mapping state is unavailable.');
    if(!stale){
      const hash=fingerprint({version:limits.version,jobId:input.jobId,chunkIndex:state.next_publish_index,
        firstFeatureIndex:state.records,code,rawResultSha});
      await client.query(`INSERT INTO usp_chunk_mapping_slots(job_id,chunk_index,status,published,raw_result_sha256,
        first_feature_index,last_feature_index,records,normalized,quarantined,unresolved,bytes,issue_code,result_sha256,attempt,fence)
        VALUES($1,$2,'quarantined',true,$3,$4,NULL,0,0,0,0,0,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [input.jobId,state.next_publish_index,rawResultSha,state.records,code,hash,attempt.number,attempt.fence]);
      await client.query('UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1 WHERE job_id=$1',[input.jobId]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.chunk',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,
        chunkIndex:state.next_publish_index,status:'quarantined',resultSha256:hash,records:0,sourceComplete:false},input.subject);
    }
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",[input.jobId,attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[input.jobId,stale?'stale':'failed',code]);
    await client.query('UPDATE usp_chunk_mapping_imports SET state=$2,issue_code=$3,unknown_remainder=true,updated_at=now() WHERE job_id=$1',
      [input.jobId,stale?'stale':'failed',code]);
    if(!stale)await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:'failed'},input.subject);
    await settleTableMeaningsTx(client,input,{failed:code});
    await queueIntakeLargeTx(client,input.sourceId);
  });
}
async function retry(input:ChunkMappingInput,attempt:UspJobAttempt,code:string){
  await transaction(async client=>{
    await assertChunkMappingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",[input.jobId,attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query("UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds',error=$2 WHERE id=$1",[input.jobId,code]);
    await client.query("UPDATE usp_chunk_mapping_imports SET state='queued',issue_code=$2,updated_at=now() WHERE job_id=$1",[input.jobId,code]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:'queued'},input.subject);
  });
}
async function propose(input:ChunkMappingInput,attempt:UspJobAttempt){
  const current=await transaction(client=>assertChunkMappingInputTx(client,input));
  let proposal:AdaptiveMappingResponse|null=null,status:'needs_input'|'disabled'|'unavailable'='needs_input',code='MAPPING_PROFILE_UNSUPPORTED';
  if(current.profile?.version==='manual-geojson/1'){
    const gate=caseOriginalTeacherGate();
    const profile=current.profile;
    proposal=gate.allowed
      ?await adaptive.propose(input.caseId,input.sourceId,{requestKey:input.jobId,
        source:profile.source,workspaceRevision:profile.workspaceRevision,
        workspaceFingerprint:profile.workspaceFingerprint})
      :{version:'adaptive-geojson-proposal/1',requestKey:input.jobId,source:profile.source,
        workspaceRevision:profile.workspaceRevision,workspaceFingerprint:profile.workspaceFingerprint,
        status:'needs_input',code:gate.code,plan:null,validationErrors:[gate.words],call:null,
        validation:'mechanics_only',reviewRequired:true};
    status=proposal.status==='disabled'?'disabled':proposal.status==='unavailable'?'unavailable':'needs_input';
    code=proposal.code??'MAPPING_REVIEW_REQUIRED';
  }else if(current.profile?.version==='streamed-profile/1'){
    code='STREAMED_PROFILE_REVIEW_REQUIRED';
  }
  const resultHash=fingerprint({version:limits.version,jobId:input.jobId,status,code,proposal});
  await acceptUspJobAttempt(attempt,{assetId:`chunk-mapping:${input.jobId}`,version:1,sha256:resultHash},
    async(client)=>{
      const state=(await client.query('SELECT state,next_publish_index FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
      if(state?.state!=='running'||state.next_publish_index!==0)conflict('The proposal job changed before acceptance.');
    },client=>assertChunkMappingInputTx(client,input).then(()=>{}),async client=>{
      await client.query('UPDATE usp_chunk_mapping_imports SET state=$2,issue_code=$3,proposal=$4,updated_at=now() WHERE job_id=$1',
        [input.jobId,status,code,proposal]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status},input.subject);
    });
}
/** G13: a raw job that writes table windows instead of slots; read from its own immutable input receipt. */
async function rawWindowed(input:ChunkMappingInput){
  const row=(await query("SELECT payload FROM jobs WHERE id=$1 AND operation='streaming-vector'",[input.rawJobId])).rows[0];
  const raw=AnyStreamingInputSchema.safeParse(row?.payload);
  return raw.success&&isWindowedTable(raw.data);
}
async function tableWindowState(input:ChunkMappingInput,prepare=false){
  return transaction(async client=>{
    await assertChunkMappingInputTx(client,input);
    const state=await mappingState(client,input,prepare);
    if(!state)return null;
    const raw=(await client.query('SELECT state,issue_code FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
      [input.rawJobId])).rows[0];
    if(!state||!raw)conflict('The mapping or source streaming state is unavailable.');
    const written=(await client.query('SELECT 1 FROM usp_table_windows WHERE job_id=$1 AND window_index=$2',
      [input.rawJobId,state.next_publish_index])).rowCount===1;
    return {index:Number(state.next_publish_index),expired:state.expired,raw,written};
  });
}
/** The proposal for a streamed table is its first window's sample; every window is mapped after approval. */
async function proposeTableEnd(input:ChunkMappingInput,attempt:UspJobAttempt){
  const code='TABLE_WINDOWS_RECIPE_REQUIRED';
  const resultHash=fingerprint({version:limits.version,jobId:input.jobId,status:'needs_input',code,windowed:true});
  await acceptUspJobAttempt(attempt,{assetId:`chunk-mapping:${input.jobId}`,version:1,sha256:resultHash},
    async(client)=>{
      const state=(await client.query('SELECT state,next_publish_index FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',
        [input.jobId])).rows[0];
      if(state?.state!=='running'||state.next_publish_index!==1)conflict('The proposal job changed before acceptance.');
    },client=>assertChunkMappingInputTx(client,input).then(()=>{}),async client=>{
      await client.query("UPDATE usp_chunk_mapping_imports SET state='needs_input',issue_code=$2,updated_at=now() WHERE job_id=$1",
        [input.jobId,code]);
      await settleTableMeaningsTx(client,input,'unavailable');
      await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:'needs_input'},input.subject);
    });
}
type CompletionState={quarantined:number;unresolved:number;duplicate_keys:number;schema_drift_chunks:number;
  refused:boolean};
/** Draft interpretation is not refusal: unresolved table rows survive a closed source as a count. */
function tabularCompletionStatus(state:CompletionState){
  return state.quarantined>0||state.refused?'completed_with_rejections':'completed';
}
/** For records, unresolved, duplicate or drifted chunks are real import problems. */
function gisCompletionStatus(state:CompletionState){
  return state.quarantined||state.unresolved||state.duplicate_keys||state.schema_drift_chunks
    ?'completed_with_rejections':'completed';
}

export function chunkMappingCompletionStatus(kind:'tabular'|'gis',state:CompletionState){
  return kind==='tabular'?tabularCompletionStatus(state):gisCompletionStatus(state);
}

export async function finishChunkMappingTx(client:PoolClient,input:ChunkMappingInput){
  const state=(await client.query(`SELECT quarantined,unresolved,duplicate_keys,schema_drift_chunks,EXISTS(SELECT 1
    FROM usp_chunk_mapping_slots WHERE job_id=$1 AND published=true AND status='quarantined' AND records=0
    AND issue_code IS NOT NULL) refused FROM usp_chunk_mapping_imports WHERE job_id=$1`,[input.jobId])).rows[0];
  const status=chunkMappingCompletionStatus(input.tabular?'tabular':'gis',state);
  await client.query('UPDATE usp_chunk_mapping_imports SET state=$2,issue_code=NULL,updated_at=now() WHERE job_id=$1',
    [input.jobId,status]);
  await settleTableMeaningsTx(client,input,'unavailable');
  await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
    sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status},input.subject);
}

async function complete(input:ChunkMappingInput,attempt:UspJobAttempt){
  const sealed=await transaction(async client=>{
    await assertChunkMappingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    const raw=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',[input.rawJobId])).rows[0];
    if(!raw||!['completed','completed_with_rejections'].includes(raw.state)||raw.unknown_remainder
      ||state.next_publish_index!==raw.sealed_chunks||state.records!==raw.records)
      conflict('The mapped prefix has not reached verified source closure.');
    await client.query('UPDATE usp_chunk_mapping_imports SET sealed_chunks=$2,unknown_remainder=false,updated_at=now() WHERE job_id=$1',
      [input.jobId,raw.sealed_chunks]);
    return {chunks:raw.sealed_chunks,records:raw.records};
  });
  const manifestHash=fingerprint({version:limits.version,jobId:input.jobId,rawJobId:input.rawJobId,
    sourceSha256:input.sourceSha256,recipeRevision:input.recipeRevision,converterSha256:input.converterSha256,...sealed});
  await acceptUspJobAttempt(attempt,{assetId:`chunk-mapping:${input.jobId}`,version:1,sha256:manifestHash},
    async(client)=>{
      const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
      const raw=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',[input.rawJobId])).rows[0];
      if(state?.sealed_chunks!==sealed.chunks||state.next_publish_index!==sealed.chunks
        ||state.records!==sealed.records||state.unknown_remainder||raw?.unknown_remainder)
        conflict('The complete mapped manifest is not published.');
    },client=>assertChunkMappingInputTx(client,input).then(()=>{}),async client=>{
      await finishChunkMappingTx(client,input);await queueIntakeLargeTx(client,input.sourceId);
    });
}

/** A source wait holds neither a lane reservation nor an attempt; queued imports still count toward admission. */
async function waitForSource(input:ChunkMappingInput,attempt?:UspJobAttempt){
  await transaction(async client=>{
    await assertChunkMappingInputTx(client,input);
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
    await client.query("UPDATE usp_chunk_mapping_imports SET state='queued',issue_code=NULL WHERE job_id=$1",
      [input.jobId]);
  });
  if(attempt)await yieldUspJobAttempt(attempt);
}

async function claimFailure(input:ChunkMappingInput,error:unknown){
  const stale=error instanceof AppError&&[403,404,409].includes(error.status);
  const integrity=error instanceof AppError&&error.code==='STREAMING_SOURCE_INTEGRITY';
  const waiting=error instanceof AppError&&error.code==='MAPPING_SOURCE_WAIT';
  if(!stale&&!integrity&&!waiting&&!(error instanceof AppError&&error.code==='USP_JOB_ATTEMPTS'))throw error;
  await transaction(async client=>{
    if(stale||integrity)await lockStreamingRowsTx(client,input.caseId,input.sourceId);
    else await assertChunkMappingInputTx(client,input);
    if(integrity){
      const raw=(await client.query('SELECT issue_code FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
        [input.rawJobId])).rows[0];
      if(raw?.issue_code!=='STREAMING_SOURCE_INTEGRITY')conflict('The raw source integrity issue changed.');
    }
    const job=(await client.query("SELECT status FROM jobs WHERE id=$1 AND operation='chunk-mapping' FOR UPDATE",[input.jobId])).rows[0];
    const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!job||!state||!['queued','running'].includes(job.status)||!['queued','running'].includes(state.state))return;
    const active=(await client.query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",
      [input.jobId])).rowCount;
    if(active)return;
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[input.jobId]);
    let code=stale?'MAPPING_CONTEXT_STALE':integrity?'STREAMING_SOURCE_INTEGRITY':'MAPPING_ATTEMPTS_EXHAUSTED';
    if(waiting)code='MAPPING_SOURCE_WAIT';
    if(!stale){
      const last=(await client.query('SELECT number,fence FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1',
        [input.jobId])).rows[0];
      if(last){
        const hash=fingerprint({version:limits.version,jobId:input.jobId,chunkIndex:state.next_publish_index,
          firstFeatureIndex:state.records,code});
        await client.query(`INSERT INTO usp_chunk_mapping_slots(job_id,chunk_index,status,published,raw_result_sha256,
          first_feature_index,last_feature_index,records,normalized,quarantined,unresolved,bytes,issue_code,result_sha256,attempt,fence)
          VALUES($1,$2,'quarantined',true,NULL,$3,NULL,0,0,0,0,0,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [input.jobId,state.next_publish_index,state.records,code,hash,last.number,last.fence]);
        await client.query('UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1 WHERE job_id=$1',[input.jobId]);
        await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.chunk',sourceId:input.sourceId,
          sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,
          chunkIndex:state.next_publish_index,status:'quarantined',resultSha256:hash,records:0,sourceComplete:false},input.subject);
      }
    }
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[input.jobId,stale?'stale':'failed',code]);
    await client.query('UPDATE usp_chunk_mapping_imports SET state=$2,issue_code=$3,unknown_remainder=true,updated_at=now() WHERE job_id=$1',
      [input.jobId,stale?'stale':'failed',code]);
    if(!stale)await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status:'failed'},input.subject);
    await settleTableMeaningsTx(client,input,{failed:code});
    await queueIntakeLargeTx(client,input.sourceId);
  });
}

/** One canonical fenced job consumes only published raw slots, with one bounded payload in RAM. */
export async function runChunkMappingJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='chunk-mapping'",[jobId])).rows[0];
  if(!job||!['queued','running'].includes(job.status))return;
  const input=ChunkMappingInputSchema.parse(job.payload);
  let windowed=false;
  try{
    windowed=!!input.tabular&&await rawWindowed(input);
    if(input.route!=='proposal_only'||input.tabular){
      const next=windowed?await tableWindowState(input,true):await window(input,true);
      if(!next)return;
      const ready='written' in next?next.written:next.slot;
      const proposalReady=windowed&&input.route==='proposal_only'&&next.index===1;
      if(!ready&&!proposalReady&&!['completed','completed_with_rejections','failed','stale'].includes(next.raw.state)){
        if(next.expired)await claimFailure(input,new AppError(503,'MAPPING_SOURCE_WAIT',
          'The source stream did not publish another bounded chunk in time.'));
        else await waitForSource(input);
        return;
      }
    }
  }catch(error){await claimFailure(input,error);return;}
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`chunk-mapping:${randomUUID()}`,client=>assertChunkMappingInputTx(client,input).then(()=>{}));}
  catch(error){await claimFailure(input,error);return;}
  const tabularMapper=new TabularChunkMapper();
  let lastHeartbeat=Date.now();
  const pulse=async()=>{if(Date.now()-lastHeartbeat<30000)return;
    await heartbeatUspJobAttempt(attempt,client=>assertChunkMappingInputTx(client,input).then(()=>{}));
    await transaction(async client=>{
      await assertChunkMappingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
      await client.query("UPDATE jobs SET next_attempt_at=now()+interval '180 seconds' WHERE id=$1",[jobId]);
    });lastHeartbeat=Date.now();};
  try{
    await transaction(async client=>{
      await assertChunkMappingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
      await client.query("UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()),next_attempt_at=now()+interval '180 seconds' WHERE id=$1",[jobId]);
      await client.query("UPDATE usp_chunk_mapping_imports SET state='running',issue_code=NULL WHERE job_id=$1",[jobId]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,rawJobId:input.rawJobId,status:'running'},input.subject);
    });
    if(input.route==='proposal_only'&&!input.tabular){await propose(input,attempt);return;}
    if(windowed){
      // G13: windows in order; a window the recipe cannot map is published as failed with its reason.
      while(true){
        await pulse();const next=await tableWindowState(input);
        if(!next)return;
        if(next.written){
          if(input.route==='proposal_only'){
            if(next.index===0&&await proposeFromTableWindow(input,attempt,tabularMapper,storePayload))continue;
            await proposeTableEnd(input,attempt);return;
          }
          await acceptTableWindow(input,attempt,next.index);continue;
        }
        if(input.route==='proposal_only'&&next.index===1){await proposeTableEnd(input,attempt);return;}
        if(['completed','completed_with_rejections'].includes(next.raw.state)){await complete(input,attempt);return;}
        if(['failed','stale'].includes(next.raw.state)){
          await terminal(input,attempt,next.raw.issue_code??'RAW_STREAM_FAILED');return;
        }
        if(next.expired){await terminal(input,attempt,'MAPPING_SOURCE_WAIT');return;}
        await waitForSource(input,attempt);return;
      }
    }
    while(true){
      await pulse();const next=await window(input,false,attempt);
      if(!next)return;
      if(next.consumed)continue;
      if(next.slot){
        const rawChunk=await rawService.chunk(input.caseId,input.sourceId,input.rawJobId,next.index);
        if(rawChunk.slot.resultSha256!==next.slot.result_sha256)conflict('The published raw slot changed.');
        if(!rawChunk.slot.ref){await terminal(input,attempt,rawChunk.slot.issueCode??'RAW_STREAM_FAILED',false,
          rawChunk.slot.resultSha256);return;}
        if(input.tabular)await acceptTabularDataSlot(input,attempt,rawChunk.payload!,rawChunk.slot.resultSha256,
          tabularMapper,storePayload);
        else conflict('A ready GIS part was not consumed under its publication locks.');
        continue;
      }
      if(['completed','completed_with_rejections'].includes(next.raw.state)){await complete(input,attempt);return;}
      if(['failed','stale'].includes(next.raw.state)){
        await terminal(input,attempt,next.raw.issue_code??'RAW_STREAM_FAILED');return;
      }
      if(next.expired){await terminal(input,attempt,'MAPPING_SOURCE_WAIT');return;}
      await waitForSource(input,attempt);return;
    }
  }catch(error){
    const code=error instanceof AppError?error.code:'MAPPING_WORKER_ERROR';
    const stale=error instanceof AppError&&[403,404,409].includes(error.status);
    try{
      await recordUspJobFailure(attempt,code,error);
      const spent=Number((await query('SELECT attempts FROM jobs WHERE id=$1',[jobId])).rows[0]?.attempts??3);
      if(stale)await terminal(input,attempt,'MAPPING_CONTEXT_STALE',true);
      else if(spent>=3||error instanceof AppError&&[413,422].includes(error.status))await terminal(input,attempt,code);
      else await retry(input,attempt,code);
    }catch{/* A newer fence owns durable state. */}
  }
}
