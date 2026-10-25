import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { openObjectStream } from '../../../infrastructure/storage';
import { settings } from '../../../infrastructure/config';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { StreamingPartWriter, streamingFailureKind } from './streaming-vector-worker';

// test_only: no runtime or network. Compare the same ready bytes with only consumer waiting changed.
test('the whole-object deadline counts a stalled chunk publisher, not just missing storage bytes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const feature = '{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]}}';
  const bytes = Buffer.from(`{"type":"FeatureCollection","features":[${feature},${feature}]}`);
  let body: Readable;
  for (const key of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const)
    t.mock.getter(settings, key, () => key === 's3Endpoint' ? 'http://127.0.0.1:1' : 'test-only');
  t.mock.method(S3Client.prototype, 'send', async () => ({ Body: body, ContentLength: bytes.length,
    ETag: 'test-only' }));
  const observations: { heldMs: number; published: number; code: string | null }[] = [];
  for (const heldMs of [0, 101]) {
    body = new Readable({ read() {} });
    body.push(bytes);
    // EOF is delivered by the publisher: the second feature is already available, not a network stall.
    let published = 0;
    const parts = new StreamingPartWriter(async () => {
      published++;
      if (published === 1) {
        assert.equal(body.destroyed, false);
        t.mock.timers.tick(heldMs);
        body.push(null);
      }
    });
    const object = await openObjectStream('test-only/deadline', bytes.length, 100);
    const read = readStreamingFeatures(object.body, 'feature-collection',
      async item => parts.add(sourceRecord(item), 1));
    try {
      if (heldMs) {
        await assert.rejects(read, (error: { status: number; code: string }) => {
          assert.equal(error.status, 503);
          assert.equal(error.code, 'STORAGE_TIMEOUT');
          assert.equal(streamingFailureKind(error), 'retry');
          observations.push({ heldMs, published, code: error.code });
          return true;
        });
      } else {
        assert.equal((await read).features, 2);
        observations.push({ heldMs, published, code: null });
      }
    } finally {
      object.body.destroy();
    }
  }
  t.diagnostic(JSON.stringify({ deadlineMs: 100, observations }));
});
