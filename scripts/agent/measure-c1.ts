// C1: one chunked mapping loop in route order on a real development table, offline.
// Gateway replay holds only a recorded software control (adapterKind control), never a Sarvam answer.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mock } from 'node:test';
import type { PoolClient } from 'pg';
import type { ColumnProfileDocument } from '../../packages/contracts/src/index';
import { AnySourceProfileSchema, AnyStreamingInputSchema, ChunkMappingInputSchema, TABULAR_LIMITS,
  type TabularMappingReceipt } from '../../packages/contracts/src/usp/index';
import { transaction } from '../../packages/server/src/infrastructure/db';
import { settings } from '../../packages/server/src/infrastructure/config';
import { sha256 } from '../../packages/server/src/infrastructure/storage';
import { fingerprint } from '../../packages/server/src/modules/cases/domain';
import { hash } from '../../packages/server/src/modules/model-gateway/config';
import { ModelGateway } from '../../packages/server/src/modules/model-gateway/gateway';
import { ControlAdapter, ReplayAdapter, type ProviderRequest, type ProviderResult }
  from '../../packages/server/src/modules/model-gateway/adapter';
import { TeacherRecordings } from '../../packages/server/src/modules/model-gateway/recordings';
import { ingestionBinding } from '../../packages/server/src/modules/usp/ingestion/events';
import { ManualIngestionService } from '../../packages/server/src/modules/usp/ingestion/service';
import { inspectTabularSource, readTabularSource }
  from '../../packages/server/src/modules/usp/ingestion/tabular-source';
import { streamingReaderSha } from '../../packages/server/src/modules/usp/ingestion/streaming-vector';
import { chunkMappingConverterSha } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { TabularChunkMapper, type TabularChunkDraft, type TabularChunkInput }
  from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { learnerVersion, manualTeacherPlan, proposeMappingWithTeacher, type TeacherDataPolicy }
  from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { activeTabularLearner, learnApprovedTabularTx, tabularLearningPaths }
  from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-learning';
import { ControlLedger, controlConfig, options } from './control-runtime';
import { developmentProfileAssets, sourceTables } from './t1-sources';

const TASK_ROOT = 'E:/BhuAayam-data/task-data/c1';
const CONTROL_PATH = 'docs/evidence/gf-agent/c1/control.json';
const RECORDINGS = { control: `${TASK_ROOT}/recordings/control`, tampered: `${TASK_ROOT}/recordings/tampered` };
export const FILES = { first: 'mi-d23-pmc-library-inventory.xlsx', second: 'mi-d23-pmc-office-inventory.xlsx' };
const REVIEWER = 'local-os:c1-worker-test-review';
const DEFAULT_PYTHON = 'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe';
const TAMPER_LITERAL = 'C1-CONTROL-LITERAL';
const ENV_KEYS = ['ULPIN_LOCAL_OPERATOR_SUBJECT', 'ULPIN_MAPPING_TEACHER_ADAPTER', 'ULPIN_TABULAR_LEARNING_DIR',
  'ULPIN_PROFILE_PYTHON', 'CUDA_VISIBLE_DEVICES'] as const;
const requireServer = createRequire(new URL('../../packages/server/package.json', import.meta.url));
const { S3Client } = requireServer('@aws-sdk/client-s3');

type Row = Record<string, any>;
const ACCEPTED_WRITES = new RegExp('^(?:COMMIT|INSERT INTO (?:usp_mapping_recipe_revisions|usp_outbox|' +
  'usp_chunk_mapping_imports|usp_job_metadata)|UPDATE usp_chunk_mapping_imports)');
type Control = {
  fields: Record<string, { labelLine: number; target: string; operation: unknown; confidence: string }>;
  rationaleByLabelLine: Record<string, string>;
};
type Source = {
  id: string;
  sha256: string;
  bytes: Buffer;
  inventory: ReturnType<typeof inspectTabularSource>;
  table: ReturnType<typeof readTabularSource>;
};
type Counters = {
  providerNetworkCalls: number; replayHits: number; replayMisses: number; memoryReuses: number;
  studentCommitsPositive: number; studentCommitsUnknown: number; teacherFields: number; teacherAttempts: number;
  verifierRefusals: number; questions: number; officerAnswers: number; executedRows: number;
};
export type ChunkRecord = {
  file: string; job: string; route: 'proposal_only' | 'approved_recipe'; chunk: number; trace: string[];
  counters: Counters; asked: string[]; committed: { field: string; target: string }[];
  verifierCodes: string[]; questionReasons: string[]; layout: string; learnerVersion: string | null; seq: number;
  cells: TabularChunkDraft['dryRun']['counts'];
};
type Event = { seq: number; step: string; memoryLines: number; learners: string[] };
type Check = { name: string; pass: boolean; detail: string };

function readControl(): Control {
  return JSON.parse(readFileSync(CONTROL_PATH, 'utf8')) as Control;
}

