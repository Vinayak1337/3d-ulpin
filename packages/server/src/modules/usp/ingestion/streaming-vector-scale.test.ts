import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { STREAMING_VECTOR_LIMITS as limits, streamingReadMs, streamingRawReadMs,
  type AnyStreamingInput } from '@ulpin/contracts/usp';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { encodeChunk, StreamingPartWriter } from './streaming-vector-worker';

const MiB = 1024 ** 2;
const input = { jobId: '16000000-0000-4000-8000-000000000001', sourceId: '16000000-0000-4000-8000-000000000002',
  sourceRevision: 1, sourceSha256: 'a'.repeat(64) } as AnyStreamingInput;

/** test_only: generated here as a stream of small closed squares, never written to disk or the repository. */
function* featureCollection(count: number) {
  yield Buffer.from('{"type":"FeatureCollection","name":"g16-test-only","features":[');
  for (let first = 0; first < count; first += 1000) {
    const batch: string[] = [];
    for (let index = first; index < Math.min(count, first + 1000); index++) {
      const x = (index % 1000) / 1000, y = Math.floor(index / 1000) / 1000;
      const [x0, y0, x1, y1] = [x, y, x + 0.0005, y + 0.0005].map(value => value.toFixed(4));
      batch.push(`{"type":"Feature","properties":{"id":"t${index}"},"geometry":{"type":"Polygon",`
        + `"coordinates":[[[${x0},${y0}],[${x1},${y0}],[${x1},${y1}],[${x0},${y0}]]]}}`);
    }
    yield Buffer.from((first ? ',' : '') + batch.join(','));
  }
  yield Buffer.from(']}');
}

test('the read deadline is 10 minutes for each started 128 MiB, so 1 GiB has 80 minutes', () => {
  assert.equal(limits.sourceBytes, 1024 * MiB);
  assert.equal(limits.chunks * limits.chunkFeatures, 500000);
  assert.equal(limits.features, 500000);
  assert.equal(streamingReadMs(1), 10 * 60 * 1000);
  assert.equal(streamingReadMs(128 * MiB), 10 * 60 * 1000);
  assert.equal(streamingReadMs(128 * MiB + 1), 20 * 60 * 1000);
  assert.equal(streamingReadMs(limits.sourceBytes), 80 * 60 * 1000);
  assert.deepEqual([1, 128 * MiB, limits.sourceBytes].map(streamingRawReadMs), [30, 30, 240].map(m => m * 60000));
});

test('500,000 generated polygons fill exactly 5000 parts while the retained heap stays flat', async t => {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  gc();
  const started = performance.now(), base = process.memoryUsage().heapUsed, retained: number[] = [];
  let heap = 0, rss = 0, stored = 0;
  const parts = new StreamingPartWriter(async (index, records) => {
    stored += encodeChunk(input, index, records).bytes.length;
    const usage = process.memoryUsage();
    heap = Math.max(heap, usage.heapUsed);rss = Math.max(rss, usage.rss);
    // What the reader and writer still hold after every 500th part, once garbage is collected.
    if (index % 500 === 499) {gc();retained.push(process.memoryUsage().heapUsed);}
  });
  const result = await readStreamingFeatures(Readable.from(featureCollection(limits.features)), 'feature-collection',
    async item => {
      const record = sourceRecord(item);
      assert.equal(record.disposition, 'accepted');
      await parts.add(record, limits.chunkFeatures);
    });
  await parts.flush();
  const seconds = (performance.now() - started) / 1000, mib = (bytes: number) => Number((bytes / MiB).toFixed(1));
  const growth = Math.max(...retained) - Math.min(...retained);
  t.diagnostic(JSON.stringify({ features: result.features, parts: parts.index, sourceBytes: result.bytes,
    storedPartBytes: stored, seconds: Number(seconds.toFixed(1)), baseHeapMiB: mib(base),
    retainedHeapMiB: retained.map(mib), retainedGrowthMiB: mib(growth), peakHeapMiB: mib(heap), peakRssMiB: mib(rss) }));
  assert.equal(result.features, limits.features);
  assert.equal(parts.index, limits.chunks);
  assert.equal(retained.length, 10);
  // The source is about 77 MiB; a reader or writer that kept even a tenth of its features would show here.
  assert.ok(growth < 8 * MiB, 'the retained heap grew with the file');
  assert.ok(Math.max(...retained) - base < 16 * MiB, 'more than one part is held');
});
