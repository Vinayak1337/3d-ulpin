import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import test, { mock } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import type { PoolClient } from 'pg';
import { AnyStreamingStatusSchema, StreamingVectorFramingSchema,
  STREAMING_VECTOR_LIMITS as limits, StreamingVectorPayloadSchema,
  type IntakeCard, type StreamingVectorInput } from '@ulpin/contracts/usp';
import { INTAKE_LARGE_LAYOUT_QUESTION, INTAKE_LARGE_STOPPED, intakeLargeAtRest, intakeLargeCutKey, intakeLargeEnd,
  intakeLargeFailureContext, intakeLargeFailureReason, intakeLargePhase, intakeLargePlan, intakeLargeProjection,
  intakeLargeRequestKey, intakeLargeRows, intakeLargeStepCurrent, largeStateKey,
  queueIntakeLargePackageTx, queueIntakeLargeTx, retryIntakeLargeItem, type IntakeLargeSource,
  type IntakeLargeStore } from './intake-large';
import { fingerprint } from '../../cases/domain';
import { settings } from '../../../infrastructure/config';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { queueIntakeDraftTx } from './intake-draft';
import type { IntakeSourceRow } from './intake-context';
import { localOperatorSubject } from '../principal';
import { sealedMapReceipt } from './streamed-map-receipt';
import { probeOriginal } from './intake-probe';
import { INTAKE_WIDE_GEOJSON_REASON } from './intake-package-extent';
import { runIntakeLargeJob } from './intake-large-worker';
import { StreamedProfileService } from './streamed-profile';
import { StreamingVectorService } from './streaming-vector';
import { ChunkMappingService } from './chunk-mapping';
import { prefixSealCheckKey } from './streamed-mapping';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { StreamingPartWriter } from './streaming-vector-worker';

const caseId = '20000000-0000-4000-8000-000000000001';
const sourceId = '20000000-0000-4000-8000-000000000002';
const readerJob = '20000000-0000-4000-8000-000000000003';
const profileJob = '20000000-0000-4000-8000-000000000004';
const mappingJob = '20000000-0000-4000-8000-000000000005';
const recipeId = '20000000-0000-4000-8000-000000000006';
const hash = 'b'.repeat(64);
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-large-protocol';

function sourceRow(bytes = 43263076) {
  return { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, bytes, sha256: hash,
    profile: 'large-original-v1', object_key: 'protocol-original', name: 'protocol.geojson', status: 'needs_input',
    inspection: { largeOriginal: { uploadId: sourceId, operatorSubject: localOperatorSubject(),
      objectEtag: 'protocol-etag', verifiedSha256: hash, verifiedBytes: bytes, conversion: 'unsupported',
      bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
      provenance: { issuer: 'Protocol test issuer', originalUrl: 'https://example.invalid/protocol',
        acquiredAt: '2026-10-11T00:00:00.000Z', permissionReference: 'Protocol only', limitations: [],
        state: 'caller_declared' } } } };
}

const sealedReader = () => ({ job_id: readerJob, state: 'completed', issue_code: null, next_publish_index: 487,
  records: 48686, quarantined: 0, sealed_chunks: 487, unknown_remainder: false });

/** Stored rows the key reads, and the jobs table the wake-up writes; any other statement fails the test. */
function store(overrides: Partial<{ item: Record<string, unknown> | null; bytes: number;
  source: IntakeSourceRow | null;
  reader: Record<string, unknown> | null; profile: Record<string, unknown> | null;
  recipe: Record<string, unknown> | null; mapping: Record<string, unknown> | null; parts: number;
  unreviewed: number; partOf: string | null }> = {}) {
  const tables = { item: { item_id: sourceId, case_id: caseId, state: 'probed', placement: 'undecided',
    card: { family: 'vector', format: 'geojson', crs: { code: null } }, plan_ref: null, family: 'vector',
    parent_item_id: null, source_id: sourceId, limit_reason: null, records_seen: 0, parts_planned: null,
    parts_done: 0 } as Record<string, unknown> | null, bytes: 43263076, reader: null, profile: null, recipe: null,
  mapping: null, parts: 0, unreviewed: 0, partOf: null, source: null, ...overrides };
  const jobs = new Map<string, Record<string, unknown>>();
  const operations = new Map<string, { payload_hash: string; result: Record<string, unknown> }>();
  let metadata = 0;
  const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const client = { query: async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT item_id,case_id,state,placement')) return one(tables.item);
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return one(tables.item);
    if (sql.startsWith('SELECT id,revision,bytes,profile') || sql.startsWith('SELECT * FROM sources'))
      return one(tables.source ?? sourceRow(tables.bytes));
    if (sql.startsWith('SELECT job_id,state,issue_code,next_publish_index,records,quarantined'))
      return one(tables.reader);
    if (sql.startsWith('SELECT job_id,state,issue_code,sealed_generation')) return one(tables.profile);
    if (sql.startsWith('SELECT job_id,state,issue_code,next_publish_index,records,sealed_chunks'))
      return one(tables.mapping);
    if (sql.startsWith('SELECT id,revision,state,body')) return one(tables.recipe);
    if (sql.startsWith('SELECT count(*)::int n FROM usp_intake_parts WHERE')) return one({ n: tables.parts });
    if (sql.startsWith('SELECT count(*)::int n FROM usp_intake_parts part')) return one({ n: tables.unreviewed });
    if (sql.startsWith('SELECT i.source_id FROM usp_intake_parts')) return one(tables.partOf
      && { source_id: tables.partOf });
    if (sql.startsWith("SELECT id FROM jobs WHERE id=$1 AND operation='intake-large'"))
      return one(jobs.has(values[0] as string) && { id: values[0] });
    if (sql.startsWith("SELECT id FROM jobs WHERE source_id=$1 AND operation='intake-large'"))
      return one([...jobs.values()].find(job => job.source_id === values[0]
        && (!sql.includes("status='queued'") || job.status === 'queued' && job.dispatched_at == null)));
    if (sql.startsWith('SELECT id,revision,archived FROM cases')) return one({ id: caseId, revision: 3,
      archived: false });
    if (sql.startsWith('INSERT INTO jobs')) {
      if (jobs.has(values[0] as string)) return one(null);
      jobs.set(values[0] as string, { id: values[0], case_id: values[1], source_id: values[2],
        operation: 'intake-large', status: 'queued', dispatched_at: null,
        case_revision: values[3], input_fingerprint: values[4], payload: values[5] });
      return one({});
    }
    if (sql.startsWith('SELECT * FROM jobs WHERE id=$1 FOR UPDATE')) return one(jobs.get(values[0] as string));
    if (sql.startsWith('SELECT * FROM usp_job_metadata')) return one(null);
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      metadata++;
      return one(null);
    }
    if (sql.startsWith('SELECT COALESCE(max((result')) return one({ generation: 0 });
    if (sql.startsWith('SELECT operation,payload FROM jobs')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT count(*)::int n FROM operations')) return one({ n: [...operations.values()]
      .filter(row => row.result.itemId === values[1]).length });
    if (sql.startsWith('SELECT payload_hash,result FROM operations')) return one(operations.get(values[1] as string));
    if (sql.startsWith('INSERT INTO operations')) {
      operations.set(values[1] as string, { payload_hash: values[2] as string,
        result: values[3] as Record<string, unknown> });
      return one({});
    }
    if (sql.startsWith('UPDATE operations SET result')) {
      operations.get(values[1] as string)!.result = values[2] as Record<string, unknown>;
      return one({});
    }
    if (sql.startsWith('SELECT source_id FROM usp_intake_items')) return one(tables.item?.item_id === values[1]
      && tables.item);
    if (sql.startsWith('SELECT state,placement') || sql.startsWith('SELECT parts_planned')) return one(tables.item);
    if (sql.startsWith('UPDATE sources SET inspection=inspection||')) {
      Object.assign(tables.source!.inspection!, JSON.parse(values[1] as string));
      return one({});
    }
    if (sql.startsWith('UPDATE usp_intake_items SET card=')) {
      tables.item!.card = values[1];
      return one({});
    }
    if (sql.startsWith('UPDATE usp_intake_items SET parts_planned')) {
      Object.assign(tables.item!, { parts_planned: values[2], parts_done: values[3] });
      return one({});
    }
    if (sql.startsWith('UPDATE usp_intake_items SET state')) {
      Object.assign(tables.item!, { state: values[2], placement: values[3], plan_ref: values[4],
        records_seen: values[5], limit_reason: values[6] });
      return one({});
    }
    if (sql.startsWith('SELECT item_id AS')) return one({ itemId: sourceId, state: tables.item!.state,
      family: 'vector', format: 'geojson', sizeClass: 'M', wave: 1, pinnedByOfficer: false });
    if (sql.startsWith('SELECT revision FROM cases')) return one({ revision: 3 });
    if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: '1' });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('INSERT INTO usp_outbox')
      || sql.startsWith('SELECT pg_advisory_xact_lock')) return one(null);
    throw new Error(`Unexpected statement: ${sql}`);
  } } as unknown as PoolClient;
  return { client, tables, jobs, operations, metadata: () => metadata };
}

