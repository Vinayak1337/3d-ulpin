/** Offline, foreign test_only protocol count. No normalizer, runtime, placement or registry write.
 * Run with tsx --tsconfig apps/api/tsconfig.json and the NYC then Halifax original paths. */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { CellFileCollector, cellFileChunks
} from '../../../packages/server/src/modules/usp/ingestion/intake-cell-files';
import { IntakePackageCutter, type IntakePackageCut, type MappedPartFeature
} from '../../../packages/server/src/modules/usp/ingestion/intake-package-cuts';
import { featureExtent, measurableCrs, utmForward, type AreaFrame, type Bounds
} from '../../../packages/server/src/modules/usp/ingestion/intake-package-extent';
import { readStreamingFeatures, sourceRecord, type SourceFeature
} from '../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';

function protocolItem(item: SourceFeature): MappedPartFeature | null {
  const raw = sourceRecord(item);
  if (raw.disposition !== 'accepted') return null;
  return { raw, feature: raw.feature as Record<string, unknown>, mapped: {
    ...raw, disposition: 'observed', issueCodes: [],
    sourceKey: { state: 'known', value: `feature-${item.index}`, sourcePath: '/features/*/id' },
    name: { state: 'unknown', value: null, sourcePath: null },
    geometryRef: { rawJobId: '11111111-1111-4111-8111-111111111111', chunkIndex: 0,
      featureIndex: item.index, rawSha256: raw.rawSha256, sourcePath: '/features/*/geometry' } } };
}

function frameFor(cut: IntakePackageCut, metadata: Record<string, unknown>): AreaFrame {
  const crs = measurableCrs(metadata)!;
  const extents = cut.features.map(item => featureExtent(item.feature, crs)!);
  const bounds = extents.reduce<Bounds>((sum, item) => [Math.min(sum[0], item.bounds[0]),
    Math.min(sum[1], item.bounds[1]), Math.max(sum[2], item.bounds[2]), Math.max(sum[3], item.bounds[3])],
  [Infinity, Infinity, -Infinity, -Infinity]);
  const zone = Math.min(60, Math.floor(((bounds[0] + bounds[2]) / 2 + 180) / 6) + 1);
  const epsg = ((bounds[1] + bounds[3]) / 2 >= 0 ? 32600 : 32700) + zone;
  let x = Infinity, y = Infinity;
  for (const extent of extents) {
    for (let index = 0; index < extent.geographic.length; index += 2) {
      const point = utmForward(epsg, extent.geographic[index], extent.geographic[index + 1]);
      x = Math.min(x, point[0]);
      y = Math.min(y, point[1]);
    }
  }
  return { analysisCrs: `EPSG:${epsg}`, origin: [x, y] };
}

/** Switch at the first cut to the reference the real first package retains, replaying its triggering feature. */
async function fold(body: Readable, metadata: Record<string, unknown>, collector?: CellFileCollector,
  expected?: readonly { rawSha256: string }[]) {
  let cutter = new IntakePackageCutter(metadata), frame: AreaFrame | null = null;
  let placed = 0, packages = 0, rejected = 0, checked = 0;
  const held: Record<string, number> = {};
  const take = (cut: IntakePackageCut | undefined) => {
    if (!cut) return;
    placed += cut.features.length;
    packages++;
  };
  const receipt = await readStreamingFeatures(body, 'feature-collection', async item => {
    const mapped = protocolItem(item);
    if (expected) assert.equal(sourceRecord(item).rawSha256, expected[checked++].rawSha256);
    if (!mapped) {
      rejected++;
      return;
    }
    let result = cutter.consume(mapped);
    if (result.cut && !frame) {
      frame = frameFor(result.cut, metadata);
      take(result.cut);
      cutter = new IntakePackageCutter(metadata,
        { index: 1, previous: result.cut.features.at(-1)!.raw.featureIndex }, frame);
      result = cutter.consume(mapped);
    }
    take(result.cut);
    if (result.held) {
      held[result.held.code] = (held[result.held.code] ?? 0) + 1;
      if (result.held.code === 'PART_FEATURE_AREA_BOUND' && collector) {
        const { featureIndex, byteStart, byteEnd, rawSha256 } = mapped.raw;
        collector.add(mapped.feature, { featureIndex, byteStart, byteEnd, rawSha256 });
      }
    }
  });
  take(cutter.close());
  if (expected) assert.equal(checked, expected.length);
  return { features: receipt.features, sha256: receipt.sha256, placed, packages, rejected, held };
}

async function measure(file: string) {
  const started = Date.now();
  const receipt = await readStreamingFeatures(createReadStream(file), 'feature-collection', async () => {});
  const collector = new CellFileCollector(receipt.metadata);
  const parent = await fold(createReadStream(file), receipt.metadata, collector);
  const handle = await open(file, 'r');
  const children = [];
  try {
    const read = async (start: number, end: number) => {
      const buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      assert.equal(bytesRead, buffer.length);
      return buffer;
    };
    for (const cell of collector.cells.values()) {
      const child = await fold(Readable.from(cellFileChunks(cell, receipt.metadata, read)), receipt.metadata,
        undefined, cell.ranges);
      assert.equal(child.rejected, 0);
      assert.equal(child.placed, cell.ranges.length);
      assert.deepEqual(child.held, {});
      children.push({ key: cell.key, features: child.features, sha256: child.sha256, packages: child.packages });
    }
  } finally {
    await handle.close();
  }
  const derived = children.reduce((sum, child) => sum + child.features, 0);
  const stillHeld = Object.entries(parent.held).filter(([code]) => code !== 'PART_FEATURE_AREA_BOUND')
    .reduce((sum, [, count]) => sum + count, collector.heldFeatures);
  const lost = parent.features - parent.placed - derived - parent.rejected - stillHeld;
  assert.equal(lost, 0);
  if (basename(file) === 'buildings-original.geojson') assert.equal(children.length, 0);
  return { file: basename(file), use: 'foreign test_only; nothing placed', features: parent.features,
    sha256: parent.sha256, parentCandidates: parent.placed, parentPackages: parent.packages,
    readerRejected: parent.rejected, children, childCount: children.length, derived, stillHeld, lost,
    exactFeatureHashesChecked: derived, childOutsideHolds: 0, seconds: Math.round((Date.now() - started) / 1000) };
}

const results = [];
for (const file of process.argv.slice(2)) results.push(await measure(file));
console.log(JSON.stringify(results));
