// CAR safeguards: one nonce-owned tmpfs database, loopback only, no external configuration.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target || existsSync(target)) throw new Error('Supply a new immutable runtime receipt path.');
const phase = process.argv[3] ?? 'step0';
if (process.argv.length > 4 || !['step0', 'walk'].includes(phase)) {
  throw new Error('Only an immutable receipt path and a phase (step0 or walk) are accepted.');
}
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-ad1-tmp-${nonce}`;
const database = `ad1_${nonce}`;
const password = randomBytes(24).toString('hex');
const names = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));

function safe(text = '') {
  if (text.includes(password)) throw new Error('Generated secret in output; output not recorded.');
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
  if (!pin) throw new Error('Compose PostGIS image must be pinned.');
  const image = `${pin[1]}@${pin[2]}`;
  docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=AD1',
    '--label', `io.ulpin.nonce=${nonce}`, '--network', 'bridge', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=ad1_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image], { POSTGRES_PASSWORD: password });
  return image;
}

function ready() {
  for (let second = 0; second < 60; second++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'ad1_control', '-d', database], { windowsHide: true, timeout: 10000, env: system });
    if (result.status === 0) return second;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Owned database not ready in 60 seconds.');
}

function child(port) {
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/ad1/steps.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 1500000, maxBuffer: 32 * 1024 * 1024,
    env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false',
      DATABASE_URL: `postgresql://ad1_control@127.0.0.1:${port}/${database}`, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_AD1_CONTAINER: container, ULPIN_AD1_NONCE: nonce,
      ULPIN_MODEL_GATEWAY_ENABLED: '0', ULPIN_LOCAL_OPERATOR_SUBJECT: 'ad1-runtime-control',
      PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1', ULPIN_AD1_PHASE: phase } });
  const stdout = safe(result.stdout ?? '');
  const stderr = safe(result.stderr ?? '');
  const progress = stdout.split(/\r?\n/).filter(Boolean).map(value => JSON.parse(value));
  return { exit: result.status, signal: result.signal, errorCode: result.error?.code ?? null,
    progress: progress.filter(value => value.completed), evidence: progress.at(-1) ?? null,
    ...(result.status !== 0 ? { failure: stderr.trim() || result.error?.code || 'Child reported failure' } : {}) };
}

function removeOwned() {
  if (!docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container)) return null;
  const label = key => docker(['inspect', '--format', `{{ index .Config.Labels "${key}" }}`, container]);
  if (label('io.ulpin.nonce') !== nonce || label('io.ulpin.task') !== 'AD1') {
    throw new Error('Ownership mismatch; no removal attempted.');
  }
  docker(['rm', '--force', container]);
  return container;
}

function main() {
  const receipt = { task: 'AD1', container, startedAt: new Date().toISOString() };
  try {
    receipt.image = start();
    receipt.readyAfterSeconds = ready();
    const published = docker(['port', container, '5432/tcp']);
    const port = /^127\.0\.0\.1:(\d+)$/.exec(published);
    if (!port) throw new Error('Expected one loopback port.');
    receipt.published = published;
    receipt.runtime = child(port[1]);
    if (receipt.runtime.exit !== 0) receipt.failure = receipt.runtime.failure;
  } catch (error) {
    receipt.failure = safe(String(error.message));
  } finally {
    receipt.removed = removeOwned();
    receipt.ownedContainerGone = !docker(['ps', '-a', '--format', '{{.Names}}'])
      .split(/\r?\n/).includes(container);
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify({ container, removed: receipt.removed, ownedContainerGone: receipt.ownedContainerGone,
    failure: receipt.failure ?? null }));
  if (receipt.failure || !receipt.ownedContainerGone) process.exitCode = 1;
}

main();
