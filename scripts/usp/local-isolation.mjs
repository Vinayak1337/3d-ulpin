/** Fresh, loopback-only Colima profile for the FND integration test. */
import assert from 'node:assert/strict';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolation as assertHostedIsolation, redact } from '../engineering/isolation.mjs';

const ports = { POSTGRES_PORT: '25432', S3_PORT: '29000', S3_CONSOLE_PORT: '29001',
  REDIS_PORT: '26379', GEO_PORT: '28000' };
const localProviderKeys = ['OPENAI_API_KEY', 'SARVAM_API_KEY', 'ANTHROPIC_API_KEY',
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

/** Local OS identity attributes process writes; it does not authenticate a human. */
export function localOperatorProcessProvenance() {
  const {uid, username: account} = userInfo();
  assert(Number.isSafeInteger(uid) && uid >= 0, 'a local OS uid is required');
  assert(typeof account === 'string' && account.length > 0, 'a local OS account is required');
  const subject = `local-os:${uid}:${account}`;
  assert(subject.length <= 256 && subject.trim() === subject && !/[\x00-\x1f\x7f]/.test(subject), 'local OS identity cannot form an operator subject');
  return {kind: 'local_os_process', subject, uid, account, humanAuthenticated: false};
}

export function assertLocalOperatorProcess(env) {
  const provenance = localOperatorProcessProvenance();
  assert.equal(env.ULPIN_LOCAL_OPERATOR_SUBJECT, provenance.subject, 'explicit local OS process subject is required');
  return provenance;
}

export function assertUspIsolation(env) {
  if (!['local-colima', 'local-docker', 'local-preview', 'local-nest'].includes(env.ULPIN_ISOLATION_PROFILE)) return assertHostedIsolation(env);
  const preview = env.ULPIN_ISOLATION_PROFILE === 'local-preview';
  const nest = env.ULPIN_ISOLATION_PROFILE === 'local-nest';
  const persistent = preview && env.ULPIN_PERSISTENT_PREVIEW === '1';
  assert(!env.ULPIN_PERSISTENT_PREVIEW || (persistent && env.ULPIN_FND06_MANUAL_HOLD === '1'));
  const colima = env.ULPIN_ISOLATION_PROFILE === 'local-colima' || ((preview || nest) && process.platform === 'darwin');
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
    ['REDIS_URL', 'redis:', 26379, '/0'], ['ULPIN_TEST_URL', 'http:', nest ? 3188 : preview ? persistent ? 3187 : 3108 : colima ? 3000 : 23000, '/'],
  ]) {
    const url = endpoint(env[key], protocol, port, path);
    assert.equal(url.username + url.password, '');
  }
  for (const [key, value] of Object.entries(ports)) assert.equal(env[key], value);
  for (const key of ['DOCKER_HOST', 'DOCKER_CERT_PATH', 'NOUS_API_KEY', 'OPENROUTER_API_KEY'])
    assert(!env[key], `${key} must not point at private or remote resources`);
  if (persistent) assert.equal(env.ULPIN_LOOPBACK_PORTS, '3187');
  if (nest) {
    assert.equal(env.ULPIN_LOOPBACK_PORTS, '3188');
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.PORT, '3188');
    assert.equal(env.API_PORT, '3188');
    // Retained phase 2A configurations have no subject and remain readable for
    // status/cleanup. New startup and smoke additionally require the OS identity.
    if (env.ULPIN_LOCAL_OPERATOR_SUBJECT !== undefined) assertLocalOperatorProcess(env);
  }
  if (preview || nest) for (const key of localProviderKeys)
    assert(!env[key], `${key} is forbidden in this isolated local runtime`);
  return scope;
}

export function uspProcessEnvironment(env, repositoryRoot) {
  assertUspIsolation(env);
  return { ...env, ULPIN_FIXTURE_ROOT: resolve(repositoryRoot, 'fixtures') };
}

async function run() {
  assert.equal(process.argv.length, 3, 'Usage: local-isolation.mjs --run|--preview-run|--privacy-run|--privacy-hold|--privacy-persistent');
  assert(['--run', '--preview-run', '--privacy-run', '--privacy-hold', '--privacy-persistent'].includes(process.argv[2]));
  throw new Error('The historical isolated replay and preview runners depended on retired mixed saved-state bundles. A real-source isolated runner has not yet been qualified; no service or volume was changed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(); } catch (error) { console.error(redact(error.stack || String(error), process.env)); process.exitCode = 1; }
}
