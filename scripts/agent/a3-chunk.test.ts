import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { CANONICAL_TARGETS, type ColumnProfileDocument } from '../../packages/contracts/src/index';
import { CaseIngestionOutboxSchema } from '../../packages/contracts/src/usp/index';
import { TabularChunkMapper } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { manualTeacherPlan } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { appendCaseIngestionTx } from '../../packages/server/src/modules/usp/ingestion/events';
import { options } from './control-runtime';
import { developmentManifest, sourceTables } from './t1-sources';

const memoryPath = () => `E:/BhuAayam-data/task-data/a3/controls/missing-${randomUUID()}.jsonl`;
const asset = (id: string) => {
  const selected = developmentManifest().assets.find(entry => entry.id === id);
  assert(selected, 'Real development source must be manifest-authorized.');
  return selected;
};

test('real CSV chunks reuse a validated layout, retain questions and never claim officer approval', async () => {
  const table = sourceTables(asset('mi-d10-01.csv'))[0];
  const mapper = new TabularChunkMapper();
  const jobId = randomUUID();
  let calls = 0;
  const routing = { ...options(), memoryPath: memoryPath(), teacher: async (profile: ColumnProfileDocument) => {
    calls++;
    return { ...manualTeacherPlan(profile, 'TEACHER_REPLAY_UNAVAILABLE'), attempts: 1, replayed: true };
  } };
  const first = await mapper.map({ jobId, chunkIndex: 0, headers: table.headers,
    rows: table.rows.slice(0, 13), sourceRef: asset('mi-d10-01.csv').original.externalPath }, routing);
  const later = await mapper.map({ jobId, chunkIndex: 1, headers: table.headers,
    rows: table.rows.slice(13, 26), sourceRef: asset('mi-d10-01.csv').original.externalPath }, routing);
  assert.equal(calls, 1);
  assert.equal(first.metrics.teacherCalls, 1);
  assert.equal(later.metrics.teacherCalls, 0);
  assert.equal(later.metrics.layout, 'memory');
  assert.equal(later.questions.length, 0);
  assert.equal(later.metrics.needsInput, table.headers.length);
  assert(later.proposal.fieldSources.every(field => field.source === 'memory'));
  CaseIngestionOutboxSchema.parse({ version: 'case-ingestion/1', caseId: randomUUID(),
    caseRevision: 0, change: later.metrics });
});

test('difficult real duplicate-header CSV remains positional and held-out policy denies teacher dispatch', async () => {
  const table = sourceTables(asset('mi-d11-01.csv'))[0];
  let calls = 0;
  const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
    headers: table.headers, rows: table.rows.slice(0, 10), sourceRef: asset('mi-d11-01.csv').original.externalPath }, {
    ...options(), memoryPath: memoryPath(), dataPolicy: { dataClass: 'public', split: 'held_out' },
    teacher: async profile => {
      calls++;
      return manualTeacherPlan(profile, 'TEACHER_UNAVAILABLE');
    },
  });
  assert.equal(calls, 0);
  assert.equal(new Set(draft.profile.columns.map(column => column.name)).size, table.headers.length);
  assert(draft.questions.every(question => question.reason === 'TEACHER_DATA_DENIED'));
  assert.equal(draft.proposal.state, 'needs_input');
});

test('mapping.chunk follows the existing transactional outbox path without rows or literal headers', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'a3-software-control';
  const change = { kind: 'mapping.chunk' as const, jobId: randomUUID(), chunkIndex: 0,
    layout: 'new' as const, teacherCalls: 1, memoryHits: 0, studentFields: 0, teacherFields: 16,
    needsInput: 16, latencyMs: 1, learnerVersion: null };
  const written: unknown[] = [];
  const client = { query: async (sql: string, parameters: unknown[]) => {
    if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 0 }] };
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: '1' }] };
    if (sql.startsWith('INSERT INTO usp_outbox(')) written.push(parameters[2]);
    return { rows: [] };
  } } as unknown as PoolClient;
  await appendCaseIngestionTx(client, randomUUID(), change);
  assert.equal(written.length, 1);
  assert.deepEqual(CaseIngestionOutboxSchema.parse(written[0]).change, change);
  assert(Buffer.byteLength(JSON.stringify(written[0])) < 1024);
});

test('Stage A regex-derived classes exactly match the TS contract; skipped or reformatted keys fail loudly', () => {
  const code = 'import json; from geo.usp_learning.stage_a import canonical_targets; ' +
    'print(json.dumps(canonical_targets()))';
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', ['-c', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PYTHONPATH: resolve('services/geo'), PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).sort(), Object.keys(CANONICAL_TARGETS).sort(),
    'STAGE_A_CONTRACT_LAYOUT_CHANGED: regex skipped a canonical key; update extraction before fitting.');
});
