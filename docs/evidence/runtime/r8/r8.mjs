import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// R8: the demo's roll-out from 99e0026e to 9d6acc6b, one receipt per step, written once. Commands run from the demo
// checkout; reads go through GET routes, docker ps/inspect and the OS process list. REH3's audit.mjs, for ulpin-demo.
const evidence = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/r8';
const demo = 'E:/Projects/ulpin-wt/demo';
const api = 'http://127.0.0.1:3194';
const oldImage = 'ulpin-geo:demo-k3b';
const pinnedImage = 'ulpin-geo:git-22003ea3d878';
const machineScript = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/reh3/machine.ps1';
const kept = new Set();
const keep = digest => kept.add(digest.replace(/^sha256:/, '').toLowerCase());

function safe(text) {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted connection]')
    .replace(/\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|DATABASE_URL)[A-Z0-9_]*\s*=\s*[^\s]+/g,
      '[redacted credential assignment]')
    .replace(/[a-f0-9]{64,}/gi, value => kept.has(value.toLowerCase()) ? value : '[omitted non-source digest]');
}

function fit(value) {
  if (typeof value === 'string') return value.length > 100 ? value.match(/.{1,90}/gs) : value;
  if (Array.isArray(value)) return value.map(fit);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fit(entry)]));
  }
  return value;
}

/** JSON packed to lines of 120 characters at most; never overwrites a receipt. */
function save(name, value) {
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

function run(command, cwd = demo, timeout = 600000) {
  const started = Date.now();
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
    cwd, encoding: 'utf8', timeout, windowsHide: true, windowsVerbatimArguments: true, maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: command.match(/.{1,90}/g), from: cwd, exit: result.status,
    startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(),
    seconds: Number(((Date.now() - started) / 1000).toFixed(3)),
    output: wrap(safe(`${result.stdout ?? ''}${result.stderr ?? ''}`)),
    error: result.error ? wrap(safe(result.error.message)) : null,
  };
}

const text = (file, args) => spawnSync(file, args, { encoding: 'utf8', windowsHide: true }).stdout.trim();

function machine() {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', machineScript, '-Checkout', demo],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (result.status !== 0) throw new Error(`OS process inventory failed: ${safe(result.stderr)}`);
  const value = JSON.parse(result.stdout.trim());
  return { processes: [value.processes ?? []].flat(), freeGB: value.freeGB };
}

function containers() {
  return text('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project=ulpin-demo',
    '--format', '{{.ID}} {{.Names}} {{.Image}} {{.State}}']).split(/\r?\n/).filter(Boolean)
    .sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1]));
}

const volumes = () => text('docker', ['volume', 'ls', '--filter', 'label=com.docker.compose.project=ulpin-demo',
  '--format', '{{.Name}}']).split(/\r?\n/).filter(Boolean).sort();

function image(name) {
  const line = text('docker', ['image', 'inspect', name, '--format',
    '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}'
    + '|{{index .Config.Labels "in.bhuaayam.ulpin.services-geo-tree"}}']);
  if (!line) return { name, present: false };
  const [id, revision, tree] = line.split('|');
  keep(id);
  return { name, present: true, id, labels: {
    'org.opencontainers.image.revision': revision || null,
    'in.bhuaayam.ulpin.services-geo-tree': tree || null } };
}

