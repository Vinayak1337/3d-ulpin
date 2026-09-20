import test from 'node:test';
import assert from 'node:assert/strict';
import type { AreaContext, PhysicalFeature } from '../packages/contracts/src';
import { scopedSvg } from '../apps/web/features/officer/shared/export-svg';
import { allExportIncludes, exportPreview } from '../apps/web/features/officer/shared/export-model';

const feature = (id: string, geometry: PhysicalFeature['geometry'], properties = {}) => ({
  id, identifier: `3DU:${id}`, name: id, kind: 'building', geometry,
  geographicGeometry: geometry, revision: 3, sourceRevisionId: `source-${id}`,
  properties, worldStatus: 'synthetic',
}) as PhysicalFeature;
const context = {
  area: { id: 'area', name: 'Export test', revision: 4 },
  features: [
    feature('A', { type: 'Polygon', coordinates: [[[0,0],[10,0],[10,8],[0,8],[0,0]],[[2,2],[2,4],[4,4],[4,2],[2,2]]] }),
    feature('B', { type: 'Polygon', coordinates: [[[100,0],[110,0],[110,8],[100,8],[100,0]]] }),
  ], packages: [], latestCheck: null,
} as unknown as AreaContext;

test('one-feature SVG agrees with preview and excludes unrelated geometry and receipts', () => {
  const svg = scopedSvg(context, 'A');
  const preview = exportPreview({ context, scope: 'A', includes: allExportIncludes });
  assert.equal((svg.match(/data-feature-id=/g) ?? []).length, preview.features);
  assert.match(svg, /data-feature-id="A"/);
  assert.match(svg, /data-ulpin="3DU:A"/);
  assert.match(svg, /source-A/);
  assert.doesNotMatch(svg, /source-B|data-feature-id="B"|M100,/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /M2,-2 L2,-4 L4,-4 L4,-2 L2,-2 Z/);
});

test('whole dataset includes both features without modifying original coordinates', () => {
  const before = JSON.stringify(context);
  const svg = scopedSvg(context, '');
  assert.equal((svg.match(/data-feature-id=/g) ?? []).length, 2);
  assert.match(svg, /M100,0 L110,0 L110,-8/);
  assert.equal(JSON.stringify(context), before);
});

test('missing scope and empty datasets fail rather than export another property', () => {
  assert.throws(() => scopedSvg(context, 'missing'), /no longer in this dataset/);
  assert.throws(() => scopedSvg({ ...context, features: [] }, ''), /no geometry/);
});

test('mixed geometry and source attribution survive while hostile labels remain inert', () => {
  const mixed = { ...context, features: [feature('mixed', { type: 'GeometryCollection', geometries: [
    { type: 'Point', coordinates: [7,9] }, { type: 'LineString', coordinates: [[0,0],[10,5]] },
  ] }, { attribution: 'Google Open Buildings · OpenStreetMap' })] };
  mixed.features[0].name = '<script>alert("x")</script>';
  const svg = scopedSvg(mixed, '');
  assert.match(svg, /cx="7" cy="-9"/);
  assert.match(svg, /d="M0,0 L10,-5" fill="none"/);
  assert.match(svg, /Google Open Buildings V3/);
  assert.match(svg, /© OpenStreetMap contributors/);
  assert.match(svg, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script|onload=/);
});
