import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { mock, test } from 'node:test';
import type { PoolClient } from 'pg';
import { AnySourceProfileSchema, AnyStreamingInputSchema, ChunkMappingInputSchema, ChunkMappingPayloadSchema,
  StreamingVectorInputSchema, CaseIngestionEventSchema, TabularSourceProfileSchema,
  AnyAuthorMappingSchema } from '../../packages/contracts/src/usp/index';
import { transaction } from '../../packages/server/src/infrastructure/db';
import { registerUspJobInputTx } from '../../packages/server/src/modules/usp/jobs';
import { settings } from '../../packages/server/src/infrastructure/config';
import { sha256 } from '../../packages/server/src/infrastructure/storage';
import { fingerprint } from '../../packages/server/src/modules/cases/domain';
import { ManualIngestionService } from '../../packages/server/src/modules/usp/ingestion/service';
import { validateTabularRecipe } from '../../packages/server/src/modules/usp/ingestion/tabular-recipe';
import { inspectTabularSource, readTabularSource }
  from '../../packages/server/src/modules/usp/ingestion/tabular-source';
import { readStreamingTabular, tabularSourceRecord }
  from '../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import { streamingReaderSha } from '../../packages/server/src/modules/usp/ingestion/streaming-vector';
import { chunkMappingConverterSha } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { TabularChunkMapper } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { manualTeacherPlan } from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { publishTabularMappingTx, acceptTabularDataSlot }
  from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-tabular';
import { learnApprovedTabularTx, activeTabularLearner, tabularLearningPaths }
  from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-learning';
import { writeIngestionFrame } from '../../apps/api/src/modules/ingestion/events.transport';
type FrameResponse = Parameters<typeof writeIngestionFrame>[0];
import { ingestionBinding } from '../../packages/server/src/modules/usp/ingestion/events';
import { developmentManifest, sourceTables } from './t1-sources';
import { options } from './control-runtime';

const requireServer = createRequire(new URL('../../packages/server/package.json', import.meta.url));
const { S3Client } = requireServer('@aws-sdk/client-s3');
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
function real(id: string) {
  const asset = developmentManifest().assets.find(item => item.id === id);
  assert(asset);
  const bytes = readFileSync(asset.original.externalPath);
  assert.equal(sha256(bytes), asset.original.sha256);
  return { asset, bytes, inventory: inspectTabularSource(bytes, selection) };
}

type Row = Record<string, any>;
class ProtocolDb {
  receipt: Row | undefined;
  operations = new Map<string, Row>();
  slots: unknown[][] = [];
  events: unknown[] = [];
  failOutbox = false;
  checkpoint: any;
  queuedInput: Row | undefined;
  sourceExists = true;
  caseRevision = 0;
  constructor(readonly source: Row, readonly scope: Row, readonly raw: Row, readonly input: Row) {}

