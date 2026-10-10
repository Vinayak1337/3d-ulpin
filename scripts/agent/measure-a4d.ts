import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveNew, type PreparedColumn, type TableInventory } from './t1-profiles';
import { digest, stableHash, sourceTables } from './t1-sources';
import { EXAMPLES, python, readLines, safeHeldOutCounts, targetCounts, verifiedRecords } from './measure-a4b';
import type { RecordLabel } from './measure-a4b';
import type { ArmMetrics } from './measure-a4c';
import type { MappingPlanV2 } from '../../packages/contracts/src/index';
import type { PseudoLabelExample } from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
import { executeMappingPlanV2 } from '../../packages/server/src/modules/usp/ingestion/mapping-executor';
import { mappingContextFromColumnProfile } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';

type Round = 't1c' | 't1d';
type Label = { profileId: string; field: { target: string } };
type TeacherEvidence = {
  labels: { path: string; sha256: string; lines: number };
  expectedVerifierRefusals?: {
    fieldsExpectedUnverified: Record<string, string>; tablePlansExpectedRejected: number;
  };
};
type Link = RecordLabel['link'];
type Refusal = { profileId: string; reasonCode: string };
type Report = { accepted: number; rejected: number; verifiedExamples: number;
  rejections: { inputLines: number[]; codes: string[] }[] };
type Baseline = { fitExamples: number; fitTargetCounts: Record<string, number>; chosen: string;
  arms: { arm: string; model: string; threshold: number | null; pooledFields: number;
    wrongCommitted: number; correctPositiveCommitted: number; unknownCommitted: number;
    abstained: number; perTargetPositives: ArmMetrics['perTarget'] }[] };
type Trained = { model: string; fitExamples: number; calibration: ArmMetrics };

const ROOT = 'E:/BhuAayam-data/task-data/a4d';
const RUN = join(ROOT, 'measurements/completed-v1');
const RESULT = join(RUN, 'result.json');
const INPUT = join(ROOT, 'inputs/completed-v1');
const MODEL_ROOT = join(ROOT, 'learner/one-arm-v1');
const PROFILE_ROOTS = { t1c: 'd1f', t1d: 'a5a' };
const SIX_TARGETS = ['document.registrationNo', 'building.name', 'building.storeyLabel',
  'unit.type', 'building.addressLiteral', 'building.footprint'];
const verifiedRoot = (round: Round) => join(ROOT, `verified/${round}-v2`);

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

function verifyRound(round: Round, check: boolean) {
  const inputs = roundInputs(round);
  const output = verifiedRoot(round);
  const path = join(output, 'report.json');
  if (!existsSync(path)) {
    assert(!check, 'A4D_VERIFICATION_MISSING');
    const run = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/agent/verify-teacher-labels.ts', inputs.evidence.labels.path, inputs.profilesPath, output], {
      encoding: 'utf8', timeout: 120000,
      env: { ...process.env, ULPIN_T1_ROOT: ROOT, PYTHONDONTWRITEBYTECODE: '1' },
    });
    if (run.status !== 0) {
      saveNew(join(output, 'further-guard.json'), { exitCode: run.status, stderr: run.stderr });
      throw new Error(`A4D_FURTHER_VERIFIER_GUARD:${round}; stop, inspect verified output, do not relax it.`);
    }
  }
  const report = json<Report & { inputPath: string; profilesPath: string }>(path);
  assert.equal(report.inputPath, inputs.evidence.labels.path);
  assert.equal(report.profilesPath, inputs.profilesPath);
  return { ...inputs, report, output };
}

function positiveCounts(records: RecordLabel[], targets = Object.keys(targetCounts(records))) {
  return Object.fromEntries(targets.filter(target => target !== 'unknown').map(target => {
    const selected = records.filter(record => record.example.target === target);
    const families = [...new Set(selected.map(record => record.link.family))].sort();
    return [target, { columns: selected.length, distinctFamilies: families.length, families }];
  }));
}

function fitRecords() {
  // Reuse the existing authority/deduplication join; add exactly the two new verified output paths for this call.
  const length = EXAMPLES.length;
  EXAMPLES.push(...(['t1c', 't1d'] as Round[]).map(round => join(verifiedRoot(round), 'pseudo-labels.jsonl')));
  try {
    return verifiedRecords();
  } finally {
    EXAMPLES.splice(length);
  }
}

