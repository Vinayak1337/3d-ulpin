import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { StreamedMappingPlanSchema, type ChunkMappingInput,
  type StreamedProfileGeneration } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { ingestionBinding } from './events';
import { normalizeMappedChunk, type KeyRow } from './chunk-mapping-normalizer';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { Readable } from 'node:stream';

const id = '53000000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);

/** Real neighbouring features replayed in a test-only transport, with a malformed member between them. */
async function fixture(t: TestContext) {
  const environment = { S3_ENDPOINT: 'http://offline.invalid', S3_REGION: 'test_only', S3_ACCESS_KEY: 'test_only',
    S3_SECRET_KEY: 'test_only', S3_BUCKET: 'test_only', ULPIN_LOCAL_OPERATOR_SUBJECT: 'test_only' };
  const saved = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const original = JSON.parse(await readFile('fixtures/google-uttam/00-all-google-detections.geojson', 'utf8'));
  const raw: ReturnType<typeof sourceRecord>[] = [];
  const text = [original.features[0], null, original.features[1]].map(value => JSON.stringify(value)).join('\n');
  await readStreamingFeatures(Readable.from([text + '\n']), 'geojson-lines', async item => {
    raw.push(sourceRecord(item));
  });
  const source = { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash };
  const profile: StreamedProfileGeneration = { ...advanceStreamedInventory(emptyInventory(), raw).inventory,
    version: 'streamed-profile/1', jobId: id, rawJobId: id, source, readerSha256: hash, profilerSha256: hash,
    generation: 0, generationHash: hash, previousHash: null, coverage: 'sealed', rawChunkIndex: null,
    rawResultSha256: null, unknownRemainder: false, quarantineLocators: [],
    reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' } };
  const plan = StreamedMappingPlanSchema.parse({ version: 'streamed-mapping/1', scope: 'accepted_source_features',
    mode: 'streamed_mapping', caseId: id, caseRevision: 1, source, rawJobId: id, profileJobId: id,
    profileGeneration: 0, profileHash: hash, kind: 'building', basis: 'officer_stated', semanticEvidence: [],
    operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/properties/source_id',
        conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] });
  const input = { version: 'chunk-mapping/1', jobId: id, rawJobId: id, caseId: id, sourceId: id,
    sourceRevision: 1, sourceSha256: hash, recipeRevision: 1, converterSha256: hash, subject: 'test_only',
    accessBinding: ingestionBinding(id).access } as ChunkMappingInput;
  const attempt = { jobId: id, number: 1, fence: 1, owner: 'test_only', inputSha256: hash, leaseUntil: '' };
  const state = { state: 'running', next_publish_index: 0, records: 0 };
  const keys = new Map<string, KeyRow>(), conflicts: number[] = [], published: string[] = [];
  const objects = new Map<string, Buffer>(), slots: Record<string, any>[] = [], chunks: typeof raw[] = [];
  for (let index = 0; index < 17; index++) {
    const records = raw.map(record => ({ ...record, featureIndex: index * raw.length + record.featureIndex }));
    chunks.push(records);
    const bytes = Buffer.from(JSON.stringify({ version: 'geojson-stream/2', jobId: id, sourceId: id,
      sourceRevision: 1, sourceSha256: hash, chunkIndex: index, records }));
    objects.set(`raw/${index}`, bytes);
    slots.push({ chunk_index: index, status: 'ready', published: true, first_feature_index: index * raw.length,
      last_feature_index: (index + 1) * raw.length - 1, records: raw.length, accepted: 2, quarantined: 1,
      bytes: bytes.length, object_key: `raw/${index}`, object_sha256: sha256(bytes), result_sha256: sha256(bytes),
      issue_code: null, attempt: 1, fence: 1 });
  }
  const control = { validations: 0, wakes: 0, expired: false, integrity: false, changed: false, stored: 0,
    failPart: -1, failSqlPart: -1, afterStore: () => {} };
  t.mock.method(S3Client.prototype, 'send', async (command: any) => {
    const { Key, Body } = command.input;
    if (Body) {
      objects.set(Key, Buffer.from(Body));
      control.stored++;
      control.afterStore();
      return {};
    }
    if (Key === `raw/${control.failPart}`) throw new Error('test_only storage refusal');
    return { Body: { transformToByteArray: async () => objects.get(Key) } };
  });
  const snapshot = () => structuredClone({ state, keys, conflicts, published });
  const restore = (value: ReturnType<typeof snapshot>) => {
    Object.assign(state, value.state);
    keys.clear();
    for (const [key, row] of value.keys) keys.set(key, row);
    conflicts.splice(0, Infinity, ...value.conflicts);
    published.splice(0, Infinity, ...value.published);
  };
  let transaction = snapshot(), part = snapshot();
  const one = (row?: unknown) => ({ rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 });
  const query = async (sql: string, v: any[] = []) => {
    if (sql === 'BEGIN') transaction = snapshot();
    else if (sql === 'ROLLBACK') restore(transaction);
    else if (sql.startsWith('SAVEPOINT')) part = snapshot();
    else if (sql.startsWith('ROLLBACK TO')) restore(part);
    else if (sql.startsWith('SELECT status FROM jobs')) return one({ status: 'running' });
    else if (sql.startsWith('SELECT * FROM usp_job_metadata'))
      return one({ logical_state: 'running', input_sha256: hash });
    else if (sql.startsWith('SELECT * FROM usp_job_attempts')) return one({ ...attempt, state: 'active',
      input_sha256: hash, lease_until: new Date(Date.now() + (control.expired ? -1 : 180000)) });
    else if (sql.startsWith('SELECT') && sql.includes('FROM usp_chunk_mapping_imports')) return one(state);
    else if (sql.startsWith('SELECT') && sql.includes('FROM usp_streaming_vector_imports'))
      return one({ state: 'completed', issue_code: control.integrity ? 'STREAMING_SOURCE_INTEGRITY' : null });
    else if (sql.startsWith('SELECT') && sql.includes('FROM usp_streaming_vector_slots')) return one(slots[v[2]]);
    else if (sql.startsWith('SELECT source_key_sha256'))
      return { rows: v[1].flatMap((key: string) => keys.has(key) ? [keys.get(key)] : []) };
    else if (sql.startsWith('INSERT INTO usp_chunk_mapping_slots')) published.push(v[14]);
    else if (sql.startsWith('INSERT INTO usp_chunk_mapping_keys')) v[1].forEach((key: string, index: number) => {
      assert(!keys.has(key));
      keys.set(key, { source_key_sha256: key, source_key: v[2][index], first_feature_index: v[3][index] });
    });
    else if (sql.startsWith('INSERT INTO usp_chunk_mapping_conflicts')) conflicts.push(...v[1]);
    else if (sql.startsWith('UPDATE usp_chunk_mapping_imports')) {
      assert.match(sql, /updated_at=clock_timestamp\(\)/, 'the no-chunk clock advances at publication');
      if (state.next_publish_index === control.failSqlPart) throw new Error('test_only SQL refusal');
      state.next_publish_index++;
      state.records += v[1];
    } else if (!/^(COMMIT|RELEASE SAVEPOINT|UPDATE usp_chunk_mapping_keys)/.test(sql)) assert.fail(sql);
    return one();
  };
  const globals = globalThis as typeof globalThis & { mappingBatchTest?: unknown; ulpinPool?: unknown };
  const priorPool = globals.ulpinPool;
  globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) };
  globals.mappingBatchTest = { assert: async () => {
    control.validations++;
    if (control.changed && control.validations > 1) throw new Error('test_only changed converter');
    return { profile, approved: { receipt: { plan } }, ctx: { binding: ingestionBinding(id) } };
  }, wake: async () => { control.wakes++; } };
  t.after(() => { globals.ulpinPool = priorPool; delete globals.mappingBatchTest; });
  const path = fileURLToPath(new URL('./chunk-mapping-worker.ts', import.meta.url));
  let code = await readFile(path, 'utf8');
  code = code.replace("import {assertChunkMappingInputTx} from './chunk-mapping';",
    'const assertChunkMappingInputTx = globalThis.mappingBatchTest.assert;');
  code = code.replace("import {queueIntakeLargeTx} from './intake-large';",
    'const queueIntakeLargeTx = globalThis.mappingBatchTest.wake;');
  code = code.replace("import {appendCaseIngestionTx} from './events';",
    'const appendCaseIngestionTx = async () => {};');
  code = code.replaceAll("'@ulpin/contracts/usp'",
    JSON.stringify(fileURLToPath(import.meta.resolve('@ulpin/contracts/usp'))));
  code = code.replace(/(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, _quote: string, specifier: string) => JSON.stringify(resolve(dirname(path), specifier)));
  const folder = await mkdtemp('E:/ulpin-tmp/mapping-batches-'), target = join(folder, 'worker.ts');
  await writeFile(target, code + '\nexport { window };\n');
  t.after(async () => { await rm(target); await rmdir(folder); });
  const worker = await import(pathToFileURL(target).href);
  return { run: () => worker.window(input, false, attempt), control, state, published, keys, conflicts,
    chunks, plan, profile, input };
}

