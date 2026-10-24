import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { STREAMING_VECTOR_LIMITS as limits, type StreamingVectorInput } from '@ulpin/contracts/usp';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readStreamingFeatures, sourceRecord, type SourceFeature } from './streaming-vector-reader';
import { resolveStreamedReference, sealedMapReceipt } from './streamed-map-receipt';
import { intakeGeojsonFraming, intakeReaderRoute } from './intake-draft';
import { probeOriginal } from './intake-probe';
import { provePartFeature } from './proved-area-part';
import { isRetainedMapOriginal } from './retained-map-original';
import { measurableCrs } from './intake-package-extent';

// test_only protocol literals: no survey or registry records.
const features = [
  '{ "type": "Feature", "geometry": {"type":"Point","coordinates":[1,2]},'
    + ' "properties": {"name":"test_only café"} }',
  '{"geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]},'
    + '"properties":{"name":"test_only"},"type":"Feature"}',
];
const crs = '"crs":{"type":"name","properties":{"name":"EPSG:2958"}}';

async function read(text: string, framing: StreamingVectorInput['framing'] = 'feature-collection') {
  const bytes = Buffer.from(text);
  const items: SourceFeature[] = [];
  // Split inside tokens and UTF-8 as well as between members.
  const chunks = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, index) =>
    bytes.subarray(index * 7, (index + 1) * 7));
  const closure = await readStreamingFeatures(Readable.from(chunks), framing, async item => {
    items.push(item);
  });
  return { bytes, items, closure };
}

test('features before type and crs retain the same literal features and exact source ranges', async () => {
  const usual = await read(`{"type":"FeatureCollection",${crs},"features":[${features.join(',')}]}`);
  const reordered = await read(`{"features":[${features.join(',')}],"type":"FeatureCollection",${crs}}`);
  assert.deepEqual(reordered.closure.metadata, usual.closure.metadata);
  assert.equal(reordered.closure.features, 2);
  assert.deepEqual(reordered.items.map(item => item.feature), usual.items.map(item => item.feature));
  assert.deepEqual(usual.items.map(item => item.collectionTypeBeforeFeatures), [true, true]);
  assert.deepEqual(reordered.items.map(item => item.collectionTypeBeforeFeatures), [false, false]);
  for (const result of [usual, reordered]) {
    assert.equal(result.closure.bytes, result.bytes.length);
    assert.equal(result.closure.sha256, createHash('sha256').update(result.bytes).digest('hex'));
    for (const [index, item] of result.items.entries()) {
      const literal = Buffer.from(features[index]);
      assert.deepEqual(item.raw, literal);
      assert.deepEqual(result.bytes.subarray(item.start, item.end), literal);
      assert.equal(item.start, result.bytes.indexOf(literal));
      assert.equal(item.end, item.start + literal.length);
      assert.equal(sourceRecord(item).disposition, 'accepted');
    }
  }
});

test('each read recomputes whether root type preceded features, regardless of earlier metadata', async () => {
  const prefix = `"name":"test_only",${crs},`;
  for (const before of [true, false, true, false]) {
    const members = before
      ? `${prefix}"type":"FeatureCollection","features":[${features.join(',')}]`
      : `${prefix}"features":[${features.join(',')}],"type":"FeatureCollection"`;
    const result = await read(`{${members}}`);
    assert.deepEqual(result.items.map(item => item.collectionTypeBeforeFeatures), [before, before]);
  }
});

test('a crs after features reaches the existing resolver instead of becoming assumed longitude/latitude', async () => {
  const result = await read(`{"features":[${features[0]}],"type":"FeatureCollection",${crs}}`);
  let seen: unknown;
  const reference = await resolveStreamedReference(result.closure.metadata, async collection => {
    seen = collection;
    return { declared: 'EPSG:2958', authority: 'EPSG', unit: 'metre' };
  });
  assert.deepEqual(seen, { crs: { type: 'name', properties: { name: 'EPSG:2958' } } });
  assert.equal(reference.sourceCrs, 'EPSG:2958');
  assert.equal(reference.coordinateUnit, 'metre');
});

const original = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson');
const realFeatures: unknown[] = JSON.parse(original.toString()).features;
const realLines = realFeatures.map(value => JSON.stringify(value));

