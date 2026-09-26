import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {PROJECTED_VECTOR_PROFILE as profile, ProjectedVectorRequestSchema, ProjectedVectorInputSchema,
  ProjectedVectorStatusSchema, AdministrativeObservationSchema, AdministrativeObservationPageSchema,
  ProjectedVectorArtifactSchema,ProjectedChunkPinSchema,SemanticDisplayReservationSchema, type ProjectedVectorIndex} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {openObjectStream,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {localOperatorSubject} from '../principal';
import {registerUspJobInputTx} from '../jobs';
import {appendCaseIngestionTx,ingestionBinding} from './events';
import {semanticPublisherSha,reserveSemanticDisplaysTx,sealedPrefixTx} from './semantic-chunks';

const uuid=z.string().uuid();
export const projectedParserSha=()=>sha256(readFileSync(join(settings.repositoryRoot,'services/geo/geo/projected_vector.py')));
export async function projectedContextTx(client:PoolClient,caseId:string,sourceId:string,lock=false){
  const subject=localOperatorSubject();
  const current=(await client.query(`SELECT id,revision,archived FROM cases WHERE id=$1${lock?' FOR UPDATE':''}`,[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'PROJECTED_CASE_ARCHIVED','Archived source context is unavailable.');
  const source=(await client.query(`SELECT * FROM sources WHERE case_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[caseId,sourceId])).rows[0]??notFound('Retained source not found in this case.');
  if(source.inspection?.largeOriginal?.operatorSubject!==subject)throw new AppError(403,'PROJECTED_SOURCE_OPERATOR','This original belongs to another configured local context.');
  if(source.profile!=='large-original-v1' || source.sha256!==profile.zipSha256 || Number(source.bytes)!==profile.zipBytes)
    throw new AppError(422,'PROJECTED_PROFILE','Only the exact qualified retained NWIC district ZIP is supported.');
  const latest=(await client.query('SELECT max(revision)::int revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision;
  if(latest!==source.revision)conflict('The retained source revision was superseded.');
  return {current,source,access:ingestionBinding(caseId).access};
}
export function assertProjectedInput(ctx:Awaited<ReturnType<typeof projectedContextTx>>,payload:unknown){
  const input=ProjectedVectorInputSchema.parse(payload);
  const {inputFingerprint,...base}=input;
  if(fingerprint(base)!==inputFingerprint || ctx.current.id!==input.caseId || ctx.current.revision!==input.caseRevision || ctx.source.id!==input.sourceId || ctx.source.revision!==input.sourceRevision
    || ctx.source.family_id!==input.sourceFamilyId || ctx.source.sha256!==input.sha256 || ctx.source.object_key!==input.objectKey
    || ctx.access!==input.accessBinding || input.parserSha256!==projectedParserSha() || input.semanticChunks && input.semanticChunks.publisherSha256!==semanticPublisherSha())
    throw new AppError(409,'PROJECTED_CONTEXT_STALE','The source, case, converter or private access context changed.');
  return input;
}
export async function readProjectedArtifact(refValue:unknown,input: {parserSha256:string;sha256:string},bound:number,deadline?:number){
  const ref=ProjectedVectorArtifactSchema.parse(refValue),prefix=`projected-vectors/${input.parserSha256}/${input.sha256}/`;
  if(ref.bytes>bound || !ref.key.startsWith(prefix) || !/^(native|geographic|index)\/[a-f0-9-]+-[a-f0-9]{64}\.json$/.test(ref.key.slice(prefix.length))
    || !ref.key.endsWith(`-${ref.sha256}.json`))throw new AppError(422,'PROJECTED_ARTIFACT_SCOPE','The bounded artifact does not match its qualified source/converter.');
  const object=await openObjectStream(ref.key,ref.bytes,Math.min(10000,Math.max(1,(deadline??Date.now()+10000)-Date.now()))),chunks:Buffer[]=[];let count=0;
  try{for await(const value of object.body){const chunk=value as Buffer;count+=chunk.length;if(count>ref.bytes)throw new AppError(422,'PROJECTED_ARTIFACT_INTEGRITY','Artifact exceeds its pinned size.');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks,count);if(count!==ref.bytes || sha256(bytes)!==ref.sha256)throw new AppError(422,'PROJECTED_ARTIFACT_INTEGRITY','Artifact hash/size differs from its pin.');return bytes;
  }finally{object.body.destroy();}
}
export async function projectedStatusTx(client:PoolClient,caseId:string,sourceId:string,jobId?:string){
  const ctx=await projectedContextTx(client,caseId,sourceId),pointer=ctx.source.inspection.projectedVector;
  const job=(await client.query("SELECT id,status,error FROM jobs WHERE id=$1 AND source_id=$2 AND operation='projected-vector'",[jobId??pointer?.currentJobId,sourceId])).rows[0]??notFound('No projected admission job exists for this retained source.');
  const accepted=pointer?.accepted?.jobId===job.id?pointer.accepted:null;
  const latest=(await client.query('SELECT sequence,sha256 FROM usp_display.source_semantic_chunks WHERE job_id=$1 AND source_id=$2 ORDER BY sequence DESC LIMIT 1',[job.id,sourceId])).rows[0];
  const prefix=latest?await sealedPrefixTx(client,caseId,sourceId,job.id,{sequence:latest.sequence,sha256:latest.sha256}):null;
  const reservationRow=(await client.query("SELECT result FROM operations WHERE kind='stream-display-capacity' AND case_id=$1 AND operation_key=$2",[caseId,`stream-display:${job.id}`])).rows[0];
  let displayMilestones;
  if(reservationRow){const reservation=SemanticDisplayReservationSchema.parse(reservationRow.result);displayMilestones=[];
    for(const phase of ['early','middle','final'] as const){const outcome=reservation.outcomes[phase],child=outcome.state==='created'?(await client.query('SELECT status,error FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3',[outcome.jobId,caseId,sourceId])).rows[0]:null;
      displayMilestones.push({phase,jobId:outcome.state==='created'?outcome.jobId:null,state:outcome.state==='created'?(child?.status??'unavailable'):outcome.state,errorCode:outcome.state==='unavailable'?outcome.code:child?.error??null});}
  }
  const errorCode=job.error ? /^[A-Z][A-Z0-9_]{0,79}$/.test(job.error)?job.error:'PROJECTED_PROCESSING_FAILED' : null;
  return ProjectedVectorStatusSchema.parse({version:profile.version,caseId,sourceId,sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,
    currentCaseRevision:ctx.current.revision,jobId:job.id,status:job.status,totals:accepted?.totals??null,transform:accepted?.transform??null,errorCode,...(displayMilestones?{displayMilestones}:{}),...(prefix?{coverage:prefix.chunk.coverage,chunk:prefix.pin,currentSourceAccepted:job.status==='succeeded'&&Boolean(accepted)}:{})});
}
export async function acceptedProjectedTx(client:PoolClient,caseId:string,sourceId:string,jobId?:string){
  const ctx=await projectedContextTx(client,caseId,sourceId),pointer=ctx.source.inspection.projectedVector?.accepted;
  if(!pointer || jobId && pointer.jobId!==jobId)throw new AppError(409,'PROJECTED_NOT_ACCEPTED','Refresh the current accepted source generation.');
  const job=(await client.query(`SELECT j.*,m.accepted_fence,m.result_ref FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id
    WHERE j.id=$1 AND j.source_id=$2 AND j.operation='projected-vector'`,[pointer.jobId,sourceId])).rows[0];
  if(!job || job.status!=='succeeded' || Number(job.accepted_fence)!==pointer.fence || job.result_ref?.sha256!==pointer.index.sha256)
    throw new AppError(409,'PROJECTED_NOT_ACCEPTED','This source generation is unavailable.');
  const input=assertProjectedInput(ctx,job.payload);
  if(input.semanticChunks){
    if(!pointer.finalChunk)throw new AppError(409,'SEMANTIC_PREFIX_CLOSURE','Complete source adoption requires its exact final seal.');
    const prefix=await sealedPrefixTx(client,caseId,sourceId,job.id,pointer.finalChunk);
    if(prefix.chunk.coverage.remainingRecords!==0||prefix.pin.sequence!==prefix.preparation.partitions.length)throw new AppError(422,'SEMANTIC_PREFIX_CLOSURE','The accepted complete source differs from its sealed prefix.');
  }
  return {ctx,pointer,job,input};
}
/** Stored value bytes; indexes, WAL and database allocator overhead are not scale qualification. */
export async function projectedObservationBytesTx(client:PoolClient,jobId?:string){
  const row=(await client.query(`SELECT COALESCE(sum(pg_column_size(native_geometry)::bigint
    +COALESCE(pg_column_size(geographic_geometry),0)+pg_column_size(source_locator)+pg_column_size(properties)
    +pg_column_size(native_bounds)+COALESCE(pg_column_size(geographic_bounds),0)
    +pg_column_size(raw_ref)+COALESCE(pg_column_size(geographic_ref),0)
    +COALESCE(pg_column_size(native_geometry_sha256),0)+COALESCE(pg_column_size(geographic_geometry_sha256),0)+COALESCE(pg_column_size(record_sha256),0)+256),0)::text bytes
    FROM administrative_unit_observations WHERE ($1::uuid IS NULL OR job_id=$1)`,[jobId??null])).rows[0];
  return Number(row.bytes);
}
export function observation(row:any,source:any){
  return AdministrativeObservationSchema.parse({id:row.unit_id,kind:'district',namespace:profile.namespace,nativeKey:row.native_key,
    sourceId:source.id,sourceRevision:source.revision,jobId:row.job_id,featureIndex:row.feature_index,locator:row.source_locator,
    name:row.properties.district,code:row.properties.dtcode??null,disposition:row.disposition,reason:row.reason,
    nativeBounds:row.native_bounds,geographicBounds:row.geographic_bounds,rawSha256:row.raw_ref.sha256,geographicSha256:row.geographic_ref?.sha256??null,
    sourceCrs:'EPSG:7755',geographicCrs:'EPSG:4326',verticalReference:null,purpose:'administrative_context',
    accuracyQualification:'source_boundary_accuracy_and_currentness_unqualified'});
}

export class ProjectedVectorService{
  async enqueue(caseIdValue:string,sourceIdValue:string,value:unknown){
    const caseId=uuid.parse(caseIdValue).toLowerCase(),sourceId=uuid.parse(sourceIdValue).toLowerCase(),request=ProjectedVectorRequestSchema.parse(value);
    const digest=fingerprint({caseId,sourceId,request,access:ingestionBinding(caseId).access,parserSha256:projectedParserSha(),...(request.semanticChunks?{publisherSha256:semanticPublisherSha()}:{})}),key=`projected-vector:${request.requestKey}`;
    return transaction(async client=>{
      if(request.semanticChunks)await client.query("SELECT pg_advisory_xact_lock(hashtextextended('private-mvt-admission-retirement-v1',0))");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('projected-vector-admission-v1',0))");
      const ctx=await projectedContextTx(client,caseId,sourceId,true);
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='projected-vector'",[caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('The request key names different projected source pins.');return projectedStatusTx(client,caseId,sourceId,prior.result.jobId);}
      if(ctx.current.revision!==request.expectedCaseRevision || ctx.source.revision!==request.expectedSourceRevision || ctx.source.sha256!==request.sourceSha256)
        conflict('Inspect the current case and retained source pins before admission.');
      const requests=(await client.query("SELECT count(*)::int count FROM operations WHERE kind='projected-vector'")).rows[0].count;
      if(requests>=profile.requestReceipts)throw new AppError(429,'PROJECTED_REQUEST_BUDGET','The bounded idempotency receipt capacity is full; exact existing request keys remain replayable.');
      const existing=(await client.query("SELECT * FROM jobs WHERE id=$1 AND source_id=$2 AND operation='projected-vector'",[ctx.source.inspection.projectedVector?.currentJobId,sourceId])).rows[0];
      if(existing && ['queued','running','succeeded'].includes(existing.status)){
        let reusable=true;
        try{const priorInput=assertProjectedInput(ctx,existing.payload);reusable=Boolean(priorInput.semanticChunks)===Boolean(request.semanticChunks);}catch(error){
          if(!(error instanceof AppError) || error.code!=='PROJECTED_CONTEXT_STALE')throw error;
          reusable=false;
        }
        if(reusable){
          await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'projected-vector',$3,$4)",[caseId,key,digest,{jobId:existing.id}]);
          return projectedStatusTx(client,caseId,sourceId);
        }
      }
      const parserSha256=projectedParserSha();
      const quota=(await client.query(`SELECT count(*)::int receipts,count(*) FILTER(WHERE status IN('queued','running'))::int active,
        count(*) FILTER(WHERE status='succeeded')::int accepted,
        count(DISTINCT payload->>'parserSha256')::int parsers,
        count(*) FILTER(WHERE payload->>'parserSha256'=$1)::int same_parser FROM jobs WHERE operation='projected-vector'`,[parserSha256])).rows[0];
      if(quota.active>=profile.active)throw new AppError(429,'PROJECTED_ACTIVE_BUDGET','One projected admission is already active; retry after its fenced completion.');
      if(quota.receipts>=profile.jobReceipts || quota.accepted>=profile.acceptedGenerations
        || quota.parsers>=profile.parserGenerations && !quota.same_parser
        || await projectedObservationBytesTx(client)+profile.observationGenerationBytes>profile.retainedObservationBytes)
        throw new AppError(429,'PROJECTED_RETENTION_BUDGET','The bounded retained receipt, converter or accepted observation capacity is full; preserved history requires a reviewed capacity decision.');
      const jobId=randomUUID(),base={kind:'retained_source' as const,version:profile.version,jobId,caseId,caseRevision:ctx.current.revision,sourceId,
        sourceRevision:ctx.source.revision,sourceFamilyId:ctx.source.family_id,sha256:profile.zipSha256,bytes:profile.zipBytes,
        objectKey:ctx.source.object_key,parserSha256,accessBinding:ctx.access,...(request.semanticChunks?{semanticChunks:{version:request.semanticChunks,publisherSha256:semanticPublisherSha()}}:{})};
      const inputFingerprint=fingerprint(base),payload=ProjectedVectorInputSchema.parse({...base,inputFingerprint});
      await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'projected-vector',$4,$5,$6)",[jobId,caseId,sourceId,ctx.current.revision,inputFingerprint,payload]);
      if(request.semanticChunks)await reserveSemanticDisplaysTx(client,{id:jobId,case_id:caseId,source_id:sourceId,input_fingerprint:inputFingerprint});
      await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:caseId,version:ctx.current.revision+1},sourceId,inputFingerprint);
      const inspection={...ctx.source.inspection,projectedVector:{...ctx.source.inspection.projectedVector,currentJobId:jobId}};
      await client.query('UPDATE sources SET inspection=$2 WHERE id=$1',[sourceId,inspection]);
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'projected-vector',$3,$4)",[caseId,key,digest,{jobId}]);
      await appendCaseIngestionTx(client,caseId,{kind:'projected-vector.changed',jobId,status:'queued'});
      return projectedStatusTx(client,caseId,sourceId);
    });
  }
  async status(caseIdValue:string,sourceIdValue:string){const caseId=uuid.parse(caseIdValue).toLowerCase(),sourceId=uuid.parse(sourceIdValue).toLowerCase();return transaction(client=>projectedStatusTx(client,caseId,sourceId));}
  async page(caseIdValue:string,sourceIdValue:string,value:unknown){
    const input=z.strictObject({cursor:z.number().int().min(0).max(733).default(0),limit:z.number().int().min(1).max(profile.page).default(profile.page),
      jobId:uuid.optional(),chunk:ProjectedChunkPinSchema.optional(),bbox:z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90),z.number().min(-180).max(180),z.number().min(-90).max(90)]).optional()}).parse(value);
    if((input.cursor||input.chunk) && !input.jobId)throw new AppError(422,'PROJECTED_PAGE_PIN','Continuing pages require their accepted job ID.');
    if(input.bbox && (input.bbox[0]>=input.bbox[2] || input.bbox[1]>=input.bbox[3]))throw new AppError(422,'PROJECTED_BOUNDS','Use an increasing finite geographic envelope.');
    const caseId=uuid.parse(caseIdValue).toLowerCase(),sourceId=uuid.parse(sourceIdValue).toLowerCase();
    return transaction(async client=>{
      const prefix=input.chunk?await sealedPrefixTx(client,caseId,sourceId,input.jobId!,input.chunk):null,accepted=prefix??await acceptedProjectedTx(client,caseId,sourceId,input.jobId),bbox=input.bbox??null;
      const rows=(await client.query(`SELECT o.job_id,o.feature_index,o.unit_id,o.source_locator,o.properties,o.disposition,o.reason,o.native_bounds,o.geographic_bounds,o.raw_ref,o.geographic_ref,u.native_key
        FROM administrative_unit_observations o JOIN administrative_units u ON u.id=o.unit_id WHERE o.job_id=$1 AND o.source_id=$2 AND o.feature_index>=$3
        AND ($4::boolean OR (o.disposition='admitted' AND o.geographic_geometry && ST_MakeEnvelope($5,$6,$7,$8,4326))) AND ($10::int IS NULL OR o.committed_chunk_sequence<=$10) ORDER BY o.feature_index LIMIT $9`,
        [accepted.job.id,sourceId,input.cursor,!bbox,...(bbox??[0,0,0,0]),input.limit+1,input.chunk?.sequence??null])).rows;
      const records=rows.slice(0,input.limit);return AdministrativeObservationPageSchema.parse({jobId:accepted.job.id,records:records.map(row=>observation(row,accepted.ctx.source)),next:rows.length>input.limit?rows[input.limit].feature_index:null,...(prefix?{chunk:prefix.pin,coverage:prefix.chunk.coverage}:{})});
    });
  }
  async geometry(caseIdValue:string,sourceIdValue:string,unitIdValue:string,representation:'native'|'geographic',jobId?:string,chunk?:z.infer<typeof ProjectedChunkPinSchema>){
    if(chunk&&!jobId)throw new AppError(422,'SEMANTIC_PREFIX_PIN','Source chunk geometry requires its exact job and chunk pin.');
    if(chunk)ProjectedChunkPinSchema.parse(chunk);
    if(jobId!==undefined)jobId=uuid.parse(jobId).toLowerCase();
    const caseId=uuid.parse(caseIdValue).toLowerCase(),sourceId=uuid.parse(sourceIdValue).toLowerCase(),unitId=uuid.parse(unitIdValue).toLowerCase();
    const pinned=await transaction(async client=>{
      const accepted=chunk?await sealedPrefixTx(client,caseId,sourceId,jobId!,chunk):await acceptedProjectedTx(client,caseId,sourceId,jobId),row=(await client.query('SELECT disposition,raw_ref,geographic_ref FROM administrative_unit_observations WHERE job_id=$1 AND source_id=$2 AND unit_id=$3 AND ($4::int IS NULL OR committed_chunk_sequence<=$4)',[accepted.job.id,sourceId,unitId,chunk?.sequence??null])).rows[0]??notFound('Administrative observation not found in this accepted source.');
      if(representation==='geographic' && row.disposition!=='admitted')throw new AppError(422,'PROJECTED_QUARANTINE','Quarantined native geometry has no globally readable derivative.');
      return {accepted,ref:representation==='native'?row.raw_ref:row.geographic_ref};
    });
    const bytes=await readProjectedArtifact(pinned.ref,pinned.accepted.input,representation==='native'?profile.featureBytes:profile.geographicBytes);
    await transaction(client=>chunk?sealedPrefixTx(client,caseId,sourceId,pinned.accepted.job.id,chunk):acceptedProjectedTx(client,caseId,sourceId,pinned.accepted.job.id));
    return {bytes,sha256:pinned.ref.sha256,sourceCrs:'EPSG:7755',targetCrs:representation==='native'?'EPSG:7755':'EPSG:4326',chunk};
  }
}
