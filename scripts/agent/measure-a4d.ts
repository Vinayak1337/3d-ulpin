import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveNew, type PreparedColumn } from './t1-profiles';
import { digest, stableHash } from './t1-sources';
import { python, readLines, targetCounts, verifiedRecords, type RecordLabel } from './measure-a4b';
import type { ArmMetrics } from './measure-a4c';

type Round = 't1c' | 't1d';
type Label = { profileId: string; field: { target: string } };
type TeacherEvidence = {
  labels: { path: string; sha256: string; lines: number };
  expectedVerifierRefusals?: { fieldsExpectedUnverified: Record<string, string>; tablePlansExpectedRejected: number };
};
type BoundaryReceipt = {
  round: Round; labelPath: string; labelsSha256: string; profilesPath: string; profilesSha256: string;
  outputDirectory: string; exitCode: number; status: string; refusalsPath: string; refusalsSha256: string;
  error: { name: string; code: string; location: string; expression: string };
};
type Baseline = {
  fitExamples: number; fitTargetCounts: Record<string, number>; chosen: string;
  arms: (Omit<ArmMetrics, 'n' | 'perTarget'> & {
    arm: string; model: string; pooledFields: number; perTargetPositives: ArmMetrics['perTarget'];
  })[];
};

const ROOT = 'E:/BhuAayam-data/task-data/a4d';
const BASELINE = 'docs/evidence/gf-agent/a4c/result.json';
const RESULT = join(ROOT, 'measurements/result.json');
const PROFILE_ROOTS = { t1c: 'd1f', t1d: 'a5a' };
const SIX_TARGETS = ['document.registrationNo', 'building.name', 'building.storeyLabel',
  'unit.type', 'building.addressLiteral', 'building.footprint'];
const FOREIGN = Array.from({ length: 8 }, (_, index) => `opf-d${String(index + 2).padStart(2, '0')}`);
const BOUNDARY_EXPRESSION =
  "assert(profile.split === 'dev' ? development.has(profile.family) : !allFamilies.has(profile.family))";

function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function roundInputs(round: Round) {
  const evidence = json<TeacherEvidence>(`docs/evidence/gf-agent/${round}/result.json`);
  const profilesPath = `E:/BhuAayam-data/task-data/${PROFILE_ROOTS[round]}/profiles/profiles.jsonl`;
  assert.equal(digest(evidence.labels.path), evidence.labels.sha256, 'A4D_LABEL_HASH_MISMATCH');
  const labels = readLines<Label>(evidence.labels.path);
  const profiles = readLines<PreparedColumn>(profilesPath);
  assert.equal(labels.length, evidence.labels.lines);
  assert.deepEqual(labels.map(label => label.profileId), profiles.map(profile => profile.profileId));
  return { evidence, labels, profiles, profilesPath };
}

function captureBoundary(round: Round, inputs: ReturnType<typeof roundInputs>): BoundaryReceipt {
  const output = join(ROOT, `verified/${round}-v1`);
  const run = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'),
    'scripts/agent/verify-teacher-labels.ts', inputs.evidence.labels.path, inputs.profilesPath, output], {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, ULPIN_T1_ROOT: ROOT, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(run.status, 1, 'A4D_VERIFIER_BEHAVIOUR_CHANGED_REVIEW_REQUIRED');
  assert(run.stderr.includes('ERR_ASSERTION') && run.stderr.includes(BOUNDARY_EXPRESSION),
    'A4D_UNEXPECTED_VERIFIER_FAILURE');
  const refusalsPath = join(output, 'refusals.jsonl');
  const refused = inputs.labels.map(label => ({ profileId: label.profileId, reasonCode: 'ERR_ASSERTION' }));
  saveNew(refusalsPath, refused, true);
  const receipt: BoundaryReceipt = {
    round, labelPath: inputs.evidence.labels.path, labelsSha256: inputs.evidence.labels.sha256,
    profilesPath: inputs.profilesPath, profilesSha256: digest(inputs.profilesPath), outputDirectory: output,
    exitCode: 1, status: 'round_boundary_refused', refusalsPath, refusalsSha256: digest(refusalsPath),
    error: { name: 'AssertionError', code: 'ERR_ASSERTION', location: 'scripts/agent/t1-profiles.ts:107',
      expression: BOUNDARY_EXPRESSION },
  };
  saveNew(join(output, 'verification-receipt.json'), receipt);
  return receipt;
}

