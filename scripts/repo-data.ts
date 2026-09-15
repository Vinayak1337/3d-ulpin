/** Portable snapshot tooling. No passwords, roles, queue contents or .env files enter the bundle. */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot, baseEnvironment, repositoryEnvironment, repositoryMode } from './repo-env.mjs';

const root = projectRoot();
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { Pool } = require('pg');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const metadataEqual = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const command = process.argv[2];
const options = process.argv.slice(3);
if (options.length && (options.length !== 2 || options[0] !== '--output' || command !== 'export')) throw Error('Only export supports --output <directory>.');
const bundle = resolve(root, options[1] || 'repo-data');
const repo = command === 'export' ? repositoryMode() : true;
const env: Record<string, string | undefined> = repo && command !== 'check' ? { ...baseEnvironment(), ...repositoryEnvironment(command === 'init') } : baseEnvironment();
const project = repo ? 'ulpin-repo' : 'ulpin';
const envFile = resolve(root, repo ? '.runtime/repo-data.env' : '.env');
let context = env.ULPIN_DOCKER_CONTEXT || env.DOCKER_CONTEXT;
if (!context && spawnSync('docker', ['context', 'inspect', 'colima-ulpin'], { stdio: 'ignore' }).status === 0) context = 'colima-ulpin';
const childEnv = { ...process.env, ...env, ...(context ? { DOCKER_CONTEXT: context } : {}) };
const modernCompose = spawnSync('docker', ['compose', 'version'], { env: childEnv, stdio: 'ignore' }).status === 0;
function compose(args: string[], input?: Uint8Array, capture = false): Buffer {
  const result = spawnSync(modernCompose ? 'docker' : 'docker-compose', [
    ...(modernCompose ? ['compose'] : []), '--project-directory', root, '--env-file', envFile,
    '-p', project, '-f', resolve(root, 'compose.yaml'), ...args,
  ], { env: childEnv, input, maxBuffer: 256 * 1024 * 1024, stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0 || result.error) {
    let detail = String(result.stderr || result.error?.message || '').slice(-1800);
    for (const value of [env.POSTGRES_PASSWORD, env.S3_SECRET_KEY, env.GEO_SERVICE_TOKEN, env.DATABASE_URL].filter(Boolean)) detail = detail.replaceAll(value!, '[redacted]');
    throw Error(`Docker Compose ${args[0]} failed. ${detail}`);
  }
  return result.stdout;
}
const p = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
async function objects() {
  const list: any[] = []; let token: string | undefined;
  do {
    const result = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, ContinuationToken: token }));
    list.push(...result.Contents || []); token = result.NextContinuationToken;
  } while (token);
  return list.sort((a, b) => a.Key.localeCompare(b.Key));
}
function safePath(base: string, name: string) {
  const path = resolve(base, name); const rel = relative(base, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Bundle path escapes its root.');
  return path;
}
async function tableDigests(db: any) {
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('spatial_ref_sys','repo_data_state') ORDER BY tablename")).rows;
  const result: any[] = [];
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const rows = (await db.query(`SELECT row_to_json(t)::text AS body FROM public.${quoted} t`)).rows.map((r: any) => r.body).sort();
    // A captured service credential must never be committed, including inside event text.
    for (const secret of [env.POSTGRES_PASSWORD, env.S3_SECRET_KEY, env.GEO_SERVICE_TOKEN, env.NOUS_API_KEY].filter(v => v && v.length > 8)) {
      if (rows.some((r: string) => r.includes(secret!))) throw Error(`Credential found in ${tablename}; export refused.`);
    }
    result.push({ name: tablename, rows: rows.length, sha256: hash(rows.join('\n')) });
  }
  return result;
}
async function assets() {
  const result: any[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push({ file: relative(root, path).replaceAll('\\', '/'), sha256: hash(await readFile(path)) });
    }
  }
  await walk(resolve(root, 'apps/web/public/scene-assets'));
  return result.sort((a, b) => a.file.localeCompare(b.file));
}
async function validateBundle() {
  const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1) throw Error('Unsupported bundle version.');
  if (new Set(manifest.objects.map((o: any) => o.key)).size !== manifest.objects.length) throw Error('Duplicate object keys in bundle.');
  for (const item of [manifest.database, ...manifest.objects, ...(manifest.files || [])]) {
    const bytes = await readFile(safePath(bundle, item.file));
    if (hash(bytes) !== item.sha256 || bytes.length !== item.bytes) throw Error(`Bundle checksum failed: ${item.file}`);
  }
  for (const item of manifest.assets) {
    if (hash(await readFile(safePath(root, item.file))) !== item.sha256) throw Error(`Presentation asset mismatch: ${item.file}`);
  }
  return manifest;
}
async function verifyRestored(manifest: any) {
  const tables = await tableDigests(p);
  if (JSON.stringify(tables) !== JSON.stringify(manifest.tables)) throw Error('Restored table counts or row hashes differ from the snapshot. Local edits may exist; nothing was overwritten.');
  for (const item of manifest.objects) {
    const response = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: item.key }));
    if (hash(await response.Body.transformToByteArray()) !== item.sha256) throw Error(`Stored object checksum failed: ${item.key}`);
    if (response.ContentType !== item.contentType || !metadataEqual(response.Metadata || {}, item.metadata)) throw Error(`Stored object metadata differs: ${item.key}`);
  }
  console.log(`Verified ${tables.length} tables and ${manifest.objects.length} stored objects, including unchanged originals.`);
}
async function exportBundle() {
  if (existsSync(resolve(bundle, 'manifest.json'))) throw Error('A bundle already exists. Export to a new directory with --output, inspect it, then explicitly replace the committed snapshot.');
  const url = new URL(env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== env.POSTGRES_DB || url.port !== (env.POSTGRES_PORT || '15432')) {
    throw Error('Export expects the selected local Compose database. Remote databases are not silently substituted.');
  }
  const client = await p.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const pending = (await client.query("SELECT count(*) FROM jobs WHERE status NOT IN ('succeeded','failed','stale')")).rows[0].count;
    if (Number(pending)) throw Error('Wait for active processing jobs to finish before exporting.');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const tables = await tableDigests(client);
    const dump = compose(['exec', '-T', 'postgres', 'pg_dump', '-U', env.POSTGRES_USER!, '-d', env.POSTGRES_DB!, '--format=custom', '--no-owner', '--no-acl', '--exclude-table=public.repo_data_state', `--snapshot=${snapshot}`], undefined, true);
    await mkdir(resolve(bundle, 'objects'), { recursive: true });
    await writeFile(resolve(bundle, 'database.dump'), dump);
    const originalObjects = await objects(); const saved: any[] = [];
    for (const object of originalObjects) {
      const response = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: object.Key }));
      const bytes = await response.Body.transformToByteArray();
      const sha256 = hash(bytes);
      const ext = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'application/json': 'json', 'text/csv': 'csv' } as Record<string, string>)[response.ContentType] || 'bin';
      const file = `objects/${sha256}.${ext}`;
      if (bytes.length > 95 * 1024 * 1024) throw Error('Object exceeds the repository file-size limit; use Git LFS before publishing.');
      for (const secret of [env.POSTGRES_PASSWORD, env.S3_SECRET_KEY, env.GEO_SERVICE_TOKEN, env.NOUS_API_KEY].filter(v => v && v.length > 8)) {
        if (Buffer.from(bytes).includes(Buffer.from(secret!)) || JSON.stringify(response.Metadata || {}).includes(secret!)) throw Error('Credential found in stored object; export refused.');
      }
      await writeFile(resolve(bundle, file), bytes);
      saved.push({ key: object.Key, file, sha256, bytes: bytes.length, contentType: response.ContentType || 'application/octet-stream', metadata: response.Metadata || {} });
    }
    const sourceRows = (await client.query('SELECT object_key,sha256,bytes FROM sources')).rows;
    for (const source of sourceRows) {
      const object = saved.find(o => o.key === source.object_key);
      if (!object || object.sha256 !== source.sha256 || object.bytes !== Number(source.bytes)) throw Error('A retained original is missing or differs from its database fingerprint.');
    }
    const after = await objects();
    if (JSON.stringify(originalObjects.map(o => [o.Key, o.ETag, o.Size])) !== JSON.stringify(after.map(o => [o.Key, o.ETag, o.Size]))) throw Error('Storage changed during export. Retry once processing is idle.');
    const files: any[] = [];
    const installed = resolve(root, 'fixtures/reference-neighborhood/installed.json');
    if (existsSync(installed)) {
      const bytes = await readFile(installed); await writeFile(resolve(bundle, 'installed.json'), bytes);
      files.push({ file: 'installed.json', bytes: bytes.length, sha256: hash(bytes) });
    }
    const manifest = { version: 1, createdAt: new Date().toISOString(), database: { file: 'database.dump', bytes: dump.length, sha256: hash(dump) }, tables, objects: saved, assets: await assets(), files,
      exclusions: ['Service credentials and roles', 'Redis execution queue/cache', 'Browser-local measurement notes and preferences'],
      provenance: 'Complete local application snapshot: fictional authored/test records and retained NYC Open Data observations. Existing source attribution and original bytes are preserved.' };
    await writeFile(resolve(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await client.query('COMMIT');
    console.log(`Exported ${tables.length} tables, ${saved.length} objects; database archive ${(dump.length / 1048576).toFixed(2)} MiB. No credentials exported.`);
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
}
async function initialize() {
  const manifest = await validateBundle(); // Validate everything before touching a database.
  compose(['up', '-d', '--wait', 'postgres', 'minio', 'redis']);
  compose(['run', '--rm', 'minio-init']);
  const tables = (await p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys'")).rows;
  if (tables.length) {
    const marker = tables.some((r: any) => r.tablename === 'repo_data_state') ? (await p.query('SELECT bundle_sha256 FROM repo_data_state')).rows[0] : undefined;
    if (!marker || marker.bundle_sha256 !== manifest.database.sha256) throw Error('Repository database is nonempty or belongs to another snapshot. Preserved without changes; use a separate environment for a newer snapshot.');
    console.log('Repository data already initialized. Preserving all local edits and history.');
  } else {
    const existing = await objects();
    if (existing.some(o => !manifest.objects.some((item: any) => item.key === o.Key))) throw Error('Repository bucket contains objects outside this snapshot; preserved without changes.');
    // Restore only to the dedicated project. Never clean/drop a populated database.
    for (const item of manifest.objects) {
      if (existing.some(o => o.Key === item.key)) {
        const response = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: item.key }));
        if (hash(await response.Body.transformToByteArray()) !== item.sha256) throw Error('An existing object differs from the snapshot; preserved without changes.');
        continue; // Resume a failed first restore only when retained bytes still match.
      }
      await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: item.key, Body: await readFile(safePath(bundle, item.file)), ContentType: item.contentType, Metadata: item.metadata, IfNoneMatch: '*' }));
    }
    compose(['exec', '-T', 'postgres', 'pg_restore', '-U', env.POSTGRES_USER!, '-d', env.POSTGRES_DB!, '--no-owner', '--no-acl', '--schema=public', '--exit-on-error', '--single-transaction'], await readFile(resolve(bundle, manifest.database.file)), true);
    await verifyRestored(manifest);
    await p.query('CREATE TABLE repo_data_state (bundle_sha256 text PRIMARY KEY, restored_at timestamptz NOT NULL DEFAULT now())');
    await p.query('INSERT INTO repo_data_state(bundle_sha256) VALUES($1)', [manifest.database.sha256]);
    const installed = resolve(root, 'fixtures/reference-neighborhood/installed.json');
    if (!existsSync(installed) && manifest.files.some((f: any) => f.file === 'installed.json')) await copyFile(resolve(bundle, 'installed.json'), installed);
  }
  compose(['--profile', 'app', 'up', '-d', '--build', '--wait']);
  console.log('Repository platform ready. Set REPO_DATA=true in .env, then restart the web app and dispatcher.');
}
try {
  if (command === 'export') await exportBundle();
  else if (command === 'init') await initialize();
  else if (command === 'verify') await verifyRestored(await validateBundle());
  else if (command === 'check') { const m = await validateBundle(); console.log(`Bundle hashes valid: ${m.tables.length} tables, ${m.objects.length} objects, ${m.assets.length} presentation assets.`); }
  else throw Error('Use repo:export, repo:init, repo:verify or repo:check.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Repository data operation failed.'); process.exitCode = 1;
} finally { await p.end(); s3.destroy(); }
