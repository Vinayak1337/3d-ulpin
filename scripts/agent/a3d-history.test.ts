import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import type { PoolClient } from 'pg';
import { AnyStreamingInputSchema, ChunkMappingInputSchema } from '../../packages/contracts/src/usp';
import { settings } from '../../packages/server/src/infrastructure/config';
import { sha256 } from '../../packages/server/src/infrastructure/storage';
import { fingerprint } from '../../packages/server/src/modules/cases/domain';
import { ingestionBinding } from '../../packages/server/src/modules/usp/ingestion/events';
import { StreamingVectorService, streamingReaderSha, assertStreamingInputTx } from
  '../../packages/server/src/modules/usp/ingestion/streaming-vector';
import { ChunkMappingService, chunkMappingConverterSha, assertChunkMappingInputTx } from
  '../../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { inspectTabularSource } from '../../packages/server/src/modules/usp/ingestion/tabular-source';
import { developmentManifest } from './t1-sources';

const requireServer = createRequire(new URL('../../packages/server/package.json', import.meta.url));
const { S3Client } = requireServer('@aws-sdk/client-s3');
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
type Row = Record<string, any>;

function sourceFixture(gis: boolean, caseId: string, sourceId: string) {
  const asset = developmentManifest().assets.find(item => item.id === 'mi-d10-02.csv')!;
  const bytes = readFileSync(gis ? 'fixtures/real-nyc/original.geojson' : asset.original.externalPath);
  const inventory = gis ? undefined : inspectTabularSource(bytes, selection);
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1,
    sha256: sha256(bytes), bytes: bytes.length, object_key: 'original',
    profile: gis ? 'geojson-manual-v1' : 'tabular-manual-v1',
    inspection: { actor: 'a3d-history-control', manualProfile: inventory } };
  return { source, tabular: inventory?.tabular };
}

function inputs(gis: boolean) {
  const caseId = randomUUID(), sourceId = randomUUID(), rawId = randomUUID(), mappedId = randomUUID();
  const { source, tabular } = sourceFixture(gis, caseId, sourceId);
  const binding = ingestionBinding(caseId);
  const base = { version: 'geojson-stream/2', jobId: rawId, caseId, caseRevision: 0, sourceId,
    sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: source.sha256, sourceBytes: source.bytes,
    objectKey: source.object_key, framing: gis ? 'feature-collection' : 'tabular', ...(tabular ? { tabular } : {}),
    subject: binding.subject, accessBinding: binding.access, readerSha256: streamingReaderSha() };
  const raw = AnyStreamingInputSchema.parse({ ...base, inputFingerprint: fingerprint(base) });
  const mappedBase = { version: 'chunk-mapping/1', jobId: mappedId, caseId, caseRevision: 0, sourceId,
    sourceRevision: 1, sourceFamilyId: sourceId, sourceSha256: source.sha256, rawJobId: rawId,
    rawInputFingerprint: fingerprint(raw), readerSha256: raw.readerSha256,
    route: gis ? 'approved_recipe' : 'proposal_only',
    recipeId: gis ? randomUUID() : null,
    recipeRevision: gis ? 1 : null, planHash: null, schemaFingerprint: null, workspaceFingerprint: null,
    converterSha256: chunkMappingConverterSha(), subject: binding.subject, accessBinding: binding.access,
    ...(tabular ? { tabular } : {}) };
  const mapped = ChunkMappingInputSchema.parse({ ...mappedBase, inputFingerprint: fingerprint(mappedBase) });
  return { raw, mapped, source };
}

class HistoryDb {
  caseRevision = 0;
  latest = 1;
  corrupt = false;
  storedHashChanged = false;
  payloads = new Map<string, Buffer>();
  constructor(readonly f: ReturnType<typeof inputs>) {}

