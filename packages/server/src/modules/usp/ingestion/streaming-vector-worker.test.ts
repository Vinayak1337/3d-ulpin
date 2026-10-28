import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import type { AnyStreamingInput, StreamingVectorInput, StreamingVectorRecord } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { sql } from '../../../infrastructure/sql-loader';
import { migrateStreamingVectorTx } from './migration';
import { localOperatorSubject } from '../principal';
import { endImportTx, fencedOut, publishStreamingPrefixTx, StreamingPartWriter,
  streamingFailureKind, tallySetAside, assertStreamingPublicationInputTx, sealStreamingReadTx,
  completeStreamingReadTx } from './streaming-vector-worker';
import { resolveStreamedReference, sealedMapReceipt } from './streamed-map-receipt';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';

const caseId = '30000000-0000-4000-8000-000000000001';
const sourceId = '30000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000003';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'streaming-vector-protocol';
const input = { jobId, caseId, sourceId, sourceRevision: 1, subject: localOperatorSubject() } as AnyStreamingInput;
const marker = { index: 487, featureIndex: 48686, attempt: 1, fence: 1 };

test('streaming migration adds only the counted-tail column after the existing import schema', async () => {
  const calls: string[] = [];
  const client = { query: async (text: string) => { calls.push(text); } } as unknown as PoolClient;
  await migrateStreamingVectorTx(client);
  assert.deepEqual(calls, [sql('ingestion.streaming-vector.schema'), sql('ingestion.streaming-vector.lines-limit')]);
  assert.match(calls[1], /ADD COLUMN IF NOT EXISTS lines_beyond_limit integer NOT NULL DEFAULT 0/);
});

test('source write locks precede validation only for receipt/refusal writers, never tabular readers', async () => {
  for (const [framing, receipt, expected] of [
    ['feature-collection', true, 'UPDATE'], ['feature-collection', false, 'NO KEY UPDATE'],
    ['tabular', true, null],
  ] as const) {
    const statements: string[] = [], stop = new Error('stop before source-pin data reads');
    const client = { query: async (sql: string) => {
      if (sql.startsWith('SELECT id,revision,archived')) throw stop;
      statements.push(sql);
      return { rows: [] };
    } } as unknown as PoolClient;
    await assert.rejects(assertStreamingPublicationInputTx(client, { ...input, framing } as AnyStreamingInput,
      receipt), error => error === stop);
    assert.equal(statements.length, expected ? 2 : 0);
    if (expected) {
      assert.match(statements[0], /FROM cases.*FOR SHARE/);
      assert.ok(statements[1].endsWith(`FOR ${expected}`));
    }
  }
});

/** Records every statement; the published watermark already stands at the sealed count. */
function recorder() {
  const statements: { sql: string; values: unknown[] }[] = [];
  const one = (row: unknown) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const client = { query: async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (sql.startsWith('SELECT next_publish_index')) return one({ next_publish_index: 487 });
    if (sql.startsWith('SELECT revision FROM cases')) return one({ revision: 3 });
    if (sql.startsWith('UPDATE usp_outbox_streams')) return one({ sequence: '1' });
    return one(null);
  } } as unknown as PoolClient;
  const find = (prefix: string) => statements.filter(statement => statement.sql.trimStart().startsWith(prefix));
  return { client, statements, find };
}

// test_only: staged immutable parts and the SQL publication watermark, with no storage or runtime.
function collectionStore() {
  const state = { next_publish_index: 0, sealed_chunks: null as number | null };
  const slots: { published: boolean; chunk_index: number; records: number;
    status: 'ready'; result_sha256: string }[] = [];
  let events = 0;
  const statements: string[] = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (sql.startsWith('SELECT next_publish_index')) return { rows: [{ ...state }] };
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_slots'))
      return { rows: slots[Number(values[2])] ? [slots[Number(values[2])]] : [] };
    if (sql.startsWith('UPDATE usp_streaming_vector_slots SET published'))
      slots[Number(values[2])].published = true;
    if (sql.startsWith('UPDATE usp_streaming_vector_imports SET next_publish_index')) state.next_publish_index++;
    if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: 3 }] };
    if (sql.startsWith('UPDATE usp_outbox_streams')) {
      events++;
      return { rows: [{ sequence: String(events) }] };
    }
    return { rows: [], rowCount: 1 };
  } } as unknown as PoolClient;
  const stage = (index: number, records: number) => slots.push({ chunk_index: index, records,
    published: false, status: 'ready', result_sha256: 'a'.repeat(64) });
  return { state, slots, client, stage, statements, events: () => events };
}

