import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {PROJECTED_VECTOR_PROFILE as profile,ProjectedVectorInputSchema,ProjectedVectorResultSchema,ProjectedVectorIndexSchema,
  type ProjectedVectorEntry,type ProjectedVectorIndex} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,heartbeatUspJobAttempt,assertUspJobAttemptTx,acceptUspJobAttempt,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {projectedContextTx,assertProjectedInput,readProjectedArtifact} from './projected-vector';

async function terminalTx(client:PoolClient,job:any,status:'failed'|'stale',code:string){
  const current=(await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
  if(!current || !['queued','running'].includes(current.status))return;
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1 AND logical_state<>'succeeded'",[job.id]);
  await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[job.id]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[job.id,status,code]);
  const originalSubject=(await client.query("SELECT inspection->'largeOriginal'->>'operatorSubject' subject FROM sources WHERE id=$1",[job.source_id])).rows[0]?.subject;
  await appendCaseIngestionTx(client,job.case_id,{kind:'projected-vector.changed',jobId:job.id,status},originalSubject);
}
export async function failProjectedJob(id:string,code='PROJECTED_PROCESSING_FAILED',status:'failed'|'stale'='failed'){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='projected-vector'",[id])).rows[0];if(!job)return;
  await transaction(async client=>{await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[job.case_id]);await terminalTx(client,job,status,code);});
}
async function currentTx(client:PoolClient,job:any){
  const ctx=await projectedContextTx(client,job.case_id,job.source_id,true),input=assertProjectedInput(ctx,job.payload);
  if(input.jobId!==job.id || input.inputFingerprint!==job.input_fingerprint || ctx.source.inspection.projectedVector?.currentJobId!==job.id)
    throw new AppError(409,'PROJECTED_CONTEXT_STALE','The active retained-source job was superseded.');
  return ctx;
}
export async function markProjectedRunning(id:string){
  const job=(await query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];if(!job || !['queued','running'].includes(job.status))return;
  await transaction(async client=>{
    try{await currentTx(client,job);}catch(error){if(!(error instanceof AppError))throw error;await terminalTx(client,job,'stale','PROJECTED_CONTEXT_STALE');return;}
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
async function stage(job:any,attempt:UspJobAttempt,entry:ProjectedVectorEntry){
  const input=ProjectedVectorInputSchema.parse(job.payload);
  const raw=await readProjectedArtifact(entry.raw,input,profile.featureBytes),native=JSON.parse(raw.toString('utf8'));
  const geographic=entry.geographic?JSON.parse((await readProjectedArtifact(entry.geographic,input,profile.geographicBytes)).toString('utf8')):null;
  if(native.type!=='Feature' || native.geometry?.type!=='MultiPolygon' || native.properties?.id!==entry.key.value
    || typeof native.properties?.id!=='number' || typeof native.properties?.district!=='string'
    || Buffer.byteLength(JSON.stringify(native.properties))>16384 || native.properties.district.length>500
    || geographic && (geographic.type!=='Feature' || geographic.geometry?.type!=='MultiPolygon' || fingerprint(geographic.properties)!==fingerprint(native.properties)))
    throw new AppError(422,'PROJECTED_FEATURE_SCOPE','The bounded source Feature does not match its typed identity or geographic derivative.');
  await transaction(async client=>{
    await client.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'");
    await currentTx(client,job);await assertUspJobAttemptTx(client,attempt);
    await client.query(`INSERT INTO administrative_units(id,kind,name,code,authority,source,dataset_namespace,native_key)
      VALUES($1,'district',$2,$3,$4,$5,$6,$7) ON CONFLICT(dataset_namespace,native_key) WHERE dataset_namespace IS NOT NULL DO NOTHING`,
      [randomUUID(),native.properties.district,native.properties.dtcode??null,native.properties.src_agency??null,job.source_id,profile.namespace,entry.key]);
    const unit=(await client.query('SELECT id FROM administrative_units WHERE dataset_namespace=$1 AND native_key=$2',[profile.namespace,entry.key])).rows[0];
    await client.query(`INSERT INTO administrative_unit_observations(job_id,feature_index,unit_id,source_id,disposition,reason,source_locator,properties,native_bounds,geographic_bounds,native_geometry,geographic_geometry,raw_ref,geographic_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,ST_SetSRID(ST_GeomFromGeoJSON($11),7755),
        CASE WHEN $12::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($12),4326) END,$13,$14) ON CONFLICT(job_id,feature_index) DO NOTHING`,
      [job.id,entry.index,unit.id,job.source_id,entry.disposition,entry.reason,{member:profile.member,start:entry.start,end:entry.end},native.properties,
        entry.nativeBounds,entry.geographicBounds,JSON.stringify(native.geometry),geographic?JSON.stringify(geographic.geometry):null,entry.raw,entry.geographic]);
  });
}

/** Immutable staging rows remain unreachable until fenced atomic source adoption. */
export async function ingestProjectedResult(id:string,value:unknown){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='projected-vector'",[id])).rows[0];
  if(!job || !['queued','running'].includes(job.status))return;
  const result=ProjectedVectorResultSchema.parse(value),input=ProjectedVectorInputSchema.parse(job.payload);
  if(result.jobId!==id || result.sourceId!==job.source_id || result.inputFingerprint!==job.input_fingerprint || result.parserSha256!==input.parserSha256
    || result.index.bytes>profile.indexBytes)throw new AppError(422,'PROJECTED_RESULT_SCOPE','The result does not name this retained-source job.');
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(id,randomUUID());}
  catch(error){if(error instanceof AppError && error.status===409)return;throw error;}
  const deadline=Date.now()+profile.publicationMs;
  try{
    const index=ProjectedVectorIndexSchema.parse(JSON.parse((await readProjectedArtifact(result.index,input,profile.indexBytes)).toString('utf8')));
    validateIndex(index,job);
    if(fingerprint(index.totals)!==fingerprint(result.totals))throw new AppError(422,'PROJECTED_TOTALS','Job and index totals differ.');
    for(const entry of index.entries){
      if(Date.now()>deadline)throw new AppError(503,'PROJECTED_PUBLICATION_TIMEOUT','Bounded publication deadline exceeded.');
      await stage(job,attempt,entry);
      if(entry.index%25===0)attempt=await heartbeatUspJobAttempt(attempt);
    }
    await acceptUspJobAttempt(attempt,{assetId:job.id,version:1,sha256:result.index.sha256},async client=>{
      const ctx=await currentTx(client,job);
      const rows=(await client.query(`SELECT feature_index,disposition,raw_ref,geographic_ref FROM administrative_unit_observations
        WHERE job_id=$1 AND source_id=$2 ORDER BY feature_index LIMIT 734`,[id,job.source_id])).rows;
      if(rows.length!==profile.features || rows.some((row,i)=>row.feature_index!==i || row.disposition!==index.entries[i].disposition
        || fingerprint(row.raw_ref)!==fingerprint(index.entries[i].raw) || fingerprint(row.geographic_ref)!==fingerprint(index.entries[i].geographic)))
        throw new AppError(422,'PROJECTED_GENERATION_INTEGRITY','Immutable staging does not match the complete source disposition index.');
      const topology=(await client.query(`SELECT count(*) FILTER(WHERE NOT ST_IsValid(native_geometry))::int native_invalid,
        count(*) FILTER(WHERE disposition='admitted')::int admitted FROM administrative_unit_observations WHERE job_id=$1 AND source_id=$2`,[id,job.source_id])).rows[0];
      if(topology.native_invalid!==profile.nativeInvalid || topology.admitted!==index.totals.admitted)
        throw new AppError(422,'PROJECTED_TOPOLOGY_TOTALS','Database topology/disposition totals differ from the preserved native source.');
      const accepted={jobId:id,fence:attempt.fence,index:result.index,totals:index.totals,transform:index.transform,
        numericalRoundTrip:index.numericalRoundTrip,execution:result.execution};
      await client.query('UPDATE sources SET inspection=$2 WHERE id=$1',[job.source_id,{...ctx.source.inspection,
        projectedVector:{...ctx.source.inspection.projectedVector,accepted}}]);
      await appendCaseIngestionTx(client,job.case_id,{kind:'projected-vector.changed',jobId:id,status:'succeeded'});
    },async client=>{await currentTx(client,job);});
  }catch(error){
    if(error instanceof AppError && [403,404,409].includes(error.status))await failProjectedJob(id,'PROJECTED_CONTEXT_STALE','stale');
    else await failProjectedJob(id,error instanceof AppError?error.code:'PROJECTED_PUBLICATION_FAILED');
    throw error;
  }
}
