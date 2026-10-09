import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profileColumnFile, profileColumns } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { hash } from '../../packages/server/src/modules/model-gateway/config';
import { TeacherRecordings, type TeacherRecording } from '../../packages/server/src/modules/model-gateway/recordings';
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

test('replay selects the newest valid timestamp, not UUID order, and ignores invalid newer entries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'a2-latest-replay-'));
  const profileHash = hash('software-control-profile');
  const replayKey = hash({ template: 'control-template', profileHash, model: 'sarvam-105b' });
  function entry(recordedAt: string, marker: string, valid = true): TeacherRecording {
    const response = { output: { marker }, responseHash: hash(marker), httpStatus: 200 };
    return {
      version: 'teacher-recording/1', adapterKind: 'control', recordedAt,
      templateVersion: 'control-template', model: 'sarvam-105b', requestHash: hash('control-request'),
      profileHash, replayKey, attempt: 1, latencyMs: 0, rawResponse: response.output,
      responseHash: response.responseHash, response, responseIntegrity: hash(response),
      parsedPlan: { softwareControl: true }, validation: { success: valid },
      tokens: null, costMicroInr: null, priceVersion: 'software-control',
    };
  }
  function save(name: string, recording: TeacherRecording) {
    writeFileSync(join(directory, name), JSON.stringify({ ...recording, recordHash: hash(recording) }) + '\n');
  }
  save('teacher-0000.jsonl', entry('2026-10-10T12:00:00Z', 'newest-valid'));
  save('teacher-ffff.jsonl', entry('2026-10-09T12:00:00Z', 'older'));
  save('teacher-ffff-ffff.jsonl', entry('2026-10-11T12:00:00Z', 'invalid-newer', false));
  save('teacher-abcd.jsonl', entry('invalid-date', 'invalid-timestamp'));
  const replay = await new TeacherRecordings(directory).replay(replayKey);
  assert.deepEqual(replay?.response.output, { marker: 'newest-valid' });
});

test('the external workbook script preserves bounded native ODS profiling through the configured interpreter', () => {
  const previous = process.env.ULPIN_PROFILE_PYTHON;
  process.env.ULPIN_PROFILE_PYTHON = previous ?? 'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe';
  try {
    const input = profileColumnFile(
      'E:/BhuAayam-data/task-data/native-ods-20261004-run01/originals/home-office-hospitality-2021-q3.ods',
    );
    assert.equal(input.profile.columns.length, 5);
    assert.equal(input.rows.length, 75);
    assert.equal(input.profile.sampleShortfall, false);
  } finally {
    if (previous === undefined) delete process.env.ULPIN_PROFILE_PYTHON;
    else process.env.ULPIN_PROFILE_PYTHON = previous;
  }
});
