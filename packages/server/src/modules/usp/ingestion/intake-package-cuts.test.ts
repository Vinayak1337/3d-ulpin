import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { cutMappedFeatures, INTAKE_PACKAGE_LIMITS, IntakePackageCutter, normalizerInputUpperBound,
  type MappedPartFeature } from './intake-package-cuts';

/** Protocol-only feature; never persisted, displayed or treated as an operational record. */
function protocolItem(index: number, positions = 5, rawBytes = 100): MappedPartFeature {
  const feature = { type: 'Feature', properties: { key: `protocol-${index}` },
    geometry: { type: 'Polygon', coordinates: [Array.from({ length: positions }, () => [1, 2])] } };
  const raw = { featureIndex: index, byteStart: index * rawBytes, byteEnd: (index + 1) * rawBytes,
    rawSha256: 'a'.repeat(64), disposition: 'accepted' as const, issueCode: null, feature };
  const mapped = { ...raw, disposition: 'observed' as const,
    sourceKey: { state: 'known' as const, value: `protocol-${index}`, sourcePath: '/features/*/properties/key' },
    name: { state: 'unknown' as const, value: null, sourcePath: null }, issueCodes: [], geometryRef: {
      rawJobId: '11111111-1111-4111-8111-111111111111', chunkIndex: 0, featureIndex: index,
      rawSha256: raw.rawSha256, sourcePath: '/features/*/geometry' as const,
    } };
  return { raw, mapped, feature };
}

test('cuts close at feature, raw-byte, vertex and serialized-input bounds with no empty package', () => {
  assert.deepEqual(cutMappedFeatures([]), { cuts: [], held: [] });
  const count = cutMappedFeatures(Array.from({ length: 2001 }, (_, index) => protocolItem(index)));
  assert.deepEqual(count.cuts.map(cut => cut.cost.features), [2000, 1]);
  const bytes = cutMappedFeatures(Array.from({ length: 17 }, (_, index) => protocolItem(index, 5, 1024 * 1024)));
  assert.deepEqual(bytes.cuts.map(cut => cut.cost.features), [16, 1]);
  const vertices = cutMappedFeatures(Array.from({ length: 11 }, (_, index) => protocolItem(index, 10000)));
  assert.deepEqual(vertices.cuts.map(cut => cut.cost.features), [10, 1]);
  const unicode = Array.from({ length: 5 }, (_, index) => protocolItem(index));
  for (const item of unicode) item.feature.properties = { text: 'अ'.repeat(900000) };
  const serialized = cutMappedFeatures(unicode);
  assert.deepEqual(serialized.cuts.map(cut => cut.cost.features), [3, 2]);
  assert(serialized.cuts.every(cut => cut.cost.serializedInput <= INTAKE_PACKAGE_LIMITS.serializedInput));
});

test('unadmittable single feature held; unresolved skipped; no simplification; order and pairing refused', () => {
  const held = protocolItem(1, 10001);
  const unknown = protocolItem(2);
  unknown.mapped.disposition = 'unresolved';
  const items = [protocolItem(0), held, unknown, protocolItem(3)];
  const before = JSON.stringify(items);
  const result = cutMappedFeatures(items);
  assert.deepEqual(result.cuts.flatMap(cut => cut.features.map(item => item.raw.featureIndex)), [0, 3]);
  assert.deepEqual(result.held, [{ featureIndex: 1, code: 'PART_FEATURE_VERTEX_BOUND' }]);
  assert.equal(JSON.stringify(items), before);
  assert.throws(() => cutMappedFeatures([protocolItem(1), protocolItem(0)]));
  const wrong = protocolItem(0);
  wrong.mapped.rawSha256 = 'b'.repeat(64);
  assert.throws(() => cutMappedFeatures([wrong]));
});

test('a fold resumed after any stored cut closes the same cuts as one fold from the start', () => {
  const positions = (index: number) => {
    if (index % 7 === 0) return 10001;
    return index % 5 === 0 ? 400 : 5;
  };
  const items = Array.from({ length: 3000 }, (_, index) => protocolItem(index, positions(index)));
  const whole = cutMappedFeatures(items);
  assert(whole.cuts.length > 2 && whole.held.length > 0);
  const ids = (cuts: { index: number; features: MappedPartFeature[] }[]) =>
    cuts.map(cut => [cut.index, cut.features.map(item => item.raw.featureIndex)]);
  for (const [stored, cut] of whole.cuts.entries()) {
    const last = cut.features.at(-1)!.raw.featureIndex;
    const cutter = new IntakePackageCutter({}, { index: stored + 1, previous: last });
    const resumed = [];
    for (const item of items.filter(item => item.raw.featureIndex > last)) {
      const result = cutter.consume(item);
      if (result.cut) resumed.push(result.cut);
    }
    const tail = cutter.close();
    if (tail) resumed.push(tail);
    assert.deepEqual(ids(resumed), ids(whole.cuts.slice(stored + 1)));
  }
});

test('serialized input bound reserves Python ASCII expansion and number spelling', () => {
  assert.equal(normalizerInputUpperBound({ text: 'अ😀' }), '{"text":"\\u0905\\ud83d\\ude00"}'.length);
  assert(normalizerInputUpperBound({ x: 1e-7 }) > JSON.stringify({ x: 1e-7 }).length);
});

test('real NYC reader preserves global indexes and spans through deterministic cuts', async () => {
  const bytes = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
  const items: MappedPartFeature[] = [];
  await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
    const raw = sourceRecord(item);
    assert.equal(raw.disposition, 'accepted');
    const protocol = protocolItem(item.index);
    const mapped = { ...protocol.mapped, featureIndex: item.index, byteStart: item.start, byteEnd: item.end,
      rawSha256: raw.rawSha256, geometryRef: { ...protocol.mapped.geometryRef!, featureIndex: item.index,
        rawSha256: raw.rawSha256 } };
    items.push({ raw, mapped, feature: item.feature as Record<string, unknown> });
  });
  const first = cutMappedFeatures(items), replay = cutMappedFeatures(items);
  assert.deepEqual(first, replay);
  assert.equal(first.cuts.length, 1);
  assert.equal(first.cuts[0].cost.features, 1662);
  assert.equal(first.cuts[0].features[1322].raw.featureIndex, 1322);
  for (const item of first.cuts[0].features)
    assert.equal(item.raw.byteEnd - item.raw.byteStart, bytes.subarray(item.raw.byteStart, item.raw.byteEnd).length);
  // Pure structural reader does not test polygon topology; index 1322 is quarantined by the normalizer/PostGIS.
});
