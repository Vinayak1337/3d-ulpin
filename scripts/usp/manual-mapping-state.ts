/** Read-only count/integrity checks; credentials come only from the verified fresh run environment. */
import assert from 'node:assert/strict';
import { assertUspIsolation } from './local-isolation.mjs';
import { pool, closePool } from '../../packages/server/src/infrastructure/db';

assert.equal(process.env.ULPIN_ISOLATION_PROFILE,'local-nest');assertUspIsolation(process.env);
const [caseId,recipeId,packageId]=process.argv.slice(2);
try {
  const result=(await pool().query(`SELECT
    (SELECT count(*)::int FROM sources WHERE case_id=$1) sources,
    (SELECT count(*)::int FROM usp_mapping_recipes WHERE case_id=$1) recipes,
    (SELECT count(*)::int FROM usp_mapping_recipe_revisions WHERE recipe_id=$2) history,
    (SELECT count(*)::int FROM import_packages WHERE id=$3 OR body->'sourceRevisionIds' ? (SELECT source_id::text FROM usp_mapping_recipes WHERE id=$2)) packages,
    (SELECT count(*)::int FROM jobs) jobs,
    (SELECT count(*)::int FROM usp_model_calls) "modelCalls",
    (SELECT sha256 FROM sources WHERE case_id=$1) "sourceSha256"`,[caseId,recipeId,packageId])).rows[0];
  console.log(JSON.stringify(result));
} finally {await closePool();}
