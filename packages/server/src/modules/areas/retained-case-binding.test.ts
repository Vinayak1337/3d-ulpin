import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { bindRetainedCaseTx } from './areas';

function control(siteId: string | null = null, archived = false, frameId = 'UNASSIGNED') {
  const row = { id: 'case-control', site_id: siteId, archived, frame: { id: frameId }, revision: 4 };
  const queries: { sql: string; values: unknown[] }[] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    queries.push({ sql, values });
    return { rows: sql.startsWith('SELECT') ? [row] : [] };
  } } as unknown as PoolClient;
  return { row, queries, client };
}

test('unassigned intake binds only the site, preserving frame and revision', async () => {
  const fixture = control();
  await bindRetainedCaseTx(fixture.client, fixture.row.id, { id: 'site-control' });
  assert.match(fixture.queries[1].sql, /FOR UPDATE$/);
  const write = fixture.queries[2];
  assert.deepEqual(write.values, ['case-control', 'site-control']);
  assert.equal(write.sql, 'UPDATE cases SET site_id=$2, updated_at=now() WHERE id=$1');
  assert(!/frame|context|revision/.test(write.sql));
  assert.equal(fixture.row.frame.id, 'UNASSIGNED');
  assert.equal(fixture.row.revision, 4);
});

test('same site replays without a write or case UPDATE lock', async () => {
  const fixture = control('site-control');
  await bindRetainedCaseTx(fixture.client, fixture.row.id, { id: 'site-control' });
  assert.equal(fixture.queries.length, 1);
  assert.doesNotMatch(fixture.queries[0].sql, /FOR UPDATE/);
});

test('binding rechecks a concurrent site change after taking its write lock', async () => {
  const fixture = control();
  const query = fixture.client.query.bind(fixture.client);
  fixture.client.query = (async (sql: string, values: unknown[]) => {
    if (sql.endsWith('FOR UPDATE')) fixture.row.site_id = 'other-site';
    return query(sql, values);
  }) as PoolClient['query'];
  await assert.rejects(bindRetainedCaseTx(fixture.client, fixture.row.id, { id: 'site-control' }),
    { status: 403, code: 'AREA_SOURCE_DENIED' });
  assert.equal(fixture.queries.length, 2);
});

for (const [name, fixture] of [
  ['another site', control('other-site')],
  ['archived', control(null, true)],
  ['prepared frame', control(null, false, 'PREPARED')],
] as const) {
  test(`${name} refuses placement before any case write`, async () => {
    await assert.rejects(bindRetainedCaseTx(fixture.client, fixture.row.id, { id: 'site-control' }),
      { status: 403, code: 'AREA_SOURCE_DENIED' });
    assert.equal(fixture.queries.length, 1);
  });
}

test('no retained original never issues a case statement', async () => {
  const fixture = control();
  await bindRetainedCaseTx(fixture.client, undefined, { id: 'site-control' });
  assert.deepEqual(fixture.queries, []);
});
