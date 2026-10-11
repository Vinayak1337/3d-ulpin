import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { AuthorMappingSchema, MappingDestinationSchema } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { authoredIntakeDestination, intakeCaseArea, intakeDestination } from './intake-destination';

const caseId = '10000000-0000-4000-8000-000000000001';
const areaId = '10000000-0000-4000-8000-000000000002';
const gis = { suggestedTitle: 'Stored GIS suggestion', suggestedNamespace: 'stored-gis-namespace' };
const plan = { version: 'manual-geojson/1', mode: 'manual_mapping',
  source: { sourceId: areaId, familyId: areaId, sourceRevision: 1,
    sourceSha256: 'a'.repeat(64), schemaFingerprint: 'b'.repeat(64) },
  caseId, workspaceRevision: 0, workspaceFingerprint: 'c'.repeat(64), operations: [
    { target: 'building.sourceKey', sourcePath: '/features/*/properties/id', conversionId: 'literal_identifier@1' },
    { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
  ] };

test('destination omission inserts no default; an explicit destination and its hash remain byte-identical', () => {
  const input = { requestKey: caseId, expectedRecipeRevision: 0, plan };
  assert.deepEqual(AuthorMappingSchema.parse(input), input);
  assert(!Object.hasOwn(AuthorMappingSchema.parse(input), 'destination'));
  const destination = { kind: 'new_area', namespace: 'explicit-choice', name: 'Explicit choice' };
  const explicit = { ...input, destination };
  const parsed = AuthorMappingSchema.parse(explicit);
  assert.equal(JSON.stringify(parsed), JSON.stringify(explicit));
  assert.equal(fingerprint({ plan: parsed.plan, destination: parsed.destination }),
    fingerprint({ plan, destination }));
});

test('authored omission matches worker proposal: unbound, site-bound/pinned and unavailable', async () => {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const prior = globals.ulpinPool;
  let bound = false;
  const reference = { crs: 'EPSG:4326', evidence: 'Pin fixture' };
  globals.ulpinPool = { query: async (sql: string) => {
    if (sql.startsWith('SELECT a.id FROM cases c JOIN map_areas')) return { rows: bound ? [{ id: areaId }] : [] };
    if (sql.includes('FROM map_areas a WHERE')) return { rows: [{ id: areaId, site_id: caseId,
      name: 'Site area', revision: 7, reference, extent: null, geographic_extent: null }] };
    throw new Error('Unexpected query: ' + sql);
  } } as unknown as Pool;
  try {
    assert.deepEqual(await authoredIntakeDestination(caseId, gis), intakeDestination(gis, null));
    bound = true;
    const area = await intakeCaseArea(caseId);
    const authored = await authoredIntakeDestination(caseId, gis);
    assert.deepEqual(authored, intakeDestination(gis, area));
    assert.deepEqual(authored, { kind: 'existing_area', areaId, expectedAreaRevision: 7,
      referenceFingerprint: fingerprint(reference), name: gis.suggestedTitle, namespace: gis.suggestedNamespace });
    assert(MappingDestinationSchema.safeParse(authored).success);
    for (const unavailable of [null, undefined, {}, { suggestedTitle: '', suggestedNamespace: 'x' }])
      await assert.rejects(authoredIntakeDestination(caseId, unavailable),
        { status: 422, code: 'MAPPING_DESTINATION_UNAVAILABLE' });
  } finally { globals.ulpinPool = prior; }
});