function admittedPositiveCounts(records: RecordLabel[], targets = Object.keys(targetCounts(records))) {
  return Object.fromEntries(targets.filter(target => target !== 'unknown').map(target => {
    const selected = records.filter(record => record.example.target === target);
    const families = [...new Set(selected.map(record => record.link.family))].sort();
    return [target, { columns: selected.length, distinctFamilies: families.length, families }];
  }));
}

function roundSummary(round: Round, check: boolean) {
  const inputs = roundInputs(round);
  const path = join(ROOT, `verified/${round}-v1/verification-receipt.json`);
  assert(!check || existsSync(path), 'A4D_CHECK_RECEIPT_MISSING');
  const receipt = existsSync(path) ? json<BoundaryReceipt>(path) : captureBoundary(round, inputs);
  assert.equal(receipt.round, round);
  assert.equal(receipt.labelPath, inputs.evidence.labels.path);
  assert.equal(receipt.profilesPath, inputs.profilesPath);
  assert.equal(receipt.status, 'round_boundary_refused');
  assert.equal(receipt.labelsSha256, inputs.evidence.labels.sha256);
  assert.equal(receipt.profilesSha256, digest(inputs.profilesPath));
  assert.equal(receipt.refusalsSha256, digest(receipt.refusalsPath));
  assert.equal(receipt.error.expression, BOUNDARY_EXPRESSION);
  assert.equal(receipt.exitCode, 1);
  const refused = readLines<{ profileId: string; reasonCode: string }>(receipt.refusalsPath);
  assert.deepEqual(refused, inputs.labels.map(label => ({ profileId: label.profileId, reasonCode: 'ERR_ASSERTION' })));
  const targets = [...new Set(inputs.labels.map(label => label.field.target))].filter(target => target !== 'unknown');
  const expected = inputs.evidence.expectedVerifierRefusals;
  return {
    round, labelsSha256: receipt.labelsSha256, profilesSha256: receipt.profilesSha256,
    tablesSubmitted: new Set(inputs.profiles.map(profile => `${profile.file}/${profile.sheet}`)).size,
    fieldsSubmitted: inputs.labels.length, tablesAccepted: 0, tablePlansEvaluated: 0,
    fieldsVerified: 0, fieldsDryRunEvaluated: 0, fieldsBoundaryBlocked: refused.length,
    refusalCodes: { ERR_ASSERTION: refused.length }, refused,
    labelledPositives: Object.fromEntries(targets.map(target => [target,
      inputs.labels.filter(label => label.field.target === target).length])),
    verifiedPositives: admittedPositiveCounts([], targets),
    expectedComparison: expected ? {
      expectedTablePlansRejected: expected.tablePlansExpectedRejected,
      expectedFieldRefusals: Object.keys(expected.fieldsExpectedUnverified).length,
      actual: 'Entire round blocked before table validation; no MAPPING_CRS_UNVERIFIED result exists.',
    } : null,
  };
}

function baselineGroups(model: string, threshold: number | null) {
  const scoresPath = join(model, '../cross-fit-scores.json');
  const manifest = json<{ crossFitScoresSha256: string }>(join(model, 'manifest.json'));
  assert.equal(digest(scoresPath), manifest.crossFitScoresSha256, 'A4D_BASELINE_SCORES_PIN_CHANGED');
  // Reuse the classifier's scorer on saved development scores; this performs no fit or prediction.
  const code = [
    'import json, sys',
    'from pathlib import Path',
    'from geo.usp_learning.stage_a import commit_counts',
    'scores = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))',
    'threshold = json.loads(sys.argv[2])',
    'groups = {name: commit_counts([s for s in scores if s["family"].startswith(prefix)], threshold)',
    '          for name, prefix in [("Indian", "mi-"), ("foreign", "opf-")]}',
    'print(json.dumps(groups))',
  ].join('\n');
  return JSON.parse(python(['-B', '-c', code, scoresPath, JSON.stringify(threshold)]));
}

function baselineRow(records: RecordLabel[]) {
  const baseline = json<Baseline>(BASELINE);
  assert.equal(baseline.chosen, 'B');
  const arm = baseline.arms.find(row => row.arm === 'B');
  assert(arm);
  assert.equal(records.length, baseline.fitExamples, 'A4D_BASELINE_FIT_SET_CHANGED');
  assert.deepEqual(targetCounts(records), baseline.fitTargetCounts, 'A4D_BASELINE_TARGET_COUNTS_CHANGED');
  return { name: 'A4c arm B', ...arm, fitExamples: baseline.fitExamples, fitTargetCounts: baseline.fitTargetCounts,
    byFamilyGroup: baselineGroups(arm.model, arm.threshold), baselineEvidenceSha256: digest(BASELINE) };
}

