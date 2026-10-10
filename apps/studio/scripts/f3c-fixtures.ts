/**
 * Intercepted UI controls for F3c: table jobs whose columns nobody answered, a mixed job and an old-shape job.
 * They are built from the real offline F3a mapping of mi-d10-02.csv with the field sources and learner counts
 * changed as the published contract now allows; nothing here is a live record.
 * Run: npx tsx apps/studio/scripts/f3c-fixtures.ts
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContractValidator } from '../src/local/contract';

// The three jobs carry full row payloads (about 1.7 MB); they stay outside Git and are rebuilt by this script.
const out = resolve('E:/BhuAayam-data/task-data/f3c-ui');
const TABLE_ROUTE = 'ingestion_cases_caseId_sources_sourceId';
const MAPPING_SCHEMA = `POST_${TABLE_ROUTE}_chunk_mapping_Response_202_application_json`;
const CHUNK_SCHEMA = `GET_${TABLE_ROUTE}_chunk_mapping_jobs_jobId_chunks_chunkIndex_Response_200_application_json`;
const CHUNKS = 3;
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const f3a = JSON.parse(readFileSync('docs/evidence/gf1/ui/f3a/table-responses.json', 'utf8'));

type Source = { sourceField: string; source: string; method: string };
type Mapping = {
  fieldSources: Source[];
  questions: { sourceField: string }[];
  metrics: Record<string, unknown>;
};

function checked<T>(schema: string, value: T): T {
  assert.deepEqual(validate(schema, value), [], schema);
  return value;
}

function setSources(mapping: Mapping, changes: Map<string, Pick<Source, 'source' | 'method'>>) {
  mapping.fieldSources = mapping.fieldSources.map((field) => ({ ...field, ...changes.get(field.sourceField) }));
}

/** Chunk 0 raises the questions; later chunks reuse the layout and carry none, as the server reports them. */
function chunkOf(base: typeof f3a.files[0], chunkIndex: number, counts: Record<string, unknown>) {
  const chunk = structuredClone(base.chunk);
  const mapping = chunk.payload.mapping as Mapping;
  chunk.slot = { ...chunk.slot, chunkIndex };
  chunk.payload.chunkIndex = chunkIndex;
  Object.assign(mapping.metrics, counts, { chunkIndex, layout: chunkIndex === 0 ? 'new' : 'memory' });
  if (chunkIndex > 0) mapping.questions = [];
  return chunk;
}

function job(base: typeof f3a.files[0], mutate: (mapping: Mapping) => void, counts: (index: number) => object) {
  const chunks = [0, 1, 2].map((index) => {
    const chunk = chunkOf(base, index, counts(index));
    mutate(chunk.payload.mapping as Mapping);
    return checked(CHUNK_SCHEMA, chunk);
  });
  const slots = chunks.map((chunk) => chunk.slot);
  const mapping = checked(MAPPING_SCHEMA, { ...base.mapping, slots, nextPublishIndex: CHUNKS, sealedChunks: CHUNKS });
  return { profile: base.profile, raw: base.raw, mapping, chunks };
}

function unansweredJob(base: typeof f3a.files[0]) {
  const columns = base.profile.headers.length;
  const none = { source: 'unanswered', method: 'manual:TEACHER_UNAVAILABLE' };
  return job(base, (mapping) => {
    setSources(mapping, new Map(mapping.fieldSources.map((field) => [field.sourceField, none])));
  }, (index) => ({ teacherCalls: 0, memoryHits: index === 0 ? 0 : 1, studentFields: 0, teacherFields: 0,
    unansweredFields: columns, needsInput: columns }));
}

/** The first six columns answered by the student; the remaining ten unanswered because the teacher was rate limited. */
function mixedJob(base: typeof f3a.files[0]) {
  const columns = base.profile.headers.length;
  const answered = 6;
  const none = { source: 'unanswered', method: 'manual:TEACHER_RATE_LIMITED' };
  const student = { source: 'student', method: 'model:stage-a@v43' };
  return job(base, (mapping) => {
    const changes = mapping.fieldSources.map((field, index) => [field.sourceField, index < answered ? student : none]);
    setSources(mapping, new Map(changes as [string, typeof none][]));
    const open = new Set(mapping.fieldSources.filter((field) => field.source === 'unanswered')
      .map((field) => field.sourceField));
    mapping.questions = mapping.questions.filter((question) => open.has(question.sourceField));
  }, (index) => ({ teacherCalls: 0, memoryHits: index === 0 ? 0 : 1, studentFields: index === 0 ? answered : 0,
    teacherFields: 0, unansweredFields: columns - answered, needsInput: columns - answered }));
}

/** An old chunk: no unanswered count, fallback columns stored as teacher fields, two stored as memory. */
function oldJob(base: typeof f3a.files[0]) {
  const columns = base.profile.headers.length;
  const stale = { source: 'memory', method: 'manual:TEACHER_UNAVAILABLE' };
  return job(base, (mapping) => {
    const last = mapping.fieldSources.slice(-2).map((field) => [field.sourceField, stale]);
    setSources(mapping, new Map(last as [string, typeof stale][]));
    delete mapping.metrics.unansweredFields;
  }, (index) => ({ teacherCalls: 0, memoryHits: index === 0 ? 0 : 1, studentFields: 2,
    teacherFields: columns - 2, needsInput: columns }));
}

function main() {
  const base = f3a.files[0];
  const jobs = { unanswered: unansweredJob(base), mixed: mixedJob(base), old: oldJob(base) };
  mkdirSync(out, { recursive: true });
  const note = 'Intercepted controls built from the F3a offline mapping of mi-d10-02.csv; not live records.';
  writeFileSync(resolve(out, 'responses.json'), JSON.stringify({ note, caseId: f3a.caseId, detail: f3a.detail, jobs }));
}

main();
