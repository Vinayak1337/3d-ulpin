import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { provePartFeature, provedPartOperationKey, type ProvedAreaPartInput } from './proved-area-part';

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
