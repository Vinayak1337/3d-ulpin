import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {SEMANTIC_CHUNK_PROFILE as p,PRIVATE_MVT_PROFILE as m,SemanticPreparationSchema,SemanticChunkSchema,SemanticDisplayReservationSchema,
  ProjectedChunkPinSchema,ProjectedVectorInputSchema,SemanticChunkResponseSchema,type SemanticPreparation,type SemanticPartition,type SemanticRecord,type SemanticDisplayPhase} from '@ulpin/contracts/usp';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {AppError,notFound} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {projectedContextTx,assertProjectedInput,assertProjectedReadInput} from './projected-vector';
import {appendCaseIngestionTx} from './events';
import {privateMvtCapacityTx} from '../tiles/capacity';
import {mvtTransaction} from '../tiles/bounds';
type Pin=z.infer<typeof ProjectedChunkPinSchema>;
const observationColumns='o.job_id,o.feature_index,o.unit_id,o.source_id,o.disposition,o.reason,o.source_locator,o.properties,o.native_bounds,o.geographic_bounds,o.raw_ref,o.geographic_ref,o.committed_chunk_sequence,o.native_geometry_sha256,o.geographic_geometry_sha256,o.record_sha256';
const reservationKey=(id:string)=>`stream-display:${id}`;
export function semanticPublisherSha(){
  const paths=['packages/contracts/src/usp/projected-vector.ts','packages/contracts/src/usp/semantic-chunks.ts',
    'packages/server/src/modules/usp/ingestion/projected-vector.ts','packages/server/src/modules/usp/ingestion/projected-publication.ts',
    'packages/server/src/modules/usp/ingestion/semantic-chunks.ts','packages/server/src/modules/usp/ingestion/semantic-display.ts',
    'packages/server/src/modules/usp/jobs.ts','packages/server/src/modules/usp/tiles/capacity.ts','database/sql/95-ingestion/semantic-chunks.sql'];
  return sha256(Buffer.concat(paths.flatMap(path=>[Buffer.from(path+'\0'),readFileSync(join(settings.repositoryRoot,path))])));
}
const preIFCPublisherReadSha=new Set(['2fc75b285a9b57fffaebad822497a30c59274b6e7345e44f760470a39f284be1',
  '2410cb1dc2581631c11f3eea1f10bbe79c5d328d457426b7fb60ae550594673a']);
