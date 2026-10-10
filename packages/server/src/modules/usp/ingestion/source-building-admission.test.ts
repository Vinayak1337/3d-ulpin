import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SourceBuildingImportSchema } from '@ulpin/contracts';
import { importSourceBuildings } from './source-building-import';
import { assertGeometryFreeFeatures, sourceBuildingClaims, sourceBuildingFeature } from './source-building-values';
import { sourceBuildingOriginalAccessTx } from './source-building-review';
import { sourceAdministrativeContext } from './source-administrative-context';

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
        transcription: { by: 'agent', agent: 'D2-worker' },
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

test('agent transcriptions retain page citations but cannot masquerade as officer-entered source facts', () => {
  const input = SourceBuildingImportSchema.parse(raw);
  const pins = new Map([['sitePlan', {
    sourceId: randomUUID(), sourceRevision: 1, sourceSha256: original.sha256,
  }]]);
  const claims = sourceBuildingClaims(input.buildings[0], randomUUID(), pins);
  assert(claims.every(claim => claim.method === 'ai_extraction' && claim.evidenceState === 'unresolved'));
  assert.equal(claims[0].evidence[0].page, 1);
  assert.deepEqual(claims[0].transcription, { by: 'agent', agent: 'D2-worker' });
  const missing = structuredClone(raw);
  delete (missing.buildings[0].claims[0] as Partial<typeof missing.buildings[0]['claims'][0]>).transcription;
  assert.equal(SourceBuildingImportSchema.safeParse(missing).success, false);
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

test('original-backed manual citations do not require a staged extraction receipt', async () => {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k2-admission-regression';
  const sourceId = randomUUID();
  const caseId = randomUUID();
  const siteId = randomUUID();
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1,
    sha256: original.sha256, bytes: original.bytes, profile: 'source-document-pdf-v1',
    inspection: { documentOriginal: { version: 'source-document/1', subject: 'k2-admission-regression',
      format: 'pdf', sha256: original.sha256, bytes: original.bytes, receivedAt: '2026-10-10T00:00:00Z' } } };
  const client = { query: async (sql: string) => {
    if (sql.startsWith('SELECT case_id')) return { rows: [{ case_id: caseId }] };
    if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{
      id: caseId, revision: 0, archived: false, site_id: siteId, frame: {}, context: [],
    }] };
    if (sql.startsWith('SELECT max(revision)')) return { rows: [{ revision: 1 }] };
    if (sql.startsWith('SELECT * FROM sources')) return { rows: [source] };
    if (sql.startsWith('SELECT archived')) return { rows: [{ archived: false }] };
    throw new Error(`A staged extraction or write was attempted: ${sql}`);
  } } as unknown as PoolClient;
  try {
    assert.equal((await sourceBuildingOriginalAccessTx(client, siteId, sourceId)).sha256, original.sha256);
    await assert.rejects(sourceBuildingOriginalAccessTx(client, randomUUID(), sourceId), /outside its current site/);
  } finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
});

test('real GMDA sectors remain administrative context, never parcel or public-land features', {
  skip: !existsSync('E:/BhuAayam-data/task-data/ulpin-data-09/gmda-sectors-59-63a.json'),
}, () => {
  const manifest = JSON.parse(readFileSync(
    'fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json', 'utf8',
  ));
  const sector = manifest.assets.find((asset: { id: string }) => asset.id === 'gmda-sector-boundaries');
  const input = SourceBuildingImportSchema.parse({
    ...raw, format: 'administrative_context', areaId: randomUUID(), expectedAreaRevision: 0, buildings: [],
    documents: [{ ...raw.documents[0], originalUrl: sector.origin.url,
      sourceSha256: sector.provenance.original.sha256 }],
    administrativeContext: { kind: 'sector', idField: 'FID', nameField: 'Name' },
  });
  const bytes = readFileSync('E:/BhuAayam-data/task-data/ulpin-data-09/gmda-sectors-59-63a.json');
  const context = sourceAdministrativeContext(input, bytes, new Map([['sitePlan', {
    sourceId: randomUUID(), sourceRevision: 1, sourceSha256: sector.provenance.original.sha256,
  }]]));
  assert.deepEqual(context.units.map(unit => unit.name), ['63 A', '59']);
  assert(context.units.every(unit => unit.kind === 'sector'));
  assert.equal(context.sourceCrs, 'EPSG:32643');
  assert.equal(input.buildings.length, 0);
  assert.equal(SourceBuildingImportSchema.safeParse({
    ...input, buildings: raw.buildings,
  }).success, false);
});

test('wrong original pin is refused before any destination, source or identity write', async () => {
  await assert.rejects(importSourceBuildings(raw, [{
    key: 'sitePlan', name: original.externalPath.split('/').at(-1),
    bytes: readFileSync('fixtures/real-area/original.geojson'),
  }]), /declared original pin/);
});
