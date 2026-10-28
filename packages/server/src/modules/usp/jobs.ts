import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import {PacketPdfJobInputSchema} from '../../../../contracts/src/usp/packet-pdf-jobs';
import {RegistryCityJSONValidationInputSchema} from '@ulpin/contracts';
import {fingerprint} from '../cases/domain';
import {ingestionBinding,assertIngestionBinding} from './ingestion/events';
import { UspJobProjectionSchema, UspAssetRefSchema, UspScopeSchema,
  type AssetRef, type UspScope } from '@ulpin/contracts/usp';
import { transaction,type DbDeadline } from '../../infrastructure/db';
import {GeoParquetInputSchema} from '../../../../contracts/src/usp/geoparquet-ingestion';
import {CityGMLInputSchema} from '../../../../contracts/src/usp/citygml-ingestion';
import {ObjInputSchema} from '../../../../contracts/src/usp/obj-ingestion';
import {GltfInputSchema} from '../../../../contracts/src/usp/gltf-ingestion';
import {KMLInputSchema} from '../../../../contracts/src/usp/kml-ingestion';
import { AppError, conflict, notFound } from '../../infrastructure/errors';
import { safeWorkerCause } from '../../infrastructure/worker-failure';
import { appendUspOutboxTx } from './commands';
import { ProjectedVectorInputSchema, PrivateMvtInputSchema, DocumentInputSchema, AnyStreamingInputSchema,
  StreamedProfileInputSchema, ChunkMappingInputSchema, RasterWindowInputSchema, PointBatchInputSchema, CityJSONInputSchema, IFCInputSchema, DXFInputSchema } from '@ulpin/contracts/usp';

const LEASE_SECONDS = 180;
const MAX_ATTEMPTS = 3;
const YIELD_OPERATIONS = new Set(['streamed-profile', 'intake-zip-layers', 'chunk-mapping']);
export type UspJobAttempt = { jobId: string; number: number; fence: number; owner: string; leaseUntil: string; inputSha256: string };
type Attempt = UspJobAttempt;

