import type { PoolClient } from 'pg';
import { z } from 'zod';
import { IntakePlanModelSchema, IntakePlanResultSchema,
  type IntakePlanModel, type IntakePlanReading, type IntakePlanResult } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { areaGeo } from '../../areas/areas';
import { fingerprint } from '../../cases/domain';
import { intakeCaseTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { IntakePageImageInputSchema } from './intake-page-image';
import { readIntakeDraftTx, storedPlanReadings, writeIntakeDraftTx } from './intake-ledger';
import { stableUuid } from './intake-run';

export const PLAN_MODEL_ABSENT = "The plan reader's model is not installed in this build.";
const ocrRef = z.strictObject({ jobId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const IntakePlanInputSchema = IntakePageImageInputSchema.extend({ version: z.literal('intake-plan/1'),
  page: z.number().int().min(1).max(8), modelSha256: z.string().regex(/^[a-f0-9]{64}$/),
  ocr: ocrRef.nullable() });
export type IntakePlanInput = z.infer<typeof IntakePlanInputSchema>;
export type PlanItem = { item_id: string; parent_item_id: string | null;
  card: { format?: string; family?: string } | null; plan_ref: Record<string, unknown> | null };

export async function planModel(): Promise<IntakePlanModel> {
  try {
    const model = IntakePlanModelSchema.parse(await areaGeo('plan-readiness', {}, 4096));
    if (model.available && model.modelSha256) return model;
  } catch { /* An old or unavailable processor must not offer an action it cannot run. */ }
  return { available: false, reason: PLAN_MODEL_ABSENT, modelSha256: null };
}

export function planImage(item: PlanItem) {
  return !item.parent_item_id && item.card?.family === 'image' && ['jpeg', 'png'].includes(item.card.format ?? '');
}

function assertPlanPage(item: PlanItem, page: number, ocr: IntakePlanInput['ocr']) {
  if (item.parent_item_id || (!planImage(item) && item.card?.format !== 'pdf')) {
    throw new AppError(422, 'PLAN_SOURCE_REQUIRED',
      'Choose a JPEG or PNG plan image, or a selected PDF page already read by OCR.');
  }
  if (planImage(item) && page !== 1) throw new AppError(422, 'PLAN_PAGE_REQUIRED', 'An image has only page 1.');
  if (item.card?.format === 'pdf' && !ocr) throw new AppError(422, 'PLAN_OCR_REQUIRED',
    'Read the words on this PDF page (OCR) before asking for candidate rooms.');
}

async function latestPlanJobTx(client: PoolClient, source: IntakeSourceRow, itemId: string, page: number) {
  return (await client.query<{ id: string; status: string; attempts: number }>(
    `SELECT id,status,count(*) OVER ()::int AS attempts FROM jobs
      WHERE source_id=$1 AND operation='intake-plan' AND payload @> $2::jsonb
      ORDER BY created_at DESC,id DESC LIMIT 1`,
    [source.id, { itemId, sourceRevision: source.revision, page }])).rows[0];
}

/** One job at a time per original revision and page; stopped jobs need a new officer press. */
export async function queueIntakePlanTx(client: PoolClient, source: IntakeSourceRow, item: PlanItem,
  page: number, model: IntakePlanModel, ocr: IntakePlanInput['ocr']) {
  assertPlanPage(item, page, ocr);
  if (!model.available || !model.modelSha256) throw new AppError(422, 'PLAN_MODEL_UNAVAILABLE', PLAN_MODEL_ABSENT);
  if (Number(source.bytes) > 16 * 1024 ** 2) throw new AppError(413, 'PLAN_SOURCE_LIMIT',
    'The plan reader takes an original of at most 16 MiB; the original stays kept.');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-plan:${item.item_id}`]);
  const latest = await latestPlanJobTx(client, source, item.item_id, page);
  if (latest && !['failed', 'stale'].includes(latest.status)) {
    return { jobId: latest.id, itemId: item.item_id, page };
  }
  const jobId = stableUuid(`intake-plan/1:${item.item_id}:${source.revision}:${page}:${latest?.attempts ?? 0}`);
  const receipt = { jobId, itemId: item.item_id, page };
  const scope = await intakeCaseTx(client, source.case_id);
  const input = IntakePlanInputSchema.parse({ version: 'intake-plan/1', ...receipt, caseId: source.case_id,
    caseRevision: scope.current.revision, sourceId: source.id, sourceRevision: source.revision,
    sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding),
    subject: scope.binding.subject, accessSha256: scope.binding.access, modelSha256: model.modelSha256, ocr });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-plan',$4,$5,$6)`,
  [jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  await keepPlanReadingTx(client, input.caseId, item.item_id,
    { jobId, page, status: 'queued', error: null, result: null });
  return receipt;
}

async function keepPlanReadingTx(client: PoolClient, caseId: string, itemId: string, reading: IntakePlanReading) {
  const current = await readIntakeDraftTx(client, caseId, itemId);
  const readings = storedPlanReadings(current.planRef).filter(entry => entry.page !== reading.page);
  readings.push(reading);
  readings.sort((left, right) => left.page - right.page);
  await writeIntakeDraftTx(client, caseId, itemId, { ...current,
    planRef: { ...current.planRef, planReadings: readings } });
}

/** The full panel result stays on the item; no level, unit, placement or registry state is changed. */
export async function settleIntakePlanTx(client: PoolClient, caseId: string, itemId: string,
  jobId: string, result: IntakePlanResult) {
  const kept = IntakePlanResultSchema.parse(result);
  const current = await readIntakeDraftTx(client, caseId, itemId);
  const queued = storedPlanReadings(current.planRef).find(reading => reading.jobId === jobId);
  if (!queued || queued.status !== 'queued' || queued.page !== kept.sourceCitation.locator.page) {
    conflict('The plan result no longer names this item\'s queued page.');
  }
  await keepPlanReadingTx(client, caseId, itemId, { jobId, page: kept.sourceCitation.locator.page,
    status: 'completed', error: null, result: kept });
}

export async function stopIntakePlanTx(client: PoolClient, input: IntakePlanInput, error: string) {
  await keepPlanReadingTx(client, input.caseId, input.itemId,
    { jobId: input.jobId, page: input.page, status: 'failed', error, result: null });
}
