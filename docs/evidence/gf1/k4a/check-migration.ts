import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { databaseTarget } from '../../../../packages/server/src/infrastructure/database-readiness';
import { closePool, transaction } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';

const receiptPath = 'docs/evidence/gf1/k4a/result.json';
const stepId = 'spatial-ml.reject-only-footprints';

async function inspect(client: Parameters<Parameters<typeof transaction>[0]>[0]) {
  const rows = (await client.query('SELECT count(*)::integer AS count FROM spatial_ml_footprint_drafts')).rows[0];
  const column = (await client.query(`SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='spatial_ml_footprint_drafts' AND column_name='package_id'`)).rows[0];
  const foreignKeys = (await client.query(`SELECT conname,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='spatial_ml_footprint_drafts'::regclass AND contype='f'
    ORDER BY conname`)).rows;
  return { rows: rows.count, nullable: column.is_nullable, foreignKeys };
}

async function main() {
  assert.equal(process.env.ULPIN_PROFILE, 'demo');
  assert(!existsSync(receiptPath), 'Preserve this create-once migration checkpoint.');
  const healthResponse = await fetch('http://127.0.0.1:3194/api/v1/health');
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  const runner = readFileSync('packages/server/src/modules/spatial/spatial-ml-db.ts', 'utf8');
  assert(runner.indexOf(`sql('${stepId}')`) > runner.indexOf("sql('spatial-ml.source-batches')"));
  const result = await transaction(async client => {
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    const target = await databaseTarget(client);
    assert.equal(target.token, health.databaseReadiness.schema.targetToken, 'Use the served demo database');
    const before = await inspect(client);
    await client.query(sql(stepId));
    const after = await inspect(client);
    assert.equal(before.rows, after.rows);
    assert.equal(after.nullable, 'YES');
    assert.deepEqual(before.foreignKeys, after.foreignKeys);
    assert(after.foreignKeys.some(key => key.definition.includes('FOREIGN KEY (package_id)')));
    return { before, after };
  });
  const receipt = { task: 'K4a', checkedAt: new Date().toISOString(), stepId,
    registeredLoaderExecuted: true, runnerOrderVerified: true, servedDatabaseTargetVerified: true,
    ...result, forwardOnly: true, productWrites: 0, resetOrReseed: false };
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx' });
  console.log('Registered migration applied; receipt rows and foreign keys unchanged; package_id nullable.');
}

try {
  await main();
} finally {
  await closePool();
}
