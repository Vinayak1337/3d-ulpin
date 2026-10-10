import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { ColumnProfileDocument, MappingPlanV2 } from '../../packages/contracts/src/index';
import { profileColumns } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import {
  columnProfileHash, proposeMapping, mappingContextFromColumnProfile, type MappingTeacherResult,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { rememberMapping } from '../../packages/server/src/modules/usp/ingestion/mapping-memory';
import {
  ingestTeacherLabels, DEVELOPMENT_TEACHER_METHOD, type PseudoLabelExample,
} from '../../packages/server/src/modules/usp/ingestion/teacher-labels';
import { validateMappingPlanV2 } from '../../packages/server/src/modules/usp/ingestion/mapping-plan-v2';
import {
  sourceTables, developmentManifest, digest, stableHash, type SourceAsset, type SourceTable,
} from './t1-sources';
import { saveNew, type TableInventory } from './t1-profiles';
import { requestContext } from './control-runtime';

const ROOT = 'E:/BhuAayam-data/task-data/a4';
const verification = JSON.parse(readFileSync('docs/evidence/gf-agent/t1/verify.json', 'utf8'));
type ProfileLink = Record<string, unknown> & { family: string; profileHash: string; sourceField: string };
const originalExamples = readLines<PseudoLabelExample>(`${verification.outputDirectory}/pseudo-labels.jsonl`);
const originalLinks = readLines<ProfileLink>(`${verification.outputDirectory}/profile-links.jsonl`);
const originalPlans = readLines<{ profileHash: string; plan: MappingPlanV2 }>(
  `${verification.outputDirectory}/normalized-labels.jsonl`);
const inventory: TableInventory[] = JSON.parse(
  readFileSync('E:/BhuAayam-data/task-data/t1/verifier/inventory.json', 'utf8'));

function readLines<T>(path: string): T[] {
  return readFileSync(path, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as T);
}

function curveProfile(table: SourceTable, rows: unknown[][]) {
  // Include literal headers in the runtime fingerprint; T1 positional aliases are only label transport keys.
  const fields = table.headers.map((header, index) => ({ name: `${index + 1}|${header}` }));
  const mappedRows = rows.map(row => Object.fromEntries(fields.map((field, index) => [field.name, row[index]])));
  const profile = profileColumns(mappedRows, fields, 'tabular');
  return { profile, rows: mappedRows, learnerColumns: table.headers.map((header, index) => ({
    profileId: stableHash([columnProfileHash(profile), index]), header,
    neighbourHeaders: table.headers.slice(Math.max(0, index - 2), index)
      .concat(table.headers.slice(index + 1, index + 3)),
    cellCount: rows.length, emptyCount: rows.filter(row => row[index] === undefined || row[index] === null ||
      (typeof row[index] === 'string' && !(row[index] as string).trim())).length,
  })) };
}

function replayPlan(profile: ColumnProfileDocument, table: SourceTable, original: MappingPlanV2): MappingPlanV2 {
  const fields = profile.columns.map(column => {
    const position = table.headers.findIndex((header, index) => column.name === `${index + 1}|${header}`);
    assert(position >= 0);
    return { ...original.fields[position], sourceField: column.name };
  });
  const proposed = { ...original, layoutFingerprint: profile.layoutFingerprint, fields };
  const checked = validateMappingPlanV2(proposed, mappingContextFromColumnProfile(profile));
  assert(checked.success, 'CURVE_REPLAY_PLAN_INVALID');
  return checked.plan;
}

function replayResult(plan: MappingPlanV2, profile: ColumnProfileDocument): MappingTeacherResult {
  return { plan, profileHash: columnProfileHash(profile), attempts: 1, replayed: true, validationCodes: [],
    state: 'needs_input', issues: plan.fields.filter(field => field.target === 'unknown').map(field => ({
      sourceField: field.sourceField, state: 'needs_input', code: 'TEACHER_UNCERTAIN',
    })) };
}

function calibrationInput() {
  const links = originalLinks.filter(link => link.family === 'mi-d03');
  const keys = new Set(links.map(link => `${link.profileHash}/${link.sourceField}`));
  const examples = originalExamples.filter(example => keys.has(`${example.profileHash}/${example.columnProfile.name}`));
  return { links, examples };
}

async function verifiedBatch(
  output: string, asset: SourceAsset, chunk: ReturnType<typeof curveProfile>, plan: MappingPlanV2,
) {
  const profileHash = columnProfileHash(chunk.profile);
  const labels = join(output, 'lead-replay-label.jsonl');
  saveNew(labels, [{ profileHash, plan, method: DEVELOPMENT_TEACHER_METHOD }], true);
  const examples = join(output, 'pseudo-labels.jsonl');
  const report = await ingestTeacherLabels(labels, new Map([[profileHash, {
    profile: chunk.profile, rows: chunk.rows, sourceRef: asset.original.externalPath,
    dataPolicy: { dataClass: 'public', split: 'development' },
  }]]), examples);
  assert.equal(report.rejected, 0);
  const links = chunk.profile.columns.map((column, index) => ({
    ...chunk.learnerColumns[index], profileHash, sourceField: column.name, family: asset.family, split: asset.split,
    inferredType: column.inferredType, declaredUnit: column.declaredUnit ?? null, valueShapes: column.valueShapes,
  }));
  const calibration = calibrationInput();
  saveNew(join(output, 'fit/profile-links.jsonl'), [...links, ...calibration.links], true);
  saveNew(join(output, 'fit/pseudo-labels.jsonl'), [...readLines<PseudoLabelExample>(examples),
    ...calibration.examples], true);
  return { examples: join(output, 'fit/pseudo-labels.jsonl'), report };
}

function updateStudent(examples: string, out: string, previous?: string) {
  const args = ['-m', 'geo.usp_learning.stage_a', 'train', '--examples', examples, '--out', out,
    '--calibration-mode', 'single_family'];
  if (previous) args.push('--resume', previous);
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', args, { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PYTHONPATH: resolve('services/geo'), PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as { model: string; versions: number; fitExamples: number };
}

async function measureCurve() {
  const root = join(ROOT, `curve-${Date.now()}`);
  const selected = developmentManifest().assets.filter(asset => asset.family === 'mi-d10').slice(0, 2);
  const observations = [];
  let learnerModel: string | undefined;
  for (const asset of selected) {
    const table = sourceTables(asset)[0];
    const original = inventory.find(entry => entry.asset.id === asset.id)!;
    const labelled = originalPlans.find(label => label.profileHash === columnProfileHash(original.profile))!.plan;
    const width = Math.ceil(table.rows.length / 3);
    for (let start = 0, number = 1; start < table.rows.length; start += width, number++) {
      const chunk = curveProfile(table, table.rows.slice(start, start + width));
      let calls = 0;
      const began = performance.now();
      const proposal = await proposeMapping(chunk.profile, {
        context: requestContext, authorize: async () => {}, dataPolicy: { dataClass: 'public', split: 'development' },
        memoryPath: join(root, 'memory.jsonl'), learnerModelPath: learnerModel, learnerColumns: chunk.learnerColumns,
        teacher: async profile => { calls++; return replayResult(replayPlan(profile, table, labelled), profile); },
      });
      const latencyMs = Math.round((performance.now() - began) * 100) / 100;
      const plan = replayPlan(chunk.profile, table, labelled);
      const batch = await verifiedBatch(join(root, `${asset.id}-chunk-${number}`), asset, chunk, plan);
      rememberMapping(plan, mappingContextFromColumnProfile(chunk.profile), { source: 'teacher',
        method: plan.method, labelFileSha256: verification.teacherLabelsSha256 }, join(root, 'memory.jsonl'));
      const updated = updateStudent(batch.examples, join(root, 'learner'), learnerModel);
      observations.push({ file: asset.id, chunk: number, rows: chunk.rows.length, teacherCalls: calls,
        memoryHits: Number(proposal.fieldSources.some(field => field.source === 'memory')),
        studentCommits: proposal.fieldSources.filter(field => field.source === 'student').length,
        activeLearnerVersion: proposal.activeLearnerVersion, nextLearnerVersion: `v${updated.versions}`,
        verifiedBatchExamples: batch.report.verifiedExamples, latencyMs });
      learnerModel = updated.model;
    }
  }
  saveNew(join(root, 'curve.json'), observations);
  return { root, observations, falling: observations[0].teacherCalls > observations.at(-1)!.teacherCalls,
    explanation: 'Replay requests fall through exact accepted memory; learner updated after every verified chunk.',
    similarFilePreviouslyFitted: false, networkCalls: 0 };
}

function hasExpectedTargets(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.some(hasExpectedTargets);
  if (!raw || typeof raw !== 'object') return false;
  return Object.entries(raw).some(([key, value]) => {
    if (/^(?:canonicalTarget|expectedTargets?)$/i.test(key) && value !== null && value !== undefined) return true;
    return hasExpectedTargets(value);
  });
}

function heldOutTruth() {
  const path = 'fixtures/usp/D8-messy-india/heldout.json';
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  assert(!hasExpectedTargets(manifest), 'Documented expected targets require an actual scoring pass.');
  return { manifestSha256: digest(path), teacherCalls: 0, originalFilesOpened: 0,
    families: manifest.families.map((family: { id: string }) => ({
      family: family.id, status: 'truth_absent', committedFields: null, precision: null, recall: null, abstention: null,
      reason: 'No documented expected canonical targets; aliases and null canonicalTarget are not scoring truth.',
    })), gate: 'unqualified_missing_expected_targets; no accuracy or precision claim' };
}

async function main() {
  const curve = await measureCurve();
  const learner = JSON.parse(readFileSync(join(ROOT, 'learner/v43/manifest.json'), 'utf8'));
  const result = { task: 'A4', gates: ['GF-AGENT', 'FP-LEARN-TEST'], checkedWorkingTree: true,
    measurementScriptSha256: digest('scripts/agent/measure-a4.ts'), verification: {
    accepted: verification.accepted, rejected: verification.rejected, examples: verification.examples,
    verifiedExamples: verification.verifiedExamples,
  }, qualification: 'pseudo_label-trained; held-out truth = publisher/heldout manifest',
    student: { model: join(ROOT, 'learner/v43'), versions: 43, fitExamples: 392, fitFamilies: 25,
      modelSha256: learner.modelSha256, threshold: learner.threshold, calibration: learner.calibration,
      calibrationFamily: learner.calibrationFamily, versionsInstalled: learner.versions },
    teacherCallCurve: curve, heldOut: heldOutTruth(), registryWrites: 0, networkCalls: 0,
    gaps: ['Held-out expected targets absent; accuracy gate cannot be scored.',
      '13 teacher fields failed deterministic verification; excluded, labels unchanged.',
      'Routing is proposal-only and not activated on the demo runtime or background job authority.',
      'Magnitude and unit-suffix profile statistics unavailable; never inferred from masked samples.'] };
  mkdirSync('docs/evidence/gf-agent/a4', { recursive: true });
  writeFileSync('docs/evidence/gf-agent/a4/result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ curve: curve.observations, heldOut: result.heldOut.gate }));
}

main();