// The raw tabular stream cuts min(16, floor(256 / width)) rows per chunk (streaming-vector-worker.ts:19-21).
function chunkRows(width: number) {
  return Math.max(1, Math.min(TABULAR_LIMITS.chunkRows, Math.floor(TABULAR_LIMITS.columns / width)));
}

/** Manifest-authorized T1b development selection, then the product's own admission and reader. */
export function loadSource(id: string): Source {
  const asset = developmentProfileAssets().find(item => item.id === id);
  assert(asset, 'C1 reads manifest-authorized development tables only.');
  const sheet = sourceTables(asset)[0];
  const bytes = readFileSync(asset.original.externalPath);
  assert.equal(sha256(bytes), asset.original.sha256);
  const selection = { format: 'xlsx' as const, sheet: sheet.name, table: null, headerRows: sheet.headerRows };
  const inventory = inspectTabularSource(bytes, selection);
  const table = readTabularSource(bytes, selection);
  assert.deepEqual(table.headers, sheet.headers);
  return { id, sha256: asset.original.sha256, bytes, inventory, table };
}

function chunkInputs(source: Source, jobId: string): TabularChunkInput[] {
  const size = chunkRows(source.table.headers.length);
  const { sheet, headerRows } = source.inventory.tabular.selection;
  return Array.from({ length: Math.ceil(source.table.rows.length / size) }, (_, index) => ({
    jobId, chunkIndex: index, headers: source.table.headers, rowOffset: index * size,
    rows: source.table.rows.slice(index * size, (index + 1) * size), selection: { sheet, headerRows },
    sourceRef: `source:${source.id}?sheet=${sheet}`,
  }));
}

/** SQL double for the existing author/approve/learn protocol, after the A3b software-control double. */
class ProtocolDouble {
  receipt: Row | undefined;
  operations = new Map<string, Row>();
  queuedInput: Row | undefined;
  checkpoint: unknown;
  caseRevision = 0;
  constructor(readonly source: Row, readonly scope: Row, readonly raw: Row, readonly input: Row) {}

  private jobs(sql: string): Row[] {
    if (sql.startsWith('SELECT id FROM jobs')) return [{ id: this.raw.jobId }];
    if (sql.includes("operation='streaming-vector'")) {
      return [{ payload: this.raw, input_fingerprint: fingerprint(this.raw) }];
    }
    if (this.queuedInput) {
      return [{ id: this.queuedInput.jobId, payload: this.queuedInput, operation: 'chunk-mapping',
        case_id: this.scope.caseId, source_id: this.source.id, case_revision: 0,
        input_fingerprint: fingerprint(this.queuedInput) }];
    }
    return [{ status: 'running' }];
  }

  private reads(sql: string): Row[] | undefined {
    if (sql.includes('FROM registry_case_feature_mappings') || sql.includes('FROM import_packages')) return [];
    if (sql.includes('max(revision)')) return [{ revision: 1 }];
    if (sql.startsWith('SELECT id,family_id,revision,sha256')) return [this.scope.source];
    if (sql.includes('FROM cases')) return [{ id: this.scope.caseId, revision: this.caseRevision, archived: false }];
    if (sql.includes('FROM sources')) return [this.source];
    if (sql.includes('FROM usp_mapping_recipes')) return this.receipt ? [{ body: this.receipt }] : [];
    if (sql.includes('FROM usp_job_metadata')) {
      return this.queuedInput ? [] : [{ logical_state: 'running', input_sha256: fingerprint(this.input) }];
    }
    if (sql.includes('count(*)')) return [{ n: 0 }];
    if (sql.includes('FROM usp_streaming_vector_imports')) {
      return [{ state: 'completed', issue_code: null, unknown_remainder: false, sealed_chunks: 1 }];
    }
    if (sql.includes('FROM usp_chunk_mapping_imports')) return [this.importState()];
    if (sql.includes('FROM usp_chunk_mapping_slots')) return [];
    if (sql.includes('FROM jobs')) return this.jobs(sql);
    return undefined;
  }

  private importState(): Row {
    return { state: 'queued', next_publish_index: 0, records: 0, sealed_chunks: null, unknown_remainder: true,
      normalized: 0, quarantined: 0, unresolved: 0, duplicate_keys: 0, schema_drift_chunks: 0, issue_code: null,
      proposal: null };
  }

  private operationRows(args: any[]): Row[] {
    if (args.length) return this.operations.has(args[1]) ? [this.operations.get(args[1])!] : [];
    return [...this.operations].filter(([key]) => key.startsWith('manual-learn:')).map(([, row]) => row);
  }

