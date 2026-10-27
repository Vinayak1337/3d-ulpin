import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { MappingDestinationSchema } from '@ulpin/contracts/usp';
import { caseScopedDestination, intakeDestination } from './intake-destination';
import { destination } from './service';

// G20 on real originals: the NYC buildings layer (the demo's file) and the 26.7 MB Niagara footprints, whose
// file name makes the large path's longest title. Only their SHA-256 is used; no database is opened.
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const nyc = sha('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
const niagara = sha('E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson');
const caseId = '10000000-0000-4000-8000-000000000031';
const newArea = (hash: string, name = 'buildings original') =>
  intakeDestination({ suggestedTitle: name, suggestedNamespace: `file:${hash}` }, null);

function holders(rows: { own: boolean }[], seen: unknown[][] = []) {
  return async (sql: string, values: string[]) => {
    assert.match(sql, /seed_key=\$1 OR a\.id IN \(SELECT area_id FROM source_feature_links WHERE namespace=\$2\)/);
    seen.push(values);
    return rows;
  };
}

test('the same bytes in a new case get its own namespace; this case\'s live area keeps the plain one', async () => {
  const plain = newArea(nyc), seen: unknown[][] = [];
  assert.deepEqual(await caseScopedDestination(caseId, plain, holders([], seen)), plain);
  assert.deepEqual(seen[0], [`file:${nyc}:buildings original`, `file:${nyc}`, caseId]);
  assert.deepEqual(await caseScopedDestination(caseId, plain, holders([{ own: true }, { own: false }])), plain);
  const scoped = await caseScopedDestination(caseId, plain, holders([{ own: false }]));
  assert.deepEqual(scoped, { ...plain, namespace: `file:${nyc}:case:${caseId}` });
  assert.deepEqual(await caseScopedDestination(caseId, scoped, holders([{ own: false }])), scoped);
  const chosen = { kind: 'new_area', namespace: 'officer-choice', name: 'Officer choice' } as const;
  assert.equal(await caseScopedDestination(caseId, chosen, () => assert.fail('no lookup')), chosen);
  assert.equal(await caseScopedDestination(caseId, null, () => assert.fail('no lookup')), null);
});

test('the large path\'s longest title and an existing-area destination fit the contract when scoped', async () => {
  const title = 'Niagara Falls Building Footprints 2018 1330698285055863645';
  const scoped = await caseScopedDestination(caseId, newArea(niagara, title), holders([{ own: false }]));
  assert.equal(scoped.namespace, `file:${niagara}:case:${caseId}`);
  assert(MappingDestinationSchema.safeParse(scoped).success);
  const existing = { kind: 'existing_area', areaId: caseId, expectedAreaRevision: 4,
    referenceFingerprint: 'c'.repeat(64), namespace: `file:${niagara}`, name: title } as const;
  const moved = await caseScopedDestination(caseId, existing, holders([{ own: false }]));
  assert(MappingDestinationSchema.safeParse(moved).success);
  assert.equal(moved.areaId, caseId);
});

function client(seed: Record<string, unknown> | null, area?: Record<string, unknown>) {
  return { query: async (sql: string) => {
    if (sql.includes('seed_key')) return { rows: seed ? [seed] : [] };
    if (sql.includes('FROM map_areas WHERE id=$1')) return { rows: area ? [area] : [] };
    return { rows: [] };
  } } as unknown as PoolClient;
}

test('only a live area of these bytes refuses; a retired one never does and is never written to', async () => {
  const live = { id: caseId, name: 'buildings original', archived_at: null };
  await assert.rejects(destination(client(live), newArea(nyc), false, nyc), { code: 'SOURCE_ALREADY_IN_AREA' });
  const scoped = { ...newArea(nyc), namespace: `file:${nyc}:case:${caseId}` };
  await assert.rejects(destination(client(live), scoped, false, nyc), { code: 'SOURCE_ALREADY_IN_AREA' });
  await assert.rejects(destination(client({ ...live, archived_at: new Date() }), newArea(nyc), false, nyc),
    { code: 'STALE_REVISION' });
  await destination(client(null), scoped, true, nyc);
  const existing = { kind: 'existing_area', areaId: caseId, expectedAreaRevision: 4,
    referenceFingerprint: 'c'.repeat(64), namespace: `file:${nyc}`, name: 'buildings original' } as const;
  await assert.rejects(destination(client(null, { id: caseId, archived_at: new Date() }), existing, true, nyc),
    { status: 409, code: 'AREA_RETIRED' });
});
