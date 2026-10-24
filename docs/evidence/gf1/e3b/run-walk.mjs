import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const receiptPath = process.argv[2];
if (!receiptPath || existsSync(receiptPath)) throw new Error('Supply a new receipt path.');
const nonce = randomBytes(8).toString('hex');
const container = `ulpin-ca0-tmp-${nonce}`;
const database = `ca0_${nonce}`;
const password = randomBytes(24).toString('hex');
const folder = 'docs/evidence/gf1/e3b/';
const names = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'PATHEXT'];
const system = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));
const result = { task: 'E3b', container, startedAt: new Date().toISOString() };

function docker(args, extra = {}) {
  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, env: { ...system, ...extra } });
  if (run.status !== 0) throw new Error(`Docker ${args[0]} failed.`);
  if (run.stdout.includes(password)) throw new Error('Secret output refused.');
  return run.stdout.trim();
}

function prepareHelpers() {
  let http = readFileSync('docs/evidence/gf1/e1b/http.ts', 'utf8');
  http = http.replace('let endpoint: string;', 'let endpoint: string;\n'
    + 'export const httpEndpoint = () => endpoint;\n'
    + 'let confirmed: () => void = () => {};\n'
    + 'export const afterConfirmation = (callback: () => void) => { confirmed = callback; };');
  const guard = 'guardLocalRequest(request, response, next, port, [])';
  http = http.replace(guard, "guardLocalRequest(request, response, next, port, ['http://127.0.0.1:5297'])");
  const observer = 'app.use((request: Request, response: Response, next: NextFunction) => {\n';
  http = http.replace('app.useGlobalFilters', observer
    + "    if (request.method === 'POST' && /\\/confirmations$/.test(request.path)) {\n"
    + '      response.on(\'finish\', () => { if (response.statusCode === 202) confirmed(); });\n'
    + '    }\n    next();\n  });\n  app.useGlobalFilters');
  writeFileSync(`${folder}http.ts`, http);
  let steps = readFileSync('docs/evidence/gf1/e1b/steps.ts', 'utf8');
  steps = steps.replace("import { intakeHttp,", "import { httpEndpoint, afterConfirmation, intakeHttp,");
  steps = steps.replace('  await cards(controls);', '  await walk();');
  steps = steps.replace('async function main() {', readFileSync(`${folder}walk-body.txt`, 'utf8')
    + '\nasync function main() {');
  writeFileSync(`${folder}walk-generated.ts`, steps);
}

async function runChild(port) {
  const child = spawn(process.execPath, ['--require', './scripts/platform/isolated-env.cjs', '--import', 'tsx',
    `${folder}walk-generated.ts`], { env: { ...system, ULPIN_PROFILE: 'demo', REPO_DATA: 'false',
    DATABASE_URL: `postgresql://ca0_control@127.0.0.1:${port}/${database}`, PGPASSWORD: password,
    TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', ULPIN_CA0_CONTAINER: container, ULPIN_CA0_NONCE: nonce,
    ULPIN_MODEL_GATEWAY_ENABLED: '0', ULPIN_LOCAL_OPERATOR_SUBJECT: 'ca0-runtime-control',
    PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const timer = setTimeout(() => child.kill(), 25 * 60 * 1000);
  const exit = await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(timer);
  if (stdout.includes(password) || stderr.includes(password)) throw new Error('Secret output refused.');
  const frames = stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  return { exit, evidence: frames.at(-1), stderr: stderr.slice(-3000) };
}

try {
  const pin = /image: (postgis\/postgis):[^@\s]+@(sha256:[a-f0-9]{64})/.exec(readFileSync('compose.yaml', 'utf8'));
  if (!pin) throw new Error('Pinned image missing.');
  result.image = `${pin[1]}@${pin[2]}`;
  docker(['image', 'inspect', '--format', '{{.Id}}', result.image]);
  docker(['run', '--detach', '--pull', 'never', '--name', container, '--label', 'io.ulpin.task=CA0',
    '--label', `io.ulpin.nonce=${nonce}`, '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', 'POSTGRES_USER=ca0_control', '--env', `POSTGRES_DB=${database}`, '--env', 'POSTGRES_PASSWORD',
    result.image], { POSTGRES_PASSWORD: password });
  await new Promise(resolve => setTimeout(resolve, 3000));
  docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'ca0_control', '-d', database]);
  const port = /^127\.0\.0\.1:(\d+)$/.exec(docker(['port', container, '5432/tcp']));
  if (!port) throw new Error('One loopback port required.');
  prepareHelpers();
  result.runtime = await runChild(port[1]);
} catch (error) {
  result.failure = error.message;
} finally {
  const owned = docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container);
  if (owned) {
    for (const [label, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'CA0']]) {
      if (docker(['inspect', '--format', `{{ index .Config.Labels "${label}" }}`, container]) !== value) {
        throw new Error('Ownership mismatch; no removal attempted.');
      }
    }
    docker(['rm', '--force', container]);
  }
  result.ownedContainerGone = !docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(container);
  for (const file of ['http.ts', 'walk-generated.ts']) {
    if (existsSync(`${folder}${file}`)) unlinkSync(`${folder}${file}`);
  }
  result.finishedAt = new Date().toISOString();
  writeFileSync(receiptPath, `${JSON.stringify(result)}\n`, { flag: 'wx' });
}
if (result.failure || result.runtime?.exit !== 0 || !result.ownedContainerGone) process.exitCode = 1;
console.log(JSON.stringify({ exit: result.runtime?.exit, failure: result.failure, ownedContainerGone:
  result.ownedContainerGone }));
