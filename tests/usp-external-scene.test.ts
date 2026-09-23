import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { decodeCityJsonRoof, type ExternalRoofScene } from '../apps/web/features/usp/shared/external-scene';

const bytes = readFileSync('fixtures/usp/D1/single-roof/original.json');
const source = () => JSON.parse(bytes.toString('utf8'));
const oracle = JSON.parse(readFileSync('fixtures/usp/D1/single-roof/expected.json', 'utf8'));
const buildingId = oracle.identity.buildingId;
const near = (actual: number, expected: number, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const solid = (value: ReturnType<typeof source>) => value.feature.CityObjects[oracle.identity.buildingPartIds[0]].geometry.find((geometry: { lod: string }) => geometry.lod === '2.2');

function triangleArea(scene: ExternalRoofScene, indices: number[]) {
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = scene.vertices[indices[i]], b = scene.vertices[indices[i + 1]], c = scene.vertices[indices[i + 2]];
    const u = b.map((n, axis) => n - a[axis]), v = c.map((n, axis) => n - a[axis]);
    total += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return total;
}

// Independent analytic plane: z = x/2 + y/4. Outer XY square area 100;
// central hole area 16, so the surface area is 84 * sqrt(1 + 1/4 + 1/16).
function tilted(rings: number[][] = [[0, 1, 2, 3], [4, 5, 6, 7]]) {
  const xy = [[0, 0], [10, 0], [10, 10], [0, 10], [3, 3], [3, 7], [7, 7], [7, 3]];
  return {
    id: 'test',
    metadata: { type: 'CityJSON', version: '2.0', metadata: { referenceSystem: oracle.responseEnvelope.referenceSystem }, transform: { scale: [.001, .001, .001], translate: [100000, 400000, 100] } },
    feature: {
      type: 'CityJSONFeature', id: 'test',
      vertices: xy.map(([x, y]) => [x * 1000, y * 1000, (x / 2 + y / 4) * 1000]),
      CityObjects: {
        test: { type: 'Building', children: ['test-part'] },
        'test-part': { type: 'BuildingPart', parents: ['test'], geometry: [{ type: 'Solid', lod: '2.2', boundaries: [rings.length ? [rings] : []], semantics: { surfaces: [{ type: 'RoofSurface' }], values: [[0]] } }] },
      },
    },
  };
}

test('D1 original hash, identity, selected LoD, local frame and roof topology match the independent oracle', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2');
  const scene = decodeCityJsonRoof(source(), buildingId);
  assert.equal(scene.sourceBuildingId, buildingId);
  assert.deepEqual(scene.partIds, oracle.identity.buildingPartIds);
  assert.equal(scene.referenceSystem, oracle.responseEnvelope.referenceSystem);
  assert.equal(scene.vertices.length, oracle.responseEnvelope.encodedVertexCount);
  assert.equal(scene.lod, '2.2');
  assert.equal(scene.interiors, 'unavailable');
  assert.equal(scene.analyticalVolume, 'unsupported');
  assert.equal(scene.frame.kind, 'local_engineering_display');
  assert.equal(scene.frame.globalPlacement, 'unqualified');
  assert.equal(scene.frame.verticalDatum, 'NAP');
  const geometry = oracle.geometry.partSolids.find((entry: { lod: string }) => entry.lod === '2.2');
  assert.equal(scene.faces.length, geometry.faceCount);
  assert.equal(scene.faces.filter((face) => face.surfaceType === 'WallSurface').length, geometry.wallFaces);
  assert.equal(scene.faces.filter((face) => face.surfaceType === 'GroundSurface').length, geometry.groundFaces);
  const roofs = scene.faces.filter((face) => face.surfaceType === 'RoofSurface');
  assert.equal(roofs.length, geometry.roofFaces);
  assert.deepEqual(roofs.map((face) => face.rings[0].length), geometry.roofRingVertexCounts);
  for (const face of roofs) {
    assert.ok(Math.abs(face.normal[2]) > .1 && Math.abs(face.normal[2]) < .999, 'sloped roof retained');
    near(Math.hypot(...face.normal), 1);
    assert.ok(triangleArea(scene, face.triangles) > 0);
    assert.equal(face.partId, oracle.identity.buildingPartIds[0]);
  }
  // expected.json gives all-source bounds. DATA's independent acquisition.md
  // records the selected LoD2.2 minimum Z as 0.9195041809 m NAP; LoD0 is lower.
  for (let axis = 0; axis < 3; axis++) {
    near(Math.min(...scene.vertices.map((vertex) => vertex[axis])) + scene.frame.origin[axis], oracle.decodedBoundsEpsg7415Metres.minimum[axis]);
    near(Math.max(...scene.vertices.map((vertex) => vertex[axis])) + scene.frame.origin[axis], oracle.decodedBoundsEpsg7415Metres.maximum[axis]);
    near(scene.bounds.minimum[axis] + scene.frame.origin[axis], axis === 2 ? 0.9195041809 : oracle.decodedBoundsEpsg7415Metres.minimum[axis]);
    near(scene.bounds.maximum[axis] + scene.frame.origin[axis], oracle.decodedBoundsEpsg7415Metres.maximum[axis]);
  }
  near(scene.bounds.minimum[2], 0);
  near(scene.bounds.minimum[0] + scene.bounds.maximum[0], 0);
  near(scene.bounds.minimum[1] + scene.bounds.maximum[1], 0);
});

