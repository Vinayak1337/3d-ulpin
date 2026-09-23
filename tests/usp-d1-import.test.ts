import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { deriveD1 } from '../scripts/usp/data/import-d1';

test('D1 plan derives only the original LoD 0 ring and keeps source markers', async () => {
  const derived = await deriveD1();
  const expected = JSON.parse(await readFile(path.resolve('fixtures/usp/D1/single-roof/expected.json'), 'utf8'));
  const source = JSON.parse(derived.original.toString('utf8'));
  const features = derived.featureSet.features;
  assert.equal(features.length, 1);
  assert.deepEqual(derived.featureSet.spatialReference, { wkid: 28992 });
  assert.equal(derived.sourceBuildingId, expected.identity.buildingId);
  assert.equal(features[0].attributes.id, expected.identity.buildingId);
  assert.equal(features[0].attributes.external_cityjson_id, expected.identity.buildingId);
  assert.equal(features[0].attributes.external_cityjson_sha256, derived.sourceSha256);
  assert.equal(features[0].attributes.source_provider, '3DBAG');
  assert.match(features[0].attributes.attribution, /© 3DBAG by tudelft3d and 3DGI/);
  assert.equal('height' in features[0].attributes, false);
  assert.equal('floors' in features[0].attributes, false);
  assert.equal(derived.gisBytes.includes(Buffer.from('8.514504180908202')), false, 'vertical source values must not enter 2D GIS');

  const sourceRing = source.feature.CityObjects[source.id].geometry[0].boundaries[0][0];
  const ring = features[0].geometry.rings[0];
  assert.equal(ring.length, sourceRing.length + 1);
  assert.deepEqual(ring[0], ring.at(-1));
  for (let i = 0; i < sourceRing.length; i++) {
    const integer = source.feature.vertices[sourceRing[i]];
    const { scale, translate } = source.metadata.transform;
    assert.deepEqual(ring[i], [integer[0] * scale[0] + translate[0], integer[1] * scale[1] + translate[1]]);
  }
  for (let axis = 0; axis < 2; axis++) {
    const actual = ring.slice(0, -1).map(point => point[axis]);
    assert.ok(Math.abs(Math.min(...actual) - expected.decodedBoundsEpsg7415Metres.minimum[axis]) < 0.000001);
    assert.ok(Math.abs(Math.max(...actual) - expected.decodedBoundsEpsg7415Metres.maximum[axis]) < 0.000001);
  }
});
