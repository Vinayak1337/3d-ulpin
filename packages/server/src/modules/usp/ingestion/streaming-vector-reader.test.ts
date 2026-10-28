import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { STREAMING_VECTOR_LIMITS as limits, StreamingVectorRecordSchema,
  type StreamingVectorInput } from '@ulpin/contracts/usp';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readStreamingFeatures, sourceRecord, type SourceFeature } from './streaming-vector-reader';
import { resolveStreamedReference, sealedMapReceipt } from './streamed-map-receipt';
import { intakeReaderRoute } from './intake-draft';
import { intakeGeojsonFraming } from './geojson-framing';
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

async function read(text: string, framing: StreamingVectorInput['framing'] = 'feature-collection',
  featureLimit = limits.features) {
  const bytes = Buffer.from(text);
  const items: SourceFeature[] = [];
  // Split inside tokens and UTF-8 as well as between members.
  const chunks = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, index) =>
    bytes.subarray(index * 7, (index + 1) * 7));
  const closure = await readStreamingFeatures(Readable.from(chunks), framing, async item => {
    items.push(item);
  }, featureLimit);
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
      assert.equal(Object.hasOwn(sourceRecord(item), 'sequencePosition'), false);
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
      assert.deepEqual(sourceRecord(item).sequencePosition,
        { kind: framing === 'geojson-lines' ? 'line' : 'record', number: item.index + 1 });
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

test('difficult NDJSON sets aside only its bare geometry and broken JSON, retaining physical positions', async () => {
  const geometry = JSON.stringify((realFeatures[0] as { geometry: unknown }).geometry);
  const result = await read([realLines[0], geometry, '{broken', ...realLines.slice(1)].join('\n') + '\n',
    'geojson-lines');
  const records = result.items.map(sourceRecord), rejected = records.filter(r => r.disposition === 'quarantined');
  assert.equal(rejected.length, 2);
  assert.equal(rejected[0].issueCode, 'INVALID_FEATURE');
  assert.deepEqual(rejected[0].sequencePosition, { kind: 'line', number: 2 });
  assert.equal(rejected[1].issueCode, 'GEOJSON_JSON');
  assert.deepEqual(rejected[1].sequencePosition, { kind: 'line', number: 3 });
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
    invalid.forEach((_, index) => {
      assert.equal(records[index].issueCode, index === 5 ? 'GEOJSON_JSON' : 'INVALID_FEATURE');
      assert.deepEqual(records[index].sequencePosition,
        { kind: framing === 'geojson-lines' ? 'line' : 'record', number: index + 1 });
    });
    assert.deepEqual({ ...result.closure.metadata }, {});
  }
});

test('line 5 keeps a stable JSON code and a validated position; collection quarantine has no sequence position',
  async () => {
    const text = [...realLines.slice(0, 4), '{broken', ...realLines.slice(4)].join('\n') + '\n';
    const result = await read(text, 'geojson-lines'), rejected = sourceRecord(result.items[4]);
    assert.equal(rejected.issueCode, 'GEOJSON_JSON');
    assert.deepEqual(rejected.sequencePosition, { kind: 'line', number: 5 });
    assert.deepEqual(StreamingVectorRecordSchema.parse(rejected), rejected);
    for (const position of [{ kind: 'line', number: 0 }, { kind: 'record', number: 1.5 },
      { kind: 'byte', number: 5 }])
      assert.equal(StreamingVectorRecordSchema.safeParse({ ...rejected, sequencePosition: position }).success, false);
    const collection = await read('{"type":"FeatureCollection","features":[null]}');
    const record = sourceRecord(collection.items[0]);
    assert.equal(record.issueCode, 'INVALID_FEATURE');
    assert.equal(Object.hasOwn(record, 'sequencePosition'), false);
  });

test('blank LF and CRLF lines are counted and skipped without changing record indices or source coverage', async () => {
  const text = '\n \t\r\n' + realLines[0] + '\r\n\r\n' + realLines[1] + '\n';
  const result = await read(text, 'geojson-lines');
  assert.equal(result.closure.blankLines, 3);
  assert.deepEqual(result.items.map(item => item.index), [0, 1]);
  assert.deepEqual(result.items.map(sourceRecord).map(record => record.sequencePosition),
    [{ kind: 'line', number: 3 }, { kind: 'line', number: 5 }]);
  assert.deepEqual(result.items.map(item => item.feature), realFeatures.slice(0, 2));
  assert.equal(result.closure.bytes, Buffer.byteLength(text));
});

