import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profileColumnFile, maskColumnSample } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { developmentManifest, sourceTables, stableHash, T1_ROOT } from './t1-sources';
import { checkBoundary, prepareTable, saveNew, type PreparedColumn } from './t1-profiles';
import { ingestTeacherLabels } from './verify-teacher-labels';

const manifest = developmentManifest();
const asset = (family: string) => manifest.assets.find(entry => entry.family === family)!;

test('real CSV and difficult multi-row workbook retain observed masked samples and stable identities', () => {
  for (const source of [asset('mi-d01'), asset('mi-d19')]) {
    for (const table of sourceTables(source)) {
      const prepared = prepareTable(source, table);
      assert(prepared.profiles.length > 0);
      for (const column of prepared.profiles) {
        assert.equal(column.profileId, stableHash([source.family, source.id, table.name, column.column]));
        assert(column.maskedSamples.length <= 10);
        const values = table.rows.map(row => maskColumnSample(row[column.column - 1], column.header));
        assert(column.maskedSamples.every(sample => values.includes(sample)));
      }
      assert.equal(checkBoundary(prepared.profiles).heldOutMatches, 0);
    }
  }
});

test('real selected Bihar HTML excludes unrelated contact tables and round-trips Unicode', () => {
  const source = asset('mi-d02');
  const profiled = profileColumnFile(source.original.externalPath, source.sourceTable!.htmlId);
  assert.equal(profiled.profile.columns.length, 7);
  assert(profiled.profile.columns.every(column => !/bank|email|contact|mobile/i.test(column.name)));
  const project = sourceTables(asset('mi-d03'));
  assert.equal(project.length, 1);
  assert.equal(project[0].rows.length, 10);
  assert.equal(project[0].headers.length, 5);
  assert(project[0].rows.flat().some(value => typeof value === 'string' && /[\u0900-\u097f]/u.test(value)));
});

test('blind IDs are rejected before opening any held-out path', () => {
  const source = asset('mi-d01');
  const blind = [...manifest.heldOut][0];
  assert.throws(() => sourceTables({ ...source, family: blind }), /T1_SOURCE_DENIED/);
  const column = prepareTable(source, sourceTables(source)[0]).profiles[0];
  assert.throws(() => checkBoundary([{ ...column, family: blind }]), /AssertionError/);
  assert.throws(() => checkBoundary([{ ...column, split: 'pool' }]), /AssertionError/);
});

test('path-based label adapter links real profile IDs without fabricating accepted labels', async () => {
  const profilesPath = join(T1_ROOT, 'profiles/profiles.jsonl');
  const profiles = readFileSync(profilesPath, 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as PreparedColumn);
  const root = join(T1_ROOT, `verifier/reference-control-${Date.now()}`);
  const input = join(root, 'invalid-reference-controls.jsonl');
  // Deliberately incomplete transport controls, not guessed teacher target labels or training examples.
  saveNew(input, [{ profileId: profiles[0].profileId }, { profileId: stableHash('no-such-profile') }], true);
  const report = await ingestTeacherLabels(input, profilesPath, join(root, 'result'));
  assert.equal(report.linkedProfiles, profiles.length);
  assert.equal(report.accepted, 0);
  assert.equal(report.rejected, 2);
  assert.equal(report.examples, 0);
  assert.equal(readFileSync(join(report.outputDirectory, 'pseudo-labels.jsonl'), 'utf8'), '');
  assert.throws(() => sourceTables({ ...asset('mi-d01'), split: 'pool' }), /T1_SOURCE_DENIED/);
});
