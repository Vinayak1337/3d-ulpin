import { createReadStream, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { STREAMING_VECTOR_LIMITS as limits } from '../../../../packages/contracts/src/usp/streaming-vector';
import { readStreamingFeatures, sourceRecord }
  from '../../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';

const files = [
  { name: 'niagara', path: 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
    + 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson' },
  { name: 'halifax', path: 'E:/BhuAayam-data/datasets/map-formats/halifax-regional-municipality/'
    + 'Buildings_4912564227567820355.geojson' },
];
function vertices(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  if (typeof value[0] === 'number') return 1;
  return value.reduce((sum: number, item: unknown) => sum + vertices(item), 0);
}
async function main() {
  const input = files[Number(process.argv[2])];
  const start = performance.now();
  let parts = 0, pendingCount = 0, pendingBytes = 0, accepted = 0, quarantined = 0;
  let cuts = 0, cutCount = 0, cutVertices = 0, cutBytes = 0, held = 0;
  const issues = new Map<string, number>();
  const receipt = await readStreamingFeatures(createReadStream(input.path), 'feature-collection', async item => {
    const record = sourceRecord(item);
    const length = Buffer.byteLength(JSON.stringify(record));
    if (pendingCount && (pendingCount >= limits.chunkFeatures || pendingBytes + length + 2048 > limits.chunkBytes)) {
      parts++;
      pendingCount = 0;
      pendingBytes = 0;
    }
    pendingCount++;
    pendingBytes += length;
    if (record.disposition === 'quarantined') {
      quarantined++;
      issues.set(record.issueCode!, (issues.get(record.issueCode!) ?? 0) + 1);
      return;
    }
    accepted++;
    const count = vertices((item.feature as any).geometry.coordinates);
    if (count > 10000) { held++; return; }
    if (cutCount && (cutCount >= 2000 || cutVertices + count > 100000 || cutBytes + item.raw.length > 16 * 1024 * 1024)) {
      cuts++;
      cutCount = 0;
      cutVertices = 0;
      cutBytes = 0;
    }
    cutCount++;
    cutVertices += count;
    cutBytes += item.raw.length;
  });
  if (pendingCount) parts++;
  if (cutCount) cuts++;
  const result = { ...input, seconds: Number(((performance.now() - start) / 1000).toFixed(3)),
    peakRssKiB: process.resourceUsage().maxRSS, parts, features: receipt.features, accepted, quarantined,
    issues: Object.fromEntries(issues), countOnlyCuts: Math.ceil(accepted / 2000), rawAndVertexCuts: cuts, held,
    sourceBytes: receipt.bytes, sourceSha256: receipt.sha256, metadata: receipt.metadata,
    qualification: 'Pure reader structural/numeric dispositions, no PostGIS topology check or import. '
      + 'Cut measurement uses accepted raw records before layout; serialized-input cut check follows in P3.' };
  writeFileSync(`docs/evidence/gf1/lp3a/measure-${input.name}.json`, JSON.stringify(result) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
