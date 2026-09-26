import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {PRIVATE_MVT_PROFILE as p,PROJECTED_VECTOR_PROFILE,PrivateMvtInputSchema,PrivateMvtRequestSchema,PrivateMvtStatusSchema,PrivateMvtManifestSchema,
  PrivateMvtGenerationPinSchema,PrivateMvtManifestResponseSchema,PrivateMvtCellSchema,PrivateMvtIdentityMapSchema,PrivateMvtLookupSchema,
  type PrivateMvtInput,type PrivateMvtManifest,type PrivateMvtGenerationPin,type PrivateMvtCell} from '@ulpin/contracts/usp';
import {mvtTransaction as transaction} from './bounds';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {registerUspJobInputTx} from '../jobs';
import {acceptedProjectedTx,projectedContextTx,observation} from '../ingestion/projected-vector';
import {appendCaseIngestionTx,ingestionBinding} from '../ingestion/events';
import {mvtCompilerPinsTx} from './compiler';
import {cellKey,sortedCells,boundsCells,windowCells,extentOf,type Bounds} from './grid';
import {readMvtArtifact} from './storage';
const uuid=(value:string)=>z.string().uuid().parse(value).toLowerCase();
export async function mvtObservationsTx(client:PoolClient,admissionJobId:string,sourceId:string){
  const rows=(await client.query(`SELECT o.feature_index,o.unit_id,o.disposition,o.geographic_bounds,o.raw_ref->>'sha256' raw_sha,
    o.geographic_ref->>'sha256' geo_sha,u.native_key FROM administrative_unit_observations o JOIN administrative_units u ON u.id=o.unit_id
    WHERE o.job_id=$1 AND o.source_id=$2 ORDER BY o.feature_index LIMIT 734`,[admissionJobId,sourceId])).rows;
  if(rows.length!==733)throw new AppError(409,'MVT_SOURCE_CLOSURE','The complete accepted source observation set is unavailable.');
  return rows.map(row=>({unitId:row.unit_id as string,featureIndex:row.feature_index as number,disposition:row.disposition as string,
    bounds:row.geographic_bounds as Bounds|null,rawSha256:row.raw_sha as string,geographicSha256:row.geo_sha as string|null,nativeKey:row.native_key}));
}
export async function mvtContextTx(client:PoolClient,caseId:string,sourceId:string,admissionJobId?:string,lock=false){
  if(lock)await projectedContextTx(client,caseId,sourceId,true);
  const accepted=await acceptedProjectedTx(client,caseId,sourceId,admissionJobId),observations=await mvtObservationsTx(client,accepted.job.id,sourceId);
  if(observations.some(row=>row.nativeKey.type!=='number'||!Number.isSafeInteger(row.nativeKey.value)||row.nativeKey.value<0))
    throw new AppError(422,'MVT_NATIVE_ID','This profile requires its actual nonnegative numeric native transport IDs.');
  const source={caseId,caseRevision:accepted.ctx.current.revision,sourceId,sourceRevision:accepted.ctx.source.revision,
    sourceFamilyId:accepted.ctx.source.family_id,sha256:accepted.ctx.source.sha256,admissionJobId:accepted.job.id,
    admissionIndexSha256:accepted.pointer.index.sha256,admissionInputFingerprint:accepted.job.input_fingerprint,
    sourceDependencySha256:fingerprint(observations),accessBinding:accepted.ctx.access,namespace:PROJECTED_VECTOR_PROFILE.namespace};
  const compiler=await mvtCompilerPinsTx(client,accepted.pointer.transform);
  if(observations.filter(row=>row.disposition==='admitted').length!==720||observations.filter(row=>row.disposition==='quarantined').length!==13
    ||new Set(observations.map(row=>row.nativeKey.value)).size!==733)
    throw new AppError(409,'MVT_SOURCE_CLOSURE','The exact admitted/quarantined and unique native transport-ID source profile changed.');
  return {accepted,observations,source,compiler};
}
export async function assertMvtInputTx(client:PoolClient,job:any,lock=false){
  const input=PrivateMvtInputSchema.parse(job.payload),ctx=await mvtContextTx(client,input.source.caseId,input.source.sourceId,input.source.admissionJobId,lock),
    {inputFingerprint,...base}=input;
  if(input.jobId!==job.id||job.case_id!==input.source.caseId||job.source_id!==input.source.sourceId
    ||job.input_fingerprint!==inputFingerprint||fingerprint(base)!==inputFingerprint
    ||fingerprint(ctx.source)!==fingerprint(input.source)||fingerprint(ctx.compiler)!==fingerprint(input.compiler))
    throw new AppError(409,'MVT_CONTEXT_STALE','The tile source, admission, case, compiler or current private access context changed.');
  return {input,ctx};
}
export async function currentMvtJobTx(client:PoolClient,job:any){
  const result=await assertMvtInputTx(client,job,true);
  if(result.ctx.accepted.ctx.source.inspection.privateMvt?.currentJobId!==job.id)
    throw new AppError(409,'MVT_CONTEXT_STALE','A newer tile job owns this source context.');
  return result;
}
export async function generationRowTx(client:PoolClient,sourceId:string,pin:PrivateMvtGenerationPin){
  const row=(await client.query('SELECT * FROM usp_display.source_tile_generations WHERE source_id=$1 AND job_id=$2 AND version=$3',[sourceId,pin.jobId,pin.version])).rows[0];
  if(!row||row.sha256!==pin.sha256)throw new AppError(409,'MVT_GENERATION_PIN','Refresh the exact committed tile generation.');
  const manifest=PrivateMvtManifestSchema.parse(row.body);
  if(sha256(JSON.stringify(manifest))!==row.sha256||manifest.generationId!==row.job_id||manifest.sequence!==row.version
    ||manifest.fence!==Number(row.fence)||manifest.attempt!==row.attempt)
    throw new AppError(422,'MVT_GENERATION_INTEGRITY','The persisted generation does not match its immutable artifact/fence.');
  return {row,manifest};
}
export async function readableMvtGenerationTx(client:PoolClient,caseId:string,sourceId:string,jobId:string,version:number){
  // Resolve private source authority before looking up any generation/cache/object.
  await projectedContextTx(client,caseId,sourceId);
  const job=(await client.query("SELECT * FROM jobs WHERE case_id=$1 AND source_id=$2 AND id=$3 AND operation='private-mvt'",[caseId,sourceId,jobId])).rows[0]??notFound('Tile generation not found in this source context.');
  const checked=await assertMvtInputTx(client,job),row=(await client.query('SELECT sha256 FROM usp_display.source_tile_generations WHERE source_id=$1 AND job_id=$2 AND version=$3',[sourceId,jobId,version])).rows[0]??notFound('This generation version is not committed.');
  const pin=PrivateMvtGenerationPinSchema.parse({jobId,version,sha256:row.sha256}),generation=await generationRowTx(client,sourceId,pin);
  if(generation.row.input_fingerprint!==job.input_fingerprint||fingerprint(generation.manifest.source)!==fingerprint(checked.input.source)
    ||fingerprint(generation.manifest.compiler)!==fingerprint(checked.input.compiler))
    throw new AppError(409,'MVT_GENERATION_STALE','This generation does not match its authorized immutable job input.');
  return {...checked,...generation,job,pin};
}
export async function mvtStatusTx(client:PoolClient,caseId:string,sourceId:string,jobId?:string){
  const ctx=await projectedContextTx(client,caseId,sourceId),job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='private-mvt'",[jobId??ctx.source.inspection.privateMvt?.currentJobId,caseId,sourceId])).rows[0]??notFound('No private tile job exists for this source.');
  let context:'current'|'stale'='current';try{await assertMvtInputTx(client,job);}catch(error){if(!(error instanceof AppError)||![403,404,409].includes(error.status))throw error;context='stale';}
  const row=context==='current'?(await client.query('SELECT version,sha256,body FROM usp_display.source_tile_generations WHERE job_id=$1 AND source_id=$2 ORDER BY version DESC LIMIT 1',[job.id,sourceId])).rows[0]:null;
  return PrivateMvtStatusSchema.parse({version:p.version,caseId,sourceId,currentCaseRevision:ctx.current.revision,jobId:job.id,status:job.status,context,
    generation:row?{jobId:job.id,version:row.version,sha256:row.sha256}:null,preparedCells:row?.body.cells.length??0,
    plannedCells:job.payload.catalog.length,errorCode:job.error?/^[A-Z][A-Z0-9_]{0,79}$/.test(job.error)?job.error:'MVT_PROCESSING_FAILED':null});
}
export class PrivateMvtService{
  async enqueue(caseIdValue:string,sourceIdValue:string,value:unknown){
    const caseId=uuid(caseIdValue),sourceId=uuid(sourceIdValue),request=PrivateMvtRequestSchema.parse(value);
    return transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('private-mvt-admission-retirement-v1',0))");
      await projectedContextTx(client,caseId,sourceId,true);
      const digest=fingerprint({request,caseId,sourceId,access:ingestionBinding(caseId).access}),key=`private-mvt:${request.requestKey}`;
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='private-mvt'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('This tile request key names different input pins.');return mvtStatusTx(client,caseId,sourceId,prior.result.jobId);}
      const ctx=await mvtContextTx(client,caseId,sourceId,request.admissionJobId,true);
      if(request.expectedCaseRevision!==ctx.source.caseRevision||request.expectedSourceRevision!==ctx.source.sourceRevision)conflict('Refresh the current case/source revision before tiling.');
      const actual=ctx.accepted.ctx.source.inspection.privateMvt?.accepted??null;
      if(fingerprint(request.expectedGeneration)!==fingerprint(actual))throw new AppError(409,'MVT_BASE_PIN','Pin the current accepted generation before changing its catalog.');
      const quota=(await client.query(`SELECT count(*)::int jobs,count(*) FILTER(WHERE status IN('queued','running'))::int active,
        count(*) FILTER(WHERE status='succeeded')::int completed FROM jobs WHERE operation='private-mvt'`)).rows[0],
        aliases=(await client.query("SELECT count(*)::int count FROM operations WHERE kind='private-mvt'")).rows[0].count;
      if(quota.active>=p.active||quota.jobs>=p.jobs||quota.completed>=p.completed||aliases>=p.requests)
        throw new AppError(429,'MVT_RETENTION_BUDGET','The finite private tile job/request/history capacity is occupied; exact existing keys remain replayable.');
      const base=actual?await generationRowTx(client,sourceId,PrivateMvtGenerationPinSchema.parse(actual)):null,
        old=base?await mvtObservationsTx(client,base.manifest.source.admissionJobId,sourceId):[],oldMap=new Map(old.map(row=>[row.unitId,row])),newMap=new Map(ctx.observations.map(row=>[row.unitId,row]));
      const forced=new Set(request.revalidateUnitIds);for(const unit of forced)if(newMap.get(unit)?.disposition!=='admitted')throw new AppError(422,'MVT_REVALIDATION_UNIT','Choose an admitted canonical unit from this exact source.');
      const changes:PrivateMvtInput['invalidation']['changes']=[];
      for(const unitId of new Set([...oldMap.keys(),...newMap.keys()])){
        const a=oldMap.get(unitId),b=newMap.get(unitId);
        if(!a&&b)changes.push({unitId,kind:'added',oldBounds:null,newBounds:b.bounds});
        else if(a&&!b)changes.push({unitId,kind:'removed',oldBounds:a.bounds,newBounds:null});
        else if(fingerprint(a)!==fingerprint(b)||forced.has(unitId))changes.push({unitId,kind:forced.has(unitId)&&fingerprint(a)===fingerprint(b)?'revalidated':'changed',oldBounds:a?.bounds??null,newBounds:b?.bounds??null});
      }
      const sourceCells=boundsCells(extentOf(ctx.observations)),allowed=new Set(sourceCells.map(cellKey)),requested=request.window?windowCells(request.window):sourceCells;
      if(requested.some(cell=>!allowed.has(cellKey(cell))))throw new AppError(422,'MVT_WINDOW_SCOPE','This bounded window is outside the accepted source envelope.');
      let invalidated=base?sortedCells(changes.flatMap(change=>[change.oldBounds,change.newBounds].flatMap(bounds=>bounds?boundsCells(bounds):[]))):[];
      if(base&&base.manifest.compiler.sha256!==ctx.compiler.sha256)invalidated=sortedCells([...invalidated,...base.manifest.catalog]);
      const catalog=sortedCells([...requested,...(base?.manifest.catalog??[]),...invalidated]),oldCells=new Map((base?.manifest.cells??[]).map(cell=>[cellKey(cell.cell),cell])),dirty=new Set(invalidated.map(cellKey));
      const plan=sortedCells(catalog.filter(cell=>!oldCells.has(cellKey(cell))||dirty.has(cellKey(cell))||base?.manifest.compiler.sha256!==ctx.compiler.sha256));
      if(!plan.length&&base&&fingerprint(base.manifest.source)===fingerprint(ctx.source))
        throw new AppError(409,'MVT_NO_CHANGE','The requested window and current source pins are already prepared; pin a real unit revalidation to rebuild it.');
      const jobId=randomUUID(),payloadBase={kind:'retained_administrative_observations' as const,version:p.version,jobId,source:ctx.source,compiler:ctx.compiler,
        base:request.expectedGeneration,window:request.window,catalog,plan,invalidation:{version:p.grid,cells:invalidated,changes,includeHalo:true as const,includeParents:true as const}},
        payload=PrivateMvtInputSchema.parse({...payloadBase,inputFingerprint:fingerprint(payloadBase)});
      if(Buffer.byteLength(JSON.stringify(payload))>512*1024)throw new AppError(422,'MVT_INPUT_BUDGET','The immutable tile input exceeds its bounded metadata profile.');
      await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'private-mvt',$4,$5,$6)",[jobId,caseId,sourceId,ctx.source.caseRevision,payload.inputFingerprint,payload]);
      await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:caseId,version:ctx.source.caseRevision+1},sourceId,payload.inputFingerprint);
      await client.query('UPDATE sources SET inspection=$2 WHERE id=$1',[sourceId,{...ctx.accepted.ctx.source.inspection,privateMvt:{...ctx.accepted.ctx.source.inspection.privateMvt,currentJobId:jobId}}]);
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'private-mvt',$3,$4)",[caseId,key,digest,{jobId}]);
      await appendCaseIngestionTx(client,caseId,{kind:'private-mvt.changed',jobId,version:null,status:'queued'});
      return mvtStatusTx(client,caseId,sourceId);
    });
  }
  status(caseId:string,sourceId:string){return transaction(client=>mvtStatusTx(client,uuid(caseId),uuid(sourceId)));}
  manifest(caseId:string,sourceId:string,jobId:string,version:number){return transaction(async client=>{const value=await readableMvtGenerationTx(client,uuid(caseId),uuid(sourceId),uuid(jobId),version);
    return PrivateMvtManifestResponseSchema.parse({pin:value.pin,jobStatus:value.job.status,manifest:value.manifest});});}
  async tile(caseId:string,sourceId:string,jobId:string,version:number,cellValue:unknown){
    const cell=PrivateMvtCellSchema.parse(cellValue),pins=[uuid(caseId),uuid(sourceId),uuid(jobId),version] as const;
    const value=await transaction(async client=>{const generation=await readableMvtGenerationTx(client,...pins),prepared=generation.manifest.cells.find(item=>cellKey(item.cell)===cellKey(cell));
      if(!prepared)throw new AppError(generation.manifest.pending.some(item=>cellKey(item)===cellKey(cell))?409:404,'MVT_CELL_UNAVAILABLE','This exact generation has no prepared cell at that coordinate.');
      return {generation,prepared};});
    const bytes=await readMvtArtifact(value.generation.input,value.prepared.tile,p.tileBytes);
    await transaction(client=>readableMvtGenerationTx(client,...pins));
    return {bytes,sha256:value.prepared.tile.sha256,pin:value.generation.pin};
  }
  async lookup(caseId:string,sourceId:string,jobId:string,version:number,cellValue:unknown,unitIdValue:string){
    const cell=PrivateMvtCellSchema.parse(cellValue),unitId=uuid(unitIdValue),pins=[uuid(caseId),uuid(sourceId),uuid(jobId),version] as const;
    const value=await transaction(async client=>{const generation=await readableMvtGenerationTx(client,...pins),prepared=generation.manifest.cells.find(item=>cellKey(item.cell)===cellKey(cell));
      if(!prepared)notFound('No prepared identity map exists for that exact generation/cell.');return {generation,prepared};});
    const map=PrivateMvtIdentityMapSchema.parse(JSON.parse((await readMvtArtifact(value.generation.input,value.prepared.identityMap,p.mapBytes)).toString('utf8')));
    if(cellKey(map.cell)!==cellKey(cell)||fingerprint(map.features)!==value.prepared.dependencySha256)throw new AppError(422,'MVT_MAP_INTEGRITY','The identity map does not match its registered cell dependencies.');
    const feature=map.features.find(item=>item.unitId===unitId)??notFound('The canonical unit is not emitted by this source tile.');
    return transaction(async client=>{const generation=await readableMvtGenerationTx(client,...pins),row=(await client.query(`SELECT o.*,u.native_key FROM administrative_unit_observations o JOIN administrative_units u ON u.id=o.unit_id
      WHERE o.job_id=$1 AND o.source_id=$2 AND o.unit_id=$3 AND o.disposition='admitted'`,[generation.input.source.admissionJobId,pins[1],unitId])).rows[0];
      if(!row||row.raw_ref.sha256!==feature.rawSha256||row.geographic_ref.sha256!==feature.geographicSha256||row.feature_index!==feature.featureIndex||row.native_key.value!==feature.mvtId)
        throw new AppError(409,'MVT_LOOKUP_STALE','This pick map does not match the exact accepted canonical observation.');
      return PrivateMvtLookupSchema.parse({generation:generation.pin,mvtId:feature.mvtId,observation:observation(row,generation.ctx.accepted.ctx.source)});
    });
  }
}
