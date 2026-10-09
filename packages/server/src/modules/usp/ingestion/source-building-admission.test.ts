import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SourceBuildingImportSchema } from '@ulpin/contracts';
import { importSourceBuildings } from './source-building-import';
import { assertGeometryFreeFeatures, sourceBuildingFeature } from './source-building-values';

const truth = JSON.parse(readFileSync(
  'docs/evidence/usp/finale/GF-DATA/storey-truth/demo/haryana-2831-tower3.json', 'utf8',
));
const original = truth.sources.find((source: { externalPath: string }) => (
  source.externalPath.endsWith('site-plan.pdf')
));
const citation = { documentKey: 'sitePlan', page: 1, locator: truth.floorExpression.citations[0].locator };
const raw = {
  format: 'document_buildings', requestKey: randomUUID(), namespace: 'haryana-rera-2831', name: 'TOWER 3',
  documents: [{ key: 'sitePlan', filename: 'haryana-2831-site-plan.pdf', sourceSha256: original.sha256,
    originalUrl: original.url, issuer: 'Haryana RERA', acquiredAt: original.retrievedAt,
    permission: 'unconfirmed', classification: 'test_only' }],
  buildings: [{ sourceKey: 'TOWER 3', name: 'TOWER 3', geometry: null, footprint: null, placement: 'unknown',
    worldStatus: 'planned', citations: [citation],
    claims: truth.documentStatements.filter((statement: { kind: string }) => statement.kind === 'floor_expression')
      .map((statement: { value: string; citation: { page: number; locator: string; quote: string } }) => ({
        property: 'building.storeyLabel', value: statement.value, method: 'source_literal',
        citations: [{ documentKey: 'sitePlan', page: statement.citation.page,
          locator: statement.citation.locator, quote: statement.citation.quote }],
      })) }],
};

function feature() {
  const input = SourceBuildingImportSchema.parse(raw);
  const sourceId = randomUUID();
  return sourceBuildingFeature(input, input.buildings[0], new Map([['sitePlan', {
    sourceId, sourceRevision: 1, sourceSha256: original.sha256,
  }]]), randomUUID(), randomUUID(), 'fixture:source-building-admission');
}

test('real scanned Tower declaration admits null geometry and both literals without a level schedule', () => {
  const input = SourceBuildingImportSchema.parse(raw);
  assert.deepEqual(input.buildings[0].claims.map(claim => claim.value), ['G+41', 'G+42']);
  const building = feature();
  assert.doesNotThrow(() => assertGeometryFreeFeatures([building]));
  assert.equal(building.geometry, null);
  assert.equal(building.height.value, null);
  assert.equal(building.areaM2, null);
  assert.equal(building.placement, 'unknown');
});

test('geometry-free mode cannot downgrade real geometry or fabricated placement into source-only review', () => {
  const nyc = JSON.parse(readFileSync('fixtures/real-area/original.geojson', 'utf8')).features[0];
  const building = feature();
  assert.throws(() => assertGeometryFreeFeatures([{ ...building, geometry: nyc.geometry }]), /analytical geometry/);
  assert.throws(() => assertGeometryFreeFeatures([
    { ...building, geographicGeometry: nyc.geometry },
  ]), /analytical geometry/);
  assert.throws(() => assertGeometryFreeFeatures([
    { ...building, placement: 'source_supported' },
  ]), /analytical geometry/);
  assert.equal(SourceBuildingImportSchema.safeParse({
    ...raw, buildings: [{ ...raw.buildings[0], geometry: nyc.geometry }],
  }).success, false);
});

test('wrong original pin is refused before any destination, source or identity write', async () => {
  await assert.rejects(importSourceBuildings(raw, [{
    key: 'sitePlan', name: original.externalPath.split('/').at(-1),
    bytes: readFileSync('fixtures/real-area/original.geojson'),
  }]), /declared original pin/);
});