/** Best-effort diagnostics on the exact attempt; never block the existing retry or terminal failure path. */
export async function recordUspJobFailure(attempt: Attempt, code: string, error: unknown) {
  try {
    // Zod messages, received values and enum options may quote source text; keep only bounded field paths/codes.
    const cause = safeWorkerCause(error);
    if (!cause) return;
    if (error instanceof Error && !(error instanceof ZodError)) {
      cause.class = error.name.slice(0, 80);
      cause.message = error.message.slice(0, 300);
    }
    await transaction(async client => {
      await assertUspJobAttemptTx(client, attempt);
      await client.query('UPDATE usp_job_attempts SET failure_cause=$3 WHERE job_id=$1 AND number=$2',
        [attempt.jobId, attempt.number, { errorCode: code, ...cause,
          ...(error instanceof ZodError ? { zodIssues: error.issues.slice(0, 20).map(issue => ({
            path: issue.path.slice(0, 32).map(part => typeof part === 'number' ? part : String(part).slice(0, 128)),
            code: issue.code,
          })) } : {}) }]);
    });
  } catch (failure) {
    const rawCode = (failure as { code?: unknown } | null)?.code;
    const errorCode = typeof rawCode === 'string' && /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : 'UNKNOWN_ERROR';
    console.warn(`Job ${attempt.jobId} attempt ${attempt.number} cause write failed (${errorCode}).`);
  }
}

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
  } else if(job.operation==='ifc-native'){
    const input=IFCInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||fingerprint(input)!==inputSha256)
      throw new AppError(422,'IFC_INPUT_SCOPE','IFC jobs must pin their unchanged source and exact intake context.');
  } else if(job.operation==='dxf-native'){
    const input=DXFInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||fingerprint(input)!==inputSha256)
      throw new AppError(422,'DXF_INPUT_SCOPE','DXF jobs must pin their unchanged source and exact intake context.');
  } else if(job.operation==='kml-native'){
    const input=KMLInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||fingerprint(input)!==inputSha256)
      throw new AppError(422,'KML_INPUT_SCOPE','KML jobs must pin their unchanged original, member selection and intake context.');
  } else if(job.operation==='citygml-native'){
    const input=CityGMLInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||fingerprint(input)!==inputSha256)
      throw new AppError(422,'CITYGML_INPUT_SCOPE','CityGML jobs must pin their unchanged original, private access and intake context.');
  } else if(job.operation==='obj-native'){
    const input=ObjInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||fingerprint(input)!==inputSha256)
      throw new AppError(422,'OBJ_INPUT_SCOPE','OBJ jobs must pin their unchanged original, private access and intake context.');
  } else if(job.operation==='gltf-native'){
    const input=GltfInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||fingerprint(input)!==inputSha256)
      throw new AppError(422,'GLTF_INPUT_SCOPE','glTF jobs must pin their unchanged original, scene selection, private access and intake context.');
  } else if(job.operation==='geoparquet-native'){
    const input=GeoParquetInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1||input.jobId!==job.id
      ||input.caseId!==job.case_id||input.sourceId!==job.source_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint||fingerprint(input)!==inputSha256)
      throw new AppError(422,'GEOPARQUET_INPUT_SCOPE','GeoParquet jobs must pin their unchanged original, private access and intake context.');
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
    const input=AnyStreamingInputSchema.parse(job.payload);
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
  } else if(job.operation==='intake-draft'){
    const {IntakeDraftInputSchema}=await import('./ingestion/intake-draft');
    const input=IntakeDraftInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint
      ||inputSha256!==fingerprint(input))
      throw new AppError(422,'INTAKE_DRAFT_INPUT_SCOPE','Draft jobs must pin their retained source and intake revision.');
  } else if(job.operation==='intake-zip-layers'){
    const {IntakeZipLayersInputSchema}=await import('./ingestion/intake-zip-layers');
    const input=IntakeZipLayersInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint
      ||inputSha256!==fingerprint(input))
      throw new AppError(422,'INTAKE_ZIP_LAYERS_INPUT_SCOPE',
        'ZIP layer jobs must pin their retained archive and intake revision.');
  } else if(job.operation==='intake-page-image'||job.operation==='intake-plan'){
    const input=job.operation==='intake-plan'
      ?(await import('./ingestion/intake-plan')).IntakePlanInputSchema.parse(job.payload)
      :(await import('./ingestion/intake-page-image')).IntakePageImageInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint
      ||inputSha256!==fingerprint(input))
      throw new AppError(422,'INTAKE_PAGE_IMAGE_INPUT_SCOPE',
        'Page image and plan jobs must pin their retained original and intake revision.');
  } else if(job.operation==='intake-native-derivative'||job.operation==='intake-table-geojson'){
    // TC1: a table's rows written as a GeoJSON derivative pin their table as a conversion pins its original.
    const input=job.operation==='intake-table-geojson'
      ?(await import('./ingestion/table-geojson')).IntakeTableGeojsonInputSchema.parse(job.payload)
      :(await import('./ingestion/intake-native-derivative')).IntakeNativeDerivativeInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint
      ||inputSha256!==fingerprint(input))
      throw new AppError(422,'INTAKE_NATIVE_DERIVATIVE_INPUT_SCOPE',
        'Conversion jobs must pin their retained original and intake revision.');
  } else if(job.operation==='intake-evidence'){
    const {IntakeEvidenceInputSchema}=await import('./ingestion/intake-evidence');
    const input=IntakeEvidenceInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint
      ||inputSha256!==fingerprint(input))
      throw new AppError(422,'INTAKE_EVIDENCE_INPUT_SCOPE',
        'Evidence readings must pin their key profile, retained source and intake revision.');
  } else if(job.operation==='intake-large'){
    const {IntakeLargeInputSchema}=await import('./ingestion/intake-large');
    const input=IntakeLargeInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint
      ||inputSha256!==fingerprint(input))
      throw new AppError(422,'INTAKE_LARGE_INPUT_SCOPE','Large-file steps must pin their retained source and intake revision.');
  } else if(job.operation==='table-profile'){
    const {TableProfileInputSchema}=await import('./ingestion/table-profile-worker');
    const input=TableProfileInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.sourceId!==job.source_id
      ||input.caseRevision!==job.case_revision||inputManifestId!==job.source_id||inputSha256!==job.input_fingerprint
      ||inputSha256!==fingerprint(input))
      throw new AppError(422,'TABLE_PROFILE_INPUT_SCOPE',
        'Table reads must pin their kept original and intake revision.');
  } else if(job.operation==='intake-run'){
    const {IntakeRunInputSchema,intakeRunSubject}=await import('./ingestion/intake-run');
    const input=IntakeRunInputSchema.parse(job.payload);
    if(scope.kind!=='intake'||scope.workspaceId!==job.case_id||scope.version!==job.case_revision+1
      ||input.jobId!==job.id||input.caseId!==job.case_id||input.caseRevision!==job.case_revision
      ||inputManifestId!==intakeRunSubject(input)||inputSha256!==job.input_fingerprint||inputSha256!==fingerprint(input))
      throw new AppError(422,'INTAKE_RUN_INPUT_SCOPE','Run jobs must pin their case revision and the one thing they act on.');
  } else if(job.operation==='packet-pdf'){
    const input=PacketPdfJobInputSchema.parse(job.payload);
    if(scope.kind!=='snapshot'||fingerprint(scope)!==fingerprint(input.scope)||input.jobId!==job.id||
      job.case_id!==input.anchor.caseId||job.source_id!==input.anchor.sourceId||job.case_revision!==input.anchor.caseRevision||
      inputManifestId!==input.scope.manifestId||inputSha256!==job.input_fingerprint||inputSha256!==fingerprint(input))
      throw new AppError(422,'PACKET_PDF_JOB_SCOPE','PDF jobs must enroll the exact confirmed snapshot and real selected-source anchor.');
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
    const spent = YIELD_OPERATIONS.has(job.operation)
      ? Number((await client.query(`SELECT count(*)::int n FROM usp_job_attempts
        WHERE job_id=$1 AND state<>'yielded'`, [jobId])).rows[0].n)
      : number - 1;
    if (spent >= MAX_ATTEMPTS)
      throw new AppError(422, 'USP_JOB_ATTEMPTS', 'Explicit retry is required after the attempt limit.');
    const fence = Number(attempts?.fence ?? 0) + 1;
    const row = (await client.query(`INSERT INTO usp_job_attempts(job_id,number,fence,owner,input_sha256,lease_until,state)
      VALUES($1,$2,$3,$4,$5,now()+interval '180 seconds','active') RETURNING lease_until`,
      [jobId, number, fence, owner, meta.input_sha256])).rows[0];
    await client.query(`UPDATE usp_job_metadata SET logical_state='running',version=version+1 WHERE job_id=$1`, [jobId]);
    await client.query(`UPDATE jobs SET status='running',attempts=$2,
      dispatched_at=COALESCE(dispatched_at,now()) WHERE id=$1`, [jobId, spent + 1]);
    return { jobId, number, fence, owner, leaseUntil: new Date(row.lease_until).toISOString(), inputSha256: meta.input_sha256 };
  },deadline);
}