test('a type-first collection publishes its first part before the reader can read the rest', async () => {
  const feature = '{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":null}';
  const store = collectionStore();
  const collectionInput = { ...input, framing: 'feature-collection' } as AnyStreamingInput;
  let holdCollection = true;
  const parts = new StreamingPartWriter(async (index, records) => {
    store.stage(index, records.length);
    await publishStreamingPrefixTx(store.client, collectionInput, holdCollection);
  });
  const body = new Readable({ read() {} });
  body.push(Buffer.from(`{"type":"FeatureCollection","features":[${feature},`));
  try {
    const closure = await readStreamingFeatures(body, 'feature-collection', async item => {
      holdCollection = item.collectionTypeBeforeFeatures !== true;
      await parts.add(sourceRecord(item), 1);
      if (item.index === 0) {
        assert.equal(store.events(), 1, 'the first part publishes while the rest is still unavailable');
        assert.equal(store.state.sealed_chunks, null);
        assert.equal(body.readableEnded, false);
        body.push(Buffer.from(`${feature}]}`));
        body.push(null);
      }
    });
    assert.equal(closure.features, 2);
    assert.equal(store.state.next_publish_index, parts.index, 'the usual prefix already closes before the seal');
    assert.equal(store.events(), 2);
    store.state.sealed_chunks = parts.index;
    await publishStreamingPrefixTx(store.client, collectionInput, holdCollection);
    assert.equal(store.events(), 2, 'the seal does not publish duplicate parts');
  } finally {
    body.destroy();
  }
});

test('both sequence framings publish before seal and keep stable codes in receipt tallies',
  async () => {
    for (const framing of ['geojson-lines', 'geojson-seq-rs'] as const) {
      const store = collectionStore(), tally: Record<string, number> = {};
      const parts = new StreamingPartWriter(async (index, records) => {
        store.stage(index, records.length);
        await publishStreamingPrefixTx(store.client, { ...input, framing });
      });
      const prefix = framing === 'geojson-lines' ? '' : '\x1e';
      const bytes = Buffer.from(prefix + 'null\n' + prefix + '{broken\n');
      const closed = await readStreamingFeatures(Readable.from([bytes]), framing, async item => {
        const record = sourceRecord(item);
        tallySetAside(tally, record);
        await parts.add(record, 1);
      });
      assert.equal(store.state.sealed_chunks, null);
      assert.equal(store.state.next_publish_index, 2);
      assert.equal(store.events(), 2);
      assert.deepEqual(tally, { INVALID_FEATURE: 1, GEOJSON_JSON: 1 });
      const receipt = sealedMapReceipt({ ...input, framing, version: 'geojson-stream/2',
        sourceBytes: bytes.length, sourceSha256: closed.sha256 } as StreamingVectorInput,
      { ...closed, quarantinedByCode: tally }, store.slots.map((slot, index) => ({ ...slot,
        first_feature_index: index, last_feature_index: index, accepted: 0, quarantined: 1 })));
      assert.deepEqual(receipt.quarantinedByCode, { INVALID_FEATURE: 1, GEOJSON_JSON: 1 });
    }
  });

