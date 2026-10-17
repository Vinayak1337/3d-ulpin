// GK3: GK1's five statements and the ledger child run for the first time, on one throwaway PostgreSQL container
// that this runner creates and removes by its exact name. It touches no other container, volume or network, runs
// no compose command, and the password it generates lives only in this process and its children's environment.
//   node tests/model-gateway/run-throwaway.mjs <results.json>
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-gk3-sqltest-${nonce.slice(0, 8)}`;
const database = `model_control_${nonce}`;
const password = randomBytes(24).toString('hex');
const keyNames = ['A', 'B', 'C', 'D'].map(letter => `ULPIN_PROVIDER_KEY_GK3_${letter}`);
const keys = Object.fromEntries(keyNames.map(name => [name, `gk3-synthetic-${randomBytes(12).toString('hex')}`]));
const systemNames = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(systemNames.filter(name => process.env[name])
  .map(name => [name, process.env[name]]));
const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

/** Printed text is recorded only when it holds neither the password nor a synthetic key. */
function lines(text) {
  if ([password, ...Object.values(keys)].some(secret => (text ?? '').includes(secret))) {
    throw new Error('A step printed a generated secret; its output is not recorded.');
  }
  return (text ?? '').split(/\r?\n/).filter(Boolean);
}
function docker(args, extra = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...process.env, ...extra } });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${lines(result.stderr).at(-1) ?? 'no message'}`);
  return lines(result.stdout);
}
/** Every container, volume and network of this machine, by name only. */
const machine = () => ({ containers: docker(['ps', '-a', '--format', '{{.Names}}']).sort(),
  volumes: docker(['volume', 'ls', '--format', '{{.Name}}']).sort(),
  networks: docker(['network', 'ls', '--format', '{{.Name}}']).sort() });

/** The image the compose file pins for its database, by digest; it is already local and nothing is pulled. */
function pinnedImage() {
  const compose = readFileSync(join(root, 'compose.yaml'), 'utf8');
  const pin = /image: (postgis\/postgis):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(compose);
  if (!pin) throw new Error('compose.yaml no longer pins a postgis image by digest.');
  docker(['image', 'inspect', '--format', '{{.Id}}', `${pin[1]}@${pin[2]}`]);
  return `${pin[1]}@${pin[2]}`;
}
/** One container on the existing bridge network: tmpfs data, a free loopback port, the password by name only. */
function start(image) {
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=GK3',
    '--label', `io.ulpin.nonce=${nonce}`, '--network', 'bridge', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', 'POSTGRES_USER=model_control',
    '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD', image], { POSTGRES_PASSWORD: password });
}
/** Ready on TCP inside the container: the image's first, socket-only start does not count. */
function waitUntilReady() {
  const probe = ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'model_control', '-d', database];
  for (let second = 0; second < 90; second += 1) {
    if (spawnSync('docker', probe, { windowsHide: true, timeout: 20000 }).status === 0) return second;
    sleep(1000);
  }
  throw new Error('The throwaway database was not ready in 90 seconds.');
}
function publishedPort() {
  const published = docker(['port', container, '5432/tcp']);
  const port = /^127\.0\.0\.1:(\d+)$/.exec(published[0] ?? '');
  if (published.length !== 1 || !port) throw new Error('The container is not published on one loopback port.');
  return port[1];
}
/** Only the container this run created, by its exact name; with it only a volume Docker made for it alone. */
function remove(withItsOwnVolume) {
  if (!/^ulpin-gk3-sqltest-[a-f0-9]{8}$/.test(container)) throw new Error('Not the container name of this run.');
  if (!docker(['ps', '-a', '--format', '{{.Names}}']).includes(container)) return null;
  docker(['rm', '--force', ...(withItsOwnVolume ? ['--volumes'] : []), container]);
  return container;
}

/** A synthetic control policy: one key as before GK1, or a list. Its labels say it approves nothing. */
const policy = (names, price = '15000000') => JSON.stringify({ projectId: 'gk3-control',
  policyVersion: 'gk3-control-policy/1', fundingVersion: 'gk3-control-no-funding', gatewayExclusiveFunding: true,
  indiaPrivateApproved: true, ...(names.length === 1 ? { secretReference: names[0] } : { secretReferences: names }),
  model: 'sarvam-105b', projectCapMicroInr: '100000000', principalDailyCallCap: 20,
  projectDailyCapMicroInr: '25000000', paceMs: 1500,
  price: { version: 'gk3-control-price/1', inputPerMillionMicroInr: price,
    cachedInputPerMillionMicroInr: '5000000', outputPerMillionMicroInr: '60000000' },
  inputBound: { version: 'gk3-control-bound/1', maxPromptTokens: 34816 } });
const gateway = (names, price) => ({ ULPIN_MODEL_GATEWAY_ENABLED: '1',
  ULPIN_MODEL_GATEWAY_CONFIG: policy(names, price),
  ...Object.fromEntries(names.map(name => [name, keys[name]])) });