test('sixteen ready GIS parts share guards, hashes and conflicts; one wake covers their watermark', async t => {
  const f = await fixture(t), expectedKeys = new Map<string, KeyRow>(), expectedHashes: string[] = [];
  for (const [index, records] of f.chunks.entries()) {
    const mapped = normalizeMappedChunk(records, f.plan, f.profile, id, index, [...expectedKeys.values()]);
    for (const key of mapped.keys) if (key.laterIndex === null) expectedKeys.set(key.hash,
      { source_key_sha256: key.hash, source_key: key.value, first_feature_index: key.firstIndex });
    expectedHashes.push(sha256(JSON.stringify({ version: 'chunk-mapping/1', jobId: id, rawJobId: id,
      sourceId: id, sourceRevision: 1, sourceSha256: hash, chunkIndex: index,
      rawResultSha256: sha256(JSON.stringify({ version: 'geojson-stream/2', jobId: id, sourceId: id,
        sourceRevision: 1, sourceSha256: hash, chunkIndex: index, records })),
      schemaFingerprint: hash, recipeRevision: 1, converterSha256: hash, records: mapped.records })));
  }
  assert.equal((await f.run()).consumed, 16);
  assert.equal(f.control.validations, 2, 'guards before and after storage, not twice per part');
  assert.equal(f.control.wakes, 1);
  assert.equal(f.control.stored, 16, 'no seventeenth payload retained or mapped in the first transaction');
  assert.equal(f.state.next_publish_index, 16);
  assert.equal((await f.run()).consumed, 1, 'no wait for an unpublished eighteenth part');
  assert.deepEqual(f.published, expectedHashes);
  assert.deepEqual(f.keys, expectedKeys);
  assert.deepEqual(f.conflicts, Array.from({ length: 16 }, (_, i) => [3 * (i + 1), 3 * (i + 1) + 2]).flat());
});