function dryRunRefusals(output: string, profilesPath: string, unverified: PseudoLabelExample[]): Refusal[] {
  const links = readLines<Link>(join(output, 'profile-links.jsonl'));
  const tables = json<TableInventory[]>(join(profilesPath, '../../verifier/inventory.json'));
  const plans = readLines<{ profileHash: string; plan: MappingPlanV2 }>(join(output, 'normalized-labels.jsonl'));
  return plans.flatMap(({ profileHash, plan }) => {
    const failed = unverified.filter(example => example.profileHash === profileHash);
    if (!failed.length) return [];
    const link = links.find(entry => entry.profileHash === profileHash);
    assert(link);
    const table = tables.find(entry => entry.profileIds.includes(link.profileId));
    assert(table && table.asset.family.startsWith('opf-'));
    const native = sourceTables(table.asset).find(entry => entry.name === table.sheet);
    assert(native);
    const rows = native.rows.map(row => Object.fromEntries(table.profile.columns.map((column, index) =>
      [column.name, row[index]])));
    // Same execution context as this round's unchanged verifier: foreign references supply no registered CRS.
    const execution = executeMappingPlanV2(plan, rows, { ...mappingContextFromColumnProfile(table.profile),
      sourceRef: `${table.asset.original.externalPath}#sheet=${encodeURIComponent(table.sheet)}`,
      rowCount: rows.length });
    return failed.flatMap(example => {
      const sourceField = example.columnProfile.name;
      const linked = links.find(entry => entry.profileHash === profileHash && entry.sourceField === sourceField);
      assert(linked);
      const codes = new Set(execution.rows.flatMap(row => row.fields.filter(cell => cell.sourceField === sourceField)
        .flatMap(cell => cell.issueCode ? [cell.issueCode] : [])));
      assert(codes.size, 'A4D_UNVERIFIED_FIELD_WITHOUT_REASON');
      return [...codes].sort().map(reasonCode => ({ profileId: linked.profileId, reasonCode }));
    });
  });
}

function compareExpected(checked: ReturnType<typeof verifyRound>, refused: Refusal[]) {
  const expectation = checked.evidence.expectedVerifierRefusals;
  if (!expectation) return null;
  const expected = Object.keys(expectation.fieldsExpectedUnverified).sort();
  const actual = [...new Set(refused.map(row => row.profileId))].sort();
  const expectedVerified = checked.labels.length - expected.length;
  return {
    expectedRefusalIds: expected, actualRefusalIds: actual,
    expectedVerifiedFields: expectedVerified, actualVerifiedFields: checked.report.verifiedExamples,
    differences: {
      unexpected: actual.filter(id => !expected.includes(id)), missing: expected.filter(id => !actual.includes(id)),
      tablePlansRejected: checked.report.rejected - expectation.tablePlansExpectedRejected,
      verifiedFields: checked.report.verifiedExamples - expectedVerified,
      reasonCodes: refused.filter(row => expected.includes(row.profileId) &&
        row.reasonCode !== 'MAPPING_CRS_UNVERIFIED'),
    },
  };
}

function roundSummary(round: Round, checked: ReturnType<typeof verifyRound>, records: RecordLabel[], check: boolean) {
  const examples = readLines<PseudoLabelExample>(join(checked.output, 'pseudo-labels.jsonl'));
  const unverified = examples.filter(example => !example.verified);
  const refused = dryRunRefusals(checked.output, checked.profilesPath, unverified);
  for (const rejection of checked.report.rejections) {
    for (const inputLine of rejection.inputLines) {
      for (const reasonCode of rejection.codes) refused.push({
        profileId: checked.labels[inputLine - 1].profileId, reasonCode,
      });
    }
  }
  const refusalPath = join(RUN, `${round}-refusals.jsonl`);
  if (check) assert.deepEqual(readLines<Refusal>(refusalPath), refused);
  else saveNew(refusalPath, refused, true);
  const families = new Set(checked.profiles.map(profile => profile.family));
  const selected = records.filter(record => families.has(record.link.family));
  const actual = [...new Set(refused.map(row => row.profileId))].sort();
  const labelledTargets = [...new Set(checked.labels.map(label => label.field.target))];
  return {
    round, labelsSha256: checked.evidence.labels.sha256, profilesSha256: digest(checked.profilesPath),
    reportSha256: digest(join(checked.output, 'report.json')), tablesAccepted: checked.report.accepted,
    tablesRejected: checked.report.rejected, fieldsSubmitted: checked.labels.length,
    fieldsVerified: checked.report.verifiedExamples, fieldsRefused: actual.length,
    refusalCodes: Object.fromEntries([...new Set(refused.map(row => row.reasonCode))]
      .map(code => [code, refused.filter(row => row.reasonCode === code).length])),
    refused, verifiedPositives: positiveCounts(selected, labelledTargets),
    expectedComparison: compareExpected(checked, refused),
  };
}

