import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUspPack } from './verify-pack';

const root = path.resolve('fixtures/usp/D0/golden-v1');
const readJson = async (name: string): Promise<any> => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const ringArea = (ring: number[][]) => Math.abs(ring.slice(0, -1).reduce((sum, point, index) => {
  const next = ring[index + 1]; return sum + point[0] * next[1] - next[0] * point[1];
}, 0)) / 2;
const bounds = (ring: number[][]) => ({
  x0: Math.min(...ring.map(point => point[0])), y0: Math.min(...ring.map(point => point[1])),
  x1: Math.max(...ring.map(point => point[0])), y1: Math.max(...ring.map(point => point[1])),
});
const overlapArea = (left: number[][], right: number[][]) => {
  const a = bounds(left), b = bounds(right);
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
    * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
};
function csvFields(line: string) {
  const fields: string[] = []; let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { fields.push(value); value = ''; }
    else value += char;
  }
  assert.ok(!quoted, 'Unclosed CSV field'); fields.push(value); return fields;
}
function assertRing(ring: number[][]) {
  assert.ok(ring.length >= 4 && ring.every(point => point.length === 2 && point.every(Number.isFinite)));
  assert.deepEqual(ring[0], ring.at(-1)); assert.ok(ringArea(ring) > 0);
}
function assertPart(lines: string[], line: number, token: string, alias: string) {
  assert.ok(lines[line - 1].includes(token)); assert.ok(lines[line - 1].includes(alias));
  assert.ok(!lines.filter((_, i) => i !== line - 1).some(value => value.includes(token)));
}
/** Authored D0 truth checks; byte checks alone do not qualify a live service or renderer. */
export async function verifyD0() {
  const bytes = await verifyUspPack(path.join(root, 'manifest.json'));
  assert.equal(bytes.profile, 'golden-v1'); assert.equal(bytes.checked.length, 11);
  const scenario = await readJson('scenario.json');
  const expected = await readJson('expected.json');
  assert.equal(scenario.classification, 'synthetic');
  assert.equal(scenario.frame.horizontalUnit, 'm');
  assert.equal(scenario.frame.verticalUnit, 'm');
  assert.equal(scenario.buildings.length, expected.counts.buildings);
  assert.equal(scenario.parcels.length, expected.counts.parcels);
  assert.equal(scenario.spaces.length, expected.counts.spaces);
  assert.ok(scenario.spaces.length <= 30);
  assert.equal(scenario.spaces.filter((space: any) => space.type === 'unit').length, expected.counts.units);
  assert.equal(scenario.spaces.filter((space: any) => space.type === 'shared').length, expected.counts.shared);
  assert.deepEqual(scenario.sourceRevisions.map((source: any) => source.revision), [1, 2]);
  const aliases = [
    ...scenario.buildings.map((item: any) => item.alias),
    ...scenario.parcels.map((item: any) => item.alias),
    ...scenario.spaces.map((item: any) => item.alias),
  ];
  assert.equal(new Set(aliases).size, aliases.length);
  for (const alias of expected.aliases) assert.ok(aliases.includes(alias), `Missing ${alias}`);
  const buildings = new Map<string, any>(scenario.buildings.map((item: any) => [item.alias, item]));
  const levels = new Map<string, any>();
  for (const building of scenario.buildings) {
    assertRing(building.outer);
    for (const hole of building.holes) {
      assertRing(hole);
      const outer = bounds(building.outer), inner = bounds(hole);
      assert.ok(inner.x0 > outer.x0 && inner.x1 < outer.x1 && inner.y0 > outer.y0 && inner.y1 < outer.y1);
    }
    for (const level of building.levels) {
      assert.ok(level.upper > level.lower); assert.ok(!levels.has(level.id));
      levels.set(level.id, { ...level, building: building.alias });
    }
    for (const parcel of building.parcels) assert.ok(scenario.parcels.some((item: any) => item.alias === parcel));
  }
  for (const space of scenario.spaces) {
    assert.ok(buildings.has(space.building));
    assert.ok(space.components.length > 0);
    for (const component of space.components) {
      const level = levels.get(component.level);
      assert.equal(level?.building, space.building);
      assertRing(component.ring);
      const outer = bounds(buildings.get(space.building).outer), inner = bounds(component.ring);
      assert.ok(inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1);
    }
  }
  const area = ringArea(buildings.get('B-A').outer) - buildings.get('B-A').holes.reduce((sum: number, hole: number[][]) => sum + ringArea(hole), 0);
  assert.equal(area, 396); // 20 x 20 outer with 2 x 2 authored courtyard.
  const [o1, o2, o3] = expected.geometryOracles;
  for (const oracle of [o1, o2]) {
    assert.equal(overlapArea(oracle.leftXY, oracle.rightXY), 10);
    const overlapHeight = Math.max(0, Math.min(oracle.leftZ[1], oracle.rightZ[1]) - Math.max(oracle.leftZ[0], oracle.rightZ[0]));
    assert.equal(overlapArea(oracle.leftXY, oracle.rightXY) * overlapHeight, oracle.expectedPositiveVolumeM3);
  }
  assert.equal(ringArea(o3.outerXY) - ringArea(o3.holeXY), o3.expectedAreaM2);
  const a = scenario.buildings[0];
  assert.deepEqual(a.parcels, ['P-A', 'P-B']);
  assert.equal(levels.get('F-AB').lower, -3.2);
  assert.ok(Math.abs(levels.get('F-AM').upper - levels.get('F-AM').lower - 1.8) < 1e-6);
  assert.deepEqual(scenario.spaces.find((space: any) => space.alias === 'DUPLEX-D1').components.map((component: any) => component.level), ['F-A0', 'F-AM']);
  for (const revision of [1, 2]) {
    const lines = (await readFile(path.join(root, `mixed-page-r${revision}.txt`), 'utf8')).trimEnd().split('\n');
    assertPart(lines, 3, 'ONLY_A101', 'U-A101');
    assertPart(lines, 4, 'NEVER_A102', 'U-A102');
    assertPart(lines, 5, 'SHARED_STAIR_CONTEXT', 'STAIR-S1');
    const rows = (await readFile(path.join(root, `mixed-rows-r${revision}.csv`), 'utf8')).trimEnd().split('\n');
    assertPart(rows, 2, 'ONLY_A101', 'U-A101');
    assertPart(rows, 3, 'NEVER_A102', 'U-A102');
    assertPart(rows, 4, 'SHARED_STAIR_CONTEXT', 'STAIR-S1');
  }
  for (const building of scenario.buildings) {
    const gis = await readJson('buildings.arcgis.json');
    const feature = gis.features.find((item: any) => item.attributes.id === building.alias);
    assert.ok(feature);
    assert.equal(feature.geometry.rings.length, 1 + building.holes.length);
    for (let i = 0; i < feature.geometry.rings.length; i++) {
      assert.deepEqual(feature.geometry.rings[i].map(([x, y]: number[]) => [x - scenario.frame.originEasting, y - scenario.frame.originNorthing]), [building.outer, ...building.holes][i]);
    }
    const csv = (await readFile(path.join(root, `spaces-${building.alias}.csv`), 'utf8')).trimEnd().split('\n').map(csvFields);
    assert.deepEqual(csv[0], ['alias','lower','upper','unit','benchmark','label','level','footprint_wkt','frame']);
    const componentCount = scenario.spaces.filter((space: any) => space.building === building.alias && space.type === 'unit').reduce((n: number, space: any) => n + space.components.length, 0);
    assert.equal(csv.length - 1, componentCount);
    const expectedRows = scenario.spaces.filter((space: any) => space.building === building.alias && space.type === 'unit')
      .flatMap((space: any) => space.components.map((component: any, index: number) => ({ space, component, index })));
    for (let i = 0; i < expectedRows.length; i++) {
      const { space, component, index } = expectedRows[i], level = levels.get(component.level), row = csv[i + 1];
      assert.equal(row[0], space.components.length === 1 ? space.alias : `${space.alias}-${index + 1}`);
      assert.equal(Number(row[1]), level.lower); assert.equal(Number(row[2]), level.upper);
      assert.equal(row[3], 'm'); assert.equal(row[4], scenario.frame.verticalBenchmark);
      assert.equal(row[6], `${building.alias} / ${level.label}`);
      assert.equal(row[8], scenario.frame.id);
      assert.equal(row[7], `POLYGON ((${component.ring.map(([x, y]: number[]) => `${x} ${y}`).join(', ')}))`);
    }
  }
  for (const missing of expected.missing) {
    assert.ok(scenario.missing.some((entry: any) => entry.target === missing.target && entry.capability === missing.capability && entry.state === missing.state));
  }
  assert.deepEqual(expected.packet.includeTokens, ['ONLY_A101', 'SHARED_STAIR_CONTEXT']);
  assert.deepEqual(expected.packet.excludeTokens, ['NEVER_A102']);
  return { schemaVersion: 'usp-d0-authored-check/1', profile: bytes.profile, assets: bytes.checked.length,
    assetBytes: bytes.totalBytes, buildings: scenario.buildings.length, logicalSpaces: scenario.spaces.length,
    selectedTarget: expected.selectedTarget, exactTextLines: [3, 5], exactCsvRows: [2, 4],
    qualification: 'Authored byte/structure/oracle checks only; live import, PACK0 and rendering remain separate gates.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyD0().then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