  async query(sql: string, args: any[] = []): Promise<{ rows: Row[] }> {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock') ||
        sql.includes('FROM operations')) return { rows: [] };
    if (sql.includes('FROM cases')) return { rows: [{ id: this.f.raw.caseId, revision: this.caseRevision }] };
    if (sql.includes('max(revision)')) return { rows: [{ revision: this.latest }] };
    if (sql.includes('FROM sources')) return { rows: [this.f.source] };
    if (sql.includes('FROM jobs')) {
      const input = sql.includes("operation='streaming-vector'") ? this.f.raw : this.f.mapped;
      if (args[0] !== input.jobId || args[1] && args[1] !== input.caseId ||
          args[2] && args[2] !== input.sourceId) return { rows: [] };
      const inputHash = this.storedHashChanged ? '0'.repeat(64) : fingerprint(input);
      return { rows: [{ payload: input, input_fingerprint: inputHash }] };
    }
    if (sql.includes('FROM usp_streaming_vector_imports') || sql.includes('FROM usp_chunk_mapping_imports')) {
      return { rows: [{ state: 'completed', next_publish_index: 1, sealed_chunks: 1, records: 0,
        accepted: 0, quarantined: 0, normalized: 0, unresolved: 0, duplicate_keys: 0, schema_drift_chunks: 0,
        proposal: null, issue_code: null, unknown_remainder: false }] };
    }
    if (sql.includes('FROM usp_streaming_vector_slots') || sql.includes('FROM usp_chunk_mapping_slots')) {
      return { rows: [this.slot(sql.includes('usp_streaming_vector_slots'))] };
    }
    throw new Error(`Unexpected history SQL: ${sql}`);
  }

  slot(raw: boolean) {
    const input = raw ? this.f.raw : this.f.mapped;
    const payload = { version: input.version, jobId: input.jobId, sourceId: input.sourceId,
      sourceRevision: 1, sourceSha256: input.sourceSha256, chunkIndex: 0, records: [],
      ...(!raw ? { rawJobId: this.f.raw.jobId, rawResultSha256: '1'.repeat(64),
        schemaFingerprint: null, recipeRevision: 1, converterSha256: this.f.mapped.converterSha256 } : {}) };
    const bytes = Buffer.from(JSON.stringify(payload));
    const key = raw ? 'raw' : 'mapped';
    this.payloads.set(key, this.corrupt ? Buffer.from('changed payload') : bytes);
    return { chunk_index: 0, status: 'ready', published: true, first_feature_index: 0, last_feature_index: null,
      records: 0, accepted: 0, normalized: 0, quarantined: 0, unresolved: 0, bytes: bytes.length,
      object_key: key, object_sha256: sha256(bytes), result_sha256: sha256(bytes), attempt: 1, fence: 1,
      issue_code: null, raw_result_sha256: '1'.repeat(64), schema_fingerprint: null, schema_drift: false };
  }
}

async function controlled(run: (db: HistoryDb) => Promise<void>, gis = false) {
  const globals = globalThis as any, prior = globals.ulpinPool;
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'a3d-history-control';
  const db = new HistoryDb(inputs(gis));
  globals.ulpinPool = { connect: async () => ({ query: db.query.bind(db), release() {} }) };
  for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const) {
    mock.getter(settings, name, () => name === 's3Endpoint' ? 'http://127.0.0.1:1' : 'history-software-control');
  }
  mock.method(S3Client.prototype, 'send', async (command: any) =>
    ({ Body: { transformToByteArray: async () => db.payloads.get(command.input.Key) } }));
  try { await run(db); }
  finally {
    globals.ulpinPool = prior;
    if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
    mock.restoreAll();
  }
}

async function statuses(db: HistoryDb) {
  const { raw, mapped } = db.f;
  return [await new StreamingVectorService().status(raw.caseId, raw.sourceId, raw.jobId),
    await new ChunkMappingService().status(mapped.caseId, mapped.sourceId, mapped.jobId)];
}

