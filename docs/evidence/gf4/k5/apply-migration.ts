import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { databaseTarget } from '../../../../packages/server/src/infrastructure/database-readiness';
import { closePool, transaction } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';

// Applies the one registered block usp_property_card_revocations_001 to the served demo database the way
// migrateUsp() does (same lock, same hash-checked check/schema/mark steps) and nothing else. Run it through
// run-migration.mjs. NOT RUN by its author: no PostgreSQL was available offline (see result.json, part2).
const receiptPath = 'docs/evidence/gf4/k5/migration-receipt.json';
const name = 'usp_property_card_revocations_001';
type Client = Parameters<Parameters<typeof transaction>[0]>[0];

/** The card rows a revocation table must leave as they are, and whether the table and its marker exist. */
async function inspect(client: Client) {
  const cards = (await client.query(`SELECT count(*)::integer AS count,
    coalesce(md5(string_agg(id::text || ':' || revision || ':' || artifact_hash || ':' || md5(body::text), ','
      ORDER BY id, revision)), '') AS digest FROM usp_property_cards`)).rows[0];
  const table = (await client.query(
    "SELECT to_regclass('public.usp_property_card_revocations') IS NOT NULL AS present")).rows[0];
  const marked = (await client.query(sql('usp.property-card-revocations.check'), [name])).rowCount === 1;
  return { cardRows: cards.count as number, cardRowsMd5: cards.digest as string, table: table.present as boolean,
    marked };
}

async function main() {
  assert.equal(process.env.ULPIN_PROFILE, 'demo');
  assert(!existsSync(receiptPath), 'Preserve this create-once migration checkpoint.');
  const healthResponse = await fetch('http://127.0.0.1:3194/api/v1/health');
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  const result = await transaction(async client => {
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    const target = await databaseTarget(client);
    assert.equal(target.token, health.databaseReadiness.schema.targetToken, 'Use the served demo database');
    await client.query(sql('usp.lock'));
    const before = await inspect(client);
    assert.equal(before.table, before.marked, 'The table and its ledger marker exist together or not at all');
    if (!before.marked) {
      await client.query(sql('usp.property-card-revocations.schema'));
      await client.query(sql('usp.property-card-revocations.mark'), [name]);
    }
    const after = await inspect(client);
    assert.deepEqual([after.cardRows, after.cardRowsMd5], [before.cardRows, before.cardRowsMd5]);
    assert(after.table && after.marked);
    return { applied: !before.marked, before, after };
  });
  const receipt = { task: 'K5', checkedAt: new Date().toISOString(), migration: name,
    registeredLoaderExecuted: true, servedDatabaseTargetChecked: true, ...result, forwardOnly: true,
    productWrites: 0, resetOrReseed: false };
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx' });
  console.log(`${name}: ${result.applied ? 'applied' : 'already present'}; card rows unchanged.`);
}

try {
  await main();
} finally {
  await closePool();
}
