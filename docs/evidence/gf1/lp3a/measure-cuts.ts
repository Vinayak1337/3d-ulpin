import { createReadStream, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { readStreamingFeatures, sourceRecord }
  from '../../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import { IntakePackageCutter, type IntakePackageCut }
  from '../../../../packages/server/src/modules/usp/ingestion/intake-package-cuts';

const input = 'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/'
  + '5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson';
async function main() {
  // Original's CRS84 declaration is known from DA6; retained as metadata, not projected or rewritten.
  const metadata = { type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } };
  const cutter = new IntakePackageCutter(metadata);
  const cuts: { index: number; features: number; rawBytes: number; vertices: number; serializedInput: number }[] = [];
  const recordCut = (cut: IntakePackageCut | undefined) => {
    if (cut) cuts.push({ index: cut.index, ...cut.cost });
  };
  const issues = new Map<string, number>();
  let accepted = 0, quarantined = 0, unresolved = 0;
  const start = performance.now();
  const receipt = await readStreamingFeatures(createReadStream(input), 'feature-collection', async item => {
    const raw = sourceRecord(item);
    if (raw.disposition !== 'accepted') {
      quarantined++;
      issues.set(raw.issueCode!, (issues.get(raw.issueCode!) ?? 0) + 1);
      return;
    }
    const feature = item.feature as Record<string, any>, key = feature.properties?.doitt_id;
    if (typeof key !== 'string' || !key.length || key.trim() !== key) { unresolved++; return; }
    accepted++;
    const result = cutter.consume({ raw, feature, mapped: { featureIndex: raw.featureIndex,
      byteStart: raw.byteStart, byteEnd: raw.byteEnd, rawSha256: raw.rawSha256, disposition: 'observed',
      sourceKey: { state: 'known', value: key, sourcePath: '/features/*/properties/doitt_id' },
      name: { state: 'unknown', value: null, sourcePath: null }, issueCodes: [], geometryRef: {
        // Measurement-only protocol pin; no job, mapped record or package is persisted.
        rawJobId: '00000000-0000-4000-8000-000000000000', chunkIndex: Math.floor(raw.featureIndex / 100),
        featureIndex: raw.featureIndex, rawSha256: raw.rawSha256, sourcePath: '/features/*/geometry',
      } } });
    recordCut(result.cut);
    if (result.held) issues.set(result.held.code, (issues.get(result.held.code) ?? 0) + 1);
  });
  recordCut(cutter.close());
  const result = { input, bytes: receipt.bytes, sha256: receipt.sha256, metadata: receipt.metadata,
    features: receipt.features, structuralAccepted: accepted, quarantined, unresolved,
    issues: Object.fromEntries(issues),
    seconds: Number(((performance.now() - start) / 1000).toFixed(3)), peakRssKiB: process.resourceUsage().maxRSS,
    rawCountParts: Math.ceil(receipt.features / 100), countCuts: Math.ceil(accepted / 2000), cuts,
    qualification: 'Pure-reader/cutter measurement before topology and approved mapping. '
      + 'Actual doitt_id attributes read, harness chooses identifier path. No officer approval or admission implied.' };
  const target = process.argv[2];
  if (!target) throw new Error('Supply a new evidence path.');
  writeFileSync(target, JSON.stringify(result) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
