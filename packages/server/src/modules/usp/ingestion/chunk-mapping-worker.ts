import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {CHUNK_MAPPING_LIMITS as limits,ChunkMappingInputSchema,ChunkMappingPayloadSchema,
  type ChunkMappingInput,type ChunkMappingPayload,type StreamingVectorRecord,type AdaptiveMappingResponse} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {AdaptiveMappingService} from './adaptive-mapping-service';
import {StreamingVectorService,lockStreamingRowsTx} from './streaming-vector';
import {assertChunkMappingInputTx} from './chunk-mapping';
import {candidateKeyHashes,normalizeMappedChunk,type KeyRow} from './chunk-mapping-normalizer';

const rawService=new StreamingVectorService(),adaptive=new AdaptiveMappingService();
type Stored={payload:ChunkMappingPayload;bytes:number;hash:string;key:string};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
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
async function window(input:ChunkMappingInput){
  return transaction(async client=>{
    await assertChunkMappingInputTx(client,input);
    const state=(await client.query('SELECT next_publish_index FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR SHARE',[input.jobId])).rows[0];
    if(!state)conflict('The mapping state is unavailable.');
    const raw=(await client.query('SELECT state,issue_code,sealed_chunks,records,unknown_remainder,next_publish_index FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
      [input.rawJobId])).rows[0];
    if(!raw)conflict('The source streaming state is unavailable.');
    const slot=(await client.query('SELECT chunk_index,result_sha256 FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 AND published=true FOR SHARE',
      [input.rawJobId,input.sourceRevision,state.next_publish_index])).rows[0]??null;
    return {index:Number(state.next_publish_index),raw,slot};
  });
}
async function acceptDataSlot(input:ChunkMappingInput,attempt:UspJobAttempt,rawChunk:Awaited<ReturnType<StreamingVectorService['chunk']>>){
  const slot=rawChunk.slot,payload=rawChunk.payload;
  if(!payload||!slot.ref)conflict('A data slot requires its immutable raw payload.');
  const prepared=await transaction(async client=>{
    const {profile,approved}=await assertChunkMappingInputTx(client,input);
    if(!profile||!approved)conflict('An approved source recipe is required.');
    await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT next_publish_index FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR SHARE',[input.jobId])).rows[0];
    if(state?.next_publish_index!==slot.chunkIndex)conflict('The mapping publication pointer changed.');
    return normalizeMappedChunk(payload.records,approved.receipt.plan,profile,input.rawJobId,slot.chunkIndex,
      await keyRows(client,input.jobId,candidateKeyHashes(payload.records,approved.receipt.plan)));
  });
  const mapped=ChunkMappingPayloadSchema.parse({version:limits.version,jobId:input.jobId,rawJobId:input.rawJobId,
    sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,
    chunkIndex:slot.chunkIndex,rawResultSha256:slot.resultSha256,schemaFingerprint:prepared.schemaFingerprint,
    recipeRevision:input.recipeRevision,
    converterSha256:input.converterSha256,
    ...(input.profileHash?{profileHash:input.profileHash}:{}),
    ...(input.prefixAdmissionVersion?{prefixAdmissionVersion:input.prefixAdmissionVersion}:{}),
    records:prepared.records});
  const stored=await storePayload(mapped);
  await transaction(async client=>{
    const {profile,approved}=await assertChunkMappingInputTx(client,input);
    if(!profile||!approved)conflict('The source recipe changed before mapped publication.');
    await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state||state.state!=='running'||state.next_publish_index!==slot.chunkIndex||state.records!==slot.firstFeatureIndex)
      conflict('The mapped publication pointer or source index changed.');
    const rawSlot=(await client.query('SELECT result_sha256,published FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 FOR SHARE',
      [input.rawJobId,input.sourceRevision,slot.chunkIndex])).rows[0];
    if(!rawSlot?.published||rawSlot.result_sha256!==slot.resultSha256)conflict('The raw chunk changed before mapping publication.');
    const reproduced=normalizeMappedChunk(payload.records,approved.receipt.plan,profile,input.rawJobId,slot.chunkIndex,
      await keyRows(client,input.jobId,candidateKeyHashes(payload.records,approved.receipt.plan)));
    const expected=ChunkMappingPayloadSchema.parse({...mapped,records:reproduced.records,
      schemaFingerprint:reproduced.schemaFingerprint});
    if(sha256(Buffer.from(JSON.stringify(expected)))!==stored.hash)
      conflict('Source-key reservations changed before mapped publication.');
    const normalized=reproduced.records.filter(item=>item.disposition==='observed').length;
    const quarantined=reproduced.records.filter(item=>item.disposition==='quarantined').length;
    const unresolved=reproduced.records.length-normalized-quarantined;
    await client.query(`INSERT INTO usp_chunk_mapping_slots(job_id,chunk_index,status,published,raw_result_sha256,schema_fingerprint,schema_drift,
      first_feature_index,last_feature_index,records,normalized,quarantined,unresolved,bytes,object_key,object_sha256,
      issue_code,result_sha256,attempt,fence) VALUES($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL,$16,$17,$18)`,
      [input.jobId,slot.chunkIndex,normalized?'ready':'quarantined',slot.resultSha256,reproduced.schemaFingerprint,
        reproduced.schemaDrift,slot.firstFeatureIndex,slot.lastFeatureIndex,reproduced.records.length,normalized,quarantined,
        unresolved,stored.bytes,stored.key,stored.hash,stored.hash,attempt.number,attempt.fence]);
    for(const key of reproduced.keys){
      if(key.laterIndex===null)await client.query('INSERT INTO usp_chunk_mapping_keys(job_id,source_key_sha256,source_key,first_feature_index) VALUES($1,$2,$3,$4)',
        [input.jobId,key.hash,key.value,key.firstIndex]);
      else{
        await client.query('UPDATE usp_chunk_mapping_keys SET conflicted=true WHERE job_id=$1 AND source_key_sha256=$2 AND source_key=$3',
          [input.jobId,key.hash,key.value]);
        await client.query('INSERT INTO usp_chunk_mapping_conflicts(job_id,later_feature_index,first_feature_index,source_key_sha256) VALUES($1,$2,$3,$4)',
          [input.jobId,key.laterIndex,key.firstIndex,key.hash]);
      }
    }
    await client.query(`UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1,records=records+$2,
      normalized=normalized+$3,quarantined=quarantined+$4,unresolved=unresolved+$5,duplicate_keys=duplicate_keys+$6,
      baseline_schema_fingerprint=COALESCE(baseline_schema_fingerprint,$7),schema_drift_chunks=schema_drift_chunks+$8,
      updated_at=now() WHERE job_id=$1`,[input.jobId,reproduced.records.length,normalized,quarantined,unresolved,
      reproduced.keys.filter(item=>item.laterIndex!==null).length,reproduced.schemaFingerprint,reproduced.schemaDrift?1:0]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.chunk',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,
      chunkIndex:slot.chunkIndex,status:normalized?'ready':'quarantined',resultSha256:stored.hash,
      records:reproduced.records.length,sourceComplete:false},input.subject);
  });
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
    proposal=await adaptive.propose(input.caseId,input.sourceId,{requestKey:input.jobId,
      source:current.profile.source,workspaceRevision:current.profile.workspaceRevision,
      workspaceFingerprint:current.profile.workspaceFingerprint});
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
      const state=(await client.query('SELECT quarantined,unresolved,duplicate_keys,schema_drift_chunks FROM usp_chunk_mapping_imports WHERE job_id=$1',[input.jobId])).rows[0];
      const status=state.quarantined||state.unresolved||state.duplicate_keys||state.schema_drift_chunks?'completed_with_rejections':'completed';
      await client.query('UPDATE usp_chunk_mapping_imports SET state=$2,issue_code=NULL,updated_at=now() WHERE job_id=$1',[input.jobId,status]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId:input.jobId,rawJobId:input.rawJobId,status},input.subject);
    });
}

