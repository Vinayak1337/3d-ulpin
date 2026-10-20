import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { MapArea } from '@ulpin/contracts';
import { bindRetainedCaseTx } from '../../areas/areas';
import { caseScopedDestination, intakeDestination } from './intake-destination';
import { destination } from './service';

// G20B step 0 on the NYC buildings layer's SHA-256 (no database opened): what a drop of the same file in the same
// case gets after its area was retired. Every fake answers as the database would after the earlier drops.
const nyc = createHash('sha256')
  .update(readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson')).digest('hex');
const caseId = '10000000-0000-4000-8000-000000000041';
const retiredA = { id: '10000000-0000-4000-8000-0000000000a1', name: 'buildings original', revision: 2,
  archived_at: new Date() };
const gis = { suggestedTitle: 'buildings original', suggestedNamespace: `file:${nyc}` };
const holders = (rows: { own: boolean }[]) => async () => rows;

function client(rows: { seed?: Record<string, unknown>; area?: Record<string, unknown>;
  kase?: Record<string, unknown> }) {
  return { query: async (sql: string) => {
    if (sql.includes('seed_key')) return { rows: rows.seed ? [rows.seed] : [] };
    if (sql.includes('FROM map_areas WHERE id=$1')) return { rows: rows.area ? [rows.area] : [] };
    if (sql.includes('FROM cases WHERE id=$1')) return { rows: rows.kase ? [rows.kase] : [] };
    return { rows: [] };
  } } as unknown as PoolClient;
}

test('second drop: the case still offers its retired area, so the destination is refused', async () => {
  // intakeCaseArea joins the case's site to map_areas without archived_at, and getArea reads archived areas too.
  const offered = intakeDestination(gis, { id: retiredA.id, revision: 2, reference: null } as unknown as MapArea);
  const scoped = await caseScopedDestination(caseId, offered, holders([{ own: false }]));
  assert.equal(scoped.kind, 'existing_area');
  assert.equal(scoped.namespace, `file:${nyc}:case:${caseId}`);
  await assert.rejects(destination(client({ area: retiredA }), scoped, true, nyc),
    { status: 409, code: 'AREA_RETIRED' });
});

test('second drop as a new area: the case is bound to the retired area\'s site, so placement is refused', async () => {
  const fresh = await caseScopedDestination(caseId, intakeDestination(gis, null), holders([{ own: false }]));
  await destination(client({}), fresh, true, nyc);
  const kase = { id: caseId, site_id: retiredA.id, archived: false, frame: { id: 'UNASSIGNED' } };
  await assert.rejects(bindRetainedCaseTx(client({ kase }), caseId, { id: '10000000-0000-4000-8000-0000000000b2' }),
    { status: 403, code: 'AREA_SOURCE_DENIED' });
});

test('third drop: retired areas A and B give the same scoped namespace, which collides with B\'s seed', async () => {
  const third = await caseScopedDestination(caseId, intakeDestination(gis, null),
    holders([{ own: false }, { own: false }]));
  assert.equal(third.namespace, `file:${nyc}:case:${caseId}`);
  const retiredB = { ...retiredA, id: '10000000-0000-4000-8000-0000000000b2' };
  await assert.rejects(destination(client({ seed: retiredB }), third, true, nyc), { code: 'STALE_REVISION' });
});
