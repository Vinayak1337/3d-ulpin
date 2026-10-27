import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { INTAKE_PAGE_IMAGE_LIMITS as limits, IntakePageImageReadSchema,
  type IntakePageImageRead } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { openObjectStream, putOriginal, readObjectRange, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { acceptUspJobAttempt, assertUspJobAttemptTx, claimUspJobAttempt, type UspJobAttempt } from '../jobs';
import { assertIntakeDraftTx } from './intake-draft';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';
import { IntakePageImageInputSchema, settlePageImageTx, type IntakePageImageInput } from './intake-page-image';
import { asPageImageFormat, pageImagePreview, pageImagePreviewKey, readPageImageHeader,
  type PageImageHeader } from './page-image-read';

const READ_MS = 120_000;
type Original = { key: string; bytes: number; sha256: string };
export type PageImageDependencies = {
  whole: (original: Original, signal: AbortSignal) => Promise<Uint8Array>;
  head: (original: Original, signal: AbortSignal) => Promise<Uint8Array>;
  store: (key: string, bytes: Uint8Array, signal: AbortSignal) => Promise<void>;
};

/** The whole original within its byte bound, counted and checked against its retained hash. */
async function wholeOriginal(original: Original, signal: AbortSignal) {
  const { body } = await openObjectStream(original.key, original.bytes, READ_MS, undefined, signal);
  const chunks: Buffer[] = [];
  let count = 0;
  try {
    for await (const value of body) {
      count += value.length;
      if (count > original.bytes) break;
      chunks.push(Buffer.from(value));
    }
  } finally { body.destroy(); }
  const bytes = Buffer.concat(chunks);
  if (count !== original.bytes || sha256(bytes) !== original.sha256) {
    throw new AppError(422, 'PAGE_IMAGE_SOURCE_INTEGRITY', 'The original differs from its retained hash or length.');
  }
  return bytes;
}

const defaults: PageImageDependencies = {
  whole: wholeOriginal,
  head: (original, signal) => readObjectRange(original.key, 0, Math.min(original.bytes, limits.headBytes),
    original.bytes, Date.now() + READ_MS, signal),
  store: (key, bytes, signal) => putOriginal(key, bytes, 'image/png', signal),
};

const pinned = (input: IntakePageImageInput) => (client: PoolClient) =>
  assertIntakeDraftTx(client, input).then(() => {});

/** Officer words carry the code only, never a decoder message, which may hold a source value. */
async function stoppedTx(client: PoolClient, input: IntakePageImageInput, code: string) {
  const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
  await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'probed',
    placement: 'not_understood', limitReason: `Reading this page image stopped (${code}); enrol it again to retry. `
      + 'The original is kept with its SHA-256.' });
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
    [input.jobId]);
  await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
    [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
}

async function fail(input: IntakePageImageInput, attempt: UspJobAttempt, error: unknown) {
  const code = error instanceof AppError ? error.code : 'PAGE_IMAGE_READ_FAILED';
  await transaction(async client => {
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    await stoppedTx(client, input, code);
  });
}

async function unclaimedFailure(input: IntakePageImageInput, error: unknown) {
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

function previewLimit(header: Pick<PageImageHeader, 'width' | 'height'>, bytes: number): string {
  if (bytes > limits.originalBytes) return `the original is above ${limits.originalBytes / 1024 ** 2} MiB, `
    + 'so only its first bytes were read and no preview was made';
  if (header.width && header.height && header.width * header.height > limits.inputPixels)
    return `above ${limits.inputPixels.toLocaleString('en-US')} pixels, so no preview was made`;
  return 'it could not be decoded for a preview';
}

/**
 * D2. Pass 1: the header facts from the image's own bytes and one preview pointing to its original. Above the byte
 * bound only the first 1 MiB is read; a TIFF found to carry a georeference tag is not a page image (D4).
 */
export async function readPageImage(input: IntakePageImageInput, original: Original & { format: string },
  dependencies: PageImageDependencies, signal: AbortSignal): Promise<IntakePageImageRead | null> {
  const format = asPageImageFormat(original.format);
  if (!format) throw new AppError(422, 'PAGE_IMAGE_FORMAT', 'This item is not a page image.');
  const whole = original.bytes <= limits.originalBytes;
  const bytes = whole ? await dependencies.whole(original, signal) : await dependencies.head(original, signal);
  const { georeferenced, ...header } = readPageImageHeader(bytes, format);
  if (georeferenced) return null;
  let preview: IntakePageImageRead['preview'] = null;
  if (whole) {
    const made = await pageImagePreview(bytes).catch(() => null);
    if (made) {
      const key = pageImagePreviewKey(input.sourceId, made.bytes);
      await dependencies.store(key, made.bytes, signal);
      preview = { key, sha256: sha256(made.bytes), bytes: made.bytes.length, width: made.width, height: made.height,
        mediaType: 'image/png', orientationApplied: made.orientationApplied,
        original: { sourceId: input.sourceId, sourceRevision: input.sourceRevision, sha256: input.sourceSha256 } };
    }
  }
  return IntakePageImageReadSchema.parse({ version: 'page-image-read/1', ...header, preview,
    previewLimit: preview ? null : previewLimit(header, original.bytes), label: null });
}

/** A TIFF whose georeference the probe could not see rests as a kept raster for its own route (D4). */
async function georeferencedTx(client: PoolClient, input: IntakePageImageInput) {
  const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
  await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'probed',
    placement: 'not_understood', limitReason: 'This TIFF states a georeference, so it is a raster, not a page '
      + 'image. No reader in a batch takes it yet, so it is not on the map; the original is kept with its SHA-256.' });
}

async function complete(input: IntakePageImageInput, attempt: UspJobAttempt, read: IntakePageImageRead | null) {
  await acceptUspJobAttempt(attempt,
    { assetId: `intake-page-image:${input.itemId}`, version: 1, sha256: fingerprint(read) },
    async (client, job) => {
      if (fingerprint(job.payload) !== fingerprint(input)) conflict('The page image job changed.');
      if (read) await settlePageImageTx(client, input.caseId, input.itemId, read);
      else await georeferencedTx(client, input);
    }, pinned(input));
}

/** G23. The dispatcher's fenced job reads one page image; a rerun stores the same content-addressed preview. */
export async function runIntakePageImageJob(jobId: string, dependencies: Partial<PageImageDependencies> = {}) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-page-image'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakePageImageInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-page-image:${randomUUID()}`, pinned(input));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  try {
    const { item, source } = await transaction(client => assertIntakeDraftTx(client, input, false));
    const original = { key: source.object_key, bytes: Number(source.bytes), sha256: source.sha256,
      format: String(item.card?.format) };
    const read = await readPageImage(input, original, { ...defaults, ...dependencies }, AbortSignal.timeout(READ_MS));
    await complete(input, attempt, read);
  } catch (error) {
    await fail(input, attempt, error);
    throw error;
  }
}
