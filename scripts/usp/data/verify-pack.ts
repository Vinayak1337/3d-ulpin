import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUsp, UspDataPackSchema } from '../../../packages/contracts/src/usp/index';

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_PACK_BYTES = 128 * 1024 * 1024;
/** Offline verifier for a controlled checkout. No fetching, model calls, DB writes or stage promotion. */
export async function verifyUspPack(manifestPath: string) {
  const absolute = path.resolve(manifestPath);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) throw new Error('Invalid manifest file or size');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  const chunks: Buffer[] = []; let manifestBytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      manifestBytes += chunk.length;
      if (manifestBytes > MAX_MANIFEST_BYTES) throw new Error('Manifest exceeds byte limit');
      chunks.push(Buffer.from(chunk));
    }
  } finally { await handle.close(); }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  const manifest = parseUsp(UspDataPackSchema, JSON.parse(raw));
  const root = await realpath(path.dirname(absolute));
  const checked: { id: string; sha256: string; bytes: number }[] = [];
  const unavailable: { id: string; reason: string }[] = [];
  let total = 0;
  for (const asset of manifest.assets) {
    if (asset.content.state === 'unavailable') { unavailable.push({ id: asset.id, reason: asset.content.reason }); continue; }
    let candidate = root;
    for (const component of asset.content.path.split('/')) {
      candidate = path.join(candidate, component);
      if ((await lstat(candidate)).isSymbolicLink()) throw new Error(`Symlink is not a pack asset: ${asset.id}`);
    }
    const actual = await realpath(candidate);
    const relative = path.relative(root, actual);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Asset escaped pack root');
    const file = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== asset.content.bytes || stat.size + total > MAX_PACK_BYTES) throw new Error(`Asset size/budget mismatch: ${asset.id}`);
      const hash = createHash('sha256'); let received = 0;
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        received += chunk.length;
        if (received > asset.content.bytes || total + received > MAX_PACK_BYTES) throw new Error('Asset grew beyond declared bound');
        hash.update(chunk);
      }
      const digest = hash.digest('hex');
      if (received !== asset.content.bytes || digest !== asset.content.sha256) throw new Error(`Asset hash mismatch: ${asset.id}`);
      total += received; checked.push({ id: asset.id, sha256: digest, bytes: received });
    } finally { await file.close(); }
  }
  return { schemaVersion: 'usp-pack-byte-check/1', packId: manifest.packId, profile: manifest.profile,
    checked, unavailable, totalBytes: total,
    qualification: 'Declared available bytes verified only; no parsing, rendering, permission or workflow qualification.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) { console.error('Usage: tsx scripts/usp/data/verify-pack.ts <manifest.json>'); process.exitCode = 2; }
  else verifyUspPack(args[0]).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Pack verification failed'); process.exitCode = 1; });
}
