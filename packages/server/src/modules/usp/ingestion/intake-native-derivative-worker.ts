import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { STREAMING_VECTOR_LIMITS } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { claimUspJobAttempt, heartbeatUspJobAttempt, assertUspJobAttemptTx, acceptUspJobAttempt,
  type UspJobAttempt } from '../jobs';
import { assertIntakeDraftTx } from './intake-draft';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';
import { IntakeNativeDerivativeInputSchema, convertNativeLayers, type IntakeNativeDerivativeInput,
  type NativeDerivativeDependencies } from './intake-native-derivative';
import { IntakeService } from './intake-service';
import { LargeOriginalService } from './large-original';

const intake = new IntakeService();
// The conversion and each copy of a derivative outlast one lease; the attempt is renewed this often meanwhile.
const RENEW_MS = 60_000;

/** The geo service converts the original from object storage; a refusal of the file itself is its 422 words. */
async function convert(request: Parameters<NativeDerivativeDependencies['convert']>[0]) {
  const response = await fetch(`${settings.geoUrl}/internal/area/convert-native`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.geoToken}` },
    body: JSON.stringify(request), signal: AbortSignal.timeout(STREAMING_VECTOR_LIMITS.readMs) });
  if (response.status === 422) throw new AppError(422, 'NATIVE_DERIVATIVE_FILE',
    'The native reader refused this file.');
  if (!response.ok) throw new AppError(503, 'NATIVE_DERIVATIVE_SERVICE', 'The conversion service did not answer.');
  return response.json();
}

const defaults: NativeDerivativeDependencies = { transaction, read: readObjectRange, convert,
  register: (caseId, raw) => intake.register(caseId, raw), large: new LargeOriginalService() };

const pinned = (input: IntakeNativeDerivativeInput) => (client: PoolClient) =>
  assertIntakeDraftTx(client, input).then(() => {});

/** Officer words carry the code only, never an error message: parser text may hold a source value. */
async function stoppedTx(client: PoolClient, input: IntakeNativeDerivativeInput, code: string) {
  const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
  await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'read',
    placement: code === 'NATIVE_DERIVATIVE_FILE' ? 'not_understood' : 'undecided',
    limitReason: `Converting the layers of this file to GeoJSON stopped (${code}); enrol the file again to retry.` });
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
    [input.jobId]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
    [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
}

async function fail(input: IntakeNativeDerivativeInput, attempt: UspJobAttempt, error: unknown) {
  const code = error instanceof AppError ? error.code : 'NATIVE_DERIVATIVE_FAILED';
  await transaction(async client => {
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    await stoppedTx(client, input, code);
  });
}

async function unclaimedFailure(input: IntakeNativeDerivativeInput, error: unknown) {
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

/** SH2. The dispatcher's fenced job: convert, retain and enrol each layer, then write the original's words. */
export async function runIntakeNativeDerivativeJob(jobId: string,
  dependencies: Partial<NativeDerivativeDependencies> = {}) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-native-derivative'", [jobId]))
    .rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeNativeDerivativeInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-native-derivative:${randomUUID()}`, pinned(input));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  const renewal = setInterval(() => { heartbeatUspJobAttempt(attempt).catch(() => {}); }, RENEW_MS);
  try {
    const kept = await convertNativeLayers(input.caseId, input.itemId, { ...defaults, ...dependencies });
    await acceptUspJobAttempt(attempt,
      { assetId: `intake-native-derivative:${input.itemId}`, version: 1, sha256: fingerprint(kept) },
      async (_client, stored) => {
        if (fingerprint(stored.payload) !== fingerprint(input)) conflict('The conversion job changed.');
      }, pinned(input));
  } catch (error) {
    await fail(input, attempt, error);
    throw error;
  } finally {
    clearInterval(renewal);
  }
}