/** Allowlisted operations may return ready-work admission without spending a failure attempt. */
export async function yieldUspJobAttempt(attempt: Attempt, nextAttemptAt?: string) {
  await transaction(async client => {
    await assertUspJobAttemptTx(client, attempt);
    const job = (await client.query('SELECT operation FROM jobs WHERE id=$1', [attempt.jobId])).rows[0];
    if (!YIELD_OPERATIONS.has(job?.operation))
      throw new AppError(422, 'USP_JOB_OPERATION', 'This operation may not yield a fenced attempt.');
    await client.query("UPDATE usp_job_attempts SET state='yielded' WHERE job_id=$1 AND number=$2",
      [attempt.jobId, attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",
      [attempt.jobId]);
    await client.query(`UPDATE jobs SET status='queued',
      next_attempt_at=COALESCE($2::timestamptz,now()+interval '2 seconds'),error=NULL
      WHERE id=$1`, [attempt.jobId, nextAttemptAt ?? null]);
  });
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
  validateResult: (client: PoolClient, job: Record<string, unknown>, result: AssetRef) => Promise<void|AssetRef>,
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
    // A registered validator may link an already accepted canonical packet
    // when concurrent synchronous execution won. Existing validators return void.
    const validated=await validateResult(client, job, asset),accepted=validated?UspAssetRefSchema.parse(validated):asset;
    await client.query(`UPDATE usp_job_attempts SET state='accepted',completion_sha256=$2 WHERE job_id=$1 AND number=$3`,
      [attempt.jobId, accepted.sha256, attempt.number]);
    await client.query(`UPDATE usp_job_metadata SET logical_state='succeeded',result_ref=$2,
      accepted_fence=$3,version=version+1 WHERE job_id=$1`, [attempt.jobId, accepted, attempt.fence]);
    await client.query(`UPDATE jobs SET status='succeeded',completed_at=now(),error=NULL WHERE id=$1`, [attempt.jobId]);
    await appendUspOutboxTx(client, `job:${attempt.jobId}`, { type: 'job.succeeded', jobId: attempt.jobId,
      fence: attempt.fence, result: accepted, inputManifestId: meta.input_manifest_id });
    if(beforeCommit)await beforeCommit(client);
    return accepted;
  },deadline);
}

