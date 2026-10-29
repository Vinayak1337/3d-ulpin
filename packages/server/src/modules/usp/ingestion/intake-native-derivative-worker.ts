import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { streamingReadMs } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { claimUspJobAttempt, heartbeatUspJobAttempt, assertUspJobAttemptTx, acceptUspJobAttempt,
  type UspJobAttempt } from '../jobs';
import { assertIntakeDraftTx, type IntakeSourcePins } from './intake-draft';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';
import { IntakeNativeDerivativeInputSchema, convertNativeLayers, type IntakeNativeDerivativeInput,
  type NativeDerivativeDependencies } from './intake-native-derivative';
import { IntakeService } from './intake-service';
import { LargeOriginalService } from './large-original';

const intake = new IntakeService();
// Conversion, derivative copies and bounded slot waits share this attempt; renew its lease throughout.
const RENEW_MS = 60_000;

/** The geo service converts the original from object storage; a refusal of the file itself is its 422 words. */
export async function convert(request: Parameters<NativeDerivativeDependencies['convert']>[0], requestFetch = fetch) {
  const bytes = request.format === 'shapefile_set'
    ? request.members!.reduce((sum, part) => sum + part.bytes, 0) : request.bytes;
  const response = await requestFetch(`${settings.geoUrl}/internal/area/convert-native`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.geoToken}` },
    body: JSON.stringify(request), signal: AbortSignal.timeout(streamingReadMs(bytes)) });
  if (response.status === 422) throw new AppError(422, 'NATIVE_DERIVATIVE_FILE',
    'The native reader refused this file.');
  if (!response.ok) throw new AppError(503, 'NATIVE_DERIVATIVE_SERVICE', 'The conversion service did not answer.');
  return response.json();
}

/** What every derivative job keeps and enrols its children with: the byte receipt and the batch's enrolment. */
export const derivativeKeeping: Pick<NativeDerivativeDependencies, 'transaction' | 'register' | 'large'> = {
  transaction, register: (caseId, raw) => intake.register(caseId, raw), large: new LargeOriginalService() };
const defaults: NativeDerivativeDependencies = { ...derivativeKeeping, read: readObjectRange, convert };

type DerivativeInput = IntakeSourcePins & { jobId: string };
/**
 * A fenced job that writes derivatives of an item's original: its operation, payload, work, stop words (given the
 * item's words as they stand) and the code a fault that is not a refusal is labelled with.
 */
export type DerivativeJob<Input extends DerivativeInput> = {
  operation: string; parse: (payload: unknown) => Input; run: (input: Input) => Promise<string[]>;
  stopped: (code: string, current: string | null) => string; failedCode: string; refusedCode?: string;
};

const pinned = (input: DerivativeInput) => (client: PoolClient) =>
  assertIntakeDraftTx(client, input).then(() => {});

/** Officer words carry the code only, never an error message: parser text may hold a source value. */
async function stoppedTx<Input extends DerivativeInput>(client: PoolClient, input: Input, code: string,
  job: DerivativeJob<Input>) {
  const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
  await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'read',
    placement: code === job.refusedCode ? 'not_understood' : 'undecided',
    limitReason: job.stopped(code, current.limitReason) });
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
    [input.jobId]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
    [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
}

/** The code a stopped job is labelled with: a refusal's own code, else the job's failure code. */
export function stopCode<Input extends DerivativeInput>(error: unknown, job: DerivativeJob<Input>): string {
  return error instanceof AppError ? error.code : job.failedCode;
}

async function fail<Input extends DerivativeInput>(input: Input, attempt: UspJobAttempt, error: unknown,
  job: DerivativeJob<Input>) {
  const code = stopCode(error, job);
  await transaction(async client => {
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    await stoppedTx(client, input, code, job);
  });
}

async function unclaimedFailure<Input extends DerivativeInput>(input: Input, error: unknown,
  job: DerivativeJob<Input>) {
  if (!(error instanceof AppError)) throw error;
  await transaction(async client => {
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    const row = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !row || !['queued', 'running'].includes(row.status)) return;
    await stoppedTx(client, input, error.code, job);
  });
}

/** The dispatcher's fenced derivative job: claim, run with the lease renewed, accept, or stop in words. */
export async function runDerivativeJob<Input extends DerivativeInput>(jobId: string, job: DerivativeJob<Input>) {
  const row = (await query('SELECT * FROM jobs WHERE id=$1 AND operation=$2', [jobId, job.operation])).rows[0];
  if (!row || !['queued', 'running'].includes(row.status)) return;
  const input = job.parse(row.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `${job.operation}:${randomUUID()}`, pinned(input));
  } catch (error) {
    await unclaimedFailure(input, error, job);
    return;
  }
  const renewal = setInterval(() => { heartbeatUspJobAttempt(attempt).catch(() => {}); }, RENEW_MS);
  try {
    const kept = await job.run(input);
    await acceptUspJobAttempt(attempt,
      { assetId: `${job.operation}:${input.itemId}`, version: 1, sha256: fingerprint(kept) },
      async (_client, stored) => {
        if (fingerprint(stored.payload) !== fingerprint(input)) conflict('The conversion job changed.');
      }, pinned(input));
  } catch (error) {
    await fail(input, attempt, error, job);
    throw error;
  } finally {
    clearInterval(renewal);
  }
}

/** SH2. Convert, retain and enrol each layer, then write the original's words. */
export const nativeDerivativeJob = (dependencies: Partial<NativeDerivativeDependencies> = {}):
  DerivativeJob<IntakeNativeDerivativeInput> => ({ operation: 'intake-native-derivative',
  parse: payload => IntakeNativeDerivativeInputSchema.parse(payload),
  run: input => convertNativeLayers(input.caseId, input.itemId, { ...defaults, ...dependencies }, input.members),
  stopped: code => `Converting the layers of this file to GeoJSON stopped (${code}); enrol the file again to retry.`,
  failedCode: 'NATIVE_DERIVATIVE_FAILED', refusedCode: 'NATIVE_DERIVATIVE_FILE' });

export async function runIntakeNativeDerivativeJob(jobId: string,
  dependencies: Partial<NativeDerivativeDependencies> = {}) {
  await runDerivativeJob(jobId, nativeDerivativeJob(dependencies));
}
