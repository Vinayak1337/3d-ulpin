/** Privacy/Host read-only verification of the pinned repository snapshot in new nonce-owned services. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { lstat, realpath, readFile, writeFile, mkdir, open, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation, uspProcessEnvironment } from '../local-isolation.mjs';
import { redact } from '../../engineering/isolation.mjs';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const env = uspProcessEnvironment(process.env, root);
assert.equal(env.ULPIN_ISOLATION_PROFILE, 'local-preview');
const scope = assertUspIsolation(env);
await assert.rejects(lstat(resolve(root, '.env')), { code: 'ENOENT' });
const temporary = await realpath(resolve(env.ULPIN_LOCAL_ENV_FILE, '..'));
const envFile = await realpath(env.ULPIN_LOCAL_ENV_FILE);
assert.equal(relative(temporary, envFile), 'ulpin-local.env');
const output = resolve(root, `docs/evidence/usp/finale/GF-PRIVACY/FND-06/attempt-1/${scope.id}`);
await mkdir(output, { recursive: true });
const report = { schemaVersion: 'fnd06-isolated-privacy/1', scopeId: scope.id,
  codeSha: null, status: 'RUNNING', source: 'hash-pinned repo-data snapshot, retained historical regression only',
  commands: [], checks: [], screenshots: [], limitation: 'Historical snapshot only. No official PII accuracy, live provider or production build qualification.' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { Pool } = require('pg');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }, maxAttempts: 2 });
const colima = process.platform === 'darwin';
const dockerContext = colima ? 'colima-ulpin' : 'default';
const composeExecutable = colima ? 'docker-compose' : 'docker';
const composeArgs = [...(colima ? [] : ['--context', 'default', 'compose']), '--project-directory', root,
  '--env-file', envFile, '-p', scope.project, '-f', resolve(root, 'compose.yaml')];
let ownsProject = false;
let server;

async function command(label, executable, args, { input, timeout = 180000, childEnv = env } = {}) {
  const chunks = []; let size = 0;
  const child = spawn(executable, args, { cwd: root, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    size += chunk.length; if (size > 4 * 1024 * 1024) child.kill('SIGTERM'); else chunks.push(chunk);
  });
  child.stdin.on('error', () => {}); child.stdin.end(input);
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
  let code;
  try { code = await new Promise((done, fail) => { child.once('error', fail); child.once('close', done); }); }
  finally { clearTimeout(timer); }
  const output = redact(Buffer.concat(chunks).toString('utf8'), env);
  report.commands.push({ label, exitCode: code });
  if (code !== 0) throw new Error(`${label} failed (${code}): ${output.slice(-1200)}`);
  return output;
}
const compose = (label, args, options) => command(label, composeExecutable, [...composeArgs, ...args], options);
async function portFree(port) {
  const socket = createServer();
  await new Promise((done, fail) => { socket.once('error', fail); socket.listen(port, '127.0.0.1', done); });
  await new Promise((done, fail) => socket.close(error => error ? fail(error) : done()));
}
async function verifiedBytes(base, fileName, expected) {
  const file = resolve(base, fileName), rel = relative(base, file);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel));
  const info = await lstat(file); assert(info.isFile() && !info.isSymbolicLink());
  const actual = relative(await realpath(base), await realpath(file));
  assert(actual && !actual.startsWith('..') && !isAbsolute(actual));
  const bytes = await readFile(file);
  if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes);
  assert.equal(hash(bytes), expected.sha256);
  return bytes;
}
async function tableDigest(table) {
  assert.match(table.name, /^[a-z][a-z0-9_]*$/);
  const rows = (await pool.query(`SELECT row_to_json(t)::text AS body FROM public.${table.name} t`))
    .rows.map(row => row.body).sort();
  return { rows: rows.length, sha256: hash(rows.join('\n')) };
}
async function waitServer() {
  for (let i = 0; i < 90; i++) {
    assert.equal(server.exitCode, null, 'Preview server exited before readiness');
    try {
      const response = await fetch(`${env.ULPIN_TEST_URL}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
      const body = await response.json();
      if (body.dataMode === 'linked' && body.services?.database && body.services?.storage) return;
    } catch { /* next dev is still compiling */ }
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error('Isolated preview server did not become ready');
}