const card = { family: 'vector', format: 'geojson' } as IntakeCard;

for (const scenario of ['STREAMED_PROFILE_CAPACITY', 'STREAMING_CAPACITY', 'MAPPING_CAPACITY',
  'STALE_REVISION', 'PREFIX_MAPPING_CAPACITY', 'STALE_MAPPING_WAKE', 'STALE_PREFIX_MAPPING_WAKE'] as const) {
  const prefix = scenario === 'PREFIX_MAPPING_CAPACITY' || scenario === 'STALE_PREFIX_MAPPING_WAKE';
  const capacity = prefix || scenario === 'STALE_MAPPING_WAKE' ? 'MAPPING_CAPACITY' : scenario;
  const waitCount = capacity === 'STALE_REVISION' ? 2 : 3;
  test(`${scenario} waits ${waitCount} times without attempts; starts readers or stops after 30 minutes`, async () => {
    const fixture = store();
    if (capacity === 'STREAMING_CAPACITY') {
      const feature = '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[]},"properties":{}}';
      const bytes = Buffer.from(`${feature}\n${feature}\n`);
      fixture.tables.item!.card = await probeOriginal(async (start, end) => bytes.subarray(start, end),
        bytes.length, 'test_only.geojsonl');
    }
    if (capacity === 'MAPPING_CAPACITY') Object.assign(fixture.tables, { source: retained,
      reader: sealedReader(), profile: { job_id: profileJob, state: 'sealed', sealed_generation: 487 },
      recipe: { id: recipeId, revision: 2, state: 'approved' } });
    if (prefix) {
      Object.assign(fixture.tables.reader!, { state: 'running', sealed_chunks: null, unknown_remainder: true });
      Object.assign(fixture.tables.profile!, { state: 'running', sealed_generation: null,
        layout_profile: { generation: 0, generationHash: hash, coverage: 'provisional',
          recordsSeen: 100, accepted: 100 } });
      fixture.tables.recipe!.plan_version = 'streamed-prefix-mapping/1';
    }
    if (capacity === 'STREAMED_PROFILE_CAPACITY' || capacity === 'STALE_REVISION') {
      fixture.tables.reader = { ...sealedReader(), state: 'running', sealed_chunks: null };
    }
    const initialReader = fixture.tables.reader;
    const jobId = (await queueIntakeLargeTx(fixture.client, sourceId))!;
    assert.ok(jobId, 'the supported vector framing must enqueue its first step');
    const job = fixture.jobs.get(jobId)!;
    if (scenario === 'STALE_MAPPING_WAKE' || scenario === 'STALE_PREFIX_MAPPING_WAKE') {
      (job.payload as { stateKey: string }).stateKey = '0'.repeat(64);
      job.input_fingerprint = fingerprint(job.payload);
    }
    Object.assign(job, { status: 'queued', attempts: 0 });
    const meta = { logical_state: 'queued', input_sha256: job.input_fingerprint };
    const attempts: Record<string, any>[] = [], waits: number[] = [];
    let refusals = waitCount, currentRevision = 3;
    const profileRevisions: number[] = [];
    const one = (row?: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    const original = fixture.client.query.bind(fixture.client) as any;
    const query = async (sql: string, values: any[] = []) => {
      if (sql.startsWith("SELECT * FROM jobs WHERE id=$1 AND operation='intake-large'")) return one(job);
      if (sql.startsWith('SELECT max(revision)')) return one({ revision: 1 });
      if (sql.startsWith('SELECT revision FROM cases') || sql.startsWith('SELECT id,revision,archived FROM cases'))
        return one({ id: caseId, revision: currentRevision, archived: false });
      if (sql.startsWith('SELECT status,')) {
        assert.match(sql, /dispatched_at <= now\(\)-interval '30 minutes'/);
        return one({ ...job, expired: job.dispatched_at != null
          && Number(job.dispatched_at) <= Date.now() - 1800000 });
      }
      if (sql.startsWith('SELECT status FROM jobs')) return one(job);
      if (sql.startsWith('SELECT * FROM usp_job_metadata') && values[0] === jobId) return one(meta);
      if (sql.startsWith('SELECT job_id FROM usp_job_metadata')) return one({ job_id: jobId });
      if (sql.startsWith('SELECT 1 FROM usp_job_attempts')) return one();
      if (sql.startsWith('SELECT * FROM usp_job_attempts')) return one(attempts.at(-1));
      if (sql.startsWith('INSERT INTO usp_job_attempts')) {
        if (capacity === 'MAPPING_CAPACITY') assert.ok(fixture.tables.mapping,
          'approved mapping is admitted before the step claim, even for an obsolete wake key');
        const row = { number: values[1], fence: values[2], owner: values[3], input_sha256: values[4],
          state: 'active', lease_until: new Date(Date.now() + 180000) };
        attempts.push(row);
        return one(row);
      }
      if (sql.startsWith('UPDATE usp_job_attempts')) { attempts.at(-1)!.state = 'accepted'; return one(); }
      if (sql.startsWith('UPDATE usp_job_metadata')) {
        if (sql.includes("='failed'")) meta.logical_state = 'failed';
        else if (sql.includes("='running'")) meta.logical_state = 'running';
        else meta.logical_state = 'succeeded';
        return one();
      }
      if (sql.startsWith('UPDATE jobs')) {
        if (sql.includes("='failed'")) job.status = 'failed';
        else if (sql.includes("='queued'")) job.status = 'queued';
        else if (sql.includes("='succeeded'")) job.status = 'succeeded';
        else job.status = 'running';
        if (sql.includes('attempts=$2')) job.attempts = values[1];
        if (sql.includes('dispatched_at=COALESCE')) job.dispatched_at ??= new Date();
        if (sql.includes("interval '2 seconds'")) {
          job.next_attempt_at = Date.now() + 2000;
          waits.push(Number(job.next_attempt_at));
        }
        job.error = values[1];
        return one();
      }
      if (sql.startsWith('SELECT a.name')) return one();
      if (sql.startsWith('SELECT body FROM usp_mapping_recipes')) return one({ body: { plan: {
        version: prefix ? 'streamed-prefix-mapping/1' : 'streamed-mapping/1' } } });
      return original(sql, values);
    };
    const globals = globalThis as typeof globalThis & { ulpinPool?: unknown }, previous = globals.ulpinPool;
    globals.ulpinPool = { query, connect: async () => ({ query, release: () => {} }) };
    mock.method(StreamingVectorService.prototype, 'enqueue', async (
      _caseId: string, _sourceId: string, value: unknown,
    ) => {
      assert.equal((value as { framing: string }).framing,
        capacity === 'STREAMING_CAPACITY' ? 'geojson-lines' : 'feature-collection');
      if (capacity === 'STREAMING_CAPACITY' && refusals-- > 0) throw new AppError(429, capacity, 'Occupied.');
      return { jobId: readerJob };
    });
    mock.method(StreamedProfileService.prototype, 'enqueue', async (
      _caseId: string, _sourceId: string, value: unknown,
    ) => {
      if (capacity === 'STALE_REVISION') {
        const revision = (value as { expectedCaseRevision: number }).expectedCaseRevision;
        profileRevisions.push(revision);
        assert.equal(revision, currentRevision);
        if (refusals-- > 0) {
          currentRevision++;
          throw new AppError(409, capacity, 'The case changed before profile admission.');
        }
      }
      if (capacity === 'STREAMED_PROFILE_CAPACITY' && refusals-- > 0) throw new AppError(429, capacity, 'Occupied.');
      fixture.tables.reader ??= { ...sealedReader(), state: 'queued' };
      fixture.tables.profile = { job_id: profileJob, state: 'queued', sealed_generation: null };
      return { jobId: profileJob };
    });
    mock.method(ChunkMappingService.prototype, 'enqueue', async (
      _caseId: string, _sourceId: string, value: unknown,
    ) => {
      assert.equal((value as { prefixAdmissionVersion?: string }).prefixAdmissionVersion,
        prefix ? 'streamed-prefix-admission/1' : undefined);
      if (prefix) assert.equal(fixture.tables.reader!.state, 'running', 'mapping enqueues before the seal');
      if (refusals-- > 0) throw new AppError(429, capacity, 'Occupied.');
      fixture.tables.mapping = { ...sealedReader(), job_id: mappingJob, state: 'queued' };
      return { jobId: mappingJob };
    });
    try {
      let firstDispatch: unknown;
      for (let count = 1; count <= waitCount; count++) {
        const now = Date.now();
        await runIntakeLargeJob(jobId);
        assert.deepEqual([job.status, job.attempts, attempts.length, waits.length], ['queued', 0, 0, count]);
        assert(waits.at(-1)! >= now + 2000 && waits.at(-1)! <= Date.now() + 2000);
        if (count === 1) firstDispatch = job.dispatched_at;
        assert.equal(job.dispatched_at, firstDispatch, 'waiting never extends the deadline');
        assert.match(String(fixture.tables.item!.limit_reason), /Waiting for a free reader/);
      }
      await runIntakeLargeJob(jobId);
      assert.equal(job.status, 'succeeded');
      assert.equal(job.attempts, 1, 'only the successful step claims an attempt');
      assert.equal(fixture.tables.profile!.job_id, profileJob);
      assert.equal(fixture.tables.parts, 0, 'admission never drafts a part');
      if (capacity === 'STALE_REVISION') assert.deepEqual(profileRevisions, [3, 4, 5]);
      if (capacity === 'MAPPING_CAPACITY') fixture.tables.mapping = null;
      else {
        fixture.tables.reader = initialReader;
        fixture.tables.profile = null;
      }
      Object.assign(job, { status: 'queued', attempts: 0 });
      attempts.length = 0;
      refusals = 1;
      job.dispatched_at = new Date(Date.now() - 1800001);
      await runIntakeLargeJob(jobId);
      assert.deepEqual([job.status, job.error, job.attempts, attempts.length], ['failed', capacity, 0, 0]);
      assert.match(String(fixture.tables.item!.limit_reason), /within 30 minutes/);
    } finally {
      globals.ulpinPool = previous;
      mock.restoreAll();
    }
  });
}

test('enrollment queues one step job for a large GeoJSON within the ceiling and none above it', async () => {
  const within = store();
  const jobId = await queueIntakeDraftTx(within.client, sourceRow() as IntakeSourceRow, card);
  assert.match(String(jobId), /^[0-9a-f-]{36}$/);
  assert.equal(within.jobs.size, 1);
  assert.equal(within.metadata(), 1);
  const payload = within.jobs.get(jobId!)!.payload as Record<string, unknown>;
  assert.equal(payload.version, 'intake-large/1');
  assert.equal(payload.caseRevision, 3);
  assert.equal(await queueIntakeDraftTx(within.client, sourceRow() as IntakeSourceRow, card), jobId);
  assert.equal(within.jobs.size, 1);
  assert.equal(within.metadata(), 1);
  within.tables.item!.state = 'preparing';
  assert.equal(await queueIntakeDraftTx(within.client, sourceRow() as IntakeSourceRow, card), jobId);
  assert.equal(within.jobs.size, 1);
  const above = store({ bytes: limits.sourceBytes + 1 });
  assert.equal(await queueIntakeLargeTx(above.client, sourceId), null);
  assert.equal(above.jobs.size, 0);
});

test('newline .geojsonl and .geojsons enrol the same first job as a record-separated sequence', async () => {
  const feature = '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[]},"properties":{}}';
  const jobIds: (string | null)[] = [];
  for (const [name, prefix] of [['test_only.geojsonl', ''], ['test_only.geojsons', ''],
    ['test_only.geojsons', '\x1e']] as const) {
    const bytes = Buffer.from(`${prefix}${feature}\n${prefix}${feature}\n`);
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);
    const fixture = store();
    fixture.tables.item!.card = card;
    const source = { ...sourceRow(), name } as IntakeSourceRow;
    const jobId = await queueIntakeDraftTx(fixture.client, source, card);
    assert.ok(jobId, 'a probed, undecided item whose source needs input must not lose its wake-up');
    assert.equal(fixture.jobs.size, 1);
    assert.equal(fixture.jobs.get(jobId)!.operation, 'intake-large');
    assert.equal(await queueIntakeDraftTx(fixture.client, source, card), jobId, 'no duplicate first job');
    jobIds.push(jobId);
    fixture.tables.source = structuredClone(retained) as IntakeSourceRow;
    fixture.tables.source.inspection!.streamedMapReceipt.framing = prefix ? 'geojson-seq-rs' : 'geojson-lines';
    Object.assign(fixture.tables, stored());
    const state = (await largeStateKey(fixture.client, sourceId))!;
    assert.equal(project(state.store, state.source).placement, 'needs_answer');
    assert.equal(project(state.store, state.source).limitReason, INTAKE_LARGE_LAYOUT_QUESTION);
  }
  assert.equal(new Set(jobIds).size, 1, 'the state, not the suffix, names the first job');
});

