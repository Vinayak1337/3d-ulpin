import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target || existsSync(target)) throw new Error('Supply a new receipt path.');
const nonce = randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
const key = randomBytes(24).toString('hex');
const secret = randomBytes(24).toString('hex');
const containers = [`ulpin-zb2-db-${nonce}`, `ulpin-zb2-store-${nonce}`];
const names = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
const receipt = { task: 'ZB2', startedAt: new Date().toISOString(), containers };

function safe(text = '') {
  if ([password, key, secret].some((value) => text.includes(value))) throw new Error('Secret in output; not recorded.');
  return text;
}

function docker(args, env = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000, env: { ...system, ...env } });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${safe(result.stderr).trim()}`);
  return safe(result.stdout).trim();
}

function image(repository) {
  const text = readFileSync('compose.yaml', 'utf8');
  const line = text.split('\n').find((row) => row.includes(`image: ${repository}:`));
  if (!line) throw new Error('Pinned image not found.');
  return line.trim().replace(/^image: /, '');
}

function start() {
  docker(['run', '-d', '--pull', 'never', '--name', containers[0], '--label', 'io.ulpin.task=ZB2',
    '--label', `io.ulpin.nonce=${nonce}`, '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'POSTGRES_USER=zb2_control', '-e', `POSTGRES_DB=zb2_${nonce}`, '-e', 'POSTGRES_PASSWORD',
    image('postgis/postgis')], { POSTGRES_PASSWORD: password });
  docker(['run', '-d', '--pull', 'never', '--name', containers[1], '--label', 'io.ulpin.task=ZB2',
    '--label', `io.ulpin.nonce=${nonce}`, '-p', '127.0.0.1::9000', '--tmpfs', '/data',
    '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', image('quay.io/minio/minio'), 'server', '/data'],
  { MINIO_ROOT_USER: key, MINIO_ROOT_PASSWORD: secret });
}

function port(container, internal) {
  const match = /^127\.0\.0\.1:(\d+)$/.exec(docker(['port', container, internal]));
  if (!match) throw new Error('Expected one loopback port.');
  return match[1];
}

function removeOwned(container) {
  if (!docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container)) return;
  for (const [label, value] of [['io.ulpin.task', 'ZB2'], ['io.ulpin.nonce', nonce]]) {
    if (docker(['inspect', '--format', `{{ index .Config.Labels "${label}" }}`, container]) !== value) {
      throw new Error('Ownership mismatch; removal refused.');
    }
  }
  docker(['rm', '--force', container]);
}

try {
  start();
  const databasePort = port(containers[0], '5432/tcp');
  const storePort = port(containers[1], '9000/tcp');
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/zb2/walk.ts'], { encoding: 'utf8', timeout: 2400000,
    maxBuffer: 8 * 1024 * 1024, env: { ...system, NODE_ENV: 'test', ULPIN_PROFILE: 'demo', REPO_DATA: 'false',
      DATABASE_URL: `postgresql://zb2_control@127.0.0.1:${databasePort}/zb2_${nonce}`, PGPASSWORD: password,
      S3_ENDPOINT: `http://127.0.0.1:${storePort}`, S3_ACCESS_KEY: key, S3_SECRET_KEY: secret,
      S3_BUCKET: 'zb2-originals',
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_ZB2_NONCE: nonce,
      ULPIN_LOCAL_OPERATOR_SUBJECT: 'zb2-isolated-walk', ULPIN_MODEL_GATEWAY_ENABLED: '0',
      PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const stdout = safe(result.stdout ?? '');
  receipt.exit = result.status;
  const last = stdout.trim().split(/\r?\n/).at(-1);
  receipt.walk = last ? JSON.parse(last) : null;
  if (result.status !== 0) receipt.failure = safe(result.stderr ?? '').slice(-3000) || 'Walk failed.';
} catch (error) {
  receipt.failure = safe(error.message);
} finally {
  for (const container of containers) removeOwned(container);
  const remaining = docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/);
  receipt.ownedContainersGone = containers.every((name) => !remaining.includes(name));
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(target, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ exit: receipt.exit, failure: receipt.failure ?? null,
  ownedContainersGone: receipt.ownedContainersGone }));
if (receipt.failure || receipt.exit !== 0 || !receipt.ownedContainersGone) process.exitCode = 1;
