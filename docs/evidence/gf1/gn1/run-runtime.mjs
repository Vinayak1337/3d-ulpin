// CR1/KN2 safeguards: build this worktree, own nonce-labelled throwaway services, loopback only.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (process.argv.length !== 3 || !target || existsSync(target)) throw new Error('Supply one new receipt path.');
const nonce = randomBytes(8).toString('hex');
const db = `ulpin-gn1-db-${nonce}`;
const geo = `ulpin-gn1-geo-${nonce}`;
const database = `gn1_${nonce}`;
const image = `ulpin-gn1-geo:${nonce}`;
const password = randomBytes(24).toString('hex');
const geoToken = randomBytes(24).toString('hex');
const names = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));
function safe(text = '') {
  if ([password, geoToken].some(secret => text.includes(secret))) throw new Error('Secret in output; not recorded.');
  return text;
}
function docker(args, extra = {}, timeout = 120000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout,
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
  docker(['build', '--file', 'services/geo/Dockerfile', '--tag', image, 'services/geo'], {}, 900000);
  const pin = /image: (postgis\/postgis):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(readFileSync('compose.yaml', 'utf8'));
  if (!pin) throw new Error('PostGIS must be pinned.');
  const postgres = `${pin[1]}@${pin[2]}`;
  docker(['run', '--detach', '--pull', 'never', '--name', db, '--label', 'io.ulpin.task=GN1',
    '--label', `io.ulpin.nonce=${nonce}`, '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=gn1_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', postgres], { POSTGRES_PASSWORD: password });
  docker(['run', '--detach', '--pull', 'never', '--name', geo, '--label', 'io.ulpin.task=GN1',
    '--label', `io.ulpin.nonce=${nonce}`, '--publish', '127.0.0.1::8000', '--env', 'GEO_SERVICE_TOKEN',
    '--env', 'PROJ_NETWORK=OFF', '--read-only', '--tmpfs', '/tmp', image], { GEO_SERVICE_TOKEN: geoToken });
  return postgres;
}
async function ready(geoPort) {
  for (let second = 0; second < 60; second++) {
    const databaseReady = spawnSync('docker', ['exec', db, 'pg_isready', '-h', '127.0.0.1',
      '-U', 'gn1_control', '-d', database], { windowsHide: true, timeout: 10000, env: system }).status === 0;
    const serviceReady = await fetch(`http://127.0.0.1:${geoPort}/health`)
      .then(response => response.ok).catch(() => false);
    if (databaseReady && serviceReady) return second;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Owned services not ready in 60 seconds.');
}
function child(dbPort, geoPort) {
  const result = spawnSync(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--import', 'tsx', 'docs/evidence/gf1/gn1/steps.ts'], { encoding: 'utf8', windowsHide: true,
    timeout: 360000, maxBuffer: 8 * 1024 * 1024,
    env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false', ULPIN_MODEL_GATEWAY_ENABLED: '0',
      DATABASE_URL: `postgresql://gn1_control@127.0.0.1:${dbPort}/${database}`, PGPASSWORD: password,
      TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_GN1_DB: db, ULPIN_GN1_GEO: geo,
      ULPIN_GN1_NONCE: nonce, ULPIN_LOCAL_OPERATOR_SUBJECT: 'gn1-runtime-control',
      GEO_URL: `http://127.0.0.1:${geoPort}`, GEO_SERVICE_TOKEN: geoToken,
      PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  const progress = safe(result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return { exit: result.status, signal: result.signal, progress: progress.filter(row => row.completed),
    evidence: progress.at(-1) ?? null,
    ...(result.status !== 0
      ? { failure: safe(result.stderr ?? '').trim() || result.error?.code || 'Child reported failure' } : {}) };
}
function removeOwned(container) {
  if (!docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container)) return;
  for (const [key, expected] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'GN1']]) {
    const actual = docker(['inspect', '--format', `{{ index .Config.Labels "${key}" }}`, container]);
    if (actual !== expected) throw new Error('Ownership mismatch; no removal attempted.');
  }
  docker(['rm', '--force', container]);
}
async function main() {
  const receipt = { task: 'GN1', nonce, containers: [db, geo], startedAt: new Date().toISOString() };
  try {
    receipt.postgresImage = start();
    receipt.geoImage = image;
    receipt.geoImageId = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    receipt.geoSources = ['area.py', 'gis_inspection.py'].map(file => {
      const path = `services/geo/geo/${file}`;
      const expected = createHash('sha256').update(readFileSync(path)).digest('hex');
      const code = `from pathlib import Path; import hashlib; `
        + `print(hashlib.sha256(Path('/app/geo/${file}').read_bytes()).hexdigest())`;
      const actual = docker(['exec', geo, 'python', '-B', '-c', code]);
      if (actual !== expected) throw new Error('Built geo source differs from worktree.');
      return { path, sha256: actual, builtSourceMatches: true };
    });
    const dbPort = port(db, '5432/tcp');
    const geoPort = port(geo, '8000/tcp');
    receipt.readyAfterSeconds = await ready(geoPort);
    receipt.runtime = child(dbPort, geoPort);
    if (receipt.runtime.exit !== 0) receipt.failure = receipt.runtime.failure;
  } catch (error) {
    receipt.failure = safe(String(error.message));
  } finally {
    for (const container of [geo, db]) removeOwned(container);
    receipt.ownedNonceGone = docker(['ps', '-a', '--filter', `label=io.ulpin.nonce=${nonce}`,
      '--format', '{{.Names}}']) === '';
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify({ nonce, ownedNonceGone: receipt.ownedNonceGone, failure: receipt.failure ?? null }));
  if (receipt.failure || !receipt.ownedNonceGone) process.exitCode = 1;
}
await main();
