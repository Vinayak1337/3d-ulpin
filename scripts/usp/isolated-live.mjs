/** Focused hosted-only FND integration, using the established T001 isolation profile. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolation, redact, testProcessEnvironment } from '../engineering/isolation.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scope = assertIsolation(process.env);
assert.equal(process.platform, 'linux');
await assert.rejects(lstat(resolve(root, '.env')), { code: 'ENOENT' });
const temporary = await realpath(process.env.RUNNER_TEMP);
const envFile = await realpath(process.env.ULPIN_BASELINE_ENV_FILE);
assert.equal(relative(temporary, envFile), 'ulpin-t001.env');
const childEnv = testProcessEnvironment(process.env, root);
const out = resolve(root, '.runtime/usp-live');
await mkdir(out, { recursive: true });
const report = { schemaVersion: 'usp-isolated-live/1', codeSha: null, scopeId: scope.id,
  result: 'RUNNING', checks: [], commands: [], limitation: 'Synthetic D0 and retained Nandan baseline; real D1 and public deployment remain separate' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { Pool } = require('pg');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION,
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY }, maxAttempts: 2 });
const composeArgs = ['--context', 'default', 'compose', '--project-directory', root,
  '--env-file', envFile, '-p', scope.project, '-f', resolve(root, 'compose.yaml')];
let ownsProject = false;
let server;

async function command(label, executable, args, { input, timeout = 600000, env = childEnv } = {}) {
  const start = Date.now(), chunks = [];
  let size = 0;
  const child = spawn(executable, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const receive = chunk => { size += chunk.length; if (size <= 16 * 1024 * 1024) chunks.push(chunk); else child.kill('SIGTERM'); };
  child.stdout.on('data', receive); child.stderr.on('data', receive);
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
  let code;
  try { code = await new Promise((resolveCode, reject) => {
    child.once('error', reject); child.once('close', resolveCode);
  }); } finally { clearTimeout(timer); }
  const output = redact(Buffer.concat(chunks).toString('utf8'), process.env);
  report.commands.push({ label, exitCode: code, durationMs: Date.now() - start });
  if (code !== 0) throw new Error(`${label} failed (${code}): ${output.slice(-1800)}`);
  return output;
}
const compose = (label, args, options) => command(label, 'docker', [...composeArgs, ...args], options);

async function verifiedBytes(base, name, expected) {
  assert.equal(typeof name, 'string');
  const file = resolve(base, name), rel = relative(base, file);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel));
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink());
  const real = relative(await realpath(base), await realpath(file));
  assert(real && !real.startsWith('..') && !isAbsolute(real));
  const bytes = await readFile(file);
  if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes);
  assert.equal(hash(bytes), expected.sha256);
  return bytes;
}

async function waitServer() {
  for (let i = 0; i < 90; i++) {
    assert(server.exitCode === null, 'Production server exited before readiness');
    try {
      const response = await fetch('http://127.0.0.1:3000/api/v1/health', { signal: AbortSignal.timeout(3000) });
      const data = await response.json();
      if (response.ok && data.ok && data.dataMode === 'linked') return;
    } catch { /* wait */ }
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error('Isolated production server did not become ready');
}

