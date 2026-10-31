import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { STREAMING_VECTOR_LIMITS, StreamingVectorPayloadSchema,
  type StreamedProfileGeneration, type StreamedMappingPlan } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { ingestionBinding } from './events';
import { sha256 } from '../../../infrastructure/storage';
import { readPinnedRawChunk } from './streamed-profile-worker';
import { chunkMappingConverterSha } from './chunk-mapping';
import { normalizeMappedChunk, type KeyDecision } from './chunk-mapping-normalizer';
import { reserveMappedKeysTx } from './chunk-mapping-worker';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';

const id = '53000000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);
async function records() {
  const original = JSON.parse(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson', 'utf8'));
  // test_only transport corruption between two real features, not an edit to their original.
  const text = [original.features[0], null, original.features[1]].map(value => JSON.stringify(value)).join('\n');
  const result: ReturnType<typeof sourceRecord>[] = [];
  await readStreamingFeatures(Readable.from([text + '\n']), 'geojson-lines', async item => {
    result.push(sourceRecord(item));
  });
  return result;
}
function keyStore() {
  const keys = new Map<string, { value: string; firstIndex: number; conflicted: boolean }>();
  const conflicts: { later: number; first: number; hash: string }[] = [], statements: string[] = [];
  const client = { query: async (sql: string, values: any[]) => {
    statements.push(sql);
    if (sql.startsWith('INSERT INTO usp_chunk_mapping_keys')) values[1].forEach((key: string, index: number) => {
      assert(!keys.has(key));
      keys.set(key, { value: values[2][index], firstIndex: values[3][index], conflicted: false });
    });
    else if (sql.startsWith('UPDATE usp_chunk_mapping_keys')) values[1].forEach((key: string, index: number) => {
      const prior = keys.get(key);
      if (prior && prior.value === values[2][index]) prior.conflicted = true;
    });
    else if (sql.startsWith('INSERT INTO usp_chunk_mapping_conflicts'))
      values[1].forEach((later: number, index: number) => {
        conflicts.push({ later, first: values[2][index], hash: values[3][index] });
      });
    else assert.fail(sql);
    return { rows: [], rowCount: 0 };
  } } as unknown as PoolClient;
  return { keys, conflicts, statements, client };
}

test('a malformed raw member is quarantined without changing neighbouring batched key reservations', async () => {
  const raw = await records();
  const source = { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash };
  const profile: StreamedProfileGeneration = { ...advanceStreamedInventory(emptyInventory(), raw).inventory,
    version: 'streamed-profile/1', jobId: id, rawJobId: id, source, readerSha256: hash, profilerSha256: hash,
    generation: 0, generationHash: hash, previousHash: null, coverage: 'sealed', rawChunkIndex: null,
    rawResultSha256: null, unknownRemainder: false, quarantineLocators: [],
    reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' } };
  const plan: StreamedMappingPlan = { version: 'streamed-mapping/1', scope: 'accepted_source_features',
    mode: 'streamed_mapping', caseId: id, caseRevision: 1, source, rawJobId: id, profileJobId: id,
    profileGeneration: 0, profileHash: hash, kind: 'building', basis: 'officer_stated',
    semanticEvidence: [], operations: [
      { target: 'feature.sourceKey' as const, sourcePath: '/features/*/geometry', conversionId: 'feature_position@1' },
      { target: 'feature.geometry' as const, sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] };
  const mapped = normalizeMappedChunk(raw, plan, profile, id, 0, []), store = keyStore();
  await reserveMappedKeysTx(store.client, id, mapped.keys);
  assert.deepEqual(mapped.records.map(record => record.disposition), ['observed', 'quarantined', 'observed']);
  assert.deepEqual(mapped.records[1].issueCodes, [raw[1].issueCode]);
  assert.deepEqual([...store.keys.values()].map(key => key.value), ['position:1', 'position:3']);
  assert.equal(store.statements.length, 1, 'one statement, not one per accepted neighbour');
  assert.equal(fingerprint(mapped.records), 'bef120f40d24f63894cf1d90e1f340171fd6936452e91c7b2a8d67077f6d256a');
});

test('batched reservations retain first occurrence and every within/across-chunk conflict', async () => {
  const store = keyStore(), first: KeyDecision = { hash, value: 'test_only', firstIndex: 0, laterIndex: null };
  await reserveMappedKeysTx(store.client, id, [first, { ...first, laterIndex: 2 }]);
  await reserveMappedKeysTx(store.client, id, [{ ...first, laterIndex: 100 }, { ...first, laterIndex: 101 }]);
  assert.deepEqual(store.keys.get(hash), { value: 'test_only', firstIndex: 0, conflicted: true });
  assert.deepEqual(store.conflicts, [2, 100, 101].map(later => ({ later, first: 0, hash })));
  assert.equal(store.statements.length, 5);
  const before = store.statements.length;
  await reserveMappedKeysTx(store.client, id, []);
  assert.equal(store.statements.length, before, 'quarantine-only chunks reserve nothing');
});

test('converter digest caching keeps the hash and re-reads changed file metadata', t => {
  const before = chunkMappingConverterSha(), read = fs.readFileSync, stat = fs.statSync;
  let stamp = 0n, reads = 0, changed = false;
  const target = (file: unknown) => String(file).endsWith('chunk-mapping-normalizer.ts');
  const statMock = t.mock.method(fs, 'statSync', (...args: Parameters<typeof stat>) => {
    const result = Reflect.apply(stat, fs, args);
    if (target(args[0]) && result && 'ctimeNs' in result) return { ...result, ctimeNs: result.ctimeNs + stamp };
    return result;
  });
  const readMock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof read>) => {
    if (target(args[0])) {
      reads++;
      if (changed) return Buffer.from('test_only changed producer');
    }
    return Reflect.apply(read, fs, args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    statMock.mock.restore();
    readMock.mock.restore();
    syncBuiltinESMExports();
    assert.equal(chunkMappingConverterSha(), before);
  });
  assert.equal(chunkMappingConverterSha(), before);
  assert.equal(reads, 0);
  stamp++;
  assert.equal(chunkMappingConverterSha(), before);
  assert.equal(reads, 1, 'metadata changes force a content check, even when the bytes are unchanged');
  stamp++;
  changed = true;
  assert.notEqual(chunkMappingConverterSha(), before);
  assert.equal(reads, 2);
});

test('the locked internal raw read retains object hash and exact source/chunk binding checks', async t => {
  const environment = { S3_ENDPOINT: 'http://offline.invalid', S3_REGION: 'test_only',
    S3_ACCESS_KEY: 'test_only', S3_SECRET_KEY: 'test_only', S3_BUCKET: 'test_only',
    ULPIN_LOCAL_OPERATOR_SUBJECT: 'test_only' };
  const saved = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const input = { rawJobId: id, caseId: id, sourceId: id, sourceRevision: 1, sourceSha256: hash,
    subject: 'test_only', accessBinding: ingestionBinding(id).access };
  const payload = StreamingVectorPayloadSchema.parse({ version: STREAMING_VECTOR_LIMITS.version, jobId: id,
    sourceId: id, sourceRevision: 1, sourceSha256: hash, chunkIndex: 0, records: await records() });
  const bytes = Buffer.from(JSON.stringify(payload));
  t.mock.method(S3Client.prototype, 'send', async () => ({ Body: { transformToByteArray: async () => bytes } }));
  const row = { chunk_index: 0, status: 'ready', published: true, first_feature_index: 0, last_feature_index: 2,
    records: 3, accepted: 2, quarantined: 1, bytes: bytes.length, object_key: 'test_only',
    object_sha256: sha256(bytes), issue_code: null, result_sha256: sha256(bytes), attempt: 1, fence: 1 };
  assert.deepEqual((await readPinnedRawChunk(input, row)).payload, payload);
  await assert.rejects(readPinnedRawChunk(input, { ...row, object_sha256: hash }),
    { code: 'STREAMING_CHUNK_INTEGRITY' });
  await assert.rejects(readPinnedRawChunk({ ...input, sourceRevision: 2 }, row),
    { code: 'STREAMING_CHUNK_INTEGRITY' });
  await assert.rejects(readPinnedRawChunk(input, { ...row, chunk_index: 1 }),
    { code: 'STREAMING_CHUNK_INTEGRITY' });
  await assert.rejects(readPinnedRawChunk({ ...input, accessBinding: hash }, row),
    { code: 'STREAMING_READ_BINDING' });
});