test('combined reader status admits exactly the vector framings and tabular, not arbitrary text', () => {
  const framing = AnyStreamingStatusSchema.shape.framing;
  assert.deepEqual(framing.options, [...StreamingVectorFramingSchema.options, 'tabular']);
  for (const value of [null, '', 'ndjson', 'csv', 'test_only_unknown']) {
    assert.equal(framing.safeParse(value).success, false);
  }
});

for (const name of ['test_only.geojsonl', 'test_only.geojsonl.csv']) {
  test(`${name}: real reader admission survives the status parse and prepares its first newline part`, async () => {
    // Synthetic shape only: no source rows, inferred identifiers, height units or whole-file count.
    const feature = JSON.stringify({ type: 'Feature', properties: { height: -1, confidence: 0.9 },
      geometry: { type: 'Polygon', coordinates: [[[1, 2], [1.001, 2], [1.001, 2.001], [1, 2]]] } });
    const head = Buffer.from(`${feature}\n${feature}\n`), bytes = 799737067;
    const fixture = store({ bytes });
    fixture.tables.source = { ...sourceRow(bytes), name, mime_type: 'application/octet-stream' } as IntakeSourceRow;
    fixture.tables.item!.card = await probeOriginal(async (start, end) => head.subarray(start, end), head.length, name);
    assert.equal((fixture.tables.item!.card as IntakeCard).format, 'ndjson');
    const stepId = (await queueIntakeLargeTx(fixture.client, sourceId))!;
    const job = fixture.jobs.get(stepId)!;
    Object.assign(job, { status: 'queued', attempts: 0 });
    const meta = { logical_state: 'queued', input_sha256: job.input_fingerprint };
    let readerMeta: unknown, rawJob: Record<string, any> | undefined;
    const attempts: Record<string, any>[] = [], slots: Record<string, unknown>[] = [];
    const one = (row?: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    const original = fixture.client.query.bind(fixture.client) as any;
    const query = async (sql: string, values: any[] = []) => {
      if (sql.startsWith('SELECT max(revision)')) return one({ revision: 1 });
      if (sql.startsWith('SELECT a.name')) return one();
      if (sql.startsWith('SELECT payload_hash,result FROM operations') && String(values[1]).startsWith('streaming'))
        return one();
      if (sql.startsWith('SELECT count(*)::int queued')) return one({ queued: 0, case_queued: 0 });
      if (sql.startsWith('SELECT count(*)::int n FROM operations') && values.length === 1) return one({ n: 0 });
      if (sql.startsWith('INSERT INTO jobs') && sql.includes("'streaming-vector'")) {
        rawJob = { id: values[0], case_id: values[1], source_id: values[2], operation: 'streaming-vector',
          case_revision: values[3], input_fingerprint: values[4], payload: values[5], status: 'queued' };
        return one({});
      }
      if (sql.startsWith('SELECT * FROM jobs') && values[0] === rawJob?.id) return one(rawJob);
      if (sql.startsWith('SELECT * FROM jobs') && values[0] === stepId) return one(job);
      if (sql.startsWith('SELECT status FROM jobs')) return one(job);
      if (sql.startsWith('SELECT 1 FROM usp_job_attempts')) return one();
      if (sql.startsWith('SELECT * FROM usp_job_attempts')) return one(attempts.at(-1));
      if (sql.startsWith('SELECT * FROM usp_job_metadata') && values[0] === rawJob?.id) return one(readerMeta);
      if (sql.startsWith('SELECT * FROM usp_job_metadata') && values[0] === stepId) return one(meta);
      if (sql.startsWith('INSERT INTO usp_job_metadata') && values[0] === rawJob?.id) {
        readerMeta = { input_sha256: values[2] };
        return one();
      }
      if (sql.startsWith('INSERT INTO usp_streaming_vector_imports')) {
        fixture.tables.reader = { job_id: rawJob!.id, state: 'queued', next_publish_index: 0, records: 0,
          accepted: 0, quarantined: 0, sealed_chunks: null, unknown_remainder: true, issue_code: null };
        return one();
      }
      if (sql.startsWith('SELECT * FROM usp_streaming_vector_imports')) return one(fixture.tables.reader);
      if (sql.startsWith('SELECT * FROM usp_streaming_vector_slots')) return { rows: [...slots].reverse() };
      if (sql.startsWith('INSERT INTO usp_job_attempts')) {
        const row = { number: values[1], fence: values[2], owner: values[3], input_sha256: values[4],
          state: 'active', lease_until: new Date(Date.now() + 180000) };
        attempts.push(row);
        return one(row);
      }
      if (sql.startsWith('UPDATE usp_job_attempts SET failure_cause')) {
        attempts.at(-1)!.failure_cause = values[2];
        return one();
      }
      if (sql.startsWith('UPDATE usp_job_attempts')) { attempts.at(-1)!.state = 'accepted'; return one(); }
      if (sql.startsWith('UPDATE usp_job_metadata')) {
        meta.logical_state = sql.includes("='running'") ? 'running' : 'succeeded';
        return one();
      }
      if (sql.startsWith('UPDATE jobs')) {
        job.status = sql.includes("status='succeeded'") ? 'succeeded' : 'running';
        if (sql.includes('attempts=$2')) job.attempts = values[1];
        return one();
      }
      return original(sql, values);
    };
    const globals = globalThis as typeof globalThis & { ulpinPool?: unknown }, previous = globals.ulpinPool;
    globals.ulpinPool = { query, connect: async () => ({ query, release: () => {} }) };
    mock.method(StreamedProfileService.prototype, 'enqueue', async () => {
      fixture.tables.profile = { job_id: profileJob, state: 'queued', sealed_generation: null };
      return { jobId: profileJob };
    });
    try {
      await runIntakeLargeJob(stepId);
      assert.equal(job.status, 'succeeded');
      assert.equal(job.attempts, 1);
      assert.equal(rawJob!.payload.framing, 'geojson-lines');
      assert.equal(rawJob!.payload.sourceBytes, bytes, 'the real size fits the unchanged 1 GiB ceiling');
      assert.equal(fixture.tables.profile!.state, 'queued');
      const service = new StreamingVectorService();
      assert.equal((await service.status(caseId, sourceId, rawJob!.id)).framing, 'geojson-lines');
      const body = new Readable({ read() {} });
      const parts = new StreamingPartWriter(async (index, records) => {
        const payload = StreamingVectorPayloadSchema.parse({ version: limits.version, jobId: rawJob!.id,
          sourceId, sourceRevision: 1, sourceSha256: hash, chunkIndex: index, records });
        assert.ok(payload.records.every(record => record.disposition === 'accepted'));
        if (index !== 0) return;
        assert.equal(body.readableEnded, false, 'the first part prepares before EOF');
        assert.equal(records.length, limits.chunkFeatures);
        const encoded = Buffer.from(JSON.stringify(payload)), digest = sha256(encoded);
        slots.push({ chunk_index: 0, status: 'ready', published: true, first_feature_index: 0,
          last_feature_index: 99, records: 100, accepted: 100, quarantined: 0, bytes: encoded.length,
          object_key: 'test-only-first-part', object_sha256: digest, result_sha256: digest,
          issue_code: null, attempt: 1, fence: 1 });
        Object.assign(fixture.tables.reader!, { state: 'running', next_publish_index: 1,
          records: 100, accepted: 100 });
        const status = await service.status(caseId, sourceId, rawJob!.id);
        assert.equal(status.slots[0].records, 100);
        assert.equal(status.framing, 'geojson-lines');
        assert.equal(status.unknownRemainder, true);
        body.push(`${feature}\n`);
        body.push(null);
      });
      body.push(`${feature}\n`.repeat(limits.chunkFeatures));
      try {
        await readStreamingFeatures(body, rawJob!.payload.framing,
          item => parts.add(sourceRecord(item), limits.chunkFeatures));
        await parts.flush();
        assert.equal(parts.index, 2);
      } finally { body.destroy(); }
      assert.equal(fixture.tables.item!.placement, 'undecided', 'a raw part does not grant registry admission');
    } finally {
      globals.ulpinPool = previous;
      mock.restoreAll();
    }
  });
}

test('the large state gate keeps non-vector cards out, including table NDJSON', async () => {
  for (const format of ['ndjson', 'geojson-seq', 'geojson']) {
    const fixture = store();
    fixture.tables.item!.card = { family: 'table', format };
    assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), null);
    assert.equal(fixture.jobs.size, 0);
  }
});

