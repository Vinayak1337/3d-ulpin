import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { claimUspJobAttempt, heartbeatUspJobAttempt, yieldUspJobAttempt,
  assertUspJobAttemptTx, acceptUspJobAttempt, recordUspJobFailure,
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
// A large layer can outlast a lease; its bounded reads renew the attempt at most this often.
const READ_RENEW_MS = 60_000;

/** The archive's pins hold; the case revision may have moved forward, never back. */
const pinned = (input: IntakeZipLayersInput) => (client: PoolClient) =>
  assertIntakeDraftTx(client, input).then(() => {});

/** Officer words carry the code only, never an error message; the sentence replaces the in-progress one (ZW1). */
async function stoppedTx(client: PoolClient, input: IntakeZipLayersInput, code: string) {
  const card = (await client.query(`SELECT card FROM usp_intake_items WHERE case_id=$1 AND item_id=$2
    AND parent_item_id IS NULL`, [input.caseId, input.itemId])).rows[0]?.card;
  const kind = card?.format === 'gzip' ? 'gzip' : 'ZIP';
  const sentence = `Taking the members out of this ${kind} stopped (${code}); enrol the ${kind} again to retry.`;
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

/** Every member is read, retained and enrolled under the claimed attempt, including quota retries. */
async function prepareMembers(input: IntakeZipLayersInput, attempt: UspJobAttempt,
  dependencies: Partial<ZipLayerDependencies>) {
  const own = { ...defaults, ...dependencies };
  const renew = () => heartbeatUspJobAttempt(attempt, pinned(input));
  let renewed = Date.now();
  const kept = await fanOutZipLayers(input.caseId, input.itemId, { ...own,
    transaction: (work, ...args) => own.transaction(async client => {
      await pinned(input)(client);
      await assertUspJobAttemptTx(client, attempt);
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
  return kept;
}

/** ZJ1. The dispatcher owns retry timing; the fenced completion accepts the idempotently retained members. */
export async function runIntakeZipLayersJob(jobId: string, dependencies: Partial<ZipLayerDependencies> = {}) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-zip-layers'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeZipLayersInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-zip-layers:${randomUUID()}`, pinned(input));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  try {
    const kept = await prepareMembers(input, attempt, dependencies);
    if (!Array.isArray(kept)) {
      await yieldUspJobAttempt(attempt, new Date(kept.retryAt).toISOString());
      return;
    }
    await complete(input, attempt, kept);
  } catch (error) {
    await recordUspJobFailure(attempt, 'INTAKE_ZIP_LAYERS_FAILED', error);
    await fail(input, attempt, error);
    throw error;
  }
}
