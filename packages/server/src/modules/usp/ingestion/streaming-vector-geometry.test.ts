import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { STREAMING_VECTOR_LIMITS as limits, StreamingVectorGeometrySummarySchema,
  type AnyStreamingInput, type StreamingVectorGeometrySummary, type StreamingVectorInput,
  type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { readStreamingFeatures, sourceRecord, validateStreamingFeature } from './streaming-vector-reader';
import { validateStreamingTopology } from './streaming-vector-validation';
import { completeStreamingReadTx, encodeChunk, StreamingPartWriter, tallyAcceptedGeometry,
  writeStreamingGeometrySummaryTx } from './streaming-vector-worker';

// Synthetic test_only unit shapes; not surveyed geometry, publisher records or evaluation truth.
const point = { type: 'Point', coordinates: [0, 0] };
const line = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const feature = (geometry: unknown) => ({ type: 'Feature', properties: null, geometry });
const jobId = '32000000-0000-4000-8000-000000000001';
const input = { jobId, sourceId: '32000000-0000-4000-8000-000000000002', sourceRevision: 1,
  sourceSha256: 'a'.repeat(64) } as AnyStreamingInput;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function read(geometries: unknown[]) {
  const bytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: geometries.map(feature) }));
  const records: StreamingVectorRecord[] = [];
  const counts: StreamingVectorGeometrySummary['counts'] = {};
  const closure = await readStreamingFeatures(Readable.from([bytes.subarray(0, 43), bytes.subarray(43)]),
    'feature-collection', async item => {
      const record = sourceRecord(item);
      records.push(record);
      tallyAcceptedGeometry(counts, record);
    });
  assert.equal(closure.sha256, hash(bytes));
  assert.equal(closure.bytes, bytes.length);
  return { records, counts, closure };
}

test('streamed point and line layers are accepted, with exact accepted feature counts', async () => {
  for (const geometry of [point, line]) {
    const result = await read([geometry, geometry]);
    assert.equal(result.closure.features, 2);
    assert.deepEqual(result.records.map(record => record.disposition), ['accepted', 'accepted']);
    assert.deepEqual(result.counts, { [geometry.type]: 2 });
    assert.deepEqual(result.records[0].feature, feature(geometry));
  }
});

test('one mixed layer counts all six canonical kinds, not multipart members', async () => {
  const result = await read([point, { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }, line,
    { type: 'MultiLineString', coordinates: [line.coordinates, line.coordinates] }, polygon,
    { type: 'MultiPolygon', coordinates: [polygon.coordinates] }]);
  assert.deepEqual(result.counts, {
    Point: 1, MultiPoint: 1, LineString: 1, MultiLineString: 1, Polygon: 1, MultiPolygon: 1,
  });
  assert.equal(result.records.filter(record => record.disposition === 'accepted').length, 6);
  assert.equal(validateStreamingFeature(feature({ type: 'GeometryCollection', geometries: [point] })),
    'UNSUPPORTED_GEOMETRY');
});

test('a polygon record and its encoded chunk keep the pre-extension bytes', async () => {
  const raw = Buffer.from(JSON.stringify(feature(polygon)));
  const record = sourceRecord({ index: 0, start: 40, end: 40 + raw.length, raw,
    feature: feature(polygon), valueIssueCode: null });
  const expected = { featureIndex: 0, byteStart: 40, byteEnd: 40 + raw.length, rawSha256: hash(raw),
    disposition: 'accepted', issueCode: null, feature: feature(polygon) };
  assert.equal(JSON.stringify(record), JSON.stringify(expected));
  const expectedBytes = Buffer.from(JSON.stringify({ version: limits.version, jobId,
    sourceId: input.sourceId, sourceRevision: 1, sourceSha256: input.sourceSha256, chunkIndex: 0,
    records: [expected] }));
  assert.deepEqual(encodeChunk(input, 0, [record]).bytes, expectedBytes);
});