test('a small wide file enrols the existing streaming chain once, even if a bounded profile appears on replay',
  async () => {
    const source = sourceRow(512) as IntakeSourceRow;
    source.inspection!.intakeExtent = { bounds: [-74, 40.7, -71.8, 40.7], fitsOneArea: false };
    const fixture = store({ source, bytes: 512 });
    fixture.tables.item!.card = { ...card, counts: { features: 2 } };
    const jobId = await queueIntakeDraftTx(fixture.client, source, card);
    assert.match(String(jobId), /^[0-9a-f-]{36}$/);
    assert.equal(fixture.jobs.size, 1);
    assert.equal(fixture.metadata(), 1);
    assert.equal([...fixture.jobs.values()][0].operation, 'intake-large');
    // A later profile/probe must not start the bounded reader alongside the one already enrolled.
    delete source.inspection!.intakeExtent;
    source.inspection!.manualProfile = { version: 'manual-geojson/1', format: 'geojson', featureCount: 2 };
    assert.equal(await queueIntakeDraftTx(fixture.client, source, card), jobId);
    assert.equal(fixture.jobs.size, 1);
    assert.equal(fixture.metadata(), 1);
    fixture.jobs.get(jobId!)!.status = 'succeeded';
    assert.equal(await queueIntakeDraftTx(fixture.client, source, card), jobId);
    assert.equal(fixture.jobs.size, 1);
  });

