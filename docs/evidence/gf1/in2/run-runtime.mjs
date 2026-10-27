// Creates and removes only one owned throwaway container; originals are read in place by the child.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const target = process.argv[2];
if (!target || existsSync(target)) throw new Error('Supply a new receipt path; existing receipts are immutable.');
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-in2-tmp-${nonce}`;
const database = `in2_${nonce}`;
const password = randomBytes(24).toString('hex');
const systemNames = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(systemNames.filter(name => process.env[name])
  .map(name => [name, process.env[name]]));

function safe(text = '') {
  if (text.includes(password)) throw new Error('Generated secret found in output; output is not recorded.');
  return text;
}

function docker(args, extra = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...system, ...extra } });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${safe(result.stderr).trim()}`);
  return safe(result.stdout).trim();
}

function machine() {
  const names = args => docker(args).split(/\r?\n/).filter(Boolean).sort();
  return { containers: names(['ps', '-a', '--format', '{{.Names}}']),
    volumes: names(['volume', 'ls', '--format', '{{.Name}}']),
    networks: names(['network', 'ls', '--format', '{{.Name}}']) };
}

function start() {
  const compose = readFileSync('compose.yaml', 'utf8');
  const pin = /image: (postgis\/postgis):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(compose);
  if (!pin) throw new Error('PostGIS image must be pinned.');
  const image = `${pin[1]}@${pin[2]}`;
  docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=IN2',
    '--label', `io.ulpin.nonce=${nonce}`, '--network', 'bridge', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=in2_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image], { POSTGRES_PASSWORD: password });
  return image;
}

function ready() {
  for (let second = 0; second < 60; second++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'in2_control', '-d', database], { windowsHide: true, timeout: 10000, env: system });
    if (result.status === 0) return second;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Owned database not ready in 60 seconds.');
}

function child(port) {
  const url = `postgresql://in2_control@127.0.0.1:${port}/${database}`;
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/in2/runtime-steps.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 240000, env: { ...system, ULPIN_PROFILE: 'demo', DATABASE_URL: url, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_IN2_CONTAINER: container, ULPIN_IN2_NONCE: nonce,
      ULPIN_LOCAL_OPERATOR_SUBJECT: 'in2-runtime-control' } });
  const stdout = safe(result.stdout ?? '');
  const stderr = safe(result.stderr ?? '');
  if (result.status !== 0) throw new Error(`Runtime child failed: ${stdout.trim()} ${stderr.trim()}`);
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
}

function main() {
  const receipt = { task: 'IN2', container, startedAt: new Date().toISOString(), before: machine() };
  try {
    receipt.image = start();
    receipt.readyAfterSeconds = ready();
    receipt.during = machine();
    if (!isDeepStrictEqual(receipt.before.volumes, receipt.during.volumes)) {
      throw new Error('Unexpected volume created; stop before migrations.');
    }
    const published = docker(['port', container, '5432/tcp']);
    const port = /^127\.0\.0\.1:(\d+)$/.exec(published);
    if (!port) throw new Error('Expected one free loopback port.');
    receipt.published = published;
    receipt.runtime = child(port[1]);
  } catch (error) {
    receipt.failure = safe(String(error.message));
  } finally {
    // Exact name plus nonce label prevents removal of any pre-existing container.
    if (docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container)) {
      const label = docker(['inspect', '--format', '{{ index .Config.Labels "io.ulpin.nonce" }}', container]);
      if (label !== nonce) throw new Error('Owned-container label mismatch; no removal attempted.');
      docker(['rm', '--force', '--volumes', container]);
      receipt.removed = container;
    }
    receipt.after = machine();
    receipt.machineUnchanged = isDeepStrictEqual(receipt.before, receipt.after);
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(target, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify({ container, removed: receipt.removed, machineUnchanged: receipt.machineUnchanged,
    failure: receipt.failure ?? null, runtime: receipt.runtime ?? null }));
  if (receipt.failure || !receipt.machineUnchanged) process.exitCode = 1;
}

main();
