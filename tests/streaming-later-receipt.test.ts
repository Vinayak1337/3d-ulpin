import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { createRequire } from 'node:module';
import { settings } from '../packages/server/src/infrastructure/config';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import type { PoolClient } from 'pg';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { ingestionBinding } from '../packages/server/src/modules/usp/ingestion/events';
import { AnyStreamingInputSchema, ChunkMappingInputSchema, StreamedProfileInputSchema } from
  '../packages/contracts/src/usp';
import { assertStreamingInputTx, streamingReadContextTx, streamingReaderSha, StreamingVectorService } from
  '../packages/server/src/modules/usp/ingestion/streaming-vector';
import { assertChunkMappingInputTx, chunkMappingReadContextTx, chunkMappingConverterSha, ChunkMappingService } from
  '../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { assertStreamedProfileInputTx, streamedProfilerSha } from
  '../packages/server/src/modules/usp/ingestion/streamed-profile';

// SQL protocol controls, not invented originals or geometry and not native extraction qualification.
function fixture(caseId = randomUUID(), revision = 1) {
  const binding = ingestionBinding(caseId);
  const sourceId = randomUUID();
  const source = { id: sourceId, case_id: caseId, revision: 1, family_id: sourceId,
    sha256: fingerprint({ protocol: sourceId }), bytes: 1, object_key: 'protocol-original',
    profile: 'large-original-v1', inspection: { largeOriginal: { operatorSubject: binding.subject } } };
  const rawBase = { version: 'geojson-stream/2', jobId: randomUUID(), caseId, caseRevision: revision,
    sourceId, sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: source.sha256,
    sourceBytes: 1, objectKey: source.object_key, framing: 'feature-collection', subject: binding.subject,
    accessBinding: binding.access, readerSha256: streamingReaderSha() };
  const raw = AnyStreamingInputSchema.parse({ ...rawBase, inputFingerprint: fingerprint(rawBase) });
  const dependent = { caseId, caseRevision: revision, sourceId, sourceRevision: 1, sourceFamilyId: sourceId,
    sourceSha256: source.sha256, rawJobId: raw.jobId, rawInputFingerprint: fingerprint(raw),
    readerSha256: raw.readerSha256, subject: binding.subject, accessBinding: binding.access };
  const mapBase = { ...dependent, version: 'chunk-mapping/1', jobId: randomUUID(), route: 'proposal_only',
    recipeId: null, recipeRevision: null, planHash: null, schemaFingerprint: null, workspaceFingerprint: null,
    converterSha256: chunkMappingConverterSha() };
  const mapped = ChunkMappingInputSchema.parse({ ...mapBase, inputFingerprint: fingerprint(mapBase) });
  const profileBase = { ...dependent, version: 'streamed-profile/1', jobId: randomUUID(),
    profilerSha256: streamedProfilerSha() };
  const profile = StreamedProfileInputSchema.parse({ ...profileBase, inputFingerprint: fingerprint(profileBase) });
  return { raw, mapped, profile, source };
}

