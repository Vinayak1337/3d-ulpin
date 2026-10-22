import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { cutMappedFeatures, INTAKE_PACKAGE_LIMITS, IntakePackageCutter, normalizerInputUpperBound,
  IntakeCellCutter, INTAKE_OPEN_CELL_LIMIT, type CellCutResume, type IntakeCellCut,
  type MappedPartFeature } from './intake-package-cuts';
import { AREA_NORMALIZER_EXTENT, utmForward, type AreaFrame } from './intake-package-extent';

/** Protocol-only feature; never persisted, displayed or treated as an operational record. */
function protocolItem(index: number, positions = 5, rawBytes = 100): MappedPartFeature {
  const feature = { type: 'Feature', properties: { key: `protocol-${index}` },
    geometry: { type: 'Polygon', coordinates: [Array.from({ length: positions }, () => [1, 2])] } };
  const raw = { featureIndex: index, byteStart: index * rawBytes, byteEnd: (index + 1) * rawBytes,
    rawSha256: 'a'.repeat(64), disposition: 'accepted' as const, issueCode: null, feature };
  const mapped = { ...raw, disposition: 'observed' as const,
    sourceKey: { state: 'known' as const, value: `protocol-${index}`, sourcePath: '/features/*/properties/key' },
    name: { state: 'unknown' as const, value: null, sourcePath: null }, issueCodes: [], geometryRef: {
      rawJobId: '11111111-1111-4111-8111-111111111111', chunkIndex: 0, featureIndex: index,
      rawSha256: raw.rawSha256, sourcePath: '/features/*/geometry' as const,
    } };
  return { raw, mapped, feature };
}

