import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { databaseTarget } from '../../../../packages/server/src/infrastructure/database-readiness';
import { closePool, transaction } from '../../../../packages/server/src/infrastructure/db';

const root = 'docs/evidence/gf-backend/k3c';
const file = 'database/sql/50-spatial-ml/01-reject-only-footprints.sql';
assert.equal(process.env.ULPIN_PROFILE, 'demo');
assert(!existsSync(`${root}/migration.json`), 'Migration checkpoint is create-once; preserve prior receipt.');
const response = await fetch('http://127.0.0.1:3194/api/v1/health');
assert.equal(response.status, 200);
const health = await response.json();
const sql = readFileSync(file, 'utf8');
assert.match(sql, /^--[^\n]*\nALTER TABLE spatial_ml_footprint_drafts ALTER COLUMN package_id DROP NOT NULL;\r?\n$/);

try {
  const result = await transaction(async client => {
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    const target = await databaseTarget(client);
    assert.equal(target.token, health.databaseReadiness.schema.targetToken, 'Match the served demo DB authority');
    const before = (await client.query('SELECT count(*)::integer AS count FROM spatial_ml_footprint_drafts')).rows[0];
    await client.query(sql);
    const after = (await client.query('SELECT count(*)::integer AS count FROM spatial_ml_footprint_drafts')).rows[0];
    const column = (await client.query(`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='spatial_ml_footprint_drafts' AND column_name='package_id'`)).rows[0];
    assert.deepEqual(before, after);
    assert.equal(column.is_nullable, 'YES');
    return { targetVerified: true, receiptRowsBefore: before.count, receiptRowsAfter: after.count,
      packageIdNullable: true, productRecordsWritten: 0 };
  });
  writeFileSync(`${root}/migration.json`, JSON.stringify({ ...result, file,
    sqlSha256: createHash('sha256').update(sql).digest('hex'), forwardOnly: true,
    foreignKeyPreserved: true, manifestRegistration: 'lead_required_outside_owned_paths',
  }) + '\n', { flag: 'wx' });
} finally {
  await closePool();
}