export function semanticPublisherReadCompatible(stored:string,current=semanticPublisherSha()){
  return stored===current||preIFCPublisherReadSha.has(stored)&&current===semanticPublisherSha();
}
export function semanticPartitions(index:SemanticPreparation['index']):SemanticPartition[]{
  const partitions:SemanticPartition[]=[];let first=0,positions=0,bytes=0;
  const close=(last:number)=>{partitions.push({sequence:partitions.length+1,first,last,records:last-first+1,positions,referencedBytes:bytes});first=last+1;positions=0;bytes=0;};
  for(const e of index.entries){const size=e.raw.bytes+(e.geographic?.bytes??0);
    if(e.positions>p.positions||size>p.referencedBytes)throw new AppError(422,'SEMANTIC_RECORD_BUDGET','A complete source Feature exceeds the semantic child bound.');
    if(e.index>first&&(e.index-first>=p.records||positions+e.positions>p.positions||bytes+size>p.referencedBytes))close(e.index-1);
    positions+=e.positions;bytes+=size;
  }
  close(index.entries.length-1);
  if(partitions.length>p.chunks)throw new AppError(422,'SEMANTIC_PARTITION_BUDGET','The complete source index exceeds the finite chunk count.');
  return partitions;
}
async function metadataBudgetTx(client:PoolClient,jobId:string,body:unknown,kind:'preparation'|'chunk'){
  const additional=Number((await client.query('SELECT octet_length($1::jsonb::text)::int bytes',[body])).rows[0].bytes);
  const row=(await client.query(`SELECT COALESCE(sum(octet_length(body::text)),0)::bigint bytes,
    COALESCE(sum(octet_length(body::text)) FILTER(WHERE job_id=$1 AND kind=$2),0)::bigint own FROM
    (SELECT job_id,body,'preparation' kind FROM usp_display.source_semantic_preparations UNION ALL SELECT job_id,body,'chunk' kind FROM usp_display.source_semantic_chunks) x`,[jobId,kind])).rows[0];
  const limit=kind==='preparation'?p.preparationBytes:p.chunkMetadataBytes;
  if(Number(row.bytes)+additional>p.metadataBytes||Number(row.own)+additional>limit)
    throw new AppError(429,'SEMANTIC_METADATA_BUDGET','Preserved preparation and chunk history occupy the finite metadata capacity.');
}
export async function prepareSemanticTx(client:PoolClient,job:any,attempt:UspJobAttempt,value:SemanticPreparation){
  await assertUspJobAttemptTx(client,attempt);
  const body=SemanticPreparationSchema.parse(value),hash=sha256(JSON.stringify(body)),prior=(await client.query('SELECT sha256,body FROM usp_display.source_semantic_preparations WHERE job_id=$1',[job.id])).rows[0];
  if(prior){if(prior.sha256!==hash||fingerprint(prior.body)!==fingerprint(body))throw new AppError(422,'SEMANTIC_PREPARATION_INTEGRITY','Recovered complete source preparation differs.');return body;}
  const bytes=Buffer.byteLength(JSON.stringify(body));if(bytes>p.preparationBytes)throw new AppError(422,'SEMANTIC_PREPARATION_BUDGET','The verified source index exceeds its preparation bound.');
  await metadataBudgetTx(client,job.id,body,'preparation');
  await client.query('INSERT INTO usp_display.source_semantic_preparations(job_id,source_id,sha256,body) VALUES($1,$2,$3,$4)',[job.id,job.source_id,hash,body]);return body;
}
function record(row:any):SemanticRecord{return {featureIndex:row.feature_index,unitId:row.unit_id,key:row.native_key,disposition:row.disposition,
  rawSha256:row.raw_ref.sha256,geographicSha256:row.geographic_ref?.sha256??null,nativeGeometrySha256:row.native_geometry_sha256,
  geographicGeometrySha256:row.geographic_geometry_sha256,recordSha256:row.record_sha256};}
