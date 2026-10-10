import { open, readdir } from 'node:fs/promises';
import { createReadStream, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { probeOriginal, intakeWave } from '../../../../packages/server/src/modules/usp/ingestion/intake-probe';

const root = 'E:/BhuAayam-data/datasets/nyc-10013';
async function hash(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function inspect(path: string) {
  const file = await open(path, 'r');
  const size = (await file.stat()).size;
  try {
    const card = await probeOriginal(async (start, end) => {
      const bytes = Buffer.alloc(end - start);
      const result = await file.read(bytes, 0, bytes.length, start);
      return bytes.subarray(0, result.bytesRead);
    }, size, basename(path));
    return { name: basename(path), sizeBytes: size, sha256: await hash(path),
      wave: intakeWave(card), card };
  } finally { await file.close(); }
}

async function main() {
  const pack = await inspect(join(root, 'nyc-10013-multimodal.zip'));
  const files = [];
  for (const name of await readdir(join(root, 'files'))) files.push(await inspect(join(root, 'files', name)));
  const geojson = files.filter(file => file.card.format === 'geojson')
    .sort((left, right) => right.sizeBytes - left.sizeBytes);
  const output = { task: 'IN1', use: 'test_only',
    method: 'Read-only local ranges; no runtime or native reader started.',
    integrity: 'SHA-256 is a separate streaming integrity pass; probe byte/time measures exclude that pass.',
    pack, files, difficult: { selected: geojson[0].name, sha256: geojson[0].sha256,
      reason: 'Listed shapefile ZIP is under task-data, not datasets; no eligible dataset GPKG/shapefile found '
        + 'in catalogue paths. Largest verified public NYC GeoJSON present used as the bounded-read fallback.',
      bytesRead: geojson[0].card.probeBytesRead, below200KiB: geojson[0].card.probeBytesRead < 200 * 1024 } };
  writeFileSync('docs/evidence/gf1/in1/nyc-pack.json', JSON.stringify(output) + '\n');
  console.log(JSON.stringify({ members: pack.card.members.map(member => ({ name: member.name,
    format: member.format, wave: member.card ? intakeWave(member.card) : null })),
    files: files.map(file => ({ name: file.name, format: file.card.format, wave: file.wave,
      bytesRead: file.card.probeBytesRead, ms: file.card.probeMs })), difficult: output.difficult }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