test('a bad second GIS part commits its good prefix, then retries that exact part', async t => {
  const f = await fixture(t);
  f.control.failPart = 1;
  await assert.rejects(f.run(), /storage refusal/);
  assert.equal(f.state.next_publish_index, 1);
  assert.equal(f.published.length, 1);
  assert.equal(f.control.wakes, 1);
  f.control.failPart = -1;
  assert.equal((await f.run()).consumed, 16);
  assert.equal(f.state.next_publish_index, 17);
});

test('a SQL refusal rolls back the failed part\'s slot and key conflicts, not its good neighbour', async t => {
  const f = await fixture(t);
  f.control.failSqlPart = 1;
  await assert.rejects(f.run(), /SQL refusal/);
  assert.equal(f.published.length, 1);
  assert.equal(f.state.next_publish_index, 1);
  assert.deepEqual(f.conflicts, []);
  f.control.failSqlPart = -1;
  assert.equal((await f.run()).consumed, 16);
  assert.equal(f.published.length, 17);
  assert.equal(f.conflicts.length, 32);
});

for (const condition of ['lease', 'code', 'cursor', 'access', 'source_integrity'] as const) {
  test(`grouped GIS publication retains the ${condition} fence across storage`, async t => {
    const f = await fixture(t);
    if (condition === 'source_integrity') f.control.integrity = true;
    else f.control.afterStore = () => {
      if (condition === 'lease') f.control.expired = true;
      if (condition === 'code') f.control.changed = true;
      if (condition === 'cursor') f.state.records++;
      if (condition === 'access') process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'test_only_changed';
    };
    const message = { lease: /expired, changed inputs or was fenced/, code: /changed converter/,
      cursor: /publication pointer or source index changed/, access: /local access context changed/,
      source_integrity: /pinned integrity check/ };
    await assert.rejects(f.run(), message[condition]);
    assert.equal(f.state.next_publish_index, 0);
    assert.equal(f.published.length, 0);
    assert.equal(f.keys.size, 0);
    assert.equal(f.control.wakes, 0);
    if (condition === 'source_integrity') assert.equal(f.control.stored, 0);
  });
}
