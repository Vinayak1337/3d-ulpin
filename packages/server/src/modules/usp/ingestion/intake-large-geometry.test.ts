import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamedMappingPlanSchema, StreamedProfileGenerationSchema } from '@ulpin/contracts/usp';
import { intakeLargeGeometryProjection } from './intake-large-worker';
import type { IntakeLargeState } from './intake-ledger';
import { compileStreamedMapping } from './streamed-mapping';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { sourceRecord } from './streaming-vector-reader';

const rawJobId = '33000000-0000-4000-8000-000000000001';
const profileJobId = '33000000-0000-4000-8000-000000000002';
const sourceId = '33000000-0000-4000-8000-000000000003';
const hash = 'a'.repeat(64);
const projection: IntakeLargeState = { state: 'probed', placement: 'needs_answer', planRef: null,
  recordsSeen: 3, partsPlanned: null, partsDone: 1, limitReason: 'State the kind of feature.' };

// Synthetic test_only unit shapes, never operational records or evaluation truth.
function profileFor(geometry: unknown) {
  const feature = { type: 'Feature', properties: { sourceKey: 'synthetic' }, geometry };
  const raw = Buffer.from(JSON.stringify(feature));
  const record = sourceRecord({ index: 0, start: 0, end: raw.length, raw, feature, valueIssueCode: null });
  assert.equal(record.disposition, 'accepted');
  const { inventory } = advanceStreamedInventory(emptyInventory(), [record]);
  return StreamedProfileGenerationSchema.parse({ version: 'streamed-profile/1', jobId: profileJobId,
    rawJobId, source: { sourceId, familyId: sourceId, sourceRevision: 1, sourceSha256: hash,
      schemaFingerprint: hash }, readerSha256: hash, profilerSha256: hash, generation: 1,
    generationHash: hash, previousHash: null, coverage: 'sealed', rawChunkIndex: null,
    rawResultSha256: null, ...inventory, unknownRemainder: false, quarantineLocators: [],
    reference: { sourceCrs: 'EPSG:4326', evidence: 'Synthetic protocol', unit: 'degree',
      globalPlacement: 'not_qualified' } });
}

function planFor(profile: ReturnType<typeof profileFor>, kind: 'building' | 'road') {
  return StreamedMappingPlanSchema.parse({ version: 'streamed-mapping/1', mode: 'streamed_mapping',
    scope: 'accepted_source_features', caseId: sourceId, caseRevision: 1, source: profile.source, rawJobId,
    profileJobId, profileGeneration: 1, profileHash: hash, kind, basis: 'officer_stated', semanticEvidence: [],
    operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/properties/sourceKey',
        conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] });
}

test('read points and lines offer no building footprint mapping; an explicit compatible role still works', () => {
  for (const geometry of [{ type: 'Point', coordinates: [0, 0] },
    { type: 'LineString', coordinates: [[0, 0], [1, 1]] }]) {
    const profile = profileFor(geometry);
    assert.deepEqual(profile.geometryTypes, [geometry.type]);
    assert.throws(() => compileStreamedMapping(planFor(profile, 'building'), profile),
      { status: 422, code: 'STREAMED_MAPPING_GEOMETRY' });
    assert.equal(compileStreamedMapping(planFor(profile, 'road'), profile).kind, 'road');
  }
  const profile = profileFor({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
  assert.equal(compileStreamedMapping(planFor(profile, 'building'), profile).kind, 'building');
  const mixed = { ...profile, geometryTypes: ['Point', 'Polygon'] };
  assert.throws(() => compileStreamedMapping(planFor(mixed, 'building'), mixed),
    { code: 'STREAMED_MAPPING_GEOMETRY' });
});

test('officer words count accepted features by kind from the matching summary only', () => {
  const summary = { rawJobId, counts: { Point: 2, LineString: 1 } };
  const result = intakeLargeGeometryProjection(projection, summary, rawJobId, 3);
  assert.equal(result.state, 'read');
  assert.equal(result.placement, 'needs_answer', 'a compatible role can still be stated explicitly');
  assert.equal(result.limitReason, 'Read 2 Point features / 1 LineString feature; they are not footprints. '
    + 'State the kind of feature.');
  assert.equal(result.recordsSeen, 3);
  const mixed = intakeLargeGeometryProjection(projection,
    { rawJobId, counts: { MultiPoint: 1, MultiLineString: 1, Polygon: 1 } }, rawJobId, 3);
  assert.equal(mixed.state, 'probed');
  assert.match(mixed.limitReason!, /^Read 1 MultiPoint feature \/ 1 MultiLineString feature;/);
  for (const invalid of [undefined, { ...summary, rawJobId: sourceId }, { rawJobId, counts: { Point: 1 } },
    { rawJobId, counts: { Point: 3, GeometryCollection: 1 } }]) {
    assert.equal(intakeLargeGeometryProjection(projection, invalid, rawJobId, 3), projection);
  }
});

test('polygon-only projection is unchanged byte for byte and absent historical summaries stay unknown', () => {
  const before = JSON.stringify(projection);
  const after = intakeLargeGeometryProjection(projection, { rawJobId, counts: { Polygon: 3 } }, rawJobId, 3);
  assert.equal(JSON.stringify(after), before);
  assert.equal(after, projection);
  assert.equal(intakeLargeGeometryProjection(projection, undefined, rawJobId, 3), projection);
});
