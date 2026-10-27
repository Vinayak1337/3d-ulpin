import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { LARGE_ORIGINAL_V2_LIMITS, INTAKE_PROBE_LIMITS } from '@ulpin/contracts/usp';
import { GZIP_MEMBER_LIMITS, GzipMemberError, gzipMemberName, streamGzipMember } from './intake-gzip-member';

async function drain(pack: Uint8Array, maxBytes?: number) {
  const chunks: Uint8Array[] = [];
  const read = async (start: number, end: number) => pack.subarray(start, end);
  for await (const chunk of streamGzipMember(read, pack.length, maxBytes)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('gzip uses the derived receipt ceiling and stops before yielding bytes past it', async () => {
  assert.equal(GZIP_MEMBER_LIMITS.bytes, LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes);
  assert.equal(GZIP_MEMBER_LIMITS.ratio, INTAKE_PROBE_LIMITS.compressionRatio);
  const bytes = Buffer.alloc(32_768);
  const pack = gzipSync(bytes, { level: 0 });
  assert.deepEqual(await drain(pack, bytes.length), bytes, 'the ceiling itself is admitted');
  await assert.rejects(drain(pack, bytes.length - 1), error => {
    assert.ok(error instanceof GzipMemberError);
    assert.equal(error.code, 'GZIP_SIZE_LIMIT');
    assert.match(error.message, /decompressed 32768 bytes exceeds the 32767-byte derived-original ceiling/);
    return true;
  });
});

test('gzip reads compressed input in ranges of at most one MiB', async () => {
  const bytes = Buffer.alloc(2 * GZIP_MEMBER_LIMITS.rangeBytes + 17);
  const pack = gzipSync(bytes, { level: 0 });
  let widest = 0;
  let expanded = 0;
  for await (const chunk of streamGzipMember(async (start, end) => {
    widest = Math.max(widest, end - start);
    return pack.subarray(start, end);
  }, pack.length)) expanded += chunk.length;
  assert.equal(widest, GZIP_MEMBER_LIMITS.rangeBytes);
  assert.equal(expanded, bytes.length);
});

test('gzip stops at a bounded byte ceiling across concatenated streams, before retaining any excess', async () => {
  const maxBytes = 2 * 1024 ** 2;
  const oneMiB = gzipSync(Buffer.alloc(1024 ** 2), { level: 0 });
  const compressedBytes = oneMiB.length * (maxBytes / 1024 ** 2 + 1);
  let yielded = 0;
  const read = async (start: number, end: number) => {
    const range = Buffer.alloc(end - start);
    for (let at = start; at < end;) {
      const offset = at % oneMiB.length;
      const take = Math.min(oneMiB.length - offset, end - at);
      range.set(oneMiB.subarray(offset, offset + take), at - start);
      at += take;
    }
    return range;
  };
  await assert.rejects(async () => {
    for await (const chunk of streamGzipMember(read, compressedBytes, maxBytes)) yielded += chunk.length;
  }, error => error instanceof GzipMemberError && error.code === 'GZIP_SIZE_LIMIT'
    && error.message.includes(`${maxBytes}-byte`));
  assert.ok(yielded <= maxBytes);
});

test('gzip preserves storage failures rather than misreporting corrupt source bytes', async () => {
  const error = new Error('storage unavailable');
  await assert.rejects(async () => {
    for await (const _chunk of streamGzipMember(async () => { throw error; }, 100));
  }, value => value === error);
  assert.equal(gzipMemberName('map.geojson.gz.gzip'), 'map.geojson.gz');
  assert.equal(gzipMemberName('map.GZ'), 'map');
  assert.equal(gzipMemberName('no-suffix'), 'no-suffix');
});
