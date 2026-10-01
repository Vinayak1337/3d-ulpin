import type { PoolClient } from 'pg';
import {RegistryCityJSONValidationInputSchema} from '@ulpin/contracts';
import {fingerprint} from '../cases/domain';
import {ingestionBinding,assertIngestionBinding} from './ingestion/events';
import { UspJobProjectionSchema, UspAssetRefSchema, UspScopeSchema,
  type AssetRef, type UspScope } from '@ulpin/contracts/usp';
import { transaction,type DbDeadline } from '../../infrastructure/db';
import { AppError, conflict, notFound } from '../../infrastructure/errors';
import { appendUspOutboxTx } from './commands';
import { ProjectedVectorInputSchema, PrivateMvtInputSchema, DocumentInputSchema, StreamingVectorInputSchema,
  StreamedProfileInputSchema, ChunkMappingInputSchema, RasterWindowInputSchema, PointBatchInputSchema, CityJSONInputSchema } from '@ulpin/contracts/usp';

const LEASE_SECONDS = 180;
const MAX_ATTEMPTS = 3;
export type UspJobAttempt = { jobId: string; number: number; fence: number; owner: string; leaseUntil: string; inputSha256: string };
type Attempt = UspJobAttempt;

/** Attach immutable USP input pins to an existing logical job, never creating a second broker. */
export async function registerUspJobInputTx(client: PoolClient, jobId: string,
  scope: UspScope, inputManifestId: string, inputSha256: string) {
  UspScopeSchema.parse(scope);
  const job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0] ?? notFound();
  if (job.operation === 'projected-vector') {
    const input=ProjectedVectorInputSchema.parse(job.payload);
    if(scope.kind!=='intake' || scope.workspaceId!==job.case_id || scope.version!==job.case_revision+1
      || input.kind!=='retained_source' || input.sourceId!==job.source_id || input.caseId!==job.case_id
      || input.caseRevision!==job.case_revision || inputManifestId!==job.source_id || inputSha256!==job.input_fingerprint)
      throw new AppError(422,'PROJECTED_INPUT_SCOPE','The projected job must pin its existing retained source and intake revision.');
  } else if(job.operation==='private-mvt'){
    const input=PrivateMvtInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.source.caseId!==job.case_id||input.source.sourceId!==job.source_id||input.source.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'MVT_INPUT_SCOPE','Tile jobs must pin their existing accepted source and intake context.');
  } else if(job.operation==='document-extraction'){
    const input=DocumentInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'DOCUMENT_INPUT_SCOPE','Document jobs must pin their retained source and exact intake context.');
  } else if(job.operation==='raster-window'){
    const input=RasterWindowInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'RASTER_INPUT_SCOPE','Raster jobs must pin their retained source and exact intake context.');
  } else if(job.operation==='cityjson-native'){
    const input=CityJSONInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'CITYJSON_INPUT_SCOPE','CityJSON jobs must pin their unchanged source and exact intake context.');
  } else if(job.operation==='cityjson-validation'){
    const input=RegistryCityJSONValidationInputSchema.parse(job.payload),source=input.candidate.input,
      binding=ingestionBinding(source.caseId),digest=fingerprint(input);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||source.caseId!==job.case_id||source.sourceId!==job.source_id||source.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||inputSha256!==digest
      ||source.subject!==binding.subject||source.accessSha256!==binding.access)
      throw new AppError(422,'CITYJSON_VALIDATION_INPUT_SCOPE','Validation jobs must enroll the exact server-derived source/draft input and private context.');
    assertIngestionBinding(binding);
  } else if(job.operation==='point-batch'){
    const input=PointBatchInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'POINT_INPUT_SCOPE','Point jobs must pin their retained source and exact intake context.');
  } else if(job.operation==='streaming-vector'){
    const input=StreamingVectorInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'STREAMING_INPUT_SCOPE','Streaming jobs must pin their retained source and exact intake context.');
  } else if(job.operation==='streamed-profile'){
    const input=StreamedProfileInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'STREAMED_PROFILE_INPUT_SCOPE','Profile jobs must pin an existing retained source and intake revision.');
  } else if(job.operation==='chunk-mapping'){
    const input=ChunkMappingInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint)
      throw new AppError(422,'MAPPING_INPUT_SCOPE','Mapped draft jobs must pin an existing retained source and intake revision.');
  } else if (job.operation !== 'usp:packet0') {
    throw new AppError(422, 'USP_JOB_OPERATION', 'Only registered USP jobs can use fenced attempts.');
  }
  const prior = (await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1', [job.id])).rows[0];
  if (prior) {
    if (prior.input_manifest_id !== inputManifestId || prior.input_sha256 !== inputSha256) conflict('Job input pins changed.');
    return;
  }
  await client.query(`INSERT INTO usp_job_metadata(job_id,input_manifest_id,input_sha256,scope)
    VALUES($1,$2,$3,$4)`, [jobId, inputManifestId, inputSha256, scope]);
}

