import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { readObjectRange, closeStorageClient } from '../packages/server/src/infrastructure/storage';

const requireServer = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { S3Client } = requireServer('@aws-sdk/client-s3');

test('ranges allow large originals but refuse fallback, corrupt metadata and excess bytes', async () => {
  // Protocol-only S3 transport; no listener, network request or real storage credential is used.
  const names = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
  const values = names.map(name => process.env[name]);
  process.env.S3_ENDPOINT = 'http://127.0.0.1:1';
  process.env.S3_ACCESS_KEY = process.env.S3_SECRET_KEY = 'protocol-only-control';
  const previous = S3Client.prototype.send;
  let status = 206;
  let contentRange = 'bytes 10-13/100';
  let payload = Buffer.from('head');
  S3Client.prototype.send = async (command: any) => {
    assert.equal(command.input.Range, 'bytes=10-13');
    assert.equal(command.input.Key, 'large-originals/control');
    return { $metadata: { httpStatusCode: status }, ContentRange: contentRange,
      ContentLength: 4, Body: Readable.from([payload]) };
  };
  const read = () => readObjectRange('large-originals/control', 10, 14, 100, Date.now() + 1000,
    new AbortController().signal);
  try {
    assert.deepEqual(await read(), Buffer.from('head'));
    status = 200;
    await assert.rejects(read(), (error: any) => error.code === 'SOURCE_INTEGRITY');
    status = 206;
    contentRange = 'bytes 10-13/101';
    await assert.rejects(read(), (error: any) => error.code === 'SOURCE_INTEGRITY');
    contentRange = 'bytes 10-13/100';
    payload = Buffer.from('whole original refused');
    await assert.rejects(read(), (error: any) => error.code === 'SOURCE_INTEGRITY');
    await assert.rejects(readObjectRange('large-originals/control', 0, 1024 * 1024 + 1,
      1024 * 1024 + 1, Date.now() + 1000, new AbortController().signal),
    (error: any) => error.code === 'STORAGE_READ_BOUNDS');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(readObjectRange('large-originals/control', 10, 14, 100, Date.now() + 1000,
      controller.signal), (error: any) => error.code === 'STORAGE_TIMEOUT');
  } finally {
    S3Client.prototype.send = previous;
    closeStorageClient();
    names.forEach((name, index) => {
      if (values[index] === undefined) delete process.env[name];
      else process.env[name] = values[index];
    });
  }
});
