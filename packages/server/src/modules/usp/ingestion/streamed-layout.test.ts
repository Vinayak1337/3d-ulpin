import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamedMappingPlanSchema, StreamedPrefixMappingPlanSchema, type StreamedProfileGeneration,
  type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { assertIntegerKeyTokens } from './proved-area-part';
import { advanceStreamedInventory, emptyInventory } from './streamed-profile-inventory';
import { compileStreamedMapping } from './streamed-mapping';

const hash = 'b'.repeat(64);
const ids = { sourceId: '11111111-1111-4111-8111-111111111111', familyId: '22222222-2222-4222-8222-222222222222',
  caseId: '33333333-3333-4333-8333-333333333333', jobId: '44444444-4444-4444-8444-444444444444',
  rawJobId: '55555555-5555-4555-8555-555555555555' };
const source = { sourceId: ids.sourceId, familyId: ids.familyId, sourceRevision: 1, sourceSha256: 'a'.repeat(64),
  schemaFingerprint: hash };
const path = (name: string, types: string[], extra: object = {}) => ({ path: name, types, values: 3,
  explicitNull: 0, absent: 0, unknown: 0, ...extra });

function profile(patch: Partial<StreamedProfileGeneration> = {}): StreamedProfileGeneration {
  return { version: 'streamed-profile/1', jobId: ids.jobId, rawJobId: ids.rawJobId, source,
    readerSha256: 'c'.repeat(64), profilerSha256: 'd'.repeat(64), generation: 1, generationHash: hash,
    previousHash: 'e'.repeat(64), coverage: 'sealed', rawChunkIndex: null, rawResultSha256: null,
    recordsSeen: 3, accepted: 3, quarantined: 0, unknownRemainder: false,
    paths: [path('/features/*/geometry', ['object']), path('/features/*/properties/NAME', ['string']),
      path('/features/*/properties/OBJECTID', ['number'], { integers: 3 })],
    geometryTypes: ['MultiPolygon', 'Polygon'], quarantineLocators: [],
    reference: { sourceCrs: 'EPSG:2958', evidence: 'Declared in the file', unit: 'metre',
      globalPlacement: 'not_qualified' }, ...patch } as StreamedProfileGeneration;
}
const key = { target: 'feature.sourceKey', sourcePath: '/features/*/properties/OBJECTID',
  conversionId: 'literal_integer_identifier@1' };