  private writes(sql: string, args: any[]): boolean {
    if (sql === 'BEGIN') this.checkpoint = structuredClone([this.receipt, this.operations, this.queuedInput]);
    else if (sql === 'ROLLBACK') [this.receipt, this.operations, this.queuedInput] = this.checkpoint as any;
    else if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(args[1], { payload_hash: args[2], result: structuredClone(args[3]) });
    } else if (sql.startsWith('UPDATE cases SET revision=')) this.caseRevision++;
    else if (sql.startsWith('INSERT INTO jobs(')) this.queuedInput = args[5];
    else if (sql.startsWith('UPDATE usp_mapping_recipes')) this.receipt = structuredClone(args[3]);
    else if (sql.startsWith('INSERT INTO usp_mapping_recipes(')) this.receipt = structuredClone(args[5]);
    else return ACCEPTED_WRITES.test(sql) || sql.includes('pg_advisory_xact_lock');
    return true;
  }

  async query(sql: string, args: any[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    let rows: Row[] = [];
    if (sql.includes('FROM operations')) rows = this.operationRows(args);
    else if (sql.startsWith('UPDATE usp_outbox_streams')) rows = [{ sequence: '1' }];
    else if (!this.writes(sql, args)) {
      const found = this.reads(sql);
      assert(found, `Unexpected protocol SQL: ${sql}`);
      rows = found;
    }
    return { rows, rowCount: rows.length };
  }
}

type Workspace = { caseId: string; sourceId: string; source: Row; profile: Row; db: ProtocolDouble };

function streamingInputs(source: Source, caseId: string, sourceId: string, workspaceFingerprint: string) {
  const access = ingestionBinding(caseId);
  const rawBase = { version: 'geojson-stream/2', jobId: randomUUID(), caseId, caseRevision: 0, sourceId,
    sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: source.sha256, sourceBytes: source.bytes.length,
    objectKey: 'c1-software-control-original', framing: 'tabular', tabular: source.inventory.tabular,
    subject: access.subject, accessBinding: access.access, readerSha256: streamingReaderSha() };
  const raw = AnyStreamingInputSchema.parse({ ...rawBase, inputFingerprint: fingerprint(rawBase) });
  const base = { version: 'chunk-mapping/1', jobId: randomUUID(), caseId, caseRevision: 0, sourceId,
    sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: source.sha256, rawJobId: raw.jobId,
    rawInputFingerprint: fingerprint(raw), readerSha256: raw.readerSha256, route: 'proposal_only', recipeId: null,
    recipeRevision: null, planHash: null, schemaFingerprint: source.inventory.schemaFingerprint,
    workspaceFingerprint, converterSha256: chunkMappingConverterSha(), subject: access.subject,
    accessBinding: access.access, tabular: source.inventory.tabular };
  return { raw, mapped: ChunkMappingInputSchema.parse({ ...base, inputFingerprint: fingerprint(base) }) };
}

function workspaceFor(source: Source): Workspace {
  const caseId = randomUUID();
  const sourceId = randomUUID();
  const summary = { id: sourceId, family_id: sourceId, revision: 1, sha256: source.sha256 };
  const workspaceFingerprint = fingerprint({ caseId, revision: 0, sources: [summary] });
  const { schemaFingerprint, ...inventory } = source.inventory;
  const pin = { sourceId, familyId: sourceId, sourceRevision: 1, sourceSha256: source.sha256, schemaFingerprint };
  const profile = AnySourceProfileSchema.parse({ version: 'manual-tabular/1', ...inventory, source: pin, caseId,
    workspaceRevision: 0, workspaceFingerprint });
  const row = { ...summary, case_id: caseId, profile: 'tabular-manual-v1', bytes: source.bytes.length,
    object_key: 'c1-software-control-original', inspection: {
      manualProfile: { version: 'manual-tabular/1', ...source.inventory }, actor: REVIEWER } };
  const { raw, mapped } = streamingInputs(source, caseId, sourceId, workspaceFingerprint);
  const db = new ProtocolDouble(row, { caseId, source: summary }, raw, mapped);
  return { caseId, sourceId, source: row, profile, db };
}

function useDoubles(db: ProtocolDouble, bytes: Buffer) {
  (globalThis as any).ulpinPool = { connect: async () => ({ query: db.query.bind(db), release() {} }),
    query: db.query.bind(db) };
  mock.getter(settings, 's3Endpoint', () => 'http://127.0.0.1:1');
  mock.getter(settings, 's3Region', () => 'us-east-1');
  mock.getter(settings, 's3Bucket', () => 'software-control');
  mock.getter(settings, 's3AccessKey', () => 'software-control-not-a-key');
  mock.getter(settings, 's3SecretKey', () => 'software-control-not-a-secret');
  mock.method(S3Client.prototype, 'send', async (command: any) => {
    assert.equal(command.constructor.name, 'GetObjectCommand');
    return { Body: { transformToByteArray: async () => bytes } };
  });
}

async function isolated<T>(root: string, run: () => Promise<T>): Promise<T> {
  const saved = ENV_KEYS.map(key => [key, process.env[key]] as const);
  const pool = (globalThis as any).ulpinPool;
  Object.assign(process.env, { ULPIN_LOCAL_OPERATOR_SUBJECT: REVIEWER, ULPIN_MAPPING_TEACHER_ADAPTER: 'manual',
    ULPIN_TABULAR_LEARNING_DIR: root, CUDA_VISIBLE_DEVICES: '',
    ULPIN_PROFILE_PYTHON: process.env.ULPIN_PROFILE_PYTHON ?? DEFAULT_PYTHON });
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    (globalThis as any).ulpinPool = pool;
    mock.restoreAll();
  }
}