test('a lowered line ceiling seals and completes its parts with a counted tail, not a failed marker', async () => {
  const original = readFileSync('fixtures/google-uttam/00-all-google-detections.geojson');
  const features = JSON.parse(original.toString()).features.slice(0, 11);
  const lines = features.map((feature: unknown) => JSON.stringify(feature));
  lines.splice(2, 0, '');
  const bytes = Buffer.from(lines.join('\n') + '\n'), records: StreamingVectorRecord[] = [];
  const closed = await readStreamingFeatures(Readable.from([bytes]), 'geojson-lines', async item => {
    records.push(sourceRecord(item));
  }, 5);
  const state = { records: records.length, accepted: records.length, quarantined: 0, next_publish_index: 1,
    sealed_chunks: null as number | null, unknown_remainder: true, lines_beyond_limit: 0, state: 'running' };
  const pin = { ...input, framing: 'geojson-lines', version: 'geojson-stream/2', sourceBytes: bytes.length,
    sourceSha256: closed.sha256, objectKey: 'test_only/lines' } as StreamingVectorInput;
  const source = { profile: 'large-original-v1', case_id: caseId, revision: 1, sha256: closed.sha256,
    bytes: bytes.length, object_key: pin.objectKey };
  let receipt: { features: number; sourceSha256: string; sourceBytes: number } | undefined;
  const statements: string[] = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (sql.startsWith('SELECT * FROM usp_streaming_vector_imports') || sql.startsWith('SELECT accepted,'))
      return { rows: [state] };
    if (sql.includes('SET sealed_chunks=')) Object.assign(state, { sealed_chunks: values[1],
      unknown_remainder: false, lines_beyond_limit: values[2] });
    if (sql.includes('SET state=$2,issue_code=NULL')) state.state = String(values[1]);
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [source] };
    if (sql.startsWith('SELECT chunk_index,')) return { rows: [{ chunk_index: 0, first_feature_index: 0,
      last_feature_index: 4, records: 5, accepted: 5, quarantined: 0, published: true,
      result_sha256: 'a'.repeat(64) }] };
    if (sql.includes("'{streamedMapReceipt}'")) receipt = JSON.parse(String(values[1]));
    return { rows: [], rowCount: 1 };
  } } as unknown as PoolClient;
  await sealStreamingReadTx(client, pin, closed, 1, false);
  assert.equal(state.sealed_chunks, 1);
  assert.equal(state.unknown_remainder, false);
  assert.equal(state.lines_beyond_limit, 6);
  assert.equal(await completeStreamingReadTx(client, pin, closed, { Polygon: 5 }), 'completed');
  assert.equal(receipt?.features, 5);
  assert.equal(receipt?.sourceBytes, bytes.length);
  assert.equal(receipt?.sourceSha256, closed.sha256);
  assert(!statements.some(sql => sql.includes('INSERT INTO usp_streaming_vector_slots')));
  assert.deepEqual(readFileSync('fixtures/google-uttam/00-all-google-detections.geojson'), original);
});

test('late-type collection parts publish only after the root and a late CRS pass', async () => {
  const feature = '{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},'
    + '"properties":{"name":"test_only"}}';
  const crs = '"crs":{"type":"name","properties":{"name":"EPSG:2958"}}';
  const collections = [
    `{"features":[${feature},${feature}],"type":"FeatureCollection",${crs}}`,
    `{"name":"test_only",${crs},"features":[${feature},${feature}],"type":"FeatureCollection"}`,
  ];
  for (const text of collections) {
    const store = collectionStore();
    const collectionInput = { ...input, sourceRevision: 1, framing: 'feature-collection' } as AnyStreamingInput;
    let holdCollection = true;
    const parts = new StreamingPartWriter(async (index, records) => {
      store.stage(index, records.length);
      await publishStreamingPrefixTx(store.client, collectionInput, holdCollection);
      assert.equal(store.events(), 0, 'a staged part must remain private');
    });
    const closure = await readStreamingFeatures(Readable.from([Buffer.from(text)]), 'feature-collection',
      async item => {
        holdCollection = item.collectionTypeBeforeFeatures !== true;
        await parts.add(sourceRecord(item), 1);
      });
    assert.equal(store.slots.length, 2);
    assert.equal(store.events(), 0, 'root closure alone does not publish held parts');
    await resolveStreamedReference(closure.metadata, async () => {
      assert.equal(store.events(), 0, 'even a closed root waits for CRS validation');
      return { declared: 'EPSG:2958', authority: 'EPSG', unit: 'metre' };
    });
    store.state.sealed_chunks = parts.index;
    await publishStreamingPrefixTx(store.client, collectionInput, holdCollection);
    assert.equal(store.events(), 2);
    assert.equal(store.state.next_publish_index, 2);
    assert.ok(store.slots.every(slot => slot.published));
  }
});

