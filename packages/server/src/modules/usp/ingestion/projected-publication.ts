import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {PROJECTED_VECTOR_PROFILE as profile,ProjectedVectorInputSchema,ProjectedVectorResultSchema,ProjectedVectorIndexSchema,
  SEMANTIC_CHUNK_PROFILE,SemanticPreparationSchema,type ProjectedVectorEntry,type ProjectedVectorIndex} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {mvtBoundsTx,mvtTransaction,assertMvtDeadline} from '../tiles/bounds';
import {semanticPartitions,prepareSemanticTx,sealSemanticTx,releaseSemanticDisplaysTx,sealedPrefixTx} from './semantic-chunks';
import {runSemanticDisplay,createSemanticDisplayTx} from './semantic-display';
import {projectedContextTx,assertProjectedInput,readProjectedArtifact,projectedObservationBytesTx} from './projected-vector';

/** Callers take the admission/retirement advisory lock before case/source/job locks. */
async function terminalTx(client:PoolClient,job:any,status:'failed'|'stale',code:string){
  const current=(await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
  if(!current || !['queued','running'].includes(current.status))return false;
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1 AND logical_state<>'succeeded'",[job.id]);
  await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[job.id]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[job.id,status,code]);
  // Exact-record retirement after fencing. Never erase accepted observations,
  // source originals, canonical identities, artifacts or the logical job history.
  const retired=(await client.query(`DELETE FROM administrative_unit_observations o USING jobs j,usp_job_metadata m
    WHERE o.job_id=$1 AND o.source_id=$2 AND j.id=o.job_id AND m.job_id=j.id
      AND o.committed_chunk_sequence IS NULL AND j.status IN('failed','stale') AND m.logical_state='failed' AND m.accepted_fence IS NULL
      AND NOT EXISTS(SELECT 1 FROM sources s WHERE s.inspection->'projectedVector'->'accepted'->>'jobId'=j.id::text)
    RETURNING o.feature_index`,[job.id,job.source_id])).rows;
  if(retired.length){
    const policy='never_accepted_terminal_staging/1';
    await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
      VALUES($1,$2,'projected-vector-staging-retired',$3,$4) ON CONFLICT(case_id,operation_key,kind) DO NOTHING`,
      [job.case_id,`projected-vector-retired:${job.id}`,fingerprint({jobId:job.id,policy}),
        {jobId:job.id,sourceId:job.source_id,policy,rows:retired.length,retiredAt:new Date().toISOString()}]);
  }
  await releaseSemanticDisplaysTx(client,job,code);
  const originalSubject=(await client.query("SELECT inspection->'largeOriginal'->>'operatorSubject' subject FROM sources WHERE id=$1",[job.source_id])).rows[0]?.subject;
  await appendCaseIngestionTx(client,job.case_id,{kind:'projected-vector.changed',jobId:job.id,status},originalSubject);
  return true;
}
/** Worker failure is authoritative; publisher failure must still own its current live attempt. */
export async function failProjectedJob(id:string,code='PROJECTED_PROCESSING_FAILED',status:'failed'|'stale'='failed',expected?:UspJobAttempt){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='projected-vector'",[id])).rows[0];if(!job || expected && expected.jobId!==id)return false;
  return transaction(async client=>{
    await mvtBoundsTx(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('projected-vector-admission-v1',0))");
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[job.case_id]);
    if(expected){
      // A real context change invalidates the entire logical job, independently
      // of attempt ownership. Recheck it under the case/source locks first.
      try{await projectedPublicationContextTx(client,job);}catch(error){
        if(error instanceof AppError && [403,404,409].includes(error.status))
          return terminalTx(client,job,'stale','PROJECTED_CONTEXT_STALE');
        throw error;
      }
      try{
        await assertUspJobAttemptTx(client,expected);
        const latest=(await client.query('SELECT number,fence,owner FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[id])).rows[0];
        if(!latest || latest.number!==expected.number || Number(latest.fence)!==expected.fence || latest.owner!==expected.owner)return false;
      }catch(error){if(error instanceof AppError && error.status===409)return false;throw error;}
      // A stale-attempt exception with a current source is not source staleness.
      if(status==='stale'){status='failed';code='PROJECTED_PUBLICATION_FAILED';}
    }
    return terminalTx(client,job,status,code);
  });
}
export async function projectedPublicationContextTx(client:PoolClient,job:any){
  const ctx=await projectedContextTx(client,job.case_id,job.source_id,true),input=assertProjectedInput(ctx,job.payload);
  if(input.jobId!==job.id || input.inputFingerprint!==job.input_fingerprint || ctx.source.inspection.projectedVector?.currentJobId!==job.id)
    throw new AppError(409,'PROJECTED_CONTEXT_STALE','The active retained-source job was superseded.');
  return ctx;
}
export async function markProjectedRunning(id:string){
  const job=(await query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];if(!job || !['queued','running'].includes(job.status))return;
  await transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('projected-vector-admission-v1',0))");
    try{await projectedPublicationContextTx(client,job);}catch(error){if(!(error instanceof AppError))throw error;await terminalTx(client,job,'stale','PROJECTED_CONTEXT_STALE');return;}
    const row=(await client.query("UPDATE jobs SET status='running',dispatched_at=COALESCE(dispatched_at,now()),error=NULL WHERE id=$1 AND status='queued' RETURNING id",[id])).rows[0];
    if(row)await appendCaseIngestionTx(client,job.case_id,{kind:'projected-vector.changed',jobId:id,status:'running'});
  });
}
function validateIndex(index:ProjectedVectorIndex,job:any){
  const input=ProjectedVectorInputSchema.parse(job.payload);
  if(index.jobId!==job.id || index.sourceId!==job.source_id || index.inputFingerprint!==job.input_fingerprint
    || index.transform.parserSha256!==input.parserSha256 || index.totals.admitted+index.totals.quarantined!==profile.features)
    throw new AppError(422,'PROJECTED_RESULT_SCOPE','Projected result does not match its immutable retained-source job.');
  const keys=new Set<string>();let positions=0,lastEnd=151,admitted=0;
  for(let i=0;i<index.entries.length;i++){
    const e=index.entries[i],key=fingerprint(e.key);
    if(e.index!==i || e.key.type!=='number' || keys.has(key) || e.start<lastEnd || e.end<=e.start || e.end>profile.memberBytes
      || e.raw.bytes!==e.end-e.start || e.raw.bytes>profile.featureBytes
      || (e.disposition==='admitted'?(e.reason!==null || !e.geographic || !e.geographicBounds):(!e.reason || e.geographic!==null || e.geographicBounds!==null)))
      throw new AppError(422,'PROJECTED_DISPOSITIONS','Source-native identity, locators or disposition closure failed.');
    keys.add(key);positions+=e.positions;lastEnd=e.end;admitted+=e.disposition==='admitted'?1:0;
  }
  if(positions!==profile.positions || admitted!==index.totals.admitted)throw new AppError(422,'PROJECTED_TOTALS','Projected source/disposition totals do not reconcile.');
}
async function stage(job:any,attempt:UspJobAttempt,entry:ProjectedVectorEntry,deadline:number){
  const input=ProjectedVectorInputSchema.parse(job.payload);
  const raw=await readProjectedArtifact(entry.raw,input,profile.featureBytes,deadline),native=JSON.parse(raw.toString('utf8'));
  const geographic=entry.geographic?JSON.parse((await readProjectedArtifact(entry.geographic,input,profile.geographicBytes,deadline)).toString('utf8')):null;
  if(native.type!=='Feature' || native.geometry?.type!=='MultiPolygon' || native.properties?.id!==entry.key.value
    || typeof native.properties?.id!=='number' || typeof native.properties?.district!=='string'
    || Buffer.byteLength(JSON.stringify(native.properties))>16384 || native.properties.district.length>500
    || geographic && (geographic.type!=='Feature' || geographic.geometry?.type!=='MultiPolygon' || fingerprint(geographic.properties)!==fingerprint(native.properties)))
    throw new AppError(422,'PROJECTED_FEATURE_SCOPE','The bounded source Feature does not match its typed identity or geographic derivative.');
  await mvtTransaction(async client=>{
    await projectedPublicationContextTx(client,job);await assertUspJobAttemptTx(client,attempt);
    await client.query(`INSERT INTO administrative_units(id,kind,name,code,authority,source,dataset_namespace,native_key)
      VALUES($1,'district',$2,$3,$4,$5,$6,$7) ON CONFLICT(dataset_namespace,native_key) WHERE dataset_namespace IS NOT NULL DO NOTHING`,
      [randomUUID(),native.properties.district,native.properties.dtcode??null,native.properties.src_agency??null,job.source_id,profile.namespace,entry.key]);
    const unit=(await client.query('SELECT id FROM administrative_units WHERE dataset_namespace=$1 AND native_key=$2',[profile.namespace,entry.key])).rows[0];
    await client.query(`INSERT INTO administrative_unit_observations(job_id,feature_index,unit_id,source_id,disposition,reason,source_locator,properties,native_bounds,geographic_bounds,native_geometry,geographic_geometry,raw_ref,geographic_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,ST_SetSRID(ST_GeomFromGeoJSON($11),7755),
        CASE WHEN $12::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($12),4326) END,$13,$14) ON CONFLICT(job_id,feature_index) DO NOTHING`,
      [job.id,entry.index,unit.id,job.source_id,entry.disposition,entry.reason,{member:profile.member,start:entry.start,end:entry.end},native.properties,
        JSON.stringify(entry.nativeBounds),entry.geographicBounds?JSON.stringify(entry.geographicBounds):null,
        JSON.stringify(native.geometry),geographic?JSON.stringify(geographic.geometry):null,entry.raw,entry.geographic]);
    if((entry.index+1)%25===0 || entry.index===profile.features-1){
      if(await projectedObservationBytesTx(client,job.id)>profile.observationGenerationBytes)
        throw new AppError(422,'PROJECTED_OBSERVATION_BUDGET','The staged observation generation exceeds its retained value-byte bound.');
    }
  },deadline);
}

/** Immutable staging rows remain unreachable until fenced atomic source adoption. */
export async function ingestProjectedResult(id:string,value:unknown){
  const deadline=Date.now()+profile.publicationMs;
  const job=(await mvtTransaction(client=>client.query("SELECT * FROM jobs WHERE id=$1 AND operation='projected-vector'",[id]),deadline)).rows[0];
  if(!job || !['queued','running'].includes(job.status))return;
  const result=ProjectedVectorResultSchema.parse(value),input=ProjectedVectorInputSchema.parse(job.payload);
  if(result.jobId!==id || result.sourceId!==job.source_id || result.inputFingerprint!==job.input_fingerprint || result.parserSha256!==input.parserSha256
    || result.index.bytes>profile.indexBytes)throw new AppError(422,'PROJECTED_RESULT_SCOPE','The result does not name this retained-source job.');
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(id,randomUUID(),client=>mvtBoundsTx(client,deadline));}
  catch(error){if(error instanceof AppError && error.status===409)return;throw error;}
  try{
    const index=ProjectedVectorIndexSchema.parse(JSON.parse((await readProjectedArtifact(result.index,input,profile.indexBytes,deadline)).toString('utf8')));
    validateIndex(index,job);
    if(fingerprint(index.totals)!==fingerprint(result.totals))throw new AppError(422,'PROJECTED_TOTALS','Job and index totals differ.');
    if(input.semanticChunks){
      const preparation=SemanticPreparationSchema.parse({version:SEMANTIC_CHUNK_PROFILE.version,jobId:id,sourceId:job.source_id,inputFingerprint:input.inputFingerprint,
        publisherSha256:input.semanticChunks.publisherSha256,result,index,partitions:semanticPartitions(index)});
      await mvtTransaction(async client=>{await projectedPublicationContextTx(client,job);await prepareSemanticTx(client,job,attempt,preparation);},deadline);
      let early=false;
      for(const partition of preparation.partitions){
        const childDeadline=Math.min(deadline,Date.now()+SEMANTIC_CHUNK_PROFILE.chunkMs);
        const existing=await mvtTransaction(async client=>{await projectedPublicationContextTx(client,job);await assertUspJobAttemptTx(client,attempt);
          return (await client.query('SELECT sha256 FROM usp_display.source_semantic_chunks WHERE job_id=$1 AND sequence=$2',[id,partition.sequence])).rows[0];},childDeadline);
        if(!existing)for(const entry of index.entries.slice(partition.first,partition.last+1)){
          assertMvtDeadline(childDeadline);await stage(job,attempt,entry,childDeadline);
          if(entry.index%25===0)attempt=await heartbeatUspJobAttempt(attempt,client=>mvtBoundsTx(client,deadline));
        }
        const pin=await mvtTransaction(async client=>{await projectedPublicationContextTx(client,job);return sealSemanticTx(client,job,attempt,preparation,partition);},childDeadline);
        if(!early&&index.entries.slice(0,partition.last+1).some(e=>e.disposition==='admitted')){await runSemanticDisplay(job,attempt,'early',pin,deadline);early=true;}
        if(partition.sequence===Math.ceil(preparation.partitions.length/2)&&early)await runSemanticDisplay(job,attempt,'middle',pin,deadline);
        attempt=await heartbeatUspJobAttempt(attempt,client=>mvtBoundsTx(client,deadline));
      }
    }else for(const entry of index.entries){
      assertMvtDeadline(deadline);await stage(job,attempt,entry,deadline);
      if(entry.index%25===0)attempt=await heartbeatUspJobAttempt(attempt,client=>mvtBoundsTx(client,deadline));
    }
    await acceptUspJobAttempt(attempt,{assetId:job.id,version:1,sha256:result.index.sha256},async client=>{
      const ctx=await projectedPublicationContextTx(client,job);
      const rows=(await client.query(`SELECT feature_index,disposition,raw_ref,geographic_ref FROM administrative_unit_observations
        WHERE job_id=$1 AND source_id=$2 ORDER BY feature_index LIMIT 734`,[id,job.source_id])).rows;
      if(rows.length!==profile.features || rows.some((row,i)=>row.feature_index!==i || row.disposition!==index.entries[i].disposition
        || fingerprint(row.raw_ref)!==fingerprint(index.entries[i].raw) || fingerprint(row.geographic_ref)!==fingerprint(index.entries[i].geographic)))
        throw new AppError(422,'PROJECTED_GENERATION_INTEGRITY','Immutable staging does not match the complete source disposition index.');
      const topology=(await client.query(`SELECT count(*) FILTER(WHERE NOT ST_IsValid(native_geometry))::int native_invalid,
        count(*) FILTER(WHERE disposition='admitted')::int admitted FROM administrative_unit_observations WHERE job_id=$1 AND source_id=$2`,[id,job.source_id])).rows[0];
      if(topology.native_invalid!==profile.nativeInvalid || topology.admitted!==index.totals.admitted)
        throw new AppError(422,'PROJECTED_TOPOLOGY_TOTALS','Database topology/disposition totals differ from the preserved native source.');
      if(await projectedObservationBytesTx(client)>profile.retainedObservationBytes)
        throw new AppError(422,'PROJECTED_OBSERVATION_BUDGET','Accepted and staged observations exceed the retained value-byte capacity.');
      let finalChunk;
      if(input.semanticChunks){const seal=(await client.query('SELECT sequence,sha256 FROM usp_display.source_semantic_chunks WHERE job_id=$1 ORDER BY sequence DESC LIMIT 1',[id])).rows[0];
        const prefix=await sealedPrefixTx(client,job.case_id,job.source_id,id,seal?{sequence:seal.sequence,sha256:seal.sha256}:null);
        if(prefix.chunk.coverage.remainingRecords!==0||prefix.pin.sequence!==prefix.preparation.partitions.length)throw new AppError(422,'SEMANTIC_PREFIX_CLOSURE','All semantic seals must independently close before full source adoption.');
        finalChunk=prefix.pin;
      }
      const accepted={jobId:id,fence:attempt.fence,index:result.index,totals:index.totals,transform:index.transform,
        numericalRoundTrip:index.numericalRoundTrip,execution:result.execution,...(finalChunk?{finalChunk}:{})};
      await client.query('UPDATE sources SET inspection=$2 WHERE id=$1',[job.source_id,{...ctx.source.inspection,
        projectedVector:{...ctx.source.inspection.projectedVector,accepted}}]);
      await appendCaseIngestionTx(client,job.case_id,{kind:'projected-vector.changed',jobId:id,status:'succeeded'});
    },async client=>{await mvtBoundsTx(client,deadline);
      if(input.semanticChunks)await client.query("SELECT pg_advisory_xact_lock(hashtextextended('private-mvt-admission-retirement-v1',0))");
      await projectedPublicationContextTx(client,job);
    },async client=>{
      assertMvtDeadline(deadline);
      if(input.semanticChunks){await createSemanticDisplayTx(client,job,'final',undefined,deadline);await releaseSemanticDisplaysTx(client,job,'MVT_MILESTONE_UNUSED');}
      assertMvtDeadline(deadline);
    });
  }catch(error){
    if(error instanceof AppError && [403,404,409].includes(error.status))await failProjectedJob(id,'PROJECTED_CONTEXT_STALE','stale',attempt);
    else await failProjectedJob(id,Date.now()>=deadline?'PROJECTED_PUBLICATION_TIMEOUT':error instanceof AppError?error.code:'PROJECTED_PUBLICATION_FAILED','failed',attempt);
    // A superseded publisher also returns without triggering the generic
    // dispatcher's job/error update against a newer attempt owner.
  }
}