test('a source that is not a large batch item, or an item at rest, queues nothing', async () => {
  assert.equal(await queueIntakeLargeTx(store({ item: null }).client, sourceId), null);
  const tabular = store();
  (tabular.tables.item as Record<string, unknown>).card = { family: 'vector', format: 'csv', crs: { code: null } };
  assert.equal(await queueIntakeLargeTx(tabular.client, sourceId), null);
  for (const [state, placement] of [['read', 'on_map'], ['read', 'not_understood'], ['failed_part', 'not_understood']]) {
    const resting = store();
    Object.assign(resting.tables.item!, { state, placement });
    assert.equal(await queueIntakeLargeTx(resting.client, sourceId), null);
    assert.equal(resting.jobs.size, 0);
  }
  assert.equal(await queueIntakeLargePackageTx(store().client, sourceId), null);
});

test('a completed cell wait names one later step without changing the fold or spending a failure retry', async () => {
  const fixture = store({ source: structuredClone(retained) as IntakeSourceRow });
  const before = (await largeStateKey(fixture.client, sourceId))!;
  const first = await queueIntakeLargeTx(fixture.client, sourceId);
  fixture.tables.source!.inspection!.intakeCellReceiptWait = { jobId: first };
  // The waiting step is the one running when it records its wait, so it no longer absorbs a new wake (S5.42b).
  Object.assign(fixture.jobs.get(first!)!, { status: 'running', dispatched_at: new Date() });
  const after = (await largeStateKey(fixture.client, sourceId))!;
  assert.notEqual(after.key, before.key);
  assert.equal(intakeLargeCutKey(after.store), intakeLargeCutKey(before.store));
  assert.equal(after.retries, 0);
  const next = await queueIntakeLargeTx(fixture.client, sourceId);
  assert.notEqual(next, first);
  assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), next);
  assert.equal(fixture.jobs.size, 2);
});

test('each stored state change names one new job, and a second wake-up for the same state adds none', async () => {
  const fixture = store();
  const states: Array<() => void> = [
    () => { fixture.tables.reader = { ...sealedReader(), state: 'running', sealed_chunks: null };
      fixture.tables.profile = { job_id: profileJob, state: 'running', issue_code: null, sealed_generation: null }; },
    () => { fixture.tables.reader = sealedReader(); },
    () => { fixture.tables.profile = { job_id: profileJob, state: 'sealed', issue_code: null, sealed_generation: 487 }; },
    () => { fixture.tables.recipe = { id: recipeId, revision: 1, state: 'proposed' }; },
    () => { fixture.tables.recipe = { id: recipeId, revision: 2, state: 'approved' }; },
    () => { fixture.tables.mapping = { ...sealedReader(), job_id: mappingJob }; },
    () => { fixture.tables.parts = 1; fixture.tables.unreviewed = 1; },
    () => { fixture.tables.unreviewed = 0; },
  ];
  const ids = new Set([await queueIntakeLargeTx(fixture.client, sourceId)]);
  for (const change of states) {
    for (const job of fixture.jobs.values()) job.status = 'succeeded';
    change();
    const jobId = await queueIntakeLargeTx(fixture.client, sourceId);
    assert(!ids.has(jobId));
    ids.add(jobId);
    assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), jobId);
  }
  assert.equal(fixture.jobs.size, states.length + 1);
  for (const job of fixture.jobs.values()) job.status = 'succeeded';
  fixture.tables.partOf = sourceId;
  fixture.tables.parts = 8;
  fixture.tables.unreviewed = 8;
  const pressure = await queueIntakeLargeTx(fixture.client, sourceId);
  fixture.jobs.get(pressure!)!.status = 'succeeded';
  fixture.tables.unreviewed = 7;
  const reviewed = await queueIntakeLargePackageTx(fixture.client, 'protocol-package');
  assert(!ids.has(reviewed));
  assert.equal(fixture.jobs.size, states.length + 3);
});

test('reviews wake only witnessed pressure; delayed reviews and stale completion keep the continuation', async () => {
  const fixture = store({ partOf: sourceId, parts: 8 });
  for (const unreviewed of [0, 1, 2, 3, 4, 5, 6, 8]) {
    fixture.tables.unreviewed = unreviewed;
    assert.equal(await queueIntakeLargePackageTx(fixture.client, 'protocol-package'), null);
  }
  assert.equal(fixture.jobs.size, 0);
  // A paused fold's completion may settle before the review, or after it: either order keeps a job.
  fixture.tables.unreviewed = 8;
  const paused = await queueIntakeLargeTx(fixture.client, sourceId);
  fixture.jobs.get(paused!)!.status = 'succeeded';
  fixture.tables.unreviewed = 7;
  const released = await queueIntakeLargePackageTx(fixture.client, 'protocol-package');
  assert(released && released !== paused);
  assert.equal(await queueIntakeLargePackageTx(fixture.client, 'protocol-package'), released);
  fixture.jobs.get(released)!.status = 'succeeded';
  fixture.tables.unreviewed = 6;
  // Both reviews may commit before either enqueue runs: below seven must still wake witnessed pressure.
  const continued = await queueIntakeLargePackageTx(fixture.client, 'protocol-package');
  assert(continued && continued !== released);
  // A queued job made obsolete by the second review still completes into this latest stored key.
  assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), continued);
  const delayed = store({ partOf: sourceId, parts: 8, unreviewed: 8 });
  await queueIntakeLargeTx(delayed.client, sourceId);
  delayed.tables.unreviewed = 6;
  assert(await queueIntakeLargePackageTx(delayed.client, 'protocol-package'));
  const reviewFirst = store({ partOf: sourceId, parts: 8, unreviewed: 6 });
  assert.equal(await queueIntakeLargePackageTx(reviewFirst.client, 'protocol-package'), null);
  assert(await queueIntakeLargeTx(reviewFirst.client, sourceId));
  // Without pressure, reviews need no job: the active fold queues its final cut key at completion.
  fixture.tables.parts = 9;
  fixture.tables.unreviewed = 0;
  assert.equal(await queueIntakeLargePackageTx(fixture.client, 'protocol-package'), null);
  // A waiting obsolete key absorbs the wake, then its completion queues the current state.
  assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), continued);
  fixture.jobs.get(continued)!.status = 'succeeded';
  assert.notEqual(await queueIntakeLargeTx(fixture.client, sourceId), continued);
});

function publishedStore() {
  const fixture = store({ source: structuredClone(retained) as IntakeSourceRow, reader: sealedReader(),
    profile: { job_id: profileJob, state: 'sealed', sealed_generation: 487, layout_profile: {
      generation: 487, generationHash: hash, coverage: 'sealed', recordsSeen: 48686, accepted: 48686 } },
    recipe: { id: recipeId, revision: 2, state: 'approved', plan_hash: hash },
    mapping: { ...sealedReader(), job_id: mappingJob, state: 'running', next_publish_index: 0,
      sealed_chunks: null, unknown_remainder: true } });
  fixture.tables.source!.inspection!.intakePrefixSealCheck = {
    key: prefixSealCheckKey(hash, hash, mappingJob), changed: false, conflicts: [] };
  return fixture;
}

