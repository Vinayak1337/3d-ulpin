import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  groupTeacherLabels, verifyLabelGroups, ingestTeacherLabels, sourceCrsFromReference, type LinkedColumn,
} from './verify-teacher-labels';
import { developmentProfileAssets, sourceTables, T1_ROOT } from './t1-sources';
import { prepareTable, saveNew } from './t1-profiles';
import { DEVELOPMENT_TEACHER_METHODS } from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
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
  const report = await verifyLabelGroups(groups, output, DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5']);
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

function footprintFixture() {
  const source = developmentProfileAssets().find(asset => asset.family === 'mi-d24')!;
  const table = sourceTables(source)[0];
  const prepared = prepareTable(source, table);
  const labels = readFileSync('E:/BhuAayam-data/task-data/t1b/labels/teacher-labels-v2.jsonl', 'utf8')
    .trim().split('\n').map((line, index) => ({ inputLine: index + 1, value: JSON.parse(line) }));
  const linked = new Map<string, LinkedColumn>();
  prepared.profiles.forEach((column, index) => {
    linked.set(column.profileId, { column, table: prepared.inventory, index });
  });
  const selectedLabels = labels.filter(line => linked.has(line.value.profileId));
  const groups = groupTeacherLabels(selectedLabels, linked);
  const rows = table.rows.map(row => Object.fromEntries(prepared.inventory.profile.columns.map((column, index) =>
    [column.name, row[index]])));
  return { source, prepared, groups, rows, labels: selectedLabels.map(line => line.value) };
}

test('script stamps the requested development teacher in plans, examples and report', async () => {
  const { prepared, labels } = footprintFixture();
  const root = join(T1_ROOT, `verifier/t2-stamp-${Date.now()}`);
  const profilesPath = join(root, 'profiles/profiles.jsonl');
  const labelsPath = join(root, 'labels.jsonl');
  const output = join(root, 'result');
  saveNew(profilesPath, prepared.profiles, true);
  saveNew(join(root, 'verifier/inventory.json'), [prepared.inventory]);
  // Attribution-only software control: replay transport fields, not a new teacher round or training input.
  saveNew(labelsPath, labels, true);
  const report = await ingestTeacherLabels('gpt-6.1-sol', labelsPath, profilesPath, output);
  assert.equal(report.accepted, 1);
  assert.equal(report.rejected, 0);
  const method = DEVELOPMENT_TEACHER_METHODS['gpt-6.1-sol'];
  const recordedReport = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(recordedReport.method, method);
  const normalized = JSON.parse(readFileSync(join(output, 'normalized-labels.jsonl'), 'utf8').trim());
  assert.equal(normalized.method, method);
  assert.equal(normalized.plan.method, method);
  const examples = readFileSync(join(output, 'pseudo-labels.jsonl'), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line));
  assert.equal(examples.length, prepared.profiles.length);
  assert(examples.every(example => example.method === method));
});

test('recorded GeoJSON CRS verifies the real footprint; missing and unknown references remain unverified', async () => {
  const { source, prepared, groups, rows } = footprintFixture();
  const cases = [{ horizontalCrs: 'GeoJSON WGS84 longitude/latitude' }, undefined,
    { horizontalCrs: 'unrecorded literal' }];
  for (const [index, reference] of cases.entries()) {
    const output = join(T1_ROOT, `verifier/crs-regression-${Date.now()}-${index}`);
    const report = await verifyLabelGroups(groups, output, DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5'], () => ({
      profile: prepared.inventory.profile, rows, sourceRef: source.original.externalPath,
      sourceCrs: sourceCrsFromReference(reference), dataPolicy: { dataClass: 'public', split: 'development' },
    }));
    assert.equal(report.accepted, 1);
    assert.equal(report.rejected, 0);
    const examples = readFileSync(join(output, 'pseudo-labels.jsonl'), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line));
    const footprint = examples.find(example => example.target === 'building.footprint');
    assert.equal(footprint.verified, index === 0);
    assert.equal(footprint.dryRun.needsInput, index === 0 ? 0 : 128);
  }
});

test('duplicate column label rejects its table without last-value-wins', async () => {
  const { linked, lines } = fixture();
  const groups = groupTeacherLabels([...lines, { ...lines[0], inputLine: 999 }], linked);
  const report = await verifyLabelGroups(groups, join(T1_ROOT, `verifier/duplicate-regression-${Date.now()}`),
    DEVELOPMENT_TEACHER_METHODS['claude-opus-5-5']);
  assert(report.rejections.some(rejection => rejection.codes.includes('TEACHER_LABEL_DUPLICATE')));
  assert(report.rejections.find(rejection => rejection.codes.includes('TEACHER_LABEL_DUPLICATE'))!
    .inputLines.includes(999));
});