export async function sealedPrefixTx(client:PoolClient,caseId:string,sourceId:string,jobId:string,pinValue:unknown,mode:'current'|'immutable_read'='current'){
  const pin=ProjectedChunkPinSchema.parse(pinValue),ctx=await projectedContextTx(client,caseId,sourceId),job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='projected-vector'",[jobId,caseId,sourceId])).rows[0]??notFound('Source chunk job not found.');
  const input=mode==='immutable_read'?assertProjectedReadInput(ctx,job.payload):assertProjectedInput(ctx,job.payload);if(!input.semanticChunks)throw new AppError(409,'SEMANTIC_MODE','This source job does not publish semantic chunks.');
  const prepRow=(await client.query('SELECT sha256,body FROM usp_display.source_semantic_preparations WHERE job_id=$1 AND source_id=$2',[jobId,sourceId])).rows[0]??notFound('Verified complete source preparation is unavailable.');
  const preparation=SemanticPreparationSchema.parse(prepRow.body);
  if(sha256(JSON.stringify(preparation))!==prepRow.sha256||preparation.inputFingerprint!==input.inputFingerprint||preparation.publisherSha256!==input.semanticChunks.publisherSha256)
    throw new AppError(422,'SEMANTIC_PREPARATION_INTEGRITY','The immutable source preparation changed.');
  const seals=(await client.query('SELECT sequence,sha256,body FROM usp_display.source_semantic_chunks WHERE job_id=$1 AND source_id=$2 AND sequence<=$3 ORDER BY sequence',[jobId,sourceId,pin.sequence])).rows;
  if(seals.length!==pin.sequence)throw new AppError(409,'SEMANTIC_PREFIX_CLOSURE','The exact committed prefix is unavailable.');
  const rows=(await client.query(`SELECT ${observationColumns},u.native_key FROM administrative_unit_observations o JOIN administrative_units u ON u.id=o.unit_id
    WHERE o.job_id=$1 AND o.source_id=$2 AND o.committed_chunk_sequence<=$3 ORDER BY o.feature_index`,[jobId,sourceId,pin.sequence])).rows;
  let previous:Pin|null=null,offset=0;const all:SemanticRecord[]=[];
  for(const seal of seals){const chunk=SemanticChunkSchema.parse(seal.body),partition=preparation.partitions[seal.sequence-1],own=rows.slice(offset,offset+chunk.records.length).map(record);
    if(seal.sequence!==chunk.partition.sequence||sha256(JSON.stringify(chunk))!==seal.sha256||fingerprint(chunk.partition)!==fingerprint(partition)
      ||chunk.jobId!==jobId||chunk.sourceId!==sourceId||chunk.caseId!==caseId||chunk.caseRevision!==input.caseRevision||chunk.sourceRevision!==input.sourceRevision
      ||chunk.sourceFamilyId!==input.sourceFamilyId||chunk.sourceSha256!==input.sha256||chunk.inputFingerprint!==input.inputFingerprint||chunk.accessBinding!==ctx.access
      ||chunk.publisherSha256!==input.semanticChunks.publisherSha256||chunk.indexSha256!==preparation.result.index.sha256||fingerprint(chunk.transform)!==fingerprint(preparation.index.transform)
      ||fingerprint(chunk.previous)!==fingerprint(previous)||fingerprint(own)!==fingerprint(chunk.records)||own.some((r,i)=>r.featureIndex!==partition.first+i))
      throw new AppError(422,'SEMANTIC_SEAL_INTEGRITY','Committed source records, geometry hashes, frame or immutable prefix chain differ.');
    all.push(...own);offset+=own.length;
    if(chunk.coverage.prefixDependencySha256!==fingerprint(all)||chunk.coverage.records!==offset)
      throw new AppError(422,'SEMANTIC_PREFIX_INTEGRITY','The sealed cumulative source dependency differs.');
    previous={sequence:seal.sequence,sha256:seal.sha256};
  }
  if(rows.length!==offset||previous?.sha256!==pin.sha256)throw new AppError(409,'SEMANTIC_PREFIX_PIN','Pin the exact immutable chunk hash.');
  const chunk=SemanticChunkSchema.parse(seals.at(-1)!.body);
  return {ctx,job,input,preparation,chunk,pin,rows,pointer:{index:preparation.result.index,transform:preparation.index.transform}};
}
export async function sealSemanticTx(client:PoolClient,job:any,attempt:UspJobAttempt,preparation:SemanticPreparation,partition:SemanticPartition){
  await assertUspJobAttemptTx(client,attempt);
  const prior=(await client.query('SELECT sha256 FROM usp_display.source_semantic_chunks WHERE job_id=$1 AND sequence=$2',[job.id,partition.sequence])).rows[0];
  if(prior)return (await sealedPrefixTx(client,job.case_id,job.source_id,job.id,{sequence:partition.sequence,sha256:prior.sha256})).pin;
  const previousRow=partition.sequence>1?(await client.query('SELECT sha256 FROM usp_display.source_semantic_chunks WHERE job_id=$1 AND sequence=$2',[job.id,partition.sequence-1])).rows[0]:null;
  const previous=previousRow?{sequence:partition.sequence-1,sha256:previousRow.sha256}:null;
  const prefix=previous?await sealedPrefixTx(client,job.case_id,job.source_id,job.id,previous):null;
  if(partition.sequence>1&&!prefix)throw new AppError(409,'SEMANTIC_PREFIX_CLOSURE','Seal the preceding complete chunk first.');
  const rows=(await client.query(`SELECT ${observationColumns},u.native_key,encode(sha256(ST_AsEWKB(o.native_geometry)),'hex') native_hash,
    CASE WHEN o.geographic_geometry IS NULL THEN NULL ELSE encode(sha256(ST_AsEWKB(o.geographic_geometry)),'hex') END geo_hash
    FROM administrative_unit_observations o JOIN administrative_units u ON u.id=o.unit_id WHERE o.job_id=$1 AND o.source_id=$2 AND o.feature_index BETWEEN $3 AND $4 ORDER BY o.feature_index FOR UPDATE OF o`,[job.id,job.source_id,partition.first,partition.last])).rows;
  if(rows.length!==partition.records)throw new AppError(422,'SEMANTIC_CHUNK_CLOSURE','A chunk must contain every complete expected observation.');
  const records:SemanticRecord[]=[];
  for(let i=0;i<rows.length;i++){const row=rows[i],entry=preparation.index.entries[partition.first+i];
    if(row.committed_chunk_sequence!==null||row.feature_index!==entry.index||fingerprint(row.native_key)!==fingerprint(entry.key)||row.disposition!==entry.disposition
      ||row.reason!==entry.reason||fingerprint(row.raw_ref)!==fingerprint(entry.raw)||fingerprint(row.geographic_ref)!==fingerprint(entry.geographic)
      ||fingerprint(row.native_bounds)!==fingerprint(entry.nativeBounds)||fingerprint(row.geographic_bounds)!==fingerprint(entry.geographicBounds))
      throw new AppError(422,'SEMANTIC_RECORD_INTEGRITY','Staged records differ from the fully verified source disposition index.');
    row.native_geometry_sha256=row.native_hash;row.geographic_geometry_sha256=row.geo_hash;
    row.record_sha256=fingerprint({unitId:row.unit_id,key:row.native_key,sourceId:row.source_id,featureIndex:row.feature_index,disposition:row.disposition,reason:row.reason,
      locator:row.source_locator,properties:row.properties,nativeBounds:row.native_bounds,geographicBounds:row.geographic_bounds,raw:row.raw_ref,geographic:row.geographic_ref,
      nativeGeometry:row.native_hash,geographicGeometry:row.geo_hash});
    records.push(record(row));
    await client.query('UPDATE administrative_unit_observations SET committed_chunk_sequence=$3,native_geometry_sha256=$4,geographic_geometry_sha256=$5,record_sha256=$6 WHERE job_id=$1 AND feature_index=$2',[job.id,row.feature_index,partition.sequence,row.native_hash,row.geo_hash,row.record_sha256]);
  }
  const input=ProjectedVectorInputSchema.parse(job.payload),all=[...(prefix?.rows.map(record)??[]),...records],admitted=all.filter(r=>r.disposition==='admitted').length;
  const chunk=SemanticChunkSchema.parse({version:p.version,jobId:job.id,caseId:job.case_id,caseRevision:input.caseRevision,sourceId:job.source_id,sourceRevision:input.sourceRevision,
    sourceFamilyId:input.sourceFamilyId,sourceSha256:input.sha256,inputFingerprint:input.inputFingerprint,accessBinding:input.accessBinding,publisherSha256:input.semanticChunks!.publisherSha256,
    indexSha256:preparation.result.index.sha256,transform:preparation.index.transform,partition,previous,attempt:attempt.number,fence:attempt.fence,records,
    coverage:{kind:'committed_partial',sourceAccepted:false,throughSequence:partition.sequence,expectedChunks:preparation.partitions.length,records:all.length,admitted,quarantined:all.length-admitted,
      positions:(prefix?.chunk.coverage.positions??0)+partition.positions,expectedRecords:733,remainingRecords:733-all.length,prefixDependencySha256:fingerprint(all)}});
  const bytes=Buffer.byteLength(JSON.stringify(chunk));if(bytes>p.chunkBodyBytes)throw new AppError(422,'SEMANTIC_CHUNK_METADATA_BUDGET','The immutable chunk exceeds its metadata bound.');
  await metadataBudgetTx(client,job.id,chunk,'chunk');const hash=sha256(JSON.stringify(chunk));
  await client.query('INSERT INTO usp_display.source_semantic_chunks(job_id,sequence,source_id,sha256,body) VALUES($1,$2,$3,$4,$5)',[job.id,partition.sequence,job.source_id,hash,chunk]);
  await appendCaseIngestionTx(client,job.case_id,{kind:'projected-vector.chunk',jobId:job.id,sequence:partition.sequence,records:all.length,sourceAccepted:false});
  return {sequence:partition.sequence,sha256:hash};
}
export async function reservedDisplayCountTx(client:PoolClient){return Number((await client.query(`SELECT count(*)::int count FROM operations o CROSS JOIN LATERAL jsonb_each(o.result->'outcomes') s WHERE o.kind='stream-display-capacity' AND s.value->>'state'='reserved'`)).rows[0].count);}
export async function reserveSemanticDisplaysTx(client:PoolClient,job:any){
  const aliases=(await client.query("SELECT count(*)::int count FROM operations WHERE kind='private-mvt'")).rows[0].count;
  const quota=await privateMvtCapacityTx(client),reserved=await reservedDisplayCountTx(client);
  if(quota.jobs+reserved+p.displayMilestones>m.jobs||quota.history+reserved+p.displayMilestones>m.completed||aliases+reserved+p.displayMilestones>m.requests)
    throw new AppError(429,'MVT_RETENTION_BUDGET','Three semantic display milestones exceed existing finite tile job/history capacity.');
  const result=SemanticDisplayReservationSchema.parse({version:p.version,jobId:job.id,sourceId:job.source_id,slots:{early:randomUUID(),middle:randomUUID(),final:randomUUID()},outcomes:{early:{state:'reserved'},middle:{state:'reserved'},final:{state:'reserved'}}});
  await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'stream-display-capacity',$3,$4)",[job.case_id,reservationKey(job.id),job.input_fingerprint,result]);
}
export async function displayReservationTx(client:PoolClient,job:any){const row=(await client.query("SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='stream-display-capacity' FOR UPDATE",[job.case_id,reservationKey(job.id)])).rows[0]??notFound('Semantic display reservation is unavailable.');return SemanticDisplayReservationSchema.parse(row.result);}
export async function displayOutcomeTx(client:PoolClient,job:any,phase:SemanticDisplayPhase,outcome:{state:'created';jobId:string;errorCode?:string}|{state:'unavailable';code:string}){
  const reservation=await displayReservationTx(client,job);reservation.outcomes[phase]=outcome;
  await client.query("UPDATE operations SET result=$3 WHERE case_id=$1 AND operation_key=$2 AND kind='stream-display-capacity'",[job.case_id,reservationKey(job.id),reservation]);
}
export async function releaseSemanticDisplaysTx(client:PoolClient,job:any,code:string){
  if(!job.payload.semanticChunks)return;const reservation=await displayReservationTx(client,job);
  for(const phase of ['early','middle','final'] as const)if(reservation.outcomes[phase].state==='reserved')reservation.outcomes[phase]={state:'unavailable',code};
  await client.query("UPDATE operations SET result=$3 WHERE case_id=$1 AND operation_key=$2 AND kind='stream-display-capacity'",[job.case_id,reservationKey(job.id),reservation]);
}
export class SemanticChunkService{
  async chunk(caseId:string,sourceId:string,jobId:string,sequence:number){
    for(const v of [caseId,sourceId,jobId])z.string().uuid().parse(v);
    return mvtTransaction(async client=>{await projectedContextTx(client,caseId,sourceId);const row=(await client.query('SELECT sha256 FROM usp_display.source_semantic_chunks WHERE job_id=$1 AND source_id=$2 AND sequence=$3',[jobId,sourceId,sequence])).rows[0]??notFound('Source chunk is not committed.');
      const value=await sealedPrefixTx(client,caseId,sourceId,jobId,{sequence,sha256:row.sha256},'immutable_read');
      return SemanticChunkResponseSchema.parse({pin:value.pin,chunk:value.chunk,currentSourceAccepted:value.ctx.source.inspection.projectedVector?.accepted?.jobId===jobId&&value.job.status==='succeeded',sourceJobStatus:value.job.status});});
  }
}
