import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { probeOriginal } from '../../../../packages/server/src/modules/usp/ingestion/intake-probe';

const inputs = [
  'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson',
  'E:/BhuAayam-data/datasets/nyc-10013/nyc-10013-multimodal.zip',
];
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function probe(path: string) {
  const before = sha256(path);
  const descriptor = openSync(path, 'r');
  try {
    const read = async (start: number, end: number) => {
      const bytes = Buffer.alloc(end - start);
      assert.equal(readSync(descriptor, bytes, 0, bytes.length, start), bytes.length);
      return bytes;
    };
    const card = await probeOriginal(read, statSync(path).size, path.split('/').at(-1)!);
    assert.equal(sha256(path), before);
    if (path.endsWith('.zip')) {
      assert.equal(card.format, 'zip');
      assert.equal(card.family, 'archive');
      assert(!card.members.some(member => member.format === 'shapefile'));
    } else {
      assert.equal(card.format, 'geojson');
      assert.equal(card.family, 'vector');
      assert.equal(card.counts.features, null, 'Header probing must not invent a whole-file count.');
    }
    return { path, bytes: statSync(path).size, sha256: before, originalHashUnchanged: true,
      family: card.family, format: card.format, depth: card.depth, crs: card.crs, counts: card.counts,
      extent: card.extent, limits: card.limits, probeBytesRead: card.probeBytesRead, probeMs: card.probeMs,
      members: card.members.map(member => ({ name: member.name, format: member.format,
        family: member.family, refusalCode: member.refusalCode })) };
  } finally {
    closeSync(descriptor);
  }
}

async function main() {
  const results = [];
  for (const input of inputs) results.push(await probe(input));
  console.log(JSON.stringify({ task: 'CA7', operation: 'Actual product header probe on immutable originals',
    results, scope: 'No retention receipt, recipe, import, SQL, review envelope or binary format fabricated.' }));
}

await main();
