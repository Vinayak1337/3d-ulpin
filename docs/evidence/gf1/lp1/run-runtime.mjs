import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [phase, target] = process.argv.slice(2);
if (!['before', 'after'].includes(phase) || !target || existsSync(target)) {
  throw new Error('Supply before|after and a new immutable receipt path.');
}
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-lp1-tmp-${nonce}`;
const database = `lp1_${nonce}`;
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
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=LP1',
    '--label', `io.ulpin.nonce=${nonce}`, '--network', 'bridge', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=lp1_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image], { POSTGRES_PASSWORD: password });
  return image;
}

function ready() {
  for (let second = 0; second < 60; second++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'lp1_control', '-d', database], { windowsHide: true, timeout: 10000, env: system });
    if (result.status === 0) return second;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Owned database not ready in 60 seconds.');
}

function child(port) {
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/lp1/steps.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 600000, maxBuffer: 16 * 1024 * 1024,
    env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false',
      DATABASE_URL: `postgresql://lp1_control@127.0.0.1:${port}/${database}`, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_LP1_CONTAINER: container, ULPIN_LP1_NONCE: nonce,
      ULPIN_LP1_PHASE: phase, ULPIN_MODEL_GATEWAY_ENABLED: '0', ULPIN_LOCAL_OPERATOR_SUBJECT: 'lp1-runtime-control',
      PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const stdout = safe(result.stdout ?? '');
  const progress = stdout.split(/\r?\n/).filter(Boolean).map(value => JSON.parse(value));
  return { exit: result.status, evidence: progress.at(-1) ?? null,
    progress: progress.filter(value => value.completed),
    ...(result.status !== 0 ? { failure: safe(result.stderr ?? '').trim() || result.error?.code } : {}) };
}

function removeOwned() {
  const present = docker(['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}']);
  if (!present) return;
  for (const [key, expected] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LP1']]) {
    const label = docker(['inspect', '--format', `{{ index .Config.Labels "${key}" }}`, container]);
    if (label !== expected) throw new Error('Ownership mismatch; no removal attempted.');
  }
  docker(['rm', '--force', container]);
}

function main() {
  const receipt = { task: 'LP1', phase, container, startedAt: new Date().toISOString() };
  try {
    receipt.image = start();
    receipt.readyAfterSeconds = ready();
    const published = /^127\.0\.0\.1:(\d+)$/.exec(docker(['port', container, '5432/tcp']));
    if (!published) throw new Error('Expected one loopback port.');
    receipt.runtime = child(published[1]);
    if (receipt.runtime.exit !== 0) receipt.failure = receipt.runtime.failure || 'Domain child failed.';
  } catch (error) {
    receipt.failure = safe(String(error.message));
  } finally {
    removeOwned();
    receipt.ownedContainerGone = docker(['ps', '-a', '--filter', `name=^/${container}$`,
      '--format', '{{.Names}}']) === '';
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(target, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify({ phase, ownedContainerGone: receipt.ownedContainerGone,
    failure: receipt.failure ?? null }));
  if (receipt.failure || !receipt.ownedContainerGone) process.exitCode = 1;
}

main();
