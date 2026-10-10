import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { RetainedImagery, SpatialMlItem } from '@ulpin/contracts';
import { geographicMlComponent, projectedGeographicComponents } from './spatial-ml-georeference';
import type { PoolClient } from 'pg';
import { spatialMlFootprintDraftSchema } from './spatial-ml-footprints';
import { imageryOriginalUrl } from '../areas/canonical-area';

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

test('pre-inference imagery overlays use the published original-file route, not an unregistered case subroute', () => {
  assert.equal(imageryOriginalUrl(chip.sourceId), `/api/v1/sources/${chip.sourceId}/file`);
});

test('changed original hash or image grid fails closed before georeferencing', () => {
  assert.throws(() => geographicMlComponent(item, {
    ...chip, sourceSha256: '0'.repeat(64),
  }, component), /exact retained/);
  assert.throws(() => geographicMlComponent(item, { ...chip, width: chip.width + 1 }, component), /exact retained/);
});

test('projection SELECT types its CRS and unary-negated origins to avoid PostgreSQL 42725', async () => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => {
    queries.push(sql);
    return { rows: [{ geometry: component.geometry }] };
  } } as unknown as PoolClient;
  const reference = { sourceCrs: 'EPSG:4326', analysisCrs: 'EPSG:6933' as const, origin: [0, 0] as [number, number],
    anchor: [0, 0] as [number, number], verticalReference: 'unknown', transformVersion: 'fixture-only' };
  await projectedGeographicComponents(client, [component], reference);
  assert.match(queries[0], /\$2::integer/);
  assert.match(queries[0], /-\(\$3::double precision\)/);
  assert.match(queries[0], /-\(\$4::double precision\)/);
});

test('footprint adapter accepts exact TIFF reference and rejects requests with no reference', () => {
  const input = { requestKey: item.id, expectedRevision: 2, expectedAreaRevision: 1,
    selections: [{ componentId: component.id, subject: 'test-only candidate' }] };
  assert(spatialMlFootprintDraftSchema.safeParse({ ...input, georeference: 'source_geotiff' }).success);
  assert(!spatialMlFootprintDraftSchema.safeParse(input).success);
});
