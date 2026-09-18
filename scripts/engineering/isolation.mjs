/** Fail-closed hosted-test profile. This module performs no I/O on import. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { lstat, realpath, writeFile, appendFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'Vinayak1337/3d-ulpin';
export function hostedScope(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'This profile requires GitHub Actions');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Self-hosted resources are not permitted');
  assert.equal(env.RUNNER_OS, 'Linux', 'This profile requires an isolated Linux runner');
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY, 'Unexpected repository');
  assert.match(env.GITHUB_RUN_ID || '', /^[1-9][0-9]{0,19}$/, 'Invalid run ID');
  assert.match(env.GITHUB_RUN_ATTEMPT || '', /^[1-9][0-9]{0,4}$/, 'Invalid run attempt');
  const suffix = `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  return Object.freeze({
    id: `t001-${suffix}`,
    project: `ulpin-t001-${suffix}`,
    database: `ulpin_t001_${suffix.replaceAll('-', '_')}`,
    bucket: `ulpin-t001-${suffix}`,
  });
}

function endpoint(value, protocol, port, pathname, name, allowUser = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} is not a valid explicit URL`); }
  assert.equal(url.protocol, protocol, `${name}: unexpected protocol`);
  assert.equal(url.hostname, '127.0.0.1', `${name}: only literal loopback is permitted`);
  assert.equal(url.port, String(port), `${name}: unexpected test port`);
  assert.equal(url.pathname, pathname, `${name}: unexpected resource path`);
  assert.equal(url.search + url.hash, '', `${name}: query/fragment not permitted`);
  if (!allowUser) assert.equal(url.username + url.password, '', `${name}: userinfo not permitted`);
  return url;
}

export function assertIsolation(env) {
  const scope = hostedScope(env);
  assert.equal(env.REPO_DATA, 'false', 'REPO_DATA must explicitly disable repository-mode defaults');
  assert.equal(env.ULPIN_BASELINE_PROJECT, scope.project, 'Unexpected Compose project');
  assert.equal(env.POSTGRES_DB, scope.database, 'Unexpected database name');
  assert.equal(env.POSTGRES_USER, 'ulpin_t001', 'Unexpected test database user');
  assert.equal(env.S3_BUCKET, scope.bucket, 'Unexpected test bucket');
  assert.equal(env.S3_ACCESS_KEY, 'ulpin_t001', 'Unexpected test storage account');
  for (const key of ['POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN'])
    assert(/^[a-f0-9]{64}$/.test(env[key] || ''), `${key} must be generated for this runner`);
  const db = endpoint(env.DATABASE_URL, 'postgresql:', 25432, `/${scope.database}`, 'DATABASE_URL', true);
  assert.equal(db.username, env.POSTGRES_USER, 'Database URL user differs');
  assert(db.password === env.POSTGRES_PASSWORD, 'Database URL credential differs');
  endpoint(env.S3_ENDPOINT, 'http:', 29000, '/', 'S3_ENDPOINT');
  endpoint(env.GEO_URL, 'http:', 28000, '/', 'GEO_URL');
  endpoint(env.REDIS_URL, 'redis:', 26379, '/0', 'REDIS_URL');
  endpoint(env.ULPIN_TEST_URL, 'http:', 3000, '/', 'ULPIN_TEST_URL');
  for (const [key, port] of Object.entries({POSTGRES_PORT:25432, S3_PORT:29000, S3_CONSOLE_PORT:29001, REDIS_PORT:26379, GEO_PORT:28000}))
    assert.equal(env[key], String(port), `${key} must match the test endpoint`);
  for (const key of ['DOCKER_HOST', 'DOCKER_CERT_PATH', 'NOUS_API_KEY', 'OPENROUTER_API_KEY'])
    assert(!env[key], `${key} must not point at private or remote resources`);
  assert(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default', 'Remote Docker contexts are not allowed');
  return scope;
}

export function generatedEnvironment(env, secret = () => randomBytes(32).toString('hex')) {
  const scope = hostedScope(env);
  const password = secret();
  const values = {
    REPO_DATA:'false', ULPIN_BASELINE_PROJECT:scope.project,
    POSTGRES_DB:scope.database, POSTGRES_USER:'ulpin_t001', POSTGRES_PASSWORD:password,
    POSTGRES_PORT:'25432', DATABASE_URL:`postgresql://ulpin_t001:${password}@127.0.0.1:25432/${scope.database}`,
    S3_ACCESS_KEY:'ulpin_t001', S3_SECRET_KEY:secret(), S3_BUCKET:scope.bucket,
    S3_ENDPOINT:'http://127.0.0.1:29000', S3_REGION:'us-east-1', S3_PORT:'29000', S3_CONSOLE_PORT:'29001',
    REDIS_URL:'redis://127.0.0.1:26379/0', REDIS_PORT:'26379',
    GEO_URL:'http://127.0.0.1:28000', GEO_PORT:'28000', GEO_SERVICE_TOKEN:secret(),
    ULPIN_TEST_URL:'http://127.0.0.1:3000', NEXT_TELEMETRY_DISABLED:'1',
  };
  assertIsolation({...env, ...values});
  return values;
}

export function redact(text, env) {
  let result = String(text);
  for (const key of ['DATABASE_URL', 'POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN'])
    if (env[key]) result = result.replaceAll(env[key], '[redacted]');
  return result;
}

/** The test server is launched from the repo root, not pnpm's app-directory cwd. */
export function testProcessEnvironment(env, repositoryRoot) {
  assertIsolation(env);
  assert(isAbsolute(repositoryRoot), 'Test fixture root requires an absolute checkout path');
  return {...env, ULPIN_FIXTURE_ROOT: resolve(repositoryRoot, 'fixtures')};
}

async function prepare() {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  await assert.rejects(lstat(resolve(root, '.env')), {code:'ENOENT'}, 'A private root .env must not be present on the hosted runner');
  const temporary = await realpath(process.env.RUNNER_TEMP || '');
  assert(isAbsolute(temporary) && temporary !== root, 'A runner temporary directory is required');
  const file = resolve(temporary, 'ulpin-t001.env');
  assert.equal(relative(temporary, file), 'ulpin-t001.env');
  const values = generatedEnvironment(process.env);
  for (const key of ['POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN'])
    console.log(`::add-mask::${values[key]}`);
  const content = Object.entries(values).map(([key,value]) => `${key}=${value}`).join('\n') + '\n';
  await writeFile(file, content, {flag:'wx', mode:0o600});
  assert(process.env.GITHUB_ENV, 'GitHub environment file is required');
  assert(!file.includes('\n') && !file.includes('\r'));
  await appendFile(process.env.GITHUB_ENV, content + `ULPIN_BASELINE_ENV_FILE=${file}\n`);
  console.log('Prepared new isolated runner resources; credentials are not part of the report.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--prepare' || process.argv.length !== 3) throw new Error('Usage: isolation.mjs --prepare');
  await prepare();
}