test('a missing or wrong root type, or a refused late CRS, publishes none of its staged parts', async () => {
  const feature = '{"type":"Feature","geometry":null,"properties":{"name":"test_only"}}';
  for (const suffix of ['', ',"type":"Feature"', ',"type":"FeatureCollection","crs":null']) {
    const store = collectionStore();
    const collectionInput = { ...input, sourceRevision: 1, framing: 'feature-collection' } as AnyStreamingInput;
    let holdCollection = true;
    const parts = new StreamingPartWriter(async (index, records) => {
      store.stage(index, records.length);
      await publishStreamingPrefixTx(store.client, collectionInput, holdCollection);
    });
    let refusal: AppError | undefined;
    await assert.rejects(async () => {
      const text = `{"features":[${feature}]${suffix}}`;
      const closure = await readStreamingFeatures(Readable.from([Buffer.from(text)]), 'feature-collection',
        async item => {
          holdCollection = item.collectionTypeBeforeFeatures !== true;
          await parts.add(sourceRecord(item), 1);
        });
      await resolveStreamedReference(closure.metadata, async () => {
        throw new AppError(422, 'AREA_PROCESSING', "The file's crs member declares null; unsupported.");
      });
    }, (error: AppError) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, suffix.includes('"crs"') ? 'STREAMING_SOURCE_CRS' : 'GEOJSON_COLLECTION_TYPE');
      refusal = error;
      return true;
    });
    assert.equal(store.slots.length, 1, 'the part was staged, not discarded or reserialised');
    assert.equal(store.events(), 0);
    assert.equal(store.state.next_publish_index, 0);
    assert.ok(store.slots.every(slot => !slot.published));
    await endImportTx(store.client, collectionInput,
      { records: 1, sealed_chunks: null, next_publish_index: 0 }, refusal!.code, false,
      { index: parts.index, featureIndex: 1, attempt: 1, fence: 1 }, holdCollection);
    assert.equal(store.events(), 1, 'only the failure state event is emitted, never a part or marker');
    assert.equal(store.state.next_publish_index, 0);
    assert.ok(!store.statements.some(sql => sql.startsWith('INSERT INTO usp_streaming_vector_slots')));
    assert.ok(store.slots.every(slot => !slot.published));
  }
});

test('a failed unsealed collection never publishes its buffered prefix or terminal marker', async () => {
  const store = collectionStore();
  const collectionInput = { ...input, sourceRevision: 1, framing: 'feature-collection' } as AnyStreamingInput;
  store.stage(0, 100);
  await endImportTx(store.client, collectionInput, { records: 100, sealed_chunks: null, next_publish_index: 0 },
    'GEOJSON_COLLECTION_TYPE', false, { index: 1, featureIndex: 100, attempt: 1, fence: 1 });
  assert.equal(store.state.next_publish_index, 0);
  assert.equal(store.slots[0].published, false);
  assert.equal(store.events(), 1, 'only the failure state event, never a chunk event');
});

test('a failure after the seal ends the job failed once, with no slot past the seal and no retry', async () => {
  const sealed = recorder();
  await endImportTx(sealed.client, input, { records: 48686, sealed_chunks: 487, next_publish_index: 487 },
    'STREAMING_SOURCE_CRS', false, marker);
  assert.equal(sealed.find('INSERT INTO usp_streaming_vector_slots').length, 0);
  assert.equal(sealed.find('SELECT next_publish_index').length, 0, 'nothing is published past the seal');
  assert.deepEqual(sealed.find('UPDATE jobs').map(statement => statement.values), [[jobId, 'failed',
    'STREAMING_SOURCE_CRS']]);
  assert.deepEqual(sealed.find('UPDATE usp_streaming_vector_imports').map(statement => statement.values),
    [[jobId, 'failed', 'STREAMING_SOURCE_CRS', false]]);
  assert(!sealed.statements.some(statement => /status='queued'|logical_state='queued'/.test(statement.sql)));
  assert.equal(sealed.find('UPDATE usp_outbox_streams').length, 1, 'one failed event');
});

test('an unsealed failure still closes the published prefix with its ordered marker', async () => {
  const open = recorder();
  await endImportTx(open.client, input, { records: 48686, sealed_chunks: null, next_publish_index: 487 },
    'GEOJSON_JSON', false, marker);
  const [slot] = open.find('INSERT INTO usp_streaming_vector_slots');
  assert.deepEqual(slot.values.slice(0, 5), [jobId, 1, 487, 48686, 'GEOJSON_JSON']);
  assert.equal(open.find('SELECT next_publish_index').length, 1);
  assert.deepEqual(open.find('UPDATE usp_streaming_vector_imports').at(-1)!.values,
    [jobId, 'failed', 'GEOJSON_JSON', true]);
  await assert.rejects(endImportTx(recorder().client, input, { records: 48600, sealed_chunks: null,
    next_publish_index: 487 }, 'GEOJSON_JSON', false, marker), { status: 409, code: 'STALE_REVISION' });
  const stale = recorder();
  await endImportTx(stale.client, input, { records: 48686, sealed_chunks: null, next_publish_index: 487 },
    'STREAMING_CONTEXT_STALE', true, null);
  assert.equal(stale.find('INSERT INTO usp_streaming_vector_slots').length, 0);
  assert.deepEqual(stale.find('UPDATE jobs')[0].values, [jobId, 'stale', 'STREAMING_CONTEXT_STALE']);
  assert.equal(stale.find('UPDATE usp_outbox_streams').length, 0);
});