test('transform applies exactly once, source vertices/topology remain untouched, and unused vertices do not alter bounds', () => {
  const input = source(), original = JSON.stringify(input);
  const scene = decodeCityJsonRoof(input, buildingId);
  input.feature.vertices.forEach((vertex: number[], index: number) => vertex.forEach((encoded, axis) => {
    near(scene.vertices[index][axis] + scene.frame.origin[axis], encoded * oracle.responseEnvelope.transform.scale[axis] + oracle.responseEnvelope.transform.translate[axis]);
  }));
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(scene.faces.map((face) => face.rings), solid(input).boundaries[0]);
  assert.deepEqual(scene.faces.map(face => face.sourceFaceIndex), solid(input).boundaries[0].map((_: unknown, index: number) => index));
  assert.deepEqual(scene.faces.map(face => face.semanticIndex), solid(input).semantics.values[0]);
  assert.deepEqual(scene.faces.map(face => face.surfaceType), solid(input).semantics.values[0].map((index: number) => solid(input).semantics.surfaces[index].type));
  for (const face of scene.faces) {
    assert.deepEqual(face.indices, face.rings.flat());
    assert.ok(face.triangles.every((index) => face.indices.includes(index)));
  }
  input.feature.vertices.push([0, 0, -100000]);
  const withUnused = decodeCityJsonRoof(input, buildingId);
  assert.deepEqual(withUnused.frame, scene.frame);
  assert.deepEqual(withUnused.bounds, scene.bounds);
});

test('tilted planar hole triangulation covers the analytic area, excludes the hole and preserves winding', () => {
  const scene = decodeCityJsonRoof(tilted(), 'test'), face = scene.faces[0];
  assert.equal(face.rings.length, 2);
  near(triangleArea(scene, face.triangles), 84 * Math.sqrt(1.3125));
  near(face.normal[0], -.5 / Math.sqrt(1.3125));
  near(face.normal[1], -.25 / Math.sqrt(1.3125));
  near(face.normal[2], 1 / Math.sqrt(1.3125));
  for (let i = 0; i < face.triangles.length; i += 3) {
    const vertices = face.triangles.slice(i, i + 3).map((index) => scene.vertices[index]);
    const x = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / 3 + 5;
    const y = vertices.reduce((sum, vertex) => sum + vertex[1], 0) / 3 + 5;
    assert.ok(!(x > 3 && x < 7 && y > 3 && y < 7));
    const [a, b, c] = vertices;
    assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0);
  }
  const reversed = decodeCityJsonRoof(tilted([[3, 2, 1, 0], [7, 6, 5, 4]]), 'test');
  near(triangleArea(reversed, reversed.faces[0].triangles), 84 * Math.sqrt(1.3125));
  assert.ok(reversed.faces[0].normal[2] < 0);
});

test('stable plane supports a collinear first triple and vertical surfaces', () => {
  const input = tilted([[0, 8, 1, 2, 3]]);
  input.feature.vertices.push([5000, 0, 2500]);
  const scene = decodeCityJsonRoof(input, 'test');
  near(triangleArea(scene, scene.faces[0].triangles), 100 * Math.sqrt(1.3125));
  const vertical = tilted([[0, 1, 2, 3]]);
  vertical.feature.vertices = [[0, 0, 0], [10000, 0, 0], [10000, 0, 10000], [0, 0, 10000]];
  const wall = decodeCityJsonRoof(vertical, 'test');
  near(triangleArea(wall, wall.faces[0].triangles), 100);
  near(Math.abs(wall.faces[0].normal[1]), 1);
});