test('coordinate, ring and CRS bounds still refuse unsupported or ambiguous source geometry', () => {
  const issue = (geometry: unknown) => validateStreamingFeature(feature(geometry));
  assert.equal(issue({ type: 'Point', coordinates: [0, 0, 3] }), null);
  assert.equal(issue({ type: 'Point', coordinates: [0, 0, 3, 4] }), 'UNSUPPORTED_COORDINATE_DIMENSION');
  assert.equal(issue({ type: 'LineString', coordinates: [[0, 0], [1, 1, 3]] }), 'MIXED_COORDINATE_DIMENSIONS');
  assert.equal(issue({ type: 'MultiPoint', coordinates: [[0, 0, 3], [1, 1]] }), 'MIXED_COORDINATE_DIMENSIONS');
  assert.equal(issue({ type: 'MultiLineString', coordinates: [line.coordinates, [[0, 0, 3], [1, 1, 4]]] }),
    'MIXED_COORDINATE_DIMENSIONS');
  assert.equal(issue({ ...polygon, coordinates: [[[0, 0, 3], [1, 0, 3], [1, 1, 3], [0, 0, 3]]] }), null);
  assert.equal(issue({ ...polygon, coordinates: [[[0, 0], [1, 0], [1, 1, 3], [0, 0]]] }),
    'MIXED_COORDINATE_DIMENSIONS');
  assert.equal(issue({ ...polygon, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }), 'OPEN_RING');
  assert.equal(issue({ ...point, crs: {} }), 'FEATURE_CRS_OVERRIDE');
  assert.equal(validateStreamingFeature({ ...feature(point), crs: {} }), 'FEATURE_CRS_OVERRIDE');
  assert.equal(issue({ type: 'LineString', coordinates: [[0, 0]] }), 'LINE_BUDGET_OR_SHAPE');
  assert.equal(issue({ type: 'MultiPoint', coordinates: [] }), 'GEOMETRY_BUDGET_OR_SHAPE');
  assert.equal(issue({ type: 'MultiPoint', coordinates: Array(limits.featurePositions + 1).fill([0, 0]) }),
    'GEOMETRY_BUDGET');
  assert.equal(issue({ type: 'LineString', coordinates: [[0, 0], [Infinity, 0]] }), 'INVALID_COORDINATE');
  assert.equal(issue({ ...polygon, coordinates: [Array(2049).fill([0, 0])] }), 'RING_BUDGET_OR_SHAPE');
  assert.equal(issue({ ...polygon, coordinates: Array(129).fill(polygon.coordinates[0]) }),
    'POLYGON_BUDGET_OR_SHAPE');
});

test('topology uses point validity, positive line length and the unchanged positive polygon area rule', async () => {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const previous = globals.ulpinPool;
  let row: Record<string, unknown> = {};
  const sql: string[] = [];
  globals.ulpinPool = { connect: async () => ({ release() {}, query: async (statement: string) => {
    sql.push(statement);
    return { rows: statement.startsWith('SELECT ST_IsValid') ? [row] : [] };
  } }) };
  try {
    for (const [geometry, dimension, area, length, expected] of [
      [point, 0, 0, 0, null], [line, 1, 0, 1, null], [line, 1, 0, 0, 'INVALID_GEOMETRY'],
      [polygon, 2, 1, 0, null], [polygon, 2, 0, 0, 'INVALID_GEOMETRY'],
    ] as const) {
      row = { dimension, area, length, valid: true, empty: false };
      assert.equal(await validateStreamingTopology(geometry), expected);
    }
    row = { dimension: 0, valid: true, empty: true };
    assert.equal(await validateStreamingTopology(point), 'INVALID_GEOMETRY');
    row = { dimension: 2, area: 0, valid: false, empty: false, reason: 'Self-intersection' };
    assert.equal(await validateStreamingTopology(polygon), 'SELF_INTERSECTION');
    assert(sql.some(statement => statement.includes('ST_Length(g)') && statement.includes('ST_Dimension(g)')));
    assert(sql.includes("SET LOCAL statement_timeout = '2000ms'"));
  } finally {
    if (previous === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = previous;
  }
});

test('the accepted summary excludes raw and payload-budget rejections and writes once per sealed attempt', async () => {
  const counts: StreamingVectorGeometrySummary['counts'] = {};
  const writer = new StreamingPartWriter(async (_index, records) => {
    for (const record of records) tallyAcceptedGeometry(counts, record);
  });
  const result = await read([point, line]);
  await writer.add(result.records[0], limits.chunkFeatures);
  await writer.add({ ...result.records[1], feature: { ...feature(line), properties: {
    oversized: 'x'.repeat(limits.chunkBytes),
  } } }, limits.chunkFeatures);
  tallyAcceptedGeometry(counts, { ...result.records[0], disposition: 'quarantined', feature: null });
  await writer.flush();
  assert.deepEqual(counts, { Point: 1 });
  const statements: unknown[][] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    assert.match(sql, /jsonb_set\(COALESCE\(inspection,'\{\}'::jsonb\),/,
      'a matching summary must also be writable when inspection is NULL');
    statements.push(values);
    return { rows: [] };
  } } as unknown as PoolClient;
  await writeStreamingGeometrySummaryTx(client, input, counts, 1);
  assert.deepEqual(JSON.parse(statements[0][1] as string), { rawJobId: jobId, counts: { Point: 1 } });
  await writeStreamingGeometrySummaryTx(client, input, counts, 2);
  assert.equal(statements.length, 1);
  assert.equal(StreamingVectorGeometrySummarySchema.safeParse({ rawJobId: jobId,
    counts: { GeometryCollection: 1 } }).success, false);
});