test('an unsealed type-first collection still closes its published prefix with an ordered marker', async () => {
  const open = recorder();
  const collectionInput = { ...input, framing: 'feature-collection' } as AnyStreamingInput;
  await endImportTx(open.client, collectionInput,
    { records: 48686, sealed_chunks: null, next_publish_index: 487 }, 'GEOJSON_JSON', false, marker, false);
  assert.equal(open.find('INSERT INTO usp_streaming_vector_slots').length, 1);
  assert.equal(open.find('SELECT next_publish_index').length, 1, 'the usual prefix is not held on failure');
});

test('only a lost fence is swallowed; any other failure to end the job reaches the dispatcher', () => {
  assert.throws(() => conflict('This worker completion expired, changed inputs or was fenced.'),
    (error: unknown) => fencedOut(error));
  const check = Object.assign(new Error('new row violates check constraint'), { code: '23514' });
  for (const error of [check, new AppError(422, 'STREAMING_SOURCE_CRS', 'refused'),
    new AppError(409, 'STREAMING_REPLAY', 'other'), undefined]) assert.equal(fencedOut(error), false);
});

test('one read tallies each set-aside record under its own code and counts no accepted record', async () => {
  const square = [[[0, 0], [1, 0], [1, 1], [0, 0]]], open = [[[0, 0], [1, 0], [1, 1], [0, 1]]];
  const feature = (coordinates: unknown, id = '1') => `{"type":"Feature","properties":{"id":${id}},`
    + `"geometry":{"type":"Polygon","coordinates":${JSON.stringify(coordinates)}}}`;
  const features = [feature(square), feature(square, '9007199254740993'), feature(open),
    feature(open, '9007199254740993'), feature(square, '123456789012345678901'), feature(open)];
  const body = Readable.from([Buffer.from(`{"type":"FeatureCollection","features":[${features.join(',')}]}`)]);
  const tally: Record<string, number> = {};
  await readStreamingFeatures(body, 'feature-collection', async item => tallySetAside(tally, sourceRecord(item)));
  assert.deepEqual(tally, { UNREPRESENTABLE_NUMBER: 3, OPEN_RING: 2 });
  tallySetAside(tally, { featureIndex: 6, byteStart: 0, byteEnd: 2, rawSha256: 'a'.repeat(64),
    disposition: 'quarantined', issueCode: null, feature: null });
  assert.deepEqual(tally, { UNREPRESENTABLE_NUMBER: 3, OPEN_RING: 2, UNSTATED: 1 });
});

test('a processor without the operation ends the read at once; its other faults are still retried', async () => {
  process.env.GEO_URL ??= 'http://processor.invalid';
  process.env.GEO_SERVICE_TOKEN ??= 'protocol';
  const declared = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:2958' } } };
  const answer = async (status: number, detail: string) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ detail }), { status });
    try { return await resolveStreamedReference(declared).catch(error => error); }
    finally { globalThis.fetch = original; }
  };
  const missing = await answer(404, 'Unknown area operation.');
  assert.deepEqual([missing.status, missing.code, missing.message], [503, 'AREA_PROCESSOR_OPERATION',
    'The area processor in use does not offer the resolve-geojson-crs operation.']);
  assert.equal(streamingFailureKind(missing), 'final');
  assert.equal(streamingFailureKind(await answer(405, 'Method Not Allowed')), 'final');
  const down = await answer(500, 'Internal Server Error');
  assert.deepEqual([down.status, down.code], [503, 'AREA_PROCESSING']);
  assert.equal(streamingFailureKind(down), 'retry');
  assert.equal(streamingFailureKind(await answer(422, 'Unexpected geo operation resolve-geojson-crs.')), 'retry');
  assert.equal(streamingFailureKind(new AppError(422, 'GEOJSON_JSON', 'x')), 'final');
  assert.equal(streamingFailureKind(new AppError(409, 'STALE_REVISION', 'x')), 'stale');
  assert.equal(streamingFailureKind(new Error('connection reset')), 'retry');
});