  reads(sql: string): Row[] | undefined {
    if (sql.includes('FROM registry_case_feature_mappings') || sql.includes('FROM import_packages')) return [];
    if (sql.includes('max(revision)')) return [{ revision: 1 }];
    if (sql.startsWith('SELECT id,family_id,revision,sha256')) return this.sourceExists ? [this.scope.source] : [];
    if (sql.includes('FROM cases')) return [{ id: this.scope.caseId, revision: this.caseRevision, archived: false }];
    if (sql.includes('FROM sources')) return this.sourceExists ? [this.source] : [];
    if (sql.includes('FROM usp_mapping_recipes')) return this.receipt ? [{ body: this.receipt }] : [];
    if (sql.includes('FROM usp_job_attempts')) return [{ state: 'active', fence: 1, owner: 'control',
      input_sha256: fingerprint(this.input), lease_until: new Date(Date.now() + 180000).toISOString() }];
    if (sql.includes('FROM usp_job_metadata')) return this.queuedInput ? [] :
      [{ logical_state: 'running', input_sha256: fingerprint(this.input) }];
    if (sql.includes('count(*)')) return [{ n: 0 }];
    if (sql.includes('FROM usp_streaming_vector_imports')) return [{ state: 'completed', issue_code: null,
      unknown_remainder: false, sealed_chunks: 1 }];
    if (sql.includes('FROM usp_chunk_mapping_imports')) return [{ state: 'running', next_publish_index: 0, records: 0,
      sealed_chunks: null, unknown_remainder: true, normalized: 0, quarantined: 0, unresolved: 0,
      duplicate_keys: 0, schema_drift_chunks: 0, issue_code: null, proposal: null }];
    if (sql.includes('FROM usp_streaming_vector_slots')) {
      return [{ published: true, result_sha256: fingerprint('raw') }];
    }
    if (sql.startsWith('SELECT id FROM jobs')) return [{ id: this.raw.jobId }];
    if (sql.includes('FROM jobs') && sql.includes("operation='streaming-vector'")) {
      return [{ payload: this.raw, input_fingerprint: fingerprint(this.raw) }];
    }
    if (sql.includes('FROM usp_chunk_mapping_slots')) return [];
    if (sql.includes('FROM jobs') && this.queuedInput) return [{ id: this.queuedInput.jobId,
      payload: this.queuedInput, operation: 'chunk-mapping', case_id: this.scope.caseId,
      source_id: this.source.id, case_revision: 0, input_fingerprint: fingerprint(this.queuedInput) }];
    if (sql.includes('FROM jobs')) return [{ status: 'running' }];
    return undefined;
  }

  async query(sql: string, args: any[] = []): Promise<any> {
    let rows: Row[] = [];
    if (sql === 'BEGIN') this.checkpoint = structuredClone([this.receipt, this.operations, this.slots, this.events]);
    else if (sql === 'ROLLBACK') [this.receipt, this.operations, this.slots, this.events] = this.checkpoint;
    else if (sql.includes('FROM operations')) {
      const found = args.length ? this.operations.get(args[1]) : [...this.operations.values()].at(-1);
      rows = found ? [found] : [];
    } else if (sql.startsWith('INSERT INTO operations')) {
      this.operations.set(args[1], { payload_hash: args[2], result: structuredClone(args[3]) });
    } else if (sql.startsWith('INSERT INTO sources(')) this.insertSource(args);
    else if (sql.startsWith('UPDATE cases SET revision=')) this.caseRevision++;
    else if (sql.startsWith('INSERT INTO jobs(')) this.queuedInput = args[5];
    else if (sql.startsWith('UPDATE usp_mapping_recipes')) this.receipt = structuredClone(args[3]);
    else if (sql.startsWith('INSERT INTO usp_mapping_recipes(')) this.receipt = structuredClone(args[5]);
    else if (sql.startsWith('INSERT INTO usp_chunk_mapping_slots')) this.slots.push(args);
    else if (sql.startsWith('UPDATE usp_outbox_streams')) {
      if (this.failOutbox) throw new Error('A3B_OUTBOX_FAILURE');
      rows = [{ sequence: String(this.events.length + 1) }];
    } else if (sql.startsWith('INSERT INTO usp_outbox(')) this.events.push(args[2]);
    else {
      const found = this.reads(sql);
      if (found) rows = found;
      else assert(sql === 'COMMIT' || sql.startsWith('INSERT INTO usp_mapping_recipe_revisions') ||
        sql.startsWith('INSERT INTO usp_outbox_streams') || sql.startsWith('UPDATE usp_chunk_mapping_imports') ||
        sql.startsWith('INSERT INTO usp_chunk_mapping_imports') || sql.startsWith('INSERT INTO usp_job_metadata') ||
        sql.includes('pg_advisory_xact_lock'), `Unexpected protocol SQL: ${sql}`);
    }
    return { rows, rowCount: rows.length };
  }

  insertSource(args: any[]) {
    Object.assign(this.source, { id: args[0], case_id: args[1], family_id: args[2], revision: args[3], name: args[4],
      profile: args[5], mime_type: args[6], bytes: args[7], sha256: args[8],
      object_key: args[9], inspection: args[10] });
    this.scope.source = { id: args[0], family_id: args[2], revision: args[3], sha256: args[8] };
    this.sourceExists = true;
  }
}

