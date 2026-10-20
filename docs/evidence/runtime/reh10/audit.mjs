import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// REH9's audit.mjs for REH10 on ulpin-reh-02. Evidence goes to the worker's checkout; commands run from the serving
// checkout. Containers are read with their ids and images, for both projects, so a recreate is seen.
export const evidence = 'E:/Projects/ulpin-wt/k3/docs/evidence/runtime/reh10';
export const serving = 'E:/Projects/ulpin-wt/ulpin-reh-02';
export const demo = 'E:/Projects/ulpin-wt/demo';
export const runtime = 'ulpin-reh-02';
const runtimeRoot = 'E:/BhuAayam-data/runtime';
export const pinnedImage = 'ulpin-geo:git-a40b60238728';
export const ports = [21021, 21022, 21023, 21024, 21025, 21026];
// Recorded SHA-256 of the source originals; image ids are added once read.
const kept = new Set([
  'c231afe4940fed01f67af2c548bb970b6bf0ea30c1795aa71bed9fdf569387da',
  '31db0dd7ee5b1343120648b590709c3f71c48d264900dfefa3170d5d98864521',
  '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e',
  '3c9528513383a20d20a94d6f18747f5423668152a49100013aa03e47d33c1d4b',
  'c95ea0f53da7b9626253d1240641da8914573d51da286639b904b19268ec9716',
  '8c565f320533dcefc7ba8438682b32c0eb5e0a06b323600922b0b0b6092d6790',
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

/** Every container of a compose project, by name: short id, name, image and state, one unwrapped line each. */
export function containers(project) {
  const result = spawnSync('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`,
    '--format', '{{.ID}} {{.Names}} {{.Image}} {{.State}}'], { encoding: 'utf8', windowsHide: true });
  return result.stdout.trim().split(/\r?\n/).filter(Boolean)
    .sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1]));
}

export function inventory() {
  const directory = `${runtimeRoot}/${runtime}`;
  return {
    runtimeEntriesByName: existsSync(directory) ? readdirSync(directory).sort() : [],
    volumes: run(`docker volume ls --filter name=${runtime}_ --format "{{.Name}}"`, evidence).output,
    containers: containers(runtime),
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
    machine: machine(demo), containers: containers('ulpin-demo') };
}

/** Same exit, commit, process ids and start times, and the same demo containers (ids and images). */
export function sameDemo(before, after) {
  const ids = rows => JSON.stringify(rows.map(row => row.split(' ').slice(0, 3)));
  return after.doctor.exit === before.doctor.exit && after.commit === before.commit
    && JSON.stringify(after.machine.processes) === JSON.stringify(before.machine.processes)
    && ids(after.containers) === ids(before.containers);
}

/** An image's id and its two source labels, or null when the tag is not on the engine. */
export function image(name) {
  const result = spawnSync('docker', ['image', 'inspect', name, '--format',
    '{{.Id}}|{{.Created}}|{{index .Config.Labels "org.opencontainers.image.revision"}}'
    + '|{{index .Config.Labels "in.bhuaayam.ulpin.services-geo-tree"}}'],
  { encoding: 'utf8', windowsHide: true });
  const line = result.stdout.trim();
  if (result.status !== 0 || !line) return { name, present: false };
  const [id, created, revision, tree] = line.split('|');
  keep(id);
  return { name, present: true, id, created, labels: {
    'org.opencontainers.image.revision': revision || null,
    'in.bhuaayam.ulpin.services-geo-tree': tree || null } };
}

if (process.argv[1]?.endsWith('audit.mjs') && process.argv[2] === 'before') {
  const images = [image(pinnedImage)];
  const baseline = demoDoctor();
  const value = {
    at: new Date().toISOString(), stagingCommit: process.argv[3], baseline,
    runtimeFoldersByName: readdirSync(runtimeRoot).sort(), images,
    containers: { 'ulpin-demo': baseline.containers, [runtime]: containers(runtime) },
    serving: { head: spawnSync('git', ['-C', serving, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
      clean: spawnSync('git', ['-C', serving, 'status', '--short'], { encoding: 'utf8' }).stdout.trim() === '' },
    freeGB: baseline.machine.freeGB, gpu: gpu(), state: inventory(),
  };
  save('before.json', value);
  console.log(JSON.stringify(value, null, 2));
}