/** Reuse the fenced attempt authority after a domain owner has locked its case/source. */
export async function assertUspJobAttemptTx(client:PoolClient,attempt:Attempt){
  const job=(await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE',[attempt.jobId])).rows[0];
  const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[attempt.jobId])).rows[0];
  const row=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 AND number=$2 FOR UPDATE',[attempt.jobId,attempt.number])).rows[0];
  if(!meta || !row || job?.status!=='running' || meta.logical_state!=='running' || row.state!=='active'
    || Number(row.fence)!==attempt.fence || row.owner!==attempt.owner || row.input_sha256!==attempt.inputSha256
    || meta.input_sha256!==attempt.inputSha256 || new Date(row.lease_until).getTime()<=Date.now())
    conflict('This worker completion expired, changed inputs or was fenced.');
}

export async function claimUspJobAttempt(jobId: string, owner: string,beforeLocks?:(client:PoolClient)=>Promise<void>,deadline?:DbDeadline): Promise<Attempt> {
  if (!owner || owner.length > 128) throw new AppError(400, 'USP_JOB_OWNER', 'A bounded worker identity is required.');
  return transaction(async client => {
    if(beforeLocks)await beforeLocks(client);
    const job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0] ?? notFound();
    const meta = (await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [jobId])).rows[0] ?? notFound();
    if (['cancelled', 'paused', 'succeeded'].includes(meta.logical_state)) conflict('The logical job cannot be claimed.');
    if (!['queued', 'running'].includes(job.status)) conflict('The existing logical job is not claimable.');
    const attempts = (await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1', [jobId])).rows[0];
    if (attempts?.state === 'active' && new Date(attempts.lease_until).getTime() > Date.now()) conflict('An attempt still owns this job.');
    const number = Number(attempts?.number ?? 0) + 1;
    if (number > MAX_ATTEMPTS) throw new AppError(422, 'USP_JOB_ATTEMPTS', 'Explicit retry is required after the attempt limit.');
    const fence = Number(attempts?.fence ?? 0) + 1;
    const row = (await client.query(`INSERT INTO usp_job_attempts(job_id,number,fence,owner,input_sha256,lease_until,state)
      VALUES($1,$2,$3,$4,$5,now()+interval '180 seconds','active') RETURNING lease_until`,
      [jobId, number, fence, owner, meta.input_sha256])).rows[0];
    await client.query(`UPDATE usp_job_metadata SET logical_state='running',version=version+1 WHERE job_id=$1`, [jobId]);
    await client.query(`UPDATE jobs SET status='running',attempts=$2 WHERE id=$1`, [jobId, number]);
    return { jobId, number, fence, owner, leaseUntil: new Date(row.lease_until).toISOString(), inputSha256: meta.input_sha256 };
  },deadline);
}

export async function heartbeatUspJobAttempt(attempt: Attempt,beforeLocks?:(client:PoolClient)=>Promise<void>,deadline?:DbDeadline) {
  return transaction(async client => {
    if(beforeLocks)await beforeLocks(client);
    const row = (await client.query(`UPDATE usp_job_attempts SET lease_until=now()+interval '180 seconds'
      WHERE job_id=$1 AND number=$2 AND fence=$3 AND owner=$4 AND input_sha256=$5
      AND state='active' AND lease_until>now() RETURNING lease_until`,
      [attempt.jobId, attempt.number, attempt.fence, attempt.owner, attempt.inputSha256])).rows[0];
    if (!row) conflict('This worker lease expired or was fenced.');
    return { ...attempt, leaseUntil: new Date(row.lease_until).toISOString() };
  },deadline);
}

