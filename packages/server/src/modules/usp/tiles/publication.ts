import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {PRIVATE_MVT_PROFILE as p,PrivateMvtInputSchema,PrivateMvtPreparedCellSchema,PrivateMvtManifestSchema,PrivateMvtIdentityMapSchema,
  type PrivateMvtInput,type PrivateMvtPreparedCell,type PrivateMvtManifest} from '@ulpin/contracts/usp';
import {mvtQuery as query,mvtTransaction as transaction,mvtBoundsTx,assertMvtDeadline} from './bounds';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,assertUspJobAttemptTx,heartbeatUspJobAttempt,acceptUspJobAttempt,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from '../ingestion/events';
import {currentMvtJobTx,assertMvtInputTx,generationRowTx} from './service';
import {compilePrivateMvtCellTx} from './compiler';
import {cellKey,sortedCells} from './grid';
import {mvtArtifact,writeMvtArtifact,readMvtArtifact} from './storage';
const advisory=()=>"SELECT pg_advisory_xact_lock(hashtextextended('private-mvt-admission-retirement-v1',0))";

async function terminalTx(client:PoolClient,job:any,status:'failed'|'stale',code:string){
  const current=(await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
  if(!current||!['queued','running'].includes(current.status))return false;
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1 AND logical_state<>'succeeded'",[job.id]);
  await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[job.id]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[job.id,status,code]);
  // Retain every published cell/version. Delete only exact unaccepted staging;
  // asset reservations/orphans remain charged to the finite 64 MiB job budget.
  const removed=(await client.query(`DELETE FROM usp_display.source_tile_cells c WHERE c.job_id=$1 AND c.source_id=$2
    AND NOT EXISTS(SELECT 1 FROM usp_display.source_tile_generations g CROSS JOIN LATERAL jsonb_array_elements(g.body->'cells') cell
      WHERE g.job_id=c.job_id AND (cell#>>'{cell,z}')::int=c.z AND (cell#>>'{cell,x}')::int=c.x AND (cell#>>'{cell,y}')::int=c.y)
    RETURNING z,x,y`,[job.id,job.source_id])).rows;
  if(removed.length)await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
    VALUES($1,$2,'private-mvt-staging-retired',$3,$4) ON CONFLICT(case_id,operation_key,kind) DO NOTHING`,
    [job.case_id,`private-mvt-retired:${job.id}`,fingerprint({jobId:job.id,policy:'never_published_cells/1'}),{jobId:job.id,cells:removed.length,policy:'never_published_cells/1'}]);
  const source=(await client.query("SELECT inspection->'largeOriginal'->>'operatorSubject' subject FROM sources WHERE id=$1",[job.source_id])).rows[0],
    latest=(await client.query('SELECT max(version)::int version FROM usp_display.source_tile_generations WHERE job_id=$1',[job.id])).rows[0];
  await appendCaseIngestionTx(client,job.case_id,{kind:'private-mvt.changed',jobId:job.id,version:latest.version,status},source?.subject);
  return true;
}
export async function failPrivateMvtJob(id:string,code='MVT_PROCESSING_FAILED',expected?:UspJobAttempt){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='private-mvt'",[id])).rows[0];if(!job||expected&&expected.jobId!==id)return false;
  return transaction(async client=>{
    await client.query(advisory());await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[job.case_id]);
    let stale=false;
    try{await currentMvtJobTx(client,job);}catch(error){if(error instanceof AppError&&[403,404,409].includes(error.status))stale=true;else throw error;}
    if(stale)return terminalTx(client,job,'stale','MVT_CONTEXT_STALE');
    if(expected){
      try{await assertUspJobAttemptTx(client,expected);
        const latest=(await client.query('SELECT number,fence,owner FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[id])).rows[0];
        if(!latest||latest.number!==expected.number||Number(latest.fence)!==expected.fence||latest.owner!==expected.owner)return false;
      }catch(error){if(error instanceof AppError&&error.status===409)return false;throw error;}
    }else{
      const latest=(await client.query('SELECT state,lease_until FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[id])).rows[0];
      if(latest?.state==='active'&&new Date(latest.lease_until).getTime()>Date.now())return false;
    }
    return terminalTx(client,job,'failed',code);
  });
}
async function reserveArtifact(job:any,attempt:UspJobAttempt,ref:{key:string;sha256:string;bytes:number},deadline:number){
  await transaction(async client=>{
    await currentMvtJobTx(client,job);await assertUspJobAttemptTx(client,attempt);
    const key=`private-mvt-object:${job.id}:${sha256(ref.key)}`,digest=fingerprint(ref),prior=(await client.query("SELECT payload_hash FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='private-mvt-object-reservation'",[job.case_id,key])).rows[0];
    if(prior){if(prior.payload_hash!==digest)throw new AppError(422,'MVT_RESERVATION_INTEGRITY','Immutable artifact reservation changed.');return;}
    const budget=(await client.query(`SELECT count(*)::int objects,COALESCE(sum((result->>'bytes')::bigint),0)::text bytes FROM operations
      WHERE case_id=$1 AND kind='private-mvt-object-reservation' AND result->>'jobId'=$2`,[job.case_id,job.id])).rows[0];
    if(budget.objects>=384||Number(budget.bytes)+ref.bytes>p.outputBytes)throw new AppError(422,'MVT_OUTPUT_BUDGET','Prepared, intermediate and failed tile artifacts exceed the explicit finite job reservation.');
    await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'private-mvt-object-reservation',$3,$4)`,
      [job.case_id,key,digest,{jobId:job.id,key:ref.key,sha256:ref.sha256,bytes:ref.bytes}]);
  },deadline);
}
async function stageCell(job:any,attempt:UspJobAttempt,value:PrivateMvtPreparedCell,deadline:number){
  const cell=PrivateMvtPreparedCellSchema.parse(value);
  await transaction(async client=>{
    const {input}=await currentMvtJobTx(client,job);await assertUspJobAttemptTx(client,attempt);
    const prior=(await client.query('SELECT input_fingerprint,body FROM usp_display.source_tile_cells WHERE job_id=$1 AND z=$2 AND x=$3 AND y=$4',[job.id,cell.cell.z,cell.cell.x,cell.cell.y])).rows[0];
    if(prior){if(prior.input_fingerprint!==input.inputFingerprint||fingerprint(prior.body)!==fingerprint(cell))throw new AppError(422,'MVT_CELL_INTEGRITY','Immutable staged tile differs from its accepted input.');return;}
    await client.query(`INSERT INTO usp_display.source_tile_cells(job_id,source_id,admission_job_id,z,x,y,input_fingerprint,body)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[job.id,job.source_id,input.source.admissionJobId,cell.cell.z,cell.cell.x,cell.cell.y,input.inputFingerprint,cell]);
  },deadline);
}
async function stagedCells(job:any,deadline:number){
  const rows=(await query('SELECT input_fingerprint,body FROM usp_display.source_tile_cells WHERE job_id=$1 AND source_id=$2 ORDER BY z,x,y LIMIT 129',[job.id,job.source_id],deadline)).rows;
  if(rows.length>p.cells||rows.some(row=>row.input_fingerprint!==job.input_fingerprint))throw new AppError(422,'MVT_STAGE_CLOSURE','The bounded staged catalog does not match its logical job.');
  return rows.map(row=>PrivateMvtPreparedCellSchema.parse(row.body));
}
const limitations:PrivateMvtManifest['limitations']=['display_quantization_clipping_may_omit_collapse_or_repair_geometry','administrative_context_not_property_geometry',
  'source_accuracy_currentness_unqualified','post_admission_only_multi_chunk_import_stream_gate_pending'];
async function publish(job:any,attempt:UspJobAttempt,input:PrivateMvtInput,deadline:number){
  assertMvtDeadline(deadline);
  const cells=await stagedCells(job,deadline),ready=new Set(cells.map(item=>cellKey(item.cell))),catalog=new Set(input.catalog.map(cellKey));
  if(cells.some(item=>!catalog.has(cellKey(item.cell))))throw new AppError(422,'MVT_STAGE_CLOSURE','A staged cell is outside its immutable requested catalog.');
  const latest=(await query('SELECT version,body FROM usp_display.source_tile_generations WHERE job_id=$1 ORDER BY version DESC LIMIT 1',[job.id],deadline)).rows[0];
  if(!cells.length||latest&&latest.body.cells.length===cells.length)return null;
  const sequence=(latest?.version??0)+1;if(sequence>p.versions)throw new AppError(422,'MVT_GENERATION_BUDGET','Intermediate generation versions exhausted their explicit bound.');
  const pending=input.catalog.filter(cell=>!ready.has(cellKey(cell))),manifest=PrivateMvtManifestSchema.parse({version:p.version,grid:p.grid,generationId:job.id,sequence,
    fence:attempt.fence,attempt:attempt.number,source:input.source,compiler:input.compiler,base:input.base,window:input.window,catalog:input.catalog,pending,cells,
    complete:pending.length===0,invalidation:input.invalidation,excludedQuarantined:13,sourceCoverage:input.source.chunk?{state:'partial',sourceAccepted:false,committedRecords:input.source.chunk.coverage.records,remainingRecords:input.source.chunk.coverage.remainingRecords,expectedRecords:733}:{state:'complete',sourceAccepted:true,committedRecords:733,remainingRecords:0,expectedRecords:733},
    extent:p.extent,buffer:p.buffer,layer:p.layer,purpose:'administrative_context',analyticEligible:false,limitations:input.source.chunk?[...limitations.slice(0,3),'committed_partial_source_coverage_not_complete_admission']:limitations}),bytes=Buffer.from(JSON.stringify(manifest));
  if(bytes.length>p.manifestBytes)throw new AppError(422,'MVT_MANIFEST_BUDGET','The coherent manifest exceeds its explicit byte bound.');
  const artifact=mvtArtifact(input,'manifests',`${job.id}-${sequence}`,bytes);await reserveArtifact(job,attempt,artifact,deadline);await writeMvtArtifact(input,artifact,bytes,p.manifestBytes,deadline);
  const adopt=async(client:PoolClient)=>{
    assertMvtDeadline(deadline);
    const {ctx}=await currentMvtJobTx(client,job);await assertUspJobAttemptTx(client,attempt);
    const row=(await client.query('SELECT max(version)::int version FROM usp_display.source_tile_generations WHERE job_id=$1',[job.id])).rows[0];
    if((row.version??0)+1!==sequence)throw new AppError(409,'MVT_GENERATION_SUPERSEDED','A newer coherent generation was committed first.');
    const persisted=(await client.query('SELECT body FROM usp_display.source_tile_cells WHERE job_id=$1 ORDER BY z,x,y LIMIT 129',[job.id])).rows.map(row=>PrivateMvtPreparedCellSchema.parse(row.body));
    if(fingerprint(persisted)!==fingerprint(cells))throw new AppError(409,'MVT_GENERATION_SUPERSEDED','The staged batch advanced while this manifest was prepared.');
    assertMvtDeadline(deadline);
    await client.query(`INSERT INTO usp_display.source_tile_generations(job_id,version,source_id,admission_job_id,input_fingerprint,attempt,fence,sha256,artifact,body)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[job.id,sequence,job.source_id,input.source.admissionJobId,input.inputFingerprint,attempt.number,attempt.fence,artifact.sha256,artifact,manifest]);
    const pin={jobId:job.id,version:sequence,sha256:artifact.sha256};
    await client.query('UPDATE sources SET inspection=$2 WHERE id=$1',[job.source_id,{...ctx.accepted.ctx.source.inspection,
      privateMvt:{...ctx.accepted.ctx.source.inspection.privateMvt,accepted:pin}}]);
    await appendCaseIngestionTx(client,job.case_id,{kind:'private-mvt.changed',jobId:job.id,version:sequence,status:manifest.complete?'succeeded':'partial'});
    assertMvtDeadline(deadline);
  };
  if(manifest.complete)await acceptUspJobAttempt(attempt,{assetId:job.id,version:sequence,sha256:artifact.sha256},adopt,
    async client=>{await mvtBoundsTx(client,deadline);await client.query(advisory());await currentMvtJobTx(client,job);},()=>assertMvtDeadline(deadline));
  else await transaction(async client=>{await client.query(advisory());await currentMvtJobTx(client,job);await adopt(client);},deadline);
  return manifest;
}
/** Existing dispatcher executes the allowlisted PostGIS profile; no second broker/server. */
export async function runPrivateMvtJob(id:string,parentDeadline?:number){
  const started=Date.now();let deadline=Math.min(started+p.jobMs,parentDeadline??Infinity);
  const tx=<T>(action:(client:PoolClient)=>Promise<T>)=>transaction(action,deadline),
    q=(text:string,values:unknown[]=[])=>query(text,values,deadline),beat=(attempt:UspJobAttempt)=>heartbeatUspJobAttempt(attempt,client=>mvtBoundsTx(client,deadline));
  const job=(await q("SELECT * FROM jobs WHERE id=$1 AND operation='private-mvt'",[id])).rows[0];if(!job||!['queued','running'].includes(job.status))return;
  const input=PrivateMvtInputSchema.parse(job.payload);deadline=Math.min(deadline,started+(input.publicationMs??p.jobMs));
  try{await tx(client=>currentMvtJobTx(client,job));}catch(error){if(error instanceof AppError&&[403,404,409].includes(error.status)){await failPrivateMvtJob(id,'MVT_CONTEXT_STALE');return;}throw error;}
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(id,randomUUID(),client=>mvtBoundsTx(client,deadline));}catch(error){if(error instanceof AppError&&error.status===409)return;if(error instanceof AppError&&error.code==='USP_JOB_ATTEMPTS'){await failPrivateMvtJob(id,'MVT_ATTEMPT_LIMIT');return;}throw error;}
  try{
    await tx(async client=>{await currentMvtJobTx(client,job);await assertUspJobAttemptTx(client,attempt);
      const changed=(await client.query('UPDATE jobs SET dispatched_at=now(),error=NULL WHERE id=$1 AND dispatched_at IS NULL RETURNING id',[id])).rows[0];
      if(changed)await appendCaseIngestionTx(client,job.case_id,{kind:'private-mvt.changed',jobId:id,version:null,status:'running'});});
    const existing=new Map((await stagedCells(job,deadline)).map(cell=>[cellKey(cell.cell),cell]));
    for(const cell of existing.values()){
      if(Date.now()>deadline)throw new AppError(503,'MVT_JOB_TIMEOUT','The bounded tile recovery deadline expired.');
      const map=PrivateMvtIdentityMapSchema.parse(JSON.parse((await readMvtArtifact(input,cell.identityMap,p.mapBytes,deadline)).toString('utf8')));
      if(cellKey(map.cell)!==cellKey(cell.cell)||fingerprint(map.features)!==cell.dependencySha256)
        throw new AppError(422,'MVT_STAGE_INTEGRITY','A recovered identity map differs from its staged source dependencies.');
      await readMvtArtifact(input,cell.tile,p.tileBytes,deadline);attempt=await beat(attempt);
    }
    if(input.base){
      const base=await tx(async client=>{await currentMvtJobTx(client,job);return generationRowTx(client,job.source_id,input.base!);}),dirty=new Set(input.plan.map(cellKey));
      for(const cell of base.manifest.cells){
        if(dirty.has(cellKey(cell.cell))||existing.has(cellKey(cell.cell)))continue;
        if(Date.now()>deadline)throw new AppError(503,'MVT_JOB_TIMEOUT','The bounded tile build deadline expired.');
        const parsed=PrivateMvtIdentityMapSchema.parse(JSON.parse((await readMvtArtifact(input,cell.identityMap,p.mapBytes,deadline)).toString('utf8'))),current=await tx(client=>assertMvtInputTx(client,job)),units=new Map(current.ctx.observations.map(row=>[row.unitId,row]));
        if(fingerprint(parsed.features)!==cell.dependencySha256||cellKey(parsed.cell)!==cellKey(cell.cell)||parsed.features.some(feature=>{
          const row=units.get(feature.unitId);return !row||row.disposition!=='admitted'||row.rawSha256!==feature.rawSha256||row.geographicSha256!==feature.geographicSha256||row.nativeKey.value!==feature.mvtId;}))
          throw new AppError(409,'MVT_REUSE_STALE','An unchanged cell does not match the new exact source observation map.');
        await reserveArtifact(job,attempt,cell.tile,deadline);await reserveArtifact(job,attempt,cell.identityMap,deadline);await readMvtArtifact(input,cell.tile,p.tileBytes,deadline);
        const copied={...cell,reused:true};await stageCell(job,attempt,copied,deadline);existing.set(cellKey(cell.cell),copied);attempt=await beat(attempt);
      }
    }
    let sincePublished=0;
    const last=(await q('SELECT body FROM usp_display.source_tile_generations WHERE job_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
    if(existing.size>(last?.body.cells.length??0)){const initial=await publish(job,attempt,input,deadline);if(initial?.complete)return;}
    for(const cell of input.plan){
      if(existing.has(cellKey(cell)))continue;
      if(Date.now()>deadline)throw new AppError(503,'MVT_JOB_TIMEOUT','The bounded tile build deadline expired.');
      const compiled=await tx(async client=>{await currentMvtJobTx(client,job);await assertUspJobAttemptTx(client,attempt);return compilePrivateMvtCellTx(client,input,cell,deadline);}),
        identity=`${cell.z}-${cell.x}-${cell.y}`,tile=mvtArtifact(input,'tiles',identity,compiled.bytes),map=mvtArtifact(input,'maps',identity,compiled.map);
      await reserveArtifact(job,attempt,tile,deadline);await writeMvtArtifact(input,tile,compiled.bytes,p.tileBytes,deadline);
      await reserveArtifact(job,attempt,map,deadline);await writeMvtArtifact(input,map,compiled.map,p.mapBytes,deadline);
      const previous=input.base?(await tx(client=>generationRowTx(client,job.source_id,input.base!))).manifest.cells.find(old=>cellKey(old.cell)===cellKey(cell)):null;
      const prepared=PrivateMvtPreparedCellSchema.parse({cell,bounds3857:compiled.bounds,tile,identityMap:map,candidates:compiled.candidates,emitted:compiled.identity.features.length,
        omittedByDisplay:compiled.candidates-compiled.identity.features.length,dependencySha256:compiled.dependencySha256,reused:previous?.tile.sha256===tile.sha256&&previous.identityMap.sha256===map.sha256});
      await stageCell(job,attempt,prepared,deadline);existing.set(cellKey(cell),prepared);attempt=await beat(attempt);sincePublished++;
      if(sincePublished>=p.batch||existing.size===input.catalog.length){const manifest=await publish(job,attempt,input,deadline);sincePublished=0;if(manifest?.complete)return;}
    }
    const final=await publish(job,attempt,input,deadline);if(!final?.complete)throw new AppError(422,'MVT_CATALOG_CLOSURE','The requested catalog did not close within its complete staged dispositions.');
  }catch(error){await failPrivateMvtJob(id,error instanceof AppError?error.code:'MVT_PROCESSING_FAILED',attempt);}
}
