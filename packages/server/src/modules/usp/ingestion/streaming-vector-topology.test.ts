import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { STREAMING_VECTOR_LIMITS as limits, type AnyStreamingInput,
  type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { validateStreamingTopology } from './streaming-vector-validation';
import { encodeChunk, StreamingPartWriter, StreamingTopologyWriter } from './streaming-vector-worker';

const input = { jobId: '32000000-0000-4000-8000-000000000001',
  sourceId: '32000000-0000-4000-8000-000000000002', sourceRevision: 1,
  sourceSha256: 'a'.repeat(64) } as AnyStreamingInput;
// test_only SQL protocol answers, not GEOS qualification or surveyed geometry.
const valid = { dimension: 2, valid: true, empty: false, area: 1, length: 0, reason: 'Valid Geometry' };
const answers = [valid, { ...valid, valid: false, reason: 'Self-intersection' },
  { ...valid, empty: true }, { ...valid, area: 0 }, { ...valid, dimension: 1, length: 0 },
  { ...valid, dimension: 1, length: 1 }, { ...valid, dimension: 0 }];

function database(failure?: string, scalarFailure?: string) {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const prior = globals.ulpinPool;
  const statements: string[] = [];
  let batches = 0;
  const row = (geometry: { coordinates: number[] }) => answers[geometry.coordinates[0]] ?? valid;
  globals.ulpinPool = { connect: async () => ({ release() {}, query: async (sql: string, values: string[] = []) => {
    statements.push(sql);
    if (sql.includes('jsonb_array_elements')) {
      batches++;
      if (failure) throw Object.assign(new Error('protocol fault'), { code: failure });
      assert.match(sql, /WITH ORDINALITY/);
      assert.match(sql, /ORDER BY ordinal/);
      return { rows: JSON.parse(values[0]).map(row) };
    }
    if (sql.startsWith('SELECT ST_IsValid')) {
      if (scalarFailure) throw Object.assign(new Error('scalar protocol fault'), { code: scalarFailure });
      return { rows: [row(JSON.parse(values[0]))] };
    }
    return { rows: [] };
  } }) };
  return { statements, batches: () => batches, restore() {
    if (prior === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = prior;
  } };
}

function record(index: number): StreamingVectorRecord {
  return { featureIndex: index, byteStart: index * 100, byteEnd: index * 100 + 99,
    rawSha256: 'a'.repeat(64), disposition: 'accepted', issueCode: null,
    feature: { type: 'Feature', geometry: { type: 'Point', coordinates: [index, 0] }, properties: null } };
}

async function scalar(record: StreamingVectorRecord) {
  if (record.disposition !== 'accepted') return;
  const issue = await validateStreamingTopology((record.feature as { geometry: unknown }).geometry);
  if (issue) { record.disposition = 'quarantined'; record.issueCode = issue; record.feature = null; }
}

test('batched topology returns the scalar dispositions and chunk hashes with four SQL calls per batch', async () => {
  const db = database();
  try {
    const before = Array.from({ length: limits.chunkFeatures * 2 + 7 }, (_, index) => record(index));
    const after = structuredClone(before);
    for (const item of before) await scalar(item);
    assert.equal(db.statements.length, before.length * 4);
    db.statements.length = 0;
    const written: StreamingVectorRecord[] = [];
    const writer = new StreamingTopologyWriter(async item => { written.push(item); });
    for (const item of after) await writer.add(item);
    assert.equal(written.length, limits.chunkFeatures * 2, 'complete batches emit before EOF');
    await writer.flush();
    assert.deepEqual(written, before);
    assert.equal(db.batches(), 3);
    assert.equal(db.statements.length, 12);
    assert.equal(encodeChunk(input, 0, written.slice(0, limits.chunkFeatures)).hash,
      encodeChunk(input, 0, before.slice(0, limits.chunkFeatures)).hash);
    assert.deepEqual(written.slice(0, 7).map(item => item.issueCode),
      [null, 'SELF_INTERSECTION', 'INVALID_GEOMETRY', 'INVALID_GEOMETRY', 'INVALID_GEOMETRY', null, null]);
  } finally { db.restore(); }
});

test('a bad batch or shared timeout keeps neighbouring answers through scalar fallback', async () => {
  for (const code of ['22P02', 'XX000', '57014']) {
    const db = database(code);
    try {
      const actual: StreamingVectorRecord[] = [];
      const writer = new StreamingTopologyWriter(async item => { actual.push(item); });
      const expected = [record(0), record(1), record(2)];
      for (const item of expected) await scalar(item);
      for (const index of [0, 1, 2]) await writer.add(record(index));
      await writer.flush();
      assert.deepEqual(actual, expected);
      assert.equal(db.batches(), 1);
      assert.equal(db.statements.filter(sql => sql === 'ROLLBACK').length, 1);
    } finally { db.restore(); }
  }
});

test('a scalar timeout after batch fallback still retries instead of quarantining the feature', async () => {
  const db = database('57014', '57014');
  try {
    const written: StreamingVectorRecord[] = [];
    const writer = new StreamingTopologyWriter(async item => { written.push(item); });
    const item = record(0);
    await writer.add(item);
    await assert.rejects(writer.flush(), { code: '57014' });
    assert.equal(item.disposition, 'accepted');
    assert.equal(written.length, 0);
    assert.equal(db.statements.filter(sql => sql === 'ROLLBACK').length, 2);
  } finally { db.restore(); }
});

test('connectivity failures are retried by the authority, never reclassified as bad geometry', async () => {
  const db = database('08006');
  try {
    const written: StreamingVectorRecord[] = [];
    const writer = new StreamingTopologyWriter(async item => { written.push(item); });
    await writer.add(record(0));
    await assert.rejects(writer.flush(), { code: '08006' });
    assert.equal(written.length, 0);
    assert.equal(db.batches(), 1);
    assert.equal(db.statements.filter(sql => sql.startsWith('SELECT ST_IsValid')).length, 1);
  } finally { db.restore(); }
});

test('byte-bounded batches and already quarantined features keep the existing part writer boundaries', async () => {
  const db = database();
  try {
    const records = [record(0), record(1), record(2), record(3)];
    for (const item of records) (item.feature as { properties: unknown }).properties = {
      test_only: 'x'.repeat(limits.chunkBytes / 2),
    };
    records.push({ ...record(4), disposition: 'quarantined', issueCode: 'INVALID_FEATURE', feature: null });
    const chunks = async (batch: boolean) => {
      const hashes: string[] = [];
      const parts = new StreamingPartWriter(async (index, items) => {
        hashes.push(encodeChunk(input, index, items).hash);
      });
      const topology = new StreamingTopologyWriter(async item => parts.add(item, limits.chunkFeatures));
      for (const item of structuredClone(records)) {
        if (batch) await topology.add(item);
        else { await scalar(item); await parts.add(item, limits.chunkFeatures); }
      }
      if (batch) await topology.flush();
      await parts.flush();
      return hashes;
    };
    assert.deepEqual(await chunks(true), await chunks(false));
    assert.equal(db.batches(), 4, 'byte limit seals batches before their record limit');
  } finally { db.restore(); }
});

test('the first checked part is sealed before the remaining source bytes are available', async () => {
  const db = database(), body = new Readable({ read() {} });
  const feature = JSON.stringify(record(0).feature);
  body.push(Buffer.from('{"type":"FeatureCollection","features":['
    + Array(limits.chunkFeatures).fill(feature).join(',') + ','));
  let stored = 0;
  const parts = new StreamingPartWriter(async () => {
    stored++;
    if (stored === 1) {
      assert.equal(body.readableEnded, false);
      body.push(Buffer.from(feature + ']}')); body.push(null);
    }
  });
  const topology = new StreamingTopologyWriter(async item => parts.add(item, limits.chunkFeatures));
  try {
    const closure = await readStreamingFeatures(body, 'feature-collection', async item => {
      await topology.add(sourceRecord(item));
      if (item.index === limits.chunkFeatures - 1) assert.equal(stored, 1);
    });
    await topology.flush(); await parts.flush();
    assert.equal(closure.features, limits.chunkFeatures + 1);
    assert.equal(stored, 2);
  } finally { body.destroy(); db.restore(); }
});

test('already quarantined records require no topology SQL', async () => {
  const db = database();
  try {
    const item = { ...record(0), disposition: 'quarantined' as const, issueCode: 'OPEN_RING', feature: null };
    const written: StreamingVectorRecord[] = [];
    const topology = new StreamingTopologyWriter(async record => { written.push(record); });
    await topology.add(item); await topology.flush();
    assert.deepEqual(written, [item]);
    assert.equal(db.statements.length, 0);
  } finally { db.restore(); }
});

test('existing real streaming fixture and difficult lines keep records, locators and every chunk hash', async () => {
  const original = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson');
  const features = JSON.parse(original.toString()).features as unknown[];
  const lines = [JSON.stringify(features[0]), '{broken', 'null',
    ...features.slice(1).map(feature => JSON.stringify(feature))];
  const db = database();
  try {
    for (const [framing, bytes] of [
      ['feature-collection', original], ['geojson-lines', Buffer.from(lines.join('\n') + '\n')],
      ['geojson-seq-rs', Buffer.from(lines.map(line => '\x1e' + line + '\n').join(''))],
    ] as const) {
      const run = async (batch: boolean) => {
        const records: StreamingVectorRecord[] = [], hashes: string[] = [];
        const parts = new StreamingPartWriter(async (index, items) => {
          records.push(...items); hashes.push(encodeChunk(input, index, items).hash);
        });
        const topology = new StreamingTopologyWriter(async item => parts.add(item, limits.chunkFeatures));
        const closure = await readStreamingFeatures(Readable.from([bytes]), framing, async item => {
          const source = sourceRecord(item);
          if (batch) await topology.add(source);
          else { await scalar(source); await parts.add(source, limits.chunkFeatures); }
        });
        await topology.flush(); await parts.flush();
        return { closure, records, hashes };
      };
      assert.deepEqual(await run(true), await run(false));
    }
    assert.deepEqual(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson'), original);
  } finally { db.restore(); }
});
