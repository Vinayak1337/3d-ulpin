// Nonce-owned CAR box; no demo configuration, volume or machine-wide equality check.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target || existsSync(target)) throw new Error('Supply a new immutable receipt path.');
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-au3-tmp-${nonce}`;
const database = `au3_${nonce}`;
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
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=AU3',
    '--label', `io.ulpin.nonce=${nonce}`, '--network', 'bridge', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=au3_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image], { POSTGRES_PASSWORD: password });
  return image;
}

function ready() {
  for (let second = 0; second < 60; second++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'au3_control', '-d', database], { windowsHide: true, timeout: 10000, env: system });
    if (result.status === 0) return second;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Owned database not ready in 60 seconds.');
}

function child(port) {
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/au3/steps.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 360000, maxBuffer: 4 * 1024 * 1024,
    env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false',
      DATABASE_URL: `postgresql://au3_control@127.0.0.1:${port}/${database}`, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_AU3_CONTAINER: container, ULPIN_AU3_NONCE: nonce,
      ULPIN_MODEL_GATEWAY_ENABLED: '0', ULPIN_LOCAL_OPERATOR_SUBJECT: 'au3-runtime-control',
      PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const stdout = safe(result.stdout ?? '');
  const stderr = safe(result.stderr ?? '');
  return { exit: result.status, signal: result.signal, output: stdout.trim().split(/\r?\n/).filter(Boolean),
    ...(result.status !== 0 ? { failure: stderr.trim() || result.error?.code || 'Child reported failure' } : {}) };
}

function removeOwned() {
  const owned = docker(['ps', '-a', '--filter', `label=io.ulpin.nonce=${nonce}`, '--format', '{{.Names}}']);
  if (!owned) return null;
  if (owned !== container) throw new Error('Unexpected nonce owner; no removal attempted.');
  const task = docker(['inspect', '--format', '{{ index .Config.Labels "io.ulpin.task" }}', container]);
  if (task !== 'AU3') throw new Error('Ownership mismatch; no removal attempted.');
  docker(['rm', '--force', container]);
  return container;
}

const receipt = { task: 'AU3', nonce, container, startedAt: new Date().toISOString() };
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
  receipt.removed = removeOwned();
  receipt.remainingOwned = docker(['ps', '-a', '--filter', `label=io.ulpin.nonce=${nonce}`,
    '--format', '{{.Names}}']);
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ container, removed: receipt.removed, remainingOwned: receipt.remainingOwned,
  failure: receipt.failure ?? null }));
if (receipt.failure || receipt.remainingOwned) process.exitCode = 1;