function scoreGroups(model: string, threshold: number | null) {
  const scoresPath = join(model, '../cross-fit-scores.json');
  const manifest = json<{ crossFitScoresSha256: string }>(join(model, 'manifest.json'));
  assert.equal(digest(scoresPath), manifest.crossFitScoresSha256, 'A4D_POOLED_SCORES_PIN_CHANGED');
  const code = [
    'import json, sys', 'from pathlib import Path', 'from geo.usp_learning.stage_a import commit_counts',
    'scores = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))', 'threshold = json.loads(sys.argv[2])',
    'groups = {name: commit_counts([s for s in scores if s["family"].startswith(prefix)], threshold)',
    '          for name, prefix in [("Indian", "mi-"), ("foreign", "opf-")]}', 'print(json.dumps(groups))',
  ].join('\n');
  return JSON.parse(python(['-B', '-c', code, scoresPath, JSON.stringify(threshold)]));
}

function baselineRow() {
  const path = 'docs/evidence/gf-agent/a4c/result.json';
  const baseline = json<Baseline>(path);
  const arm = baseline.arms.find(row => row.arm === 'B');
  assert(arm && baseline.chosen === 'B');
  return { name: 'A4c arm B', ...arm, fitExamples: baseline.fitExamples, fitTargetCounts: baseline.fitTargetCounts,
    byFamilyGroup: scoreGroups(arm.model, arm.threshold), baselineEvidenceSha256: digest(path) };
}

function trainOnce(records: RecordLabel[], check: boolean): Trained {
  const receipt = join(RUN, 'fit-receipt.json');
  if (check) {
    assert.deepEqual(readLines<PseudoLabelExample>(join(INPUT, 'pseudo-labels.jsonl')),
      records.map(record => record.example));
    assert.deepEqual(readLines<Link>(join(INPUT, 'profile-links.jsonl')), records.map(record => record.link));
    return json<Trained>(receipt);
  }
  assert(!existsSync(MODEL_ROOT), 'A4D_ONE_ARM_ALREADY_STARTED_NO_REFIT');
  saveNew(join(INPUT, 'pseudo-labels.jsonl'), records.map(record => record.example), true);
  saveNew(join(INPUT, 'profile-links.jsonl'), records.map(record => record.link), true);
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', ['-B', '-m', 'geo.usp_learning.stage_a',
    'train', '--examples', join(INPUT, 'pseudo-labels.jsonl'), '--out', MODEL_ROOT,
    '--calibration-mode', 'cross_fit', '--no-class-balance'], {
    encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: resolve('services/geo'), PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (run.status !== 0) {
    saveNew(join(RUN, 'fit-failure.json'), { exitCode: run.status, stderr: run.stderr, signal: run.signal });
    throw new Error('A4D_ONE_ARM_FAILED; stop without another fit; inspect development fit-failure.json.');
  }
  const fit = JSON.parse(run.stdout) as Trained;
  assert.equal(fit.fitExamples, records.length);
  saveNew(receipt, fit);
  return fit;
}

function fitRow(fit: Trained, records: RecordLabel[]) {
  const { calibration } = fit;
  const manifest = json<{ modelSha256: string; classBalance: boolean; calibration: { mode: string } }>(
    join(fit.model, 'manifest.json'));
  assert.equal(digest(join(fit.model, 'model.npz')), manifest.modelSha256);
  assert.equal(manifest.calibration.mode, 'cross_fit');
  assert.equal(manifest.classBalance, false);
  const groups = scoreGroups(fit.model, calibration.threshold);
  assert.equal(groups.Indian.wrongCommitted + groups.foreign.wrongCommitted, calibration.wrongCommitted);
  assert.equal(calibration.wrongCommitted, 0, 'A4D_CROSS_FIT_WRONG_COMMITS');
  return {
    name: 'A4d one arm', model: fit.model, modelSha256: manifest.modelSha256, fitExamples: records.length,
    fitTargetCounts: targetCounts(records), threshold: calibration.threshold, pooledFields: calibration.n,
    wrongCommitted: calibration.wrongCommitted, correctPositiveCommitted: calibration.correctPositiveCommitted,
    perTargetPositives: Object.fromEntries(Object.entries(calibration.perTarget)
      .filter(([target]) => target !== 'unknown')),
    unknownCommitted: calibration.unknownCommitted, abstained: calibration.abstained, byFamilyGroup: groups,
  };
}

