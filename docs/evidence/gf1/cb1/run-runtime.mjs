// Owns exactly one nonce-labelled throwaway; no external runtime configuration is read.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const target = process.argv[2];
if (!target || existsSync(target)) throw new Error('Supply a new receipt path; existing receipts are immutable.');
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-cb1-tmp-${nonce}`;
const database = `cb1_${nonce}`;
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

function machine() {
  const sorted = args => docker(args).split(/\r?\n/).filter(Boolean).sort();
  return { containers: sorted(['ps', '-a', '--format', '{{.Names}}']),
    volumes: sorted(['volume', 'ls', '--format', '{{.Name}}']),
    networks: sorted(['network', 'ls', '--format', '{{.Name}}']) };
}

function start() {
  const pin = /image: (postgis\/postgis):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(readFileSync('compose.yaml', 'utf8'));
  if (!pin) throw new Error('Compose PostGIS image must be pinned.');
  const image = `${pin[1]}@${pin[2]}`;
  docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=CB1',
    '--label', `io.ulpin.nonce=${nonce}`, '--network', 'bridge', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=cb1_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image], { POSTGRES_PASSWORD: password });
  return image;
}

function ready() {
  for (let second = 0; second < 60; second++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'cb1_control', '-d', database], { windowsHide: true, timeout: 10000, env: system });
    if (result.status === 0) return second;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Owned database not ready in 60 seconds.');
}

function child(port) {
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/cb1/steps.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false', ULPIN_MODEL_GATEWAY_ENABLED: '0',
      DATABASE_URL: `postgresql://cb1_control@127.0.0.1:${port}/${database}`, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_CB1_CONTAINER: container, ULPIN_CB1_NONCE: nonce,
      ULPIN_LOCAL_OPERATOR_SUBJECT: 'cb1-runtime-control', PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const stdout = safe(result.stdout ?? '');
  const stderr = safe(result.stderr ?? '');
  const line = stdout.trim().split(/\r?\n/).at(-1);
  const progress = stdout.split(/\r?\n/).filter(Boolean).map(value => JSON.parse(value));
  return { exit: result.status, signal: result.signal, errorCode: result.error?.code ?? null,
    progress: progress.filter(value => value.completed), evidence: line ? JSON.parse(line) : null,
    ...(result.status !== 0 ? { failure: stderr.trim() || result.error?.code || 'Child reported failure' } : {}) };
}

function removeOwned() {
  if (!docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container)) return null;
  const label = key => docker(['inspect', '--format', `{{ index .Config.Labels "${key}" }}`, container]);
  if (label('io.ulpin.nonce') !== nonce || label('io.ulpin.task') !== 'CB1') {
    throw new Error('Ownership mismatch; no removal attempted.');
  }
  docker(['rm', '--force', container]);
  return container;
}

function main() {
  const receipt = { task: 'CB1', container, startedAt: new Date().toISOString(), before: machine() };
  try {
    receipt.image = start();
    receipt.readyAfterSeconds = ready();
    receipt.during = machine();
    if (!isDeepStrictEqual(receipt.before.volumes, receipt.during.volumes)) {
      throw new Error('Unexpected volume appeared; stop before migrations.');
    }
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
    receipt.after = machine();
    receipt.machineUnchanged = isDeepStrictEqual(receipt.before, receipt.after);
    receipt.unrelatedContainerChanges = {
      added: receipt.after.containers.filter(name => !receipt.before.containers.includes(name)),
      removed: receipt.before.containers.filter(name => !receipt.after.containers.includes(name)),
    };
    receipt.ownedScopeUnchanged = !receipt.after.containers.includes(container)
      && isDeepStrictEqual(receipt.before.volumes, receipt.after.volumes)
      && isDeepStrictEqual(receipt.before.networks, receipt.after.networks);
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(target, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify({ container, removed: receipt.removed, machineUnchanged: receipt.machineUnchanged,
    ownedScopeUnchanged: receipt.ownedScopeUnchanged,
    unrelatedContainerChanges: receipt.unrelatedContainerChanges, failure: receipt.failure ?? null }));
  if (receipt.failure || !receipt.ownedScopeUnchanged) process.exitCode = 1;
}

main();
