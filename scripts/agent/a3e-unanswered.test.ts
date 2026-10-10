import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TabularChunkResultSchema } from '../../packages/contracts/src/usp/index';
import { TabularChunkMapper, type TabularChunkDraft } from
  '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { lookupMappingMemory, rememberMapping } from '../../packages/server/src/modules/usp/ingestion/mapping-memory';
import {
  MAPPING_TEACHER_METHOD, manualMappingMethod, mappingContextFromColumnProfile, proposeMappingWithTeacher,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { ModelGateway } from '../../packages/server/src/modules/model-gateway/gateway';
import { ControlAdapter, ReplayAdapter } from '../../packages/server/src/modules/model-gateway/adapter';
import { TeacherRecordings } from '../../packages/server/src/modules/model-gateway/recordings';
import { ControlLedger, controlConfig, options, unknownResponse } from './control-runtime';
import { developmentManifest, sourceTables } from './t1-sources';

const selection = { sheet: 'csv', headerRows: [1] };
const studentModel = 'E:/BhuAayam-data/task-data/a4/learner/v43';
const memoryPath = () => `E:/BhuAayam-data/task-data/a3e/controls/${randomUUID()}/accepted-plans.jsonl`;

function table(id: string) {
  const asset = developmentManifest().assets.find(item => item.id === id);
  assert(asset, 'Real development source must be manifest-authorized.');
  return sourceTables(asset)[0];
}

function chunk(source: ReturnType<typeof table>, jobId: string, index: number, size = 13) {
  return { jobId, chunkIndex: index, headers: source.headers, selection, sourceRef: 'a3e-control',
    rows: source.rows.slice(index * size, (index + 1) * size) };
}

function parsedResult(draft: TabularChunkDraft) {
  return TabularChunkResultSchema.parse({ profile: draft.profile, plan: draft.proposal.plan,
    fieldSources: draft.proposal.fieldSources, questions: draft.questions, metrics: draft.metrics,
    sourceRows: draft.dryRun.rows.map((_, index) => index + 1), rows: draft.dryRun.rows });
}

test('no teacher: the plan names the fallback, every field is unanswered and later chunks stay so', async () => {
  const source = table('mi-d10-01.csv');
  const mapper = new TabularChunkMapper();
  const jobId = randomUUID();
  let calls = 0;
  const routing = { ...options(), memoryPath: memoryPath(), teacher: async (
    ...args: Parameters<typeof proposeMappingWithTeacher>
  ) => {
    calls++;
    return proposeMappingWithTeacher(...args);
  } };
  const first = await mapper.map(chunk(source, jobId, 0), routing);
  const method = manualMappingMethod('TEACHER_UNAVAILABLE');
  assert.equal(first.proposal.plan.method, method);
  assert.notEqual(first.proposal.plan.method, MAPPING_TEACHER_METHOD);
  assert(first.proposal.fieldSources.every(field => field.source === 'unanswered' && field.method === method));
  assert.equal(first.metrics.teacherFields, 0);
  assert.equal(first.metrics.unansweredFields, source.headers.length);
  assert.equal(first.metrics.teacherCalls, 0);
  assert.equal(first.questions.length, source.headers.length);
  assert(first.questions.every(question => question.reason === 'TEACHER_UNAVAILABLE'));
  parsedResult(first);
  const later = await mapper.map(chunk(source, jobId, 1), routing);
  assert.equal(calls, 1);
  assert.equal(later.metrics.teacherCalls, 0);
  assert.equal(later.metrics.layout, 'memory');
  assert.equal(later.metrics.teacherFields, 0);
  assert.equal(later.metrics.unansweredFields, source.headers.length);
  assert(later.proposal.fieldSources.every(field => field.source === 'unanswered'));
  assert.equal(later.questions.length, 0);
  parsedResult(later);
});

test('a teacher answer replayed from a recording keeps source teacher and the real method', async () => {
  const source = table('mi-d10-01.csv');
  const recordings = new TeacherRecordings(mkdtempSync(join(tmpdir(), 'a3e-replay-')));
  const live = new ModelGateway(controlConfig(), new ControlLedger(),
    new ControlAdapter(async request => unknownResponse(request)));
  const recorded = await new TabularChunkMapper().map(chunk(source, randomUUID(), 0),
    { ...options(live), memoryPath: memoryPath(), recordings });
  const replay = new ModelGateway(controlConfig(), new ControlLedger(),
    new ReplayAdapter(key => recordings.replay(key)));
  const draft = await new TabularChunkMapper().map(chunk(source, randomUUID(), 0),
    { ...options(replay), memoryPath: memoryPath() });
  assert.deepEqual(draft.proposal.plan, recorded.proposal.plan);
  assert.equal(draft.proposal.plan.method, MAPPING_TEACHER_METHOD);
  assert.equal(draft.proposal.replayed, true);
  assert(draft.proposal.fieldSources.every(field =>
    field.source === 'teacher' && field.method === MAPPING_TEACHER_METHOD));
  assert.equal(draft.metrics.teacherFields, source.headers.length);
  assert.equal(draft.metrics.unansweredFields, 0);
  assert.equal(draft.metrics.teacherCalls, 1);
});

test('student answers stay student when the teacher part fails; the rest is unanswered', async () => {
  const source = table('mi-d11-01.csv');
  const routing = { ...options(), memoryPath: memoryPath(), learnerModelPath: studentModel };
  const mapper = new TabularChunkMapper();
  const jobId = randomUUID();
  const draft = await mapper.map(chunk(source, jobId, 0, 10), routing);
  const students = draft.proposal.fieldSources.filter(field => field.source === 'student');
  const unanswered = draft.proposal.fieldSources.filter(field => field.source === 'unanswered');
  assert(students.length > 0 && unanswered.length > 0, 'The real student must commit some columns, not all.');
  assert.equal(students.length + unanswered.length, source.headers.length);
  assert.equal(draft.metrics.studentFields, students.length);
  assert.equal(draft.metrics.teacherFields, 0);
  assert.equal(draft.metrics.unansweredFields, unanswered.length);
  assert(unanswered.every(field => field.method === manualMappingMethod('TEACHER_UNAVAILABLE')));
  const asked = new Set(draft.questions.filter(question => question.reason === 'TEACHER_UNAVAILABLE')
    .map(question => question.sourceField));
  assert.deepEqual([...asked].sort(), unanswered.map(field => field.sourceField).sort());
  parsedResult(draft);
  const later = await mapper.map(chunk(source, jobId, 1, 10), routing);
  assert.equal(later.metrics.teacherCalls, 0);
  assert.deepEqual(later.proposal.fieldSources.map(field => field.source),
    draft.proposal.fieldSources.map(field => field.source === 'student' ? 'memory' : field.source));
});

test('chunks and memory written before the change still parse and read as stored', async () => {
  const source = table('mi-d10-01.csv');
  const draft = await new TabularChunkMapper().map(chunk(source, randomUUID(), 0),
    { ...options(), memoryPath: memoryPath() });
  const { unansweredFields: _omitted, ...oldMetrics } = draft.metrics;
  const oldPlan = { ...draft.proposal.plan, method: MAPPING_TEACHER_METHOD };
  const stored = { ...parsedResult(draft), metrics: oldMetrics, plan: oldPlan,
    fieldSources: draft.proposal.fieldSources.map(field => ({
      ...field, source: 'teacher', method: MAPPING_TEACHER_METHOD })) };
  const read = TabularChunkResultSchema.parse(JSON.parse(JSON.stringify(stored)));
  assert.equal(read.metrics.unansweredFields, undefined);
  assert(read.fieldSources.every(field => field.source === 'teacher'));
  const path = memoryPath();
  const context = mappingContextFromColumnProfile(draft.profile, selection);
  rememberMapping(oldPlan, context, { source: 'teacher', method: MAPPING_TEACHER_METHOD,
    labelFileSha256: 'c'.repeat(64) }, path);
  const looked = lookupMappingMemory(draft.profile.layoutFingerprint, context, path);
  assert(looked.plan);
  assert.equal(looked.lineage?.source, 'teacher');
});

test('memory refuses a manual fallback plan under either lineage', async () => {
  const source = table('mi-d10-01.csv');
  const draft = await new TabularChunkMapper().map(chunk(source, randomUUID(), 0),
    { ...options(), memoryPath: memoryPath() });
  const plan = draft.proposal.plan;
  const context = mappingContextFromColumnProfile(draft.profile, selection);
  const path = memoryPath();
  assert.equal(plan.method, manualMappingMethod('TEACHER_UNAVAILABLE'));
  assert.throws(() => rememberMapping(plan, context,
    { source: 'teacher', method: plan.method, labelFileSha256: 'd'.repeat(64) }, path));
  assert.throws(() => rememberMapping(plan, context,
    { source: 'officer', method: plan.method, officerDecisionId: randomUUID() }, path));
  assert.equal(lookupMappingMemory(draft.profile.layoutFingerprint, context, path).plan, null);
});