function fixture() {
  const input = real('mi-d10-01.csv');
  const caseId = randomUUID(), sourceId = randomUUID(), rawJobId = randomUUID(), jobId = randomUUID();
  const sourcePin = { sourceId, familyId: sourceId, sourceRevision: 1, sourceSha256: sha256(input.bytes),
    schemaFingerprint: input.inventory.schemaFingerprint };
  const summary = { id: sourceId, family_id: sourceId, revision: 1, sha256: sourcePin.sourceSha256 };
  const workspaceFingerprint = fingerprint({ caseId, revision: 0, sources: [summary] });
  const { schemaFingerprint: _schemaFingerprint, ...inventory } = input.inventory;
  const profile = AnySourceProfileSchema.parse({ version: 'manual-tabular/1', ...inventory, source: sourcePin,
    caseId, workspaceRevision: 0, workspaceFingerprint });
  const source = { ...summary, case_id: caseId, profile: 'tabular-manual-v1', bytes: input.bytes.length,
    object_key: 'software-control-original', inspection: {
      manualProfile: { version: 'manual-tabular/1', ...input.inventory },
      actor: 'local-os:a3b-software-control' } };
  const access = ingestionBinding(caseId);
  const rawBase = { version: 'geojson-stream/2', jobId: rawJobId, caseId, caseRevision: 0, sourceId, sourceRevision: 1,
    sourceFamilyId: sourceId, sourceSha256: sourcePin.sourceSha256, sourceBytes: input.bytes.length,
    objectKey: source.object_key, framing: 'tabular', tabular: input.inventory.tabular,
    subject: access.subject, accessBinding: access.access, readerSha256: streamingReaderSha() };
  const raw = AnyStreamingInputSchema.parse({ ...rawBase, inputFingerprint: fingerprint(rawBase) });
  const base = { version: 'chunk-mapping/1', jobId, caseId, caseRevision: 0, sourceId, sourceRevision: 1,
    sourceFamilyId: sourceId, sourceSha256: sourcePin.sourceSha256, rawJobId, rawInputFingerprint: fingerprint(raw),
    readerSha256: raw.readerSha256, route: 'proposal_only', recipeId: null, recipeRevision: null, planHash: null,
    schemaFingerprint: sourcePin.schemaFingerprint, workspaceFingerprint, converterSha256: chunkMappingConverterSha(),
    subject: access.subject, accessBinding: access.access, tabular: input.inventory.tabular };
  const mapped = ChunkMappingInputSchema.parse({ ...base, inputFingerprint: fingerprint(base) });
  const db = new ProtocolDb(source, { caseId, source: summary }, raw, mapped);
  return { ...input, caseId, sourceId, source, profile, db, mapped };
}

async function controls<T>(run: () => Promise<T>) {
  const globals = globalThis as any, old = globals.ulpinPool;
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const path = process.env.ULPIN_TABULAR_LEARNING_DIR;
  const adapter = process.env.ULPIN_MAPPING_TEACHER_ADAPTER;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'local-os:a3b-software-control';
  process.env.ULPIN_MAPPING_TEACHER_ADAPTER = 'manual';
  const artifactRoot = process.env.ULPIN_AGENT_TASK_ROOT ?? 'E:/BhuAayam-data/task-data/a3b';
  process.env.ULPIN_TABULAR_LEARNING_DIR = `${artifactRoot}/controls/${randomUUID()}`;
  try { return await run(); }
  finally {
    globals.ulpinPool = old;
    if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
    if (path === undefined) delete process.env.ULPIN_TABULAR_LEARNING_DIR;
    else process.env.ULPIN_TABULAR_LEARNING_DIR = path;
    if (adapter === undefined) delete process.env.ULPIN_MAPPING_TEACHER_ADAPTER;
    else process.env.ULPIN_MAPPING_TEACHER_ADAPTER = adapter;
    mock.restoreAll();
  }
}
function pool(db: ProtocolDb) {
  (globalThis as any).ulpinPool = { connect: async () => ({ query: db.query.bind(db), release() {} }),
    query: db.query.bind(db) };
}
function objectBytes(bytes: Buffer) {
  mock.getter(settings, 's3Endpoint', () => 'http://127.0.0.1:1');
  mock.getter(settings, 's3Region', () => 'us-east-1');
  mock.getter(settings, 's3Bucket', () => 'software-control');
  mock.getter(settings, 's3AccessKey', () => 'software-control-not-a-key');
  mock.getter(settings, 's3SecretKey', () => 'software-control-not-a-secret');
  mock.method(S3Client.prototype, 'send', async (command: any) => {
    if (command.constructor.name === 'PutObjectCommand') return {};
    assert.equal(command.constructor.name, 'GetObjectCommand');
    return { Body: { transformToByteArray: async () => bytes } };
  });
}

