import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TabularChunkMapper, profileTabularChunk } from
  '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { markUnavailableCells } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-tabular';
import { readTabularSource } from '../../packages/server/src/modules/usp/ingestion/tabular-source';
import { TabularRawRowSchema } from '../../packages/contracts/src/usp';
import { manualTeacherPlan, mappingContextFromColumnProfile } from
  '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { rememberMapping } from '../../packages/server/src/modules/usp/ingestion/mapping-memory';
import { sha256 } from '../../packages/server/src/infrastructure/storage';
import { developmentManifest, sourceTables } from './t1-sources';
import { options } from './control-runtime';

const selection = { sheet: 'csv', headerRows: [1] };
function table(id: string) {
  const asset = developmentManifest().assets.find(item => item.id === id);
  assert(asset);
  return sourceTables(asset)[0];
}

function routing(memoryPath: string) {
  return { ...options(), memoryPath, teacher: async (profile: Parameters<typeof manualTeacherPlan>[0]) =>
    ({ ...manualTeacherPlan(profile, 'TEACHER_REPLAY_UNAVAILABLE'), attempts: 1 }) };
}

test('33 real rows retain one versioned layout, questions only once and changed headers miss', async () => {
  const source = table('mi-d10-02.csv');
  const memory = `E:/BhuAayam-data/task-data/a3d/controls/${randomUUID()}/accepted-plans.jsonl`;
  const mapper = new TabularChunkMapper();
  const drafts = [];
  for (let offset = 0; offset < source.rows.length; offset += 16) {
    drafts.push(await mapper.map({ jobId: randomUUID(), chunkIndex: offset / 16, headers: source.headers,
      rows: source.rows.slice(offset, offset + 16), sourceRef: 'control', selection }, routing(memory)));
  }
  assert.deepEqual(drafts.map(draft => draft.metrics.layout), ['new', 'memory', 'memory']);
  assert.deepEqual(drafts.map(draft => draft.questions.length), [16, 0, 0]);
  assert.deepEqual(drafts.map(draft => draft.metrics.needsInput), [16, 16, 16]);
  assert.equal(new Set(drafts.map(draft => draft.profile.layoutFingerprint)).size, 1);
  assert.equal(drafts[2].proposal.plan.layoutFingerprintVersion, 'tabular-header/2');
  const approved = { ...drafts[0].proposal.plan, method: 'reviewer:a3d-software-control' };
  const entry = rememberMapping(approved, mappingContextFromColumnProfile(drafts[0].profile, selection),
    { source: 'officer', method: approved.method, officerDecisionId: randomUUID() }, memory);
  assert.equal(entry.layoutFingerprintVersion, 'tabular-header/2');
  const second = table('mi-d10-03.csv');
  const result = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
    headers: second.headers, rows: second.rows, sourceRef: 'second', selection }, routing(memory));
  assert.equal(result.metrics.memoryHits, 1);
  assert.equal(result.metrics.teacherCalls, 0);
  assert.equal(result.questions.length, 0);
  const changed = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
    headers: ['Changed heading', ...second.headers.slice(1)], rows: second.rows, sourceRef: 'changed', selection },
  routing(memory));
  assert.equal(changed.metrics.layout, 'new');
});

test('legacy A3c memory is immutable and explicitly compatible at its exact CSV layout', async () => {
  const memory = 'E:/BhuAayam-data/runtime/ulpin-demo/tabular-learning/accepted-plans.jsonl';
  const before = sha256(readFileSync(memory));
  const source = table('mi-d10-03.csv');
  const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
    headers: source.headers, rows: source.rows, sourceRef: 'compatibility', selection }, routing(memory));
  assert.equal(draft.metrics.memoryHits, 1);
  assert.equal(draft.metrics.teacherCalls, 0);
  assert.equal(draft.questions.length, 0);
  assert.equal(draft.proposal.plan.layoutFingerprintVersion, 'tabular-header/2');
  assert.equal(sha256(readFileSync(memory)), before);
});

test('real native unknown cells keep needsInput honest without repeating annotated column questions', async () => {
  const asset = developmentManifest().assets.find(item => item.id === 'mi-d19-01.xlsx')!;
  const selected = { format: 'xlsx' as const, sheet: 'T_18', table: null, headerRows: [4, 5] };
  const source = readTabularSource(readFileSync(asset.original.externalPath), selected);
  const offsets = source.cellStates!.flatMap((states, index) => states.includes('unknown') ? [index] : []);
  const first = offsets[0];
  const second = offsets.find(index => index !== first &&
    JSON.stringify(source.cellStates![index]) === JSON.stringify(source.cellStates![first]));
  assert(second !== undefined, 'The real workbook must supply two equally unavailable cell-state layouts.');
  const mapper = new TabularChunkMapper();
  const prepared = profileTabularChunk({ jobId: randomUUID(), chunkIndex: 0, headers: source.headers,
    rows: [source.rows[first]], sourceRef: 'native-control', selection: selected });
  const approvedPlan = manualTeacherPlan(prepared.profile, 'MAPPING_REVIEW_REQUIRED').plan;
  for (const [chunkIndex, offset] of [first, second].entries()) {
    const draft = await mapper.map({ jobId: randomUUID(), chunkIndex, headers: source.headers,
      rows: [source.rows[offset]], sourceRef: 'native-control', selection: selected },
    { ...routing('E:/BhuAayam-data/task-data/a3d/controls/no-memory'), approvedPlan });
    const raw = TabularRawRowSchema.parse({ headers: source.headers, sheet: selected.sheet,
      sourceRow: source.sourceRows[offset], cells: source.cellStates![offset].map((state, column) =>
        state === 'literal' ? { state, value: source.rows[offset][column] } : { state }) });
    markUnavailableCells(draft, [raw]);
    mapper.deduplicateQuestions(draft);
    assert(draft.metrics.needsInput > 0);
    assert.equal(draft.questions.length, chunkIndex === 0 ? draft.metrics.needsInput : 0);
  }
});
