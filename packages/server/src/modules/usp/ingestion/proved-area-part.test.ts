import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import ts from 'typescript';
import { StreamedMappingReceiptSchema, type StreamedMappingReceipt } from '@ulpin/contracts/usp';
import { conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';
import { assertConverterLayoutTx, nativeConverterOperations, nativeConverterPin } from './intake-native-derivative';
import { assertStreamedIssuerEvidence } from './streamed-mapping';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { provePartFeature, provedPartOperationKey, type ProvedAreaPartInput } from './proved-area-part';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'proved-part-protocol';

/** Exercise the private transaction gate with the real receipt schema and converter pin check. */
function layoutGate() {
  const path = 'packages/server/src/modules/usp/ingestion/proved-area-part.ts';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const gate = source.statements.find(node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'approvedPartLayoutTx');
  assert.ok(gate);
  const js = ts.transpileModule(gate.getText(source), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
  } }).outputText;
  const dependencies = { StreamedMappingReceiptSchema, fingerprint, conflict, notFound, localOperatorSubject,
    assertConverterLayoutTx, assertStreamedIssuerEvidence,
    loadSealedStreamedProfileTx: async () => ({ profile: {} }),
    compileStreamedMapping: () => ({ kind: 'building', idField: 'gml:id' }) };
  return new Function(...Object.keys(dependencies), `${js}; return approvedPartLayoutTx;`)(
    ...Object.values(dependencies));
}

/** Protocol controls only: no invented file, feature or registry record is imported. */
function converterSource(id: string, originalId: string, hash: string) {
  return { id, case_id: id, profile: 'large-original-v1', sha256: hash, bytes: 1,
    inspection: { nativeDerivative: { version: 'native-derivative/1', conversion: 'native_gis_to_geojson@1',
      readerVersion: 'citygml-ground-outline/1', originalSourceId: originalId, originalSourceRevision: 1,
      originalSha256: hash, originalItemId: originalId, format: 'citygml', layer: 'building ground outlines',
      ordinal: 0, crs: 'EPSG:4326', crsSource: 'stated', features: 1, notWritten: 0,
      sidecar: { objectKey: `native-derivatives/${hash}/0/sidecar-${hash}`, bytes: 1, sha256: hash },
      converterLayout: { method: 'converter:citygml-ground-outline@1', sourceClasses: ['Building'],
        kind: 'building', identifierField: 'gml:id', nameField: null,
        derivativeSha256: hash, derivativeBytes: 1 } } } };
}

function layoutFixture(converter = true) {
  const id = '30000000-0000-4000-8000-000000000001';
  const originalId = '30000000-0000-4000-8000-000000000002';
  const hash = 'a'.repeat(64), at = '2026-10-20T00:00:00.000Z';
  const source = converterSource(id, originalId, hash);
  const plan = { version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
    caseId: id, caseRevision: 1, source: { sourceId: id, familyId: id, sourceRevision: 1,
      sourceSha256: hash, schemaFingerprint: hash }, rawJobId: id, profileJobId: id, profileGeneration: 1,
    profileHash: hash, kind: 'building', basis: converter ? 'converter_recorded' : 'officer_stated',
    ...(converter ? { converterPin: nativeConverterPin(source) } : {}),
    operations: nativeConverterOperations(source), semanticEvidence: [] };
  const receipt = StreamedMappingReceiptSchema.parse({ id, revision: 1, state: 'approved', plan,
    planHash: fingerprint(plan), authoredBy: localOperatorSubject(), authoredAt: at,
    approval: { subject: converter ? null : localOperatorSubject(), at, planHash: fingerprint(plan),
      provenance: converter ? 'converter_recorded' : 'server_configured_local_operator' } });
  const input = { sourceId: id, sourceRevision: 1, sourceSha256: hash, layoutHash: receipt.planHash };
  let originalHeld = true;
  const locks: string[] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    locks.push(sql);
    if (sql.startsWith('SELECT body FROM usp_mapping_recipes')) {
      assert.deepEqual(values, [id, id]);
      assert.match(sql, /FOR SHARE$/);
      return { rows: [{ body: receipt }] };
    }
    assert.match(sql, /^SELECT id FROM sources[\s\S]*FOR SHARE$/);
    assert.deepEqual(values, [originalId, id, 1, hash]);
    return { rows: originalHeld ? [{ id: originalId }] : [] };
  } };
  const gate = layoutGate();
  return { receipt, input, source, locks, releaseOriginal: () => { originalHeld = false; },
    run: () => gate(client, input, source) };
}

function rehash(receipt: StreamedMappingReceipt, input: { layoutHash: string }) {
  receipt.planHash = fingerprint(receipt.plan);
  receipt.approval!.planHash = receipt.planHash;
  input.layoutHash = receipt.planHash;
}

for (const converter of [true, false]) {
  test(`proved layout accepts an exact ${converter ? 'converter' : 'officer'} approval`, async () => {
    const f = layoutFixture(converter);
    assert.equal((await f.run()).plan.basis, converter ? 'converter_recorded' : 'officer_stated');
    assert.equal(f.locks.length, converter ? 2 : 1);
  });
}

