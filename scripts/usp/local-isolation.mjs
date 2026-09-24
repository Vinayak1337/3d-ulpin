/** Fresh, loopback-only Colima profile for the FND integration test. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertIsolation as assertHostedIsolation, redact } from '../engineering/isolation.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ports = { POSTGRES_PORT: '25432', S3_PORT: '29000', S3_CONSOLE_PORT: '29001',
  REDIS_PORT: '26379', GEO_PORT: '28000' };
const endpoint = (value, protocol, port, path) => {
  const url = new URL(value);
  assert.equal(url.protocol, protocol);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, String(port));
  assert.equal(url.pathname, path);
  assert.equal(url.search + url.hash, '');
  return url;
};

export function assertUspIsolation(env) {
  if (!['local-colima', 'local-docker'].includes(env.ULPIN_ISOLATION_PROFILE)) return assertHostedIsolation(env);
  const colima = env.ULPIN_ISOLATION_PROFILE === 'local-colima';
  assert.equal(process.platform, colima ? 'darwin' : 'linux');
  assert.equal(env.DOCKER_CONTEXT, colima ? 'colima-ulpin' : 'default');
  assert.equal(env.REPO_DATA, 'false');
  assert.match(env.ULPIN_LOCAL_NONCE || '', /^[a-f0-9]{16}$/);
  const suffix = env.ULPIN_LOCAL_NONCE;
  const scope = Object.freeze({ id: `local-${suffix}`, project: `ulpin-usptest-${suffix}`,
    database: `ulpin_usptest_${suffix}`, bucket: `ulpin-usptest-${suffix}` });
  assert.equal(env.ULPIN_BASELINE_PROJECT, scope.project);
  assert.equal(env.POSTGRES_DB, scope.database);
  assert.equal(env.POSTGRES_USER, 'ulpin_usptest');
  assert.equal(env.S3_BUCKET, scope.bucket);
  assert.equal(env.S3_ACCESS_KEY, 'ulpin_usptest');
  for (const key of ['POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN'])
    assert.match(env[key] || '', /^[a-f0-9]{64}$/);
  const db = endpoint(env.DATABASE_URL, 'postgresql:', 25432, `/${scope.database}`);
  assert.equal(db.username, env.POSTGRES_USER);
  assert.equal(db.password, env.POSTGRES_PASSWORD);
  for (const [key, protocol, port, path] of [
    ['S3_ENDPOINT', 'http:', 29000, '/'], ['GEO_URL', 'http:', 28000, '/'],
    ['REDIS_URL', 'redis:', 26379, '/0'], ['ULPIN_TEST_URL', 'http:', colima ? 3000 : 23000, '/'],
  ]) {
    const url = endpoint(env[key], protocol, port, path);
    assert.equal(url.username + url.password, '');
  }
  for (const [key, value] of Object.entries(ports)) assert.equal(env[key], value);
  for (const key of ['DOCKER_HOST', 'DOCKER_CERT_PATH', 'NOUS_API_KEY', 'OPENROUTER_API_KEY'])
    assert(!env[key], `${key} must not point at private or remote resources`);
  return scope;
}

export function uspProcessEnvironment(env, repositoryRoot) {
  assertUspIsolation(env);
  return { ...env, ULPIN_FIXTURE_ROOT: resolve(repositoryRoot, 'fixtures') };
}

async function run() {
  assert.equal(process.argv.length, 3, 'Usage: local-isolation.mjs --run');
  assert.equal(process.argv[2], '--run');
  await assert.rejects(lstat(resolve(root, '.env')), { code: 'ENOENT' });
  const temporary = await mkdtemp(join(tmpdir(), 'ulpin-usptest-'));
  const nonce = randomBytes(8).toString('hex');
  const colima = process.platform === 'darwin';
  assert(['darwin', 'linux'].includes(process.platform), 'Local isolation needs macOS Colima or local Linux Docker');
  const project = `ulpin-usptest-${nonce}`;
  const database = `ulpin_usptest_${nonce}`;
  const password = randomBytes(32).toString('hex');
  const values = {
    ULPIN_ISOLATION_PROFILE: colima ? 'local-colima' : 'local-docker', ULPIN_LOCAL_NONCE: nonce,
    DOCKER_CONTEXT: colima ? 'colima-ulpin' : 'default', REPO_DATA: 'false', ULPIN_BASELINE_PROJECT: project,
    POSTGRES_DB: database, POSTGRES_USER: 'ulpin_usptest', POSTGRES_PASSWORD: password,
    POSTGRES_PORT: '25432', DATABASE_URL: `postgresql://ulpin_usptest:${password}@127.0.0.1:25432/${database}`,
    S3_ACCESS_KEY: 'ulpin_usptest', S3_SECRET_KEY: randomBytes(32).toString('hex'),
    S3_BUCKET: project, S3_ENDPOINT: 'http://127.0.0.1:29000', S3_REGION: 'us-east-1',
    S3_PORT: '29000', S3_CONSOLE_PORT: '29001', REDIS_URL: 'redis://127.0.0.1:26379/0',
    REDIS_PORT: '26379', GEO_URL: 'http://127.0.0.1:28000', GEO_PORT: '28000',
    GEO_SERVICE_TOKEN: randomBytes(32).toString('hex'),
    ULPIN_TEST_URL: `http://127.0.0.1:${colima ? 3000 : 23000}`, NEXT_TELEMETRY_DISABLED: '1',
  };
  const env = { ...process.env, ...values };
  for (const key of ['DOCKER_HOST', 'DOCKER_CERT_PATH', 'NOUS_API_KEY', 'OPENROUTER_API_KEY']) delete env[key];
  assertUspIsolation(env);
  const file = join(temporary, 'ulpin-local.env');
  await writeFile(file, Object.entries(values).filter(([key]) => key !== 'ULPIN_ISOLATION_PROFILE' && key !== 'ULPIN_LOCAL_NONCE' && key !== 'DOCKER_CONTEXT')
    .map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  env.ULPIN_LOCAL_ENV_FILE = await realpath(file);
  try {
    const child = spawn(process.execPath, ['scripts/usp/isolated-live.mjs'], { cwd: root, env, stdio: 'inherit' });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    process.exitCode = code ?? 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(); } catch (error) { console.error(redact(error.stack || String(error), process.env)); process.exitCode = 1; }
}
