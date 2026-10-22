/** Offline CW2 comparison, using the same originals and protocol-only mapping as CW1. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import {
  readStreamingFeatures, sourceRecord,
} from '../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import {
  IntakeCellCutter, type IntakeCellCut, type MappedPartFeature,
} from '../../../packages/server/src/modules/usp/ingestion/intake-package-cuts';
import {
  CutExtent, featureExtent, measurableCrs, utmForward, type AreaFrame, type SourceCrs,
} from '../../../packages/server/src/modules/usp/ingestion/intake-package-extent';

function protocolItem(item: Parameters<Parameters<typeof readStreamingFeatures>[2]>[0]): MappedPartFeature | null {
  const raw = sourceRecord(item);
  if (raw.disposition !== 'accepted') return null;
  const mapped = {
    ...raw, disposition: 'observed' as const, issueCodes: [],
    sourceKey: { state: 'known' as const, value: `feature-${item.index}`, sourcePath: '/features/*/id' },
    name: { state: 'unknown' as const, value: null, sourcePath: null },
    geometryRef: {
      rawJobId: '11111111-1111-4111-8111-111111111111', chunkIndex: 0, featureIndex: item.index,
      rawSha256: raw.rawSha256, sourcePath: '/features/*/geometry' as const,
    },
  };
  return { raw, mapped, feature: item.feature as Record<string, unknown> };
}

function firstFrame(cut: IntakeCellCut, crs: SourceCrs): AreaFrame {
  const extents = cut.features.map(item => featureExtent(item.feature, crs)!);
  const west = Math.min(...extents.map(extent => extent.bounds[0]));
  const south = Math.min(...extents.map(extent => extent.bounds[1]));
  const east = Math.max(...extents.map(extent => extent.bounds[2]));
  const north = Math.max(...extents.map(extent => extent.bounds[3]));
  const zone = Math.min(60, Math.floor(((west + east) / 2 + 180) / 6) + 1);
  const epsg = ((south + north) / 2 >= 0 ? 32600 : 32700) + zone;
  const origin: [number, number] = [Infinity, Infinity];
  for (const extent of extents) {
    for (let index = 0; index < extent.geographic.length; index += 2) {
      const point = utmForward(epsg, extent.geographic[index], extent.geographic[index + 1]);
      origin[0] = Math.min(origin[0], point[0]);
      origin[1] = Math.min(origin[1], point[1]);
    }
  }
  return { analysisCrs: `EPSG:${epsg}`, origin };
}

type Measurement = {
  frames: Map<string, AreaFrame>;
  cuts: [number, number[]][];
  held: { featureIndex: number; code: string }[];
  routed: number;
  outside: number;
};

function recordCut(cut: IntakeCellCut, crs: SourceCrs, measured: Measurement) {
  const frame = measured.frames.get(cut.cell.key) ?? firstFrame(cut, crs);
  measured.frames.set(cut.cell.key, frame);
  const extent = new CutExtent(frame);
  for (const item of cut.features) {
    if (!extent.admit(featureExtent(item.feature, crs)!)) measured.outside++;
  }
  measured.routed += cut.features.length;
  measured.cuts.push([cut.index, cut.features.map(item => item.raw.featureIndex)]);
}

function summary(file: string, features: number, measured: Measurement, started: number) {
  const { cuts, held, routed, outside, frames } = measured;
  const heldCounts: Record<string, number> = {};
  for (const item of held) heldCounts[item.code] = (heldCounts[item.code] ?? 0) + 1;
  assert.equal(outside, 0, 'Every cut must fit its own cell area, including its first retained origin');
  const digest = createHash('sha256').update(JSON.stringify({ cuts, held })).digest('hex');
  if (basename(file) === 'buildings-original.geojson') {
    assert.equal(digest, '76e4e298e07b3c51be2d12d80517b97ea36067d145c0a34c8d7767d1a35e766e');
  } else {
    assert.equal(features, 172409);
    assert.equal(routed, 172408);
    assert(cuts.length < 2778, `Expected fewer than 2778 packages, got ${cuts.length}`);
    assert.deepEqual(heldCounts, {});
  }
  return {
    file: basename(file), features, routed, readerNotAccepted: features - routed - held.length,
    packages: cuts.length, packageTargetMet: cuts.length < 2778,
    areas: frames.size, held: heldCounts, outside, digest,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

async function measure(file: string) {
  const started = Date.now();
  const header = await readStreamingFeatures(createReadStream(file), 'feature-collection', async () => {});
  const crs = measurableCrs(header.metadata)!;
  const cutter = new IntakeCellCutter(header.metadata);
  const measured: Measurement = { frames: new Map(), cuts: [], held: [], routed: 0, outside: 0 };
  await readStreamingFeatures(createReadStream(file), 'feature-collection', async item => {
    const mapped = protocolItem(item);
    if (!mapped) return;
    const result = cutter.consume(mapped);
    if (result.cut) recordCut(result.cut, crs, measured);
    if (result.held) measured.held.push(result.held);
  });
  for (let cut = cutter.close(); cut; cut = cutter.close()) recordCut(cut, crs, measured);
  return summary(file, header.features, measured, started);
}

const results = [];
for (const file of process.argv.slice(2)) results.push(await measure(file));
console.log(JSON.stringify(results));
