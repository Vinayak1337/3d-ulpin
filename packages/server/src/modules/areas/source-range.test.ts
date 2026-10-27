import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { importedGeojsonRanges } from './areas';
import { readStreamingFeatures, sourceRecord } from '../usp/ingestion/streaming-vector-reader';

const nyc = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const niagara = 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson';

for (const path of [nyc, niagara]) {
  test(`import locators equal reader records on real bytes: ${path}`, async () => {
    const bytes = readFileSync(path);
    const data = JSON.parse(bytes.toString());
    const ranges = await importedGeojsonRanges(bytes, data, []);
    assert.equal(ranges.size, data.features.length);
    let compared = 0;
    await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
      if (path === niagara && item.index >= 1000 && item.index < data.features.length - 1000) return;
      const record = sourceRecord(item);
      const range = ranges.get(item.index)!;
      assert.deepEqual([range.byteStart, range.byteEnd, range.rawSha256],
        [record.byteStart, record.byteEnd, record.rawSha256]);
      compared++;
    });
    assert.equal(compared, path === niagara ? 2000 : 1662);
  });
}

test('quarantine does not renumber accepted indexes; one unpaired candidate discards all ranges', async () => {
  const bytes = readFileSync(nyc);
  const data = JSON.parse(bytes.toString());
  const candidates = [0, 1323, 1620].map(sourceFeatureIndex => ({ sourceFeatureIndex,
    sourceGeometry: data.features[sourceFeatureIndex].geometry,
    properties: { doitt_id: data.features[sourceFeatureIndex].properties.doitt_id } }));
  const ranges = await importedGeojsonRanges(bytes, data, candidates);
  assert.equal(ranges.get(1323)?.featureIndex, 1323);
  candidates[1].sourceFeatureIndex = 999999;
  assert.equal((await importedGeojsonRanges(bytes, data, candidates)).size, 0);
});

test('a geometry whose positions carry heights still pairs with its raw feature', async () => {
  const bytes = readFileSync(niagara);
  const data = JSON.parse(bytes.toString());
  const candidates = [0, 1, data.features.length - 1].map(sourceFeatureIndex => ({ sourceFeatureIndex,
    sourceGeometry: JSON.parse(JSON.stringify(data.features[sourceFeatureIndex].geometry)), properties: {} }));
  assert.equal(candidates[0].sourceGeometry.coordinates[0][0].length, 3);
  assert.equal((await importedGeojsonRanges(bytes, data, candidates)).size, data.features.length);
  candidates[0].sourceGeometry.coordinates[0][0] = candidates[0].sourceGeometry.coordinates[0][0].slice(0, 2);
  assert.equal((await importedGeojsonRanges(bytes, data, candidates)).size, 0);
});

test('a features-first collection is framed once its root closes; a BOM-led file still gets no ranges', async () => {
  const original = JSON.parse(readFileSync(nyc, 'utf8'));
  // Ordering/BOM syntax controls only; all geographical facts remain the real original.
  const reordered = Buffer.from(JSON.stringify({ features: original.features, type: 'FeatureCollection' }));
  const rows = JSON.parse(reordered.toString()).features;
  const ranges = await importedGeojsonRanges(reordered, { features: rows }, []);
  assert.equal(ranges.size, original.features.length);
  for (const [index, range] of ranges) {
    assert.equal(range.featureIndex, index);
    assert.deepEqual(JSON.parse(reordered.subarray(range.byteStart, range.byteEnd).toString()), rows[index]);
  }
  const bom = Buffer.concat([Buffer.from([239, 187, 191]), readFileSync(nyc)]);
  assert.equal((await importedGeojsonRanges(bom, original, [])).size, 0);
});