test('line ceiling seals five of eleven nonblank lines with the whole original hash and byte count', async () => {
  const lines = [...realLines.slice(0, 2), ' \t', ...realLines.slice(2, 11)];
  const text = lines.join('\r\n') + '\r\n';
  const result = await read(text, 'geojson-lines', 5);
  assert.equal(result.closure.features, 5);
  assert.equal(result.closure.linesBeyondLimit, 6);
  assert.equal(result.closure.blankLines, 1);
  assert.equal(result.closure.bytes, result.bytes.length);
  assert.equal(result.closure.sha256, createHash('sha256').update(result.bytes).digest('hex'));
  assert.deepEqual(result.items.map(item => item.feature), realFeatures.slice(0, 5));
  assert.deepEqual(result.items.map(item => item.sequencePosition?.number), [1, 2, 4, 5, 6]);
});

test('unread tail is counted without JSON, UTF-8, per-value byte or final-LF validation', async () => {
  const prefix = Buffer.from(realLines[0] + '\n');
  const tail = Buffer.alloc(limits.featureBytes + 1, 255);
  const bytes = Buffer.concat([prefix, tail, Buffer.from('\n \t\r\n{broken')]);
  let seen = 0;
  const result = await readStreamingFeatures(Readable.from([prefix, tail, bytes.subarray(prefix.length + tail.length)]),
    'geojson-lines', async () => { seen++; }, 1);
  assert.equal(seen, 1);
  assert.equal(result.linesBeyondLimit, 2);
  assert.equal(result.blankLines, 1);
  assert.equal(result.bytes, bytes.length);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('tail progress is awaited inside one large chunk without parsing or allocating its unread records', async () => {
  const prefix = Buffer.from(realLines[0] + '\n');
  const bytes = Buffer.concat([prefix, Buffer.alloc(3 * 64 * 1024 + 1, 255), Buffer.from('\n \t\r\n{broken')]);
  let seen = 0;
  let pulses = 0;
  const result = await readStreamingFeatures(Readable.from([bytes]), 'geojson-lines', async () => { seen++; },
    1, async () => {
      assert.equal(seen, 1);
      await Promise.resolve();
      pulses++;
    });
  assert.equal(seen, 1);
  assert.equal(pulses, 4, 'a buffered tail yields at most every 64 KiB, not only between source chunks');
  assert.equal(result.linesBeyondLimit, 2);
  assert.equal(result.blankLines, 1);
  assert.equal(result.bytes, bytes.length);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('a refused tail pulse is propagated unchanged before another buffered scan', async () => {
  const stale = new Error('This worker lease expired or was fenced.');
  const prefix = Buffer.from(realLines[0] + '\n');
  let pulses = 0;
  const body = Readable.from([Buffer.concat([prefix, Buffer.alloc(3 * 64 * 1024, 255)])]);
  try {
    await assert.rejects(readStreamingFeatures(body, 'geojson-lines', async () => {}, 1, async () => {
      if (++pulses === 2) throw stale;
    }), error => error === stale);
    assert.equal(pulses, 2);
  } finally { body.destroy(); }
});

test('a line file at the exact ceiling keeps complete-read counts even with trailing blank lines', async () => {
  const result = await read(realLines.slice(0, 5).join('\n') + '\n\n \t\r\n', 'geojson-lines', 5);
  assert.equal(result.closure.features, 5);
  assert.equal(result.closure.linesBeyondLimit, 0);
  assert.equal(result.closure.blankLines, 2);
  assert.equal(result.closure.bytes, result.bytes.length);
});

test('FeatureCollection and record-separator sequences still fail above an injected feature ceiling', async () => {
  const lines = realLines.slice(0, 6);
  await assert.rejects(read(`{"type":"FeatureCollection","features":[${lines.join(',')}]}`,
    'feature-collection', 5), { code: 'STREAMING_FEATURE_BUDGET' });
  await assert.rejects(read(lines.map(line => '\x1e' + line + '\n').join(''), 'geojson-seq-rs', 5),
    { code: 'STREAMING_FEATURE_BUDGET' });
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
