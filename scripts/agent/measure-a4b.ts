import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { profileColumns } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { saveNew } from './t1-profiles';
import { digest, stableHash } from './t1-sources';
import type { PseudoLabelExample } from '../../packages/server/src/modules/usp/ingestion/teacher-labels';

type Row = Record<string, unknown>;
type Profile = Row & { profileId: string; family: string; header: string };
type Link = Profile & { profileHash: string; sourceField: string; split: string };
export type RecordLabel = { example: PseudoLabelExample; link: Link };
type Prediction = { profileId: string; target: string; committed: boolean };
type Pin = { externalPath: string; sha256: string };
type BlindAsset = {
  id: string; family: string; split: string; original: Pin;
  sourceSchema: { rowArrayPointer: string; columns: string[]; rows: number };
};
type BlindTruth = { family: string; file: string; sourceField: string; header: string; expectedTarget: string };

const ROOT = 'E:/BhuAayam-data/task-data/a4b';
export const EXAMPLES = [
  `${ROOT}/t1-reverification-v1/pseudo-labels.jsonl`,
  'E:/BhuAayam-data/task-data/t1b/verifier/labels-a4b-v1/pseudo-labels.jsonl',
];
const MODEL = `${ROOT}/learner/v48`;
const CALIBRATION = 'mi-d03';
const RESUME_SCORING = process.argv.includes('--resume-scoring');

export function readLines<T>(path: string): T[] {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as T);
}

export function python(args: string[]): string {
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', args, {
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: resolve('services/geo'), PYTHONDONTWRITEBYTECODE: '1' },
  });
  // Never reflect a held-out parser, header, prediction or value into a lead-readable error log.
  assert.equal(run.status, 0, 'A4B_PYTHON_MEASUREMENT_FAILED; evaluator inspects private inputs separately.');
  return run.stdout;
}

export function verifiedRecords(): RecordLabel[] {
  const records = new Map<string, RecordLabel>();
  for (const path of EXAMPLES) {
    const links = new Map(readLines<Link>(join(path, '../profile-links.jsonl'))
      .map(link => [`${link.profileHash}/${link.sourceField}`, link]));
    for (const example of readLines<PseudoLabelExample>(path)) {
      if (!example.verified) continue;
      const key = `${example.profileHash}/${example.columnProfile.name}`;
      const link = links.get(key);
      assert(link && ['dev', 'pool'].includes(link.split));
      assert(!link.family.startsWith('mi-h') && !link.family.match(/^h\d+$/));
      records.set(key, { example, link });
    }
  }
  return [...records.values()];
}

function predict(model: string, profiles: Profile[], path: string, resumeScoring = RESUME_SCORING): Prediction[] {
  if (resumeScoring) assert.deepEqual(readLines<Profile>(path), profiles, 'A4B_SCORING_PROFILE_CHANGED');
  else saveNew(path, profiles, true);
  const predictions = python(['-m', 'geo.usp_learning.stage_a', 'predict', '--model', model, '--profiles', path])
    .trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Prediction);
  saveNew(join(path, '../predictions.jsonl'), predictions, true);
  return predictions;
}

function fixedFoldModel(root: string, train: RecordLabel[]) {
  if (RESUME_SCORING) {
    const versions = readdirSync(join(root, 'learner')).filter(name => /^v\d+$/.test(name))
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
    const model = join(root, 'learner', versions.at(-1)!);
    const manifest = JSON.parse(readFileSync(join(model, 'manifest.json'), 'utf8'));
    return { model, fitExamples: manifest.trainingExamples.length, calibration: manifest.calibration };
  }
  saveNew(join(root, 'inputs/pseudo-labels.jsonl'), train.map(record => record.example), true);
  saveNew(join(root, 'inputs/profile-links.jsonl'), train.map(record => record.link), true);
  return JSON.parse(python(['-m', 'geo.usp_learning.stage_a', 'train', '--examples',
    join(root, 'inputs/pseudo-labels.jsonl'), '--out', join(root, 'learner')]));
}

export function agreement(records: RecordLabel[], predictions: Prediction[]) {
  assert.equal(records.length, predictions.length);
  const targets = [...new Set(records.map(record => record.example.target))].filter(target => target !== 'unknown');
  return Object.fromEntries(targets.map(target => {
    const selected = records.map((record, index) => ({ record, prediction: predictions[index] }))
      .filter(({ record }) => record.example.target === target);
    const committed = selected.filter(({ prediction }) => prediction.committed);
    return [target, {
      n: selected.length, columns: selected.length, committed: committed.length,
      committedCorrect: committed.filter(({ prediction }) => prediction.target === target).length,
      abstained: selected.length - committed.length,
    }];
  }));
}

