/** Real isolated PostgreSQL verification; metadata assertions and retained regression only. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate, pool, transaction } from '../../../apps/web/lib/server/db';
import { migrateUsp } from '../../../apps/web/lib/server/usp/migrations';
import { qualifiedGeometryPins, requireQualifiedGeometry, withUspAnalyticalReader, USP_ANALYTICAL_ROLES } from '../../../apps/web/lib/server/usp/geometry';
import { captureRegistrySnapshot, resolveRegistryTarget } from '../../../apps/web/lib/server/usp/snapshots';
import { readDisplayDerivativesForCompiler, displayInputsCurrentTx } from '../../../apps/web/lib/server/usp/display-compiler';
import { assertUspIsolation } from '../local-isolation.mjs';

const scope = assertUspIsolation(process.env);
const mode = process.env.FND04_MODE;
assert.ok(mode === 'fresh' || mode === 'retained');
const out = process.env.FND04_REPORT!;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const checks: Record<string,unknown>[] = [];
const manifest = JSON.parse(await readFile(resolve('repo-data/manifest.json'),'utf8'));
async function preservedTables() {
  const result: Record<string,unknown> = {};
  for (const table of manifest.tables) {
    assert.match(table.name,/^[a-z][a-z0-9_]*$/);
    const rows = (await pool().query(`SELECT row_to_json(t)::text AS body FROM public.${table.name} t`)).rows.map(r=>r.body).sort();
    result[table.name] = {rows:rows.length,sha256:hash(rows.join('\n'))};
  }
  return result;
}
try {
  assert.equal((await pool().query('SELECT current_database() AS db')).rows[0].db,scope.database);
  const before = mode === 'retained' ? await preservedTables() : null;
  if (before) {
    for (const table of manifest.tables) assert.deepEqual(before[table.name],{rows:table.rows,sha256:table.sha256});
    const baseline = await import(pathToFileURL(process.env.FND04_BASELINE_MIGRATION!).href);
    await baseline.migrateUsp();
    assert.equal((await pool().query("SELECT count(*)::int AS n FROM usp_migration_ledger WHERE name='usp_identity_001'")).rows[0].n,1);
    await migrateUsp();
  } else await migrate();
  await migrateUsp();
  assert.equal((await pool().query("SELECT count(*)::int AS n FROM usp_migration_ledger WHERE name='usp_geometry_separation_001'")).rows[0].n,1);
  if (before) assert.deepEqual(await preservedTables(),before);
  checks.push({name:'fresh-or-already-identity-migrated-install-and-replay',mode,protectedTables:before?Object.keys(before).length:0});

  for (const purpose of Object.keys(USP_ANALYTICAL_ROLES) as (keyof typeof USP_ANALYTICAL_ROLES)[]) {
    const role = USP_ANALYTICAL_ROLES[purpose];
    const allowed = await withUspAnalyticalReader(purpose, async client => (await client.query('SELECT current_user AS role,count(*)::int AS n FROM usp_analytic_geometry')).rows[0]);
    assert.equal(allowed.role,role); assert.equal(allowed.n,0);
    for (const sql of ['SELECT body FROM usp_display.derivatives LIMIT 0','SELECT body FROM registry_records LIMIT 0',
      'SELECT body FROM usp_geometry_qualifications LIMIT 0']) {
      await assert.rejects(withUspAnalyticalReader(purpose,client=>client.query(sql)), (error:any)=>error.code==='42501');
      checks.push({name:'sql-permission-denied',purpose,role,sql,sqlState:'42501'});
    }
  }
  const compiler = await transaction(async client => {
    await client.query('SET LOCAL ROLE ulpin_usp_display_compiler');
    return (await client.query('SELECT current_user AS role,count(*)::int AS n FROM usp_display.derivatives')).rows[0];
  });
  assert.equal(compiler.role,'ulpin_usp_display_compiler'); assert.equal(compiler.n,0);
  assert.equal((await pool().query("SELECT current_setting('role') AS role")).rows[0].role,'none');
  checks.push({name:'compiler-store-read-and-pooled-role-restoration',rows:0});

  const tables = ['registry_records','registry_revisions','physical_features','physical_feature_revisions','units','unit_revisions'];
  for (const table of tables) {
    const constraint = (await pool().query(`SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%usp_has_illustrative_geometry%'`,[table])).rows;
    assert.equal(constraint.length,1);
    assert.equal((await pool().query(`SELECT count(*)::int AS n FROM ${table} WHERE usp_has_illustrative_geometry(body)`)).rows[0].n,0);
    if (mode === 'retained' && (await pool().query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) {
      await assert.rejects(transaction(client=>client.query(`UPDATE ${table} SET body=jsonb_set(body,'{geometryClass}','"illustrative"'::jsonb)
        WHERE ctid=(SELECT ctid FROM ${table} LIMIT 1)`)),(error:any)=>error.code==='23514');
      checks.push({name:'canonical-illustrative-write-rejected',table,sqlState:'23514',originalsChanged:false});
    } else checks.push({name:'canonical-constraint-present-empty-table',table});
  }
  for (const metadata of [{},{geometryClass:'evidence_linked',analyticEligible:true},
    {representation:'context_mesh',geometryClass:'evidence_linked',analyticEligible:true}]) {
    assert.equal((await pool().query('SELECT usp_geometry_receipt_eligible($1,NULL,1,NULL,$2::jsonb) AS eligible',
      ['registry_record',JSON.stringify(metadata)])).rows[0].eligible,false);
  }
  for (const metadata of [{geometryClass:'estimated'},{geometryClass:'illustrative'},{representation:'context_mesh'}])
    assert.equal((await pool().query('SELECT usp_has_display_only_geometry($1::jsonb) AS blocked',[JSON.stringify(metadata)])).rows[0].blocked,true);
  checks.push({name:'sql-absent-metadata-label-only-context-mesh-fail-closed'});

  if (mode === 'retained') {
    const record=(await pool().query('SELECT id,site_id,revision FROM registry_records WHERE revision>0 ORDER BY id LIMIT 1')).rows[0];
    assert.ok(record,'Retained regression bundle must contain a real retained registry row');
    const pin={ref:{namespace:'registry_record',id:record.id},revision:record.revision};
    for (const purpose of Object.keys(USP_ANALYTICAL_ROLES) as (keyof typeof USP_ANALYTICAL_ROLES)[]) {
      assert.equal((await qualifiedGeometryPins(purpose,[pin])).size,0);
      await assert.rejects(requireQualifiedGeometry(purpose,[pin]),(error:any)=>error.code==='USP_GEOMETRY_NOT_QUALIFIED');
    }
    const ctx={requestId:randomUUID(),principal:{subject:'local-demo-operator',roles:['operator'],entitlementVersion:'local-1',mode:'local_demo' as const},
      accessViewId:'local-operator',policyVersion:'local-1'};
    const snapshot=await captureRegistrySnapshot(ctx,record.site_id,{kind:'targets',pins:[pin]});
    const resolved=await resolveRegistryTarget(ctx,snapshot.scope,pin);
    assert.equal(resolved.state,'available');
    if(resolved.state==='available') assert.equal(resolved.data.geometryQualification?.sufficiency.outcome,'insufficient_for_spatial_reconstruction');
    assert.equal(snapshot.declarations?.state,'not_assessed');
    assert.deepEqual(await readDisplayDerivativesForCompiler(ctx,snapshot.scope,pin),[]);
    await transaction(async client=>{
      assert.equal(await displayInputsCurrentTx(client,record.site_id,[pin]),true);
      assert.equal(await displayInputsCurrentTx(client,record.site_id,[{...pin,revision:pin.revision+1}]),false);
    });
    checks.push({name:'real-retained-snapshot-source-inspection-with-no-analytic-upgrade',declarations:'not_assessed',displayDerivativeRows:0});
    assert.deepEqual(await preservedTables(),before);
  }
  await writeFile(out,JSON.stringify({schemaVersion:'usp-fnd04-sql/1',status:'passed',mode,checks,
    limitations:['Schema/permission SQL proof and retained regression only; no official-source geometry accuracy qualification.',
      'Display store remains empty; no derived scene data was generated.',
      'Accepted real qualification-receipt/source case unavailable; positive real analytical eligibility remains unqualified.']},null,2)+'\n');
  console.log(JSON.stringify({status:'passed',mode,checks:checks.length}));
} finally {await pool().end();}
