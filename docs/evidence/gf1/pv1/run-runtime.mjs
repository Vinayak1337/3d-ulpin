// Nonce-owned fresh PostGIS/MinIO, actual worktree Nest API; no external configuration or shared volumes.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (process.argv.length !== 3 || !target || existsSync(target)) throw new Error('Supply one new receipt path.');
const nonce = randomBytes(8).toString('hex');
const db = `ulpin-pv1-db-${nonce}`;
const store = `ulpin-pv1-store-${nonce}`;
const database = `pv1_${nonce}`;
const password = randomBytes(24).toString('hex');
const access = randomBytes(12).toString('hex');
const secret = randomBytes(24).toString('hex');
const names = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));
function safe(text = '') {
  if ([password, access, secret].some(value => text.includes(value))) throw new Error('Secret in output.');
  return text;
}
function docker(args, extra = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 120000,
    maxBuffer: 8 * 1024 * 1024, env: { ...system, ...extra } });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${safe(result.stderr ?? '').trim()}`);
  return safe(result.stdout ?? '').trim();
}
function port(container, internal) {
  const published = docker(['port', container, internal]);
  const match = /^127\.0\.0\.1:(\d+)$/.exec(published);
  if (!match) throw new Error('Expected one loopback port.');
  return match[1];
}
function start() {
  const compose = readFileSync('compose.yaml', 'utf8');
  const pin = /image: (postgis\/postgis):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(compose);
  const minio = /image: (quay.io\/minio\/minio):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(compose);
  if (!pin || !minio) throw new Error('Both runtime images must be pinned.');
  const postgres = `${pin[1]}@${pin[2]}`;
  const storage = `${minio[1]}@${minio[2]}`;
  for (const image of [postgres, storage]) docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  docker(['run', '--detach', '--pull', 'never', '--name', db, '--label', 'io.ulpin.task=PV1',
    '--label', `io.ulpin.nonce=${nonce}`, '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=pv1_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', postgres], { POSTGRES_PASSWORD: password });
  docker(['run', '--detach', '--pull', 'never', '--name', store, '--label', 'io.ulpin.task=PV1',
    '--label', `io.ulpin.nonce=${nonce}`, '--publish', '127.0.0.1::9000', '--env', 'MINIO_ROOT_USER',
    '--env', 'MINIO_ROOT_PASSWORD', '--tmpfs', '/data', '--tmpfs', '/tmp', storage,
    'server', '/data', '--address', ':9000'], { MINIO_ROOT_USER: access, MINIO_ROOT_PASSWORD: secret });
  return { postgres, storage };
}
async function ready(storePort) {
  for (let second = 0; second < 60; second++) {
    const databaseReady = spawnSync('docker', ['exec', db, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'pv1_control', '-d', database], { windowsHide: true, timeout: 10000, env: system }).status === 0;
    const storageReady = await fetch(`http://127.0.0.1:${storePort}/minio/health/live`)
      .then(response => response.ok).catch(() => false);
    if (databaseReady && storageReady) return second;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Owned services not ready in 60 seconds.');
}
function child(dbPort, storePort) {
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/pv1/steps.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 1800000, maxBuffer: 8 * 1024 * 1024,
    env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false', ULPIN_MODEL_GATEWAY_ENABLED: '0',
      DATABASE_URL: `postgresql://pv1_control@127.0.0.1:${dbPort}/${database}`, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_PV1_DB: db, ULPIN_PV1_STORE: store,
      ULPIN_PV1_NONCE: nonce, ULPIN_LOCAL_OPERATOR_SUBJECT: 'pv1-runtime-control',
      S3_ENDPOINT: `http://127.0.0.1:${storePort}`, S3_ACCESS_KEY: access, S3_SECRET_KEY: secret,
      S3_BUCKET: `pv1-${nonce}`, S3_REGION: 'us-east-1',
      PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const progress = safe(result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return { exit: result.status, signal: result.signal, progress: progress.filter(row => row.completed),
    evidence: progress.at(-1) ?? null,
    ...(result.status !== 0
      ? { failure: safe(result.stderr ?? '').trim() || result.error?.code || 'Child reported failure' } : {}) };
}
function removeOwned(container) {
  if (!docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container)) return;
  for (const [key, expected] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'PV1']]) {
    const actual = docker(['inspect', '--format', `{{ index .Config.Labels "${key}" }}`, container]);
    if (actual !== expected) throw new Error('Ownership mismatch; no removal attempted.');
  }
  docker(['rm', '--force', container]);
}
async function main() {
  const receipt = { task: 'PV1', nonce, containers: [db, store], startedAt: new Date().toISOString() };
  try {
    receipt.images = start();
    const dbPort = port(db, '5432/tcp');
    const storePort = port(store, '9000/tcp');
    receipt.readyAfterSeconds = await ready(storePort);
    receipt.runtime = child(dbPort, storePort);
    if (receipt.runtime.exit !== 0) receipt.failure = receipt.runtime.failure;
  } catch (error) {
    receipt.failure = safe(String(error.message));
  } finally {
    for (const container of [store, db]) removeOwned(container);
    receipt.ownedNonceGone = docker(['ps', '-a', '--filter', `label=io.ulpin.nonce=${nonce}`,
      '--format', '{{.Names}}']) === '';
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(target, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify({ nonce, ownedNonceGone: receipt.ownedNonceGone, failure: receipt.failure ?? null }));
  if (receipt.failure || !receipt.ownedNonceGone) process.exitCode = 1;
}
await main();
