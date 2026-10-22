import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { claimUspJobAttempt, acceptUspJobAttempt, assertUspJobAttemptTx, type UspJobAttempt } from '../jobs';
import { assertIntakeDraftTx } from './intake-draft';
import { IntakePlanInputSchema, settleIntakePlanTx, stopIntakePlanTx, type IntakePlanInput } from './intake-plan';
import { planOcrPagesTx, processIntakePlan } from './intake-plan-processor';

async function assertPlanTx(client: PoolClient, input: IntakePlanInput) {
  const context = await assertIntakeDraftTx(client, input);
  if (input.ocr) {
    const current = (await planOcrPagesTx(client, context.source)).get(input.page);
    if (fingerprint(current ?? null) !== fingerprint(input.ocr)) conflict('The selected OCR page changed.');
  }
  return context;
}

async function stoppedTx(client: PoolClient, input: IntakePlanInput, code: string) {
  await stopIntakePlanTx(client, input, code);
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
    [input.jobId]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
    [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
}

async function failPlan(input: IntakePlanInput, error: unknown, attempt?: UspJobAttempt) {
  const code = error instanceof AppError ? error.code : 'PLAN_READ_FAILED';
  await transaction(async client => {
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    if (attempt) await assertUspJobAttemptTx(client, attempt);
    else {
      const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
      const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
        AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
      if (active || !job || !['queued', 'running'].includes(job.status)) return;
    }
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'", [input.jobId]);
    await stoppedTx(client, input, code);
  });
}

/** The existing dispatcher and fenced attempt authority own this candidate-only step. */
export async function runIntakePlanJob(jobId: string, process = processIntakePlan) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-plan'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakePlanInputSchema.parse(job.payload);
  const pins = async (client: PoolClient) => { await assertPlanTx(client, input); };
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-plan:${randomUUID()}`, pins);
  } catch (error) {
    await failPlan(input, error);
    return;
  }
  try {
    const { source, item } = await transaction(client => assertPlanTx(client, input));
    const result = await process(input, source, item.card?.format ?? '');
    await acceptUspJobAttempt(attempt,
      { assetId: `intake-plan:${input.itemId}:${input.page}`, version: 1, sha256: fingerprint(result) },
      async (client, current) => {
        if (fingerprint(current.payload) !== fingerprint(input)) conflict('The plan job changed.');
        await settleIntakePlanTx(client, input.caseId, input.itemId, input.jobId, result);
      }, pins);
  } catch (error) {
    await failPlan(input, error, attempt);
  }
}