const geometry = { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' };
function plan(patch: Record<string, unknown> = {}) {
  return StreamedMappingPlanSchema.parse({ version: 'streamed-mapping/1', scope: 'accepted_source_features',
    mode: 'streamed_mapping', source, caseId: ids.caseId, caseRevision: 0, rawJobId: ids.rawJobId,
    profileJobId: ids.jobId, profileGeneration: 1, profileHash: hash, kind: 'parcel',
    operations: [key, geometry], semanticEvidence: [], basis: 'officer_stated', ...patch });
}

test('a large parcel layout compiles to the kind and key the small layout gives', () => {
  assert.deepEqual(compileStreamedMapping(plan(), profile()),
    { kind: 'parcel', geometryRole: 'unknown', idField: 'OBJECTID' });
  const named = plan({ operations: [key, geometry,
    { target: 'feature.name', sourcePath: '/features/*/properties/NAME', conversionId: 'literal_text@1' }] });
  assert.equal(compileStreamedMapping(named, profile()).nameField, 'NAME');
});

test('a kind the file cannot carry is refused with the small layout words; roads take lines', () => {
  const lines = profile({ geometryTypes: ['LineString'] });
  assert.throws(() => compileStreamedMapping(plan(), lines), { status: 422, code: 'STREAMED_MAPPING_GEOMETRY',
    message: 'The layout states parcel, which does not accept LineString geometry. '
      + 'Choose a compatible kind; no kind is inferred.' });
  assert.equal(compileStreamedMapping(plan({ kind: 'road' }), lines).kind, 'road');
});

test('a whole-number identifier needs every accepted value whole', () => {
  const words = { status: 422, code: 'STREAMED_MAPPING_COVERAGE',
    message: 'Source identity must be complete, unique whole-number tokens within the exact integer range.' };
  for (const integers of [2, undefined]) {
    const paths = profile().paths.map(item => item.path.endsWith('OBJECTID') ? { ...item, integers } : item);
    assert.throws(() => compileStreamedMapping(plan(), profile({ paths })), words);
  }
  const text = plan({ operations: [{ ...key, conversionId: 'literal_identifier@1' }, geometry] });
  assert.throws(() => compileStreamedMapping(text, profile()), { code: 'STREAMED_MAPPING_COVERAGE',
    message: 'Source identity must be complete, unique, nonempty literal text.' });
});

test('the older building layout keeps its targets and reads degrees only', () => {
  const building = plan({ kind: undefined, operations: [
    { target: 'building.sourceKey', sourcePath: '/features/*/properties/NAME', conversionId: 'literal_identifier@1' },
    { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' }] });
  const degrees = profile({ reference: { sourceCrs: 'EPSG:4326', evidence: 'none', unit: 'degree',
    globalPlacement: 'not_qualified' } });
  assert.deepEqual(compileStreamedMapping(building, degrees), { kind: 'building', geometryRole: 'unknown',
    idField: 'NAME' });
  assert.throws(() => compileStreamedMapping(building, profile()), { code: 'STREAMED_MAPPING_GEOMETRY',
    message: "The older building layout reads longitude and latitude only. State the kind of feature so the layout "
      + "reads the file's declared coordinate system." });
  assert.throws(() => plan({ operations: building.operations }), /Choose one feature source key and geometry/);
});

test('the profile counts whole numbers among values', () => {
  const record = (featureIndex: number, value: unknown) => ({ featureIndex, byteStart: featureIndex * 10,
    byteEnd: featureIndex * 10 + 9, rawSha256: hash, disposition: 'accepted', issueCode: null,
    feature: { type: 'Feature', properties: { OBJECTID: value }, geometry: { type: 'Point', coordinates: [0, 0] } },
  }) as StreamingVectorRecord;
  const { inventory } = advanceStreamedInventory(emptyInventory(), [record(0, 7), record(1, 7.5), record(2, '8')]);
  const counted = inventory.paths.find(item => item.path.endsWith('OBJECTID'))!;
  assert.deepEqual([counted.values, counted.integers], [3, 1]);
});

test('the mapped worker copies a whole-number key as its digits and reserves it as before', () => {
  const records = [17, 4.5, 17].map((value, featureIndex) => ({ featureIndex, byteStart: featureIndex * 10,
    byteEnd: featureIndex * 10 + 9, rawSha256: hash, disposition: 'accepted', issueCode: null,
    feature: { type: 'Feature', properties: { NAME: 'n', OBJECTID: value },
      geometry: { type: 'Polygon', coordinates: [] } } })) as StreamingVectorRecord[];
  const result = normalizeMappedChunk(records, plan(), profile(), ids.rawJobId, 0, []);
  assert.deepEqual(result.records.map(item => [item.sourceKey.state, item.sourceKey.value, item.disposition]),
    [['known', '17', 'observed'], ['unknown', null, 'unresolved'], ['conflicting', '17', 'unresolved']]);
  assert.deepEqual(result.keys.map(item => [item.value, item.firstIndex, item.laterIndex]),
    [['17', 0, null], ['17', 0, 2]]);
});

test('streamed mixed names use every outline across chunks and leave set-aside names unknown', () => {
  // test_only: literal polygons, pin and line; no operational records.
  const records = ['Polygon', 'Point', 'Polygon', 'LineString'].map((type, featureIndex) => ({
    featureIndex, byteStart: featureIndex * 10, byteEnd: featureIndex * 10 + 9, rawSha256: hash,
    disposition: 'accepted', issueCode: null, feature: { type: 'Feature', geometry: { type, coordinates: [] },
      properties: { OBJECTID: featureIndex, ...(type === 'Polygon' ? { NAME: 'Fixture outline' } : {}) } },
  })) as StreamingVectorRecord[];
  const named = plan({ operations: [key, geometry,
    { target: 'feature.name', sourcePath: '/features/*/properties/NAME', conversionId: 'literal_text@1' }] });
  const inventoried = () => {
    const first = advanceStreamedInventory(emptyInventory(), records.slice(0, 2)).inventory;
    return profile(advanceStreamedInventory(first, records.slice(2)).inventory);
  };
  const mixed = inventoried();
  assert.equal(compileStreamedMapping(named, mixed).nameField, 'NAME');
  assert.throws(() => compileStreamedMapping({ ...named, kind: 'road' }, mixed),
    { code: 'STREAMED_MAPPING_COVERAGE' });
  const line = records[3].feature as { properties: Record<string, unknown> };
  line.properties.NAME = 'Fixture line name that must not be copied';
  const mapped = normalizeMappedChunk(records, named, inventoried(), ids.rawJobId, 0, []);
  assert.deepEqual(mapped.records.map(record => [record.name.state, record.name.value]),
    [['known', 'Fixture outline'], ['unknown', null], ['known', 'Fixture outline'], ['unknown', null]]);
  assert.deepEqual(mapped.records.filter(record => record.name.state === 'unknown')
    .map(record => record.issueCodes.includes('GEOMETRY_KIND')), [true, true]);
  const properties = (records[2].feature as { properties: Record<string, unknown> }).properties;
  for (const value of [undefined, null, 7]) {
    properties.NAME = value;
    if (value === undefined) delete properties.NAME;
    assert.throws(() => compileStreamedMapping(named, inventoried()), { code: 'STREAMED_MAPPING_COVERAGE' });
  }
});

test('prefix admission maps later compatible chunks and holds later drift against the unchanged prefix pins', () => {
  // test_only: five raw chunk records, not registry records or evaluation truth.
  const records = [1, 2, 'changed-type', undefined, 5].map((value, featureIndex) => ({
    featureIndex, byteStart: featureIndex * 10, byteEnd: featureIndex * 10 + 9, rawSha256: hash,
    disposition: 'accepted', issueCode: null, feature: { type: 'Feature',
      properties: { ...(value === undefined ? {} : { OBJECTID: value }), NAME: 'Fixture' },
      geometry: { type: 'Polygon', coordinates: [] } },
  })) as StreamingVectorRecord[];
  const observed = profile({ ...advanceStreamedInventory(emptyInventory(), records.slice(0, 1)).inventory,
    generation: 0, coverage: 'provisional', unknownRemainder: true, rawChunkIndex: 0, rawResultSha256: hash });
  const prefix = StreamedPrefixMappingPlanSchema.parse({ ...plan(), version: 'streamed-prefix-mapping/1',
    scope: 'observed_prefix_and_later_compatible_features', profileGeneration: 0,
    prefix: { throughRawChunkIndex: 0, rawResultSha256: hash, recordsSeen: 1, accepted: 1 } });
  const result = records.map((record, index) => normalizeMappedChunk([record], prefix, observed,
    ids.rawJobId, index, []));
  assert.deepEqual(result.map(chunk => chunk.records[0].disposition),
    ['observed', 'observed', 'unresolved', 'unresolved', 'observed']);
  assert(result[2].records[0].issueCodes.includes('SCHEMA_DRIFT_TYPE'));
  assert(result[3].records[0].issueCodes.includes('SCHEMA_DRIFT_ABSENT'));
  assert(result.every(chunk => chunk.schemaFingerprint === observed.source.schemaFingerprint));
});

test('a part refuses a whole-number key the file does not write as plain digits', () => {
  const raw = (token: string) => Buffer.from(`{"type":"Feature","properties":{"OBJECTID":${token}},"geometry":null}`);
  assert.doesNotThrow(() => assertIntegerKeyTokens(plan(), [raw('12'), raw('-3'), raw('0')]));
  for (const token of ['12.0', '1.2e1', '-0', '"12"'])
    assert.throws(() => assertIntegerKeyTokens(plan(), [raw('12'), raw(token)]), { code: 'PART_INTEGER_IDENTIFIER' });
  const text = plan({ operations: [{ ...key, conversionId: 'literal_identifier@1' }, geometry] });
  assert.doesNotThrow(() => assertIntegerKeyTokens(text, [raw('12.0')]));
});
