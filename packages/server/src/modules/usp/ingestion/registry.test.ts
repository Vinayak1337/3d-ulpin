import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { MappingPlanSchema, SourceProfileSchema, StreamedPrefixMappingPlanSchema } from '@ulpin/contracts/usp';
import { validateAdaptiveMapping } from './adaptive-mapping';
import type { GisInspection } from '@ulpin/contracts';
import { fingerprint } from '../../cases/domain';
import { sha256 } from '../../../infrastructure/storage';
import { compileMapping, inspectedProfile } from './registry';
import { legacyPlanToV2, mappingContextFromGisProfile } from './mapping-plan-v2';

const id = '10000000-0000-4000-8000-000000000001';
const pin = { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: 'a'.repeat(64),
  schemaFingerprint: 'b'.repeat(64) };
const legacy = { version: 'manual-geojson/1', mode: 'manual_mapping', source: pin, caseId: id,
  workspaceRevision: 1, workspaceFingerprint: 'c'.repeat(64), operations: [
    { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
      conversionId: 'literal_identifier@1' },
    { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
  ] };
// Labelled fixture, not an operational source or a claim about NYC heights.
const fixture = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { doitt_id: 'fixture-height-1', height_ft: '30' }, geometry: {
    type: 'Polygon', coordinates: [[[-74, 40], [-73.9999, 40], [-73.9999, 40.0001], [-74, 40]]],
  } },
  { type: 'Feature', properties: { doitt_id: 'fixture-height-unknown', height_ft: null }, geometry: {
    type: 'Polygon', coordinates: [[[-74, 40.001], [-73.9999, 40.001], [-73.9999, 40.0011], [-74, 40.001]]],
  } },
] };

function profile() {
  const bytes = Buffer.from(JSON.stringify(fixture));
  const inspection = { format: 'geojson', sourceSha256: sha256(bytes), featureCount: 2,
    sourceCrs: 'EPSG:4326', crsEvidence: 'Fixture CRS declaration', geometryTypes: ['Polygon'],
    fields: [{ name: 'doitt_id' }, { name: 'height_ft' }] } as GisInspection;
  const { schemaFingerprint, ...inventory } = inspectedProfile(bytes, inspection);
  return SourceProfileSchema.parse({ ...inventory, source: { ...pin, schemaFingerprint }, caseId: id,
    workspaceRevision: 1, workspaceFingerprint: legacy.workspaceFingerprint });
}

const statedHeight = { heightField: 'height_ft', heightUnit: 'ft',
  heightMeaning: 'Fixture building height above ground' };

test('CA0 legacy layout shape retains bytes, hash and building meaning without inserted defaults', () => {
  const destination = { kind: 'new_area', name: 'Fixture area', namespace: 'fixture' };
  const parsed = MappingPlanSchema.parse(legacy);
  assert.equal(JSON.stringify(parsed), JSON.stringify(legacy));
  assert.equal(fingerprint({ plan: parsed, destination }), fingerprint({ plan: legacy, destination }));
  assert.deepEqual(compileMapping(parsed, profile()), {
    kind: 'building', geometryRole: 'unknown', idField: 'doitt_id',
  });
});

test('height authoring refuses missing unit or meaning, unsupported units and uninspected fields', () => {
  for (const height of [{ heightField: 'height_ft' }, { heightField: 'height_ft', heightUnit: 'ft' },
    { heightField: 'height_ft', heightMeaning: 'Fixture height' }, { heightUnit: 'ft' },
    { ...statedHeight, heightUnit: 'unknown' }, { ...statedHeight, heightMeaning: '  ' }]) {
    assert(!MappingPlanSchema.safeParse({ ...legacy, ...height }).success);
  }
  const parsed = MappingPlanSchema.parse({ ...legacy, ...statedHeight });
  assert.deepEqual(compileMapping(parsed, profile()), {
    kind: 'building', geometryRole: 'unknown', idField: 'doitt_id', ...statedHeight,
  });
  assert.throws(() => compileMapping({ ...parsed, heightField: 'not_inspected' }, profile()),
    { code: 'MAPPING_HEIGHT' });
  assert.notEqual(fingerprint(parsed), fingerprint(legacy));
  const padded = MappingPlanSchema.parse({ ...legacy, ...statedHeight,
    heightMeaning: `  ${statedHeight.heightMeaning}  ` });
  assert.equal(padded.heightMeaning, statedHeight.heightMeaning, 'Meaning trims exactly as direct import does.');
});

