import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { STREAMING_VECTOR_LIMITS as limits, type IntakeCard, type StreamingVectorInput } from '@ulpin/contracts/usp';
import { INTAKE_LARGE_LAYOUT_QUESTION, INTAKE_LARGE_STOPPED, intakeLargeCutKey, intakeLargeEnd,
  intakeLargeFailureReason, intakeLargePhase, intakeLargePlan, intakeLargeProjection, intakeLargeRequestKey,
  intakeLargeRows, largeStateKey, queueIntakeLargePackageTx, queueIntakeLargeTx, retryIntakeLargeItem,
  type IntakeLargeSource, type IntakeLargeStore } from './intake-large';
import { fingerprint } from '../../cases/domain';
import { AppError } from '../../../infrastructure/errors';
import { queueIntakeDraftTx } from './intake-draft';
import type { IntakeSourceRow } from './intake-context';
import { localOperatorSubject } from '../principal';
import { sealedMapReceipt } from './streamed-map-receipt';

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
  reader: Record<string, unknown> | null; profile: Record<string, unknown> | null;
  recipe: Record<string, unknown> | null; mapping: Record<string, unknown> | null; parts: number;
  unreviewed: number; partOf: string | null }> = {}) {
  const tables = { item: { item_id: sourceId, case_id: caseId, state: 'probed', placement: 'undecided',
    card: { family: 'vector', format: 'geojson', crs: { code: null } }, plan_ref: null, family: 'vector',
    parent_item_id: null, source_id: sourceId, limit_reason: null, records_seen: 0, parts_planned: null,
    parts_done: 0 } as Record<string, unknown> | null, bytes: 43263076, reader: null, profile: null, recipe: null,
  mapping: null, parts: 0, unreviewed: 0, partOf: null, ...overrides };
  const jobs = new Map<string, Record<string, unknown>>();
  const operations = new Map<string, { payload_hash: string; result: Record<string, unknown> }>();
  let metadata = 0;
  const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const client = { query: async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT item_id,case_id,state,placement')) return one(tables.item);
    if (sql.startsWith('SELECT * FROM usp_intake_items')) return one(tables.item);
    if (sql.startsWith('SELECT id,revision,bytes,profile') || sql.startsWith('SELECT * FROM sources'))
      return one(sourceRow(tables.bytes));
    if (sql.startsWith('SELECT job_id,state,issue_code,next_publish_index,records,quarantined'))
      return one(tables.reader);
    if (sql.startsWith('SELECT job_id,state,issue_code,sealed_generation')) return one(tables.profile);
    if (sql.startsWith('SELECT job_id,state,issue_code,next_publish_index,records,sealed_chunks'))
      return one(tables.mapping);
    if (sql.startsWith('SELECT id,revision,state FROM usp_mapping_recipes')) return one(tables.recipe);
    if (sql.startsWith('SELECT count(*)::int n FROM usp_intake_parts WHERE')) return one({ n: tables.parts });
    if (sql.startsWith('SELECT count(*)::int n FROM usp_intake_parts part')) return one({ n: tables.unreviewed });
    if (sql.startsWith('SELECT i.source_id FROM usp_intake_parts')) return one(tables.partOf
      && { source_id: tables.partOf });
    if (sql.startsWith("SELECT id FROM jobs WHERE id=$1 AND operation='intake-large'"))
      return one(jobs.has(values[0] as string) && { id: values[0] });
    if (sql.startsWith('SELECT id,revision,archived FROM cases')) return one({ id: caseId, revision: 3,
      archived: false });
    if (sql.startsWith('INSERT INTO jobs')) {
      if (jobs.has(values[0] as string)) return one(null);
      jobs.set(values[0] as string, { id: values[0], case_id: values[1], source_id: values[2],
        operation: 'intake-large', case_revision: values[3], input_fingerprint: values[4], payload: values[5] });
      return one({});
    }
    if (sql.startsWith('SELECT * FROM jobs WHERE id=$1 FOR UPDATE')) return one(jobs.get(values[0] as string));
    if (sql.startsWith('SELECT * FROM usp_job_metadata')) return one(null);
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      metadata++;
      return one(null);
    }
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
  const above = store({ bytes: limits.sourceBytes + 1 });
  assert.equal(await queueIntakeLargeTx(above.client, sourceId), null);
  assert.equal(above.jobs.size, 0);
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
    change();
    const jobId = await queueIntakeLargeTx(fixture.client, sourceId);
    assert(!ids.has(jobId));
    ids.add(jobId);
    assert.equal(await queueIntakeLargeTx(fixture.client, sourceId), jobId);
  }
  assert.equal(fixture.jobs.size, states.length + 1);
  fixture.tables.partOf = sourceId;
  fixture.tables.parts = 2;
  fixture.tables.unreviewed = 1;
  const reviewed = await queueIntakeLargePackageTx(fixture.client, 'protocol-package');
  assert(!ids.has(reviewed));
  assert.equal(fixture.jobs.size, states.length + 2);
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
const failure = { bytes: 43263076, declaredCrs: null };

function project(store: IntakeLargeStore, source = retained) {
  const rows = intakeLargeRows(store, source);
  return intakeLargeProjection(intakeLargePhase(rows), rows, store, failure);
}

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
    state: 'running', next_publish_index: 120, sealed_chunks: null, unknown_remainder: true } });
  assert.deepEqual(project(mapping), { state: 'reading', placement: 'undecided', planRef: project(approved).planRef,
    partsPlanned: 487, partsDone: 120, recordsSeen: 48686, limitReason: null });
  const drafting = stored({ recipe: approved.recipe, mapping: { ...sealedReader(), job_id: mappingJob }, parts: 3 });
  assert.deepEqual(project(drafting), { state: 'reading', placement: 'on_map', planRef: project(approved).planRef,
    partsPlanned: null, partsDone: 3, recordsSeen: 48686, limitReason: null });
  assert.equal(project(drafting).planRef!.packageId, null);
});

test('a terminal reader names its own sentence; a projected file says its declared system', () => {
  const crs = stored({ reader: { ...sealedReader(), state: 'failed', issue_code: 'STREAMING_SOURCE_CRS' },
    profile: null });
  const rows = intakeLargeRows(crs, retained);
  const declared = intakeLargeProjection(intakeLargePhase(rows), rows, crs, { bytes: 1, declaredCrs: 'EPSG:2958' });
  assert.equal(declared.placement, 'not_understood');
  assert.equal(declared.state, 'failed_part');
  assert.equal(declared.limitReason, intakeLargeFailureReason('STREAMING_SOURCE_CRS', 1, 'EPSG:2958'));
  assert.match(declared.limitReason!, /EPSG:2958/);
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
