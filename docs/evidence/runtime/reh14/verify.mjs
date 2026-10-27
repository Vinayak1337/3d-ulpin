import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { save } from './audit.mjs';

// REH8, reused by REH9 and REH10: path, bytes and SHA-256 of each file before it is dropped, against the value already
// recorded in the repository or the receipt beside it (null where none is recorded).
// Usage: node verify.mjs <act> <list.json>
// where the list holds { path, bytes, recordedSha256, recordedIn }; a long path may be given as pieces in order.
const [act, listFile] = process.argv.slice(2);
const { default: list } = await import(`./${listFile}`, { with: { type: 'json' } });
const digest = path => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(path).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')))
    .on('error', reject);
});
const files = [];
for (const listed of list) {
  const entry = { ...listed, path: [listed.path].flat().join('') };
  const bytes = statSync(entry.path).size;
  const sha256 = await digest(entry.path);
  files.push({ ...entry, bytesRead: bytes, sha256, bytesMatch: entry.bytes == null ? null : bytes === entry.bytes,
    sha256Match: entry.recordedSha256 ? sha256 === entry.recordedSha256 : null });
}
save(`act${act}-files.json`, { at: new Date().toISOString(), act: Number(act), files });
console.log(JSON.stringify(files.map(({ path, bytesMatch, sha256Match }) => ({ path, bytesMatch, sha256Match }))));
