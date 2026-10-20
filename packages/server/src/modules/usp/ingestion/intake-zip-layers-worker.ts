import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { claimUspJobAttempt, heartbeatUspJobAttempt, assertUspJobAttemptTx, acceptUspJobAttempt,
  type UspJobAttempt } from '../jobs';
import { assertIntakeDraftTx } from './intake-draft';
import { IntakeService } from './intake-service';
import { IntakeZipLayersInputSchema, fanOutZipLayers, zipParentStageTx, type IntakeZipLayersInput,
  type ZipLayerDependencies } from './intake-zip-layers';
import { LargeOriginalService } from './large-original';
import { ManualIngestionService } from './service';

const manual = new ManualIngestionService();
const intake = new IntakeService();
// The dependencies the enrol request passed before ZJ1; each layer is enrolled like any dropped file.
const defaults: ZipLayerDependencies = { transaction, read: readObjectRange,
  retain: manual.retain.bind(manual) as ZipLayerDependencies['retain'],
  register: (caseId, raw) => intake.register(caseId, raw), large: new LargeOriginalService() };
// ZL1: a large layer is read twice in 1 MiB ranges, longer than one lease; its reads renew it at most this often.
const READ_RENEW_MS = 60_000;

/** The archive's pins hold; the case revision may have moved forward, never back. */
const pinned = (input: IntakeZipLayersInput) => (client: PoolClient) =>
  assertIntakeDraftTx(client, input).then(() => {});

/** Officer words carry the code only, never an error message; the sentence replaces the in-progress one (ZW1). */
async function stoppedTx(client: PoolClient, input: IntakeZipLayersInput, code: string) {
  const sentence = `Taking the layers out of this ZIP stopped (${code}); enrol the ZIP again to retry.`;
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

/** ZJ1. The dispatcher's fenced job runs the fan-out the enrol request used to run inline. */
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
  const own = { ...defaults, ...dependencies };
  // A large ZIP outlasts one lease; each layer's retain and enrolment renews it first.
  const renew = () => heartbeatUspJobAttempt(attempt);
  let renewed = Date.now();
  try {
    const kept = await fanOutZipLayers(input.caseId, input.itemId, { ...own,
      read: async (...args) => {
        if (Date.now() - renewed >= READ_RENEW_MS) {
          await renew();
          renewed = Date.now();
        }
        return own.read(...args);
      },
      retain: async (...args) => { await renew(); return own.retain(...args); },
      register: async (...args) => { await renew(); return own.register(...args); } });
    await complete(input, attempt, kept);
  } catch (error) {
    await fail(input, attempt, error);
    throw error;
  }
}
