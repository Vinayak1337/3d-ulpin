import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {STREAMING_VECTOR_LIMITS as limits,AnyStreamingInputSchema as StreamingVectorInputSchema,StreamingVectorPayloadSchema,
  type AnyStreamingInput as StreamingVectorInput,type StreamingVectorRecord} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {openObjectStream,putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {assertStreamingInputTx,lockStreamingRowsTx} from './streaming-vector';
import {readStreamingFeatures,readStreamingTabular,sourceRecord,tabularSourceRecord,type SourceFeature} from './streaming-vector-reader';
import {validateStreamingTopology} from './streaming-vector-validation';

type Slot={chunkIndex:number;firstFeatureIndex:number;lastFeatureIndex:number|null;records:number;accepted:number;quarantined:number;
  status:'ready'|'quarantined';bytes:number;ref:{key:string;sha256:string;bytes:number}|null;issueCode:string|null;resultSha256:string};

/** A single SQL watermark is the ordered publication authority; SSE cursors stay per subscriber. */
export async function publishStreamingPrefixTx(client:PoolClient,input:StreamingVectorInput){
  while(true){
    const state=(await client.query('SELECT next_publish_index FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    const slot=(await client.query('SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 FOR UPDATE',
      [input.jobId,input.sourceRevision,state.next_publish_index])).rows[0];
    if(!slot||slot.published)break;
    await client.query('UPDATE usp_streaming_vector_slots SET published=true WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3',
      [input.jobId,input.sourceRevision,state.next_publish_index]);
    await client.query('UPDATE usp_streaming_vector_imports SET next_publish_index=next_publish_index+1,updated_at=now() WHERE job_id=$1',[input.jobId]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.chunk',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,chunkIndex:slot.chunk_index,status:slot.status,
      resultSha256:slot.result_sha256,records:slot.records,sourceComplete:false},input.subject);
  }
}

async function storeChunk(input:StreamingVectorInput,index:number,records:StreamingVectorRecord[]){
  const payload=StreamingVectorPayloadSchema.parse({version:limits.version,jobId:input.jobId,sourceId:input.sourceId,
    sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,chunkIndex:index,records});
  const bytes=Buffer.from(JSON.stringify(payload));
  if(bytes.length>limits.chunkBytes)throw new AppError(413,'STREAMING_CHUNK_BUDGET','A complete draft chunk exceeds the payload budget.');
  const hash=sha256(bytes),key=`streaming-vectors/${input.jobId}/${index}/${hash}.json`;
  try{await putOriginal(key,bytes,'application/json');}
  catch(error){
    // A restart after object PUT and before SQL acceptance reuses the exact immutable bytes.
    const prior=Buffer.from(await readObject(key).catch(()=>{throw error;}));
    if(prior.length!==bytes.length||sha256(prior)!==hash)throw error;
  }
  const accepted=records.filter(r=>r.disposition==='accepted').length;
  return {chunkIndex:index,firstFeatureIndex:records[0]!.featureIndex,lastFeatureIndex:records.at(-1)!.featureIndex,
    records:records.length,accepted,quarantined:records.length-accepted,status:accepted?'ready':'quarantined',
    bytes:bytes.length,ref:{key,sha256:hash,bytes:bytes.length},issueCode:null,resultSha256:hash} satisfies Slot;
}