test('stream enrollment accepts tabular/GIS and rejects changed source pins', () => controls(async () => {
  const f = fixture();
  const { tabular: _tabular, ...common } = f.db.raw;
  const gis = StreamingVectorInputSchema.parse({ ...common, framing: 'feature-collection' });
  for (const input of [f.db.raw, gis]) {
    let inserted = false;
    const client = { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM jobs')) return { rows: [{ id: input.jobId, operation: 'streaming-vector',
        payload: input, case_id: f.caseId, source_id: f.sourceId, case_revision: 0,
        input_fingerprint: fingerprint(input) }] };
      if (sql.startsWith('SELECT * FROM usp_job_metadata')) return { rows: [] };
      assert(sql.startsWith('INSERT INTO usp_job_metadata'));
      inserted = true;
      return { rows: [] };
    } } as unknown as PoolClient;
    const scope = { kind: 'intake' as const, workspaceId: f.caseId, version: 1 };
    await registerUspJobInputTx(client, input.jobId, scope, f.sourceId, fingerprint(input));
    assert(inserted);
    input.sourceId = randomUUID();
    await assert.rejects(() => registerUspJobInputTx(client, input.jobId, scope, f.sourceId, fingerprint(input)),
      (error: any) => error.code === 'STREAMING_INPUT_SCOPE');
  }
}));

test('CSV receipt accepts exact public dev bytes; no-header, oversize and non-dev sources are explicit refusals', () =>
  controls(async () => {
    const f = fixture();
    pool(f.db);
    f.db.sourceExists = false;
    objectBytes(f.bytes);
    const receipt = await new ManualIngestionService().retain(f.caseId, { requestKey: randomUUID(),
      expectedWorkspaceRevision: 0, format: 'csv', selection }, { name: f.asset.id, bytes: f.bytes });
    assert.equal(receipt.version, 'manual-tabular/1');
    assert.equal(receipt.source.sourceSha256, f.asset.original.sha256);
    assert.equal(receipt.workspaceRevision, 1);
    assert(f.db.sourceExists);
    assert.throws(() => readTabularSource(Buffer.from('\n'), selection), /header|reader/i);
    assert.throws(() => inspectTabularSource(Buffer.from('not a dev original'), selection), /exact public/i);
    await assert.rejects(() => new ManualIngestionService().retain(f.caseId, { requestKey: randomUUID(),
      expectedWorkspaceRevision: 0, format: 'csv', selection }, {
      name: f.asset.id, bytes: new Uint8Array(16 * 1024 ** 2 + 1) }),
    (error: any) => error.code === 'FILE_SIZE');
  }));

test('difficult duplicate headers retain positional raw cells without invented geometry or values', () =>
  controls(async () => {
    const input = real('mi-d11-01.csv'), records: any[] = [];
    const result = await readStreamingTabular(Readable.from([input.bytes]), input.inventory.tabular,
      async item => { records.push(tabularSourceRecord(item)); });
    assert.equal(result.sha256, input.asset.original.sha256);
    assert(records.length > 0);
    assert(records.every(record => record.rawSha256 === result.sha256 && !record.feature.geometry));
    assert.equal(records[0].feature.cells.length, input.inventory.headers.length);
    const names = input.inventory.profile.columns.map(column => column.name);
    assert.equal(new Set(names).size, input.inventory.headers.length);
  }));