/** Test-side observation of injected dependencies only: fetch, the replay loader and the teacher seam. */
class Probe {
  network = 0;
  replayHits = 0;
  replayMisses = 0;
  asked: string[][] = [];
  events: Event[] = [];

  install() {
    mock.method(globalThis, 'fetch', async () => {
      this.network++;
      throw new Error('C1_NETWORK_DENIED');
    });
  }

  gateway(directory: string) {
    const recordings = new TeacherRecordings(directory);
    return new ModelGateway(controlConfig(), new ControlLedger(), new ReplayAdapter(async key => {
      const found = await recordings.replay(key, ['control']);
      if (found) this.replayHits++;
      else this.replayMisses++;
      return found;
    }));
  }

  teacher = async (profile: ColumnProfileDocument, routing: Parameters<typeof proposeMappingWithTeacher>[1]) => {
    this.asked.push(profile.columns.map(column => column.name));
    return proposeMappingWithTeacher(profile, routing);
  };

  note(step: string): number {
    const paths = tabularLearningPaths();
    const memoryLines = existsSync(paths.memory) ? readFileSync(paths.memory, 'utf8').trim().split('\n').length : 0;
    this.events.push({ seq: this.events.length + 1, step, memoryLines, learners: learnerCheckpoints() });
    return this.events.length;
  }

  snapshot() {
    return { network: this.network, hits: this.replayHits, misses: this.replayMisses, asked: this.asked.length };
  }
}

function learnerCheckpoints(): string[] {
  const approvals = join(tabularLearningPaths().root, 'approvals');
  if (!existsSync(approvals)) return [];
  return readdirSync(approvals).flatMap(batch => {
    const learner = join(approvals, batch, 'learner');
    if (!existsSync(learner)) return [];
    return readdirSync(learner).filter(name => /^v\d+$/.test(name)).map(version => join(learner, version));
  });
}

async function routing(probe: Probe, db: ProtocolDouble, recordings: string) {
  const dataPolicy: TeacherDataPolicy = { dataClass: 'public', split: 'development' };
  return { ...options(probe.gateway(recordings)), dataPolicy, teacher: probe.teacher,
    memoryPath: tabularLearningPaths().memory,
    learnerModelPath: await activeTabularLearner(db as unknown as PoolClient) };
}

type MapStep = {
  file: string; route: ChunkRecord['route']; mapper: TabularChunkMapper; db: ProtocolDouble; recordings: string;
};
type Observed = { before: ReturnType<Probe['snapshot']>; after: ReturnType<Probe['snapshot']>; asked: string[] };
const NOT_REFUSALS = new Set(['TEACHER_UNCERTAIN', 'MAPPING_REVIEW_REQUIRED', 'TEACHER_UNAVAILABLE',
  'TEACHER_REPLAY_UNAVAILABLE', 'TEACHER_RECORDING_UNAVAILABLE', 'TEACHER_DATA_DENIED', 'TEACHER_INPUT_LIMIT']);
const REVIEW_NOTE = 'Test review by the C1 worker on a public development table; not property truth.';

function committedFields(draft: TabularChunkDraft) {
  const targets = new Map(draft.proposal.plan.fields.map(field => [field.sourceField, field.target]));
  return draft.proposal.fieldSources.filter(field => field.source === 'student')
    .map(field => ({ field: field.sourceField, target: targets.get(field.sourceField) ?? 'unknown' }));
}

function verifierCodes(draft: TabularChunkDraft): string[] {
  const codes = [...draft.proposal.validationCodes, ...draft.proposal.issues.map(issue => issue.code)];
  return [...new Set(codes)].sort();
}

function executedRows(route: ChunkRecord['route'], draft: TabularChunkDraft): number {
  if (route !== 'approved_recipe') return 0;
  assert(draft.proposal.fieldSources.every(field => field.source === 'officer'), 'Execution uses the officer plan.');
  return draft.dryRun.rows.length;
}

function memoryFact(route: ChunkRecord['route'], draft: TabularChunkDraft): string {
  if (route === 'approved_recipe') return 'memory:bypassed by the approved plan';
  if (draft.metrics.layout === 'memory') return 'memory:hit';
  return `memory:miss ${draft.proposal.memoryReasonCode ?? 'none'}`;
}

function studentFact(step: MapStep, draft: TabularChunkDraft): string {
  if (step.route === 'approved_recipe' || draft.metrics.layout === 'memory') return 'student:not consulted';
  const committed = committedFields(draft).length;
  return `student:${committed} committed, ${draft.proposal.fieldSources.length - committed} abstained`;
}

function teacherFact(draft: TabularChunkDraft, asked: string[]): string {
  if (!asked.length) return 'teacher:not asked';
  const replay = draft.proposal.replayed ? 'replayed' : 'not replayed';
  return `teacher:${asked.length} fields asked, ${draft.metrics.teacherCalls} attempts, ${replay}`;
}

