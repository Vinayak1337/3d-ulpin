import assert from 'node:assert/strict';
import test from 'node:test';
import { CoreNumberValueSchema, CoreIdSchema } from '../packages/contracts/src/spatial/core/scalars';
import {
  parseUsp, UspScopeSchema, UspSnapshotScopeSchema, UspAssetRefSchema,
  UspMutationGuardSchema, UspPinnedUpdateGuardSchema, UspProposalSelectionSchema,
  UspResolveTargetRequestSchema, UspReadScopeRequestSchema, UspReadEvidenceRequestSchema,
  UspEvidencePointerSchema, UspLocatorSchema, UspTargetPinSchema,
  uspServiceResultSchema, uspSuccessEnvelopeSchema, UspErrorEnvelopeSchema,
  encodeUspRef, decodeUspRef, DataManifestIdSchema, SceneManifestIdSchema,
  type DataManifestId, type SceneManifestId,
} from '../packages/contracts/src/usp/index';
import { uspFixtures as f, uspSerializedFixtures } from './fixtures/usp-common';

function rejects(schema: Parameters<typeof parseUsp>[0], value: unknown) { assert.throws(() => parseUsp(schema, value)); }
const wire = (text: string) => Buffer.from(text).toString('base64url');

for (const name of ['intake', 'scope'] as const) {
  test(`producer/consumer wire round-trip: ${name}`, () => {
    const producer = parseUsp(UspScopeSchema, JSON.parse(uspSerializedFixtures[name]));
    const consumer = parseUsp(UspScopeSchema, JSON.parse(JSON.stringify(producer)));
    assert.deepEqual(consumer, producer);
  });
}
test('unassigned intake requires no invented world or spatial digest', () => {
  assert.deepEqual(parseUsp(UspScopeSchema, f.intake), f.intake);
  rejects(UspSnapshotScopeSchema, f.intake);
  rejects(UspScopeSchema, { ...f.intake, world: f.scope.world });
});
test('snapshot rejects omitted digest, invalid world and forged access fields', () => {
  const { snapshotDigest: _digest, ...missing } = f.scope;
  rejects(UspScopeSchema, missing);
  rejects(UspScopeSchema, { ...f.scope, world: { namespace: 'space', id: 'synthetic' } });
  rejects(UspScopeSchema, { ...f.scope, role: 'admin' });
});
test('literal identifiers and legitimate core draft revision zero are preserved', () => {
  assert.equal(parseUsp(UspTargetPinSchema, f.pin).ref.id, '000127/U-A101');
  assert.equal(parseUsp(UspTargetPinSchema, f.pin).revision, 0);
  rejects(UspTargetPinSchema, { ...f.pin, ref: { namespace: 'space', id: 127 } });
});
test('new resources cannot smuggle update versions; updates require real positive versions', () => {
  assert.deepEqual(parseUsp(UspMutationGuardSchema, f.create), f.create);
  rejects(UspMutationGuardSchema, { ...f.create, expectedVersion: 0 });
  for (const value of [0, -1, 1.1, '1', Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    rejects(UspMutationGuardSchema, { ...f.update, expectedVersion: value });
  }
  const { expectedManifestId: _manifest, ...unPinned } = f.update;
  assert.deepEqual(parseUsp(UspMutationGuardSchema, unPinned), unPinned);
  rejects(UspPinnedUpdateGuardSchema, unPinned);
});
test('snapshot and render IDs are nominally different without rewriting existing IDs', () => {
  const data: DataManifestId = parseUsp(DataManifestIdSchema, 'manifest-001');
  const scene: SceneManifestId = parseUsp(SceneManifestIdSchema, 'manifest-002');
  // @ts-expect-error Scene manifest IDs cannot be used as data manifest IDs.
  const forbidden: DataManifestId = scene;
  void forbidden;
  assert.equal(data, 'manifest-001');
});
test('asset refs reject omitted hashes, raw storage URLs and nonpositive versions', () => {
  const asset = { assetId: 'asset-1', version: 1, sha256: 'b'.repeat(64) };
  assert.deepEqual(parseUsp(UspAssetRefSchema, asset), asset);
  rejects(UspAssetRefSchema, { ...asset, storageUrl: 'https://example.invalid/private' });
  rejects(UspAssetRefSchema, { ...asset, sha256: null });
  rejects(UspAssetRefSchema, { ...asset, version: 0 });
});
test('proposal selection is exactly one single target or one nonempty bounded list', () => {
  assert.deepEqual(parseUsp(UspProposalSelectionSchema, { target: f.pin }), { target: f.pin });
  rejects(UspProposalSelectionSchema, {});
  rejects(UspProposalSelectionSchema, { target: null });
  rejects(UspProposalSelectionSchema, { target: f.pin, targets: [f.pin] });
  rejects(UspProposalSelectionSchema, { targets: [] });
  rejects(UspProposalSelectionSchema, { targets: [f.pin, { ...f.pin, revision: 1 }] });
  rejects(UspProposalSelectionSchema, { targets: Array.from({ length: 101 }, (_, i) => ({ ...f.pin, ref: { namespace: 'space', id: `unit-${i}` } })) });
  assert.ok(parseUsp(UspProposalSelectionSchema, { targets: [f.pin, { ...f.pin, ref: { namespace: 'building', id: f.pin.ref.id } }] }));
});
test('read requests reject principal, actor and intake-to-spatial scope broadening', () => {
  const request = { pin: f.pin, scope: f.scope };
  assert.deepEqual(parseUsp(UspResolveTargetRequestSchema, request), request);
  for (const extra of [{ principal: { role: 'admin' } }, { actor: 'admin' }, { accessViewId: 'admin' }]) rejects(UspResolveTargetRequestSchema, { ...request, ...extra });
  rejects(UspResolveTargetRequestSchema, { ...request, scope: f.intake });
});
test('pagination has a nullable explicit cursor and a bounded noncoerced page size', () => {
  const request = { scope: f.scope, cursor: null, limit: 100 };
  assert.deepEqual(parseUsp(UspReadScopeRequestSchema, request), request);
  for (const limit of [0, 101, 1.5, '20']) rejects(UspReadScopeRequestSchema, { ...request, limit });
});
test('unknown quantity is not zero and absent producer is not empty successful data', () => {
  const result = uspServiceResultSchema(CoreNumberValueSchema);
  const unknown = { state: 'available', data: { state: 'unknown', reason: 'No height supplied' } };
  assert.deepEqual(parseUsp(result, unknown), unknown);
  assert.ok(parseUsp(result, { state: 'available', data: { state: 'known', value: 0 } }));
  assert.ok(parseUsp(result, { state: 'not_assessed', reasonCode: 'FIND_UNAVAILABLE' }));
  assert.ok(parseUsp(result, { state: 'pending', jobId: 'job-1' }));
  rejects(result, { state: 'not_assessed', data: [], reasonCode: 'FIND_UNAVAILABLE' });
  rejects(result, { state: 'pending' });
  rejects(result, { state: 'available' });
});
test('HTTP envelope preserves intake and refuses raw error/debug properties', () => {
  const value = { data: 'receipt-1', meta: { schemaVersion: 'usp/1', requestId: 'req-1', scope: f.intake } };
  assert.deepEqual(parseUsp(uspSuccessEnvelopeSchema(CoreIdSchema), value), value);
  const error = { code: 'UNAVAILABLE', message: 'Source unavailable', requestId: 'req-1', retryable: false };
  assert.ok(parseUsp(UspErrorEnvelopeSchema, { error }));
  rejects(UspErrorEnvelopeSchema, { error: { ...error, stack: 'private stack' } });
});
test('evidence references keep exact namespace and version; permission is still a server check', () => {
  assert.deepEqual(parseUsp(UspEvidencePointerSchema, f.evidence), f.evidence);
  assert.ok(parseUsp(UspReadEvidenceRequestSchema, { pointer: f.evidence, scope: f.scope, action: 'extract' }));
  rejects(UspEvidencePointerSchema, { ...f.evidence, sourceRevision: f.pin });
  rejects(UspReadEvidenceRequestSchema, { pointer: f.evidence, scope: f.scope, action: 'release' });
});
for (const locator of [
  { kind: 'rows', range: { start: 2, end: 1 } },
  { kind: 'lines', range: { start: 0, end: 1 } },
  { kind: 'page', page: 0 },
  { kind: 'page', page: 1, region: { x: .9, y: 0, width: .2, height: .2, unit: 'normalized' } },
  { kind: 'image_region', region: { x: 0, y: .9, width: .2, height: .2, unit: 'normalized' } },
  { kind: 'json_pointer', pointer: '/bad~2escape' },
]) test(`reject malformed locator ${JSON.stringify(locator)}`, () => rejects(UspLocatorSchema, locator));
for (const id of ['000127', 'building/A:unit-101', 'id.with_under-score', 'A/B/C']) {
  test(`route reference round-trip ${id}`, () => {
    const ref = { namespace: 'space', id };
    assert.deepEqual(decodeUspRef(encodeUspRef(ref)), ref);
  });
}
for (const value of [
  '', '!', 'a', 'A'.repeat(1400), wire('{"namespace":"space","id":"000127"}') + '=',
  wire('{"id":"000127","namespace":"space"}'),
  wire('{"namespace":"space","id":"first","id":"000127"}'),
  wire('{"namespace":"space","id":"000127","role":"admin"}'),
  wire('{"namespace":"space","id":127}'), wire('[]'), wire(' {"namespace":"space","id":"000127"}'),
  Buffer.from([0xc0, 0x80]).toString('base64url'),
]) test(`reject noncanonical route ref ${value.slice(0, 30)}`, () => assert.throws(() => decodeUspRef(value)));
test('untrusted JSON cannot invoke accessors, carry prototype keys or cycles', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'kind', { enumerable: true, get() { reads++; return 'intake'; } });
  rejects(UspScopeSchema, accessor); assert.equal(reads, 0);
  rejects(UspScopeSchema, JSON.parse('{"__proto__":{},"kind":"intake"}'));
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  rejects(UspScopeSchema, cyclic);
});
