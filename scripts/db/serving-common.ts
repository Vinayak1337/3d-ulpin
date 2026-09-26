import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, openSync, closeSync, writeSync, ftruncateSync, fsyncSync,
  fstatSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { Pool, type PoolClient } from 'pg';

export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const toolRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
export const toolPath = (file: string) => path.resolve(toolRoot, file);
export const originalVerificationBounds = Object.freeze({ count: 1000, perObjectBytes: 128*1024*1024,
  totalBytes: 512*1024*1024, scanMs: 60000, perObjectMs: 10000 });
export function admitOriginalScan(sizes: number[]) {
  requireGuard(sizes.length <= originalVerificationBounds.count &&
    sizes.every(n => Number.isSafeInteger(n) && n > 0 && n <= originalVerificationBounds.perObjectBytes) &&
    sizes.reduce((n,s) => n+s,0) <= originalVerificationBounds.totalBytes, 'ORIGINAL_SCAN_BOUND_EXCEEDED');
}
export function requireGuard(ok: unknown, code: string): asserts ok {
  if (!ok) throw Object.assign(new Error(code), { code });
}
export function codePin() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: toolRoot, encoding: 'utf8', timeout: 5000 }).trim();
}
export function loadEnvironment(file: string) {
  const envFile = realpathSync(toolPath(file)), bytes = readFileSync(envFile);
  const env = envFile.endsWith('.json') ? JSON.parse(bytes.toString('utf8')) : parse(bytes);
  for (const key of ['DATABASE_URL','S3_ENDPOINT','S3_ACCESS_KEY','S3_SECRET_KEY','S3_BUCKET','S3_REGION','GEO_URL','GEO_SERVICE_TOKEN'])
    requireGuard(typeof env[key] === 'string' && env[key].trim().length > 0, 'COMPLETE_EXPLICIT_RESOURCE_BINDING_REQUIRED');
  requireGuard(env.REPO_DATA !== 'true', 'EXPLICIT_LINKED_OR_NONCE_ENV_REQUIRED');
  validatedDatabaseConfig(env.DATABASE_URL);
  const url = new URL(env.DATABASE_URL);
  for (const key of ['S3_ENDPOINT','GEO_URL']) {
    const resource = new URL(env[key]);
    requireGuard(['http:','https:'].includes(resource.protocol) && !resource.username && !resource.password &&
      !resource.search && !resource.hash, 'EXPLICIT_RESOURCE_URL_REQUIRED');
  }
  // Select the requested file, never ambient linked credentials or repo-data fallback.
  for (const key of ['DATABASE_URL','S3_ENDPOINT','S3_ACCESS_KEY','S3_SECRET_KEY','S3_BUCKET','S3_REGION',
    'GEO_URL','GEO_SERVICE_TOKEN','REPO_DATA','ULPIN_FIXTURE_ROOT']) delete process.env[key];
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') process.env[key] = value;
  process.env.REPO_DATA = 'false';
  return { envFile, envHash: hash(bytes), env, endpoint: `${url.hostname}:${url.port || '5432'}${url.pathname}` };
}
export function validatedDatabaseConfig(databaseUrl: string) {
  const url = new URL(databaseUrl);
  requireGuard(['postgres:','postgresql:'].includes(url.protocol) && !url.search && !url.hash, 'DATABASE_URL_OVERRIDES_FORBIDDEN');
  requireGuard(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'LOOPBACK_DATABASE_REQUIRED');
  requireGuard(url.username && url.password && url.pathname.length > 1, 'EXPLICIT_DATABASE_IDENTITY_REQUIRED');
  const port = Number(url.port || 5432);
  requireGuard(Number.isInteger(port) && port > 0 && port <= 65535, 'DATABASE_PORT_INVALID');
  return { host: url.hostname === '[::1]' ? '::1' : url.hostname, port,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) };
}
export async function assertEffectiveEnvironment(selected: ReturnType<typeof loadEnvironment>) {
  const { settings } = await import('@ulpin/server/infrastructure/config');
  requireGuard(realpathSync(settings.repositoryRoot) === toolRoot, 'SERVER_TOOL_REPOSITORY_MISMATCH');
  const effective = { DATABASE_URL: settings.databaseUrl, S3_ENDPOINT: settings.s3Endpoint, S3_ACCESS_KEY: settings.s3AccessKey,
    S3_SECRET_KEY: settings.s3SecretKey, S3_BUCKET: settings.s3Bucket, S3_REGION: settings.s3Region,
    GEO_URL: settings.geoUrl, GEO_SERVICE_TOKEN: settings.geoToken };
  requireGuard(settings.dataMode === 'linked' && Object.entries(effective).every(([k,v]) => selected.env[k] === v),
    'EFFECTIVE_RESOURCE_BINDING_CHANGED');
  return hash(JSON.stringify(effective));
}
export function connection(databaseUrl: string, readOnly: boolean) {
  // Do not pass connectionString: pg query parameters must never override these guards.
  return new Pool({ ...validatedDatabaseConfig(databaseUrl), ssl: false, max: 2, connectionTimeoutMillis: 5000,
    application_name: 'ulpin-serving-database',
    options: `-c default_transaction_read_only=${readOnly ? 'on' : 'off'} -c lock_timeout=2000 -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000` });
}
export async function target(client: PoolClient, endpoint: string) {
  const { databaseTarget } = await import('@ulpin/server/infrastructure/database-readiness');
  requireGuard(endpoint.length > 0, 'EXPLICIT_ENDPOINT_REQUIRED');
  return databaseTarget(client, process.env.DATABASE_URL);
}
const identifier = (name: string) => {
  requireGuard(/^[a-z_][a-z0-9_]*$/.test(name), 'UNSUPPORTED_SCHEMA_IDENTIFIER');
  return `"${name}"`;
};
export type Fingerprint = { schema: string; table: string; columns: string[]; count: number; sha256: string };
export async function fingerprints(client: PoolClient, baseline?: Fingerprint[], omitArchive = false): Promise<Fingerprint[]> {
  const tables = baseline ?? (await client.query(`SELECT table_schema AS schema,table_name AS table,
    array_agg(column_name::text ORDER BY ordinal_position) AS columns FROM information_schema.columns
    WHERE table_schema IN ('public','usp_display') AND table_name IN (
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=table_schema AND c.relkind IN ('r','p'))
    GROUP BY table_schema,table_name ORDER BY table_schema,table_name`)).rows;
  const result: Fingerprint[] = [];
  for (const table of tables) {
    const name = `${identifier(table.schema)}.${identifier(table.table)}`;
    const columns = table.columns.filter((c: string) => !(omitArchive && table.table === 'spatial_datasets' && c === 'archived_at'));
    const count = Number((await client.query(`SELECT count(*) AS n FROM ${name}`)).rows[0].n);
    requireGuard(count <= 100000, 'PRESERVATION_SCAN_BOUND_EXCEEDED');
    const fields = columns.map((c: string) => `t.${identifier(c)}`).join(',');
    const row = (await client.query(`SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS hash
      FROM (SELECT encode(sha256(convert_to(jsonb_build_array(${fields})::text,'UTF8')),'hex') AS h FROM ${name} t) rows`)).rows[0];
    result.push({ schema: table.schema, table: table.table, columns, count, sha256: row.hash });
  }
  return result;
}
export function preserved(before: Fingerprint[], after: Fingerprint[]) {
  assert.deepEqual(after, before, 'PRESERVATION_MISMATCH');
}
export async function integrity(client: PoolClient) {
  const foreignKeys = (await client.query(`SELECT n.nspname AS schema,c.relname AS table,
    rn.nspname AS ref_schema,rc.relname AS ref_table,k.conname AS name,
    array_agg(a.attname::text ORDER BY x.ordinality) AS columns,
    array_agg(ra.attname::text ORDER BY x.ordinality) AS ref_columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class rc ON rc.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
    CROSS JOIN LATERAL unnest(k.conkey,k.confkey) WITH ORDINALITY x(a,b,ordinality)
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.a
    JOIN pg_attribute ra ON ra.attrelid=rc.oid AND ra.attnum=x.b
    WHERE k.contype='f' AND n.nspname IN ('public','usp_display')
    GROUP BY n.nspname,c.relname,rn.nspname,rc.relname,k.conname ORDER BY k.conname`)).rows;
  const orphans: { constraint: string; count: number }[] = [];
  for (const fk of foreignKeys) {
    const columns = fk.columns as string[], refs = fk.ref_columns as string[];
    const joins = columns.map((c,i) => `r.${identifier(refs[i])}=t.${identifier(c)}`).join(' AND ');
    const notNull = columns.map(c => `t.${identifier(c)} IS NOT NULL`).join(' AND ');
    const n = Number((await client.query(`SELECT count(*) AS n FROM ${identifier(fk.schema)}.${identifier(fk.table)} t
      WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${identifier(fk.ref_schema)}.${identifier(fk.ref_table)} r WHERE ${joins})`)).rows[0].n);
    if (n) orphans.push({ constraint: fk.name, count: n });
  }
  // These historical NOT VALID checks are deliberate. Count violating rows without validating/re-writing them.
  const geometryViolations: { table: string; count: number }[] = [];
  for (const table of ['registry_records','registry_revisions','physical_features','physical_feature_revisions','units','unit_revisions']) {
    if (!(await client.query('SELECT to_regclass($1) AS name', [`public.${table}`])).rows[0].name) continue;
    const n = Number((await client.query(`SELECT count(*) AS n FROM ${identifier(table)} WHERE
      jsonb_path_exists(body,'$.**.geometryClass ? (@ == "illustrative")') OR
      jsonb_path_exists(body,'$.**.geometry_class ? (@ == "illustrative")')`)).rows[0].n);
    if (n) geometryViolations.push({ table, count: n });
  }
  const backfills = (await client.query(`SELECT
    (SELECT count(*) FROM units u WHERE NOT EXISTS(SELECT 1 FROM identity_spaces s WHERE s.unit_id=u.id)) AS identities,
    (SELECT count(*) FROM registry_sites s WHERE NOT EXISTS(SELECT 1 FROM map_areas a WHERE a.site_id=s.id)) AS areas`)).rows[0];
  return { checkedForeignKeys: foreignKeys.length, orphans, geometryViolations,
    pendingBackfills: { identities: Number(backfills.identities), areas: Number(backfills.areas) } };
}
export async function originalIntegrity(client: PoolClient) {
  const { verifyObjectStream, closeStorageClient } = await import('@ulpin/server/infrastructure/storage');
  const sources = (await client.query('SELECT object_key,sha256,bytes FROM sources ORDER BY id')).rows;
  admitOriginalScan(sources.map(s => Number(s.bytes)));
  try {
    const deadline = Date.now()+originalVerificationBounds.scanMs;
    for (const source of sources) {
      requireGuard(Date.now() < deadline, 'ORIGINAL_SCAN_DEADLINE');
      await verifyObjectStream(source.object_key, Number(source.bytes), source.sha256,
        Math.min(originalVerificationBounds.perObjectMs,deadline-Date.now()));
    }
    return { verifiedCount: sources.length, verifiedBytes: sources.reduce((n,s) => n+Number(s.bytes),0) };
  } finally { closeStorageClient(); }
}
export async function datasetPins(client: PoolClient) {
  if (!(await client.query("SELECT to_regclass('public.spatial_datasets') AS name")).rows[0].name) return [];
  const rows = (await client.query(`SELECT id,sha256,(to_jsonb(d)->>'archived_at') IS NOT NULL AS archived,
    building_count,floor_count,source_count,
    encode(sha256(convert_to((to_jsonb(d)-'archived_at')::text,'UTF8')),'hex') AS fingerprint
    FROM spatial_datasets d ORDER BY id`)).rows;
  return rows.map(r => ({ id: r.id as string, originalSha256: r.sha256 as string, fingerprint: r.fingerprint as string,
    archived: r.archived as boolean, buildings: r.building_count as number, floors: r.floor_count as number,
    sourceCount: r.source_count as number, lineage: 'requires_original_review' as const }));
}
/** Reserve both outputs before connecting. The append-only fsynced journal survives a torn summary write. */
export function reserveReceipt(file: string, initial: unknown) {
  const output = toolPath(file), journal = `${output}.journal`;
  let summaryFd: number | undefined, journalFd: number | undefined;
  try {
    summaryFd = openSync(output, 'wx+', 0o600);
    journalFd = openSync(journal, 'ax', 0o600);
    const directoryFd = openSync(path.dirname(output),'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  } catch {
    if (summaryFd !== undefined) {
      writeSync(summaryFd, JSON.stringify({status:'failed',errorCode:'RECEIPT_ADMISSION_FAILED',mutationAttempted:false})+'\n');
      fsyncSync(summaryFd); closeSync(summaryFd);
    }
    if (journalFd !== undefined) closeSync(journalFd);
    throw Object.assign(new Error('RECEIPT_ADMISSION_FAILED'), {code:'RECEIPT_ADMISSION_FAILED'});
  }
  const ownedSummary = summaryFd, ownedJournal = journalFd;
  const summaryIdentity = fstatSync(ownedSummary), journalIdentity = fstatSync(ownedJournal);
  const unchanged = (file: string, expected: typeof summaryIdentity) => {
    const actual = lstatSync(file);
    requireGuard(actual.isFile() && actual.dev === expected.dev && actual.ino === expected.ino && actual.nlink === 1,
      'RECEIPT_OWNERSHIP_CHANGED');
  };
  let closed = false;
  const update = (value: unknown) => {
    requireGuard(!closed, 'RECEIPT_CLOSED');
    unchanged(output, summaryIdentity); unchanged(journal, journalIdentity);
    // No originals, row bodies, object keys or credentials are serialized.
    const line = JSON.stringify(value)+'\n';
    const entry=Buffer.from(line); let written=0;
    while (written<entry.length) written+=writeSync(ownedJournal,entry,written,entry.length-written,null);
    fsyncSync(ownedJournal);
    const summary = Buffer.from(JSON.stringify(value,null,2)+'\n');
    let offset = 0;
    while (offset < summary.length) offset += writeSync(ownedSummary,summary,offset,summary.length-offset,offset);
    ftruncateSync(ownedSummary,summary.length); fsyncSync(ownedSummary);
  };
  const close = () => { if (!closed) { closed=true; closeSync(ownedSummary); closeSync(ownedJournal); } };
  try { update(initial); } catch (error) { close(); throw error; }
  return { update, close, output, journal };
}
export function readReceipt(file: string) {
  const output = toolPath(file);
  try { return JSON.parse(readFileSync(output,'utf8')); }
  catch {
    // The last complete journal line is the recovery authority if a summary was interrupted.
    const lines = readFileSync(`${output}.journal`,'utf8').trimEnd().split('\n').reverse();
    for (const line of lines) { try { return JSON.parse(line); } catch {} }
    throw Object.assign(new Error('RECEIPT_UNREADABLE'), {code:'RECEIPT_UNREADABLE'});
  }
}
