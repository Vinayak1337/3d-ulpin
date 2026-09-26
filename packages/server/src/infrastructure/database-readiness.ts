import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from './db';
import { settings } from './config';
import { sql } from './sql-loader';

/** Structural admission checks from the executed authority, never a migration. */
export function schemaRequirements() {
  const bytes = readFileSync(path.join(settings.repositoryRoot, 'database/manifest.json'));
  const manifest = JSON.parse(bytes.toString('utf8')) as {
    steps: { id: string; parameters: { value?: string }[] }[];
  };
  const relations = new Set<string>(), columns = new Set<string>(), markers = new Set<string>();
  for (const step of manifest.steps) {
    const text = sql(step.id);
    for (const match of text.matchAll(/CREATE\s+(?:TABLE|VIEW)\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_.]*)/gi))
      relations.add(match[1].includes('.') ? match[1] : `public.${match[1]}`);
    for (const match of text.matchAll(/ALTER TABLE\s+([a-z_][a-z0-9_.]*)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi))
      columns.add(`${match[1].includes('.') ? match[1] : `public.${match[1]}`}.${match[2]}`);
    if (step.id.endsWith('.check')) for (const parameter of step.parameters)
      if (parameter.value) markers.add(parameter.value);
  }
  return { manifestSha256: createHash('sha256').update(bytes).digest('hex'),
    relations: [...relations].sort(), columns: [...columns].sort(), markers: [...markers].sort() };
}

/** Opaque loopback API/CLI target binding; never returns connection credentials or cluster identifiers. */
export async function databaseTarget(client: PoolClient, databaseUrl = settings.databaseUrl) {
  const url = new URL(databaseUrl), endpoint = `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  const row = (await client.query(`SELECT current_database() AS database,current_user AS role,
    (SELECT system_identifier::text FROM pg_control_system()) AS cluster,
    current_setting('server_version_num') AS version,PostGIS_Lib_Version() AS postgis`)).rows[0];
  return { token: createHash('sha256').update(JSON.stringify({endpoint,database:row.database,role:row.role,cluster:row.cluster})).digest('hex'),
    postgres: row.version as string, postgis: row.postgis as string };
}

export async function inspectDatabaseReadiness(client: PoolClient) {
  const expected = schemaRequirements();
  const relations = (await client.query<{ name: string }>(`
    SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','usp_display') AND c.relkind IN ('r','p','v')`)).rows.map(r => r.name);
  const columns = (await client.query<{ name: string }>(`
    SELECT table_schema||'.'||table_name||'.'||column_name AS name FROM information_schema.columns
    WHERE table_schema IN ('public','usp_display')`)).rows.map(r => r.name);
  const markers = relations.includes('public.usp_migration_ledger')
    ? (await client.query<{ name: string }>('SELECT name FROM usp_migration_ledger')).rows.map(r => r.name) : [];
  const invalidIndexes = Number((await client.query(`SELECT count(*) AS n FROM pg_index i
    JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','usp_display') AND (NOT i.indisvalid OR NOT i.indisready)`)).rows[0].n);
  const missingRelations = expected.relations.filter(n => !relations.includes(n));
  const missingColumns = expected.columns.filter(n => !columns.includes(n));
  const missingMigrations = expected.markers.filter(n => !markers.includes(n));
  const schemaReady = !missingRelations.length && !missingColumns.length && !missingMigrations.length && !invalidIndexes;
  const unvalidatedConstraints = (await client.query<{ name: string; table: string }>(`
    SELECT conname AS name,conrelid::regclass::text AS table FROM pg_constraint
    WHERE NOT convalidated AND connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('public','usp_display'))
    ORDER BY conname`)).rows;
  const count = async (table: string, where = '') => relations.includes(`public.${table}`)
    ? Number((await client.query(`SELECT count(*) AS n FROM ${table} ${where}`)).rows[0].n) : null;
  let targetToken: string | null = null;
  // An API role need not have pg_control_system privilege. Lack of attestation blocks CLI import, not liveness.
  await client.query('SAVEPOINT readiness_target');
  try { targetToken = (await databaseTarget(client)).token; }
  catch { await client.query('ROLLBACK TO SAVEPOINT readiness_target'); }
  finally { await client.query('RELEASE SAVEPOINT readiness_target'); }
  return {
    status: schemaReady ? 'structurally_ready' as const : 'schema_missing' as const,
    schema: { ready: schemaReady, manifestSha256: expected.manifestSha256, targetToken,
      missingRelations, missingColumns, missingMigrations, invalidIndexes, unvalidatedConstraints },
    data: { sourceCount: await count('sources'), importPackageCount: await count('import_packages'),
      physicalFeatureCount: await count('physical_features'),
      activeLegacyDatasetCount: columns.includes('public.spatial_datasets.archived_at')
        ? await count('spatial_datasets', 'WHERE archived_at IS NULL') : null },
    qualification: 'Structural checks only; source suitability, constraint violations, populated upgrade, map readability and product gates require separate receipts.',
  };
}

export async function databaseReadiness() {
  const client = await pool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='3000ms'");
    await client.query("SET LOCAL lock_timeout='1000ms'");
    const result = await inspectDatabaseReadiness(client);
    await client.query('ROLLBACK');
    return result;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