test('50 publications share one waiting wake, whose older watermark still runs as current', async () => {
  const fixture = publishedStore();
  fixture.tables.mapping!.next_publish_index = 1;
  const waiting = (await queueIntakeLargeTx(fixture.client, sourceId))!;
  const input = fixture.jobs.get(waiting)!.payload as { stateKey: string; mappedThrough: number };
  const digest = fixture.jobs.get(waiting)!.input_fingerprint;
  const cutKey = intakeLargeCutKey((await largeStateKey(fixture.client, sourceId))!.store);
  for (let count = 2; count <= 51; count++) {
    fixture.tables.mapping!.next_publish_index = count;
    const jobId = (await queueIntakeLargeTx(fixture.client, sourceId))!;
    assert.equal(jobId, waiting);
    assert.equal(fixture.jobs.size, 1);
    assert.equal([...fixture.jobs.values()].filter(job => job.status === 'queued').length, 1);
    assert.equal(fixture.jobs.get(jobId)!.payload, input);
    assert.equal(fixture.jobs.get(jobId)!.input_fingerprint, digest);
    assert.equal(input.mappedThrough, 1, 'the waiting job never rewrites its durable input or digest');
    const state = (await largeStateKey(fixture.client, sourceId))!;
    assert.equal(intakeLargePhase(intakeLargeRows(state.store, state.source)), 'draft');
    assert.equal(intakeLargeCutKey(state.store), cutKey, 'publication never fences an active fold');
    assert.equal(intakeLargeStepCurrent(state, input), true);
  }
});

test('publication after a running draft stops leaves one waiting wake, even before completion', async () => {
  const fixture = publishedStore();
  fixture.tables.mapping!.next_publish_index = 51;
  const waiting = (await queueIntakeLargeTx(fixture.client, sourceId))!;
  // The draft has decided to stop but has not accepted completion. A new publication must leave a successor.
  Object.assign(fixture.jobs.get(waiting)!, { status: 'running', dispatched_at: new Date() });
  fixture.tables.mapping!.next_publish_index = 52;
  const successor = (await queueIntakeLargeTx(fixture.client, sourceId))!;
  assert.notEqual(successor, waiting);
  assert.equal(fixture.jobs.get(successor)!.status, 'queued');
  assert.equal(fixture.jobs.get(successor)!.dispatched_at, null);
  assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), successor);
  fixture.jobs.get(waiting)!.status = 'succeeded';
  assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), successor);
  assert.equal(fixture.jobs.size, 2);
  // Dispatch may reserve a job before claim has changed queued to running; that is no longer a waiting wake.
  fixture.jobs.get(successor)!.dispatched_at = new Date();
  fixture.tables.mapping!.next_publish_index = 53;
  assert.notEqual(await queueIntakeLargeTx(fixture.client, sourceId), successor);
});

test('only the watermark can advance at dispatch; the final closure fences still match exactly', async () => {
  const fixture = publishedStore();
  fixture.tables.mapping!.next_publish_index = 1;
  const jobId = (await queueIntakeLargeTx(fixture.client, sourceId))!;
  const input = fixture.jobs.get(jobId)!.payload as { stateKey: string; mappedThrough: number };
  fixture.tables.mapping!.next_publish_index = 51;
  const before = (await largeStateKey(fixture.client, sourceId))!;
  assert.equal(intakeLargeStepCurrent(before, input), true);
  for (const mismatch of [{ records: 1 }, { next_publish_index: 1 }, { sealed_chunks: 1 },
    { unknown_remainder: true }]) {
    const closed = { ...before.store, mapping: { ...sealedReader(), job_id: mappingJob, ...mismatch } };
    assert.equal(intakeLargePhase(intakeLargeRows(closed, before.source)), 'map',
      'a matched preflight never bypasses the final mapping closure fences');
  }
  for (const change of [
    { ...before, retries: 1 },
    { ...before, store: { ...before.store, parts: 1 } },
    { ...before, store: { ...before.store, unreviewed: 1 } },
    { ...before, store: { ...before.store, recipe: { ...before.store.recipe!, revision: 3 } } },
    { ...before, store: { ...before.store, mapping: { ...before.store.mapping!, next_publish_index: 0 } } },
    { ...before, store: { ...before.store, prefixCheck: 'changed' as const } },
    { ...before, store: { ...before.store, readGeneration: 1 } },
    { ...before, store: { ...before.store, reader: { ...before.store.reader!, state: 'stale' } } },
    { ...before, store: { ...before.store, profile: { ...before.store.profile!, sealed_generation: 486 } } },
    { ...before, store: { ...before.store, mapping: { ...before.store.mapping!, state: 'queued' } } },
    { ...before, store: { ...before.store, mapping: { ...before.store.mapping!, job_id: readerJob } } },
  ]) assert.equal(intakeLargeStepCurrent({ ...change, key: 'changed' }, input), false);
});

test('concurrent wake transactions serialize per source before reading their state or waiting job', async () => {
  const fixture = publishedStore();
  let tail = Promise.resolve();
  const ids = await Promise.all(Array.from({ length: 50 }, async (_value, index) => {
    let unlock = () => {}, locked = false;
    const client = { query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith('SELECT pg_advisory_xact_lock(hashtextextended')) {
        assert.deepEqual(values, [`intake-large-wake:${sourceId}`]);
        const previous = tail;
        tail = new Promise<void>(resolve => { unlock = resolve; });
        await previous;
        locked = true;
        fixture.tables.mapping!.next_publish_index = index + 1;
      } else assert(locked, 'no enqueue decision reads a snapshot before taking the source gate');
      return fixture.client.query(sql, values);
    } } as unknown as PoolClient;
    try { return await queueIntakeLargeTx(client, sourceId); }
    finally { unlock(); }
  }));
  assert.equal(new Set(ids).size, 1);
  assert.equal(fixture.jobs.size, 1);
  assert.equal((fixture.jobs.get(ids[0]!)!.payload as { mappedThrough: number }).mappedThrough, 1);
});

test('the key reads only stored rows; a finished review between cuts keeps the cut key', async () => {
  const fixture = store({ reader: sealedReader(), recipe: { id: recipeId, revision: 2, state: 'approved' },
    mapping: { ...sealedReader(), job_id: mappingJob }, parts: 3, unreviewed: 3 });
  const first = (await largeStateKey(fixture.client, sourceId))!;
  assert.equal((await largeStateKey(fixture.client, sourceId))!.key, first.key);
  fixture.tables.unreviewed = 2;
  const reviewed = (await largeStateKey(fixture.client, sourceId))!;
  assert.notEqual(reviewed.key, first.key);
  assert.equal(intakeLargeCutKey(reviewed.store), intakeLargeCutKey(first.store));
  fixture.tables.parts = 4;
  assert.notEqual(intakeLargeCutKey((await largeStateKey(fixture.client, sourceId))!.store),
    intakeLargeCutKey(first.store));
  assert.equal(intakeLargeRequestKey(sourceId, 'mapping', 2), intakeLargeRequestKey(sourceId, 'mapping', 2));
  assert.notEqual(intakeLargeRequestKey(sourceId, 'mapping', 2), intakeLargeRequestKey(sourceId, 'mapping', 3));
});

function stored(overrides: Partial<IntakeLargeStore> = {}): IntakeLargeStore {
  return { reader: sealedReader(), profile: { job_id: profileJob, state: 'sealed', issue_code: null,
    sealed_generation: 487 }, recipe: null, mapping: null, parts: 0, unreviewed: 0, ...overrides };
}
const retained = { ...sourceRow(), inspection: { ...sourceRow().inspection, streamedMapReceipt: sealedMapReceipt({
  sourceId, sourceRevision: 1, sourceBytes: 43263076, sourceSha256: hash, jobId: readerJob,
  framing: 'feature-collection', version: 'geojson-stream/2',
} as StreamingVectorInput, { bytes: 43263076, sha256: hash, features: 1, metadata: { type: 'FeatureCollection' } },
[{ chunk_index: 0, first_feature_index: 0, last_feature_index: 0, records: 1, accepted: 1, quarantined: 0,
  published: true, result_sha256: hash }]) } } as unknown as IntakeLargeSource;
const failure = { bytes: 43263076, crsWords: null };

function project(store: IntakeLargeStore, source = retained) {
  const rows = intakeLargeRows(store, source);
  return intakeLargeProjection(intakeLargePhase(rows), rows, store, failure);
}