for (const [format, framing, ending, text] of [
  ['ndjson', 'geojson-lines', 'LF', realLines.join('\n') + '\n'],
  ['geojson-seq', 'geojson-seq-rs', 'LF', realLines.map(line => '\x1e' + line + '\n').join('')],
  ['ndjson', 'geojson-lines', 'CRLF', realLines.join('\r\n') + '\r\n'],
] as const) {
  test(`91 test_only Open Buildings polygons probe, route, read, seal and prove as ${format} ${ending}`, async () => {
    const bytes = Buffer.from(text), hash = createHash('sha256').update(bytes).digest('hex');
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'wrong.bin');
    assert.equal(card.format, format);
    assert.equal(card.family, 'vector');
    assert.equal(intakeReaderRoute(card, { bytes: bytes.length, inspection: null }), 'streamed_geojson');
    assert.equal(intakeGeojsonFraming(card), framing);
    const result = await read(text, framing);
    assert.equal(result.closure.features, 91);
    assert.deepEqual(result.items.map(item => item.feature), realFeatures);
    assert.deepEqual({ ...result.closure.metadata }, {});
    assert.equal(result.closure.sha256, hash);
    for (const item of result.items) {
      assert.equal(sourceRecord(item).disposition, 'accepted');
      assert.deepEqual(bytes.subarray(item.start, item.end), item.raw);
      const proved = await provePartFeature(sourceRecord(item), item.raw, bytes.length);
      assert.deepEqual(proved.feature, item.feature);
    }
    const receipt = sealedMapReceipt({ version: limits.version, sourceBytes: bytes.length, sourceSha256: hash,
      sourceId: '22222222-2222-4222-8222-222222222222', sourceRevision: 1,
      jobId: '11111111-1111-4111-8111-111111111111', framing } as StreamingVectorInput, result.closure,
    [{ chunk_index: 0, first_feature_index: 0, last_feature_index: 90, records: 91,
      accepted: 91, quarantined: 0, published: true, result_sha256: hash }]);
    assert.equal(receipt.reference.sourceCrs, 'EPSG:4326');
    assert.match(receipt.reference.evidence, /sequence states no coordinate system/);
    assert.match(receipt.reference.evidence, /read as RFC 7946 longitude and latitude/);
    assert.deepEqual(receipt.collectionMetadata, {});
    assert.deepEqual(measurableCrs(receipt.collectionMetadata), { kind: 'degree' });
    assert(isRetainedMapOriginal({ id: receipt.sourceId, revision: 1, bytes: bytes.length, sha256: hash,
      profile: 'large-original-v1', inspection: { streamedMapReceipt: receipt,
        largeOriginal: { verifiedSha256: hash, verifiedBytes: bytes.length } } }));
    assert.deepEqual(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson'), original);
  });
}

test('difficult NDJSON sets aside only its bare geometry and broken JSON, naming physical lines', async () => {
  const geometry = JSON.stringify((realFeatures[0] as { geometry: unknown }).geometry);
  const result = await read([realLines[0], geometry, '{broken', ...realLines.slice(1)].join('\n') + '\n',
    'geojson-lines');
  const records = result.items.map(sourceRecord), rejected = records.filter(r => r.disposition === 'quarantined');
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].issueCode!, /Line 2 is not a GeoJSON Feature/);
  assert.match(rejected[1].issueCode!, /Line 3 is not valid JSON/);
  assert.deepEqual(records.filter(r => r.disposition === 'accepted').map(r => r.feature), realFeatures);
});

test('sequence delimiters recover invalid JSON and every non-Feature without guessing collection members', async () => {
  const invalid = ['{"type":"FeatureCollection","features":[]}', 'null', '42', '[]', '"text"', '{broken',
    '{"type":"FeatureCollection","type":"Point"}', '{"type":"Point","coordinates":[9007199254740993,0]}'];
  for (const framing of ['geojson-lines', 'geojson-seq-rs'] as const) {
    const units = [...invalid, realLines[0]];
    const text = units.map(unit => (framing === 'geojson-lines' ? '' : '\x1e') + unit + '\n').join('');
    const result = await read(text, framing), records = result.items.map(sourceRecord);
    assert.equal(records.filter(record => record.disposition === 'quarantined').length, invalid.length);
    assert.equal(records.at(-1)!.disposition, 'accepted');
    invalid.forEach((_, index) => assert.match(records[index].issueCode!,
      new RegExp(`${framing === 'geojson-lines' ? 'Line' : 'Record'} ${index + 1} is not`)));
    assert.deepEqual({ ...result.closure.metadata }, {});
  }
});

test('blank LF and CRLF lines are counted and skipped without changing record indices or source coverage', async () => {
  const text = '\n \t\r\n' + realLines[0] + '\r\n\r\n' + realLines[1] + '\n';
  const result = await read(text, 'geojson-lines');
  assert.equal(result.closure.blankLines, 3);
  assert.deepEqual(result.items.map(item => item.index), [0, 1]);
  assert.deepEqual(result.items.map(item => item.sourcePosition), ['Line 3', 'Line 5']);
  assert.deepEqual(result.items.map(item => item.feature), realFeatures.slice(0, 2));
  assert.equal(result.closure.bytes, Buffer.byteLength(text));
});

test('sequences retain the shared value bound and require their declared delimiters and final LF', async () => {
  for (const framing of ['geojson-lines', 'geojson-seq-rs'] as const) {
    const prefix = framing === 'geojson-lines' ? '' : '\x1e';
    await assert.rejects(read(prefix + 'x'.repeat(limits.featureBytes + 1) + '\n', framing),
      { code: 'GEOJSON_UNIT_BUDGET' });
    await assert.rejects(read(prefix + realLines[0], framing), { code: 'GEOJSON_SEQUENCE' });
  }
  await assert.rejects(read(realLines[0] + '\n', 'geojson-seq-rs'), { code: 'GEOJSON_CONTAINER' });
  const pretty = await read('\x1e' + JSON.stringify(realFeatures[0], null, 2) + '\n', 'geojson-seq-rs');
  assert.deepEqual(pretty.items[0].feature, realFeatures[0]);
  const spaced = await read('\x1e' + realLines[0] + '\n \t\r\x1e' + realLines[1] + '\n \t', 'geojson-seq-rs');
  assert.deepEqual(spaced.items.map(item => item.feature), realFeatures.slice(0, 2));
});

test('a closed root without FeatureCollection type refuses after staging its literal features', async () => {
  for (const suffix of ['', ',"type":"Feature"', ',"type":null']) {
    await assert.rejects(read(`{"features":[${features.join(',')}]${suffix}}`), {
      code: 'GEOJSON_COLLECTION_TYPE',
      message: 'The root type must be FeatureCollection; nothing from this collection was published.',
    });
  }
});