/** SQL protocol for the worker's actual sealed-result continuation, not a native/PostGIS qualification. */
function sealedReadStore(sealedInput: StreamingVectorInput) {
  const state = { state: 'running', records: 2, accepted: 2, quarantined: 0, sealed_chunks: 1,
    next_publish_index: 1, unknown_remainder: false };
  const source = { profile: 'large-original-v1', case_id: sealedInput.caseId, revision: 1,
    sha256: sealedInput.sourceSha256, bytes: sealedInput.sourceBytes, object_key: sealedInput.objectKey,
    inspection: {} as Record<string, unknown> };
  const client = { query: async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT accepted,quarantined')) return { rows: [state] };
    if (sql.startsWith('UPDATE usp_streaming_vector_imports')) {
      state.state = values[1] as string;
      return { rows: [] };
    }
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [source] };
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_imports')) return { rows: [state] };
    if (sql.startsWith('SELECT chunk_index')) return { rows: [{ chunk_index: 0, first_feature_index: 0,
      last_feature_index: 1, records: 2, accepted: 2, quarantined: 0, published: true,
      result_sha256: 'b'.repeat(64) }] };
    if (sql.startsWith('UPDATE sources') && sql.includes("'{streamedMapReceipt}'")) {
      source.inspection.streamedMapReceipt = JSON.parse(values[1] as string);
      return { rows: [] };
    }
    throw new Error(`Unexpected sealed-result statement: ${sql}`);
  } } as unknown as PoolClient;
  return { state, source, client };
}

test('a mismatched attempt tally completes the sealed import with its receipt and no kind summary', async () => {
  const sealedInput = { ...input, version: limits.version, framing: 'feature-collection', sourceBytes: 64,
    caseId: '32000000-0000-4000-8000-000000000003', objectKey: 'synthetic-protocol-original' } as StreamingVectorInput;
  const store = sealedReadStore(sealedInput);
  const status = await completeStreamingReadTx(store.client, sealedInput, {
    bytes: sealedInput.sourceBytes, sha256: sealedInput.sourceSha256, features: 2,
    metadata: { type: 'FeatureCollection' },
  }, { Polygon: 1 });
  assert.equal(status, 'completed');
  assert.equal(store.state.state, 'completed');
  assert.equal(store.state.sealed_chunks, 1);
  assert.equal(store.state.unknown_remainder, false);
  assert.equal(Object.hasOwn(store.source.inspection, 'streamedGeometrySummary'), false);
  const receipt = store.source.inspection.streamedMapReceipt as { accepted: number; coverage: string };
  assert.equal(receipt.accepted, 2);
  assert.equal(receipt.coverage, 'sealed');
});
