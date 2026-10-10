import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const evidence = 'E:/Projects/ulpin-wt/r5/docs/evidence/runtime/reh1';
export const serving = 'E:/Projects/ulpin-wt/ulpin-reh-01';
export const demo = 'E:/Projects/ulpin-wt/demo';
const runtimeRoot = 'E:/BhuAayam-data/runtime';
const image = 'ulpin-geo:demo-k3b';
const sourceHash = '2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865';

export function safe(text) {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted connection]')
    .replace(/\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|DATABASE_URL)[A-Z0-9_]*\s*=\s*[^\s]+/g,
      '[redacted credential assignment]')
    .replace(/[a-f0-9]{64,}/gi, value => value === sourceHash ? value : '[omitted non-source digest]');
}

export function save(name, value) {
  const lines = [];
  let current = '';
  for (const line of JSON.stringify(value, null, 2).split('\n')) {
    const token = line.trim();
    if (current.length + token.length + 1 > 120) {
      lines.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + token;
  }
  lines.push(current);
  if (lines.some(line => line.length > 120)) throw new Error('Evidence line exceeds 120 characters');
  writeFileSync(resolve(evidence, name), lines.join('\n') + '\n', { flag: 'wx' });
}

export function run(command, cwd = serving, timeout = 180000) {
  const started = performance.now();
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
    cwd, encoding: 'utf8', timeout, windowsHide: true, windowsVerbatimArguments: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = safe(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  return {
    command: command.match(/.{1,90}/g), from: cwd, exit: result.status,
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    output: output.trim().split(/\r?\n/).flatMap(line => line.match(/.{1,90}/g) ?? ['']),
    error: result.error ? safe(result.error.message).match(/.{1,90}/g) : null,
  };
}

export function machine(checkout = demo) {
  const command = `powershell.exe -NoProfile -File "${evidence}/machine.ps1" -Checkout "${checkout}"`;
  const result = run(command, 'E:/Projects/ulpin-wt/r5');
  if (result.exit !== 0) throw new Error('OS process/listener inventory failed');
  return JSON.parse(result.output.join(''));
}

export function inventory() {
  const directory = `${runtimeRoot}/ulpin-reh-01`;
  return {
    runtimeEntries: existsSync(directory) ? readdirSync(directory).sort() : [],
    volumes: run('docker volume ls --filter name=ulpin-reh-01_ --format "{{.Name}}"', evidence),
    containers: run('docker ps -a --filter label=com.docker.compose.project=ulpin-reh-01 '
      + '--format "{{.Names}} {{.State}} {{.Status}}"', evidence),
    networks: run('docker network ls --filter name=ulpin-reh-01 --format "{{.Name}}"', evidence),
    listeners: machine(serving).listeners,
  };
}

export function demoDoctor() {
  return { doctor: run('pnpm platform:doctor --profile demo', demo),
    commit: run('git rev-parse HEAD', demo).output[0], machine: machine(demo) };
}

export function sameDemo(before, after) {
  return after.doctor.exit === 0 && after.commit === before.commit
    && JSON.stringify(after.machine.processes) === JSON.stringify(before.machine.processes);
}

const action = process.argv[2];
if (action === 'before') {
  const baseline = demoDoctor();
  const folders = readdirSync(runtimeRoot).sort();
  const inspected = run(`docker image inspect ${image} --format "{{.Id}}"`, evidence);
  const rawImage = spawnSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'],
    { encoding: 'utf8', windowsHide: true });
  const state = inventory();
  const gpu = run('nvidia-smi --query-compute-apps=pid,used_memory --format=csv', evidence);
  save('before.json', { at: new Date().toISOString(), baseline, foldersByName: folders, image: {
    command: inspected.command, exit: inspected.exit, id: rawImage.stdout.trim(),
  }, ports: [21011, 21012, 21013, 21014, 21015, 21016], freeGB: baseline.machine.freeGB, gpu, state });
  console.log(JSON.stringify({ baseline, foldersByName: folders, image: inspected, gpu, state }, null, 2));
}