async function claimFailure(input:ChunkMappingInput,error:unknown){
  const stale=error instanceof AppError&&[403,404,409].includes(error.status);
  const integrity=error instanceof AppError&&error.code==='STREAMING_SOURCE_INTEGRITY';
  if(!stale&&!integrity&&!(error instanceof AppError&&error.code==='USP_JOB_ATTEMPTS'))throw error;
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
    const code=stale?'MAPPING_CONTEXT_STALE':integrity?'STREAMING_SOURCE_INTEGRITY':'MAPPING_ATTEMPTS_EXHAUSTED';
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
  });
}

/** One canonical fenced job consumes only published raw slots, with one bounded payload in RAM. */
export async function runChunkMappingJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='chunk-mapping'",[jobId])).rows[0];
  if(!job||!['queued','running'].includes(job.status))return;
  const input=ChunkMappingInputSchema.parse(job.payload);
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`chunk-mapping:${randomUUID()}`,client=>assertChunkMappingInputTx(client,input).then(()=>{}));}
  catch(error){await claimFailure(input,error);return;}
  let lastHeartbeat=Date.now(),waitStarted=Date.now();
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
      await client.query("UPDATE usp_chunk_mapping_imports SET state='running',issue_code=NULL,updated_at=now() WHERE job_id=$1",[jobId]);
      await appendCaseIngestionTx(client,input.caseId,{kind:'chunk-mapping.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,rawJobId:input.rawJobId,status:'running'},input.subject);
    });
    if(input.route==='proposal_only'){await propose(input,attempt);return;}
    while(true){
      await pulse();const next=await window(input);
      if(next.slot){
        const rawChunk=await rawService.chunk(input.caseId,input.sourceId,input.rawJobId,next.index);
        if(rawChunk.slot.resultSha256!==next.slot.result_sha256)conflict('The published raw slot changed.');
        if(!rawChunk.slot.ref){await terminal(input,attempt,rawChunk.slot.issueCode??'RAW_STREAM_FAILED',false,
          rawChunk.slot.resultSha256);return;}
        await acceptDataSlot(input,attempt,rawChunk);waitStarted=Date.now();continue;
      }
      if(['completed','completed_with_rejections'].includes(next.raw.state)){await complete(input,attempt);return;}
      if(['failed','stale'].includes(next.raw.state)){
        await terminal(input,attempt,next.raw.issue_code??'RAW_STREAM_FAILED');return;
      }
      if(Date.now()-waitStarted>limits.readMs)throw new AppError(503,'MAPPING_SOURCE_WAIT','The source stream did not publish another bounded chunk in time.');
      await pause(1000);
    }
  }catch(error){
    const code=error instanceof AppError?error.code:'MAPPING_WORKER_ERROR';
    const stale=error instanceof AppError&&[403,404,409].includes(error.status);
    try{if(stale)await terminal(input,attempt,'MAPPING_CONTEXT_STALE',true);
      else if(attempt.number>=3||error instanceof AppError&&[413,422].includes(error.status))await terminal(input,attempt,code);
      else await retry(input,attempt,code);
    }catch{/* A newer fence owns durable state. */}
  }
}
