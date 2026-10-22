import assert from 'node:assert/strict';
import test from 'node:test';
import { intakeItem } from './intake-ledger';
import { probeOriginal } from './intake-probe';

const id = '10000000-0000-4000-8000-000000000001';
const row = {
  item_id: id, source_id: id, case_id: id, parent_item_id: null, member_path: null, name: 'retained.geojson',
  family: 'vector', format: 'geojson', size_bytes: null, size_class: null, wave: 1, state: 'probed',
  placement: 'needs_answer', card: null, card_sha256: null, probe_version: null, parts_planned: null,
  parts_done: 0, records_seen: 0, limit_reason: null, pinned_by_officer: false,
  created_at: new Date('2026-10-11T00:00:00Z'), updated_at: new Date('2026-10-11T00:00:00Z'),
};

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
  const item = intakeItem({ ...row, taken_out_of: 'layers.zip', limit_reason: 'Kept as a CSV table (23 KB).' });
  assert.equal(item.limitReason, 'Taken out of layers.zip. Kept as a CSV table (23 KB).');
  assert.equal(intakeItem({ ...row, taken_out_of: null }).limitReason, null);
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