try {
  report.codeSha = (await command('code-sha', 'git', ['rev-parse', 'HEAD'])).trim();
  const manifest = JSON.parse(await readFile(resolve(root, 'repo-data/manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  const corpus = resolve(root, 'repo-data');
  const database = await verifiedBytes(corpus, manifest.database.file, manifest.database);
  for (const asset of manifest.assets) await verifiedBytes(root, asset.file, asset);
  for (const item of manifest.objects) await verifiedBytes(corpus, item.file, item);
  report.checks.push({ name: 'pinned-originals', databaseSha256: manifest.database.sha256,
    objectCount: manifest.objects.length });
  const endpoint = (await command('docker-context', 'docker', ['context', 'inspect', dockerContext,
    '--format', '{{.Endpoints.docker.Host}}'])).trim();
  assert.equal(endpoint, colima ? `unix://${env.HOME}/.colima/ulpin/docker.sock` : 'unix:///var/run/docker.sock');
  for (const [label, args, format] of [
    ['containers', ['ps', '-a'], '{{.ID}}'], ['volumes', ['volume', 'ls'], '{{.Name}}'],
  ]) assert.equal((await command(`empty-${label}`, 'docker', ['--context', dockerContext, ...args,
    '--filter', `label=com.docker.compose.project=${scope.project}`, '--format', format])).trim(), '');
  for (const port of [25432, 29000, 29001, 26379, 28000, 3108]) await portFree(port);
  report.checks.push({ name: 'new-project-and-loopback-ports' });
  ownsProject = true;
  await compose('owned-services-start', ['up', '-d', '--wait', 'postgres', 'minio', 'redis']);
  await compose('private-bucket-init', ['run', '--rm', 'minio-init']);
  assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db, scope.database);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'")).rows[0].n, 0);
  await compose('spatial-extension', ['exec', '-T', 'postgres', 'psql', '-U', env.POSTGRES_USER,
    '-d', scope.database, '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE EXTENSION IF NOT EXISTS postgis']);
  assert.equal((await s3.send(new ListObjectsV2Command({ Bucket: scope.bucket, MaxKeys: 1 }))).Contents?.length ?? 0, 0);
  for (const item of manifest.objects) await s3.send(new PutObjectCommand({ Bucket: scope.bucket,
    Key: item.key, Body: await verifiedBytes(corpus, item.file, item), ContentType: item.contentType,
    Metadata: item.metadata, IfNoneMatch: '*' }));
  await compose('exact-database-restore', ['exec', '-T', 'postgres', 'pg_restore', '-U', env.POSTGRES_USER,
    '-d', scope.database, '--no-owner', '--no-acl', '--schema=public', '--exit-on-error', '--single-transaction'],
  { input: database, timeout: 240000 });
  for (const table of manifest.tables) assert.deepEqual(await tableDigest(table), { rows: table.rows, sha256: table.sha256 }, table.name);
  for (const item of manifest.objects) {
    const stored = await s3.send(new GetObjectCommand({ Bucket: scope.bucket, Key: item.key }));
    assert.equal(hash(await stored.Body.transformToByteArray()), item.sha256);
  }
  report.checks.push({ name: 'snapshot-exact', tables: manifest.tables.length, objects: manifest.objects.length });
  await command('additive-schema-migration', process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { timeout: 240000 });
  const migratedRows = new Map();
  const migrationChanges = [];
  for (const table of manifest.tables) {
    const digest = await tableDigest(table);
    migratedRows.set(table.name, digest);
    if (digest.rows !== table.rows || digest.sha256 !== table.sha256)
      migrationChanges.push({ table: table.name, beforeRows: table.rows, afterRows: digest.rows,
        beforeSha256: table.sha256, afterSha256: digest.sha256 });
  }
  report.checks.push({ name: 'migrated-schema-baseline', tables: migratedRows.size, migrationChanges });
  await command('additive-schema-migration-replay', process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { timeout: 240000 });
  for (const table of manifest.tables) assert.deepEqual(await tableDigest(table), migratedRows.get(table.name), `migration replay ${table.name}`);
  const target = (await pool.query("SELECT a.id AS area_id, f.id AS building_id FROM map_areas a JOIN physical_features f ON f.area_id=a.id WHERE f.revision>0 AND f.body->>'kind'='building' ORDER BY CASE WHEN f.body->>'worldStatus'='observed' THEN 0 ELSE 1 END,a.id,f.id LIMIT 1")).rows[0] ?? null;
  const log = await open(resolve(output, 'next-dev.log'), 'w', 0o600);
  server = spawn(process.execPath, ['--require', resolve(root, 'scripts/usp/gf/FND-06-no-egress.cjs'), 'apps/web/node_modules/next/dist/bin/next', 'dev', 'apps/web',
    '--webpack', '--hostname', '127.0.0.1', '--port', '3108'], { cwd: root, env: {...env, NODE_OPTIONS: `--require=${JSON.stringify(resolve(root, 'scripts/usp/gf/FND-06-no-egress.cjs'))}`, ULPIN_EGRESS_RECEIPT: resolve(output,'server-egress.jsonl')}, stdio: ['ignore', log.fd, log.fd] });
  await waitServer();
  await command('privacy-http-browser', process.execPath, ['scripts/usp/gf/FND-06-browser.mjs'], {
    childEnv: {...env, ULPIN_FND06_OUTPUT: output}, timeout:240000 });
  report.screenshots = (await readdir(resolve(output, 'screenshots'))).filter(name => name.endsWith('.png')).sort();
  for (const table of manifest.tables) assert.deepEqual(await tableDigest(table), migratedRows.get(table.name), `post-browser ${table.name}`);
  const storedObjects = (await s3.send(new ListObjectsV2Command({ Bucket: scope.bucket }))).Contents ?? [];
  assert.deepEqual(storedObjects.map(item => item.Key).sort(), manifest.objects.map(item => item.key).sort());
  for (const item of manifest.objects) {
    const stored = await s3.send(new GetObjectCommand({ Bucket: scope.bucket, Key: item.key }));
    assert.equal(hash(await stored.Body.transformToByteArray()), item.sha256);
  }
  const egress = (await readFile(resolve(output,'server-egress.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert(egress.some(event=>event.event==='fetch-tripwire-installed'));
  assert.equal(egress.filter(event=>event.event==='non-loopback-fetch-denied').length,0);
  report.checks.push({name:'provider-fetch-tripwire',installedProcesses:egress.length,nonLoopbackAttempts:0});
  report.checks.push({ name: 'protected-data-unchanged-after-browser' });
  report.status = 'PASSED';
  report.target = target;
  console.log(JSON.stringify({ status: report.status, scopeId: scope.id, output }));
} catch (error) {
  report.status = 'FAILED';
  report.error = redact(error.stack ?? String(error), env).slice(-2400);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill('SIGTERM');
    await new Promise(done => { if (server.exitCode !== null) done(); else { server.once('close', done); setTimeout(done, 5000); } });
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await pool.end();
  if (ownsProject) {
    try { await compose('owned-services-cleanup', ['down', '--volumes', '--remove-orphans']); }
    catch (error) { report.cleanupError = redact(String(error), env); process.exitCode = 1; }
  }
  await writeFile(resolve(output, 'runner-receipt.json'), JSON.stringify(report, null, 2) + '\n');
}
