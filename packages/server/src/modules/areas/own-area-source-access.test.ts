import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { registryDocumentSourceAccessTx } from '../registry/registry-metadata';

/**
 * S9.6a. The area being read reaches the registry source site check as an explicit argument: a source whose batch
 * case keeps the batch area's site reads only in the area it records as its own map area, and only for that area's
 * site. Generated test_only rows; no database.
 */
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'test_only-operator';
const batchSite = randomUUID(), ownArea = randomUUID(), ownSite = randomUUID(), otherSite = randomUUID();
const passed = new Error('test_only: past the site check');

/** The first query answers the source row (with the joined area's site); any later query ends the read. */
function client(seen: unknown[][]): PoolClient {
  return { query: async (_sql: string, values: unknown[]) => {
    seen.push(values);
    if (seen.length > 1) throw passed;
    const known = values[1] === ownArea;
    return { rows: [{ id: values[0], case_id: randomUUID(), profile: 'geojson-area-v2', status: 'ready',
      source_site_id: batchSite, source_archived: false, own_area_site_id: known ? ownSite : null,
      inspection: { intakeOwnArea: { areaId: ownArea } } }] };
  } } as unknown as PoolClient;
}

test('the area being read is passed to the source query and admits only its own site', async () => {
  const seen: unknown[][] = [];
  const sourceId = randomUUID();
  await assert.rejects(registryDocumentSourceAccessTx(client(seen), ownSite, sourceId, ownArea), passed);
  assert.deepEqual(seen[0], [sourceId, ownArea]);
});

test('without the area, or for another site or area, the source stays denied', async () => {
  const denied = { code: 'REGISTRY_SOURCE_DENIED' };
  await assert.rejects(registryDocumentSourceAccessTx(client([]), ownSite, randomUUID()), denied);
  await assert.rejects(registryDocumentSourceAccessTx(client([]), otherSite, randomUUID(), ownArea), denied);
  await assert.rejects(registryDocumentSourceAccessTx(client([]), ownSite, randomUUID(), randomUUID()), denied);
});

test('the batch site still reads the source without an area', async () => {
  const seen: unknown[][] = [];
  await assert.rejects(registryDocumentSourceAccessTx(client(seen), batchSite, randomUUID()), passed);
  assert.equal(seen[0][1], null);
});
