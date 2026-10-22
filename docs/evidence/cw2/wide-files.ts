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

async function measure(file: string) {
  const started = Date.now();
  const header = await readStreamingFeatures(createReadStream(file), 'feature-collection', async () => {});
  const crs = measurableCrs(header.metadata)!;
  const cutter = new IntakeCellCutter(header.metadata);
  const frames = new Map<string, AreaFrame>();
  const digestCuts: [number, number[]][] = [];
  const held: { featureIndex: number; code: string }[] = [];
  let placed = 0;
  let outside = 0;
  const check = (cut: IntakeCellCut) => {
    const frame = frames.get(cut.cell.key) ?? firstFrame(cut, crs);
    frames.set(cut.cell.key, frame);
    const extent = new CutExtent(frame);
    for (const item of cut.features) {
      if (!extent.admit(featureExtent(item.feature, crs)!)) outside++;
    }
    placed += cut.features.length;
    digestCuts.push([cut.index, cut.features.map(item => item.raw.featureIndex)]);
  };
  await readStreamingFeatures(createReadStream(file), 'feature-collection', async item => {
    const mapped = protocolItem(item);
    if (!mapped) return;
    const result = cutter.consume(mapped);
    if (result.cut) check(result.cut);
    if (result.held) held.push(result.held);
  });
  for (let cut = cutter.close(); cut; cut = cutter.close()) check(cut);
  const heldCounts: Record<string, number> = {};
  for (const item of held) heldCounts[item.code] = (heldCounts[item.code] ?? 0) + 1;
  assert.equal(outside, 0, 'Every cut must fit its own cell area, including its first retained origin');
  const digest = createHash('sha256').update(JSON.stringify({ cuts: digestCuts, held })).digest('hex');
  if (basename(file) === 'buildings-original.geojson') {
    assert.equal(digest, '76e4e298e07b3c51be2d12d80517b97ea36067d145c0a34c8d7767d1a35e766e');
  } else {
    assert.equal(header.features, 172409);
    assert.equal(placed, 172408);
    assert(digestCuts.length < 2778, `Expected fewer than 2778 packages, got ${digestCuts.length}`);
    assert.deepEqual(heldCounts, {});
  }
  return {
    file: basename(file), features: header.features, routed: placed,
    readerNotAccepted: header.features - placed - held.length,
    packages: digestCuts.length, packageTargetMet: digestCuts.length < 2778,
    areas: frames.size, held: heldCounts, outside, digest,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

const results = [];
for (const file of process.argv.slice(2)) results.push(await measure(file));
console.log(JSON.stringify(results));
