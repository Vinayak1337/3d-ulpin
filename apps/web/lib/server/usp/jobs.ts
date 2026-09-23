import type { PoolClient } from 'pg';
import { UspJobProjectionSchema, UspAssetRefSchema, UspScopeSchema,
  type AssetRef, type UspScope } from '@ulpin/contracts/usp';
import { transaction } from '../db';
import { AppError, conflict, notFound } from '../errors';
import { appendUspOutboxTx } from './commands';

const LEASE_SECONDS = 180;
const MAX_ATTEMPTS = 3;
type Attempt = { jobId: string; number: number; fence: number; owner: string; leaseUntil: string; inputSha256: string };

/** Attach immutable USP input pins to an existing logical job, never creating a second broker. */
export async function registerUspJobInputTx(client: PoolClient, jobId: string,
  scope: UspScope, inputManifestId: string, inputSha256: string) {
  UspScopeSchema.parse(scope);
  const job = (await client.query('SELECT id,operation FROM jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0] ?? notFound();
  if (!String(job.operation).startsWith('usp:')) {
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

export async function claimUspJobAttempt(jobId: string, owner: string): Promise<Attempt> {
  if (!owner || owner.length > 128) throw new AppError(400, 'USP_JOB_OWNER', 'A bounded worker identity is required.');
  return transaction(async client => {
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
  });
}

export async function heartbeatUspJobAttempt(attempt: Attempt) {
  return transaction(async client => {
    const row = (await client.query(`UPDATE usp_job_attempts SET lease_until=now()+interval '180 seconds'
      WHERE job_id=$1 AND number=$2 AND fence=$3 AND owner=$4 AND input_sha256=$5
      AND state='active' AND lease_until>now() RETURNING lease_until`,
      [attempt.jobId, attempt.number, attempt.fence, attempt.owner, attempt.inputSha256])).rows[0];
    if (!row) conflict('This worker lease expired or was fenced.');
    return { ...attempt, leaseUntil: new Date(row.lease_until).toISOString() };
  });
}

/** Completion is accepted only through a registered operation's result validator. */
export async function acceptUspJobAttempt(attempt: Attempt, result: AssetRef,
  validateResult: (client: PoolClient, job: Record<string, unknown>, result: AssetRef) => Promise<void>) {
  const asset = UspAssetRefSchema.parse(result);
  return transaction(async client => {
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
    return asset;
  });
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
