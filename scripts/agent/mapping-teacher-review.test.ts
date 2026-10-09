import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profileColumns } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { columnProfileHash } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import {
  DEVELOPMENT_TEACHER_METHOD,
  ingestTeacherLabels,
} from '../../packages/server/src/modules/usp/ingestion/teacher-labels';

// Software controls only, never operational property records or training truth.
test('label verification is per field, accepts a ten-percent issue rate, and reports mixed dispositions', async () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    Good: 'Residential',
    Mostly: index === 0 ? 'unparseable' : '12 sq ft',
    Difficult: index < 2 ? 'unparseable' : '12 sq ft',
  }));
  const profile = profileColumns(rows, Object.keys(rows[0]).map(name => ({ name })), 'tabular');
  const profileHash = columnProfileHash(profile);
  const plan = {
    version: 'mapping-plan/2',
    layoutFingerprint: profile.layoutFingerprint,
    sourceKind: profile.sourceKind,
    method: DEVELOPMENT_TEACHER_METHOD,
    fields: [
      { sourceField: 'Good', target: 'building.name', operation: { kind: 'copy' } },
      { sourceField: 'Mostly', target: 'parcel.area', operation: { kind: 'unit_convert', sourceUnit: 'ft2' } },
      { sourceField: 'Difficult', target: 'space.area', operation: { kind: 'unit_convert', sourceUnit: 'ft2' } },
    ].map(field => ({ ...field, confidence: 0.9, rationale: 'Software-control source literal.' })),
  };
  const directory = mkdtempSync(join(tmpdir(), 'a2-per-field-'));
  const input = join(directory, 'teacher-labels.jsonl');
  const output = join(directory, 'examples.jsonl');
  writeFileSync(input, JSON.stringify({ profileHash, plan, method: DEVELOPMENT_TEACHER_METHOD }) + '\n');
  const profiles = new Map([[profileHash, {
    profile, rows, sourceRef: 'software-control',
    dataPolicy: { dataClass: 'public' as const, split: 'development' as const },
  }]]);
  const report = await ingestTeacherLabels(input, profiles, output);
  assert.equal(report.accepted, 1);
  assert.equal(report.rejected, 0);
  assert.deepEqual(report.labels, [{ line: 1, verifiedFields: 2, unverifiedFields: 1 }]);
  const examples = readFileSync(output, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(examples.map(example => example.verified), [true, true, false]);
  assert.deepEqual(examples[1].dryRun, { cells: 10, needsInput: 1, conflicting: 0 });
  assert.deepEqual(examples[2].dryRun, { cells: 10, needsInput: 2, conflicting: 0 });
});