for (const changed of ['converter pin', 'original pin', 'plan hash', 'approval hash', 'source revision',
  'source hash', 'source id', 'state', 'officer provenance without subject', 'converter subject',
  'officer approval'] as const) {
  test(`proved converter layout refuses changed ${changed}`, async () => {
    const f = layoutFixture();
    if (changed === 'converter pin') {
      f.receipt.plan.converterPin!.originalSha256 = 'b'.repeat(64);
      rehash(f.receipt, f.input);
    }
    if (changed === 'original pin') f.releaseOriginal();
    if (changed === 'plan hash') {
      f.receipt.planHash = 'b'.repeat(64);
      f.receipt.approval!.planHash = f.receipt.planHash;
      f.input.layoutHash = f.receipt.planHash;
    }
    if (changed === 'approval hash') f.receipt.approval!.planHash = 'b'.repeat(64);
    if (changed === 'source revision') {
      f.receipt.plan.source.sourceRevision++;
      rehash(f.receipt, f.input);
    }
    if (changed === 'source hash') f.input.sourceSha256 = 'b'.repeat(64);
    if (changed === 'source id') f.input.sourceId = '30000000-0000-4000-8000-000000000003';
    if (changed === 'state') f.receipt.state = 'proposed';
    if (changed === 'officer provenance without subject')
      f.receipt.approval!.provenance = 'server_configured_local_operator';
    if (changed === 'converter subject') f.receipt.approval!.subject = localOperatorSubject();
    if (changed === 'officer approval') {
      f.receipt.approval!.provenance = 'server_configured_local_operator';
      f.receipt.approval!.subject = localOperatorSubject();
    }
    if (changed === 'officer provenance without subject' || changed === 'converter subject')
      await assert.rejects(f.run(), { name: 'ZodError' });
    else await assert.rejects(f.run(), { code: changed.endsWith('pin') ? 'CONVERTER_LAYOUT' : 'STALE_REVISION' });
  });
}

for (const changed of ['another subject', 'converter provenance', 'missing subject', 'converter approval'] as const) {
  test(`proved officer layout refuses ${changed}`, async () => {
    const f = layoutFixture(false);
    if (changed === 'another subject') f.receipt.approval!.subject = 'another-protocol-subject';
    if (changed === 'converter provenance') f.receipt.approval!.provenance = 'converter_recorded';
    if (changed === 'missing subject') f.receipt.approval!.subject = null;
    if (changed === 'converter approval') {
      f.receipt.approval!.provenance = 'converter_recorded';
      f.receipt.approval!.subject = null;
    }
    const invalidSubject = changed === 'another subject' || changed === 'converter approval';
    await assert.rejects(f.run(), invalidSubject ? { code: 'STALE_REVISION' } : { name: 'ZodError' });
  });
}

test('real NYC raw features retain exact hash/geometry/properties and global ranges, including index 1322',
  async () => {
  const bytes = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
  let seen = 0;
  await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
    const record = sourceRecord(item);
    const proved = await provePartFeature(record, item.raw, bytes.length);
    assert.deepEqual(proved.feature, item.feature);
    assert.equal(proved.range.featureIndex, item.index);
    assert.equal(proved.range.byteStart, item.start);
    assert.equal(proved.range.byteEnd, item.end);
    assert.equal(proved.range.rawSha256, record.rawSha256);
    assert.equal(proved.range.readerVersion, 'geojson-stream/2');
    if (item.index === 0) {
      await assert.rejects(provePartFeature(record, Buffer.from('changed'), bytes.length));
      await assert.rejects(provePartFeature({ ...record, rawSha256: 'b'.repeat(64) }, item.raw, bytes.length));
      await assert.rejects(provePartFeature(record, item.raw, item.end - 1));
    }
    seen++;
  });
  assert.equal(seen, 1662);
});

test('proved operation identity depends only on original, reader, approved layout and cut', () => {
  const input = { sourceId: '11111111-1111-4111-8111-111111111111', sourceRevision: 1,
    sourceSha256: 'a'.repeat(64), readerVersion: 'geojson-stream/2', layoutHash: 'b'.repeat(64), cutIndex: 0,
    destination: { namespace: 'protocol-only', name: 'protocol-only' }, features: [] } as ProvedAreaPartInput;
  const key = provedPartOperationKey(input);
  assert.equal(provedPartOperationKey({ ...input, destination: { ...input.destination, name: 'changed' } }), key);
  for (const changed of [{ sourceRevision: 2 }, { sourceSha256: 'c'.repeat(64) },
    { layoutHash: 'd'.repeat(64) }, { cutIndex: 1 }])
    assert.notEqual(provedPartOperationKey({ ...input, ...changed }), key);
  assert.throws(() => provedPartOperationKey({ ...input, cutIndex: -1 }));
});