/** A protocol square of `side` degrees with its south-west corner at a test position; never a record. */
function placedItem(index: number, [x, y]: [number, number], side = 0.0001): MappedPartFeature {
  const item = protocolItem(index);
  item.feature.geometry = { type: 'Polygon',
    coordinates: [[[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]] };
  return item;
}

/** Test positions only: HERE, about 29 km west of NEAR and 25 km east of WEST; FAR about 200 km north of HERE. */
const HERE: [number, number] = [77.0, 28.0], NEAR: [number, number] = [77.3, 28.0];
const WEST: [number, number] = [76.75, 28.0], FAR: [number, number] = [77.0, 29.8];

/** Independent of the cutter: the cut's degree span and its span in the UTM zone of its middle. */
function cutSpan(cut: { features: MappedPartFeature[] }) {
  const corners = cut.features.flatMap(item =>
    ((item.feature.geometry as { coordinates: number[][][] }).coordinates[0]));
  const longitudes = corners.map(corner => corner[0]), latitudes = corners.map(corner => corner[1]);
  const middle = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
  const zone = 32600 + Math.floor((middle + 180) / 6) + 1;
  const metres = corners.map(corner => utmForward(zone, corner[0], corner[1]));
  return { degrees: Math.max(Math.max(...longitudes) - Math.min(...longitudes),
    Math.max(...latitudes) - Math.min(...latitudes)),
  metres: Math.max(Math.max(...metres.map(point => point[0])) - Math.min(...metres.map(point => point[0])),
    Math.max(...metres.map(point => point[1])) - Math.min(...metres.map(point => point[1]))) };
}

const indexes = (cuts: { features: MappedPartFeature[] }[]) =>
  cuts.map(cut => cut.features.map(item => item.raw.featureIndex));

test('a file alternating between two places 200 km apart is cut so every package is one bounded area', () => {
  const items = Array.from({ length: 40 }, (_, index) => placedItem(index, index % 2 ? FAR : HERE));
  const result = cutMappedFeatures(items);
  assert.deepEqual(result.held, []);
  assert.deepEqual(indexes(result.cuts).flat(), items.map(item => item.raw.featureIndex));
  for (const cut of result.cuts) {
    const span = cutSpan(cut);
    assert(span.degrees <= AREA_NORMALIZER_EXTENT.degrees && span.metres <= AREA_NORMALIZER_EXTENT.metres);
  }
});

test('in an area with a reference, features beyond 50 km of its origin are held and the rest cut together', () => {
  const frame: AreaFrame = { analysisCrs: 'EPSG:32643', origin: utmForward(32643, ...HERE) };
  const items = Array.from({ length: 40 }, (_, index) => placedItem(index, index % 2 ? FAR : HERE));
  const result = cutMappedFeatures(items, {}, frame);
  const here = items.filter((_, index) => index % 2 === 0);
  assert.deepEqual(indexes(result.cuts), [here.map(item => item.raw.featureIndex)]);
  assert.deepEqual(result.held, items.filter((_, index) => index % 2)
    .map(item => ({ featureIndex: item.raw.featureIndex, code: 'PART_FEATURE_AREA_BOUND' })));
});

test('a single feature wider than one map area is held with its own reason and never split', () => {
  const wide = placedItem(1, HERE, 0.6);
  const before = JSON.stringify(wide.feature);
  const result = cutMappedFeatures([placedItem(0, HERE), wide, placedItem(2, NEAR)]);
  assert.deepEqual(indexes(result.cuts), [[0, 2]]);
  assert.deepEqual(result.held, [{ featureIndex: 1, code: 'PART_FEATURE_EXTENT_BOUND' }]);
  assert.equal(JSON.stringify(wide.feature), before);
});

test('cuts close at feature, raw-byte, vertex and serialized-input bounds with no empty package', () => {
  assert.deepEqual(cutMappedFeatures([]), { cuts: [], held: [] });
  const count = cutMappedFeatures(Array.from({ length: 2001 }, (_, index) => protocolItem(index)));
  assert.deepEqual(count.cuts.map(cut => cut.cost.features), [2000, 1]);
  const bytes = cutMappedFeatures(Array.from({ length: 17 }, (_, index) => protocolItem(index, 5, 1024 * 1024)));
  assert.deepEqual(bytes.cuts.map(cut => cut.cost.features), [16, 1]);
  const vertices = cutMappedFeatures(Array.from({ length: 11 }, (_, index) => protocolItem(index, 10000)));
  assert.deepEqual(vertices.cuts.map(cut => cut.cost.features), [10, 1]);
  const unicode = Array.from({ length: 5 }, (_, index) => protocolItem(index));
  for (const item of unicode) item.feature.properties = { text: 'अ'.repeat(900000) };
  const serialized = cutMappedFeatures(unicode);
  assert.deepEqual(serialized.cuts.map(cut => cut.cost.features), [3, 2]);
  assert(serialized.cuts.every(cut => cut.cost.serializedInput <= INTAKE_PACKAGE_LIMITS.serializedInput));
});

test('unadmittable single feature held; unresolved skipped; no simplification; order and pairing refused', () => {
  const held = protocolItem(1, 10001);
  const unknown = protocolItem(2);
  unknown.mapped.disposition = 'unresolved';
  const items = [protocolItem(0), held, unknown, protocolItem(3)];
  const before = JSON.stringify(items);
  const result = cutMappedFeatures(items);
  assert.deepEqual(result.cuts.flatMap(cut => cut.features.map(item => item.raw.featureIndex)), [0, 3]);
  assert.deepEqual(result.held, [{ featureIndex: 1, code: 'PART_FEATURE_VERTEX_BOUND' }]);
  assert.equal(JSON.stringify(items), before);
  assert.throws(() => cutMappedFeatures([protocolItem(1), protocolItem(0)]));
  const wrong = protocolItem(0);
  wrong.mapped.rawSha256 = 'b'.repeat(64);
  assert.throws(() => cutMappedFeatures([wrong]));
});

/** Resume after each stored cut, with that cut's next index, and compare the remaining cuts. */
function assertResumes(items: MappedPartFeature[], frame: AreaFrame | null = null) {
  const whole = cutMappedFeatures(items, {}, frame);
  assert(whole.cuts.length > 2 && whole.held.length > 0);
  const ids = (cuts: { index: number; features: MappedPartFeature[] }[]) =>
    cuts.map(cut => [cut.index, cut.features.map(item => item.raw.featureIndex)]);
  for (const [stored, cut] of whole.cuts.entries()) {
    const last = cut.features.at(-1)!.raw.featureIndex;
    const cutter = new IntakePackageCutter({}, { index: stored + 1, previous: last }, frame);
    const resumed = [];
    for (const item of items.filter(item => item.raw.featureIndex > last)) {
      const result = cutter.consume(item);
      if (result.cut) resumed.push(result.cut);
    }
    const tail = cutter.close();
    if (tail) resumed.push(tail);
    assert.deepEqual(ids(resumed), ids(whole.cuts.slice(stored + 1)));
  }
}

test('a fold resumed after any stored cut closes the same cuts as one fold from the start', () => {
  const positions = (index: number) => {
    if (index % 7 === 0) return 10001;
    return index % 5 === 0 ? 400 : 5;
  };
  assertResumes(Array.from({ length: 3000 }, (_, index) => protocolItem(index, positions(index))));
});

test('a fold resumed after a cut closed on extent closes the same remaining cuts', () => {
  const place = (index: number) => [HERE, NEAR, WEST, FAR][Math.floor(index / 3) % 4];
  const items = Array.from({ length: 600 }, (_, index) => index % 11 === 0 ? placedItem(index, HERE, 0.6)
    : placedItem(index, place(index)));
  assertResumes(items);
  assertResumes(items, { analysisCrs: 'EPSG:32643', origin: utmForward(32643, ...HERE) });
});

test('K open cells coalesce alternating features and the next cell closes the least recently used cut', () => {
  const items = Array.from({ length: 40 }, (_, index) => placedItem(index, index % 2 ? FAR : HERE));
  const cutter = new IntakeCellCutter();
  const cuts = [];
  for (const item of items) {
    const result = cutter.consume(item);
    assert.equal(result.held, undefined);
    if (result.cut) cuts.push(result.cut);
    assert(cutter.checkpoint().open.length <= INTAKE_OPEN_CELL_LIMIT);
  }
  for (let cut = cutter.close(); cut; cut = cutter.close()) cuts.push(cut);
  assert.equal(cuts.length, 2);
  assert.equal(cuts[0].features.length, 20);
  assert.notEqual(cuts[0].cell.key, cuts[1].cell.key);
  const lru = new IntakeCellCutter();
  const limit = INTAKE_OPEN_CELL_LIMIT;
  const places: [number, number][] = Array.from({ length: limit + 1 }, (_, index) => [77, 28 + index]);
  places.slice(0, limit).forEach((place, index) => lru.consume(placedItem(index, place)));
  lru.consume(placedItem(limit, HERE));
  const evicted = lru.consume(placedItem(limit + 1, places[limit])).cut;
  assert.deepEqual(evicted?.features.map(item => item.raw.featureIndex), [1]);
});

function cellFold(items: MappedPartFeature[], resume?: CellCutResume) {
  const wanted = new Set(resume?.open.flat() ?? []);
  const cutter = new IntakeCellCutter({}, resume, items.filter(item => wanted.has(item.raw.featureIndex)));
  const cuts: IntakeCellCut[] = [], held = [];
  for (const item of items.filter(item => item.raw.featureIndex > (resume?.previous ?? -1))) {
    const result = cutter.consume(item);
    if (result.cut) cuts.push(result.cut);
    if (result.held) held.push(result.held);
  }
  for (let cut = cutter.close(); cut; cut = cutter.close()) cuts.push(cut);
  return { cuts, held };
}

function assertCellResumes(items: MappedPartFeature[]) {
  const whole = cellFold(items);
  const shape = (cuts: IntakeCellCut[]) => cuts.map(cut => [cut.index, cut.cell.key,
    cut.features.map(item => item.raw.featureIndex), cut.resume]);
  for (const [index, stored] of whole.cuts.entries()) {
    const snapshot = JSON.parse(JSON.stringify(stored.resume));
    const tail = cellFold(items, snapshot);
    assert.deepEqual(shape(tail.cuts), shape(whole.cuts.slice(index + 1)));
    assert.deepEqual(tail.held, whole.held.filter(item => item.featureIndex > snapshot.previous));
  }
}

test('cell snapshots resume after every stored cut, including scattered indexes, holds and EOF draining', () => {
  assertCellResumes(Array.from({ length: 120 }, (_, index) => index % 13 === 0 ? placedItem(index, HERE, 0.6)
    : placedItem(index, [77, 28 + index % (INTAKE_OPEN_CELL_LIMIT + 2)])));
});

test('a cell size cut checkpoints its triggering feature and retains single-feature wide holds unchanged', () => {
  const items = Array.from({ length: 6005 }, (_, index) => index % 997 === 0 ? placedItem(index, HERE, 0.6)
    : placedItem(index, index % 2 ? HERE : FAR));
  const before = JSON.stringify(items);
  assertCellResumes(items);
  const result = cellFold(items);
  assert(result.cuts.some(cut => cut.features.length === 2000));
  assert(result.held.every(item => item.code === 'PART_FEATURE_EXTENT_BOUND'));
  assert.equal(JSON.stringify(items), before);
});

test('a stored cell fold cannot exceed the open-cut bound or resume without its exact source records', () => {
  const resume: CellCutResume = { version: 'intake-cell-cuts/1', index: 1, previous: 20,
    open: Array.from({ length: INTAKE_OPEN_CELL_LIMIT + 1 }, (_, index) => [index]) };
  assert.throws(() => new IntakeCellCutter({}, resume), { code: 'PART_CELL_RESUME' });
  assert.throws(() => new IntakeCellCutter({}, { ...resume, open: [[0]] }), { code: 'PART_CELL_RESUME' });
});

test('serialized input bound reserves Python ASCII expansion and number spelling', () => {
  assert.equal(normalizerInputUpperBound({ text: 'अ😀' }), '{"text":"\\u0905\\ud83d\\ude00"}'.length);
  assert(normalizerInputUpperBound({ x: 1e-7 }) > JSON.stringify({ x: 1e-7 }).length);
});

test('real NYC reader preserves global indexes and spans through deterministic cuts', async () => {
  const bytes = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
  const items: MappedPartFeature[] = [];
  await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
    const raw = sourceRecord(item);
    assert.equal(raw.disposition, 'accepted');
    const protocol = protocolItem(item.index);
    const mapped = { ...protocol.mapped, featureIndex: item.index, byteStart: item.start, byteEnd: item.end,
      rawSha256: raw.rawSha256, geometryRef: { ...protocol.mapped.geometryRef!, featureIndex: item.index,
        rawSha256: raw.rawSha256 } };
    items.push({ raw, mapped, feature: item.feature as Record<string, unknown> });
  });
  const first = cutMappedFeatures(items), replay = cutMappedFeatures(items);
  assert.deepEqual(first, replay);
  // The cut and holds the cutter made before it measured extent (commit 26bc76fc), as a digest of their indexes.
  const shape = { cuts: first.cuts.map(cut => [cut.index, cut.features.map(item => item.raw.featureIndex)]),
    held: first.held };
  assert.equal(createHash('sha256').update(JSON.stringify(shape)).digest('hex'),
    '76e4e298e07b3c51be2d12d80517b97ea36067d145c0a34c8d7767d1a35e766e');
  const cells = new IntakeCellCutter();
  const cellCuts = [];
  for (const item of items) {
    const result = cells.consume(item);
    if (result.cut) cellCuts.push(result.cut);
  }
  for (let cut = cells.close(); cut; cut = cells.close()) cellCuts.push(cut);
  assert.equal(createHash('sha256').update(JSON.stringify({ cuts: cellCuts.map(cut =>
    [cut.index, cut.features.map(item => item.raw.featureIndex)]), held: [] })).digest('hex'),
  '76e4e298e07b3c51be2d12d80517b97ea36067d145c0a34c8d7767d1a35e766e');
  assert.equal(first.cuts.length, 1);
  assert.equal(first.cuts[0].cost.features, 1662);
  assert.equal(first.cuts[0].features[1322].raw.featureIndex, 1322);
  for (const item of first.cuts[0].features)
    assert.equal(item.raw.byteEnd - item.raw.byteStart, bytes.subarray(item.raw.byteStart, item.raw.byteEnd).length);
  // Pure structural reader does not test polygon topology; index 1322 is quarantined by the normalizer/PostGIS.
});
