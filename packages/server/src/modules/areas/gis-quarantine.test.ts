import assert from 'node:assert/strict';
import test from 'node:test';
import { setAsideWords } from '../usp/ingestion/registry';
import { gisQuarantine, withSetAside } from './gis-quarantine';

// Synthetic test_only shapes and the normalizer's own per-feature rejection form; no operational record.
const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const features = [square, { type: 'Point', coordinates: [0, 0] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  { type: 'Point', coordinates: [2, 2] }, { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0], [0, 0]]] }]
  .map((geometry, index) => ({ type: 'Feature', properties: { id: `f${index}` }, geometry }));
const data = { type: 'FeatureCollection', features };
const rejection = (featureIndex: number, code: 'GEOMETRY_KIND' | 'INVALID_GEOMETRY') => ({ featureIndex,
  sourceKey: `f${featureIndex}`, code, reason: code === 'GEOMETRY_KIND'
    ? 'building requires Polygon or MultiPolygon geometry.' : 'Self-intersection.' });
const mixed = { total: 5, accepted: 1, rejected: 4, rejections: [rejection(1, 'GEOMETRY_KIND'),
  rejection(2, 'GEOMETRY_KIND'), rejection(3, 'GEOMETRY_KIND'), rejection(4, 'INVALID_GEOMETRY')] };

test('the normalizer sets pins and lines aside under an outline kind; the package counts them by kind', () => {
  const disposition = withSetAside(mixed, 'building', data)!;
  assert.deepEqual(disposition.setAside, { kind: 'building', counts: { Point: 2, LineString: 1 } });
  const quarantine = gisQuarantine(disposition, 'a'.repeat(64))!;
  assert.deepEqual(quarantine.setAside, disposition.setAside);
  assert.equal(quarantine.rejected, 4, 'every rejection stays listed with its own reason');
  assert.equal(setAsideWords(quarantine.setAside),
    '2 pins and 1 line are kept in the original but not drawn as buildings.');
  assert.equal(setAsideWords({ kind: 'parcel', counts: { MultiPoint: 1 } }),
    '1 pin is kept in the original but not drawn as land parcels.');
});

test('the REH16 NYC summary is one plain sentence and keeps the original without repairs', () => {
  const disposition = { total: 1662, accepted: 1661, rejected: 1, rejections: [{ featureIndex: 1322,
    sourceKey: null, code: 'INVALID_GEOMETRY' as const,
    reason: 'Ring Self-intersection[-74.003625525124 40.72574597286]' }] };
  const quarantine = gisQuarantine(disposition, 'a'.repeat(64))!;
  assert.equal(quarantine.message, '1661 of 1662 source features accepted; 1 skipped (first reason: '
    + 'an outline ring crosses itself at coordinates -74.003625525124 40.72574597286); '
    + 'the original is kept unchanged and no geometry was repaired.');
  assert.doesNotMatch(quarantine.message, /\b[A-Z][A-Z_]+\b|\.\s+[A-Z]/);
  assert.deepEqual(quarantine.rejections, disposition.rejections, 'the exact code and reason stay structured');
  assert.equal(gisQuarantine(mixed, 'a'.repeat(64))!.message,
    '1 of 5 source features accepted; 4 skipped (first reason: building requires an outline or a group of outlines); '
      + 'the original is kept unchanged and no geometry was repaired.');
});

test('nothing is counted aside for an all-polygon file, a line kind, or geometry without a GeoJSON kind', () => {
  const polygons = { total: 2, accepted: 2, rejected: 0, rejections: [] };
  const before = JSON.stringify(polygons);
  assert.equal(withSetAside(polygons, 'building', data), polygons);
  assert.equal(JSON.stringify(gisQuarantine(withSetAside(polygons, 'building', data), 'a'.repeat(64))), undefined);
  assert.equal(JSON.stringify(polygons), before);
  assert.equal(withSetAside(undefined, 'building', data), undefined);
  assert.equal(withSetAside(mixed, 'road', data), mixed);
  const arcgis = { features: features.map(feature => ({ attributes: {}, geometry: { x: 0, y: 0 } })) };
  assert.equal(withSetAside(mixed, 'building', arcgis), mixed);
});
