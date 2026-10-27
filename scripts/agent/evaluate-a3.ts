import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { profileColumns } from '../../packages/server/src/modules/usp/ingestion/column-profile';
import { MAPPING_MEMORY_PATH } from '../../packages/server/src/modules/usp/ingestion/mapping-memory';
import {
  proposeMapping, executeTeacherMappingDryRun, mappingContextFromColumnProfile, manualTeacherPlan,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { requestContext } from './control-runtime';
import { digest, nativeTable, type NativePart, type SourceTable } from './t1-sources';
import { saveNew } from './t1-profiles';

const ROOT = 'E:/BhuAayam-data/task-data/a3';
const MODEL = 'E:/BhuAayam-data/task-data/a4/learner/v43';
const HELDOUT = 'fixtures/usp/D8-messy-india/heldout.json';
type Truth = { family: string; file: string; sheet: string; sourceField: string; header: string;
  expectedTarget: string; operation: unknown };
type Asset = { id: string; family: string; original: { externalPath: string; sha256: string };
  columns?: { name: string }[];
  sourceSchemas?: { worksheetName: string; headerRows: number[] }[] };
type Decision = { truth: Truth; target: string | null; committed: boolean; issues: string[]; source?: string };

function loadFrozen() {
  const freeze = JSON.parse(readFileSync('docs/evidence/gf-agent/a3/heldout-truth-freeze.json', 'utf8'));
  assert.equal(digest(freeze.path), freeze.sha256, 'A3_FROZEN_TRUTH_CHANGED');
  assert.equal(digest(HELDOUT), freeze.manifestSha256, 'A3_HELDOUT_MANIFEST_CHANGED');
  const truth: Truth[] = readFileSync(freeze.path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const assets: Asset[] = JSON.parse(readFileSync(HELDOUT, 'utf8')).assets;
  assert.equal(truth.length, freeze.columns);
  return { truth, assets, freeze };
}

function evaluatorTables(asset: Asset): SourceTable[] {
  assert.equal(digest(asset.original.externalPath), asset.original.sha256, 'A3_HELDOUT_SOURCE_CHANGED');
  if (asset.columns) {
    const raw = JSON.parse(readFileSync(asset.original.externalPath, 'utf8'));
    return [{ name: 'attributes', headers: asset.columns.map(column => column.name), headerRows: [],
      headerLocators: asset.columns.map(() => []), rows: raw.features.map((feature: {
        attributes: Record<string, unknown>;
      }) => asset.columns!.map(column => feature.attributes[column.name])) }];
  }
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', [resolve('scripts/agent/read_workbook_cells.py'),
    resolve('services/geo'), asset.original.externalPath], { encoding: 'utf8', timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (run.status !== 0) throw new Error('A3_NATIVE_READER_BOUNDED_ABSTENTION');
  const parts = JSON.parse(run.stdout).parts as NativePart[];
  return asset.sourceSchemas!.map(schema => nativeTable(schema.worksheetName, parts, {
    sourceSchema: { headerRows: schema.headerRows },
  }));
}

async function evaluateTable(asset: Asset, table: SourceTable, truth: Truth[], teacherCounter: { calls: number }) {
  const fields = table.headers.map((header, index) => ({ name: `${index + 1}|${header}` }));
  const rows = table.rows.map(row => Object.fromEntries(fields.map((field, index) => [field.name, row[index]])));
  const profile = profileColumns(rows, fields, asset.columns ? 'gis_attributes' : 'tabular');
  const proposal = await proposeMapping(profile, { context: requestContext, authorize: async () => {},
    dataPolicy: { dataClass: 'public', split: 'held_out' }, memoryPath: MAPPING_MEMORY_PATH,
    learnerModelPath: MODEL, learnerColumns: table.headers.map((header, index) => ({
      header, profileId: `${asset.id}/${table.name}/${index + 1}`,
      neighbourHeaders: table.headers.slice(Math.max(0, index - 2), index)
        .concat(table.headers.slice(index + 1, index + 3)),
      cellCount: rows.length, emptyCount: table.rows.filter(row => row[index] === undefined || row[index] === null ||
        (typeof row[index] === 'string' && !(row[index] as string).trim())).length,
    })), teacher: async supplied => {
      teacherCounter.calls++;
      return manualTeacherPlan(supplied, 'TEACHER_DATA_DENIED');
    } });
  const dry = executeTeacherMappingDryRun(proposal, rows, {
    ...mappingContextFromColumnProfile(profile), sourceRef: asset.original.externalPath,
  });
  return truth.map((expected, index): Decision => {
    const field = proposal.plan.fields.find(field => field.sourceField === fields[index].name);
    assert(field, 'A3_EVALUATOR_COLUMN_ALIGNMENT');
    const issues = [...new Set([...proposal.issues.filter(issue => issue.sourceField === field.sourceField)
      .map(issue => issue.code), ...dry.rows.flatMap(row => row.fields.filter(cell =>
        cell.sourceField === field.sourceField && cell.issueCode).map(cell => cell.issueCode!))])];
    return { truth: expected, target: field.target,
      committed: field.target !== 'unknown' && field.confidence >= 0.5 && issues.length === 0,
      issues, source: proposal.fieldSources.find(source => source.sourceField === field.sourceField)?.source };
  });
}

function familyGate(committed: number, scored: number, precision: number | null) {
  if (committed === 0) return 'abstained';
  if (precision === 1 && scored === committed) return 'precision_pass';
  return 'unqualified_or_incorrect';
}

function familyMetrics(family: string, decisions: Decision[], readerIssue: string | null) {
  const scorable = decisions.filter(decision => decision.truth.expectedTarget !== 'truth_absent');
  const committed = decisions.filter(decision => decision.committed);
  const scored = scorable.filter(decision => decision.committed);
  const correct = scored.filter(decision => decision.target === decision.truth.expectedTarget);
  const positiveTruth = scorable.filter(decision => decision.truth.expectedTarget !== 'unknown');
  const precision = scored.length ? correct.length / scored.length : null;
  const recall = positiveTruth.length ? correct.length / positiveTruth.length : null;
  return { family, columns: decisions.length, scorable: scorable.length,
    truthAbsent: decisions.length - scorable.length, positiveTruth: positiveTruth.length,
    committedFields: committed.length, scoredCommittedFields: scored.length, correctCommittedFields: correct.length,
    unscoredCommittedFields: committed.length - scored.length, precision, recall,
    abstention: (decisions.length - committed.length) / decisions.length, readerIssue,
    gate: familyGate(committed.length, scored.length, precision) };
}

async function main() {
  const frozen = loadFrozen();
  const output = join(ROOT, `evaluation-${randomUUID()}`);
  const teacherCounter = { calls: 0 };
  const modelHash = digest(join(MODEL, 'model.npz'));
  const families = [];
  const allDecisions: Decision[] = [];
  for (const asset of frozen.assets) {
    const truth = frozen.truth.filter(line => line.file === asset.id);
    let readerIssue: string | null = null;
    let decisions: Decision[];
    try {
      decisions = [];
      for (const table of evaluatorTables(asset)) {
        const selected = truth.filter(line => line.sheet === table.name);
        assert.equal(selected.length, table.headers.length, 'A3_EVALUATOR_TABLE_WIDTH');
        decisions.push(...await evaluateTable(asset, table, selected, teacherCounter));
      }
    } catch (error) {
      if (!(error instanceof Error && error.message === 'A3_NATIVE_READER_BOUNDED_ABSTENTION')) throw error;
      readerIssue = error.message;
      decisions = truth.map(line => ({ truth: line, target: null, committed: false, issues: [readerIssue!] }));
    }
    assert.equal(decisions.length, truth.length);
    families.push(familyMetrics(asset.family, decisions, readerIssue));
    allDecisions.push(...decisions);
  }
  assert.equal(teacherCounter.calls, 0, 'Held-out teacher dispatch is forbidden.');
  assert.equal(digest(join(MODEL, 'model.npz')), modelHash);
  saveNew(join(output, 'decisions.jsonl'), allDecisions, true);
  const result = { output, truthSha256: frozen.freeze.sha256, modelSha256: modelHash, modelVersion: 'v43',
    families, teacherCalls: 0, memoryWrites: 0, learnerUpdates: 0, registryWrites: 0,
    gate: families.every(family => family.gate === 'abstained' || family.gate === 'precision_pass')
      ? 'abstention_or_precision_pass' : 'unqualified',
    qualification: 'No positive documented truth; zero committed fields is abstention, not positive accuracy.' };
  saveNew(join(output, 'result.json'), result);
  writeFileSync('docs/evidence/gf-agent/a3/heldout.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ families, teacherCalls: 0, gate: result.gate }));
}

main();
