// Two made-up rehearsal runtimes on a temporary folder, each with two real idle child processes of this
// test. No runtime's own folder is opened, Docker is a stand-in, and no start or stop command is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFile, runtimeDefinition } from './demo-config.mjs';
import { composeArguments, parseArguments, stopRuntime } from './demo.mjs';
import { ownedProcess, processInfo, stopProcesses } from './processes.mjs';
import { root } from './runtime.mjs';

const labels = ['api', 'dispatcher'];
const children = [];
test.after(() => children.forEach(child => child.kill()));

/** One runtime folder with its marker and two recorded idle processes, written as the launcher writes them. */
async function madeUpRuntime(folder, name) {
  const runtime = runtimeDefinition(name, folder);
  mkdirSync(runtime.dir, { recursive: true });
  const entry = join(runtime.dir, 'idle.cjs');
  writeFileSync(entry, 'setInterval(() => {}, 1000);\n');
  for (const label of labels) {
    const preload = `made-up-preload-${name}-${label}`;
    const child = spawn(process.execPath, [entry, preload], { stdio: 'ignore', windowsHide: true });
    children.push(child);
    let info;
    for (let attempt = 0; attempt < 30 && !info?.CommandLine?.includes(entry); attempt++) {
      info = processInfo(child.pid);
    }
    const record = { project: runtime.project, label, pid: child.pid, creationDate: info.CreationDate,
      executable: process.execPath, entry, preload };
    writeFileSync(join(runtime.dir, `${label}.process.json`), JSON.stringify(record) + '\n');
  }
  const marker = { project: runtime.project, schemaOnly: true, completedAt: '2026-01-01T00:00:00.000Z' };
  writeFileSync(runtime.marker, JSON.stringify(marker) + '\n');
  return runtime;
}
const bytes = runtime => Object.fromEntries(readdirSync(runtime.dir).sort()
  .map(name => [name, readFileSync(join(runtime.dir, name), 'hex')]));
const container = (project, service) => ({ id: `${project}-${service}-id`, project, service });

test('stop of one runtime leaves another runtime\'s processes, records and marker as they were', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'runtime-stop-'));
  const first = await madeUpRuntime(folder, 'ulpin-reh-01');
  const second = await madeUpRuntime(folder, 'ulpin-reh-02');
  const before = [bytes(first), bytes(second)];
  const secondPids = labels.map(label => ownedProcess(label, second).pid);
  // The stand-in answers with every project's containers, to show that only the named project's are stopped.
  const everything = ['ulpin-demo', 'ulpin-reh-01', 'ulpin-reh-02']
    .flatMap(project => ['postgres', 'geo', 'minio-init'].map(service => container(project, service)));
  const asked = [], stopped = [];
  const docker = {
    connect: () => ({ context: 'made-up-context' }),
    containers: (_runtime, project) => { asked.push(project); return everything; },
    stop: (_runtime, ids) => stopped.push(...ids),
  };
  const printed = t.mock.method(console, 'log', () => {});
  await stopRuntime(first, docker);
  assert.deepEqual(asked, ['ulpin-reh-01']);
  assert.deepEqual(stopped, ['ulpin-reh-01-postgres-id', 'ulpin-reh-01-geo-id']);
  assert.deepEqual(printed.mock.calls.map(call => call.arguments[0]),
    ['ulpin-reh-01 API/dispatcher and containers stopped; all data volumes preserved.']);
  assert.deepEqual(labels.map(label => ownedProcess(label, first)), [null, null]);
  assert.deepEqual(labels.map(label => ownedProcess(label, second).pid), secondPids);
  assert.deepEqual([bytes(first), bytes(second)], before);
});

test('a record of another runtime found in a runtime\'s folder is refused, and nothing is stopped', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'runtime-stop-'));
  const first = await madeUpRuntime(folder, 'ulpin-reh-01');
  const second = runtimeDefinition('ulpin-reh-02', folder);
  mkdirSync(second.dir, { recursive: true });
  for (const label of labels) {
    writeFileSync(join(second.dir, `${label}.process.json`), readFileSync(join(first.dir, `${label}.process.json`)));
  }
  await assert.rejects(stopProcesses(second), /Unexpected process ownership record/);
  assert.equal(labels.every(label => ownedProcess(label, first)), true);
  await stopProcesses(first);
  assert.deepEqual(labels.map(label => ownedProcess(label, first)), [null, null]);
});