const invalidCases: Array<[string, (input: ReturnType<typeof source>) => void, RegExp]> = [
  ['missing transform', (input) => delete input.metadata.transform, /transform/],
  ['wrong CRS', (input) => input.metadata.metadata.referenceSystem = 'EPSG:4326', /reference system/],
  ['duplicate transform', (input) => input.feature.transform = input.metadata.transform, /transform/],
  ['nonfinite input', (input) => input.feature.vertices[0][0] = Infinity, /finite plain JSON/],
  ['fractional encoded coordinate', (input) => input.feature.vertices[0][0] = .1, /encoded integers/],
  ['coordinate bound', (input) => input.feature.vertices[0][0] = Number.MAX_SAFE_INTEGER, /coordinate bounds/],
  ['negative scale', (input) => input.metadata.transform.scale[0] = -.001, /transform/],
  ['mixed envelope ID', (input) => input.id = 'other', /identity/],
  ['mixed feature ID', (input) => input.feature.id = 'other', /identity/],
  ['mixed parent ID', (input) => input.feature.CityObjects[oracle.identity.buildingPartIds[0]].parents = ['other'], /hierarchy/],
  ['unlinked object', (input) => input.feature.CityObjects.other = { type: 'Building' }, /unlinked/],
  ['duplicate child', (input) => input.feature.CityObjects[buildingId].children.push(oracle.identity.buildingPartIds[0]), /duplicate/],
  ['negative index', (input) => solid(input).boundaries[0][0][0][0] = -1, /vertex index/],
  ['out of range index', (input) => solid(input).boundaries[0][0][0][0] = 62, /vertex index/],
  ['fractional index', (input) => solid(input).boundaries[0][0][0][0] = .5, /vertex index/],
  ['repeat index', (input) => solid(input).boundaries[0][0][0].push(solid(input).boundaries[0][0][0][0]), /repeats/],
  ['additional shell', (input) => solid(input).boundaries.push(solid(input).boundaries[0]), /solid shells/],
  ['unsupported mesh', (input) => solid(input).type = 'MultiSurface', /LoD 2.2 Solid/],
  ['missing LoD', (input) => solid(input).lod = '2.1', /LoD 2.2/],
  ['semantic index', (input) => solid(input).semantics.values[0][0] = 2000, /semantic surface index/],
  ['semantic shape', (input) => solid(input).semantics.values[0].pop(), /semantic face values/],
];
for (const [name, mutate, error] of invalidCases) test(`rejects ${name}`, () => {
  const input = source(); mutate(input);
  assert.throws(() => decodeCityJsonRoof(input, buildingId), error);
});

test('rejects nonplanar faces beyond explicit quantization tolerance', () => {
  const input = tilted(); input.feature.vertices[2][2] += 100;
  assert.throws(() => decodeCityJsonRoof(input, 'test'), /nonplanar/);
});
test('rejects degenerate and self-intersecting rings', () => {
  const input = tilted([[0, 1, 2, 3]]);
  input.feature.vertices[2] = [20000, 0, 10000]; input.feature.vertices[3] = [30000, 0, 15000];
  assert.throws(() => decodeCityJsonRoof(input, 'test'), /degenerate/);
  assert.throws(() => decodeCityJsonRoof(tilted([[0, 2, 1, 3]]), 'test'), /degenerate|self-intersecting/);
});
test('rejects holes outside, intersecting, touching and nested', () => {
  const outside = tilted();
  for (let i = 4; i < 8; i++) { outside.feature.vertices[i][0] += 20000; outside.feature.vertices[i][2] += 10000; }
  assert.throws(() => decodeCityJsonRoof(outside, 'test'), /outside/);
  const touching = tilted(); touching.feature.vertices[4] = [0, 3000, 750]; touching.feature.vertices[5] = [0, 7000, 1750];
  assert.throws(() => decodeCityJsonRoof(touching, 'test'), /touching/);
  const crossing = tilted(); crossing.feature.vertices[4] = [-1000, 3000, 250];
  assert.throws(() => decodeCityJsonRoof(crossing, 'test'), /intersecting/);
  const nested = tilted([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]]);
  nested.feature.vertices.push(...[[4, 4], [4, 6], [6, 6], [6, 4]].map(([x, y]) => [x * 1000, y * 1000, (x / 2 + y / 4) * 1000]));
  assert.throws(() => decodeCityJsonRoof(nested, 'test'), /nested|overlapping/);
});
test('bounds arbitrary JSON, vertices, ring sizes and topology work', () => {
  const huge = source(); huge.feature.vertices = Array(20001).fill([0, 0, 0]);
  assert.throws(() => decodeCityJsonRoof(huge, buildingId), /array exceeds/);
  const longRing = tilted([Array.from({ length: 513 }, (_, i) => i)]);
  assert.throws(() => decodeCityJsonRoof(longRing, 'test'), /ring vertices/);
  const cyclic = source(); cyclic.links = cyclic;
  assert.throws(() => decodeCityJsonRoof(cyclic, buildingId), /complexity/);
  const expensive = tilted();
  expensive.feature.vertices = Array.from({ length: 512 }, (_, i) => [Math.round(10000 * Math.cos(i * 2 * Math.PI / 512)), Math.round(10000 * Math.sin(i * 2 * Math.PI / 512)), 0]);
  const geometry = expensive.feature.CityObjects['test-part'].geometry[0];
  geometry.boundaries = [Array.from({ length: 20 }, () => [Array.from({ length: 512 }, (_, i) => i)])];
  geometry.semantics.values = [Array(20).fill(0)];
  assert.throws(() => decodeCityJsonRoof(expensive, 'test'), /topology comparison budget/);
});