export function targetCounts(records: RecordLabel[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) counts[record.example.target] = (counts[record.example.target] ?? 0) + 1;
  return counts;
}

function leaveOneFamilyOut(records: RecordLabel[]) {
  const families = [...new Set(records.filter(record => record.example.target !== 'unknown')
    .map(record => record.link.family))].sort();
  return families.map(family => {
    const train = records.filter(record => record.link.family !== family);
    const test = records.filter(record => record.link.family === family);
    const root = join(ROOT, 'leave-one-family-out', family);
    const fit = fixedFoldModel(root, train);
    const predictions = predict(fit.model, test.map(record => record.link), join(root, 'test/profiles.jsonl'));
    return {
      family, columns: test.length, positives: test.filter(record => record.example.target !== 'unknown').length,
      threshold: fit.calibration.threshold, calibrationFields: fit.calibration.fields,
      fitExamples: fit.fitExamples, modelSha256: digest(join(fit.model, 'model.npz')),
      perTarget: agreement(test, predictions),
      qualification: family === CALIBRATION ? 'Calibration family left out; no threshold, therefore abstain.'
        : 'One fixed-config fresh fit; agreement with teacher pseudo_labels, never accuracy.',
    };
  });
}

function nativeRows(asset: BlindAsset): Row[] {
  assert.equal(asset.split, 'heldout');
  assert.equal(digest(asset.original.externalPath), asset.original.sha256, 'A4B_BLIND_SOURCE_PIN_CHANGED');
  let selected: unknown = JSON.parse(readFileSync(asset.original.externalPath, 'utf8'));
  for (const token of asset.sourceSchema.rowArrayPointer.split('/').slice(1)) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    assert(selected && typeof selected === 'object', 'A4B_BLIND_NATIVE_TABLE_INVALID');
    selected = (selected as Row)[key];
  }
  assert(Array.isArray(selected), 'A4B_BLIND_NATIVE_TABLE_INVALID');
  const rows = selected as Row[];
  assert.equal(rows.length, asset.sourceSchema.rows, 'A4B_BLIND_NATIVE_SCHEMA_CHANGED');
  assert(rows.every(row => stableHash(Object.keys(row)) === stableHash(asset.sourceSchema.columns)),
    'A4B_BLIND_NATIVE_SCHEMA_CHANGED');
  return rows;
}

function blindProfiles(asset: BlindAsset, rows: Row[]): Profile[] {
  const headers = asset.sourceSchema.columns;
  return headers.map((header, index) => {
    const profile = profileColumns(rows, [{ name: header }], 'tabular').columns[0];
    return {
      profileId: stableHash([asset.family, asset.id, index + 1]), family: asset.family, file: asset.id,
      sourceField: `column_${index + 1}`, header, inferredType: profile.inferredType,
      declaredUnit: profile.declaredUnit ?? null, valueShapes: profile.valueShapes,
      maskedSamples: profile.maskedSamples, cellCount: rows.length,
      emptyCount: rows.filter(row => row[header] === null || row[header] === undefined ||
        (typeof row[header] === 'string' && !(row[header] as string).trim())).length,
      neighbourHeaders: headers.slice(Math.max(0, index - 2), index).concat(headers.slice(index + 1, index + 3)),
    };
  });
}