export async function cancelUspJob(jobId: string, expectedVersion: number) {
  return transaction(async client => {
    const job=(await client.query('SELECT operation,payload FROM jobs WHERE id=$1',[jobId])).rows[0];
    if(job?.operation==='packet-pdf')throw new AppError(422,'PACKET_PDF_CONTROL_REQUIRED',
      'Use the exact authorized PDF job control operation.');
    // An older payload that no longer parses is still cancelled; only a current tabular payload settles its item.
    const parsed=job?.operation==='chunk-mapping'?ChunkMappingInputSchema.safeParse(job.payload):null;
    const input=parsed?.success?parsed.data:null;
    if(input?.tabular){
      // Match publication's case/source → job lock order before settling the item in this transaction.
      const {lockStreamingRowsTx}=await import('./ingestion/streaming-vector');
      await lockStreamingRowsTx(client,input.caseId,input.sourceId);
    }
    await client.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
    const meta = (await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [jobId])).rows[0] ?? notFound();
    if (meta.version !== expectedVersion) conflict('The job changed.');
    if (meta.logical_state === 'succeeded') conflict('An accepted result cannot be cancelled.');
    await client.query(`UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'`, [jobId]);
    await client.query(`UPDATE usp_job_metadata SET logical_state='cancelled',version=version+1 WHERE job_id=$1`, [jobId]);
    await client.query(`UPDATE jobs SET status='failed',error='Cancelled by local operator',completed_at=now() WHERE id=$1`, [jobId]);
    if(input?.tabular){
      const {settleTableMeaningsTx}=await import('./ingestion/chunk-mapping-tabular');
      await settleTableMeaningsTx(client,input,{failed:'JOB_CANCELLED'});
    }
    await appendUspOutboxTx(client, `job:${jobId}`, { type: 'job.cancelled', jobId });
  });
}

export async function readUspJob(jobId: string) {
  const rows = await transaction(async client => {
    const job = (await client.query('SELECT * FROM jobs WHERE id=$1', [jobId])).rows[0] ?? notFound();
    if(job.operation==='packet-pdf')throw new AppError(422,'PACKET_PDF_READER_REQUIRED','Use the exact authorized PDF job status operation.');
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
