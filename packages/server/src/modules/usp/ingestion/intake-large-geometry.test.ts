import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamedMappingPlanSchema, StreamedProfileGenerationSchema } from '@ulpin/contracts/usp';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { intakeLargeHoldsReason } from './intake-large';
import { intakeLargeGeometryProjection, intakeLargeSetAside } from './intake-large-worker';
import type { IntakeLargeState } from './intake-ledger';
import { pairMappedFeatures } from './intake-package-cuts';
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
function recordsFor(geometries: unknown[]) {
  let start = 0;
  return geometries.map((geometry, index) => {
    const feature = { type: 'Feature', properties: { sourceKey: `synthetic-${index}` }, geometry };
    const raw = Buffer.from(JSON.stringify(feature));
    const record = sourceRecord({ index, start, end: start + raw.length, raw, feature, valueIssueCode: null });
    start += raw.length + 1;
    assert.equal(record.disposition, 'accepted');
    return record;
  });
}

function profileFor(...geometries: unknown[]) {
  const { inventory } = advanceStreamedInventory(emptyInventory(), recordsFor(geometries));
  return StreamedProfileGenerationSchema.parse({ version: 'streamed-profile/1', jobId: profileJobId,
    rawJobId, source: { sourceId, familyId: sourceId, sourceRevision: 1, sourceSha256: hash,
      schemaFingerprint: hash }, readerSha256: hash, profilerSha256: hash, generation: 1,
    generationHash: hash, previousHash: null, coverage: 'sealed', rawChunkIndex: null,
    rawResultSha256: null, ...inventory, unknownRemainder: false, quarantineLocators: [],
    reference: { sourceCrs: 'EPSG:4326', evidence: 'Synthetic protocol', unit: 'degree',
      globalPlacement: 'not_qualified' } });
}

const square = (x: number) => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] });
const mixedGeometries = [square(0), { type: 'Point', coordinates: [0, 0] },
  { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, square(2), { type: 'MultiPoint', coordinates: [[0, 0]] }];

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
  const profile = profileFor(square(0));
  assert.equal(compileStreamedMapping(planFor(profile, 'building'), profile).kind, 'building');
  const mixed = { ...profile, geometryTypes: ['Point', 'Polygon'] };
  assert.equal(compileStreamedMapping(planFor(mixed, 'building'), mixed).kind, 'building');
});

test('a mixed large file maps only its polygons as buildings and counts what it sets aside by kind', () => {
  const records = recordsFor(mixedGeometries), profile = profileFor(...mixedGeometries);
  const fold = { after: -1, conflicts: new Set<number>() };
  for (const [kind, drawn] of [['building', [0, 3]], ['road', [0, 1, 2, 3, 4]]] as const) {
    const plan = planFor(profile, kind);
    const observed = normalizeMappedChunk(records, plan, profile, rawJobId, 0, []).records;
    assert.deepEqual(observed.map(item => item.disposition), Array(5).fill('observed'));
    const paired = pairMappedFeatures(records, observed, { ...fold, kind });
    assert.deepEqual(paired.map(item => item.raw.featureIndex), drawn);
  }
  const summary = { rawJobId, counts: { Polygon: 2, Point: 1, LineString: 1, MultiPoint: 1 } };
  const setAside = intakeLargeSetAside('building', summary, rawJobId, 5);
  assert.deepEqual(setAside, { kind: 'building', counts: { Point: 1, LineString: 1, MultiPoint: 1 } });
  assert.equal(intakeLargeSetAside('road', summary, rawJobId, 5), undefined);
  assert.equal(intakeLargeSetAside('building', summary, rawJobId, 4), undefined, 'a summary short of a record');
  assert.equal(intakeLargeHoldsReason({ recordsRead: 5, accepted: 2, packages: 1, readerRejected: 0,
    duplicates: 0, oversized: 0, setAside }),
  '5 records read; 2 in 1 packages. 2 pins and 1 line are kept in the original but not drawn as buildings.');
});

test('an all-polygon large file pairs every observed feature and sets nothing aside, as before', () => {
  const polygons = [square(0), square(2)];
  const records = recordsFor(polygons), profile = profileFor(...polygons);
  const observed = normalizeMappedChunk(records, planFor(profile, 'building'), profile, rawJobId, 0, []).records;
  const paired = pairMappedFeatures(records, observed, { after: -1, conflicts: new Set(), kind: 'building' });
  assert.deepEqual(paired, records.map((raw, index) => ({ raw, mapped: observed[index], feature: raw.feature })));
  assert.equal(intakeLargeSetAside('building', { rawJobId, counts: { Polygon: 2 } }, rawJobId, 2), undefined);
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
