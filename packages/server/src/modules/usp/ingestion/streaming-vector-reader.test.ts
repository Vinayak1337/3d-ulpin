import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readStreamingFeatures, sourceRecord, type SourceFeature } from './streaming-vector-reader';
import { resolveStreamedReference } from './streamed-map-receipt';

// test_only protocol literals: no survey or registry records.
const features = [
  '{ "type": "Feature", "geometry": {"type":"Point","coordinates":[1,2]},'
    + ' "properties": {"name":"test_only café"} }',
  '{"geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]},'
    + '"properties":{"name":"test_only"},"type":"Feature"}',
];
const crs = '"crs":{"type":"name","properties":{"name":"EPSG:2958"}}';

async function read(text: string) {
  const bytes = Buffer.from(text);
  const items: SourceFeature[] = [];
  // Split inside tokens and UTF-8 as well as between members.
  const chunks = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, index) =>
    bytes.subarray(index * 7, (index + 1) * 7));
  const closure = await readStreamingFeatures(Readable.from(chunks), 'feature-collection', async item => {
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

test('a closed root without FeatureCollection type refuses after staging its literal features', async () => {
  for (const suffix of ['', ',"type":"Feature"', ',"type":null']) {
    await assert.rejects(read(`{"features":[${features.join(',')}]${suffix}}`), {
      code: 'GEOJSON_COLLECTION_TYPE',
      message: 'The root type must be FeatureCollection; nothing from this collection was published.',
    });
  }
});
