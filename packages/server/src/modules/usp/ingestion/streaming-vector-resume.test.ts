import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import type { AnyStreamingInput } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { sha256 } from '../../../infrastructure/storage';
import { readStreamingRaw, readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { encodeChunk, StreamingPartWriter } from './streaming-vector-worker';

// test_only: repeated public NYC features, never a new survey or registry claim.
const original = readFileSync('fixtures/real-nyc/original.geojson');
const features = JSON.parse(original.toString()).features.map((value: unknown) => JSON.stringify(value));
const units = Array.from({ length: 9 }, (_, i) => features[i % features.length]);
const input = { jobId: '16000000-0000-4000-8000-000000000001', sourceId: '16000000-0000-4000-8000-000000000002',
  sourceRevision: 1, sourceSha256: 'a'.repeat(64) } as AnyStreamingInput;

test('connection cuts retain exact parts and whole-source hash; changed objects and excess resets refuse', async t => {
  for (const key of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    t.mock.getter(settings, key, () => key === 's3Endpoint' ? 'http://127.0.0.1:1' : 'test-only');
  let bytes: Buffer, cuts: number[], changed = false, ignoredRange = false, precondition = false;
  let opens: number[] = [], sealed: number[] = [];
  t.mock.method(S3Client.prototype, 'send', async (command: { input: { Range?: string; IfMatch?: string } }) => {
    const start = Number(command.input.Range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
    if (start) assert.equal(command.input.IfMatch, 'test-only');
    opens.push(start);
    if (start && precondition)
      throw Object.assign(new Error('test-only changed object'), { $metadata: { httpStatusCode: 412 } });
    const cut = cuts.shift();
    const body = Readable.from((async function* () {
      for (let at = start; at < (cut ?? bytes.length); at += 17)
        yield bytes.subarray(at, Math.min(at + 17, cut ?? bytes.length));
      await new Promise(resolve => setImmediate(resolve));
      if (cut !== undefined) throw Object.assign(new Error('test-only connection cut'), { code: 'ECONNRESET' });
    })(), { objectMode: false, highWaterMark: 1 });
    return { Body: body, ETag: changed && start ? 'changed' : 'test-only', ContentLength: bytes.length - start,
      $metadata: { httpStatusCode: start && !ignoredRange ? 206 : 200 },
      ContentRange: start ? `bytes ${start}-${bytes.length - 1}/${bytes.length}` : undefined };
  });
  const run = async () => {
    opens = [];
    sealed = [];
    const stored: ReturnType<typeof encodeChunk>[] = [];
    const consume = async (body: Readable, progress: () => void, seal: (end: number) => void) => {
      const parts = new StreamingPartWriter(async (index, records) => {
        stored.push(encodeChunk(input, index, records));
        sealed.push(records.at(-1)!.byteEnd);
        seal?.(sealed.at(-1)!);
        progress();
      });
      const read = await readStreamingFeatures(body, 'feature-collection',
        async item => parts.add(sourceRecord(item), 2));
      await parts.flush();
      return read;
    };
    const closure = await readStreamingRaw('test-only/resume', bytes.length, undefined, consume);
    assert.equal(closure.sha256, sha256(bytes));
    assert.equal(closure.bytes, bytes.length);
    return { closure, stored };
  };
  for (const lateType of [false, true]) {
    bytes = Buffer.from(lateType ? `{"features":[${units.join(',')}],"type":"FeatureCollection"}`
      : `{"type":"FeatureCollection","features":[${units.join(',')}]}`);
    cuts = [];
    const baseline = await run(), boundary = sealed[0];
    // Cuts at the feature boundary, in a later value, and during root closure.
    for (const cut of [boundary, boundary + 1, boundary + 49, bytes.length - 1]) {
      cuts = [cut];
      assert.deepEqual(await run(), baseline);
      assert.equal(opens.length, 2);
      assert.ok(sealed.includes(opens[1]) && opens[1] > 0);
    }
    cuts = [boundary + 49, boundary + 49, boundary + 49];
    assert.deepEqual(await run(), baseline);
    assert.equal(opens.length, 4);
    cuts = Array(4).fill(boundary + 49);
    await assert.rejects(run(), { code: 'ECONNRESET' });
    assert.equal(opens.length, 4, 'three reopens at most per attempt');
    cuts = [boundary + 49];
    changed = true;
    await assert.rejects(run(), { code: 'SOURCE_INTEGRITY' });
    assert.equal(opens.length, 2);
    changed = false;
    ignoredRange = true;
    cuts = [boundary + 49];
    await assert.rejects(run(), { code: 'SOURCE_INTEGRITY' });
    ignoredRange = false;
    precondition = true;
    cuts = [boundary + 49];
    await assert.rejects(run(), { code: 'SOURCE_INTEGRITY' });
    assert.equal(opens.length, 2);
    precondition = false;
    cuts = [1];
    await assert.rejects(run(), { code: 'ECONNRESET' });
    assert.equal(opens.length, 1, 'no sealed feature boundary means no in-attempt resume');
  }
  assert.deepEqual(readFileSync('fixtures/real-nyc/original.geojson'), original);
});