test('a stored prefix comparison wakes drafting or the sealed question; stale comparison pins cannot grant drafting',
  async () => {
    const fixture = store({ source: structuredClone(retained) as IntakeSourceRow, reader: sealedReader(),
      profile: { job_id: profileJob, state: 'sealed', sealed_generation: 487, layout_profile: {
        generation: 487, generationHash: hash, coverage: 'sealed', recordsSeen: 48686, accepted: 48686 } },
      recipe: { id: recipeId, revision: 2, state: 'approved', plan_version: 'streamed-prefix-mapping/1',
        plan_hash: hash }, mapping: { ...sealedReader(), job_id: mappingJob, state: 'needs_input' } });
    const before = (await largeStateKey(fixture.client, sourceId))!;
    assert.equal(intakeLargePhase(intakeLargeRows(before.store, before.source)), 'compare');
    for (const changed of [false, true]) {
      fixture.tables.source!.inspection!.intakePrefixSealCheck = {
        key: prefixSealCheckKey(hash, hash, mappingJob), mappingJobId: mappingJob, changed };
      const after = (await largeStateKey(fixture.client, sourceId))!;
      assert.notEqual(after.key, before.key, 'the comparison queues a new durable step');
      assert.equal(intakeLargePhase(intakeLargeRows(after.store, after.source)), changed ? 'question' : 'draft');
    }
    for (const detail of [{ sourcePath: '/features/*/properties/OBJECTID', recordOrdinal: 101 },
      { sourcePath: '/features/*/geometry', recordOrdinal: 102, geometryType: 'Point' }]) {
      fixture.tables.source!.inspection!.intakePrefixSealCheck = {
        key: prefixSealCheckKey(hash, hash, mappingJob), mappingJobId: mappingJob, changed: true, failure: detail };
      const after = (await largeStateKey(fixture.client, sourceId))!;
      assert.deepEqual(after.store.prefixFailure, detail);
      assert.match(project(after.store, after.source).limitReason!,
        detail.geometryType ? /Geometry type Point at record 102/ : /OBJECTID at record 101/);
    }
    for (const key of [prefixSealCheckKey('c'.repeat(64), hash, mappingJob),
      prefixSealCheckKey(hash, 'c'.repeat(64), mappingJob), prefixSealCheckKey(hash, hash, readerJob)]) {
      fixture.tables.source!.inspection!.intakePrefixSealCheck = { key, mappingJobId: mappingJob, changed: true,
        failure: { sourcePath: '/features/*/properties/OBJECTID', recordOrdinal: 1 } };
      const stale = (await largeStateKey(fixture.client, sourceId))!;
      assert.equal(stale.store.prefixCheck, undefined, 'stale plan, generation or mapping key is not a changed field');
      assert.equal(stale.store.prefixFailure, undefined, 'stale failure detail is ignored with its check');
      assert.equal(intakeLargePhase(intakeLargeRows(stale.store, stale.source)), 'compare');
    }
  });

test('each stored state has its row: question, proposed and approved layout, mapping and drafting', () => {
  const question = stored();
  assert.equal(intakeLargePhase(intakeLargeRows(question, retained)), 'question');
  assert.deepEqual(project(question), { state: 'probed', placement: 'needs_answer', planRef: null,
    partsPlanned: null, partsDone: 487, recordsSeen: 48686, limitReason: INTAKE_LARGE_LAYOUT_QUESTION });
  assert.equal(intakeLargePhase(intakeLargeRows(question, { ...retained, inspection: {} })), 'read');
  const authored = stored({ recipe: { id: recipeId, revision: 1, state: 'proposed' } });
  assert.deepEqual(project(authored), { state: 'planned', placement: 'undecided', planRef: { recipeId,
    recipeRevision: 1, recipeState: 'proposed', origin: 'officer', packageId: null },
  partsPlanned: null, partsDone: 487, recordsSeen: 48686, limitReason: null });
  const approved = stored({ recipe: { id: recipeId, revision: 2, state: 'approved' } });
  assert.deepEqual(project(approved), { ...project(authored), planRef: { ...intakeLargePlan(approved.recipe) },
    partsPlanned: 487, partsDone: 0 });
  assert.equal(project(approved).planRef!.recipeState, 'approved');
  const mapping = stored({ recipe: approved.recipe, mapping: { ...sealedReader(), job_id: mappingJob,
    state: 'running', next_publish_index: 120, sealed_chunks: null, unknown_remainder: true },
    prefixCheck: 'matched' });
  assert.deepEqual(project(mapping), { state: 'preparing', placement: 'undecided', planRef: project(approved).planRef,
    partsPlanned: null, partsDone: 0, recordsSeen: 48686, limitReason: null });
  const drafting = stored({ recipe: approved.recipe, mapping: { ...sealedReader(), job_id: mappingJob }, parts: 3 });
  assert.deepEqual(project(drafting), { state: 'preparing', placement: 'on_map', planRef: project(approved).planRef,
    partsPlanned: null, partsDone: 3, recordsSeen: 48686, limitReason: null });
  assert.equal(project(drafting).planRef!.packageId, null);
  const waiting = { ...drafting, parts: 8, unreviewed: 8 };
  assert.deepEqual(project(waiting), { ...project(drafting), partsDone: 8, limitReason: '8 packages of this file '
    + 'wait for review. The rest of the file is cut into packages as these are reviewed.' });
});

test('a reader that refuses the declared system rests the row in the resolution\'s own words', () => {
  const words = 'The file\'s crs member declares {"type":"name","properties":{"name":"EPSG:99999"}}; its name is not a '
    + 'recognized coordinate reference system.';
  const crs = stored({ reader: { ...sealedReader(), state: 'failed', issue_code: 'STREAMING_SOURCE_CRS',
    sealed_chunks: null, unknown_remainder: true }, profile: null });
  const refused = (rawJobId: string) => ({ ...retained,
    inspection: { ...retained.inspection, streamedMapRefusal: { rawJobId, words } } });
  const rows = intakeLargeRows(crs, refused(readerJob));
  const row = intakeLargeProjection(intakeLargePhase(rows), rows, crs,
    intakeLargeFailureContext(crs, refused(readerJob)));
  assert.deepEqual(row, { state: 'failed_part', placement: 'not_understood', planRef: null, partsPlanned: null,
    partsDone: 487, recordsSeen: 48686, limitReason: words.slice(0, -1) + '; nothing was prepared from it.' });
  assert.match(row.limitReason!, /"name":"EPSG:99999"/);
  assert.equal(intakeLargeAtRest(row), true);
  assert.equal(intakeLargeFailureContext(crs, refused(profileJob)).crsWords, null, 'the words of another reader');
  assert.equal(intakeLargeProjection(intakeLargePhase(rows), rows, crs, failure).limitReason,
    'The coordinate system this file declares could not be resolved; nothing was prepared from it.');
});

test('a card that states a projected system starts its steps; the reader decides the declaration', async () => {
  const stating = { family: 'vector', format: 'geojson', crs: { state: 'stated', code: 'EPSG:2958',
    sidecarSha256: null } };
  const fixture = store({ item: { item_id: sourceId, case_id: caseId, state: 'probed', placement: 'undecided',
    card: stating, plan_ref: null } });
  const state = (await largeStateKey(fixture.client, sourceId))!;
  const rows = intakeLargeRows(state.store, state.source);
  assert.equal(intakeLargePhase(rows), 'start');
  assert.deepEqual(intakeLargeProjection('start', rows, state.store, failure), { state: 'reading',
    placement: 'undecided', planRef: null, partsPlanned: null, partsDone: 0, recordsSeen: 0, limitReason: null });
  const jobId = await queueIntakeLargeTx(fixture.client, sourceId);
  assert.match(String(jobId), /^[0-9a-f-]{36}$/);
  assert.equal(fixture.jobs.size, 1);
});

