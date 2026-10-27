import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { ImportPackage } from '@ulpin/contracts';
import { intakeItem, publishIntakePartTx } from './intake-ledger';
import { probeOriginal } from './intake-probe';

const id = '10000000-0000-4000-8000-000000000001';
const row = {
  item_id: id, source_id: id, case_id: id, parent_item_id: null, member_path: null, name: 'retained.geojson',
  family: 'vector', format: 'geojson', size_bytes: null, size_class: null, wave: 1, state: 'probed',
  placement: 'needs_answer', card: null, card_sha256: null, probe_version: null, parts_planned: null,
  parts_done: 0, records_seen: 0, limit_reason: null, pinned_by_officer: false,
  created_at: new Date('2026-10-11T00:00:00Z'), updated_at: new Date('2026-10-11T00:00:00Z'),
};

test('publishing a package keeps preparing; other active rows still become reading', async context => {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'test_only-intake-publication';
  context.after(() => {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  });
  for (const before of ['preparing', 'planned', 'reading']) {
    let state = before, notified = false;
    const client = { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ ...row, state }] };
      if (sql.startsWith('SELECT * FROM usp_intake_parts')) return { rows: [] };
      if (sql.startsWith('SELECT count(*)')) return { rows: [{ n: 0 }] };
      if (sql.startsWith('UPDATE usp_intake_items')) {
        assert.match(sql, /state=CASE WHEN state='preparing' THEN state ELSE 'reading' END/);
        state = before === 'preparing' ? before : 'reading';
      }
      if (sql.startsWith('SELECT item_id AS')) return { rows: [{ itemId: id, state, family: 'vector',
        format: 'geojson', sizeClass: 'M', wave: 1, pinnedByOfficer: false }] };
      if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: 0 }] };
      if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: '1' }] };
      if (sql.startsWith('INSERT INTO usp_outbox(')) notified = true;
      assert.match(sql, /^(INSERT INTO usp_intake_parts|UPDATE usp_intake_items|INSERT INTO usp_outbox)/);
      return { rows: [] };
    } } as PoolClient;
    await publishIntakePartTx(client, id, 0, { id, sourceRevisionIds: [id] } as ImportPackage,
      { cutIndex: 0 }, { recordsSeen: 4500 });
    assert.equal(state, before === 'preparing' ? 'preparing' : 'reading');
    assert.equal(notified, true);
  }
});

test('the item publishes stored recipe facts before and after execution, not a lookup', () => {
  const proposed = { recipeId: id, recipeRevision: 1, recipeState: 'proposed', origin: 'teacher' };
  assert.deepEqual(intakeItem({ ...row, plan_ref: proposed }).plan, { ...proposed, packageId: null });
  const executed = { ...proposed, recipeRevision: 3, recipeState: 'executed', origin: 'officer', packageId: id };
  assert.deepEqual(intakeItem({ ...row, plan_ref: executed }).plan, executed);
  const approved = { ...proposed, recipeState: 'approved', origin: 'memory' };
  assert.deepEqual(intakeItem({ ...row, plan_ref: approved }).plan, { ...approved, packageId: null });
  assert.equal(intakeItem({ ...row, plan_ref: { ...approved, origin: null } }).plan?.origin, null);
});

test('the item names the streamed profile job its read joined, and null when it joined none', () => {
  const jobId = '10000000-0000-4000-8000-000000000002';
  assert.equal(intakeItem({ ...row, plan_ref: null, streamed_profile_job_id: jobId }).streamedProfileJobId, jobId);
  assert.equal(intakeItem({ ...row, plan_ref: null, streamed_profile_job_id: null }).streamedProfileJobId, null);
  assert.equal(intakeItem({ ...row, plan_ref: null }).streamedProfileJobId, null);
});

test('an item kept from a ZIP member says which archive it was taken out of, before its reader words', () => {
  const archiveId = '10000000-0000-4000-8000-000000000002';
  const item = intakeItem({ ...row, taken_out_of: 'layers.zip', archive_item_id: archiveId,
    limit_reason: 'Kept as a CSV table (23 KB).' });
  assert.equal(item.archiveItemId, archiveId);
  assert.equal(item.parentItemId, null);
  assert.equal(item.limitReason, 'Taken out of layers.zip. Kept as a CSV table (23 KB).');
  assert.equal(intakeItem({ ...row, taken_out_of: null }).limitReason, null);
  assert.equal(intakeItem(row).archiveItemId, null);
  assert.equal(intakeItem({ ...row, archive_item_id: null }).archiveItemId, null);
});

