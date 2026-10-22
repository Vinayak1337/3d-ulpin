import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { TableFromOriginalSchema, TableProfileJobSchema, streamingReadMs, type TableProfileJob }
  from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { openObjectStream } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { acceptUspJobAttempt, assertUspJobAttemptTx, claimUspJobAttempt, heartbeatUspJobAttempt,
  registerUspJobInputTx, type UspJobAttempt } from '../jobs';
import { stableUuid } from './intake-run';
import { attachTableTx } from './service';
import { inspectTabularStream } from './tabular-source';

const uuid = z.string().uuid();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
/** TP1. A CSV or workbook (XW1) above 16 MiB kept as a large original, pinned with the request that asked for its
 * table. TPB: `sourceBytes` is the original's byte count, from which the dispatcher reserves a workbook's scratch; a
 * job queued before it carries none and still runs, with the largest workbook's scratch reserved. */
export const TableProfileInputSchema = z.strictObject({
  version: z.literal('table-profile/1'), jobId: uuid, caseId: uuid, caseRevision: z.number().int().nonnegative(),
  sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hex64,
  sourceBytes: z.number().int().positive().optional(),
  objectKey: z.string().min(1).max(512), subject: z.string().min(1).max(256), request: TableFromOriginalSchema,
});
export type TableProfileInput = z.infer<typeof TableProfileInputSchema>;
// A read of a large table outlasts one 180-second lease; it is renewed this often while the stream is read.
const RENEW_MS = 30_000;
const STOP = /^([A-Z][A-Z0-9_]{0,79}): (.+)$/s;

/** Queues the one job for this source revision and request; another read of the same original waits for its own. */
export async function queueTableProfileTx(client: PoolClient, row: any, caseRevision: number,
  request: z.infer<typeof TableFromOriginalSchema>, subject: string) {
  const running = (await client.query(`SELECT id FROM jobs WHERE source_id=$1 AND operation='table-profile'
    AND status IN ('queued','running')`, [row.id])).rows[0];
  if (running) throw new AppError(409, 'STALE_REVISION',
    'This original is already being read as a table; follow that read.',
    { existingTable: { caseId: row.case_id, sourceId: row.id, jobId: running.id } });
  const input = TableProfileInputSchema.parse({ version: 'table-profile/1',
    jobId: stableUuid(`table-profile/1:${row.id}:${row.revision}:${request.requestKey}`), caseId: row.case_id,
    caseRevision, sourceId: row.id, sourceRevision: row.revision, sourceSha256: row.sha256,
    sourceBytes: Number(row.bytes), objectKey: row.object_key, subject, request });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'table-profile',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  return input.jobId;
}

/** The job as it stands, in the shared status words; a stopped job keeps the reader's code and words. */
export async function tableProfileJobTx(client: PoolClient, jobId: string): Promise<TableProfileJob> {
  const job = (await client.query(`SELECT * FROM jobs WHERE id=$1 AND operation='table-profile'`, [jobId])).rows[0]
    ?? notFound('Table read not found.');
  const meta = (await client.query('SELECT logical_state FROM usp_job_metadata WHERE job_id=$1', [jobId])).rows[0];
  const input = TableProfileInputSchema.parse(job.payload), stop = STOP.exec(job.error ?? '');
  return TableProfileJobSchema.parse({ version: 'table-profile/1', jobId, caseId: input.caseId,
    sourceId: input.sourceId, sourceRevision: input.sourceRevision,
    status: meta?.logical_state === 'cancelled' ? 'cancelled' : job.status,
    issueCode: stop?.[1] ?? null, message: stop?.[2] ?? null });
}

/** A changed workspace or original makes the read stale; any other stop fails it. */
async function stoppedTx(client: PoolClient, jobId: string, error: unknown) {
  const known = error instanceof AppError;
  const words = known ? `${error.code}: ${error.message}`
    : 'TABLE_PROFILE_FAILED: Reading this table stopped; import it as a table again.';
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1", [jobId]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
    [jobId, known && error.status === 409 ? 'stale' : 'failed', words.slice(0, 600)]);
}

const lockCase = (input: TableProfileInput) => async (client: PoolClient) => {
  await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
};

async function fail(input: TableProfileInput, attempt: UspJobAttempt, error: unknown) {
  await transaction(async client => {
    await lockCase(input)(client);
    await assertUspJobAttemptTx(client, attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    await stoppedTx(client, input.jobId, error);
  });
}

async function unclaimedFailure(input: TableProfileInput, error: unknown) {
  if (!(error instanceof AppError)) throw error;
  await transaction(async client => {
    await lockCase(input)(client);
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !job || !['queued', 'running'].includes(job.status)) return;
    await stoppedTx(client, input.jobId, error);
  });
}

/** The original is read once as a stream against its byte receipt, renewing the lease while it is read. */
async function readOriginal(input: TableProfileInput, attempt: UspJobAttempt) {
  const row = await transaction(async client => {
    const found = (await client.query('SELECT * FROM sources WHERE id=$1 AND case_id=$2 FOR SHARE',
      [input.sourceId, input.caseId])).rows[0];
    if (found?.sha256 !== input.sourceSha256 || found.revision !== input.sourceRevision
      || found.object_key !== input.objectKey) conflict('The original changed before it was read.');
    return found;
  });
  const bytes = Number(row.bytes);
  const object = await openObjectStream(row.object_key, bytes, streamingReadMs(bytes),
    row.inspection?.largeOriginal?.objectEtag);
  const renew = setInterval(() => {
    heartbeatUspJobAttempt(attempt).catch(error => object.body.destroy(error));
  }, RENEW_MS);
  try {
    const inventory = await inspectTabularStream(object.body, { sha256: row.sha256, bytes },
      input.request.selection, input.request, row.name);
    return { row, inventory };
  } finally {
    clearInterval(renew);
    object.body.destroy();
  }
}

/** TP1. The dispatcher's fenced job reads the CSV, or the workbook's one sheet (XW1), the table request used to read
 * inline, then attaches the same table receipt to the same source row in its accepting transaction. */
export async function runTableProfileJob(jobId: string) {
  const job = (await query(`SELECT * FROM jobs WHERE id=$1 AND operation='table-profile'`, [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = TableProfileInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `table-profile:${randomUUID()}`, lockCase(input));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  try {
    const { row, inventory } = await readOriginal(input, attempt);
    await acceptUspJobAttempt(attempt, { assetId: `table-profile:${input.sourceId}`, version: input.sourceRevision,
      sha256: inventory.schemaFingerprint }, async (client, accepted) => {
      if (fingerprint(accepted.payload) !== fingerprint(input)) conflict('The table read changed.');
      // Other sources may change while the stream is read; only this source's own pins can make the read stale.
      await attachTableTx(client, { caseId: input.caseId, sourceId: input.sourceId, actor: input.subject, read: row,
        expectedWorkspaceRevision: null }, inventory);
    }, lockCase(input));
  } catch (error) {
    await fail(input, attempt, error).catch(() => {/* A newer fence owns the job's durable state. */});
    throw error;
  }
}
