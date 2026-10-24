import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamedMapOriginalReceiptSchema, type StreamingVectorInput } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { resolveStreamedReference, sealedMapReceipt, streamedSourceReference,
  writeSealedMapReceiptTx } from './streamed-map-receipt';
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
  metadata: { type: 'FeatureCollection' }, quarantinedByCode: { SELF_INTERSECTION: 1 } };
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

const named = (name: string) => ({ type: 'name', properties: { name } });

test('a declared projected system is stored as written with its resolved code, through the geo resolver', async () => {
  const asked: unknown[] = [];
  const reference = await resolveStreamedReference({ type: 'FeatureCollection', crs: named('EPSG:2958') },
    async collection => {
      asked.push(collection);
      return { declared: 'EPSG:2958', authority: 'EPSG:2958', unit: 'metre' };
    });
  assert.deepEqual(asked, [{ crs: named('EPSG:2958') }]);
  assert.deepEqual(reference, { sourceCrs: 'EPSG:2958', evidence: "Declared in the file's crs member: `EPSG:2958`",
    coordinateUnit: 'metre', authority: 'EPSG:2958' });
  const retained = source();
  retained.inspection.streamedMapReceipt = sealedMapReceipt(input, closure, slots, reference);
  assert(isRetainedMapOriginal(retained));
});

test('a declaration the geo resolver refuses stops the receipt with its words', async () => {
  const words = 'The file\'s crs member declares {"type":"name","properties":{"name":"unknown"}}; its name is not a '
    + 'recognized coordinate reference system.';
  await assert.rejects(resolveStreamedReference({ crs: named('unknown') }, async () => {
    throw new AppError(422, 'AREA_PROCESSING', words);
  }), { status: 422, code: 'STREAMING_SOURCE_CRS', message: words });
  await assert.rejects(resolveStreamedReference({ crs: named('EPSG:2958') }, async () => {
    throw new AppError(503, 'AREA_PROCESSING', 'down');
  }), { status: 503 });
});

test('a 422 that is not the resolver refusing the declaration is a fault the reader retries', async () => {
  for (const words of ['Unexpected geo operation resolve-geojson-crs.',
    'The area processor could not complete this operation.', "'collection'"]) {
    const failure = await resolveStreamedReference({ crs: named('EPSG:2958') }, async () => {
      throw new AppError(422, 'AREA_PROCESSING', words);
    }).catch(error => error);
    assert(failure instanceof Error && !(failure instanceof AppError), words);
    assert.equal(failure.message, 'The coordinate system resolution failed.');
  }
});

test('a file that declares nothing or CRS84 keeps its receipt unchanged', async () => {
  const refuse = async () => { throw new Error('not asked'); };
  assert.deepEqual(await resolveStreamedReference({ type: 'FeatureCollection' }, refuse), streamedSourceReference({}));
  const crs84 = { crs: named('urn:ogc:def:crs:OGC:1.3:CRS84') };
  assert.deepEqual(await resolveStreamedReference(crs84, async () => ({
    declared: 'urn:ogc:def:crs:OGC:1.3:CRS84', authority: 'EPSG:4326', unit: 'degree' })),
  streamedSourceReference(crs84));
  assert.deepEqual(sealedMapReceipt(input, closure, slots, streamedSourceReference({})),
    sealedMapReceipt(input, closure, slots));
});

test('the receipt counts its set-aside records by code, and the codes close at the set-aside total', () => {
  const twoCodes = [{ ...slots[0], accepted: 0, quarantined: 3 }];
  const receipt = sealedMapReceipt(input, { ...closure,
    quarantinedByCode: { UNREPRESENTABLE_NUMBER: 2, SELF_INTERSECTION: 1 } }, twoCodes);
  assert.deepEqual(receipt.quarantinedByCode, { UNREPRESENTABLE_NUMBER: 2, SELF_INTERSECTION: 1 });
  for (const quarantinedByCode of [{ UNREPRESENTABLE_NUMBER: 1, SELF_INTERSECTION: 1 }, {}, undefined] as
    (Record<string, number> | undefined)[])
    assert.throws(() => sealedMapReceipt(input, { ...closure, quarantinedByCode }, twoCodes));
  for (const quarantinedByCode of [{ UNREPRESENTABLE_NUMBER: 3, SELF_INTERSECTION: 0 }, { 'self-x': 3 }])
    assert(!StreamedMapOriginalReceiptSchema.safeParse({ ...receipt, quarantinedByCode }).success);
  const codes = (length: number) => Object.fromEntries(Array.from({ length }, (_, index) => [`CODE_${index}`, 1]));
  const wide = { ...receipt, accepted: 0, quarantined: 65, features: 65 };
  assert(StreamedMapOriginalReceiptSchema.safeParse({ ...wide, quarantinedByCode: { ...codes(64), CODE_0: 2 } })
    .success);
  assert(!StreamedMapOriginalReceiptSchema.safeParse({ ...wide, quarantinedByCode: codes(65) }).success);
});

test('nothing set aside writes no codes; a receipt stored before the codes still parses', () => {
  const clean = [{ ...slots[0], accepted: 3, quarantined: 0 }];
  const receipt = sealedMapReceipt(input, { ...closure, quarantinedByCode: {} }, clean);
  assert(!Object.hasOwn(receipt, 'quarantinedByCode'));
  assert(!StreamedMapOriginalReceiptSchema.safeParse({ ...receipt, quarantinedByCode: {} }).success);
  const { quarantinedByCode: _, ...stored } = source().inspection.streamedMapReceipt;
  assert.equal(stored.quarantined, 1);
  assert(StreamedMapOriginalReceiptSchema.safeParse(stored).success);
});
