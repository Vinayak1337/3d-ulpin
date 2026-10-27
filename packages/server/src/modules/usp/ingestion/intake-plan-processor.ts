import type { PoolClient } from 'pg';
import { DocumentInputSchema, IntakePlanResultSchema, type IntakePlanResult } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { readRetainedOriginal, sha256 } from '../../../infrastructure/storage';
import { areaGeo } from '../../areas/areas';
import { readDocumentResult, assertDocumentAcceptedResultTx } from './documents';
import type { IntakeSourceRow } from './intake-context';
import type { IntakePlanInput } from './intake-plan';
import { readPageImageHeader } from './page-image-read';

/** Only accepted OCR of these exact original bytes can supply contained labels to the room reader. */
export async function planOcrPagesTx(client: PoolClient, source: IntakeSourceRow) {
  const rows = (await client.query(`SELECT j.payload,m.result_ref FROM jobs j
    JOIN usp_job_metadata m ON m.job_id=j.id
    WHERE j.case_id=$1 AND j.source_id=$2 AND j.operation='document-extraction'
      AND j.status='succeeded' AND m.logical_state='succeeded' AND j.payload ? 'ocrSelection'
    ORDER BY j.created_at DESC LIMIT 32`, [source.case_id, source.id])).rows;
  const pages = new Map<number, NonNullable<IntakePlanInput['ocr']>>();
  for (const row of rows) {
    const input = DocumentInputSchema.parse(row.payload);
    const page = input.ocrSelection?.page;
    if (!page || pages.has(page) || input.sourceSha256 !== source.sha256
      || input.sourceRevision !== source.revision || !row.result_ref?.sha256) continue;
    const result = await readDocumentResult(input, row.result_ref.sha256);
    await assertDocumentAcceptedResultTx(client, input, row.result_ref.sha256);
    if (result.ocr?.sourcePage === page && result.ocr.sourceSha256 === source.sha256
      && result.ocr.sourceRevision === source.revision && result.ocr.outputStatus !== 'failed'
      && result.ocr.sourcePageFrame?.rotation === 0 && result.ocr.requestedRegion === null) {
      pages.set(page, { jobId: input.jobId, sha256: row.result_ref.sha256 });
    }
  }
  return pages;
}

export async function planObservations(input: IntakePlanInput) {
  if (!input.ocr) return { observations: [], ocrFrame: null };
  // The accepted pins are rechecked transactionally by the worker before and after processor I/O.
  const document = await import('../../../infrastructure/db').then(({ query }) => query(
    "SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='document-extraction'",
    [input.ocr!.jobId, input.caseId, input.sourceId]));
  const original = DocumentInputSchema.parse(document.rows[0]?.payload);
  if (original.sourceSha256 !== input.sourceSha256 || original.sourceRevision !== input.sourceRevision
    || original.ocrSelection?.page !== input.page) throw new AppError(409, 'PLAN_OCR_STALE',
    'The selected page reading changed.');
  const result = await readDocumentResult(original, input.ocr.sha256);
  if (!result.ocr || result.ocr.outputStatus === 'failed' || !result.ocr.sourcePageFrame
    || result.ocr.requestedRegion !== null) throw new AppError(422, 'PLAN_OCR_REQUIRED',
    'Read the words on this PDF page (OCR) before asking for candidate rooms.');
  const observations = result.ocr.items.map((item, index) => {
    const boxes = item.sourcePageBoxes.map(entry => entry.box);
    return { literal: item.text, bboxPt: [Math.min(...boxes.map(box => box[0])),
      Math.min(...boxes.map(box => box[1])), Math.max(...boxes.map(box => box[2])),
      Math.max(...boxes.map(box => box[3]))], method: result.ocr!.method,
    tile: 0, item: index, state: 'candidate' as const };
  });
  return { observations, ocrFrame: result.ocr.sourcePageFrame };
}

function assertOverlay(overlay: NonNullable<IntakePlanResult['overlay']>) {
  const bytes = Buffer.from(overlay.base64, 'base64');
  const header = readPageImageHeader(bytes, 'png');
  if (bytes.length !== overlay.bytes || sha256(bytes) !== overlay.sha256
    || header.width !== overlay.width || header.height !== overlay.height) {
    throw new AppError(422, 'PLAN_OVERLAY_INTEGRITY', 'The plan overlay differs from its pinned PNG bytes.');
  }
}

export function admitPlanResult(input: IntakePlanInput, raw: unknown): IntakePlanResult {
  const result = IntakePlanResultSchema.parse(raw);
  if (result.overlay) assertOverlay(result.overlay);
  if (result.sourceCitation.sourceId !== input.sourceId || result.sourceCitation.sourceSha256 !== input.sourceSha256
    || result.sourceCitation.locator.page !== input.page || result.model.sha256 !== input.modelSha256) {
    throw new AppError(422, 'PLAN_RESULT_SCOPE', 'The plan reading differs from the queued source or page.');
  }
  return result;
}

function assertPageObservations(result: IntakePlanResult, observations: { literal: string; bboxPt: number[] }[]) {
  if (result.ocrObservations.length !== observations.length || result.ocrObservations.some((entry, at) => {
    const source = observations[at];
    return !source || entry.literal !== source.literal
      || entry.bboxPt.some((coordinate, index) => coordinate !== source.bboxPt[index]);
  })) {
    throw new AppError(422, 'PLAN_LABEL_SCOPE', 'The plan labels differ from the selected page\'s OCR.');
  }
}

export async function processIntakePlan(input: IntakePlanInput, source: IntakeSourceRow,
  format: string): Promise<IntakePlanResult> {
  const bytes = await readRetainedOriginal(source.object_key, Number(source.bytes), source.sha256, 16 * 1024 ** 2);
  const mimeType = format === 'pdf' ? 'application/pdf' : `image/${format}`;
  const ocr = await planObservations(input);
  const result = admitPlanResult(input, await areaGeo('plan-reading', { sourceId: source.id, jobId: input.jobId,
    sourceSha256: source.sha256, page: input.page, mimeType, base64: Buffer.from(bytes).toString('base64'),
    expectedModelSha256: input.modelSha256, ...ocr }, 2 * 1024 ** 2));
  assertPageObservations(result, ocr.observations);
  return result;
}
