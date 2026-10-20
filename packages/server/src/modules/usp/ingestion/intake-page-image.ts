import type { PoolClient } from 'pg';
import { z } from 'zod';
import { IntakePageImageReadSchema, type IntakeCard, type IntakePageImageLabel,
  type IntakePageImageRead } from '@ulpin/contracts/usp';
import { conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { intakeCaseTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';
import { stableUuid } from './intake-run';
import { pageImageFormat, pageImageWords } from './page-image-read';

const uuid = z.string().uuid();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakePageImageInputSchema = z.strictObject({
  version: z.literal('intake-page-image/1'), jobId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), itemId: uuid, sourceId: uuid,
  sourceRevision: z.number().int().positive(), sourceSha256: hex64, sourcePin: hex64,
  subject: z.string().min(1).max(256), accessSha256: hex64,
});
export type IntakePageImageInput = z.infer<typeof IntakePageImageInputSchema>;

/** The read kept on the item beside its other facts; anything else stored there is not a page image read. */
export function storedPageImage(planRef: unknown): IntakePageImageRead | null {
  const value = (planRef as { pageImage?: unknown } | null)?.pageImage;
  const parsed = IntakePageImageReadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const READING = 'This page image is being read: its size, bands, orientation and a preview.';

/**
 * G23. Publishing a page image's card queues its pass 1 read as one fenced job in the publishing transaction.
 * None is queued while one waits or runs, or once its read is kept on the item; until then it says it is being read.
 */
export async function queuePageImageTx(client: PoolClient, source: IntakeSourceRow, card: IntakeCard,
  item: { item_id: string; plan_ref: Record<string, unknown> | null }): Promise<string | null> {
  if (!pageImageFormat(card)) return null;
  const stored = storedPageImage(item.plan_ref);
  // A re-probe clears an answered item's words; its kept read says them again.
  if (stored) return settlePageImageTx(client, source.case_id, item.item_id, stored).then(() => null);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-page-image:${item.item_id}`]);
  const jobs = (await client.query(`SELECT status FROM jobs WHERE source_id=$1 AND operation='intake-page-image'`,
    [source.id])).rows;
  const reading = { state: 'reading', placement: 'undecided', planRef: item.plan_ref, recordsSeen: 0,
    limitReason: READING } as const;
  if (jobs.some(job => ['queued', 'running'].includes(job.status))) {
    await writeIntakeDraftTx(client, source.case_id, item.item_id, reading);
    return null;
  }
  const scope = await intakeCaseTx(client, source.case_id);
  const input = IntakePageImageInputSchema.parse({ version: 'intake-page-image/1',
    jobId: stableUuid(`intake-page-image/1:${item.item_id}:${source.revision}:${jobs.length + 1}`),
    caseId: source.case_id, caseRevision: scope.current.revision, itemId: item.item_id, sourceId: source.id,
    sourceRevision: source.revision, sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding),
    subject: scope.binding.subject, accessSha256: scope.binding.access });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-page-image',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  await writeIntakeDraftTx(client, source.case_id, item.item_id, reading);
  return input.jobId;
}

/** D3. The read item rests read and asks what it shows; its read and preview pointer stay beside its other facts. */
export async function settlePageImageTx(client: PoolClient, caseId: string, itemId: string,
  read: IntakePageImageRead) {
  const current = await readIntakeDraftTx(client, caseId, itemId);
  const kept = IntakePageImageReadSchema.parse({ ...read, label: storedPageImage(current.planRef)?.label ?? null });
  await writeIntakeDraftTx(client, caseId, itemId, { state: 'read', placement: kept.label ? 'undecided'
    : 'needs_answer', planRef: { ...current.planRef, pageImage: kept }, recordsSeen: 0,
  limitReason: pageImageWords(kept) });
}

/** The officer's answer is a candidate label only: it is kept and said back, never reviewed or used as truth. */
export async function labelPageImageTx(client: PoolClient, caseId: string, itemId: string,
  label: IntakePageImageLabel, answeredAt: string) {
  const current = await readIntakeDraftTx(client, caseId, itemId);
  const read = storedPageImage(current.planRef);
  if (!read || current.state !== 'read') conflict('This item is not a read page image waiting for an answer.');
  const kept = IntakePageImageReadSchema.parse({ ...read, label: { value: label, state: 'candidate', answeredAt } });
  await writeIntakeDraftTx(client, caseId, itemId, { state: 'read', placement: 'undecided',
    planRef: { ...current.planRef, pageImage: kept }, recordsSeen: 0, limitReason: pageImageWords(kept) });
  return kept;
}