test('native XLSX admission reuses selected physical headers and unchanged native bounds', () => controls(async () => {
  const asset = developmentManifest().assets.find(item => item.family === 'mi-d19');
  assert(asset);
  const table = sourceTables(asset)[0];
  const bytes = readFileSync(asset.original.externalPath);
  const inventory = inspectTabularSource(bytes, { format: 'xlsx', sheet: table.name, table: null,
    headerRows: table.headerRows });
  assert.equal(inventory.headers.length, table.headers.length);
  assert.equal(sha256(bytes), asset.original.sha256);
}));

test('GIS DTOs remain valid while tabular drafts require explicit plan and selection pins', () => controls(async () => {
  const f = fixture();
  const { tabular, ...oldInput } = f.mapped;
  assert(ChunkMappingInputSchema.safeParse(oldInput).success);
  assert(!StreamingVectorInputSchema.safeParse(f.db.raw).success,
    'Unowned jobs.ts still uses this GIS-only schema; lead must adopt AnyStreamingInputSchema.');
  const oldPayload = { version: oldInput.version, jobId: oldInput.jobId, rawJobId: oldInput.rawJobId,
    sourceId: oldInput.sourceId, sourceRevision: 1, sourceSha256: oldInput.sourceSha256, chunkIndex: 0,
    rawResultSha256: fingerprint('raw'), schemaFingerprint: oldInput.schemaFingerprint, recipeRevision: 1,
    converterSha256: oldInput.converterSha256, records: [] };
  assert(ChunkMappingPayloadSchema.safeParse(oldPayload).success);
  assert(!ChunkMappingPayloadSchema.safeParse({ ...oldPayload, tabular }).success);
  assert(!ChunkMappingPayloadSchema.safeParse({ ...oldPayload, recipeRevision: null }).success);
  assertOfficerFieldOrder(f);
}));

function assertOfficerFieldOrder(f: ReturnType<typeof fixture>) {
  const mapping = manualTeacherPlan(f.inventory.profile, 'TEACHER_REPLAY_UNAVAILABLE').plan;
  const plan = { version: 'manual-tabular/1' as const, mode: 'manual_mapping' as const, source: f.profile.source,
    caseId: f.caseId, workspaceRevision: 0, workspaceFingerprint: f.profile.workspaceFingerprint,
    tabular: f.inventory.tabular, mapping, decisions: mapping.fields.map(field => ({ sourceField: field.sourceField,
      reason: 'Software protocol check, not property truth.' })) };
  const reversed = { ...plan, mapping: { ...mapping, fields: [...mapping.fields].reverse() } };
  assert.throws(() => validateTabularRecipe(reversed, TabularSourceProfileSchema.parse(f.profile), f.bytes),
    (error: any) => error.code === 'MAPPING_TABULAR_ORDER');
  assert(!AnyAuthorMappingSchema.safeParse({ requestKey: randomUUID(), expectedRecipeRevision: 0,
    destination: null, plan: { ...plan,
      decisions: plan.decisions.map(item => ({ ...item, reason: '   ' })) } }).success);
}