function database(f: ReturnType<typeof fixture>) {
  const state = { revision: f.raw.caseRevision, latest: 1, archived: false };
  const client = { async query(sql: string, args: any[] = []) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM cases')) return { rows: [{ id: f.raw.caseId, ...state }] };
    if (sql.includes('max(revision)')) return { rows: [{ revision: state.latest }] };
    if (sql.includes('FROM sources')) return { rows: [f.source] };
    if (sql.includes('FROM jobs')) {
      const input = sql.includes("operation='chunk-mapping'") ? f.mapped : f.raw;
      return { rows: [{ payload: input, input_fingerprint: fingerprint(input) }] };
    }
    if (sql.includes('FROM usp_mapping_recipes')) return { rows: [] };
    if (sql.includes('FROM usp_streaming_vector_imports') || sql.includes('FROM usp_chunk_mapping_imports')) {
      return { rows: [{ state: 'completed', next_publish_index: 2, sealed_chunks: 2, records: 0,
        accepted: 0, quarantined: 0, normalized: 0, unresolved: 0, duplicate_keys: 0, schema_drift_chunks: 0,
        proposal: null, issue_code: null, unknown_remainder: false }] };
    }
    if (sql.includes('FROM usp_streaming_vector_slots') || sql.includes('FROM usp_chunk_mapping_slots')) {
      const index = sql.includes('chunk_index=$') ? args[args.length - 1] : 0;
      return { rows: [protocolSlot(f, sql.includes('usp_streaming_vector_slots'), index)] };
    }
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  return { state, client };
}

function protocolPayload(f: ReturnType<typeof fixture>, raw: boolean, index: number) {
  const input = raw ? f.raw : f.mapped;
  return { version: input.version, jobId: input.jobId, sourceId: input.sourceId,
    sourceRevision: 1, sourceSha256: input.sourceSha256, chunkIndex: index, records: [],
    ...(!raw ? { rawJobId: f.raw.jobId, rawResultSha256: '1'.repeat(64), schemaFingerprint: null,
      recipeRevision: null, converterSha256: f.mapped.converterSha256 } : {}) };
}

function protocolSlot(f: ReturnType<typeof fixture>, raw: boolean, index: number) {
  const bytes = Buffer.from(JSON.stringify(protocolPayload(f, raw, index)));
  return { chunk_index: index, status: 'ready', published: true, first_feature_index: 0,
    last_feature_index: null, records: 0, accepted: 0, normalized: 0, quarantined: 0, unresolved: 0,
    bytes: raw ? bytes.length : 0, object_key: raw ? `raw/${index}` : null,
    object_sha256: raw ? sha256(bytes) : null,
    result_sha256: sha256(bytes), attempt: 1, fence: 1, issue_code: null, raw_result_sha256: '1'.repeat(64),
    schema_fingerprint: null, schema_drift: false };
}

async function publicReadControl(f: ReturnType<typeof fixture>, db: ReturnType<typeof database>,
  run: () => Promise<void>) {
  const globals = globalThis as any;
  const prior = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => ({ query: db.client.query.bind(db.client), release() {} }) };
  const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
  const { S3Client } = require('@aws-sdk/client-s3');
  for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const) {
    mock.getter(settings, name, () => name === 's3Endpoint' ? 'http://127.0.0.1:1' : 'k14-memory-control');
  }
  mock.method(S3Client.prototype, 'send', async (command: any) => {
    const [kind, index] = command.input.Key.split('/');
    const bytes = Buffer.from(JSON.stringify(protocolPayload(f, kind === 'raw', Number(index))));
    return { Body: { transformToByteArray: async () => bytes } };
  });
  try { await run(); }
  finally {
    if (prior === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = prior;
    mock.restoreAll();
  }
}