test('the end rests on the map with every cut counted; zero cuts rest not understood', () => {
  const plan = intakeLargePlan({ id: recipeId, revision: 2, state: 'approved' });
  const counts = { recordsRead: 48686, accepted: 48686, packages: 25, readerRejected: 0, duplicates: 0,
    oversized: 0 };
  assert.deepEqual(intakeLargeEnd(counts, plan), { state: 'read', placement: 'on_map', planRef: plan,
    recordsSeen: 48686, partsPlanned: 25, partsDone: 25, limitReason: null });
  const none = intakeLargeEnd({ ...counts, accepted: 0, packages: 0, duplicates: 48686 }, plan);
  assert.deepEqual(none, { state: 'read', placement: 'not_understood', planRef: plan, recordsSeen: 48686,
    partsPlanned: null, partsDone: 0,
    limitReason: '48686 records read; 0 in 0 packages. 48686 share an identifier with another record and are held.' });
});

test('a step that fails all its attempts says so in officer words', () => {
  assert.equal(INTAKE_LARGE_STOPPED, 'Preparing this file stopped after repeated errors; '
    + 'the steps already done are kept. Nothing more was prepared from it.');
  assert.doesNotMatch(INTAKE_LARGE_STOPPED, /[A-Z]+_[A-Z_]+|job|worker/);
});

/** The retry runs in its own transaction; the fixture's client answers it. */
async function retried(fixture: ReturnType<typeof store>, requestKey: string, itemId = sourceId) {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => Object.assign(fixture.client, { release: () => {} }) };
  try {
    return await retryIntakeLargeItem(caseId, itemId, { requestKey });
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
}
const retryKey = '20000000-0000-4000-8000-000000000007';
const refused = (code: string) => (error: unknown) => {
  assert(error instanceof AppError);
  assert.equal(error.status, 409);
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /[A-Z]+_[A-Z_]+|job|worker/);
  return true;
};

const stopped = () => store({ reader: { ...sealedReader(), state: 'running', sealed_chunks: null } });

test('with no retry the state key is the key stored step jobs were named by', async () => {
  const fixture = store();
  assert.equal((await largeStateKey(fixture.client, sourceId))!.key, fingerprint({ version: 'intake-large/1',
    reader: null, profile: null, recipe: null, mapping: null, parts: 0, unreviewed: 0 }));
});

test('a stopped file tried again queues one new step job; the same request again adds none', async () => {
  const fixture = stopped();
  const failed = await queueIntakeLargeTx(fixture.client, sourceId);
  fixture.jobs.get(failed!)!.status = 'failed';
  Object.assign(fixture.tables.item!, { state: 'failed_part', placement: 'not_understood',
    limit_reason: INTAKE_LARGE_STOPPED });
  assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), null);
  const result = await retried(fixture, retryKey);
  assert.equal(result.retry, 1);
  assert.notEqual(result.jobId, failed);
  assert(fixture.jobs.has(result.jobId));
  assert.equal(fixture.jobs.size, 2);
  assert.equal((fixture.jobs.get(result.jobId)!.payload as Record<string, unknown>).stateKey,
    (await largeStateKey(fixture.client, sourceId))!.key);
  assert.equal(fixture.tables.item!.placement, 'undecided');
  assert.equal(fixture.tables.item!.limit_reason, null);
  assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), result.jobId);
  assert.deepEqual(await retried(fixture, retryKey), result);
  assert.equal(fixture.jobs.size, 2);
  assert.equal(fixture.operations.size, 1);
});

test('a retry key reused with a different request is refused before any write', async () => {
  const fixture = stopped();
  Object.assign(fixture.tables.item!, { state: 'failed_part', placement: 'not_understood',
    limit_reason: INTAKE_LARGE_STOPPED });
  await retried(fixture, retryKey);
  const jobs = fixture.jobs.size;
  await assert.rejects(() => retried(fixture, retryKey, readerJob), (error: unknown) => error instanceof AppError
    && error.status === 409 && error.code === 'STALE_REVISION');
  assert.equal(fixture.jobs.size, jobs);
  assert.equal(fixture.operations.size, 1);
});

test('a file stopped by what it contains, a bounded file and a file not stopped are refused in words', async () => {
  const terminal = store({ reader: { ...sealedReader(), state: 'failed', issue_code: 'STREAMING_SOURCE_CRS' } });
  Object.assign(terminal.tables.item!, { state: 'failed_part', placement: 'not_understood',
    limit_reason: intakeLargeFailureReason('STREAMING_SOURCE_CRS', 1) });
  await assert.rejects(() => retried(terminal, retryKey), refused('INTAKE_RETRY_FILE'));
  terminal.tables.item!.limit_reason = INTAKE_LARGE_STOPPED;
  await assert.rejects(() => retried(terminal, retryKey), refused('INTAKE_RETRY_FILE'));
  const bounded = store();
  bounded.tables.item!.card = { family: 'vector', format: 'csv', crs: { code: null } };
  await assert.rejects(() => retried(bounded, retryKey), refused('INTAKE_RETRY_NOT_LARGE'));
  const running = stopped();
  await assert.rejects(() => retried(running, retryKey), refused('INTAKE_RETRY_NOT_STOPPED'));
  for (const fixture of [terminal, bounded, running]) {
    assert.equal(fixture.operations.size, 0);
    assert.equal(fixture.jobs.size, 0);
  }
});

test('an unmeasured small wide upload is inspected and queues streaming without a bounded draft', async () => {
  const bytes = readFileSync(new URL('./fixtures/sw1-small-wide.geojson', import.meta.url));
  const source = sourceRow(bytes.length) as IntakeSourceRow;
  source.sha256 = sha256(bytes);
  source.inspection!.largeOriginal.verifiedSha256 = source.sha256;
  const fixture = store({ source, bytes: bytes.length });
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, source.name);
  fixture.tables.item!.card = card;
  const fetch = processorAnswers(bytes, 503);
  try {
    const jobId = await queueIntakeDraftTx(fixture.client, source, card);
    assert.equal(fixture.jobs.get(jobId!)?.operation, 'intake-large');
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(source.inspection!.manualProfile, undefined);
    assert.equal(source.inspection!.intakeExtent.fitsOneArea, false);
    assert((fixture.tables.item!.card as IntakeCard).limits.includes(INTAKE_WIDE_GEOJSON_REASON));
    assert.equal(await queueIntakeDraftTx(fixture.client, source, card), jobId);
    assert.equal(fixture.jobs.size, 1);
    assert.equal(source.profile, 'large-original-v1');
  } finally {
    mock.restoreAll();
  }
});

/** The kept bytes the bounded reader would read, and a processor that answers with the given status. */
function processorAnswers(bytes: Uint8Array, status: number) {
  for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    mock.getter(settings, name, () => 'test-only');
  mock.method(S3Client.prototype, 'send', async () => ({ Body: Readable.from([bytes]), ContentLength: bytes.length,
    ETag: 'protocol-etag' }));
  mock.getter(settings, 'geoUrl', () => 'http://processor.invalid');
  mock.getter(settings, 'geoToken', () => 'test-only');
  return mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'test_only' }, { status }));
}

test('a small kept GeoJSON whose processor is unavailable is enrolled on the streaming reader, with the reason',
  async () => {
    // Generated test_only collection; not a building record.
    const bytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] }));
    const fixture = store({ bytes: bytes.length });
    const card = { family: 'vector', format: 'geojson', crs: { code: null }, counts: { features: null } };
    fixture.tables.item!.card = card;
    const source = { ...sourceRow(bytes.length), sha256: sha256(bytes) } as IntakeSourceRow;
    const fetch = processorAnswers(bytes, 503);
    try {
      const jobId = await queueIntakeDraftTx(fixture.client, source, card as IntakeCard);
      assert.equal(fixture.jobs.get(jobId!)?.operation, 'intake-large');
      assert.equal(fetch.mock.callCount(), 1);
      assert.match(String(fixture.tables.item!.limit_reason), /processor was unavailable \(AREA_PROCESSING\)/);
      assert.equal(await queueIntakeDraftTx(fixture.client, source, card as IntakeCard), jobId,
        'a later enrolment stays on the streaming reader');
      assert.equal(fetch.mock.callCount(), 1);
      assert.equal(fixture.jobs.size, 1);
    } finally {
      mock.restoreAll();
    }
  });