test('existing recipe commands record officer reasons, append approval once and replay its request idempotently', () =>
  controls(async () => {
    const f = fixture();
    pool(f.db);
    objectBytes(f.bytes);
    const service = new ManualIngestionService();
    const mapping = manualTeacherPlan(f.inventory.profile, 'TEACHER_REPLAY_UNAVAILABLE').plan;
    const authored = await service.author(f.caseId, f.sourceId, { requestKey: randomUUID(), expectedRecipeRevision: 0,
      destination: null, plan: { version: 'manual-tabular/1', mode: 'manual_mapping', source: f.profile.source,
        caseId: f.caseId, workspaceRevision: 0, workspaceFingerprint: f.profile.workspaceFingerprint,
        tabular: f.inventory.tabular, mapping, decisions: mapping.fields.map(field => ({ sourceField: field.sourceField,
          reason: 'Software protocol control: retain unsupported aggregates as unknown, not property truth.' })) } });
    const request = { requestKey: randomUUID(), expectedRecipeRevision: authored.revision };
    const approved = await service.decide(f.caseId, authored.id, request, 'approve');
    assert.equal(f.db.queuedInput?.route, 'approved_recipe');
    const eventCount = f.db.events.length;
    assert.deepEqual(await service.decide(f.caseId, authored.id, request, 'approve'), approved);
    assert.equal(f.db.events.length, eventCount);
    assert.equal(approved.approval?.provenance, 'server_configured_local_operator');
    await assert.rejects(() => service.decide(f.caseId, authored.id,
      { requestKey: randomUUID(), expectedRecipeRevision: approved.revision }, 'execute'),
    (error: any) => error.code === 'TABULAR_REGISTRY_UNQUALIFIED');
    await assert.rejects(() => learnApprovedTabularTx(f.db as unknown as PoolClient, authored, f.profile, f.source),
      (error: any) => error.code === 'TABULAR_APPROVAL_REQUIRED');
    // Simulate SQL rollback after complete immutable learning, then recover without a second partial_fit.
    let recovered: any;
    await assert.rejects(() => transaction(async client => {
      recovered = await learnApprovedTabularTx(client, approved, f.profile, f.source);
      throw new Error('A3B_LEARNING_SQL_FAILURE');
    }), /A3B_LEARNING_SQL_FAILURE/);
    const learned = await transaction(client => learnApprovedTabularTx(client, approved, f.profile, f.source));
    assert.deepEqual(learned, recovered);
    assert.equal(learned.version, 'v44');
    const replay = await transaction(client => learnApprovedTabularTx(client, approved, f.profile, f.source));
    assert.deepEqual(replay, learned);
    assertOfficerCheckpoint(learned.model);
    await assertOfficerReuse(f, learned);
  }));

function assertOfficerCheckpoint(model: string) {
  const manifest = JSON.parse(readFileSync(`${model}/manifest.json`, 'utf8'));
  assert.equal(manifest.threshold, null);
  assert(manifest.trainingExamples.some((row: any) => row.labelKind === 'officer'));
  const metrics = JSON.parse(readFileSync(`${model}/metrics.json`, 'utf8'));
  assert.equal(metrics.partialFitCalls, 1);
}

async function assertOfficerReuse(f: ReturnType<typeof fixture>, learned: { model: string; version: string }) {
  const table = readTabularSource(f.bytes, selection);
  const model = await activeTabularLearner(f.db as unknown as PoolClient);
  assert.equal(model, learned.model);
  const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0, headers: table.headers,
    rows: table.rows, sourceRef: `source:${f.sourceId}`, selection },
  { ...options(), memoryPath: tabularLearningPaths().memory,
    learnerModelPath: model, teacher: async () => { throw new Error('APPROVED_MEMORY_MUST_SKIP_TEACHER'); } });
  assert.equal(draft.metrics.layout, 'memory');
  assert.equal(draft.metrics.teacherCalls, 0);
  assert.equal(draft.metrics.learnerVersion, 'v44');
  assert.equal(draft.questions.length, 0);
  const receipt = f.db.receipt!;
  assert(receipt.plan.version === 'manual-tabular/1');
  const direct = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0, headers: table.headers,
    rows: table.rows, sourceRef: `source:${f.sourceId}`, selection }, { ...options(), learnerModelPath: model,
    approvedPlan: receipt.plan.mapping });
  assert.equal(direct.metrics.layout, 'new');
  assert.equal(direct.metrics.memoryHits, 0); // The direct officer receipt is not a lookup/cache hit.
}

async function assertSseEvent(body: unknown) {
  const event = CaseIngestionEventSchema.parse({ ...(body as object), sequence: '1',
    createdAt: new Date().toISOString(), requiresRefresh: true });
  let written = '';
  const response = { destroyed: false, writableEnded: false, writableLength: 0,
    write: (frame: string) => {
      written = frame;
      return true;
    } } as unknown as FrameResponse;
  await writeIngestionFrame(response, `event: ingestion.change\ndata: ${JSON.stringify(event)}\n\n`,
    new AbortController().signal, () => {});
  assert.equal(CaseIngestionEventSchema.parse(JSON.parse(written.split('data: ')[1].trim())).change.kind,
    'mapping.chunk');
}