function chunkTrace(step: MapStep, draft: TabularChunkDraft, observed: Observed) {
  return [memoryFact(step.route, draft), studentFact(step, draft), teacherFact(draft, observed.asked),
    `verifier:${draft.proposal.state} ${verifierCodes(draft).join(',') || 'no codes'}`,
    `questions:${draft.questions.length}`, `executor:${executedRows(step.route, draft)} officer rows`];
}

function chunkCounters(step: MapStep, draft: TabularChunkDraft, observed: Observed): Counters {
  const { before, after } = observed;
  const committed = committedFields(draft);
  const refused = draft.proposal.issues.filter(issue => !NOT_REFUSALS.has(issue.code));
  return { providerNetworkCalls: after.network - before.network, replayHits: after.hits - before.hits,
    replayMisses: after.misses - before.misses, memoryReuses: draft.metrics.memoryHits,
    studentCommitsPositive: committed.filter(field => field.target !== 'unknown').length,
    studentCommitsUnknown: committed.filter(field => field.target === 'unknown').length,
    teacherFields: draft.metrics.teacherFields, teacherAttempts: draft.metrics.teacherCalls,
    verifierRefusals: refused.length, questions: draft.questions.length, officerAnswers: 0,
    executedRows: executedRows(step.route, draft) };
}

async function mapChunk(probe: Probe, step: MapStep, chunk: TabularChunkInput, extra: object = {}) {
  const before = probe.snapshot();
  const draft = await step.mapper.map(chunk, { ...(await routing(probe, step.db, step.recordings)), ...extra });
  const after = probe.snapshot();
  const observed = { before, after, asked: probe.asked.slice(before.asked).flat() };
  const seq = probe.note(`${step.file}/${step.route}/chunk-${chunk.chunkIndex}`);
  const record: ChunkRecord = { file: step.file, job: chunk.jobId, route: step.route, chunk: chunk.chunkIndex,
    trace: chunkTrace(step, draft, observed), counters: chunkCounters(step, draft, observed), asked: observed.asked,
    committed: committedFields(draft), verifierCodes: verifierCodes(draft),
    questionReasons: draft.questions.map(question => `${question.sourceField}:${question.reason}`),
    layout: draft.metrics.layout, learnerVersion: draft.metrics.learnerVersion, seq, cells: draft.dryRun.counts };
  return { draft, record };
}

async function mapAll(probe: Probe, step: MapStep, chunks: TabularChunkInput[], extra: object = {}) {
  const records: ChunkRecord[] = [];
  for (const chunk of chunks) records.push((await mapChunk(probe, step, chunk, extra)).record);
  return records;
}

function officerReason(asked: string | undefined, proposed: string, label: string): string {
  if (asked) return `Answers ${asked} with ${label}, the verified development label. ${REVIEW_NOTE}`;
  if (proposed !== label) return `Corrects ${proposed} to ${label}, the verified development label. ${REVIEW_NOTE}`;
  return `Accepts the proposed ${proposed}. ${REVIEW_NOTE}`;
}

/** The reviewer answers each question and checks each field against the verified pseudo-label. */
function officerDecisions(source: Source, draft: TabularChunkDraft, control: Control) {
  const proposed = new Map(draft.proposal.plan.fields.map(field => [field.sourceField, field]));
  const questions = new Map(draft.questions.map(question => [question.sourceField, question.reason]));
  const fields = source.inventory.profile.columns.map(column => {
    const field = proposed.get(column.name);
    const label = control.fields[column.name];
    assert(field && label, `C1 review lacks ${column.name}.`);
    const operation = field.target === label.target ? field.operation : label.operation;
    return { ...field, target: label.target, operation } as typeof field;
  });
  const decisions = fields.map(field => ({ sourceField: field.sourceField, reason: officerReason(
    questions.get(field.sourceField), proposed.get(field.sourceField)!.target, field.target) }));
  const corrections = fields.filter(field => proposed.get(field.sourceField)!.target !== field.target).length;
  const mapping = { ...manualTeacherPlan(source.inventory.profile, 'MAPPING_REVIEW_REQUIRED').plan, fields };
  return { mapping, decisions, answers: questions.size, corrections };
}

async function refusalCode(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error: any) {
    return error?.code ?? String(error);
  }
}