test('the same feet fixture normalizes equally through a layout and direct mapping; null never becomes zero', t => {
  const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
  if (!existsSync(python)) return t.skip('The project-owned geo interpreter is not available.');
  const compiled = compileMapping(MappingPlanSchema.parse({ ...legacy, ...statedHeight }), profile());
  const direct = { kind: 'building', geometryRole: 'unknown', idField: 'doitt_id', ...statedHeight };
  const input = { data: fixture, format: 'geojson' };
  const code = 'import sys,json;sys.path.insert(0,"services/geo");from geo.area import normalize_area;'
    + 'rows=json.load(sys.stdin);print(json.dumps([normalize_area(row) for row in rows]))';
  const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8', timeout: 30000,
    input: JSON.stringify([{ ...input, mapping: compiled }, { ...input, mapping: direct }]),
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const [layout, imported] = JSON.parse(result.stdout);
  assert.deepEqual(layout, imported);
  assert.equal(layout.features[0].height.value, 30 * 0.3048);
  assert.equal(layout.features[0].height.state, 'source_supported');
  assert.equal(layout.features[0].height.originalUnit, 'ft');
  assert.equal(layout.features[0].height.unit, 'm');
  assert.equal(layout.features[1].height.value, null);
  assert.equal(layout.features[1].height.state, 'unknown');
});