test('fenced slot and mapping.chunk outbox either both commit or both roll back', () => controls(async () => {
  const f = fixture();
  pool(f.db);
  const table = readTabularSource(f.bytes, selection);
  const draft = await new TabularChunkMapper().map({ jobId: f.mapped.jobId, chunkIndex: 0, headers: table.headers,
    rows: table.rows, sourceRef: `source:${f.sourceId}` }, {
    ...options(), memoryPath: 'E:/BhuAayam-data/task-data/a3b/missing' });
  const payload = ChunkMappingPayloadSchema.parse({ version: f.mapped.version, jobId: f.mapped.jobId,
    rawJobId: f.mapped.rawJobId, sourceId: f.sourceId, sourceRevision: 1, sourceSha256: f.mapped.sourceSha256,
    chunkIndex: 0, rawResultSha256: fingerprint('raw'), schemaFingerprint: f.mapped.schemaFingerprint,
    recipeRevision: null, converterSha256: f.mapped.converterSha256, tabular: f.mapped.tabular, records: [],
    mapping: { profile: draft.profile, plan: draft.proposal.plan, fieldSources: draft.proposal.fieldSources,
      questions: draft.questions, metrics: draft.metrics, rows: draft.dryRun.rows, sourceRows: table.sourceRows } });
  const stored = { payload, bytes: Buffer.byteLength(JSON.stringify(payload)),
    hash: fingerprint(payload), key: 'draft-control' };
  const attempt = { jobId: f.mapped.jobId, number: 1, fence: 1, owner: 'control',
    inputSha256: fingerprint(f.mapped), leaseUntil: new Date(Date.now() + 180000).toISOString() };
  f.db.failOutbox = true;
  await assert.rejects(() => transaction(client => publishTabularMappingTx(client, f.mapped, attempt, stored, 0,
    fingerprint('raw'))), /A3B_OUTBOX_FAILURE/);
  assert.equal(f.db.slots.length, 0);
  assert.equal(f.db.events.length, 0);
  f.db.failOutbox = false;
  await transaction(client => publishTabularMappingTx(client, f.mapped, attempt, stored, 0, fingerprint('raw')));
  assert.equal(f.db.slots.length, 1);
  assert.equal(f.db.events.length, 1);
  assert.equal((f.db.events[0] as any).change.kind, 'mapping.chunk');
  assert(Buffer.byteLength(JSON.stringify(f.db.events[0])) < 1024);
  await assertSseEvent(f.db.events[0]);
}));

test('the worker routes real tabular rows and publishes a proposal without training', () => controls(async () => {
  const f = fixture();
  pool(f.db);
  const records: any[] = [];
  await readStreamingTabular(Readable.from([f.bytes]), f.inventory.tabular, async item => {
    if (records.length < 8) records.push(tabularSourceRecord(item));
  });
  const attempt = { jobId: f.mapped.jobId, number: 1, fence: 1, owner: 'control',
    inputSha256: fingerprint(f.mapped), leaseUntil: new Date(Date.now() + 180000).toISOString() };
  let stored: any;
  await acceptTabularDataSlot(f.mapped, attempt, { version: 'geojson-stream/2', jobId: f.db.raw.jobId,
    sourceId: f.sourceId, sourceRevision: 1, sourceSha256: f.asset.original.sha256, chunkIndex: 0, records },
  fingerprint('raw'), new TabularChunkMapper(), async payload => {
    stored = { payload, bytes: Buffer.byteLength(JSON.stringify(payload)), hash: fingerprint(payload), key: 'control' };
    return stored;
  });
  assert.equal(stored.payload.mapping.rows.length, 8);
  assert.equal(stored.payload.mapping.metrics.kind, 'mapping.chunk');
  assert.equal(f.db.slots.length, 1);
  assert(![...f.db.operations.keys()].some(key => key.startsWith('manual-learn:')));
}));
