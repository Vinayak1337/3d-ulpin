/** CW1 evidence: how a real GeoJSON is cut by size alone (before) and by size and the map-area rule (after).
 * Nothing is placed or stored; mapped records are protocol stand-ins built from the reader's own records.
 * Run: npx tsx --tsconfig apps/api/tsconfig.json docs/evidence/cw1/wide-files.ts <file.geojson>... */
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { readStreamingFeatures, sourceRecord
} from '../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import { IntakePackageCutter, type HeldPartFeature, type IntakePackageCut, type MappedPartFeature
} from '../../../packages/server/src/modules/usp/ingestion/intake-package-cuts';
import { CutExtent, featureExtent, measurableCrs, utmForward, type AreaFrame, type Bounds
} from '../../../packages/server/src/modules/usp/ingestion/intake-package-extent';

type Summary = { features: number; degrees: number; km: number; zone: number; takenAsNewArea: boolean };

function protocolItem(item: Parameters<Parameters<typeof readStreamingFeatures>[2]>[0]): MappedPartFeature | null {
  const raw = sourceRecord(item);
  if (raw.disposition !== 'accepted') return null;
  const mapped = { ...raw, disposition: 'observed' as const, issueCodes: [],
    sourceKey: { state: 'known' as const, value: `feature-${item.index}`, sourcePath: '/features/*/id' },
    name: { state: 'unknown' as const, value: null, sourcePath: null },
    geometryRef: { rawJobId: '11111111-1111-4111-8111-111111111111', chunkIndex: 0, featureIndex: item.index,
      rawSha256: raw.rawSha256, sourcePath: '/features/*/geometry' as const } };
  return { raw, mapped, feature: item.feature as Record<string, unknown> };
}

/** The cut's degree span and its span in the UTM zone of its middle, as area.py measures a new area's package. */
function summary(cut: IntakePackageCut, metadata: Record<string, unknown>): Summary {
  const crs = measurableCrs(metadata)!;
  const extents = cut.features.map(item => featureExtent(item.feature, crs)!);
  const geo = extents.reduce<Bounds>((sum, item) => [Math.min(sum[0], item.bounds[0]),
    Math.min(sum[1], item.bounds[1]), Math.max(sum[2], item.bounds[2]), Math.max(sum[3], item.bounds[3])],
  [Infinity, Infinity, -Infinity, -Infinity]);
  const zone = 32600 + Math.floor(((geo[0] + geo[2]) / 2 + 180) / 6) + 1;
  const metres = extents.flatMap(item => Array.from({ length: item.geographic.length / 2 },
    (_, index) => utmForward(zone, item.geographic[2 * index], item.geographic[2 * index + 1])));
  const span = (axis: 0 | 1) =>
    Math.max(...metres.map(point => point[axis])) - Math.min(...metres.map(point => point[axis]));
  const fresh = new CutExtent(null);
  return { features: cut.features.length, degrees: Number(Math.max(geo[2] - geo[0], geo[3] - geo[1]).toFixed(4)),
    km: Number((Math.max(span(0), span(1)) / 1000).toFixed(2)), zone,
    takenAsNewArea: extents.every(extent => fresh.admit(extent)) };
}

async function fold(file: string, metadata: Record<string, unknown>, frame: AreaFrame | null,
  resume?: { index: number; previous: number }) {
  const cutter = new IntakePackageCutter(metadata, resume, frame);
  const cuts: IntakePackageCut[] = [], held: HeldPartFeature[] = [];
  await readStreamingFeatures(createReadStream(file), 'feature-collection', async item => {
    const mapped = protocolItem(item);
    if (!mapped || mapped.raw.featureIndex <= (resume?.previous ?? -1)) return;
    const result = cutter.consume(mapped);
    if (result.cut) cuts.push(result.cut);
    if (result.held) held.push(result.held);
  });
  const last = cutter.close();
  if (last) cuts.push(last);
  return { cuts, held };
}

const heldCounts = (held: HeldPartFeature[]) =>
  held.reduce<Record<string, number>>((sum, item) => ({ ...sum, [item.code]: (sum[item.code] ?? 0) + 1 }), {});

async function measure(file: string) {
  const started = Date.now();
  const read = await readStreamingFeatures(createReadStream(file), 'feature-collection', async () => {});
  const metadata = { ...read.metadata };
  // A reference this module does not project into turns the area rule off: the cuts the size bounds alone make.
  const sizeOnly = await fold(file, metadata, { analysisCrs: 'EPSG:6933', origin: [0, 0] });
  const sized = sizeOnly.cuts.map(cut => summary(cut, metadata));
  const newArea = await fold(file, metadata, null);
  const first = summary(newArea.cuts[0], metadata);
  const crs = measurableCrs(metadata)!;
  const corner = newArea.cuts[0].features.flatMap(item => featureExtent(item.feature, crs)!.geographic);
  const points = Array.from({ length: corner.length / 2 }, (_, index) => utmForward(first.zone, corner[2 * index],
    corner[2 * index + 1]));
  // The origin area.py stores for that first package when every feature in it is accepted: its south-west corner.
  const frame: AreaFrame = { analysisCrs: `EPSG:${first.zone}`,
    origin: [Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1]))] };
  const rest = await fold(file, metadata, frame,
    { index: 1, previous: newArea.cuts[0].features.at(-1)!.raw.featureIndex });
  const restSummaries = rest.cuts.map(cut => summary(cut, metadata));
  return { file: basename(file), crs: (metadata.crs as { properties?: { name?: string } })?.properties?.name ?? null,
    features: read.features,
    before: { cuts: sized.length, refusedByAreaRule: sized.filter(cut => !cut.takenAsNewArea).length,
      firstRefusedCut: sized.findIndex(cut => !cut.takenAsNewArea), widestKm: Math.max(...sized.map(cut => cut.km)) },
    afterAsNewArea: { cuts: newArea.cuts.length, held: heldCounts(newArea.held),
      allTakenAsNewArea: newArea.cuts.every(cut => summary(cut, metadata).takenAsNewArea),
      widestKm: Math.max(...newArea.cuts.map(cut => summary(cut, metadata).km)) },
    afterInFirstCutArea: { frame: { analysisCrs: frame.analysisCrs }, cuts: 1 + rest.cuts.length,
      placed: newArea.cuts[0].features.length + rest.cuts.reduce((sum, cut) => sum + cut.features.length, 0),
      held: heldCounts(rest.held), widestKm: Math.max(first.km, ...restSummaries.map(cut => cut.km)) },
    seconds: Math.round((Date.now() - started) / 1000) };
}

const results = [];
for (const file of process.argv.slice(2)) results.push(await measure(file));
console.log(JSON.stringify(results));