async function officerReview(probe: Probe, ws: Workspace, source: Source, draft: TabularChunkDraft) {
  const decided = officerDecisions(source, draft, readControl());
  const service = new ManualIngestionService();
  const plan = { version: 'manual-tabular/1', mode: 'manual_mapping', source: ws.profile.source,
    caseId: ws.caseId, workspaceRevision: 0, workspaceFingerprint: ws.profile.workspaceFingerprint,
    tabular: source.inventory.tabular, mapping: decided.mapping, decisions: decided.decisions };
  const authored = await service.author(ws.caseId, ws.sourceId, { requestKey: randomUUID(),
    expectedRecipeRevision: 0, destination: null, plan });
  const authoredSeq = probe.note('officer/authored');
  const approved = await service.decide(ws.caseId, authored.id, { requestKey: randomUUID(),
    expectedRecipeRevision: authored.revision }, 'approve') as TabularMappingReceipt;
  const approvedSeq = probe.note('officer/approved');
  const refusal = await refusalCode(() => service.decide(ws.caseId, approved.id, { requestKey: randomUUID(),
    expectedRecipeRevision: approved.revision }, 'execute'));
  return { approved, authoredSeq, approvedSeq, refusal, answers: decided.answers,
    corrections: decided.corrections, state: approved.state, subject: approved.approval?.subject ?? null,
    provenance: approved.approval?.provenance ?? null, queuedRoute: ws.db.queuedInput?.route ?? null };
}