async function local(run: () => Promise<void>) {
  const prior = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k14-protocol-control';
  try { await run(); }
  finally {
    if (prior === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior;
  }
}

async function authority(f: ReturnType<typeof fixture>, client: PoolClient) {
  await assertStreamingInputTx(client, f.raw);
  await assertChunkMappingInputTx(client, f.mapped);
  await assertStreamedProfileInputTx(client, f.profile);
}

async function readFreshness(f: ReturnType<typeof fixture>, client: PoolClient) {
  const raw = await streamingReadContextTx(client, f.raw,
    f.raw.caseId, f.raw.sourceId, f.raw.jobId, fingerprint(f.raw));
  const mapped = await chunkMappingReadContextTx(client, f.mapped,
    f.raw.caseId, f.raw.sourceId, f.mapped.jobId, fingerprint(f.mapped));
  assert.deepEqual(raw.freshness, { current: true, reasons: [] });
  assert.deepEqual(mapped.freshness, { current: true, reasons: [] });
}

test('sequential vector protocol receipts remain current before claim, at heartbeat and after completion', () =>
  local(async () => {
    const caseId = randomUUID();
    const jobs = [1, 2, 3, 4].map(revision => fixture(caseId, revision));
    for (const f of jobs) {
      const db = database(f);
      const before = fingerprint(f);
      db.state.revision = 4; // all later receipts have arrived before the claim callback
      await authority(f, db.client);
      db.state.revision = 5; // callback shared by heartbeat and completion
      await authority(f, db.client);
      await readFreshness(f, db.client);
      await publicReadControl(f, db, async () => {
        const result = await new StreamingVectorService().status(f.raw.caseId, f.raw.sourceId, f.raw.jobId);
        assert.equal(result.current, true);
        assert.deepEqual(result.reasons, []);
      });
      assert.equal(fingerprint(f), before);
    }
  }));

test('difficult protocol: dependent mapping checks two chunk boundaries separated by an unrelated receipt', () =>
  local(async () => {
    const f = fixture();
    const db = database(f);
    const enrolled = fingerprint(f);
    await publicReadControl(f, db, async () => {
      const raw = new StreamingVectorService();
      const mapped = new ChunkMappingService();
      for (const index of [0, 1]) {
        await authority(f, db.client);
        const first = await raw.chunk(f.raw.caseId, f.raw.sourceId, f.raw.jobId, index);
        const second = await mapped.chunk(f.raw.caseId, f.raw.sourceId, f.mapped.jobId, index);
        assert.deepEqual(first.reasons, []);
        assert.deepEqual(second.reasons, []);
        assert.equal(first.current && second.current, true);
        assert.equal(first.payload?.chunkIndex, index);
        assert.equal(second.slot.chunkIndex, index);
        assert.equal(second.payload, null); // proposal-only control has no officer-approved GIS recipe
        if (index === 0) db.state.revision++;
      }
    });
    assert.equal(fingerprint(f), enrolled);
  }));

test('streaming and both dependents preserve supersession, archive, reader and self-seal refusals', () =>
  local(async () => {
    const f = fixture();
    const db = database(f);
    db.state.latest = 2;
    const checks = [
      () => assertStreamingInputTx(db.client, f.raw),
      () => assertChunkMappingInputTx(db.client, f.mapped),
      () => assertStreamedProfileInputTx(db.client, f.profile),
    ];
    for (const check of checks) await assert.rejects(check, (e: any) => e.status === 409);
    const stale = await streamingReadContextTx(db.client, f.raw,
      f.raw.caseId, f.raw.sourceId, f.raw.jobId, fingerprint(f.raw));
    assert.deepEqual(stale.freshness, { current: false, reasons: ['source_superseded'] });
    db.state.latest = 1;
    db.state.archived = true;
    for (const check of checks) {
      await assert.rejects(check, (e: any) => e.code === 'STREAMING_CASE_ARCHIVED');
    }
    db.state.archived = false;
    const { inputFingerprint: _, ...base } = f.raw;
    f.raw.readerSha256 = '0'.repeat(64);
    f.raw.inputFingerprint = fingerprint({ ...base, readerSha256: f.raw.readerSha256 });
    const changed = await streamingReadContextTx(db.client, f.raw,
      f.raw.caseId, f.raw.sourceId, f.raw.jobId, fingerprint(f.raw));
    assert.deepEqual(changed.freshness, { current: false, reasons: ['reader_changed'] });
    for (const check of checks) await assert.rejects(check, (e: any) => e.status === 409);
    f.raw.inputFingerprint = '0'.repeat(64);
    await assert.rejects(() => assertStreamingInputTx(db.client, f.raw), (e: any) => e.status === 409);
  }));

test('manual-profile mapping explicitly stays strict while its raw stream survives', () => local(async () => {
  const f = fixture();
  const db = database(f);
  f.source.profile = 'geojson-manual-v1';
  (f.source.inspection as any).actor = f.raw.subject;
  db.state.revision++;
  await assertStreamingInputTx(db.client, f.raw);
  await assert.rejects(() => assertChunkMappingInputTx(db.client, f.mapped), (e: any) => e.status === 409);
}));