test('a ZIP member and a plain item publish the same layout question without changing their words', () => {
  const reason = 'No approved layout matches this file. An officer chooses the identifier field.';
  const waiting = { ...row, limit_reason: reason, records_seen: 2100, streamed_profile_job_id: id };
  const plain = intakeItem(waiting);
  const member = intakeItem({ ...waiting, taken_out_of: 'layers.zip' });
  assert.equal(plain.layoutQuestion, true);
  assert.equal(member.layoutQuestion, true);
  assert.equal(intakeItem({ ...waiting, state: 'read' }).layoutQuestion, true);
  assert.equal(member.limitReason, `Taken out of layers.zip. ${reason}`);
  assert.equal(plain.limitReason, reason);
  assert.equal(intakeItem({ ...row, plan_ref: { layoutQuestion: true } }).layoutQuestion, true);
  assert.equal(intakeItem({ ...row, limit_reason: reason }).layoutQuestion, false);
  assert.equal(intakeItem({ ...waiting, placement: 'not_understood' }).layoutQuestion, false);
});

test('an absent or unrecognized stored plan never makes the item read throw', () => {
  for (const plan_ref of [null, undefined, {}, { unrelated: id },
    { recipeId: id, recipeRevision: 0, recipeState: 'executed', origin: 'officer' },
    { recipeId: id, recipeRevision: 1, recipeState: 'proposed', origin: 'other' }]) {
    assert.equal(intakeItem({ ...row, plan_ref }).plan, null);
  }
});

test('the API item says how wrong-suffix bytes were read without replacing the stored reader reason', async () => {
  const bytes = Buffer.from('%PDF-1.7\n% test_only header\n%%EOF');
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'plan.json');
  const stored = { ...row, name: 'plan.json', format: 'pdf', family: 'document', card,
    limit_reason: 'Reading the text layer of each page.' };
  assert.equal(intakeItem(stored).limitReason,
    'Named .json, read as PDF. Reading the text layer of each page.');
  assert.equal(stored.limit_reason, 'Reading the text layer of each page.');
});

test('a resting item names the area that already holds its bytes; nothing else names one', () => {
  const rested = intakeItem({ ...row, state: 'read', placement: 'undecided', plan_ref: { existingAreaId: id } });
  assert.equal(rested.existingAreaId, id);
  assert.equal(rested.plan, null);
  for (const plan_ref of [null, { existingAreaId: 'not-an-id' }, { recipeId: id }]) {
    assert.equal('existingAreaId' in intakeItem({ ...row, plan_ref }), false);
  }
});

test('CN1: a wide file lists its cell batches; only a batch the officer may open is linked, with its state', () => {
  const child = (n: number) => `10000000-0000-4000-8000-00000000010${n}`;
  const refs = [1, 2].map(n => ({ cellKey: `utm-20-e${n}-n12-l231-b270`, caseId: child(n), itemId: child(n + 2),
    sourceId: child(n + 4) }));
  const plan = { recipeId: id, recipeRevision: 2, recipeState: 'executed', origin: 'officer', packageId: null };
  const stored = { ...row, state: 'read', placement: 'on_map', plan_ref: { ...plan, cellFiles: refs } };
  const open = new Map([[refs[0].itemId, { state: 'reading', placement: 'on_map' }]]);
  const item = intakeItem({ ...stored, cell_batches_open: open });
  assert.deepEqual(item.plan, plan);
  assert.deepEqual(item.cellBatches, [
    { cellKey: refs[0].cellKey, caseId: refs[0].caseId, itemId: refs[0].itemId, state: 'reading', placement: 'on_map' },
    { cellKey: refs[1].cellKey, caseId: null, itemId: null, state: null, placement: null },
  ]);
  // A read that checked no child authority names no child case or item.
  assert(intakeItem(stored).cellBatches?.every(batch => batch.caseId === null && batch.itemId === null));
  // The stored source id is never projected.
  assert.doesNotMatch(JSON.stringify(item), new RegExp(refs[0].sourceId));
});

test('CN1: a parent row written before cell references, or with unrecognized ones, still parses without them', () => {
  const plan = { recipeId: id, recipeRevision: 1, recipeState: 'executed', origin: 'officer', packageId: null };
  for (const plan_ref of [plan, null, { ...plan, cellFiles: [{ cellKey: 'not-a-cell' }] },
    { ...plan, cellFiles: 'x' }, { ...plan, cellFiles: [] }]) {
    const item = intakeItem({ ...row, state: 'read', placement: 'on_map', plan_ref,
      limit_reason: '3 features went to 1 cell files, each its own item in its own batch case.' });
    assert.equal(Object.hasOwn(item, 'cellBatches'), false);
  }
  assert.deepEqual(intakeItem({ ...row, plan_ref: { ...plan, cellFiles: 'x' } }).plan, plan);
});
