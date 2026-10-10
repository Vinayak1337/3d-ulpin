import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveNew } from './t1-profiles';
import { agreement, python, readLines, safeHeldOutCounts, targetCounts, verifiedRecords } from './measure-a4b';
import type { RecordLabel } from './measure-a4b';

type Arm = 'B' | 'C';
type Score = { profileId: string; family: string; expectedTarget: string; predictedTarget: string; confidence: number };
type PerTarget = { n: number; committed: number; committedCorrect: number; wrongCommitted: number; abstained: number };
export type ArmMetrics = {
  threshold: number | null; wrongCommitted: number; correctPositiveCommitted: number; unknownCommitted: number;
  abstained: number; n: number; perTarget: Record<string, PerTarget>;
};
type TrainedArm = { model: string; calibration: ArmMetrics };
type Prediction = { profileId: string; target: string; committed: boolean };

const ROOT = 'E:/BhuAayam-data/task-data/a4c';
const A4B_ROOT = 'E:/BhuAayam-data/task-data/a4b';
const ARM_FLAGS: Record<Arm, string[]> = { B: ['--no-class-balance'], C: ['--class-balance'] };

function trainArm(arm: Arm): TrainedArm {
  return JSON.parse(python(['-m', 'geo.usp_learning.stage_a', 'train', '--examples',
    join(ROOT, 'inputs/pseudo-labels.jsonl'), '--out', join(ROOT, `arm-${arm}`),
    '--calibration-mode', 'cross_fit', ...ARM_FLAGS[arm]]));
}

function pooledWrongCommits(arm: Arm, threshold: number | null): number {
  const scores = JSON.parse(readFileSync(join(ROOT, `arm-${arm}`, 'cross-fit-scores.json'), 'utf8')) as Score[];
  if (threshold === null) return 0;
  return scores.filter(score => score.confidence >= threshold && score.predictedTarget !== score.expectedTarget).length;
}

function positiveTargets(perTarget: Record<string, PerTarget>) {
  return Object.fromEntries(Object.entries(perTarget).filter(([target]) => target !== 'unknown'));
}

function armRow(arm: Arm, trained: TrainedArm) {
  const { calibration } = trained;
  const wrongRecomputed = pooledWrongCommits(arm, calibration.threshold);
  assert.equal(wrongRecomputed, calibration.wrongCommitted, 'A4C_POOLED_WRONG_COMMITS_DISAGREE');
  return {
    arm, model: trained.model, threshold: calibration.threshold, pooledFields: calibration.n,
    wrongCommitted: wrongRecomputed, correctPositiveCommitted: calibration.correctPositiveCommitted,
    perTargetPositives: positiveTargets(calibration.perTarget),
    unknownCommitted: calibration.unknownCommitted, abstained: calibration.abstained,
  };
}

function baselineFold(records: RecordLabel[], family: string) {
  const root = join(A4B_ROOT, 'leave-one-family-out', family);
  const predictions = readLines<Prediction>(join(root, 'test/predictions.jsonl'));
  const test = records.filter(record => record.link.family === family);
  assert.equal(test.length, predictions.length);
  return {
    family, n: test.length, perTarget: agreement(test, predictions),
    wrongCommitted: test.filter((record, index) => predictions[index].committed &&
      predictions[index].target !== record.example.target).length,
    unknownCommitted: predictions.filter(prediction => prediction.committed && prediction.target === 'unknown').length,
    abstained: predictions.filter(prediction => !prediction.committed).length,
  };
}

function baselineRow(records: RecordLabel[]) {
  const recorded = JSON.parse(readFileSync('docs/evidence/gf-agent/a4b/result.json', 'utf8'));
  const folds = (recorded.leaveOneFamilyOut as { family: string; threshold: number | null }[])
    .map(fold => ({ ...baselineFold(records, fold.family), threshold: fold.threshold }));
  return {
    arm: 'baseline', model: recorded.model, threshold: recorded.threshold,
    qualification: 'A4b as merged: one calibration family; recorded folds only, no refit.',
    foldCount: folds.length, foldFields: folds.reduce((sum, fold) => sum + fold.n, 0),
    wrongCommitted: folds.reduce((sum, fold) => sum + fold.wrongCommitted, 0),
    correctPositiveCommitted: Object.values(recorded.leaveOneFamilyOutTotals as Record<string, PerTarget>)
      .reduce((sum, count) => sum + count.committedCorrect, 0),
    unknownCommitted: folds.reduce((sum, fold) => sum + fold.unknownCommitted, 0),
    abstained: folds.reduce((sum, fold) => sum + fold.abstained, 0), folds,
  };
}

function chooseArm(rows: ReturnType<typeof armRow>[]) {
  const eligible = rows.filter(row => row.wrongCommitted === 0);
  if (!eligible.length) return null;
  const best = Math.max(...eligible.map(row => row.correctPositiveCommitted));
  return eligible.find(row => row.correctPositiveCommitted === best)!;
}

function main() {
  const records = verifiedRecords();
  saveNew(join(ROOT, 'inputs/pseudo-labels.jsonl'), records.map(record => record.example), true);
  saveNew(join(ROOT, 'inputs/profile-links.jsonl'), records.map(record => record.link), true);
  const arms = (['B', 'C'] as Arm[]).map(arm => armRow(arm, trainArm(arm)));
  const chosen = chooseArm(arms);
  const result = {
    task: 'A4c', gates: ['GF-AGENT', 'FP-LEARN-TEST'],
    qualification: 'Pseudo-label agreement, not teacher-label accuracy. Pooled wrong commits are zero by construction.',
    fitExamples: records.length, fitTargetCounts: targetCounts(records),
    baseline: baselineRow(records), arms,
    chosen: chosen ? chosen.arm : 'baseline',
    heldOut: chosen ? safeHeldOutCounts(chosen.model, join(ROOT, `heldout-${chosen.arm}`)) : null,
    tuningAfterMeasurements: false, teacherCalls: 0, providerCalls: 0, labelsChanged: false, runtimeChanged: false,
  };
  saveNew(join(ROOT, 'measurements/result.json'), result);
  console.log(JSON.stringify({ baseline: { ...result.baseline, folds: undefined }, arms, chosen: result.chosen,
    heldOut: result.heldOut }));
}

main();
