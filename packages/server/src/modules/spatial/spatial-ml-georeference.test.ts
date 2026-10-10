import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { RetainedImagery, SpatialMlItem } from '@ulpin/contracts';
import { geographicMlComponent } from './spatial-ml-georeference';
import { spatialMlFootprintDraftSchema } from './spatial-ml-footprints';

const evidence = 'docs/evidence/gf-backend/k2c';
const imagery: RetainedImagery = JSON.parse(readFileSync(`${evidence}/imagery-import.json`, 'utf8')).imagery;
const items: SpatialMlItem[] = JSON.parse(readFileSync(`${evidence}/inference-items.json`, 'utf8'));
const item = items.find(value => value.result?.components.length)!;
const chip = imagery.chips.find(value => value.sourceId === item.sourceRevisionId)!;
const component = item.result!.components[0];

test('real retained Karnataka pixels use their exact source affine, not invented calibration controls', () => {
  const projected = geographicMlComponent(item, chip, component);
  const original = component.geometry.type === 'Polygon'
    ? component.geometry.coordinates[0][0] : component.geometry.coordinates[0][0][0];
  const point = projected.geometry.type === 'Polygon'
    ? projected.geometry.coordinates[0][0] : projected.geometry.coordinates[0][0][0];
  assert.equal(point[0], chip.affine[0] * original[0] + chip.affine[2]);
  assert.equal(point[1], chip.affine[4] * original[1] + chip.affine[5]);
  assert.equal(projected.id, component.id);
  assert.equal(projected.score, component.score);
});

test('changed original hash or image grid fails closed before georeferencing', () => {
  assert.throws(() => geographicMlComponent(item, { ...chip, sourceSha256: '0'.repeat(64) }, component), /exact retained/);
  assert.throws(() => geographicMlComponent(item, { ...chip, width: chip.width + 1 }, component), /exact retained/);
});

test('footprint adapter accepts exact TIFF reference and rejects requests with no reference', () => {
  const input = { requestKey: item.id, expectedRevision: 2, expectedAreaRevision: 1,
    selections: [{ componentId: component.id, subject: 'test-only candidate' }] };
  assert(spatialMlFootprintDraftSchema.safeParse({ ...input, georeference: 'source_geotiff' }).success);
  assert(!spatialMlFootprintDraftSchema.safeParse(input).success);
});