try {
  report.codeSha = (await command('source-sha', 'git', ['rev-parse', 'HEAD'])).trim();
  const manifest = JSON.parse(await readFile(resolve(root, 'repo-data/manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  const repo = resolve(root, 'repo-data');
  const database = await verifiedBytes(repo, manifest.database.file, manifest.database);
  for (const asset of manifest.assets) await verifiedBytes(root, asset.file, asset);
  assert.equal((await command('docker-default', 'docker', ['context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}'])).trim(),
    'unix:///var/run/docker.sock');
  assert.equal((await command('existing-project', 'docker', ['--context', 'default', 'ps', '-a',
    '--filter', `label=com.docker.compose.project=${scope.project}`, '--format', '{{.ID}}'])).trim(), '');
  assert.equal((await command('existing-volumes', 'docker', ['--context', 'default', 'volume', 'ls',
    '--filter', `label=com.docker.compose.project=${scope.project}`, '--format', '{{.Name}}'])).trim(), '');
  ownsProject = true;
  await compose('services-start', ['--profile', 'app', 'up', '-d', '--build', '--wait']);
  const client = await pool.connect();
  try {
    assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db, scope.database);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'")).rows[0].n, 0);
    assert.equal((await s3.send(new ListObjectsV2Command({ Bucket: scope.bucket, MaxKeys: 1 }))).Contents?.length ?? 0, 0);
    for (const item of manifest.objects) await s3.send(new PutObjectCommand({ Bucket: scope.bucket,
      Key: item.key, Body: await verifiedBytes(repo, item.file, item),
      ContentType: item.contentType, Metadata: item.metadata, IfNoneMatch: '*' }));
    await compose('database-restore', ['exec', '-T', 'postgres', 'pg_restore', '-U', process.env.POSTGRES_USER,
      '-d', scope.database, '--no-owner', '--no-acl', '--schema=public', '--exit-on-error', '--single-transaction'],
      { input: database });
    for (const table of manifest.tables) {
      assert.match(table.name, /^[a-z][a-z0-9_]*$/);
      const rows = (await client.query(`SELECT row_to_json(t)::text AS body FROM (SELECT * FROM public.${table.name}) t`))
        .rows.map(row => row.body).sort();
      assert.equal(rows.length, table.rows, `Restored row count: ${table.name}`);
      assert.equal(hash(rows.join('\n')), table.sha256, `Restored row digest: ${table.name}`);
    }
    for (const item of manifest.objects) {
      const stored = await s3.send(new GetObjectCommand({ Bucket: scope.bucket, Key: item.key }));
      const bytes = await stored.Body.transformToByteArray();
      assert.equal(hash(bytes), item.sha256);
    }
    report.checks.push({ name: 'restored-db-and-originals', tables: manifest.tables.length,
      objects: manifest.objects.length });
    await command('migration', 'node', ['--import', 'tsx', 'scripts/migrate.ts']);
    await command('repeat-migration', 'node', ['--import', 'tsx', 'scripts/migrate.ts']);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM usp_migration_ledger WHERE name='usp_f1_min_001'")).rows[0].n, 1);
    report.checks.push({ name: 'additive-migration-replay' });
  } finally { client.release(); }
  server = spawn(process.execPath, ['apps/web/node_modules/next/dist/bin/next', 'start', 'apps/web',
    '--hostname', '127.0.0.1', '--port', '3000'],
    { cwd: root, env: childEnv, detached: true, stdio: 'ignore' });
  await waitServer();
  await command('usp-verify-live', 'node', ['--import', 'tsx', 'scripts/usp/verify-live.ts'], { timeout: 180000 });
  const receipt = JSON.parse(await readFile(resolve(root, '.runtime/engineering/usp-fnd-live.json'), 'utf8'));
  assert.equal(receipt.status, 'passed');
  report.checks.push({ name: 'fnd-live-receipt', receipt });
  const d0ReceiptFile = resolve(root, '.runtime/engineering/usp-d0-import.json');
  const d0Env = { ...childEnv, ULPIN_TEST_BASE_URL: childEnv.ULPIN_TEST_URL,
    ULPIN_D0_RECEIPT_FILE: d0ReceiptFile, DEMO_BASE_URL: childEnv.ULPIN_TEST_URL };
  await command('d0-authored-pack', 'pnpm', ['exec', 'tsx', 'scripts/usp/data/verify-d0.ts'], { env: d0Env });
  await command('d0-import-plan', 'pnpm', ['exec', 'tsx', 'scripts/usp/data/import-d0.ts'], { env: d0Env });
  await command('d0-import-apply', 'pnpm', ['exec', 'tsx', 'scripts/usp/data/import-d0.ts',
    '--apply', '--receipt', d0ReceiptFile], { env: d0Env, timeout: 900000 });
  const d0Import = JSON.parse(await readFile(d0ReceiptFile, 'utf8'));
  assert.equal(d0Import.schemaVersion, 'usp-d0-import-receipt/1');
  await command('d0-live-verify', 'pnpm', ['exec', 'tsx', 'scripts/usp/verify-d0-live.ts'], { env: d0Env, timeout: 180000 });
  const d0Live = JSON.parse(await readFile(resolve(root, '.runtime/engineering/usp-d0-live.json'), 'utf8'));
  assert.equal(d0Live.status, 'passed');
  await command('d0-studio-browser', 'pnpm', ['exec', 'playwright', 'test',
    'tests/e2e/usp-product-journey.spec.ts'], { env: d0Env, timeout: 180000 });
  report.checks.push({ name: 'd0-v0-live-receipts', import: d0Import, live: d0Live,
    browser: 'tests/e2e/usp-product-journey.spec.ts passed against production server' });
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = redact(error.stack || String(error), process.env);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (server?.pid && server.exitCode === null) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await pool.end(); s3.destroy();
  if (ownsProject) try {
    assertIsolation(process.env);
    await compose('owned-services-cleanup', ['--profile', 'app', 'down', '--volumes', '--remove-orphans'], { timeout: 120000 });
  } catch (error) {
    report.result = 'FAIL'; report.cleanupError = redact(String(error), process.env); process.exitCode = 1;
  }
  await writeFile(resolve(out, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`USP isolated live: ${report.result}`);
}