async function acceptSlot(input:StreamingVectorInput,attempt:UspJobAttempt,slot:Slot){
  await transaction(async client=>{
    await assertStreamingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state||!['queued','running'].includes(state.state)||state.source_revision!==input.sourceRevision||state.input_sha256!==attempt.inputSha256)
      conflict('The streaming import changed before slot acceptance.');
    const prior=(await client.query('SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3',
      [input.jobId,input.sourceRevision,slot.chunkIndex])).rows[0];
    if(prior){
      if(prior.result_sha256!==slot.resultSha256||prior.first_feature_index!==slot.firstFeatureIndex||prior.last_feature_index!==slot.lastFeatureIndex
        ||prior.records!==slot.records||prior.accepted!==slot.accepted||prior.quarantined!==slot.quarantined)
        throw new AppError(422,'STREAMING_REPLAY_MISMATCH','A recovered chunk differs from its accepted source index.');
      return;
    }
    const count=Number((await client.query('SELECT count(*)::int n FROM usp_streaming_vector_slots WHERE job_id=$1',[input.jobId])).rows[0].n);
    if(count!==slot.chunkIndex||count>=limits.chunks)throw new AppError(422,'STREAMING_INDEX','The stable source chunk index cannot be skipped or exceeded.');
    if(state.records!==slot.firstFeatureIndex)throw new AppError(422,'STREAMING_FEATURE_INDEX','The source feature index cannot be skipped.');
    await client.query(`INSERT INTO usp_streaming_vector_slots(job_id,source_revision,chunk_index,status,first_feature_index,last_feature_index,
      records,accepted,quarantined,bytes,object_key,object_sha256,issue_code,result_sha256,attempt,fence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [input.jobId,input.sourceRevision,slot.chunkIndex,slot.status,slot.firstFeatureIndex,slot.lastFeatureIndex,slot.records,
        slot.accepted,slot.quarantined,slot.bytes,slot.ref?.key??null,slot.ref?.sha256??null,slot.issueCode,slot.resultSha256,attempt.number,attempt.fence]);
    await client.query('UPDATE usp_streaming_vector_imports SET records=records+$2,accepted=accepted+$3,quarantined=quarantined+$4,updated_at=now() WHERE job_id=$1',
      [input.jobId,slot.records,slot.accepted,slot.quarantined]);
    await publishStreamingPrefixTx(client,input);
  });
}

async function terminal(input:StreamingVectorInput,attempt:UspJobAttempt,code:string,nextIndex:number,nextFeatureIndex:number,stale=false){
  await transaction(async client=>{
    if(stale)await lockStreamingRowsTx(client,input.caseId,input.sourceId);
    else await assertStreamingInputTx(client,input);
    await assertUspJobAttemptTx(client,attempt);
    const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[input.jobId])).rows[0];
    if(!state)conflict('The streaming import state is unavailable.');
    if(!stale){
      if(state.records!==nextFeatureIndex)conflict('The terminal source position differs from the committed prefix.');
      const hash=fingerprint({version:limits.version,jobId:input.jobId,sourceRevision:input.sourceRevision,chunkIndex:nextIndex,code});
      await client.query(`INSERT INTO usp_streaming_vector_slots(job_id,source_revision,chunk_index,status,first_feature_index,last_feature_index,
        records,accepted,quarantined,bytes,issue_code,result_sha256,attempt,fence)
        VALUES($1,$2,$3,'quarantined',$4,NULL,0,0,0,0,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [input.jobId,input.sourceRevision,nextIndex,nextFeatureIndex,code,hash,attempt.number,attempt.fence]);
      await publishStreamingPrefixTx(client,input);
    }
    await client.query('UPDATE usp_job_attempts SET state=$3 WHERE job_id=$1 AND number=$2',[input.jobId,attempt.number,'fenced']);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[input.jobId,stale?'stale':'failed',code]);
    await client.query('UPDATE usp_streaming_vector_imports SET state=$2,issue_code=$3,unknown_remainder=true,updated_at=now() WHERE job_id=$1',
      [input.jobId,stale?'stale':'failed',code]);
    if(!stale)await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,status:'failed'},input.subject);
  });
}

async function retry(input:StreamingVectorInput,attempt:UspJobAttempt,code:string){
  await transaction(async client=>{
    await assertStreamingInputTx(client,input);
    await assertUspJobAttemptTx(client,attempt);
    if(attempt.number>=3){
      // The caller will commit a terminal marker under this still-active fence.
      return;
    }
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",[input.jobId,attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",[input.jobId]);
    await client.query("UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds',error=$2 WHERE id=$1",[input.jobId,code]);
    await client.query("UPDATE usp_streaming_vector_imports SET state='queued',issue_code=$2,updated_at=now() WHERE job_id=$1",[input.jobId,code]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId:input.jobId,status:'queued'},input.subject);
  });
}