function fallbackTriggers(records: RecordLabel[]) {
  const six = admittedPositiveCounts(records, SIX_TARGETS);
  const all = admittedPositiveCounts(records);
  const reach12 = Object.values(six).filter(count => count.columns >= 12).length;
  const positiveExamples = records.filter(record => record.example.target !== 'unknown').length;
  return {
    scope: 'Admitted verified set only; both new rounds are blocked mechanically, not semantically refused.',
    sixA4cTargets: six, everyVerifiedPositiveTarget: all, sixTargetsReaching12: reach12,
    sixTargetsBelow12: SIX_TARGETS.length - reach12, tData: SIX_TARGETS.length - reach12 > SIX_TARGETS.length / 2,
    tMethod: null, tMethodStatus: 'not_evaluated_tData_true_and_retrain_blocked',
    stageB: { verifiedPositiveExamples: positiveExamples, required: 300, shortfall: 300 - positiveExamples },
    decision: 'No fallback work dispatched. Admission repair is a prerequisite to assessing the new data.',
  };
}

function measurement(check: boolean) {
  const rounds = (['t1c', 't1d'] as Round[]).map(round => roundSummary(round, check));
  const records = verifiedRecords();
  const dev = [...new Set(records.filter(record => record.link.split === 'dev').map(record => record.link.family))]
    .sort();
  const pool = [...new Set(records.filter(record => record.link.split === 'pool').map(record => record.link.family))]
    .sort();
  return {
    task: 'A4d', gates: ['GF-AGENT', 'FP-LEARN-TEST'], status: 'blocked_verifier_foreign_development_boundary',
    rounds, verifiedPositiveCounts: admittedPositiveCounts(records), baseline: baselineRow(records),
    a4d: { fitExamples: null, threshold: null, wrongCommitted: null, correctPositiveCommitted: null,
      unknownCommitted: null, abstained: null, byFamilyGroup: null, reason: 'No new labels reached verification.' },
    families: { currentlyAdmittedDev: dev, pool, currentFoldCount: dev.length,
      proposedForeignDev: FOREIGN, proposedFoldCount: dev.length + FOREIGN.length,
      poolPolicy: 'Pool remains in fitting for every fold, as in A4c.' },
    heldOut: { status: 'not_run_no_new_frozen_model', counts: null, heldOutFilesOpened: 0 },
    fallbackTriggers: fallbackTriggers(records), freshFits: 0, heldOutRuns: 0,
    labelsChanged: false, labelsProduced: 0, providerCalls: 0, runtimeChanged: false, gpuUsed: false,
    qualification: 'Boundary failure is not a judgment on teacher labels; zero pooled wrong is by construction.',
    next: [
      'Admit exact pinned foreign development profiles in checkBoundary; retain blind and privacy exclusions.',
      'Reuse the pinned D1f prefix reader in materialize/sourceTables; current T1_SOURCE_DENIED is the next guard.',
      'Extend stage_a.development_families with the pinned foreign manifest; never mark foreign dev as pool.',
      'Verifier output uses ULPIN_T1_ROOT=a4d. No output-root change is needed.',
      'Resume unchanged labels, verify first, then one cross_fit/no-class-balance fit and one held-out receipt.',
    ],
  };
}

function main() {
  const check = process.argv.includes('--check');
  assert(check || !existsSync(RESULT), 'A4D_RESULT_EXISTS_NO_OVERWRITE');
  const result = measurement(check);
  if (check) assert.equal(stableHash(json(RESULT)), stableHash(result), 'A4D_RECORDED_RESULT_CHANGED');
  else saveNew(RESULT, result);
  console.log(JSON.stringify({ status: result.status, rounds: result.rounds.map(round => ({
    round: round.round, tablesAccepted: round.tablesAccepted, fieldsVerified: round.fieldsVerified,
    fieldsBoundaryBlocked: round.fieldsBoundaryBlocked, refusalCodes: round.refusalCodes,
  })), freshFits: result.freshFits, heldOutRuns: result.heldOutRuns, fallbackTriggers: result.fallbackTriggers }));
}

main();
