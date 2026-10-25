import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { openObjectStream } from '../../../infrastructure/storage';
import { settings } from '../../../infrastructure/config';
import { readStreamingRaw, readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { StreamingPartWriter, streamingFailureKind } from './streaming-vector-worker';

function mockStorage(t: TestContext, source: () => Readable, bytes: number) {
  for (const key of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    t.mock.getter(settings, key, () => key === 's3Endpoint' ? 'http://127.0.0.1:1' : 'test-only');
  t.mock.method(S3Client.prototype, 'send', async () => ({ Body: source(), ContentLength: bytes,
    ETag: 'test-only' }));
}

function isTimeout(error: unknown) {
  assert.equal((error as { status: number }).status, 503);
  assert.equal((error as { code: string }).code, 'STORAGE_TIMEOUT');
  assert.equal(streamingFailureKind(error), 'retry');
  return true;
}

// test_only: same ready bytes, no network. Only consumer holds and the selected bounds change.
test('raw progress outlives the old wall limit; idle stalls and independent outer expiry still fail', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const feature = '{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]}}';
  const bytes = Buffer.from(`{"type":"FeatureCollection","features":[${feature},${feature},${feature}]}`);
  let source: Readable;
  mockStorage(t, () => source, bytes.length);
  const observations: { mode: string; holds: number[]; published: number; timeout: boolean }[] = [];
  const cases = [
    { mode: 'raw', holds: [0, 0, 0], outerMs: 200, timeout: false },
    { mode: 'legacy', holds: [51, 50, 0], outerMs: 100, timeout: true },
    { mode: 'raw', holds: [51, 50, 0], outerMs: 200, timeout: false },
    { mode: 'raw', holds: [101, 0, 0], outerMs: 200, timeout: true },
    { mode: 'raw', holds: [51, 50, 0], outerMs: 100, timeout: true },
  ];
  for (const scenario of cases) {
    source = new Readable({ read() {} });
    source.push(bytes);
    let published = 0;
    const consume = async (body: Readable, progress: () => void) => {
      const parts = new StreamingPartWriter(async () => {
        t.mock.timers.tick(scenario.holds[published]!);
        progress();
        published++;
        // Keep EOF pending until publication; all source bytes were ready before the first hold.
        if (published === 3) source.push(null);
      });
      return readStreamingFeatures(body, 'feature-collection', async item => parts.add(sourceRecord(item), 1));
    };
    const read = scenario.mode === 'raw'
      ? readStreamingRaw('test-only/deadline', bytes.length, undefined, consume,
        { idleMs: 75, outerMs: scenario.outerMs })
      : (async () => {
        const object = await openObjectStream('test-only/deadline', bytes.length, scenario.outerMs);
        try { return await consume(object.body, () => {}); } finally { object.body.destroy(); }
      })();
    if (scenario.timeout) await assert.rejects(read, isTimeout);
    else {
      assert.equal((await read).features, 3);
      assert.equal(published, 3);
    }
    assert.equal(source.destroyed, true);
    observations.push({ mode: scenario.mode, holds: scenario.holds, published, timeout: scenario.timeout });
  }
  t.diagnostic(JSON.stringify({ idleMs: 75, observations }));
});

test('raw idle resets on each byte chunk and both bounds remain active through publication after EOF', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let source: Readable;
  mockStorage(t, () => source, 3);
  for (const gap of [60, 76]) {
    source = Readable.from((async function* () {
      yield Buffer.from('a');
      t.mock.timers.tick(gap);
      yield Buffer.from('b');
      t.mock.timers.tick(gap);
      yield Buffer.from('c');
    })(), { objectMode: false });
    const read = readStreamingRaw('test-only/bytes', 3, undefined, async body => {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk);
      return Buffer.concat(chunks).toString();
    }, { idleMs: 75, outerMs: 300 });
    if (gap > 75) await assert.rejects(read, isTimeout);
    else assert.equal(await read, 'abc');
    assert.equal(source.destroyed, true);
  }
  // The final partial part can be published after storage EOF: it is still inside both raw bounds.
  for (const bounds of [{ idleMs: 75, outerMs: 300 }, { idleMs: 300, outerMs: 75 }]) {
    source = Readable.from([Buffer.from('abc')]);
    await assert.rejects(readStreamingRaw('test-only/final-part', 3, undefined, async body => {
      for await (const _chunk of body) { /* consume the original before publishing its final part */ }
      assert.equal(source.readableEnded, true);
      t.mock.timers.tick(76);
      await new Promise(() => {}); // A stuck publisher cannot postpone reporting either deadline.
    }, bounds), isTimeout);
    assert.equal(source.destroyed, true);
  }
});