function heldOutReceipt(model: string, check: boolean) {
  const path = join(RUN, 'heldout-counts.json');
  if (check) return json(path); // No held-out working file is reopened by a lead-readable check.
  assert(!existsSync(join(ROOT, 'heldout/completed-v1')), 'A4D_HELDOUT_ALREADY_STARTED_NO_REPEAT');
  const counts = safeHeldOutCounts(model, join(ROOT, 'heldout/completed-v1'));
  const result = {
    scorable: { n: counts.n, total: { count: counts.total, n: counts.n },
      committed: { count: counts.committed, n: counts.n }, correct: { count: counts.committedCorrect, n: counts.n },
      abstained: { count: counts.abstained, n: counts.n } },
    nonScorable: { n: counts.nonScorable.n,
      committed: { count: counts.nonScorable.committed, n: counts.nonScorable.n } },
    profiles: { count: counts.profiles, n: counts.profiles },
    truthSha256: counts.truthSha256, manifestSha256: counts.manifestSha256,
    qualification: 'One frozen model/threshold; counts only, no accuracy claim and no tuning feedback.',
  };
  saveNew(path, result);
  return result;
}

function fallbackTriggers(records: RecordLabel[], correctPositiveCommitted: number) {
  const six = positiveCounts(records, SIX_TARGETS);
  const reach12 = Object.values(six).filter(count => count.columns >= 12).length;
  const tData = SIX_TARGETS.length - reach12 > SIX_TARGETS.length / 2;
  const positiveExamples = records.filter(record => record.example.target !== 'unknown').length;
  return { sixA4cTargets: six, everyVerifiedPositiveTarget: positiveCounts(records),
    sixTargetsReaching12: reach12, sixTargetsBelow12: SIX_TARGETS.length - reach12, tData,
    tMethod: tData ? null : correctPositiveCommitted === 0,
    tMethodStatus: tData ? 'not_evaluated_T_data_true' : 'evaluated_zero_wrong_cross_fit_commits',
    stageB: { verifiedPositiveExamples: positiveExamples, required: 300,
      shortfall: Math.max(0, 300 - positiveExamples) },
    fallbackWorkStarted: false };
}

function measure(check: boolean) {
  // Check both original label pins before any verification or fit.
  (['t1c', 't1d'] as Round[]).forEach(roundInputs);
  const checked = (['t1c', 't1d'] as Round[]).map(round => ({ round, verified: verifyRound(round, check) }));
  const records = fitRecords();
  const rounds = checked.map(({ round, verified }) => roundSummary(round, verified, records, check));
  const baseline = baselineRow();
  const fit = trainOnce(records, check);
  const a4d = fitRow(fit, records); // Development counts and fixed model pin are finalized before held-out.
  const dev = [...new Set(records.filter(record => record.link.split === 'dev')
    .map(record => record.link.family))].sort();
  const pool = [...new Set(records.filter(record => record.link.split === 'pool')
    .map(record => record.link.family))].sort();
  const result = {
    task: 'A4d', gates: ['GF-AGENT', 'FP-LEARN-TEST'], status: 'completed_one_arm_no_accuracy_claim',
    rounds, baseline, a4d,
    families: { dev, pool, foldCount: dev.length, poolPolicy: 'Remain in every fit; never folded.' },
    verifiedPositiveCounts: positiveCounts(records),
    fallbackTriggers: fallbackTriggers(records, a4d.correctPositiveCommitted),
    heldOut: heldOutReceipt(fit.model, check), freshFits: 1, heldOutRuns: 1, tuningAfterMeasurements: false,
    rule: { calibrationMode: 'cross_fit', classBalance: false, variants: 0, featuresChanged: false },
    inputsSha256: digest(join(INPUT, 'pseudo-labels.jsonl')), linksSha256: digest(join(INPUT, 'profile-links.jsonl')),
    labelsChanged: false, labelsProduced: 0, providerCalls: 0, runtimeChanged: false, gpuUsed: false,
    qualification: 'Pseudo-label agreement only. Zero pooled wrong commits is by threshold construction.',
  };
  if (check) assert.equal(stableHash(json(RESULT)), stableHash(result), 'A4D_COMPLETED_RESULT_CHANGED');
  else saveNew(RESULT, result);
  return result;
}

function main() {
  if (process.argv.includes('--blocked-check')) {
    const blocked = json<{ status: string }>(join(ROOT, 'measurements/result.json'));
    assert.equal(blocked.status, 'blocked_verifier_foreign_development_boundary');
    console.log(JSON.stringify({ status: blocked.status, historicalAttemptPreserved: true }));
    return;
  }
  const check = process.argv.includes('--check');
  assert(check || !existsSync(RESULT), 'A4D_RESULT_EXISTS_NO_OVERWRITE');
  const result = measure(check);
  console.log(JSON.stringify({ status: result.status, rounds: result.rounds, a4d: result.a4d,
    heldOut: result.heldOut, fallbackTriggers: result.fallbackTriggers }));
}

main();