function stated(kind: string) {
  return { ...legacy, kind, operations: [
    { target: 'feature.sourceKey', sourcePath: '/features/*/properties/doitt_id',
      conversionId: 'literal_identifier@1' },
    { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
  ] };
}

test('stated kind requires generic targets; line roads compile and line buildings are refused with words', () => {
  const source = { ...profile(), geometryTypes: ['LineString'] };
  assert.deepEqual(compileMapping(MappingPlanSchema.parse(stated('road')), source), {
    kind: 'road', geometryRole: 'unknown', idField: 'doitt_id',
  });
  assert.throws(() => compileMapping(MappingPlanSchema.parse(stated('building')), source),
    /building, which does not accept LineString/);
  assert(!MappingPlanSchema.safeParse({ ...legacy, kind: 'road' }).success);
  assert(!MappingPlanSchema.safeParse({ ...stated('road'), kind: undefined }).success);
  const height = MappingPlanSchema.parse({ ...stated('building'), ...statedHeight });
  assert.equal(compileMapping(height, profile()).heightUnit, 'ft');
});

test('the legacy building adapter refuses stated kinds and generic targets instead of creating building facts', () => {
  const plan = MappingPlanSchema.parse(stated('road'));
  const context = mappingContextFromGisProfile(profile());
  assert.throws(() => legacyPlanToV2(plan, context, 'reviewer:fixture'),
    { status: 422, code: 'LEGACY_BUILDING_MAPPING_ONLY' });
  const { kind: _kind, ...genericWithoutKind } = plan;
  assert.throws(() => legacyPlanToV2(genericWithoutKind, context, 'reviewer:fixture'),
    { status: 422, code: 'LEGACY_BUILDING_MAPPING_ONLY' });
  assert.throws(() => legacyPlanToV2({ ...MappingPlanSchema.parse(legacy), kind: 'building' }, context, 'reviewer:fixture'),
    { status: 422, code: 'LEGACY_BUILDING_MAPPING_ONLY' });
  assert(StreamedPrefixMappingPlanSchema.shape.operations.safeParse(plan.operations).success);
  assert(StreamedPrefixMappingPlanSchema.shape.operations.safeParse(legacy.operations).success);
});

test('the kind/geometry matrix follows the existing normalizer, without broadening adaptive proposals', () => {
  const geometryTypes = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
  for (const type of geometryTypes) {
    const source = { ...profile(), geometryTypes: [type] };
    for (const kind of ['building', 'parcel', 'public_land', 'road', 'utility']) {
      const plan = MappingPlanSchema.parse(stated(kind));
      const accepts = ['road', 'utility'].includes(kind) || ['Polygon', 'MultiPolygon'].includes(type);
      if (accepts) assert.equal(compileMapping(plan, source).kind, kind);
      else assert.throws(() => compileMapping(plan, source), { code: 'MAPPING_GEOMETRY_KIND' });
    }
    const adaptive = validateAdaptiveMapping({ decision: 'propose', reason: 'none', operations: legacy.operations }, source);
    assert.equal(adaptive.status, ['Polygon', 'MultiPolygon'].includes(type) ? 'proposed' : 'needs_input');
  }
  assert.equal(validateAdaptiveMapping({ decision: 'propose', reason: 'none',
    operations: stated('building').operations }, profile()).status, 'needs_input');
  // Protocol fixtures check admission itself: the reader's declared inventory is the authority here.
  const bytes = Buffer.from(JSON.stringify(fixture));
  for (const type of geometryTypes) {
    const inspection = { format: 'geojson', sourceSha256: sha256(bytes), featureCount: 2,
      sourceCrs: 'EPSG:4326', crsEvidence: 'Protocol fixture', geometryTypes: [type],
      fields: [{ name: 'doitt_id' }, { name: 'height_ft' }] } as GisInspection;
    assert.deepEqual(inspectedProfile(bytes, inspection).geometryTypes, [type]);
  }
});

test('opening geometry admission preserves the polygon fingerprint pinned by the saved CA0 profile', t => {
  const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
  const path = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
  if (!existsSync(python) || !existsSync(path)) return t.skip('The unchanged NYC pack/interpreter is unavailable.');
  const bytes = readFileSync(path);
  const code = 'import sys,json;sys.path.insert(0,"services/geo");from geo.gis_inspection import inspect_gis;'
    + 'print(json.dumps(inspect_gis(json.load(sys.stdin))))';
  const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8', timeout: 30000,
    input: JSON.stringify({ base64: bytes.toString('base64') }),
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const inventory = inspectedProfile(bytes, JSON.parse(result.stdout));
  const ca0 = JSON.parse(readFileSync('docs/evidence/gf1/ca0/runtime-06.json', 'utf8'));
  const stored = ca0.runtime.progress.find((step: any) => step.completed === '1 retained original is probed');
  assert.equal(inventory.schemaFingerprint, stored.result.schemaFingerprint);
});


test('declared projected units profile and stated-kind geometry compile; old building geometry refuses', () => {
  const bytes = Buffer.from(JSON.stringify(fixture));
  const inspection = { format: 'geojson', sourceSha256: sha256(bytes), featureCount: 2,
    sourceCrs: 'EPSG:2958', crsEvidence: 'Declared in the file', crsUnit: 'metre',
    geometryTypes: ['Polygon'], fields: [{ name: 'doitt_id' }, { name: 'height_ft' }] } as GisInspection;
  const inventory = inspectedProfile(bytes, inspection);
  assert.deepEqual(inventory.crs, { value: 'EPSG:2958', evidence: 'Declared in the file', unit: 'metre' });
  const source = { ...profile(), crs: inventory.crs };
  assert.equal(compileMapping(MappingPlanSchema.parse(stated('parcel')), source).kind, 'parcel');
  assert.throws(() => compileMapping(MappingPlanSchema.parse(legacy), source), {
    code: 'MAPPING_CRS', status: 422,
    message: 'The older building layout reads longitude and latitude only. '
      + "State the kind of feature so the layout reads the file's declared coordinate system.",
  });
  const { crsUnit: _unit, ...old } = inspection;
  assert.throws(() => inspectedProfile(bytes, old), /Check the file again/);
  assert.equal(inspectedProfile(bytes, { ...old, sourceCrs: 'EPSG:4326' }).crs.unit, 'degree');
});

test('integer conversion is feature-only, requires the inspected fact, and never broadens text identity', () => {
  const source = profile();
  const path = source.paths.find(item => item.path.endsWith('/doitt_id'))!;
  path.types = ['number'];
  path.literalIdEligible = false;
  path.integerIdEligible = true;
  const plan = MappingPlanSchema.parse(stated('parcel'));
  plan.operations[0].conversionId = 'literal_integer_identifier@1';
  assert.equal(compileMapping(plan, source).idField, 'doitt_id');
  assert.throws(() => compileMapping(MappingPlanSchema.parse(stated('parcel')), source),
    /nonempty literal text/);
  assert.throws(() => compileMapping({ ...plan, kind: undefined, operations: plan.operations.map(op => ({
    ...op, target: op.target.replace('feature.', 'building.') as typeof op.target,
  })) }, source), { code: 'MAPPING_PATH' });
  path.integerIdEligible = false;
  assert.throws(() => compileMapping(plan, source), /unique whole-number tokens/);
  delete path.integerIdEligible;
  assert.throws(() => compileMapping(plan, source), /unique whole-number tokens/);
  assert.throws(() => compileMapping(plan, profile()), /unique whole-number tokens/);
});

test('additive integer eligibility does not enter the schema fingerprint', () => {
  const bytes = Buffer.from(JSON.stringify(fixture));
  const inspection = { format: 'geojson', sourceSha256: sha256(bytes), featureCount: 2,
    sourceCrs: 'EPSG:4326', crsEvidence: 'Fixture CRS declaration', geometryTypes: ['Polygon'],
    fields: [{ name: 'doitt_id' }, { name: 'height_ft' }] } as GisInspection;
  const old = inspectedProfile(bytes, inspection);
  const fresh = inspectedProfile(bytes, { ...inspection,
    fields: inspection.fields.map(field => ({ ...field, integerIdEligible: false })) });
  assert.equal(old.schemaFingerprint, fresh.schemaFingerprint);
  assert(!('integerIdEligible' in old.paths[1]));
  assert.equal(fresh.paths[1].integerIdEligible, false);
});

test('adding a degree unit leaves the old undeclared and CRS84 crs and fingerprint bytes unchanged', () => {
  const bytes = Buffer.from(JSON.stringify(fixture));
  for (const evidence of ['Declared OGC CRS84', 'RFC 7946 GeoJSON longitude/latitude']) {
    const inspection = { format: 'geojson', sourceSha256: sha256(bytes), featureCount: 2,
      sourceCrs: 'EPSG:4326', crsEvidence: evidence, geometryTypes: ['Polygon'],
      fields: [{ name: 'doitt_id' }, { name: 'height_ft' }] } as GisInspection;
    const old = inspectedProfile(bytes, inspection);
    const fresh = inspectedProfile(bytes, { ...inspection, crsUnit: 'degree' });
    assert.equal(JSON.stringify(old.crs), JSON.stringify(fresh.crs));
    assert.equal(old.schemaFingerprint, fresh.schemaFingerprint);
  }
});
