import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { MappingPlanSchema, SourceProfileSchema } from '@ulpin/contracts/usp';
import type { GisInspection } from '@ulpin/contracts';
import { fingerprint } from '../../cases/domain';
import { sha256 } from '../../../infrastructure/storage';
import { compileMapping, inspectedProfile } from './registry';

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
