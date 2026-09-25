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
const previewProviderKeys = ['OPENAI_API_KEY', 'SARVAM_API_KEY', 'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
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
  if (!['local-colima', 'local-docker', 'local-preview'].includes(env.ULPIN_ISOLATION_PROFILE)) return assertHostedIsolation(env);
  const preview = env.ULPIN_ISOLATION_PROFILE === 'local-preview';
  const persistent = preview && env.ULPIN_PERSISTENT_PREVIEW === '1';
  assert(!env.ULPIN_PERSISTENT_PREVIEW || (persistent && env.ULPIN_FND06_MANUAL_HOLD === '1'));
  const colima = env.ULPIN_ISOLATION_PROFILE === 'local-colima' || (preview && process.platform === 'darwin');
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
    ['REDIS_URL', 'redis:', 26379, '/0'], ['ULPIN_TEST_URL', 'http:', preview ? persistent ? 3187 : 3108 : colima ? 3000 : 23000, '/'],
  ]) {
    const url = endpoint(env[key], protocol, port, path);
    assert.equal(url.username + url.password, '');
  }
  for (const [key, value] of Object.entries(ports)) assert.equal(env[key], value);
  for (const key of ['DOCKER_HOST', 'DOCKER_CERT_PATH', 'NOUS_API_KEY', 'OPENROUTER_API_KEY'])
    assert(!env[key], `${key} must not point at private or remote resources`);
  if (persistent) assert.equal(env.ULPIN_LOOPBACK_PORTS, '3187');
  if (preview) for (const key of previewProviderKeys)
    assert(!env[key], `${key} is forbidden in the read-only UI preview`);
  return scope;
}

export function uspProcessEnvironment(env, repositoryRoot) {
  assertUspIsolation(env);
  return { ...env, ULPIN_FIXTURE_ROOT: resolve(repositoryRoot, 'fixtures') };
}

async function run() {
  assert.equal(process.argv.length, 3, 'Usage: local-isolation.mjs --run|--preview-run|--privacy-run|--privacy-hold|--privacy-persistent');
  assert(['--run', '--preview-run', '--privacy-run', '--privacy-hold', '--privacy-persistent'].includes(process.argv[2]));
  const persistent = process.argv[2] === '--privacy-persistent';
  const manualHold = process.argv[2] === '--privacy-hold' || persistent;
  const privacy = process.argv[2] === '--privacy-run' || manualHold;
  const preview = privacy || process.argv[2] === '--preview-run';
  await assert.rejects(lstat(resolve(root, '.env')), { code: 'ENOENT' });
  const temporary = await mkdtemp(join(tmpdir(), 'ulpin-usptest-'));
  const nonce = randomBytes(8).toString('hex');
  const colima = process.platform === 'darwin';
  assert(['darwin', 'linux'].includes(process.platform), 'Local isolation needs macOS Colima or local Linux Docker');
  const project = `ulpin-usptest-${nonce}`;
  const database = `ulpin_usptest_${nonce}`;
  const password = randomBytes(32).toString('hex');
  const values = {
    ULPIN_ISOLATION_PROFILE: preview ? 'local-preview' : colima ? 'local-colima' : 'local-docker', ULPIN_LOCAL_NONCE: nonce,
    DOCKER_CONTEXT: colima ? 'colima-ulpin' : 'default', REPO_DATA: 'false', ULPIN_BASELINE_PROJECT: project,
    POSTGRES_DB: database, POSTGRES_USER: 'ulpin_usptest', POSTGRES_PASSWORD: password,
    POSTGRES_PORT: '25432', DATABASE_URL: `postgresql://ulpin_usptest:${password}@127.0.0.1:25432/${database}`,
    S3_ACCESS_KEY: 'ulpin_usptest', S3_SECRET_KEY: randomBytes(32).toString('hex'),
    S3_BUCKET: project, S3_ENDPOINT: 'http://127.0.0.1:29000', S3_REGION: 'us-east-1',
    S3_PORT: '29000', S3_CONSOLE_PORT: '29001', REDIS_URL: 'redis://127.0.0.1:26379/0',
    REDIS_PORT: '26379', GEO_URL: 'http://127.0.0.1:28000', GEO_PORT: '28000',
    GEO_SERVICE_TOKEN: randomBytes(32).toString('hex'),
    ULPIN_TEST_URL: `http://127.0.0.1:${preview ? persistent ? 3187 : 3108 : colima ? 3000 : 23000}`, NEXT_TELEMETRY_DISABLED: '1',
    ...(preview ? { ULPIN_LOOPBACK_PORTS: persistent ? '3187' : '3108', ULPIN_ALLOW_NON_INDIA_PROVIDER: '0', ULPIN_RELEASE_PROFILE: 'finale_v1' } : {}),
  };
  const env = { ...process.env, ...values };
  if (manualHold) env.ULPIN_FND06_MANUAL_HOLD = '1';
  if (persistent) env.ULPIN_PERSISTENT_PREVIEW = '1';
  for (const key of ['DOCKER_HOST', 'DOCKER_CERT_PATH', 'NOUS_API_KEY', 'OPENROUTER_API_KEY']) delete env[key];
  if (preview) for (const key of previewProviderKeys) delete env[key];
  assertUspIsolation(env);
  const file = join(temporary, 'ulpin-local.env');
  await writeFile(file, Object.entries(values).filter(([key]) => key !== 'ULPIN_ISOLATION_PROFILE' && key !== 'ULPIN_LOCAL_NONCE' && key !== 'DOCKER_CONTEXT')
    .map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  env.ULPIN_LOCAL_ENV_FILE = await realpath(file);
  try {
    const child = spawn(process.execPath, [privacy ? 'scripts/usp/gf/FND-06-isolated.mjs' : preview ? 'scripts/usp/ui/UI-03-isolated-preview.mjs' : 'scripts/usp/isolated-live.mjs'], { cwd: root, env, stdio: 'inherit' });
    const forward = signal => { if (child.exitCode === null) child.kill(signal); };
    const onInterrupt = () => forward('SIGINT'), onTerminate = () => forward('SIGTERM');
    process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
    let code;
    try { code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); }); }
    finally { process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate); }
    process.exitCode = code ?? 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(); } catch (error) { console.error(redact(error.stack || String(error), process.env)); process.exitCode = 1; }
}