function node(args, env, timeout = 240000) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...system, PGPASSWORD: password, ...env },
    encoding: 'utf8', timeout, windowsHide: true });
  return { exit: result.status, stdout: lines(result.stdout), stderr: lines(result.stderr) };
}
/** A TypeScript child behind the demo's preload, started exactly as demo-gateway.mjs and demo.mjs start theirs. */
function child(url, entry, args, env = {}) {
  const preload = join(root, 'scripts/platform/isolated-env.cjs');
  return node(['--require', preload, '--import', 'tsx', join(root, entry), ...args],
    { ULPIN_PROFILE: 'demo', DATABASE_URL: url, ...env });
}
/** One step of throwaway-steps.ts: its JSON document, and the run stops when it failed. */
function step(url, mode, env) {
  const ran = child(url, 'tests/model-gateway/throwaway-steps.ts', [mode], env);
  const document = JSON.parse(ran.stdout.at(-1) ?? '{"failed":true,"message":"no output"}');
  if (ran.exit !== 0 || document.failed) {
    throw Object.assign(new Error(`${mode} failed and is not run again: ${document.message ?? ran.stderr.at(-1)}`),
      { document });
  }
  return document;
}
/** One owner step of the ledger child: the lines it printed, which hold names, states and times only. */
function ledger(url, env, ...args) {
  const ran = child(url, 'scripts/platform/demo-gateway-ledger.ts', args, env);
  return { command: args.join(' '), exit: ran.exit, printed: [...ran.stdout, ...ran.stderr] };
}

/** The gateway file of before GK1, then the file as it is now twice, then the server's own two runners once each. */
function schema(url, results) {
  const single = gateway(keyNames.slice(0, 1));
  results.base = step(url, 'base', single);
  results.firstRun = step(url, 'migrate', single);
  results.secondRun = step(url, 'migrate', single);
  results.secondRunChangedNothing = isDeepStrictEqual(results.firstRun.gateway, results.secondRun.gateway);
  results.serverMigrate = step(url, 'server-migrate', single);
  const script = child(url, 'scripts/platform/demo-schema.ts', []);
  results.demoSchemaStep = { exit: script.exit, printed: [...script.stdout, ...script.stderr] };
  if (script.exit !== 0) throw new Error('scripts/platform/demo-schema.ts failed and is not run again.');
  results.afterTheRunners = step(url, 'snapshot', single);
  results.runnersChangedNothing = isDeepStrictEqual(results.secondRun.gateway, results.afterTheRunners.gateway);
}
/** tests/model-gateway/sql.test.ts against the same database; the counts of its TAP report. */
function sqlTest(url) {
  const ran = node(['--import', 'tsx', '--test', '--test-reporter=tap', 'tests/model-gateway/sql.test.ts'],
    { TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_MODEL_SQL_URL: url, ULPIN_MODEL_SQL_NONCE: nonce,
      ULPIN_MODEL_SQL_CONTAINER: container });
  const count = name => Number(ran.stdout.find(line => line.startsWith(`# ${name} `))?.split(' ')[2] ?? -1);
  return { exit: ran.exit, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'),
    subtests: ran.stdout.filter(line => /^\s*(not )?ok \d+ - /.test(line)).map(line => line.trim()),
    failures: ran.exit === 0 ? [] : ran.stdout.filter(line => /error:|message:|code:/.test(line)).slice(0, 20) };
}
/** The owner's steps in the order of a roll-out: one key becomes a list, a key is marked and restored, a key joins. */
function ownerSteps(url) {
  const [first] = keyNames, three = gateway(keyNames.slice(0, 3)), four = gateway(keyNames);
  const run = [];
  const owner = (env, ...args) => run.push(ledger(url, env, ...args));
  const inside = (mode, env) => run.push({ command: `throwaway-steps.ts ${mode}`, result: step(url, mode, env) });
  owner(three, 'key-marks');
  inside('reserve', three);
  owner(three, 'reconcile', 'GK3 control: the one key of the pinned policy becomes a list of three');
  inside('mark', three);
  owner(three, 'key-marks');
  owner(three, 'restore-key', first, 'GK3 control: the mark was synthetic');
  owner(three, 'restore-key', first, 'GK3 control: the mark was synthetic');
  owner(three, 'key-marks');
  inside('reserve', four);
  owner(gateway(keyNames, '16000000'), 'reconcile', 'GK3 control: a changed price must be refused');
  owner(four, 'reconcile', 'GK3 control: a fourth key joins the list');
  owner(four, 'reconcile', 'GK3 control: a fourth key joins the list');
  sleep(2000);
  inside('reserve', four);
  owner(four, 'key-marks');
  inside('rows', four);
  return run;
}

function main(target) {
  if (!target) throw new Error('Usage: node tests/model-gateway/run-throwaway.mjs <results.json>');
  const results = { task: 'GK3', container, labels: { 'io.ulpin.task': 'GK3', 'io.ulpin.nonce': nonce },
    startedAt: new Date().toISOString(), before: machine() };
  try {
    results.image = pinnedImage();
    start(results.image);
    results.readyAfterSeconds = waitUntilReady();
    results.during = machine();
    results.dockerMadeAVolume = !isDeepStrictEqual(results.during.volumes, results.before.volumes);
    if (results.dockerMadeAVolume) {
      throw new Error('Docker made a volume for the container; the run stops before anything is applied.');
    }
    const port = publishedPort();
    const url = `postgresql://model_control@127.0.0.1:${port}/${database}`;
    results.published = `127.0.0.1:${port}`;
    schema(url, results);
    results.sqlTest = sqlTest(url);
    results.ownerSteps = ownerSteps(url);
  } catch (error) {
    results.failure = { message: lines(String(error.message)).join(' '), step: error.document ?? null };
  } finally {
    results.removed = remove(results.dockerMadeAVolume === true);
    results.after = machine();
    results.machineUnchanged = isDeepStrictEqual(results.before, results.after);
    results.finishedAt = new Date().toISOString();
    mkdirSync(dirname(resolve(target)), { recursive: true });
    writeFileSync(resolve(target), `${JSON.stringify(results, null, 2)}\n`);
  }
  console.log(JSON.stringify({ container, removed: results.removed ?? null, machineUnchanged: results.machineUnchanged,
    failure: results.failure?.message ?? null, sqlTest: results.sqlTest ?? null }));
  if (results.failure || !results.machineUnchanged) process.exitCode = 1;
}
main(process.argv[2]);
