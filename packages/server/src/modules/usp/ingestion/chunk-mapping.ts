import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CHUNK_MAPPING_LIMITS as limits,ChunkMappingRequestSchema,ChunkMappingInputSchema,
  ChunkMappingStatusSchema,ChunkMappingSlotSchema,ChunkMappingPayloadSchema,ChunkMappingChunkResponseSchema,
  MappingReceiptSchema,MappingPlanSchema,StreamedMappingReceiptSchema,AnyStreamedMappingPlanSchema,
  AnyStreamingInputSchema,TabularMappingReceiptSchema,
  type ChunkMappingInput,type SourceProfile,type TabularSourceProfile,
  type StreamedProfileGeneration} from '@ulpin/contracts/usp';
import {transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {registerUspJobInputTx} from '../jobs';
import {appendCaseIngestionTx,assertIngestionBinding,ingestionBinding} from './events';
import {assertStreamingInputTx,streamingReadContextTx} from './streaming-vector';
import {manualProfileForLockedSourceTx,tabularProfileForLockedSourceTx} from './service';
import {validateMappingPlanV2} from './mapping-plan-v2';
import {mappingContextFromColumnProfile} from './mapping-teacher';
import {officerMappingMethod} from './tabular-recipe';
import {compileMapping} from './registry';
import {assertStreamedIssuerEvidence,compileStreamedMapping} from './streamed-mapping';
import {loadProvisionalStreamedProfileTx,loadSealedStreamedProfileTx} from './streamed-profile';

const uuid=z.string().uuid();
const converterFiles=['packages/contracts/src/usp/chunk-mapping.ts','packages/contracts/src/usp/ingestion.ts',
  'packages/contracts/src/canonical/targets.ts','packages/contracts/src/canonical/mapping-plan.ts',
  'packages/server/src/modules/usp/ingestion/mapping-plan-v2.ts',
  'packages/server/src/modules/usp/ingestion/mapping-executor.ts','packages/server/src/modules/usp/ingestion/unit-table.ts',
  'packages/contracts/src/usp/adaptive-mapping.ts',
  'packages/contracts/src/usp/streamed-profile.ts',
  'packages/server/src/modules/usp/ingestion/registry.ts','packages/server/src/modules/usp/ingestion/chunk-mapping-normalizer.ts',
  'packages/server/src/modules/usp/ingestion/service.ts','packages/server/src/modules/usp/ingestion/adaptive-mapping.ts',
  'packages/server/src/modules/usp/ingestion/adaptive-mapping-service.ts',
  'packages/server/src/modules/usp/ingestion/streamed-mapping.ts',
  'packages/server/src/modules/usp/ingestion/tabular-source.ts',
  'packages/server/src/modules/usp/ingestion/chunk-mapping-agent.ts',
  'packages/server/src/modules/usp/ingestion/tabular-recipe.ts',
  'packages/server/src/modules/usp/ingestion/chunk-mapping-tabular.ts',
  'packages/server/src/modules/usp/ingestion/chunk-mapping-learning.ts',
  'packages/server/src/modules/usp/ingestion/mapping-teacher.ts',
  'packages/server/src/modules/usp/ingestion/mapping-memory.ts','services/geo/geo/usp_learning/stage_a.py',
  'packages/server/src/modules/usp/ingestion/chunk-mapping-worker.ts','packages/server/src/modules/usp/ingestion/chunk-mapping.ts',
  'database/sql/95-ingestion/chunk-mapping.sql'];
export const chunkMappingConverterSha=()=>fingerprint(converterFiles.map(path=>({path,
  sha256:sha256(readFileSync(join(settings.repositoryRoot,path)))})));

async function rawContextTx(client:PoolClient,rawJobId:string){
  const prior=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND operation='streaming-vector'",[rawJobId])).rows[0]
    ??notFound('Source streaming job not found.');
  const raw=AnyStreamingInputSchema.parse(prior.payload),ctx=await assertStreamingInputTx(client,raw);
  const job=(await client.query("SELECT payload,input_fingerprint FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='streaming-vector' FOR SHARE",
    [rawJobId,raw.caseId,raw.sourceId])).rows[0]??notFound('Source streaming job not found.');
  if(job.input_fingerprint!==fingerprint(raw)||fingerprint(job.payload)!==fingerprint(raw))
    conflict('The raw streaming job input changed.');
  return {raw,ctx,rawInputFingerprint:job.input_fingerprint as string};
}
async function manualProfileTx(client:PoolClient,caseId:string,revision:number,source:any)
  :Promise<SourceProfile|TabularSourceProfile|null>{
  if(source.profile==='tabular-manual-v1')return tabularProfileForLockedSourceTx(client,caseId,revision,source);
  return source.profile==='geojson-manual-v1'?manualProfileForLockedSourceTx(client,caseId,revision,source):null;
}
async function approvedRecipeTx(client:PoolClient,caseId:string,sourceId:string,subject:string,
  profile:SourceProfile|TabularSourceProfile|StreamedProfileGeneration|null,source:any,prefixAdmission:boolean){
  const row=(await client.query('SELECT body FROM usp_mapping_recipes WHERE case_id=$1 AND source_id=$2 FOR SHARE',[caseId,sourceId])).rows[0];
  if(!row)return null;
  if(!profile)conflict('The approved recipe has no current supported source profile.');
  if(profile.version==='manual-tabular/1'){
    if(prefixAdmission)conflict('Tabular recipes cannot name a GIS prefix profile.');
    const receipt=TabularMappingReceiptSchema.parse(row.body),plan=receipt.plan;
    if(receipt.state!=='approved')return null;
    if(receipt.planHash!==fingerprint({plan,destination:null})||receipt.approval?.planHash!==receipt.planHash
      ||receipt.approval.subject!==subject||receipt.approval.provenance!=='server_configured_local_operator'
      ||plan.mapping.method!==officerMappingMethod(subject)||fingerprint(plan.source)!==fingerprint(profile.source)
      ||fingerprint(plan.tabular)!==fingerprint(profile.tabular)||plan.workspaceRevision!==profile.workspaceRevision
      ||plan.workspaceFingerprint!==profile.workspaceFingerprint||plan.caseId!==caseId)
      conflict('The approved tabular recipe no longer belongs to this exact source context.');
    const context=mappingContextFromColumnProfile(profile.profile,profile.tabular.selection);
    if(!validateMappingPlanV2(plan.mapping,context).success)
      conflict('The approved tabular recipe failed canonical revalidation.');
    return {receipt,profile};
  }
  if(profile.version==='manual-geojson/1'){
    if(prefixAdmission)conflict('Prefix admission requires one reviewed streamed profile.');
    const receipt=MappingReceiptSchema.parse(row.body),plan=MappingPlanSchema.parse(receipt.plan);
    if(!['approved','executed'].includes(receipt.state))return null;
    const planHash=fingerprint({plan,destination:receipt.destination});
    if(receipt.planHash!==planHash||receipt.approval?.planHash!==planHash||receipt.approval?.subject!==subject
      ||receipt.approval.provenance!=='server_configured_local_operator'
      ||fingerprint(plan.source)!==fingerprint(profile.source)||plan.workspaceRevision!==profile.workspaceRevision
      ||plan.workspaceFingerprint!==profile.workspaceFingerprint)
      conflict('The approved recipe changed or no longer belongs to this exact source profile.');
    compileMapping(plan,profile);return {receipt,profile};
  }
  const receipt=StreamedMappingReceiptSchema.parse(row.body),plan=AnyStreamedMappingPlanSchema.parse(receipt.plan);
  if((plan.version==='streamed-prefix-mapping/1')!==prefixAdmission)
    conflict('The approved recipe does not match the requested profile scope.');
  if(receipt.state!=='approved')return null;
  if(receipt.planHash!==fingerprint(plan)||receipt.approval?.planHash!==receipt.planHash
    ||receipt.approval.subject!==subject||receipt.approval.provenance!=='server_configured_local_operator'
    ||plan.caseId!==caseId||plan.source.sourceId!==sourceId)
    conflict('The streamed recipe changed or belongs to another local source context.');
  assertStreamedIssuerEvidence(plan,source);
  compileStreamedMapping(plan,profile);return {receipt,profile};
}

/** Case and source are locked by the raw pin before any job, recipe or mapping state. */
export async function assertChunkMappingInputTx(client:PoolClient,input:ChunkMappingInput){
  const {raw,ctx,rawInputFingerprint}=await rawContextTx(client,input.rawJobId);
  const {inputFingerprint,...base}=input;
  if(input.version!==limits.version||fingerprint(base)!==inputFingerprint||input.converterSha256!==chunkMappingConverterSha()
    ||rawInputFingerprint!==input.rawInputFingerprint||raw.readerSha256!==input.readerSha256
    ||raw.caseId!==input.caseId||raw.caseRevision!==input.caseRevision||raw.sourceId!==input.sourceId
    ||raw.sourceRevision!==input.sourceRevision||raw.sourceFamilyId!==input.sourceFamilyId
    ||raw.sourceSha256!==input.sourceSha256||raw.accessBinding!==input.accessBinding||raw.subject!==input.subject)
    conflict('The pinned raw source, converter or private access changed.');
  const profile=input.profileJobId!==undefined
    ?(await (input.prefixAdmissionVersion?loadProvisionalStreamedProfileTx:loadSealedStreamedProfileTx)(
      client,input.profileJobId,input.profileGeneration!,input.profileHash!,
      input.rawJobId,input.caseId,input.sourceId)).profile
    :await manualProfileTx(client,input.caseId,input.caseRevision,ctx.source);
  if(fingerprint(input.tabular??null)!==fingerprint(raw.framing==='tabular'?raw.tabular:null))
    conflict('The tabular raw pins changed.');
  if(input.schemaFingerprint!==(profile?.source.schemaFingerprint??null))conflict('The source schema fingerprint changed.');
  if(input.workspaceFingerprint!==(profile&&profile.version!=='streamed-profile/1'?profile.workspaceFingerprint:null))
    conflict('The source workspace fingerprint changed.');
  const approved=await approvedRecipeTx(client,input.caseId,input.sourceId,input.subject,profile,ctx.source,
    !!input.prefixAdmissionVersion);
  if(input.route==='approved_recipe'){
    if(!approved||approved.receipt.id!==input.recipeId||approved.receipt.revision!==input.recipeRevision
      ||approved.receipt.planHash!==input.planHash)conflict('The approved recipe revision changed.');
  }else if(input.recipeId!==null||input.recipeRevision!==null||input.planHash!==null)
    conflict('A proposal-only job cannot contain an executable recipe.');
  return {raw,ctx,profile,approved};
}

/** Historical reads keep source/private/integrity pins; they do not inspect or relax current recipe authority. */
export async function chunkMappingReadContextTx(
  client:PoolClient,input:ChunkMappingInput,caseId:string,sourceId:string,jobId:string,storedHash:string,
){
  const {inputFingerprint,...base}=input;
  if(input.caseId!==caseId||input.sourceId!==sourceId||input.jobId!==jobId)
    throw new AppError(403,'MAPPING_READ_BINDING','The retained job belongs to another private source context.');
  if(fingerprint(base)!==inputFingerprint||storedHash!==fingerprint(input))
    throw new AppError(422,'MAPPING_INPUT_INTEGRITY','The mapped job differs from its immutable input receipt.');
  const job=(await client.query("SELECT payload,input_fingerprint FROM jobs WHERE id=$1 AND case_id=$2 " +
    "AND source_id=$3 AND operation='streaming-vector' FOR SHARE",[input.rawJobId,caseId,sourceId])).rows[0]
    ??notFound('Source streaming job not found.');
  const raw=AnyStreamingInputSchema.parse(job.payload);
  const {ctx,freshness}=await streamingReadContextTx(client,raw,caseId,sourceId,input.rawJobId,job.input_fingerprint);
  if(input.rawInputFingerprint!==job.input_fingerprint||input.readerSha256!==raw.readerSha256
    ||input.caseRevision!==raw.caseRevision||input.sourceRevision!==raw.sourceRevision
    ||input.sourceFamilyId!==raw.sourceFamilyId||input.sourceSha256!==raw.sourceSha256
    ||input.subject!==raw.subject||input.accessBinding!==raw.accessBinding
    ||fingerprint(input.tabular??null)!==fingerprint(raw.framing==='tabular'?raw.tabular:null))
    throw new AppError(422,'MAPPING_INPUT_INTEGRITY','The mapped job differs from its retained raw source pins.');
  if(input.converterSha256!==chunkMappingConverterSha())freshness.reasons.push('converter_changed');
  freshness.current=freshness.reasons.length===0;
  return {ctx,freshness};
}

export function chunkMappingSlot(row:any){return ChunkMappingSlotSchema.parse({chunkIndex:row.chunk_index,
  status:row.status,published:row.published,rawResultSha256:row.raw_result_sha256,
  schemaFingerprint:row.schema_fingerprint,schemaDrift:row.schema_drift,
  firstFeatureIndex:row.first_feature_index,lastFeatureIndex:row.last_feature_index,records:row.records,
  normalized:row.normalized,quarantined:row.quarantined,unresolved:row.unresolved,bytes:row.bytes,
  ref:row.object_key?{key:row.object_key,sha256:row.object_sha256,bytes:row.bytes}:null,
  issueCode:row.issue_code,resultSha256:row.result_sha256,attempt:row.attempt,fence:Number(row.fence)});}
async function statusTx(
  client:PoolClient,input:ChunkMappingInput,
  read?:{caseId:string;sourceId:string;jobId:string;storedHash:string},
){
  const {ctx,freshness}=read
    ?await chunkMappingReadContextTx(client,input,read.caseId,read.sourceId,read.jobId,read.storedHash)
    :{...(await assertChunkMappingInputTx(client,input)),freshness:{current:true,reasons:[]}};
  const row=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1',[input.jobId])).rows[0]
    ??notFound('Chunk mapping state unavailable.');
  const raw=(await client.query('SELECT state,unknown_remainder,issue_code FROM usp_streaming_vector_imports WHERE job_id=$1',[input.rawJobId])).rows[0]
    ??notFound('Source streaming state unavailable.');
  const slots=(await client.query('SELECT * FROM usp_chunk_mapping_slots WHERE job_id=$1 AND published=true ORDER BY chunk_index DESC LIMIT 32',
    [input.jobId])).rows.reverse().map(chunkMappingSlot);
  const complete=row.sealed_chunks!==null&&!row.unknown_remainder
    &&['completed','completed_with_rejections'].includes(row.state)
    &&['completed','completed_with_rejections'].includes(raw.state)&&!raw.unknown_remainder;
  const gis=ctx.source.inspection?.gis;
  return ChunkMappingStatusSchema.parse({...freshness,version:limits.version,jobId:input.jobId,rawJobId:input.rawJobId,
    caseId:input.caseId,sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,
    ...(input.tabular?{tabular:input.tabular}:{}),status:row.state,route:input.route,
    recipeId:input.recipeId,recipeRevision:input.recipeRevision,
    schemaFingerprint:input.schemaFingerprint,converterSha256:input.converterSha256,
    ...(input.profileJobId?{profileJobId:input.profileJobId,profileGeneration:input.profileGeneration,
      profileHash:input.profileHash}:{}),
    ...(input.prefixAdmissionVersion?{prefixAdmissionVersion:input.prefixAdmissionVersion}:{}),
    sourceCrs:typeof gis?.sourceCrs==='string'?gis.sourceCrs:null,
    referenceEvidence:typeof gis?.crsEvidence==='string'?gis.crsEvidence.slice(0,200):null,
    globalPlacement:'not_qualified',nextPublishIndex:row.next_publish_index,sealedChunks:row.sealed_chunks,
    records:row.records,normalized:row.normalized,quarantined:row.quarantined,unresolved:row.unresolved,
    duplicateKeys:row.duplicate_keys,schemaDriftChunks:row.schema_drift_chunks,
    issueCode:row.issue_code,unknownRemainder:row.unknown_remainder,
    sourceComplete:complete,
    identityComplete:!input.tabular&&complete&&row.normalized===row.records&&row.duplicate_keys===0
      &&row.schema_drift_chunks===0,
    proposal:row.proposal,proposalTrainingEligible:false,slots});
}

export class ChunkMappingService{
  async enqueue(caseValue:string,sourceValue:string,value:unknown){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),request=ChunkMappingRequestSchema.parse(value);
    const binding=ingestionBinding(caseId),converterSha256=chunkMappingConverterSha();
    return transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('chunk-mapping-admission-v1',0))");
      const {raw,ctx,rawInputFingerprint}=await rawContextTx(client,request.rawJobId);
      if(raw.caseId!==caseId||raw.sourceId!==sourceId)notFound('Source streaming job not found in this case.');
      const digest=fingerprint({request,access:binding.access,converterSha256}),key=`chunk-mapping:${request.requestKey}`;
      const prior=(await client.query("SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='chunk-mapping'",
        [caseId,key])).rows[0];
      if(prior){if(prior.payload_hash!==digest)conflict('The mapping request key names different inputs.');
        const job=(await client.query("SELECT payload FROM jobs WHERE id=$1 AND operation='chunk-mapping'",[prior.result.jobId])).rows[0]
          ??notFound('Chunk mapping job not found.');return statusTx(client,ChunkMappingInputSchema.parse(job.payload));}
      if(ctx.current.revision!==request.expectedCaseRevision||ctx.source.revision!==request.expectedSourceRevision
        ||ctx.source.sha256!==request.sourceSha256)conflict('The retained source changed before mapping admission.');
      const rawState=(await client.query('SELECT state,issue_code FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
        [request.rawJobId])).rows[0]??notFound('Source streaming state unavailable.');
      if(rawState.issue_code==='STREAMING_SOURCE_INTEGRITY')throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The original failed integrity verification.');
      const profile=request.profileJobId!==undefined
        ?(await (request.prefixAdmissionVersion?loadProvisionalStreamedProfileTx:loadSealedStreamedProfileTx)(
          client,request.profileJobId,request.profileGeneration!,request.profileHash!,
          request.rawJobId,caseId,sourceId)).profile
        :await manualProfileTx(client,caseId,ctx.current.revision,ctx.source);
      if(fingerprint(request.tabular??null)!==fingerprint(raw.framing==='tabular'?raw.tabular:null))
        conflict('Mapping admission requires the exact tabular raw reader pins.');
      const approved=await approvedRecipeTx(client,caseId,sourceId,binding.subject,profile,ctx.source,
        !!request.prefixAdmissionVersion);
      if(request.prefixAdmissionVersion&&!approved)
        conflict('A reviewed source prefix recipe must be approved before mapped admission.');
      const active=Number((await client.query("SELECT count(*)::int n FROM usp_chunk_mapping_imports WHERE state IN ('queued','running')")).rows[0].n);
      if(active>=limits.active)throw new AppError(429,'MAPPING_CAPACITY','The bounded mapping worker is occupied.');
      const history=Number((await client.query('SELECT count(*)::int n FROM usp_chunk_mapping_imports')).rows[0].n);
      if(history>=128)throw new AppError(429,'MAPPING_HISTORY_CAPACITY','The finite mapping history is full.');
      const jobId=randomUUID(),base={version:limits.version,jobId,caseId,caseRevision:raw.caseRevision,
        sourceId,sourceRevision:raw.sourceRevision,sourceFamilyId:raw.sourceFamilyId,sourceSha256:raw.sourceSha256,
        rawJobId:request.rawJobId,rawInputFingerprint,readerSha256:raw.readerSha256,
        route:approved?'approved_recipe' as const:'proposal_only' as const,recipeId:approved?.receipt.id??null,
        recipeRevision:approved?.receipt.revision??null,planHash:approved?.receipt.planHash??null,
        schemaFingerprint:profile?.source.schemaFingerprint??null,
        workspaceFingerprint:profile&&profile.version!=='streamed-profile/1'?profile.workspaceFingerprint:null,
        ...(raw.framing==='tabular'?{tabular:raw.tabular}:{}),
        ...(request.profileJobId?{profileJobId:request.profileJobId,profileGeneration:request.profileGeneration,
          profileHash:request.profileHash}:{}),
        ...(request.prefixAdmissionVersion?{prefixAdmissionVersion:request.prefixAdmissionVersion}:{}),
        converterSha256,subject:binding.subject,accessBinding:binding.access};
      const input=ChunkMappingInputSchema.parse({...base,inputFingerprint:fingerprint(base)}),hash=fingerprint(input);
      await client.query("INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload) VALUES($1,$2,$3,'chunk-mapping',$4,$5,$6)",
        [jobId,caseId,sourceId,raw.caseRevision,hash,input]);
      await registerUspJobInputTx(client,jobId,{kind:'intake',workspaceId:caseId,version:raw.caseRevision+1},sourceId,hash);
      await client.query("INSERT INTO usp_chunk_mapping_imports(job_id,raw_job_id,case_id,source_id,source_revision,input_sha256,state) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [jobId,request.rawJobId,caseId,sourceId,raw.sourceRevision,hash]);
      await client.query("INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,'chunk-mapping',$3,$4)",
        [caseId,key,digest,{jobId}]);
      await appendCaseIngestionTx(client,caseId,{kind:'chunk-mapping.changed',sourceId,sourceRevision:raw.sourceRevision,
        jobId,rawJobId:request.rawJobId,status:'queued'},binding.subject);
      return statusTx(client,input);
    });
  }
  async status(caseValue:string,sourceValue:string,jobValue:string){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    return transaction(async client=>{
      const job=(await client.query("SELECT payload,input_fingerprint FROM jobs WHERE id=$1 AND case_id=$2 " +
        "AND source_id=$3 AND operation='chunk-mapping'",[jobId,caseId,sourceId])).rows[0]
        ??notFound('Chunk mapping job not found.');
      return statusTx(client,ChunkMappingInputSchema.parse(job.payload),
        {caseId,sourceId,jobId,storedHash:job.input_fingerprint});
    });
  }
  async chunk(caseValue:string,sourceValue:string,jobValue:string,indexValue:number){
    const caseId=uuid.parse(caseValue),sourceId=uuid.parse(sourceValue),jobId=uuid.parse(jobValue);
    const index=z.number().int().min(0).max(limits.chunks).parse(indexValue),binding=ingestionBinding(caseId);
    const initial=await transaction(async client=>{
      const job=(await client.query("SELECT payload,input_fingerprint FROM jobs WHERE id=$1 AND case_id=$2 " +
        "AND source_id=$3 AND operation='chunk-mapping'",[jobId,caseId,sourceId])).rows[0]
        ??notFound('Chunk mapping job not found.');
      const input=ChunkMappingInputSchema.parse(job.payload);
      await chunkMappingReadContextTx(client,input,caseId,sourceId,jobId,job.input_fingerprint);
      const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR SHARE',[jobId])).rows[0]
        ??notFound('Chunk mapping state unavailable.');
      const raw=(await client.query('SELECT state,issue_code FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',[input.rawJobId])).rows[0];
      if(raw?.issue_code==='STREAMING_SOURCE_INTEGRITY')throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The original failed integrity verification.');
      const slot=(await client.query('SELECT * FROM usp_chunk_mapping_slots WHERE job_id=$1 AND chunk_index=$2 AND published=true FOR SHARE',
        [jobId,index])).rows[0]??notFound('This mapped chunk is not published.');
      return {input,slot:chunkMappingSlot(slot),state};
    });
    let payload=null;
    if(initial.slot.ref){
      const bytes=Buffer.from(await readObject(initial.slot.ref.key));
      if(bytes.length!==initial.slot.ref.bytes||sha256(bytes)!==initial.slot.ref.sha256)
        throw new AppError(422,'MAPPING_CHUNK_INTEGRITY','The mapped draft differs from its immutable receipt.');
      payload=ChunkMappingPayloadSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
      if(payload.jobId!==jobId||payload.rawJobId!==initial.input.rawJobId||payload.sourceId!==sourceId
        ||payload.sourceRevision!==initial.input.sourceRevision||payload.sourceSha256!==initial.input.sourceSha256
        ||payload.recipeRevision!==initial.input.recipeRevision||payload.chunkIndex!==index
        ||payload.rawResultSha256!==initial.slot.rawResultSha256||payload.converterSha256!==initial.input.converterSha256
        ||payload.profileHash!==initial.input.profileHash
        ||payload.prefixAdmissionVersion!==initial.input.prefixAdmissionVersion
        ||fingerprint(payload.tabular??null)!==fingerprint(initial.input.tabular??null))
        throw new AppError(422,'MAPPING_CHUNK_INTEGRITY','The mapped draft belongs to another pinned source or converter.');
    }
    assertIngestionBinding(binding);
    const fresh=await transaction(async client=>{
      const job=(await client.query("SELECT payload,input_fingerprint FROM jobs WHERE id=$1 AND case_id=$2 " +
        "AND source_id=$3 AND operation='chunk-mapping' FOR SHARE",[jobId,caseId,sourceId])).rows[0]
        ??notFound('Chunk mapping job not found.');
      if(fingerprint(job.payload)!==fingerprint(initial.input))conflict('The mapped job changed during payload read.');
      const {freshness}=await chunkMappingReadContextTx(
        client,initial.input,caseId,sourceId,jobId,job.input_fingerprint);
      const state=(await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR SHARE',[jobId])).rows[0]
        ??notFound('Chunk mapping state unavailable.');
      const raw=(await client.query('SELECT state,unknown_remainder,issue_code FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
        [initial.input.rawJobId])).rows[0]??notFound('Source streaming state unavailable.');
      const slot=(await client.query('SELECT * FROM usp_chunk_mapping_slots WHERE job_id=$1 AND chunk_index=$2 AND published=true FOR SHARE',
        [jobId,index])).rows[0]??notFound('This mapped chunk is no longer published.');
      if(slot.result_sha256!==initial.slot.resultSha256||slot.object_key!==(initial.slot.ref?.key??null)
        ||slot.object_sha256!==(initial.slot.ref?.sha256??null)||Number(slot.bytes)!==initial.slot.bytes)
        conflict('The mapped chunk changed during payload read.');
      if(raw.issue_code==='STREAMING_SOURCE_INTEGRITY')throw new AppError(422,'STREAMING_SOURCE_INTEGRITY','The original failed integrity verification.');
      assertIngestionBinding(binding);
      const complete=state.sealed_chunks!==null&&!state.unknown_remainder
        &&['completed','completed_with_rejections'].includes(state.state)
        &&['completed','completed_with_rejections'].includes(raw.state)&&!raw.unknown_remainder;
      return {freshness,complete,unknownRemainder:state.unknown_remainder,
        identityComplete:!initial.input.tabular&&complete&&state.normalized===state.records&&state.duplicate_keys===0
          &&state.schema_drift_chunks===0};
    });
    return ChunkMappingChunkResponseSchema.parse({...fresh.freshness,slot:initial.slot,payload,
      sourceComplete:fresh.complete,
      identityComplete:fresh.identityComplete,unknownRemainder:fresh.unknownRemainder});
  }
}