test('the command line names one runtime, defaults to ulpin-demo and refuses anything else before acting', () => {
  assert.deepEqual(parseArguments(['stop']), { action: 'stop', create: false, runtime: runtimeDefinition() });
  assert.equal(parseArguments(['start']).runtime.name, 'ulpin-demo');
  assert.equal(parseArguments(['start', '--create']).create, true);
  assert.equal(parseArguments(['stop', '--runtime', 'ulpin-reh-01']).runtime.project, 'ulpin-reh-01');
  const create = parseArguments(['start', '--runtime', 'ulpin-reh-02', '--create']);
  assert.deepEqual([create.action, create.create, create.runtime.name], ['start', true, 'ulpin-reh-02']);
  const usage = /^Error: Usage: demo\.mjs start \[--create\] \[--runtime <name>\] \| stop \[--runtime <name>\]$/;
  for (const refused of [[], ['restart'], ['stop', '--create'], ['stop', '--runtime'], ['start', '--force'],
    ['stop', 'ulpin-reh-01'], ['stop', '--runtime', 'ulpin-reh-01', '--runtime', 'ulpin-demo']]) {
    assert.throws(() => parseArguments(refused), usage);
  }
  for (const name of ['ulpin-prod', 'ulpin', 'ulpin-reh-1', '--create']) {
    assert.throws(() => parseArguments(['stop', '--runtime', name]), /Unknown runtime name/);
  }
});

test('a compose step carries its own runtime\'s settings file and project; the demo\'s are today\'s', () => {
  const files = ['-f', join(root, 'compose.yaml'), '-f', join(root, 'scripts/platform/demo.compose.json')];
  assert.deepEqual(composeArguments('made-up-context', ['ps']), ['--context', 'made-up-context', 'compose',
    '--project-directory', root, '--env-file', demoFile, '-p', 'ulpin-demo', ...files, 'ps']);
  const rehearsal = runtimeDefinition('ulpin-reh-01');
  const args = composeArguments('made-up-context', ['ps'], 'ulpin-reh-01');
  assert.deepEqual([args[args.indexOf('--env-file') + 1], args[args.indexOf('-p') + 1]],
    [rehearsal.file, 'ulpin-reh-01']);
  assert.equal(args.some(arg => arg.includes('ulpin-demo')), false);
  assert.throws(() => composeArguments('made-up-context', ['ps'], 'ulpin-prod'), /Unknown runtime name/);
});

test('doctor takes the runtime name: a refused name reads nothing, a rehearsal name reads only its own', () => {
  const doctor = fileURLToPath(new URL('./doctor', import.meta.url));
  const run = args => spawnSync(process.execPath, [doctor, ...args], { encoding: 'utf8', windowsHide: true });
  const refused = run(['--profile', 'demo', '--runtime', 'ulpin-prod']);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /^FAIL Runtime name\n {2}Fix: Unknown runtime name/);
  assert.equal(refused.stdout.split('\n').filter(line => /^(PASS|FAIL|INFO|SKIP)/.test(line)).length, 1);
  assert.match(run(['--runtime', 'ulpin-reh-01']).stdout, /Fix: --runtime needs --profile demo\./);
  // No such runtime exists, and the guard hides the runtimes folder: the doctor stops at its configuration.
  const rehearsal = run(['--profile', 'demo', '--runtime', 'ulpin-reh-01']);
  assert.equal(rehearsal.status, 1);
  assert.match(rehearsal.stdout, /^INFO Runtime ulpin-reh-01: only its own folder, project and ports are read\./);
  assert.match(rehearsal.stdout, /FAIL Demo external configuration/);
  assert.doesNotMatch(rehearsal.stdout, /Docker|ulpin-demo/);
});

test('the three shell entry points hand every argument after the profile to the Node entry', () => {
  const entries = { start: 'demo.mjs" start', stop: 'demo.mjs" stop', health: 'doctor" --profile demo' };
  for (const [script, entry] of Object.entries(entries)) {
    const text = readFileSync(new URL(`../platform-${script}.sh`, import.meta.url), 'utf8');
    assert.ok(text.includes(`${entry} "$@"`), script);
    assert.match(text, /--runtime <name>/);
  }
});