function rehash(db: HistoryDb) {
  const { inputFingerprint: _rawHash, ...raw } = db.f.raw;
  db.f.raw.inputFingerprint = fingerprint(raw);
  db.f.mapped.rawInputFingerprint = fingerprint(db.f.raw);
  db.f.mapped.readerSha256 = db.f.raw.readerSha256;
  const { inputFingerprint: _mappedHash, ...mapped } = db.f.mapped;
  db.f.mapped.inputFingerprint = fingerprint(mapped);
}

test('real CSV retained statuses report all history reasons; strict worker/enqueue fences still reject', () =>
  controlled(async db => {
    assert((await statuses(db)).every(status => status.current && !status.reasons.length));
    db.caseRevision = 1;
    db.latest = 2;
    db.f.raw.readerSha256 = '2'.repeat(64);
    db.f.mapped.converterSha256 = '3'.repeat(64);
    rehash(db);
    const results = await statuses(db);
    assert.deepEqual(results[0].reasons, ['case_advanced', 'reader_changed', 'source_superseded']);
    assert.deepEqual(results[1].reasons, [...results[0].reasons, 'converter_changed']);
    assert(results.every(result => result.current === false));
    const client = db as unknown as PoolClient;
    await assert.rejects(() => assertStreamingInputTx(client, db.f.raw),
      (error: any) => error.code === 'STALE_REVISION');
    await assert.rejects(() => assertChunkMappingInputTx(client, db.f.mapped),
      (error: any) => error.code === 'STALE_REVISION');
    await assert.rejects(() => new ChunkMappingService().enqueue(db.f.raw.caseId, db.f.raw.sourceId,
      { requestKey: randomUUID(), rawJobId: db.f.raw.jobId, expectedCaseRevision: 1, expectedSourceRevision: 1,
        sourceSha256: db.f.raw.sourceSha256 }), (error: any) => error.code === 'STALE_REVISION');
  }));

test('GIS historical status and chunks reopen retained bytes after case/reader/converter advancement', () =>
  controlled(async db => {
    db.caseRevision++;
    const { raw, mapped } = db.f;
    const before = await new StreamingVectorService().chunk(raw.caseId, raw.sourceId, raw.jobId, 0);
    assert.equal(before.current, false);
    assert.deepEqual(before.reasons, ['case_advanced']);
    const retained = await new ChunkMappingService().chunk(mapped.caseId, mapped.sourceId, mapped.jobId, 0);
    assert.equal(retained.current, false);
    assert.deepEqual(retained.reasons, ['case_advanced']);
    assert.equal(retained.payload?.sourceSha256, raw.sourceSha256);
    db.f.raw.readerSha256 = '2'.repeat(64);
    db.f.mapped.converterSha256 = '3'.repeat(64);
    rehash(db);
    assert.equal((await statuses(db))[1].reasons.includes('converter_changed'), true);
  }, true));

test('historical reads still deny private/scope/input/payload tampering', () => controlled(async db => {
  const { raw, mapped } = db.f;
  db.caseRevision++;
  await assert.rejects(() => new StreamingVectorService().status(randomUUID(), raw.sourceId, raw.jobId));
  await assert.rejects(() => new ChunkMappingService().status(mapped.caseId, randomUUID(), mapped.jobId));
  db.storedHashChanged = true;
  await assert.rejects(() => statuses(db), (error: any) => error.code === 'STREAMING_INPUT_INTEGRITY');
  db.storedHashChanged = false;
  db.corrupt = true;
  await assert.rejects(() => new StreamingVectorService().chunk(raw.caseId, raw.sourceId, raw.jobId, 0),
    (error: any) => error.code === 'STREAMING_CHUNK_INTEGRITY');
  await assert.rejects(() => new ChunkMappingService().chunk(mapped.caseId, mapped.sourceId, mapped.jobId, 0),
    (error: any) => error.code === 'MAPPING_CHUNK_INTEGRITY');
  db.corrupt = false;
  raw.accessBinding = '0'.repeat(64);
  rehash(db);
  await assert.rejects(() => statuses(db), (error: any) => error.code === 'STREAMING_READ_BINDING');
}, true));
