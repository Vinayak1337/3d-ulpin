import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { verifyUspPack } from '../scripts/usp/data/verify-pack';

const root = path.resolve('fixtures/usp/D1/single-roof');
const readJson = async (name: string) => JSON.parse(await readFile(path.join(root, name), 'utf8'));

test('D1 preserves the full one-building response and does not claim product qualification', async () => {
  const manifest = await readJson('manifest.json');
  const receipt = await verifyUspPack(path.join(root, 'manifest.json'));
  assert.equal(receipt.checked.length, 4);
  assert.equal(receipt.unavailable.length, 0);
  assert.equal(receipt.checked.find((asset: { id: string }) => asset.id === 'original.json')?.bytes, 6783);
  for (const asset of manifest.assets) {
    assert.equal(asset.verification.bytes_preserved.status, 'passed');
    assert.equal(asset.verification.parsed.status, 'not_run');
    assert.equal(asset.verification.rendered.status, 'not_run');
    assert.equal(asset.verification.workflow_verified.status, 'not_run');
  }
});

test('D1 source identity, CRS, decoded bounds and roof topology match the independent oracle', async () => {
  const source = await readJson('original.json');
  const expected = await readJson('expected.json');
  const metadata = source.metadata;
  const feature = source.feature;
  assert.equal(source.id, expected.responseEnvelope.id);
  assert.equal(feature.id, expected.identity.buildingId);
  assert.equal(feature.type, expected.responseEnvelope.featureType);
  assert.equal(metadata.type, expected.responseEnvelope.metadataType);
  assert.equal(metadata.version, expected.responseEnvelope.metadataVersion);
  assert.equal(metadata.metadata.referenceSystem, expected.responseEnvelope.referenceSystem);
  assert.deepEqual(metadata.transform, expected.responseEnvelope.transform);
  assert.equal(feature.vertices.length, expected.responseEnvelope.encodedVertexCount);

  const decoded = feature.vertices.map((vertex: number[]) => vertex.map((integer, axis) =>
    integer * metadata.transform.scale[axis] + metadata.transform.translate[axis]));
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(Math.min(...decoded.map((vertex: number[]) => vertex[axis])) - expected.decodedBoundsEpsg7415Metres.minimum[axis])
      <= expected.decodedBoundsEpsg7415Metres.toleranceMetres);
    assert.ok(Math.abs(Math.max(...decoded.map((vertex: number[]) => vertex[axis])) - expected.decodedBoundsEpsg7415Metres.maximum[axis])
      <= expected.decodedBoundsEpsg7415Metres.toleranceMetres);
  }

  const building = feature.CityObjects[feature.id];
  assert.equal(building.type, expected.identity.buildingType);
  assert.deepEqual(building.children, expected.identity.buildingPartIds);
  assert.equal(building.attributes.b3_bouwlagen, expected.availability.b3_bouwlagen);
  assert.equal(building.geometry[0].type, expected.geometry.building.type);
  assert.equal(building.geometry[0].boundaries.length, expected.geometry.building.faceCount);

  const part = feature.CityObjects[expected.identity.buildingPartIds[0]];
  assert.equal(part.type, expected.identity.partType);
  assert.deepEqual(part.parents, [feature.id]);
  for (const oracle of expected.geometry.partSolids) {
    const geometry = part.geometry.find((candidate: { lod: string }) => candidate.lod === oracle.lod);
    assert.ok(geometry, `missing LoD ${oracle.lod}`);
    assert.equal(geometry.type, 'Solid');
    assert.equal(geometry.boundaries.length, oracle.shellCount);
    const faces = geometry.boundaries.flat();
    const semanticIndices = geometry.semantics.values.flat();
    assert.equal(faces.length, oracle.faceCount);
    assert.equal(semanticIndices.length, faces.length);
    const byType = new Map<string, number>();
    let nonhorizontalRoofFaces = 0;
    let holeRings = 0;
    const roofRingVertexCounts: number[] = [];
    faces.forEach((rings: number[][], index: number) => {
      const type = geometry.semantics.surfaces[semanticIndices[index]].type;
      byType.set(type, (byType.get(type) ?? 0) + 1);
      holeRings += rings.length - 1;
      if (type !== 'RoofSurface') return;
      roofRingVertexCounts.push(rings[0].length);
      const heights = rings.flatMap((ring) => ring.map((vertexIndex) => decoded[vertexIndex][2]));
      if (Math.max(...heights) - Math.min(...heights) > 0.000001) nonhorizontalRoofFaces++;
    });
    assert.equal(byType.get('GroundSurface'), oracle.groundFaces);
    assert.equal(byType.get('WallSurface'), oracle.wallFaces);
    assert.equal(byType.get('RoofSurface'), oracle.roofFaces);
    assert.equal(nonhorizontalRoofFaces, oracle.nonhorizontalRoofFaces);
    assert.equal(holeRings, oracle.holeRings);
    if (oracle.roofRingVertexCounts) assert.deepEqual(roofRingVertexCounts, oracle.roofRingVertexCounts);
  }
});