/** Dispatcher-owned bounded reader. Replays an accepted prefix from byte zero with exact hashes. */
export async function runStreamingVectorJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='streaming-vector'",[jobId])).rows[0];
  if(!job||!['queued','running'].includes(job.status))return;
  const input=StreamingVectorInputSchema.parse(job.payload);
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`streaming-vector:${randomUUID()}`,client=>assertStreamingInputTx(client,input).then(()=>{}));}
  catch(error){
    const active=(await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
    if(active)return;
    // Exhausted leases get an ordered issue marker, without claiming a fourth attempt.
    await transaction(async client=>{
      await lockStreamingRowsTx(client,input.caseId,input.sourceId);
      const current=(await client.query("SELECT status FROM jobs WHERE id=$1 AND operation='streaming-vector' FOR UPDATE",[jobId])).rows[0];
      const row=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
      if(!row||!['queued','running'].includes(row.state))return;
      const code=error instanceof AppError&&[403,404,409].includes(error.status)?'STREAMING_CONTEXT_STALE':'STREAMING_ATTEMPTS_EXHAUSTED';
      const stale=code==='STREAMING_CONTEXT_STALE';
      const stillActive=(await client.query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
      if(!current||!['queued','running'].includes(current.status)||stillActive)return;
      if(!stale){
        await assertStreamingInputTx(client,input);
        const index=Number((await client.query('SELECT count(*)::int n FROM usp_streaming_vector_slots WHERE job_id=$1',[jobId])).rows[0].n);
        const hash=fingerprint({version:limits.version,jobId,sourceRevision:input.sourceRevision,chunkIndex:index,code});
        const last=(await client.query('SELECT number,fence FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1',[jobId])).rows[0];
        await client.query(`INSERT INTO usp_streaming_vector_slots(job_id,source_revision,chunk_index,status,first_feature_index,last_feature_index,
          records,accepted,quarantined,bytes,issue_code,result_sha256,attempt,fence)
          VALUES($1,$2,$3,'quarantined',$4,NULL,0,0,0,0,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [jobId,input.sourceRevision,index,row.records,code,hash,last.number,last.fence]);
        await publishStreamingPrefixTx(client,input);
      }
      await client.query("UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1",[jobId,code==='STREAMING_CONTEXT_STALE'?'stale':'failed',code]);
      await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
      await client.query('UPDATE usp_streaming_vector_imports SET state=$2,issue_code=$3,unknown_remainder=true WHERE job_id=$1',
        [jobId,stale?'stale':'failed',code]);
      if(!stale)await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'failed'},input.subject);
    });
    return;
  }
  await transaction(async client=>{
    await assertStreamingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
    await client.query("UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()),next_attempt_at=now()+interval '180 seconds' WHERE id=$1",[jobId]);
    await client.query("UPDATE usp_streaming_vector_imports SET state='running',issue_code=NULL,updated_at=now() WHERE job_id=$1",[jobId]);
    await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
      sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);
  });
  let nextIndex=0,nextFeatureIndex=0,pending:StreamingVectorRecord[]=[],pendingBytes=0,lastHeartbeat=Date.now();
  const pulse=async()=>{if(Date.now()-lastHeartbeat<30000)return;
    await heartbeatUspJobAttempt(attempt,client=>assertStreamingInputTx(client,input).then(()=>{}));lastHeartbeat=Date.now();
    await query("UPDATE jobs SET next_attempt_at=now()+interval '180 seconds' WHERE id=$1 AND status='running'",[jobId]);
  };
  const flush=async()=>{
    if(!pending.length)return;
    await pulse();const slot=await storeChunk(input,nextIndex,pending);
    await acceptSlot(input,attempt,slot);nextIndex++;pending=[];pendingBytes=0;
  };
  try{
    const etag=(await query('SELECT inspection FROM sources WHERE id=$1',[input.sourceId])).rows[0]?.inspection?.largeOriginal?.objectEtag;
    const object=await openObjectStream(input.objectKey,input.sourceBytes,limits.readMs,etag);
    let result;
    try{
      const consume=async(item:SourceFeature)=>{
        await pulse();const record=input.framing==='tabular'?tabularSourceRecord(item):sourceRecord(item);
        nextFeatureIndex=item.index+1;
        if(record.disposition==='accepted'&&input.framing!=='tabular'){
          const issue=await validateStreamingTopology((record.feature as {geometry:unknown}).geometry);
          if(issue){record.disposition='quarantined';record.issueCode=issue;record.feature=null;}
        }
        const width=input.framing==='tabular'?(item.feature as {headers:string[]}).headers.length:1;
        const countLimit=input.framing==='tabular'?Math.max(1,Math.min(16,Math.floor(256/width))):limits.chunkFeatures;
        let recordBytes=Buffer.byteLength(JSON.stringify(record));
        if(recordBytes>limits.chunkBytes-2048){record.feature=null;record.disposition='quarantined';record.issueCode='DRAFT_UNIT_BUDGET';recordBytes=Buffer.byteLength(JSON.stringify(record));}
        if(pending.length&&(pending.length>=countLimit||pendingBytes+recordBytes+2048>limits.chunkBytes))await flush();
        pending.push(record);pendingBytes+=recordBytes;
        if(pending.length>=countLimit)await flush();
      };
      result=input.framing==='tabular'?await readStreamingTabular(object.body,input.tabular,consume)
        :await readStreamingFeatures(object.body,input.framing,consume);
    }finally{object.body.destroy();}
    if(result.bytes!==input.sourceBytes||result.sha256!==input.sourceSha256)
      throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The retained original differs from its pinned hash or byte count.');
    if(!result.features)throw new AppError(422,'STREAMING_EMPTY_SOURCE','The source contains no complete features.');
    await flush();
    await transaction(async client=>{
      await assertStreamingInputTx(client,input);await assertUspJobAttemptTx(client,attempt);
      const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
      if(state.records!==result.features||state.next_publish_index!==nextIndex)conflict('The published prefix does not close at semantic EOF.');
      await client.query('UPDATE usp_streaming_vector_imports SET sealed_chunks=$2,unknown_remainder=false,updated_at=now() WHERE job_id=$1',[jobId,nextIndex]);
    });
    const manifestHash=fingerprint({version:limits.version,jobId,sourceSha256:input.sourceSha256,slots:nextIndex,features:result.features});
    await acceptUspJobAttempt(attempt,{assetId:`streaming-vector:${jobId}`,version:1,sha256:manifestHash},
      async(client,current)=>{
        const state=(await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
        if(current.operation!=='streaming-vector'||state.sealed_chunks!==nextIndex||state.next_publish_index!==nextIndex||state.records!==result.features||state.unknown_remainder)
          conflict('The complete reader manifest is not published.');
      },client=>assertStreamingInputTx(client,input).then(()=>{}),async client=>{
        const state=(await client.query('SELECT quarantined FROM usp_streaming_vector_imports WHERE job_id=$1',[jobId])).rows[0];
        const status=state.quarantined?'completed_with_rejections':'completed';
        await client.query('UPDATE usp_streaming_vector_imports SET state=$2,issue_code=NULL,updated_at=now() WHERE job_id=$1',[jobId,status]);
        await appendCaseIngestionTx(client,input.caseId,{kind:'streaming-vector.changed',sourceId:input.sourceId,
          sourceRevision:input.sourceRevision,jobId,status},input.subject);
      });
  }catch(error){
    const code=error instanceof AppError?error.code:'STREAMING_WORKER_ERROR';
    const structural=error instanceof AppError&&[413,422].includes(error.status);
    const stale=error instanceof AppError&&[403,404,409].includes(error.status);
    try{
      if(structural){
        // A later bad value keeps the accepted prefix. No guessed boundary or completion count is recorded.
        await flush();await terminal(input,attempt,code,nextIndex,nextFeatureIndex);
      }else if(stale)await terminal(input,attempt,'STREAMING_CONTEXT_STALE',nextIndex,nextFeatureIndex,true);
      else if(attempt.number>=3)await terminal(input,attempt,code,nextIndex,nextFeatureIndex);
      else await retry(input,attempt,code);
    }catch{/* A newer fence owns this job; it alone may change durable state. */}
  }
}