function heldOutCounts(model = MODEL, root = ROOT) {
  const publicManifest = JSON.parse(readFileSync('fixtures/usp/D8-messy-india/heldout.json', 'utf8'));
  const pin: Pin = publicManifest.familySets.d1c.evaluatorManifest;
  assert.equal(digest(pin.externalPath), pin.sha256, 'A4B_BLIND_MANIFEST_PIN_CHANGED');
  const manifest = JSON.parse(readFileSync(pin.externalPath, 'utf8'));
  const receipt = JSON.parse(readFileSync('docs/evidence/gf-agent/d1c/heldout-truth-freeze.json', 'utf8'));
  assert.equal(manifest.truthPath, receipt.path, 'A4B_BLIND_TRUTH_PATH_CHANGED');
  assert.equal(digest(receipt.path), receipt.sha256, 'A4B_BLIND_TRUTH_PIN_CHANGED');
  const truth = readLines<BlindTruth>(receipt.path);
  const profiles = (manifest.assets as BlindAsset[]).flatMap(asset => blindProfiles(asset, nativeRows(asset)));
  const predictions = predict(model, profiles, join(root, 'evaluator/profiles.jsonl'), root === ROOT && RESUME_SCORING);
  const expected = profiles.map(profile => truth.find(row => row.family === profile.family &&
    row.file === profile.file && row.sourceField === profile.header && row.header === profile.header));
  assert(expected.every(Boolean), 'A4B_BLIND_TRUTH_PROFILE_LINK_INVALID');
  const scorable = expected.map((row, index) => ({ row: row!, prediction: predictions[index] }))
    .filter(({ row }) => row.expectedTarget !== 'truth_absent');
  const committed = scorable.filter(({ prediction }) => prediction.committed);
  const nonscorable = expected.map((row, index) => ({ row: row!, prediction: predictions[index] }))
    .filter(({ row }) => row.expectedTarget === 'truth_absent');
  return {
    n: scorable.length, total: scorable.length, committed: committed.length,
    committedCorrect: committed.filter(({ row, prediction }) => row.expectedTarget === prediction.target).length,
    abstained: scorable.length - committed.length,
    nonScorable: {
      n: nonscorable.length, committed: nonscorable.filter(({ prediction }) => prediction.committed).length,
    },
    truthSha256: receipt.sha256, manifestSha256: pin.sha256, profiles: profiles.length,
    qualification: 'Fixed frozen model; n=2 is a count receipt, not an accuracy claim. No tuning feedback.',
  };
}

export function safeHeldOutCounts(model = MODEL, root = ROOT) {
  try {
    return heldOutCounts(model, root);
  } catch {
    throw new Error('A4B_EVALUATOR_SCORING_FAILED; inspect closed evaluator artifacts, not lead-readable payloads.');
  }
}

function calibrationCounts(records: RecordLabel[]) {
  const selected = records.filter(record => record.link.family === CALIBRATION);
  const predictions = predict(MODEL, selected.map(record => record.link), join(ROOT, 'calibration/profiles.jsonl'));
  const positive = selected.map((record, index) => ({ record, prediction: predictions[index] }))
    .filter(({ record }) => record.example.target !== 'unknown');
  return {
    n: selected.length, positives: positive.length,
    positiveCommitted: positive.filter(({ prediction }) => prediction.committed).length,
    positiveCommittedCorrect: positive.filter(({ record, prediction }) => prediction.committed &&
      record.example.target === prediction.target).length,
    unknownCommitted: selected.filter((record, index) => record.example.target === 'unknown' &&
      predictions[index].committed).length,
  };
}

function main() {
  const records = verifiedRecords();
  const manifest = JSON.parse(readFileSync(join(MODEL, 'manifest.json'), 'utf8'));
  const previous = JSON.parse(readFileSync('docs/evidence/gf-agent/a4/result.json', 'utf8')).student;
  const fitting = records.filter(record => record.link.family !== CALIBRATION);
  assert.equal(manifest.trainingExamples.length, fitting.length);
  assert.equal(digest(join(MODEL, 'model.npz')), manifest.modelSha256);
  const calibration = calibrationCounts(records);
  const folds = leaveOneFamilyOut(records);
  const fitPredictions = predict(MODEL, fitting.map(record => record.link), join(ROOT, 'fit/profiles.jsonl'));
  const result = {
    task: 'A4b', gates: ['GF-AGENT', 'FP-LEARN-TEST'],
    qualification: 'Pseudo-label agreement, not teacher-label accuracy.',
    model: MODEL, modelSha256: manifest.modelSha256, fitExamples: fitting.length,
    fitFamilies: new Set(fitting.map(record => record.link.family)).size, fitTargetCounts: targetCounts(fitting),
    threshold: manifest.threshold, calibrationFamily: CALIBRATION, calibration,
    inSamplePositiveAgreement: agreement(fitting, fitPredictions), leaveOneFamilyOut: folds,
    previous: { model: previous.model, fitExamples: previous.fitExamples, fitTargetCounts: previous.fitTargetCounts,
      positiveCalibrationCommits: previous.positiveCalibrationCommits, threshold: previous.threshold },
    heldOut: safeHeldOutCounts(), tuningAfterMeasurements: false, freshFit: true,
    receiptRecovery: RESUME_SCORING
      ? 'Receipt link correction only; all saved models and feature inputs unchanged.' : null,
    teacherCalls: 0, providerCalls: 0, labelsChanged: false, runtimeChanged: false,
  };
  saveNew(join(ROOT, 'measurements/result.json'), result);
  console.log(JSON.stringify({ fitExamples: result.fitExamples, fitFamilies: result.fitFamilies,
    threshold: result.threshold, calibration, leaveOneFamilyOut: folds, heldOut: result.heldOut }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
