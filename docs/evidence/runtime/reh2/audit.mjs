import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// REH1's audit.mjs for ulpin-reh-02. Evidence goes to the worker's checkout; commands run from the serving
// checkout. The machine read parses PowerShell's compressed JSON whole, not line chunks (REH1 finding 2).
export const evidence = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/reh2';
export const serving = 'E:/Projects/ulpin-wt/ulpin-reh-02';
export const demo = 'E:/Projects/ulpin-wt/demo';
export const runtime = 'ulpin-reh-02';
const runtimeRoot = 'E:/BhuAayam-data/runtime';
export const image = 'ulpin-geo:demo-k3b';
export const ports = [21021, 21022, 21023, 21024, 21025, 21026];
// Recorded SHA-256 of the two source originals; the image id is added once read.
const kept = new Set([
  'c231afe4940fed01f67af2c548bb970b6bf0ea30c1795aa71bed9fdf569387da',
  '31db0dd7ee5b1343120648b590709c3f71c48d264900dfefa3170d5d98864521',
]);

export function keep(digest) {
  kept.add(digest.replace(/^sha256:/, '').toLowerCase());
}

export function safe(text) {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted connection]')
    .replace(/\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|DATABASE_URL)[A-Z0-9_]*\s*=\s*[^\s]+/g,
      '[redacted credential assignment]')
    .replace(/[a-f0-9]{64,}/gi, value => kept.has(value.toLowerCase()) ? value : '[omitted non-source digest]');
}

/** A string too long for one evidence line becomes an array of its 90-character pieces, in order. */
function fit(value) {
  if (typeof value === 'string') return value.length > 100 ? value.match(/.{1,90}/gs) : value;
  if (Array.isArray(value)) return value.map(fit);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fit(entry)]));
  }
  return value;
}

/** JSON packed to lines of 120 characters at most; never overwrites a receipt. */
export function save(name, value) {
  const lines = [];
  let current = '';
  for (const line of JSON.stringify(fit(value), null, 2).split('\n')) {
    const token = line.trim();
    if (current && current.length + token.length + 1 > 120) {
      lines.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + token;
  }
  lines.push(current);
  if (lines.some(line => line.length > 120)) throw new Error(`Evidence line over 120 characters in ${name}`);
  writeFileSync(resolve(evidence, name), lines.join('\n') + '\n', { flag: 'wx' });
}

const wrap = text => text.trim().split(/\r?\n/).flatMap(line => line.match(/.{1,90}/g) ?? ['']);

export function run(command, cwd = serving, timeout = 180000) {
  const started = performance.now();
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
    cwd, encoding: 'utf8', timeout, windowsHide: true, windowsVerbatimArguments: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = safe(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  return {
    command: command.match(/.{1,90}/g), from: cwd, exit: result.status,
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    output: wrap(output), error: result.error ? wrap(safe(result.error.message)) : null,
  };
}

/** The last n lines of a receipt's output, for the summary. */
export const tail = (receipt, n = 15) => ({ ...receipt, output: receipt.output.slice(-n) });

export function machine(checkout = demo) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', `${evidence}/machine.ps1`,
    '-Checkout', checkout], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (result.status !== 0) throw new Error(`OS process/listener inventory failed: ${safe(result.stderr)}`);
  const value = JSON.parse(result.stdout.trim());
  value.processes = [value.processes ?? []].flat();
  value.listeners = [value.listeners ?? []].flat();
  return value;
}

export function inventory() {
  const directory = `${runtimeRoot}/${runtime}`;
  return {
    runtimeEntriesByName: existsSync(directory) ? readdirSync(directory).sort() : [],
    volumes: run(`docker volume ls --filter name=${runtime}_ --format "{{.Name}}"`, evidence).output,
    containers: run(`docker ps -a --filter label=com.docker.compose.project=${runtime} `
      + '--format "{{.Names}} {{.State}} {{.Status}}"', evidence).output,
    networks: run(`docker network ls --filter name=${runtime} --format "{{.Name}}"`, evidence).output,
    listeners: machine(serving).listeners,
  };
}

export function gpu() {
  return run('nvidia-smi --query-compute-apps=pid,used_memory --format=csv', evidence);
}

export function demoDoctor() {
  const doctor = run('pnpm platform:doctor --profile demo', demo);
  const commit = spawnSync('git', ['-C', demo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const status = spawnSync('git', ['-C', demo, 'status', '--short'], { encoding: 'utf8' }).stdout.trim();
  const health = spawnSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}',
    'http://127.0.0.1:3194/api/v1/health'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  return { at: new Date().toISOString(), doctor, commit, checkoutClean: status === '', health,
    machine: machine(demo) };
}

export function sameDemo(before, after) {
  return after.doctor.exit === before.doctor.exit && after.commit === before.commit
    && JSON.stringify(after.machine.processes) === JSON.stringify(before.machine.processes);
}

export function imageId() {
  const id = spawnSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'],
    { encoding: 'utf8', windowsHide: true }).stdout.trim();
  if (id) keep(id);
  return id;
}

if (process.argv[1]?.endsWith('audit.mjs') && process.argv[2] === 'before') {
  const id = imageId();
  const baseline = demoDoctor();
  const folders = readdirSync(runtimeRoot).sort();
  const listeners = machine(evidence.replace(/\/docs.*/, '')).listeners;
  const value = {
    at: new Date().toISOString(), stagingCommit: process.argv[3], baseline,
    runtimeFoldersByName: folders, rehearsalFolderAbsent: !folders.includes(runtime),
    image: { name: image, id, present: Boolean(id) },
    ports, portsListening: listeners, portsFree: listeners.length === 0, freeGB: baseline.machine.freeGB,
    gpu: gpu(), state: inventory(),
  };
  save('before.json', value);
  console.log(JSON.stringify(value, null, 2));
}
