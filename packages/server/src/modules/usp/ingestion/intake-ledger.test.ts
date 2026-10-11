import assert from 'node:assert/strict';
import test from 'node:test';
import { intakeItem } from './intake-ledger';

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

test('an absent or unrecognized stored plan never makes the item read throw', () => {
  for (const plan_ref of [null, undefined, {}, { unrelated: id },
    { recipeId: id, recipeRevision: 0, recipeState: 'executed', origin: 'officer' },
    { recipeId: id, recipeRevision: 1, recipeState: 'proposed', origin: 'other' }]) {
    assert.equal(intakeItem({ ...row, plan_ref }).plan, null);
  }
});
