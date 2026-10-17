import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/** Bound each read to one part, yielding between slices. The browser runs this inside its hashing worker. */
export async function hashSlices(file: Blob, partBytes: number, progress: (bytes: number) => void) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += partBytes) {
    const bytes = new Uint8Array(await file.slice(offset, offset + partBytes).arrayBuffer());
    hash.update(bytes);
    progress(Math.min(offset + bytes.length, file.size));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return bytesToHex(hash.digest());
}
