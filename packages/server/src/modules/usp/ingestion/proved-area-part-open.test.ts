import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import type { PoolClient } from 'pg';
import { StreamedMappingReceiptSchema, type StreamedProfileGeneration } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';
import { ingestionBinding } from './events';
import { prepareProvedAreaPartTx, type ProvedAreaPartInput } from './proved-area-part';
import { sealedMapReceipt } from './streamed-map-receipt';
import { prefixSealCheckKey } from './streamed-mapping';
import { streamedGenerationHash, streamedProfilerSha } from './streamed-profile';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { StreamingVectorService, streamingReaderSha } from './streaming-vector';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';

const id = '542d0000-0000-4000-8000-000000000001';
const rawId = '542d0000-0000-4000-8000-000000000002';
const mappingId = '542d0000-0000-4000-8000-000000000003';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-large-protocol';

async function fixture(context: TestContext) {
  const bytes = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson'), hash = sha256(bytes);
  const items: any[] = [];
  await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => { items.push(item); });
  const records = items.map(sourceRecord), binding = ingestionBinding(id);
  const rawBase = { version: 'geojson-stream/2', jobId: rawId, caseId: id, caseRevision: 1,
    sourceId: id, sourceRevision: 1, sourceFamilyId: id, sourceSha256: hash, sourceBytes: bytes.length,
    objectKey: 'test_only', framing: 'feature-collection', subject: binding.subject, accessBinding: binding.access,
    readerSha256: streamingReaderSha() };
  const raw = { ...rawBase, inputFingerprint: fingerprint(rawBase) };
  const profileBase = { version: 'streamed-profile/1', jobId: id, caseId: id, caseRevision: 1, sourceId: id,
    sourceRevision: 1, sourceFamilyId: id, sourceSha256: hash, rawJobId: rawId,
    rawInputFingerprint: fingerprint(raw), readerSha256: raw.readerSha256, profilerSha256: streamedProfilerSha(),
    subject: binding.subject, accessBinding: binding.access };
  const profileInput = { ...profileBase, inputFingerprint: fingerprint(profileBase) };
  const generations: StreamedProfileGeneration[] = [];
  for (let index = 0; index < 3; index++) {
    const inventory = advanceStreamedInventory(emptyInventory(), index === 0 ? records.slice(0, 1) : records)
      .inventory;
    const body: StreamedProfileGeneration = { ...inventory, version: 'streamed-profile/1', jobId: id,
      rawJobId: rawId, source: { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash,
        schemaFingerprint: hash }, readerSha256: raw.readerSha256, profilerSha256: profileInput.profilerSha256,
      generation: index, generationHash: hash, previousHash: generations.at(-1)?.generationHash ?? null,
      coverage: index === 2 ? 'sealed' : 'provisional', unknownRemainder: index !== 2,
      rawChunkIndex: index === 2 ? null : index, rawResultSha256: index === 2 ? null : hash,
      quarantineLocators: [], reference: { sourceCrs: 'EPSG:4326', evidence: 'test_only file GeoJSON',
        unit: 'degree', globalPlacement: 'not_qualified' } };
    body.generationHash = streamedGenerationHash(body);
    body.source.schemaFingerprint = body.generationHash;
    generations.push(body);
  }
  const prefix = generations[0], sealed = generations[2];
  const plan = { version: 'streamed-prefix-mapping/1', scope: 'observed_prefix_and_later_compatible_features',
    mode: 'streamed_mapping', caseId: id, caseRevision: 1, source: prefix.source, rawJobId: rawId,
    profileJobId: id, profileGeneration: 0, profileHash: prefix.generationHash, kind: 'building',
    basis: 'officer_stated', semanticEvidence: [], prefix: { throughRawChunkIndex: 0, rawResultSha256: hash,
      recordsSeen: 1, accepted: 1 }, operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/properties/source_id',
        conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' }] };
  const receipt = StreamedMappingReceiptSchema.parse({ id, revision: 2, state: 'approved', plan,
    planHash: fingerprint(plan), authoredBy: binding.subject, authoredAt: '2026-10-11T00:00:00.000Z',
    approval: { planHash: fingerprint(plan), subject: binding.subject,
      provenance: 'server_configured_local_operator', at: '2026-10-11T00:00:00.000Z' } });
  const check = { mappingJobId: mappingId, changed: false, conflicts: [] as number[],
    key: prefixSealCheckKey(receipt.planHash, sealed.generationHash, mappingId) };
  const slots = [records.slice(0, 1), records.slice(1)].map((part, index) => ({ chunk_index: index,
    first_feature_index: part[0].featureIndex, last_feature_index: part.at(-1)!.featureIndex,
    records: part.length, accepted: part.length, quarantined: 0, published: true, result_sha256: hash }));
  // Protocol identities only; feature bytes, inventory and locators come from the retained real file.
  const source = { id, case_id: id, family_id: id, revision: 1, bytes: bytes.length, sha256: hash,
    object_key: 'test_only', profile: 'large-original-v1', inspection: { intakePrefixSealCheck: check,
      largeOriginal: { uploadId: id, operatorSubject: localOperatorSubject(), objectEtag: 'test_only',
        verifiedSha256: hash, verifiedBytes: bytes.length, conversion: 'unsupported',
        bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
        provenance: { issuer: 'test_only', originalUrl: 'https://example.invalid/test_only',
          acquiredAt: '2026-10-11T00:00:00.000Z', permissionReference: 'test_only', limitations: [],
          state: 'caller_declared' } }, streamedMapReceipt: sealedMapReceipt(raw as any,
      { bytes: bytes.length, sha256: hash, features: records.length,
        metadata: { type: 'FeatureCollection' } }, slots) } };
  const mapped = { job_id: mappingId, source_id: id, raw_job_id: rawId, source_revision: 1,
    state: 'running', next_publish_index: 1, sealed_chunks: null as number | null,
    unknown_remainder: true, records: 1, payload: { planHash: receipt.planHash, recipeId: id, recipeRevision: 2,
      sourceSha256: hash, rawJobId: rawId, route: 'approved_recipe' } };
  const reader = { sealed_chunks: 2, records: records.length, state: 'completed', unknown_remainder: false };
  let rawReads = 0;
  context.mock.method(StreamingVectorService.prototype, 'chunk', async () => {
    rawReads++;
    return { current: true, sourceComplete: true, unknownRemainder: false, payload: { records } } as any;
  });
  const client = { query: async (sql: string, v: any[] = []) => {
    const one = (row?: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    if (sql.startsWith('SELECT case_id')) return one({ case_id: id });
    if (sql.startsWith('SELECT id,revision,archived')) return one({ id, revision: 1, archived: false });
    if (sql.startsWith('SELECT * FROM sources')) return one(source);
    if (sql.startsWith('SELECT max(revision)')) return one({ revision: 1 });
    if (sql.startsWith('SELECT body FROM usp_mapping_recipes')) return one({ body: receipt });
    if (sql.startsWith('SELECT payload FROM jobs')) return one({ payload: v[0] === rawId ? raw : profileInput });
    if (sql.startsWith('SELECT input_fingerprint')) return one({ input_fingerprint: fingerprint(raw) });
    if (sql.startsWith('SELECT issue_code')) return one({ issue_code: null });
    if (sql.startsWith('SELECT state,sealed_generation')) return one({ state: 'sealed', sealed_generation: 2 });
    if (sql.startsWith('SELECT body,body_sha256')) {
      const body = generations[v[1]];
      return one({ body, body_sha256: fingerprint(body), raw_chunk_index: body.rawChunkIndex,
        raw_result_sha256: body.rawResultSha256, sealed: body.coverage === 'sealed' });
    }
    if (sql.startsWith('SELECT body->>')) return one({ generation_hash: generations[v[1]].generationHash });
    if (sql.startsWith('SELECT result_sha256')) return one({ result_sha256: hash });
    if (sql.startsWith('SELECT g.generation')) return one({ generation: 2, hash: sealed.generationHash });
    if (sql.startsWith('SELECT m.job_id')) {
      assert.match(sql, /m.next_publish_index=m.sealed_chunks/);
      return one(!mapped.unknown_remainder && mapped.sealed_chunks === v[3]
        && mapped.next_publish_index === mapped.sealed_chunks && mapped.records === v[4]
        && ['completed', 'completed_with_rejections', 'needs_input'].includes(mapped.state)
        && { job_id: mappingId });
    }
    if (sql.startsWith('SELECT m.next_publish_index')) {
      assert.match(sql, /FOR SHARE OF m,j,r/);
      assert.match(sql, /j.payload->>'rawJobId'=m.raw_job_id::text/);
      assert.match(sql, /m.state IN \('queued','running'\)/);
      return one(mapped.job_id === v[0] && mapped.source_id === v[1] && mapped.raw_job_id === v[2]
        && mapped.source_revision === v[3] && ['queued', 'running'].includes(mapped.state)
        && reader.sealed_chunks === v[4] && reader.records === v[5] && !reader.unknown_remainder
        && ['completed', 'completed_with_rejections'].includes(reader.state)
        && mapped.payload.planHash === v[6] && mapped.payload.recipeId === v[7]
        && mapped.payload.recipeRevision === v[8] && mapped.payload.sourceSha256 === v[9]
        && mapped.payload.rawJobId === mapped.raw_job_id && mapped.payload.route === 'approved_recipe' && mapped);
    }
    throw new Error(sql);
  } } as PoolClient;
  const input: ProvedAreaPartInput = { sourceId: id, sourceRevision: 1, sourceSha256: hash,
    readerVersion: 'geojson-stream/2', layoutHash: receipt.planHash, cutIndex: 0,
    destination: { namespace: 'test_only', name: 'test_only' }, features: [
      { rawChunkIndex: 0, featureIndex: 0, rawBytes: items[0].raw }] };
  return { run: () => prepareProvedAreaPartTx(client, input), input, mapped, reader, check, receipt, generations,
    source, feature: items[0].feature, rawReads: () => rawReads };
}

for (const state of ['queued', 'running']) {
  test(`real proved preparation admits published prefix chunks of a checked ${state} mapping`, async context => {
    const f = await fixture(context);
    f.mapped.state = state;
    const part = await f.run();
    assert.deepEqual(part.features, [f.feature]);
    assert.equal(part.ranges.get(0)?.rawSha256, sha256(f.input.features[0].rawBytes));
    assert.equal(f.rawReads(), 1);
  });
}

for (const fence of ['unpublished', 'changed', 'key', 'job', 'failed', 'source', 'revision', 'rawJob',
  'plan', 'recipe', 'recipeRevision', 'sha', 'route', 'rawOpen', 'rawUnsealed', 'rawRecords', 'rawUnknown',
  'duplicate', 'layoutDrift', 'missingCheck', 'rawPayload'] as const) {
  test(`real proved prefix preparation refuses ${fence} before reading a part`, async context => {
    const f = await fixture(context);
    if (fence === 'unpublished') f.input.features[0].rawChunkIndex = f.mapped.next_publish_index;
    if (fence === 'changed') f.check.changed = true;
    if (fence === 'key') f.check.key = 'b'.repeat(64);
    if (fence === 'job') f.check.mappingJobId = rawId;
    if (fence === 'failed') f.mapped.state = 'failed';
    if (fence === 'source') f.mapped.source_id = rawId;
    if (fence === 'revision') f.mapped.source_revision++;
    if (fence === 'rawJob') f.mapped.raw_job_id = id;
    if (fence === 'plan') f.mapped.payload.planHash = 'b'.repeat(64);
    if (fence === 'recipe') f.mapped.payload.recipeId = rawId;
    if (fence === 'recipeRevision') f.mapped.payload.recipeRevision++;
    if (fence === 'sha') f.mapped.payload.sourceSha256 = 'b'.repeat(64);
    if (fence === 'route') f.mapped.payload.route = 'proposal_only';
    if (fence === 'rawOpen') f.reader.state = 'running';
    if (fence === 'rawUnsealed') f.reader.sealed_chunks = 1;
    if (fence === 'rawRecords') f.reader.records++;
    if (fence === 'rawUnknown') f.reader.unknown_remainder = true;
    if (fence === 'duplicate') f.check.conflicts.push(0);
    if (fence === 'missingCheck') delete (f.source.inspection as any).intakePrefixSealCheck;
    if (fence === 'rawPayload') f.mapped.payload.rawJobId = id;
    if (fence === 'layoutDrift') {
      const sealed = f.generations[2];
      sealed.paths.find(path => path.path.endsWith('/source_id'))!.absent++;
      sealed.generationHash = streamedGenerationHash(sealed);
      sealed.source.schemaFingerprint = sealed.generationHash;
      f.check.key = prefixSealCheckKey(f.receipt.planHash, sealed.generationHash, mappingId);
    }
    await assert.rejects(f.run(), (error: any) => error.code === 'STALE_REVISION');
    assert.equal(f.rawReads(), 0);
  });
}

test('real closed prefix preparation keeps its completed states and exact closure checks', async context => {
  const f = await fixture(context);
  Object.assign(f.mapped, { sealed_chunks: 2, next_publish_index: 2, records: f.reader.records,
    unknown_remainder: false });
  for (const state of ['completed', 'completed_with_rejections', 'needs_input']) {
    f.mapped.state = state;
    assert.deepEqual((await f.run()).features, [f.feature]);
  }
  f.mapped.records--;
  await assert.rejects(f.run(), /has not passed comparison/);
});
