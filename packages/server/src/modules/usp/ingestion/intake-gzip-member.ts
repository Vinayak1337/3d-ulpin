import { createHash } from 'node:crypto';
import { Readable, pipeline } from 'node:stream';
import { createGunzip, crc32 } from 'node:zlib';
import { INTAKE_PROBE_LIMITS, LARGE_ORIGINAL_V2_LIMITS } from '@ulpin/contracts/usp';
import type { IntakeRangeReader } from './intake-zip';

// The byte transport can retain a gzip member up to the v2 ceiling; its reader applies its own drawing bound.
export const GZIP_MEMBER_LIMITS = Object.freeze({ bytes: LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes,
  ratio: INTAKE_PROBE_LIMITS.compressionRatio, rangeBytes: 1024 * 1024 });

export class GzipMemberError extends Error {
  constructor(readonly code: string, words: string) { super(`${code}: ${words}`); }
}

/** The upload's basename, not the optional and untrusted filename in the gzip header. */
export function gzipMemberName(name: string): string {
  return name.replace(/\.(?:gz|gzip)$/i, '') || 'member';
}

/** Gunzip joins concatenated streams; CRC and length trailers are checked before the stream ends. */
export async function* streamGzipMember(read: IntakeRangeReader, compressedBytes: number,
  maxBytes: number = GZIP_MEMBER_LIMITS.bytes) {
  const compressed = Readable.from((async function* () {
    for (let at = 0; at < compressedBytes; at += GZIP_MEMBER_LIMITS.rangeBytes) {
      yield await read(at, Math.min(compressedBytes, at + GZIP_MEMBER_LIMITS.rangeBytes));
    }
  })(), { objectMode: false });
  const chunks = pipeline(compressed, createGunzip(), () => {});
  let bytes = 0;
  try {
    for await (const chunk of chunks as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new GzipMemberError('GZIP_SIZE_LIMIT',
        `decompressed ${bytes} bytes exceeds the ${maxBytes}-byte derived-original ceiling; file kept, not read.`);
      if (bytes > compressedBytes * GZIP_MEMBER_LIMITS.ratio) throw new GzipMemberError('GZIP_RATIO_LIMIT',
        `decompressed ${bytes} bytes exceeds ${GZIP_MEMBER_LIMITS.ratio}:1 for ${compressedBytes} compressed `
          + `bytes (${compressedBytes * GZIP_MEMBER_LIMITS.ratio}-byte bound); file kept, not read.`);
      yield chunk;
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('Z_')) throw new GzipMemberError('GZIP_MEMBER_INTEGRITY',
      'the gzip stream is corrupt or incomplete (header, data, CRC or length check failed); file kept, not read.');
    throw error;
  } finally {
    chunks.destroy();
    compressed.destroy();
  }
}

/** First pass verifies every trailer and both bounds before admitting any receipt or retaining a child. */
export async function inspectGzipMember(read: IntakeRangeReader, compressedBytes: number) {
  const hash = createHash('sha256');
  let bytes = 0;
  let crc = 0;
  for await (const chunk of streamGzipMember(read, compressedBytes)) {
    bytes += chunk.length;
    crc = crc32(chunk, crc);
    hash.update(chunk);
  }
  if (!bytes) throw new GzipMemberError('GZIP_EMPTY_MEMBER',
    'the empty stream stays in the gzip original; the derived-original receipt accepts nonempty files only.');
  return { bytes, sha256: hash.digest('hex'), crc32: crc };
}
