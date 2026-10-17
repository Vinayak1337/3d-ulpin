import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { databaseTarget } from '../../../../packages/server/src/infrastructure/database-readiness';
import { closePool, transaction } from '../../../../packages/server/src/infrastructure/db';

const stage = process.argv[2];
assert(['before', 'after'].includes(stage));
assert.equal(process.env.ULPIN_PROFILE, 'demo');
const response = await fetch('http://127.0.0.1:3194/api/v1/health');
assert.equal(response.status, 200);
const health = await response.json();

try {
  const observed = await transaction(async client => {
    await client.query("SET LOCAL statement_timeout='5000ms'");
    const target = await databaseTarget(client);
    assert.equal(target.token, health.databaseReadiness.schema.targetToken);
    const counts = (await client.query(`SELECT
      (SELECT count(*)::integer FROM import_packages) AS packages,
      (SELECT count(*)::integer FROM physical_features) AS features,
      (SELECT count(*)::integer FROM registry_records) AS registry,
      (SELECT count(*)::integer FROM spatial_ml_footprint_drafts) AS roofreceipts`)).rows[0];
    const records = (await client.query(
      'SELECT id, revision FROM registry_records WHERE id=ANY($1::uuid[]) ORDER BY id',
      [['6f95d04e-2067-4ac8-a3c2-6cc21ea46325', 'e8777ffc-9409-4129-bacf-f680160d8795']])).rows;
    const area = (await client.query('SELECT revision FROM map_areas WHERE id=$1',
      ['cb24dc86-2b91-4793-9586-24e8a443b8d8'])).rows[0];
    return { counts, records, roofAreaRevision: area.revision, targetVerified: true, readOnly: true };
  }, undefined, 'repeatable_read_only');
  writeFileSync(`docs/evidence/gf-backend/k3c/db-${stage}.json`, JSON.stringify(observed) + '\n', { flag: 'wx' });
} finally {
  await closePool();
}