async function get(route) {
  try {
    const response = await fetch(`${api}${route}`, { signal: AbortSignal.timeout(30000) });
    return { route, status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { route, status: null, error: error.cause?.code ?? error.name, body: null };
  }
}

/** Record counts read through the routes the Studio calls; GET only. */
async function counts() {
  const health = await get('/api/v1/health');
  const cases = await get('/api/v1/cases');
  const areas = await get('/api/v1/areas');
  const caseIds = Array.isArray(cases.body) ? cases.body.map(entry => entry.id) : [];
  let sources = 0;
  let packages = 0;
  const perCase = [];
  for (const caseId of caseIds) {
    const workspace = await get(`/api/v1/source-workspaces?caseId=${caseId}`);
    const targets = await get(`/api/v1/ingestion/cases/${caseId}/targets`);
    const caseSources = Array.isArray(workspace.body?.sources) ? workspace.body.sources.length : null;
    const casePackages = Array.isArray(targets.body?.packages) ? targets.body.packages.length : null;
    sources += caseSources ?? 0;
    packages += casePackages ?? 0;
    perCase.push({ caseId, workspace: workspace.status, targets: targets.status, sources: caseSources,
      packages: casePackages });
  }
  const readiness = health.body?.databaseReadiness ?? health.body?.database ?? null;
  // The health body's own record counts (sources, importPackages, physicalFeatures ...), numbers and status only.
  const recorded = Object.fromEntries(Object.entries(health.body ?? {})
    .filter(([key, value]) => typeof value === 'number' || key === 'status'));
  return {
    at: new Date().toISOString(), health: { status: health.status, ok: health.body?.ok ?? null, readiness, recorded },
    cases: Array.isArray(cases.body) ? cases.body.length : null, casesStatus: cases.status,
    areas: Array.isArray(areas.body) ? areas.body.length : null, areasStatus: areas.status,
    // Unknown stays null: a sum is given only when the case list and every case's reads answered.
    sources: cases.status === 200 && perCase.every(entry => entry.sources !== null) ? sources : null,
    packages: cases.status === 200 && perCase.every(entry => entry.packages !== null) ? packages : null,
    perCase,
  };
}

function state() {
  return {
    at: new Date().toISOString(),
    commit: text('git', ['-C', demo, 'rev-parse', 'HEAD']),
    checkoutClean: text('git', ['-C', demo, 'status', '--short']) === '',
    servicesGeo: text('git', ['-C', demo, 'rev-parse', 'HEAD:services/geo']),
    machine: machine(), containers: containers(),
    health: text('curl.exe', ['-s', '-m', '20', '-o', 'NUL', '-w', '%{http_code}', `${api}/api/v1/health`]),
  };
}

const doctorSummary = receipt => ({
  exit: receipt.exit, pass: receipt.output.filter(line => line.startsWith('PASS ')).length,
  fail: receipt.output.filter(line => line.startsWith('FAIL ')),
  passLines: receipt.output.filter(line => line.startsWith('PASS ')),
});

const steps = {
  2: 'node --input-type=module -e "import(\'./scripts/platform/processes.mjs\').then(m=>m.stopProcesses())"',
  3: `git -C ${demo} checkout --detach 9d6acc6b`,
  4: 'pnpm install --frozen-lockfile',
  5: 'node scripts/platform/demo-document-runtime.mjs build',
  6: 'node scripts/platform/processor-image.mjs roll',
  7: 'pnpm platform:start --profile demo',
  8: 'pnpm platform:doctor --profile demo',
};

const [action, label] = process.argv.slice(2);
image(oldImage);
image(pinnedImage);
if (action === 'before' || action === 'after') {
  const doctor = run(steps[8]);
  const value = {
    ...state(), doctor, doctorSummary: doctorSummary(doctor), volumes: volumes(),
    images: [image(pinnedImage), image(oldImage)], counts: await counts(),
  };
  save(`${action}${label ? `-${label}` : ''}.json`, value);
  console.log(JSON.stringify({ ...value, doctor: undefined }, null, 2));
} else if (action === 'step') {
  const command = label === 'restore' ? steps[7] : steps[label];
  if (!command) throw new Error('Unknown step');
  const containersBefore = containers();
  const receipt = run(command);
  const value = { step: label, receipt: label === '8' ? receipt : { ...receipt, output: receipt.output.slice(-25) },
    outputLines: receipt.output.length, containersBefore, after: state() };
  if (label === '6') value.images = [image(pinnedImage), image(oldImage)];
  if (label === '8') value.doctorSummary = doctorSummary(receipt);
  save(`step-${label}.json`, value);
  console.log(safe(JSON.stringify({ ...value, receipt: { ...receipt, output: receipt.output.slice(-25) } }, null, 2)));
  process.exitCode = receipt.exit ?? 1;
} else if (action === 'health') {
  // First good /health after the start of step 3: the API was already down when step 2 ran (second run, after the
  // reboot), so step 2 stopped nothing. Polled once a second, at most ten minutes.
  const from = JSON.parse(readFileSync(`${evidence}/step-3.json`, 'utf8')).receipt.startedAt;
  let first = null;
  for (let i = 0; i < 600 && !first; i += 1) {
    const reply = await get('/api/v1/health');
    if (reply.status === 200) first = new Date().toISOString();
    else await new Promise(done => setTimeout(done, 1000));
  }
  const value = { measuredFrom: 'step 3 start', fromAt: from, firstGoodHealthAt: first,
    downtimeSeconds: first ? Number(((Date.parse(first) - Date.parse(from)) / 1000).toFixed(1)) : null };
  save('downtime.json', value);
  console.log(JSON.stringify(value));
} else if (action === 'get' && label) {
  console.log(safe(JSON.stringify(await get(label), null, 2)));
} else throw new Error('Usage: r8.mjs before|after [label] | step <n|restore> | health | get <route>');
