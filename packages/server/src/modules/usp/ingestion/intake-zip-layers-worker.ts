import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { claimUspJobAttempt, assertUspJobAttemptTx, acceptUspJobAttempt,
  type UspJobAttempt } from '../jobs';
import { assertIntakeDraftTx } from './intake-draft';
import { IntakeService } from './intake-service';
import { IntakeZipLayersInputSchema, fanOutZipLayers, retainZipMemberOriginal, zipParentStageTx,
  type IntakeZipLayersInput,
  type ZipLayerDependencies } from './intake-zip-layers';
import { LargeOriginalService } from './large-original';
import { ManualIngestionService } from './service';

const manual = new ManualIngestionService();
const intake = new IntakeService();
const large = new LargeOriginalService();
// Each member uses an existing receipt and the same enrolment as a dropped file.
const defaults: ZipLayerDependencies = { transaction, read: readObjectRange,
  retain: manual.retain.bind(manual),
  retainMember: (caseId, revision, file, lineage) =>
    retainZipMemberOriginal(caseId, revision, file, lineage, { large }),
  register: (caseId, raw) => intake.register(caseId, raw), large };
// A large layer can outlast a lease; recheck the archive's pins during its bounded admission reads.
const READ_RENEW_MS = 60_000;

/** The archive's pins hold; the case revision may have moved forward, never back. */
const pinned = (input: IntakeZipLayersInput) => (client: PoolClient) =>
  assertIntakeDraftTx(client, input).then(() => {});

/** Officer words carry the code only, never an error message; the sentence replaces the in-progress one (ZW1). */
async function stoppedTx(client: PoolClient, input: IntakeZipLayersInput, code: string) {
  const sentence = `Taking the members out of this ZIP stopped (${code}); enrol the ZIP again to retry.`;
  await zipParentStageTx(client, input.caseId, input.itemId, { stopped: sentence });
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
    [input.jobId]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
    [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
}

async function fail(input: IntakeZipLayersInput, attempt: UspJobAttempt, error: unknown) {
  const code = error instanceof AppError ? error.code : 'INTAKE_ZIP_LAYERS_FAILED';
  await transaction(async client => {
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    await stoppedTx(client, input, code);
  });
}

async function unclaimedFailure(input: IntakeZipLayersInput, error: unknown) {
  if (!(error instanceof AppError)) throw error;
  await transaction(async client => {
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !job || !['queued', 'running'].includes(job.status)) return;
    await stoppedTx(client, input, error.code);
  });
}

async function complete(input: IntakeZipLayersInput, attempt: UspJobAttempt, kept: string[]) {
  await acceptUspJobAttempt(attempt,
    { assetId: `intake-zip-layers:${input.itemId}`, version: 1, sha256: fingerprint(kept) },
    async (client, job) => {
      if (fingerprint(job.payload) !== fingerprint(input)) conflict('The ZIP layer job changed.');
      await zipParentStageTx(client, input.caseId, input.itemId, 'taken');
    }, pinned(input));
}

/** Admission checks the same source, access, job and active-attempt guards as intake-large's reader wait. */
async function admissionReadyTx(client: PoolClient, input: IntakeZipLayersInput) {
  await pinned(input)(client);
  const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
  const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
    AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
  return !active && ['queued', 'running'].includes(job?.status);
}

/** The existing dispatcher owns the next due time; no lease or attempt is held while receipts are busy. */
async function waitForReceipt(input: IntakeZipLayersInput, retryAt: number): Promise<false> {
  await transaction(async client => {
    if (!await admissionReadyTx(client, input)) return;
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    await zipParentStageTx(client, input.caseId, input.itemId, 'taking');
    await client.query(`UPDATE jobs SET status='queued',dispatched_at=COALESCE(dispatched_at,now()),
      next_attempt_at=$2,error='UPLOAD_QUOTA' WHERE id=$1`, [input.jobId, new Date(retryAt).toISOString()]);
  });
  return false;
}

/** Like intake-large reader admission, receipt admission precedes claims so a full allowance spends no attempt. */
async function prepareMembers(input: IntakeZipLayersInput, dependencies: Partial<ZipLayerDependencies>) {
  if (!await transaction(client => admissionReadyTx(client, input))) return false;
  const own = { ...defaults, ...dependencies };
  const assertReady = async (client: PoolClient) => {
    if (!await admissionReadyTx(client, input)) conflict('The ZIP layer job is no longer admitting members.');
  };
  const renew = () => transaction(assertReady);
  let renewed = Date.now();
  const kept = await fanOutZipLayers(input.caseId, input.itemId, { ...own,
    transaction: (work, ...args) => own.transaction(async client => {
      await assertReady(client);
      return work(client);
    }, ...args),
    read: async (...args) => {
      if (Date.now() - renewed >= READ_RENEW_MS) {
        await renew();
        renewed = Date.now();
      }
      return own.read(...args);
    },
    retain: async (...args) => { await renew(); return own.retain(...args); },
    retainMember: async (...args) => { await renew(); return own.retainMember(...args); },
    register: async (...args) => { await renew(); return own.register(...args); } });
  if (Array.isArray(kept)) return kept;
  return waitForReceipt(input, kept.retryAt);
}

/** ZJ1. The dispatcher owns retry timing; the fenced completion accepts the idempotently retained members. */
export async function runIntakeZipLayersJob(jobId: string, dependencies: Partial<ZipLayerDependencies> = {}) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-zip-layers'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeZipLayersInputSchema.parse(job.payload);
  let kept: string[] = [], admissionError: unknown;
  try {
    const prepared = await prepareMembers(input, dependencies);
    if (prepared === false) return;
    kept = prepared;
  } catch (error) { admissionError = error; }
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-zip-layers:${randomUUID()}`, pinned(input));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  try {
    if (admissionError) throw admissionError;
    await complete(input, attempt, kept);
  } catch (error) {
    await fail(input, attempt, error);
    throw error;
  }
}
