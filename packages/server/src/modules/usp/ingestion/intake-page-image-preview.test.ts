import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { IntakePageImageReadSchema } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { IntakeService } from './intake-service';
import { pageImagePreview } from './page-image-read';

// Real inputs from the data drive (docs/api/datasets.json); each test is skipped where the drive is absent.
const plan = 'E:/BhuAayam-data/datasets/cubicasa5k/p2-test-20261011/high_quality_architectural/123/F1_scaled.png';
const jpeg = 'E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/mamba-root/pkgs/https/conda.anaconda.org/'
  + 'conda-forge/win-64/libjpeg-turbo-3.2.0-hfd05255_1/info/test/testorig.jpg';
const absent = [plan, jpeg].find(path => !existsSync(path));
const subject = 'g23s-protocol-operator';
const caseId = '23000000-0000-4000-8000-000000000001';
const itemId = '23000000-0000-4000-8000-000000000002';

/** In-memory protocol control, not a dataset record: one case, one source and one read page image item. */
function control(preview: { key: string; sha256: string; bytes: number; width: number; height: number } | null,
  stored: Map<string, Uint8Array>) {
  const read = IntakePageImageReadSchema.parse({ version: 'page-image-read/1', format: 'png', width: 2776,
    height: 1346, bands: 3, bitDepth: 8, orientation: null, captureTime: null, locationStated: false, dpi: null,
    preview: preview && { ...preview, mediaType: 'image/png', orientationApplied: null,
      original: { sourceId: itemId, sourceRevision: 1, sha256: 'a'.repeat(64) } },
    previewLimit: preview ? null : 'it could not be decoded for a preview', label: null });
  const row = { item_id: itemId, source_id: itemId, case_id: caseId, parent_item_id: null, member_path: null,
    name: 'plan.png', family: 'image', format: 'png', size_bytes: 1024, size_class: 'S', wave: 1, state: 'read',
    placement: 'needs_answer', card: null, card_sha256: null, probe_version: null, plan_ref: { pageImage: read },
    parts_planned: null, parts_done: 0, records_seen: '0', limit_reason: null, pinned_by_officer: false,
    created_at: new Date(), updated_at: new Date() };
  const source = { id: itemId, case_id: caseId, family_id: itemId, revision: 1, name: 'plan.png',
    profile: 'page-image-control', bytes: 1024, sha256: 'a'.repeat(64), object_key: 'sources/control',
    status: 'received', inspection: { actor: subject } };
  const reads: string[] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    if (sql.includes('FROM cases')) return { rows: values[0] === caseId ? [{ id: caseId, revision: 3,
      archived: false }] : [] };
    if (sql.startsWith('SELECT i.*')) return { rows: values[0] === caseId && values[1] === itemId ? [row] : [] };
    if (sql.includes('FROM sources')) return { rows: values[1] === itemId ? [source] : [] };
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  const service = new IntakeService({ transaction: async action => action(client),
    object: async key => { reads.push(key); return stored.get(key) ?? assert.fail('no stored object'); } });
  return { service, reads };
}

async function configured(action: () => Promise<void>) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  try { await action(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

const refused = (status: number, code: string) => (error: unknown) =>
  error instanceof AppError && error.status === status && error.code === code;

test('a real plan\'s preview is served from the key kept on the item, checked by its hash; a changed object is 409',
  { skip: absent ? `${absent} is not on this machine` : false }, async () => {
    await configured(async () => {
      const made = await pageImagePreview(readFileSync(plan));
      const key = `page-image-previews/${itemId}/${sha256(made.bytes)}.png`;
      const kept = { key, sha256: sha256(made.bytes), bytes: made.bytes.length, width: made.width,
        height: made.height };
      const stored = new Map<string, Uint8Array>([[key, made.bytes]]);
      const good = control(kept, stored);
      const served = await good.service.pageImagePreview(caseId, itemId);
      assert.equal(sha256(served.bytes), kept.sha256);
      assert.deepEqual(good.reads, [key]);
      // Difficult: the object under the kept key now holds another real image's preview.
      stored.set(key, (await pageImagePreview(readFileSync(jpeg))).bytes);
      await assert.rejects(good.service.pageImagePreview(caseId, itemId),
        refused(409, 'PAGE_IMAGE_PREVIEW_INTEGRITY'));
    });
  });

test('an item without a preview is 404, and another case is refused before any object is read', async () => {
  await configured(async () => {
    const none = control(null, new Map());
    await assert.rejects(none.service.pageImagePreview(caseId, itemId), refused(404, 'NOT_FOUND'));
    const other = control({ key: 'page-image-previews/x.png', sha256: 'b'.repeat(64), bytes: 1, width: 1, height: 1 },
      new Map());
    await assert.rejects(other.service.pageImagePreview('23000000-0000-4000-8000-000000000009', itemId),
      refused(404, 'NOT_FOUND'));
    assert.deepEqual([none.reads, other.reads], [[], []]);
  });
});
