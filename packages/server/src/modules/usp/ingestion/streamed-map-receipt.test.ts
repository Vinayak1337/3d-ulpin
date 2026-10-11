import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StreamingVectorInput } from '@ulpin/contracts/usp';
import { sealedMapReceipt, streamedSourceReference, writeSealedMapReceiptTx } from './streamed-map-receipt';
import { isRetainedMapOriginal } from './retained-map-original';
import { permitsFeatureRecordSource } from '../../registry/registry-reference-policy';
import { assertIntakeSource } from './intake-context';

const input = {
  version: 'geojson-stream/2', jobId: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222', sourceRevision: 2,
  sourceBytes: 12345, sourceSha256: 'a'.repeat(64), framing: 'feature-collection',
  caseId: '33333333-3333-4333-8333-333333333333', objectKey: 'retained/original',
} as StreamingVectorInput;
const closure = { bytes: input.sourceBytes, sha256: input.sourceSha256, features: 3,
  metadata: { type: 'FeatureCollection' } };
const slots = [{ chunk_index: 0, first_feature_index: 0, last_feature_index: 2, records: 3,
  accepted: 2, quarantined: 1, published: true, result_sha256: 'b'.repeat(64) }];
const source = () => ({ id: input.sourceId, revision: 2, bytes: 12345, sha256: input.sourceSha256,
  profile: 'large-original-v1', status: 'needs_input', inspection: {
    status: 'needs_input', largeOriginal: { verifiedBytes: 12345, verifiedSha256: input.sourceSha256 },
    streamedMapReceipt: sealedMapReceipt(input, closure, slots),
  } });

test('only exact sealed large receipts qualify; caller still grants record purpose alone', () => {
  const retained = source();
  assert(isRetainedMapOriginal(retained));
  assert(permitsFeatureRecordSource(retained, 'record'));
  assert(!permitsFeatureRecordSource(retained, 'right'));
  assert(!permitsFeatureRecordSource(retained, 'geometry'));
  for (const changed of [
    { ...retained, revision: 1 }, { ...retained, id: input.jobId },
    { ...retained, sha256: 'c'.repeat(64) }, { ...retained, bytes: 12346 },
    { ...retained, inspection: {} },
    { ...retained, inspection: { ...retained.inspection,
      streamedMapReceipt: { ...retained.inspection.streamedMapReceipt, coverage: 'provisional' } } },
    { ...retained, inspection: { ...retained.inspection,
      streamedMapReceipt: { ...retained.inspection.streamedMapReceipt, unknownRemainder: true } } },
    { ...retained, inspection: { ...retained.inspection,
      largeOriginal: { verifiedBytes: 12345, verifiedSha256: 'd'.repeat(64) } } },
  ]) assert(!isRetainedMapOriginal(changed));
});

test('sealed receipt remains intake-readable, not mistaken for a second protected original', () => {
  const retained = source();
  const subject = 'protocol-only-operator';
  const original = { ...retained.inspection.largeOriginal, uploadId: input.jobId, operatorSubject: subject,
    objectEtag: 'protocol-etag', conversion: 'unsupported' as const,
    bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' as const,
    provenance: { issuer: 'Protocol test issuer', originalUrl: 'https://example.invalid/protocol',
      acquiredAt: '2026-10-11T00:00:00.000Z', permissionReference: 'Protocol only', limitations: [],
      state: 'caller_declared' as const } };
  assert.doesNotThrow(() => assertIntakeSource({ ...retained, case_id: input.caseId, family_id: input.sourceId,
    object_key: input.objectKey, name: 'protocol.geojson', inspection: { ...retained.inspection,
      largeOriginal: original } }, { subject, access: 'c'.repeat(64),
      caseId: input.caseId, tag: 0n, streamId: 'protocol-only' }));
});

test('closure refuses partial, unverified, noncontiguous and unpublished raw manifests', () => {
  for (const changed of [
    { ...closure, sha256: 'c'.repeat(64) }, { ...closure, bytes: 12344 }, { ...closure, features: 4 },
  ]) assert.throws(() => sealedMapReceipt(input, changed, slots));
  for (const changed of [
    { ...slots[0], published: false }, { ...slots[0], first_feature_index: 1 },
    { ...slots[0], accepted: 3 }, { ...slots[0], records: 0 },
  ]) assert.throws(() => sealedMapReceipt(input, closure, [changed]));
  assert.throws(() => sealedMapReceipt(input, closure, []));
  const changed = sealedMapReceipt(input, closure, [{ ...slots[0], result_sha256: 'c'.repeat(64) }]);
  assert.notEqual(changed.rawManifestSha256, source().inspection.streamedMapReceipt.rawManifestSha256);
});

test('source reference states omission assumption but never labels a projected CRS degree', () => {
  assert.equal(streamedSourceReference({}).coordinateUnit, 'degree');
  for (const name of ['EPSG:2958', 'EPSG:3857']) {
    const ref = streamedSourceReference({ crs: { type: 'name', properties: { name } } });
    assert.equal(ref.sourceCrs, name);
    assert.equal(ref.coordinateUnit, 'unknown');
    const retained = source();
    retained.inspection.streamedMapReceipt.reference = ref;
    assert(!isRetainedMapOriginal(retained));
  }
  assert.equal(streamedSourceReference({ crs: null }).sourceCrs, null);
  assert.equal(streamedSourceReference({ crs: { type: 'name', properties: {
    name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } }).coordinateUnit, 'degree');
});

test('receipt SQL write occurs only after closed state and exact source authority', async () => {
  let writes = 0;
  let state = 'running';
  const client = { query: async (sql: string, values: unknown[]) => {
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [{ ...source(),
      case_id: input.caseId, object_key: input.objectKey }] };
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_imports')) return { rows: [{ state,
      unknown_remainder: false, sealed_chunks: 1, next_publish_index: 1, records: 3, accepted: 2, quarantined: 1 }] };
    if (sql.startsWith('SELECT chunk_index')) return { rows: slots };
    assert(sql.startsWith('UPDATE sources'));
    writes++;
    assert.deepEqual(JSON.parse(values[1] as string), source().inspection.streamedMapReceipt);
    return { rows: [] };
  } };
  await assert.rejects(writeSealedMapReceiptTx(client as any, input, closure));
  assert.equal(writes, 0);
  state = 'completed_with_rejections';
  for (const name of ['EPSG:2958', 'EPSG:3857']) {
    await assert.rejects(writeSealedMapReceiptTx(client as any, input, { ...closure,
      metadata: { crs: { type: 'name', properties: { name } } } }),
    (error: any) => error.code === 'STREAMING_SOURCE_CRS' && error.status === 422);
  }
  assert.equal(writes, 0);
  await writeSealedMapReceiptTx(client as any, input, closure);
  assert.equal(writes, 1);
});
