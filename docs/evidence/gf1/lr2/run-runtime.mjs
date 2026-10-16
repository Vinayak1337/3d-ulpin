import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (process.argv.length !== 3 || !target || existsSync(target)) throw new Error('Supply a new receipt path only.');
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-lr2-tmp-${nonce}`;
const database = `lr2_${nonce}`;
const password = randomBytes(24).toString('hex');
const names = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));

function safe(text = '') {
  if (text.includes(password)) throw new Error('Generated secret in output; not recorded.');
  return text;
}
function docker(args, extra = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...system, ...extra } });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${safe(result.stderr).trim()}`);
  return safe(result.stdout).trim();
}
function start() {
  const pin = /image: (postgis\/postgis):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(readFileSync('compose.yaml', 'utf8'));
  if (!pin) throw new Error('PostGIS image must be pinned.');
  const image = `${pin[1]}@${pin[2]}`;
  docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=LR2',
    '--label', `io.ulpin.nonce=${nonce}`, '--network', 'bridge', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=lr2_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image], { POSTGRES_PASSWORD: password });
  return image;
}
function ready() {
  for (let second = 0; second < 60; second++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'lr2_control', '-d', database], { windowsHide: true, timeout: 10000, env: system });
    if (result.status === 0) return second;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Owned database not ready in 60 seconds.');
}
function child(port) {
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/lr2/runtime.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 5400000, maxBuffer: 64 * 1024 * 1024,
    env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false', ULPIN_MODEL_GATEWAY_ENABLED: '0',
      DATABASE_URL: `postgresql://lr2_control@127.0.0.1:${port}/${database}`, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_LR2_CONTAINER: container, ULPIN_LR2_NONCE: nonce,
      ULPIN_LOCAL_OPERATOR_SUBJECT: 'lr2-http-control', PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const stdout = safe(result.stdout ?? '');
  const stderr = safe(result.stderr ?? '');
  const line = stdout.trim().split(/\r?\n/).at(-1);
  return { exit: result.status, evidence: line ? JSON.parse(line) : null,
    ...(result.status !== 0 ? { failure: stderr.trim() || result.error?.code || 'Child failed' } : {}) };
}
function removeOwned() {
  const owned = () => docker(['ps', '-a', '--filter', `name=^${container}$`, '--format', '{{.Names}}']) === container;
  if (!owned()) return { removed: null, ownedBoxGone: true };
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LR2']]) {
    if (docker(['inspect', '--format', `{{ index .Config.Labels "${key}" }}`, container]) !== value)
      throw new Error('Ownership mismatch; no removal attempted.');
  }
  docker(['rm', '--force', container]);
  return { removed: container, ownedBoxGone: !owned() };
}

const receipt = { task: 'LR2', container, nonce, startedAt: new Date().toISOString() };
try {
  receipt.image = start();
  receipt.readyAfterSeconds = ready();
  const port = /^127\.0\.0\.1:(\d+)$/.exec(docker(['port', container, '5432/tcp']));
  if (!port) throw new Error('Expected one loopback port.');
  receipt.runtime = child(port[1]);
  if (receipt.runtime.exit !== 0) receipt.failure = receipt.runtime.failure;
} catch (error) {
  receipt.failure = safe(String(error.message));
} finally {
  Object.assign(receipt, removeOwned(), { finishedAt: new Date().toISOString() });
  writeFileSync(target, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ container, removed: receipt.removed, ownedBoxGone: receipt.ownedBoxGone,
  failure: receipt.failure ?? null }));
if (receipt.failure || !receipt.ownedBoxGone) process.exitCode = 1;