/** Completion is accepted only through a registered operation's result validator. */
export async function acceptUspJobAttempt(attempt: Attempt, result: AssetRef,
  validateResult: (client: PoolClient, job: Record<string, unknown>, result: AssetRef) => Promise<void>,
  beforeLocks?: (client:PoolClient)=>Promise<void>,beforeCommit?:(client:PoolClient)=>void|Promise<void>,deadline?:DbDeadline) {
  const asset = UspAssetRefSchema.parse(result);
  return transaction(async client => {
    if(beforeLocks)await beforeLocks(client);
    const job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [attempt.jobId])).rows[0] ?? notFound();
    const meta = (await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [attempt.jobId])).rows[0] ?? notFound();
    const row = (await client.query(`SELECT * FROM usp_job_attempts WHERE job_id=$1 AND number=$2 FOR UPDATE`,
      [attempt.jobId, attempt.number])).rows[0] ?? notFound();
    if (meta.logical_state === 'succeeded' && Number(meta.accepted_fence) === attempt.fence) return meta.result_ref as AssetRef;
    if (meta.logical_state !== 'running' || job.status !== 'running' || row.state !== 'active'
      || Number(row.fence) !== attempt.fence || row.owner !== attempt.owner
      || row.input_sha256 !== meta.input_sha256 || new Date(row.lease_until).getTime() <= Date.now()) {
      conflict('This completion was superseded or its lease expired.');
    }
    await validateResult(client, job, asset);
    await client.query(`UPDATE usp_job_attempts SET state='accepted',completion_sha256=$2 WHERE job_id=$1 AND number=$3`,
      [attempt.jobId, asset.sha256, attempt.number]);
    await client.query(`UPDATE usp_job_metadata SET logical_state='succeeded',result_ref=$2,
      accepted_fence=$3,version=version+1 WHERE job_id=$1`, [attempt.jobId, asset, attempt.fence]);
    await client.query(`UPDATE jobs SET status='succeeded',completed_at=now(),error=NULL WHERE id=$1`, [attempt.jobId]);
    await appendUspOutboxTx(client, `job:${attempt.jobId}`, { type: 'job.succeeded', jobId: attempt.jobId,
      fence: attempt.fence, result: asset, inputManifestId: meta.input_manifest_id });
    if(beforeCommit)await beforeCommit(client);
    return asset;
  },deadline);
}

export async function cancelUspJob(jobId: string, expectedVersion: number) {
  return transaction(async client => {
    await client.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
    const meta = (await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [jobId])).rows[0] ?? notFound();
    if (meta.version !== expectedVersion) conflict('The job changed.');
    if (meta.logical_state === 'succeeded') conflict('An accepted result cannot be cancelled.');
    await client.query(`UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'`, [jobId]);
    await client.query(`UPDATE usp_job_metadata SET logical_state='cancelled',version=version+1 WHERE job_id=$1`, [jobId]);
    await client.query(`UPDATE jobs SET status='failed',error='Cancelled by local operator',completed_at=now() WHERE id=$1`, [jobId]);
    await appendUspOutboxTx(client, `job:${jobId}`, { type: 'job.cancelled', jobId });
  });
}

export async function readUspJob(jobId: string) {
  const rows = await transaction(async client => {
    const job = (await client.query('SELECT * FROM jobs WHERE id=$1', [jobId])).rows[0] ?? notFound();
    const meta = (await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1', [jobId])).rows[0] ?? notFound();
    const attempt = (await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1', [jobId])).rows[0];
    return { job, meta, attempt };
  });
  const { job, meta, attempt } = rows;
  return UspJobProjectionSchema.parse({ jobId, version: meta.version, operation: job.operation,
    status: meta.logical_state, scope: meta.scope, inputManifestId: meta.input_manifest_id,
    inputSha256: meta.input_sha256, progress: null,
    attempt: { number: Number(attempt?.number ?? 0), fence: Number(attempt?.fence ?? 1),
      leaseUntil: attempt ? new Date(attempt.lease_until).toISOString() : null },
    result: meta.result_ref ?? null, errorCode: job.error ? 'job_failed' : null });
}

export const USP_JOB_LIMITS = { leaseSeconds: LEASE_SECONDS, maxAttempts: MAX_ATTEMPTS,
  heartbeatSeconds: 30, childExecutionSeconds: 60 } as const;