async function learnOnce(probe: Probe, ws: Workspace, approved: TabularMappingReceipt) {
  const parent = await activeTabularLearner(ws.db as unknown as PoolClient);
  const learned = await transaction(client => learnApprovedTabularTx(client, approved, ws.profile, ws.source));
  const seq = probe.note('learning');
  const metrics = JSON.parse(readFileSync(join(learned.model, 'metrics.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(learned.model, 'manifest.json'), 'utf8'));
  return { seq, parentVersion: learnerVersion(parent), version: learned.version as string, model: learned.model,
    partialFitCalls: metrics.partialFitCalls as number, checkpoints: learnerCheckpoints().length,
    modelSha256: manifest.modelSha256 as string, memoryLines: probe.events.at(-1)!.memoryLines };
}

type Review = Awaited<ReturnType<typeof officerReview>>;
type Learning = Awaited<ReturnType<typeof learnOnce>>;
export type LoopRun = Awaited<ReturnType<typeof mainSequence>>;

function mapStep(file: string, route: ChunkRecord['route'], db: ProtocolDouble, recordings = RECORDINGS.control) {
  return { file, route, mapper: new TabularChunkMapper(), db, recordings };
}

/** File 1 chunk 1 cold, review, one learning update, approved execution, later chunks, then file 2. */
async function mainSequence(first: Source, second: Source) {
  const probe = new Probe();
  probe.install();
  const ws = workspaceFor(first);
  useDoubles(ws.db, first.bytes);
  probe.note('start');
  const cold = await mapChunk(probe, mapStep('file1', 'proposal_only', ws.db), chunkInputs(first, randomUUID())[0]);
  const review = await officerReview(probe, ws, first, cold.draft);
  cold.record.counters.officerAnswers = review.answers;
  const learning = await learnOnce(probe, ws, review.approved);
  const executed = await mapAll(probe, mapStep('file1', 'approved_recipe', ws.db),
    chunkInputs(first, randomUUID()), { approvedPlan: review.approved.plan.mapping });
  const later = await mapAll(probe, mapStep('file1', 'proposal_only', ws.db),
    chunkInputs(first, randomUUID()).slice(1));
  const file2 = await mapAll(probe, mapStep('file2', 'proposal_only', ws.db), chunkInputs(second, randomUUID()));
  const { approved: _receipt, ...officer } = review;
  return { records: [cold.record, ...executed, ...later, ...file2], officer, review, learning,
    events: probe.events, network: probe.network };
}

/** The same cold chunk in a fresh workspace with a different replay store; nothing may execute or learn. */
async function controlRun(first: Source, name: string, recordings: string) {
  const probe = new Probe();
  probe.install();
  const ws = workspaceFor(first);
  useDoubles(ws.db, first.bytes);
  const cold = await mapChunk(probe, mapStep('file1', 'proposal_only', ws.db, recordings),
    chunkInputs(first, randomUUID())[0]);
  const last = probe.events.at(-1)!;
  return { name, state: cold.draft.proposal.state, method: cold.draft.proposal.plan.method,
    validationCodes: cold.draft.proposal.validationCodes, record: cold.record, memoryLines: last.memoryLines,
    learners: last.learners.length, recipe: ws.db.receipt ? 'present' : 'absent', network: probe.network };
}
export type ControlResult = Awaited<ReturnType<typeof controlRun>>;

function check(name: string, pass: boolean, detail: unknown): Check {
  return { name, pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
}

function orderChecks(record: ChunkRecord): Check[] {
  const id = `${record.file}/${record.route}/chunk-${record.chunk}`;
  const committed = new Set(record.committed.map(field => field.field));
  const known = new Set([...record.verifierCodes, 'MAPPING_REVIEW_REQUIRED', 'TABULAR_CELL_UNAVAILABLE']);
  const checks = [
    check(`${id}: no teacher attempt for a student-committed field`,
      record.asked.every(field => !committed.has(field)), { asked: record.asked, committed: [...committed] }),
    check(`${id}: every question follows a verifier issue`,
      record.questionReasons.every(reason => known.has(reason.split(':').at(-1)!)), record.questionReasons),
  ];
  if (record.layout === 'memory') {
    checks.push(check(`${id}: a memory answer reaches neither student nor teacher`,
      !record.asked.length && !record.committed.length && !record.counters.teacherAttempts, record.trace));
  }
  return checks;
}

function coldChecks(run: LoopRun): Check[] {
  const cold = run.records[0];
  return [
    check('file1 chunk 0: memory misses', cold.layout === 'new' && cold.counters.memoryReuses === 0, cold.trace[0]),
    check('file1 chunk 0: the teacher is asked and the replay answers from the control',
      cold.asked.length > 0 && cold.counters.replayHits === 1 && cold.counters.replayMisses === 0, cold.trace[2]),
    check('file1 chunk 0: questions remain for the officer', cold.counters.questions > 0, cold.questionReasons),
    check('no provider network call in the run', run.network === 0, run.network),
  ];
}

function beforeApprovalChecks(run: LoopRun): Check[] {
  const approvedSeq = run.review.approvedSeq;
  const before = run.events.filter(event => event.seq < approvedSeq);
  const executed = run.records.filter(record => record.counters.executedRows > 0);
  return [
    check('nothing executed before approval', executed.every(record => record.seq > approvedSeq) &&
      run.records.filter(record => record.seq < approvedSeq).every(record => !record.counters.executedRows),
    executed.map(record => record.seq)),
    check('no memory write and no learning before approval',
      before.every(event => event.memoryLines === 0 && event.learners.length === 0), before),
  ];
}

function approvalChecks(review: Review, learning: Learning): Check[] {
  return [
    check('approval is recorded for the configured local subject', review.state === 'approved' &&
      review.subject === REVIEWER && review.provenance === 'server_configured_local_operator', review),
    check('approval queues the approved_recipe chunk job', review.queuedRoute === 'approved_recipe',
      review.queuedRoute),
    check('registry execution refuses', review.refusal === 'TABULAR_REGISTRY_UNQUALIFIED', review.refusal),
    check('exactly one learning update after approval', learning.seq > review.approvedSeq &&
      learning.checkpoints === 1 && learning.partialFitCalls === 1, learning),
    check('learning steps the version once', learning.parentVersion === 'v43' && learning.version === 'v44',
      `${learning.parentVersion} -> ${learning.version}`),
    check('accepted memory is written at learning', learning.memoryLines === 1, learning.memoryLines),
  ];
}

function afterApprovalChecks(run: LoopRun): Check[] {
  const executed = run.records.filter(record => record.route === 'approved_recipe');
  const later = run.records.filter(record => record.file === 'file1' && record.route === 'proposal_only' &&
    record.chunk > 0);
  return [
    check('the executor runs every file1 chunk after learning with the officer plan',
      executed.length === 4 && executed.every(record => record.seq > run.learning.seq &&
        record.counters.executedRows > 0 && !record.counters.teacherAttempts), executed.map(record => record.trace)),
    check('file1 later chunks: memory answers, teacher attempts 0, no new question',
      later.length === 3 && later.every(record => record.layout === 'memory' && !record.counters.teacherAttempts &&
        !record.counters.questions && record.learnerVersion === run.learning.version),
    later.map(record => record.trace)),
  ];
}

function controlChecks(removed: ControlResult, tampered: ControlResult): Check[] {
  const quiet = (control: ControlResult) => control.record.counters.executedRows === 0 &&
    control.memoryLines === 0 && control.learners === 0 && control.recipe === 'absent' && control.network === 0;
  return [
    check('control removed: replay miss ends in needs_input, nothing executed',
      removed.record.counters.replayMisses > 0 && removed.record.counters.replayHits === 0 &&
      removed.state === 'needs_input' && quiet(removed), removed.record.trace),
    check('control altered with a literal: the verifier refuses it, nothing executed',
      tampered.record.counters.replayHits > 0 && tampered.validationCodes.length > 0 &&
      tampered.state === 'needs_input' && quiet(tampered), tampered.validationCodes),
  ];
}

export function loopChecks(run: LoopRun, removed: ControlResult, tampered: ControlResult): Check[] {
  return [...coldChecks(run), ...run.records.flatMap(orderChecks), ...beforeApprovalChecks(run),
    ...approvalChecks(run.review, run.learning), ...afterApprovalChecks(run), ...controlChecks(removed, tampered)];
}

function addCounters(left: Counters, right: Counters): Counters {
  const sum = { ...left };
  for (const key of Object.keys(sum) as (keyof Counters)[]) sum[key] += right[key];
  return sum;
}

function perFile(records: ChunkRecord[]) {
  const totals: Record<string, Counters> = {};
  for (const record of records) {
    const key = `${record.file}/${record.route}`;
    totals[key] = totals[key] ? addCounters(totals[key], record.counters) : { ...record.counters };
  }
  return totals;
}

/** Committed student fields against the verified T1b pseudo-label (file 2 lines 186-190 carry the same targets). */
function committedPrecision(records: ChunkRecord[]) {
  const control = readControl();
  const committed = records.flatMap(record => record.committed);
  const correct = committed.filter(field => control.fields[field.field]?.target === field.target).length;
  return { correct, denominator: committed.length, against: 'verified T1b pseudo-label, not truth' };
}

function assertControlRecorded() {
  for (const directory of Object.values(RECORDINGS)) {
    assert(existsSync(directory) && readdirSync(directory).length === 1, `Run "record" first: ${directory}`);
  }
}

export async function runLoop() {
  assertControlRecorded();
  const first = loadSource(FILES.first);
  const second = loadSource(FILES.second);
  const root = `${TASK_ROOT}/runs/${randomUUID()}`;
  const run = await isolated(`${root}/loop`, () => mainSequence(first, second));
  const removed = await isolated(`${root}/control-removed`,
    () => controlRun(first, 'control removed', `${root}/control-removed/no-recordings`));
  const tampered = await isolated(`${root}/control-tampered`,
    () => controlRun(first, 'control altered with a literal', RECORDINGS.tampered));
  const checks = loopChecks(run, removed, tampered);
  const { review: _review, ...kept } = run;
  return { root, ...kept, perFile: perFile(run.records), precision: committedPrecision(run.records),
    controls: [removed, tampered], checks };
}

function controlAnswer(request: ProviderRequest, control: Control): ProviderResult {
  const columns = JSON.parse(request.messages[1].content).columnProfile.columns as
    { header: string; sourceField: string }[];
  const fields = columns.map(column => {
    const field = control.fields[column.header];
    assert(field, `The C1 control has no answer for ${column.header}; it never invents one.`);
    return { sourceField: column.sourceField, target: field.target, operation: field.operation,
      confidence: field.confidence, rationale: control.rationaleByLabelLine[String(field.labelLine)] };
  });
  const output = { fields };
  return { output, responseHash: hash(output), httpStatus: 200, usage: { promptTokens: 0, completionTokens: 0 },
    rawResponse: { output } };
}

/** A tamperer recomputes the self-hashes and keeps validation.success, so replay serves it to the verifier. */
function tamperedLine(line: string): string {
  const { recordHash: _recordHash, ...entry } = JSON.parse(line);
  const output = structuredClone(entry.response.output);
  const index = Math.max(0, entry.parsedPlan.fields.findIndex((field: any) => field.target !== 'unknown'));
  output.fields[index].operation = { ...output.fields[index].operation, value: TAMPER_LITERAL };
  const response = { ...entry.response, output, responseHash: hash(output), rawResponse: { output } };
  const tampered = { ...entry, rawResponse: response.rawResponse, responseHash: response.responseHash, response,
    responseIntegrity: hash(response) };
  return JSON.stringify({ ...tampered, recordHash: hash(tampered) });
}

/** One-time authoring: the product's recorder writes the control answer for file 1 chunk 0, then its altered copy. */
async function recordControl() {
  for (const directory of Object.values(RECORDINGS)) {
    assert(!existsSync(directory) || !readdirSync(directory).length, `C1 control already recorded: ${directory}`);
  }
  const first = loadSource(FILES.first);
  await isolated(`${TASK_ROOT}/record-${randomUUID()}`, async () => {
    const gateway = new ModelGateway(controlConfig(), new ControlLedger(),
      new ControlAdapter(async request => controlAnswer(request, readControl())));
    const draft = await new TabularChunkMapper().map(chunkInputs(first, randomUUID())[0], { ...options(gateway),
      recordings: new TeacherRecordings(RECORDINGS.control), memoryPath: tabularLearningPaths().memory,
      learnerModelPath: tabularLearningPaths().seed });
    assert.equal(draft.proposal.attempts, 1);
  });
  const [name] = readdirSync(RECORDINGS.control);
  const line = readFileSync(join(RECORDINGS.control, name), 'utf8').trim();
  mkdirSync(RECORDINGS.tampered, { recursive: true });
  writeFileSync(join(RECORDINGS.tampered, `teacher-${randomUUID()}.jsonl`), tamperedLine(line) + '\n',
    { flag: 'wx', mode: 0o600 });
  for (const directory of Object.values(RECORDINGS)) {
    for (const file of readdirSync(directory).map(name => join(directory, name))) {
      console.log(file, sha256(readFileSync(file)));
    }
  }
}

function compact(result: Awaited<ReturnType<typeof runLoop>>) {
  return { root: result.root, network: result.network, learning: result.learning, officer: result.officer,
    precision: result.precision, perFile: result.perFile,
    chunks: result.records.map(({ file, route, chunk, trace, counters, seq, cells }) => ({ file, route, chunk, seq,
      trace, counters, cells })),
    controls: result.controls.map(({ name, state, method, validationCodes, record }) => ({ name, state, method,
      validationCodes, trace: record.trace, counters: record.counters })),
    failed: result.checks.filter(item => !item.pass), passed: result.checks.filter(item => item.pass).length };
}

async function main() {
  if (process.argv[2] === 'record') return recordControl();
  const result = await runLoop();
  writeFileSync(`${result.root}/summary.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(compact(result), null, 2));
  if (result.checks.some(item => !item.pass)) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('measure-c1.ts')) await main();
