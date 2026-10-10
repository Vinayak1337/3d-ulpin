import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { groupTeacherLabels, verifyLabelGroups, type LinkedColumn } from './verify-teacher-labels';
import { T1_ROOT } from './t1-sources';
import type { PreparedColumn, TableInventory } from './t1-profiles';

function fixture() {
  const profiles = readFileSync(join(T1_ROOT, 'profiles/profiles.jsonl'), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as PreparedColumn);
  const inventory = JSON.parse(readFileSync(join(T1_ROOT, 'verifier/inventory.json'), 'utf8')) as TableInventory[];
  const selected = inventory.slice(0, 2);
  const linked = new Map<string, LinkedColumn>();
  for (const table of selected) {
    table.profileIds.forEach((id, index) => {
      linked.set(id, { column: profiles.find(column => column.profileId === id)!, table, index });
    });
  }
  const lines = readFileSync(join(T1_ROOT, 'labels/teacher-labels.jsonl'), 'utf8').trim().split('\n')
    .map((line, index) => ({ inputLine: index + 1,
      value: JSON.parse(line) as { profileId: string } }))
    .filter(line => linked.has(line.value.profileId));
  return { selected, linked, lines };
}

test('complete table accepted once; incomplete table keeps canonical rejection and input lines', async () => {
  const { selected, linked, lines } = fixture();
  const missing = selected[1].profileIds.at(-1);
  const remaining = lines.filter(line => line.value.profileId !== missing);
  const groups = groupTeacherLabels(remaining, linked);
  const output = join(T1_ROOT, `verifier/group-regression-${Date.now()}`);
  const report = await verifyLabelGroups(groups, output);
  assert.equal(report.accepted, 1);
  assert.equal(report.examples, selected[0].profile.columns.length);
  assert.equal(report.rejected, 1);
  assert(report.rejections[0].codes.includes('MAPPING_SOURCE_FIELD_UNMAPPED'));
  assert.deepEqual(report.labels[0].inputLines,
    remaining.filter(line => selected[0].profileIds.includes(line.value.profileId)).map(line => line.inputLine));
  assert.deepEqual(report.rejections[0].inputLines,
    remaining.filter(line => selected[1].profileIds.includes(line.value.profileId)).map(line => line.inputLine));
  const normalized = JSON.parse(readFileSync(join(output, 'normalized-labels.jsonl'), 'utf8').split('\n')[0]);
  assert.deepEqual(normalized.plan.fields.map((field: { sourceField: string }) => field.sourceField),
    selected[0].profile.columns.map(column => column.name));
});

test('duplicate column label rejects its table without last-value-wins', async () => {
  const { linked, lines } = fixture();
  const groups = groupTeacherLabels([...lines, { ...lines[0], inputLine: 999 }], linked);
  const report = await verifyLabelGroups(groups, join(T1_ROOT, `verifier/duplicate-regression-${Date.now()}`));
  assert(report.rejections.some(rejection => rejection.codes.includes('TEACHER_LABEL_DUPLICATE')));
  assert(report.rejections.find(rejection => rejection.codes.includes('TEACHER_LABEL_DUPLICATE'))!
    .inputLines.includes(999));
});
