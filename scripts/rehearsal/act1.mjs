import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { win32 } from 'node:path';
import { allowedPath, checkedPath, runtimePlan } from './kit-manifest.mjs';
import { drop } from './presenter.mjs';
import { answerLayout } from './officer-answers.mjs';
import { closeSession, contextOptions, videoPlan, videoPreflight } from './kit-drop.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mapName = 'buildings-original.geojson';
const tableName = 'gpmc-yuvp.csv';
const namespace = 'NYC building identification number (bin), as written in both files';
const originals = [
  `E:/BhuAayam-data/datasets/nyc-10013/files/${mapName}`,
  `E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/${tableName}`,
  'E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-ortho-2018.tif',
  'E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-lidar-2017.laz',
];

export function act1Options(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--runtime', '--out', '--video'].includes(flag)) throw new Error(`Unknown option ${flag}`);
    if (values[flag]) throw new Error(`Repeated option ${flag}`);
    if (flag === '--video') {
      values[flag] = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values[flag] = value;
  }
  return videoPlan(runtimePlan(values['--runtime'], values['--out']), values['--video']);
}

export async function freshOutput(plan) {
  let ancestor = plan.out;
  while (true) {
    try {
      const canonical = await checkedPath(ancestor);
      runtimePlan(plan.runtime, win32.resolve(canonical, win32.relative(ancestor, plan.out)));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = win32.dirname(ancestor);
    }
  }
  if (await stat(plan.out).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  })) throw new Error('Use a new output folder; prior evidence is never overwritten');
}

async function until(page, action, timeout = 300000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await action();
    if (value) return value;
    const alerts = page ? await page.getByRole('alert').allTextContents() : [];
    if (alerts.some(words => words.trim())) throw new Error(alerts.join('\n'));
    await sleep(1000);
  }
  throw new Error('Bounded observation expired');
}

export async function retainedOriginals(page, files) {
  const tray = page.getByRole('region', { name: 'Files in this batch', exact: true });
  for (const file of files) {
    await tray.getByRole('button', { name: win32.basename(file.path), exact: true })
      .waitFor({ timeout: 180000 });
  }
  return tray.innerText();
}

// The reading belongs to the batch. Never wait for the retired table-page navigation.
export async function readInlineTable(page, name) {
  await page.getByRole('button', { name: `Open the table: ${name}`, exact: true }).click();
  const table = page.getByRole('region', { name: `Table in ${name}`, exact: true });
  await table.waitFor({ timeout: 120000 });
  await until(page, async () => {
    if (await table.getByText('Read as a table.', { exact: true }).isVisible()) return true;
    const read = table.getByRole('button', { name: 'Read as a table', exact: true });
    if (await read.isVisible() && await read.isEnabled()) {
      await read.click();
      await table.getByText('Read as a table.', { exact: true }).waitFor({ timeout: 120000 });
      return true;
    }
    return false;
  });
  return table.innerText();
}

export function journeyTransport(apiPort, out) {
  return `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const original = globalThis.fetch;
const requests = [];
globalThis.fetch = (input, options = {}) => {
  assert.equal(typeof input, 'string', 'Only journey URL strings are permitted');
  const url = new URL(input);
  assert.equal(url.origin, 'http://127.0.0.1:3194', 'Unexpected journey origin denied before request');
  assert.equal(options.method ?? 'GET', 'GET', 'Journey writes denied before request');
  url.port = '${apiPort}';
  requests.push({ method: 'GET', target: url.origin, path: url.pathname });
  return original(url.href, options);
};
process.once('exit', () => {
  if (requests.length) writeFileSync(${JSON.stringify(out + '/journey-transport-')} + process.pid + '.json',
    JSON.stringify({ requests }));
});
`;
}

async function command(executable, args, logPath, env, cwd = repo) {
  const log = await open(logPath, 'wx');
  const child = spawn(executable, args, { cwd, env, windowsHide: true,
    shell: executable === 'pnpm' && process.platform === 'win32', stdio: ['ignore', log.fd, log.fd] });
  child.finished = new Promise(resolve => {
    child.once('error', error => {
      child.launchError = error;
      resolve(-1);
    });
    child.once('exit', resolve);
  });
  await log.close();
  return child;
}

async function inputs() {
  const files = [];
  for (const path of originals) {
    const canonical = await checkedPath(path);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(canonical)) hash.update(chunk);
    files.push({ path: canonical, bytes: (await stat(canonical)).size, sha256: hash.digest('hex') });
  }
  return files;
}

export async function layout(page, answer = answerLayout) {
  const file = { name: mapName, rowMatch: { kind: 'one', count: 1 }, layoutQuestionOffered: Date.now() };
  const row = page.getByRole('region', { name: 'Files in this batch', exact: true }).getByRole('row')
    .filter({ has: page.getByRole('button', { name: mapName, exact: true }) });
  const view = row.getByRole('button', { name: 'View layout', exact: true });
  await view.waitFor({ timeout: 300000 });
  await view.click();
  const section = page.getByRole('region', { name: `Layout for ${mapName}`, exact: true });
  const change = section.getByRole('button', { name: 'Change', exact: true });
  await until(page, async () => await change.isVisible()
    || await section.getByRole('combobox', { name: 'What is each feature in this file?', exact: true }).isVisible());
  if (await change.isVisible()) await change.click();
  await answer(page, file, { file: mapName, kind: 'building', identifierField: 'bin', nameField: null });
  if (!['used', 'approved'].includes(file.answer?.state)) {
    throw new Error(file.answer?.alerts?.join('\n') || file.answer?.error || 'Officer layout did not complete');
  }
  return file.answer;
}

export async function declareKey(page) {
  await page.getByRole('button', { name: /^Evidence by key/ }).click({ timeout: 300000 });
  await page.getByRole('button', { name: 'Link a register by a key', exact: true }).click();
  const form = page.getByRole('form', { name: 'Link a register by a key', exact: true });
  await form.getByLabel('Key namespace, in your words', { exact: true }).fill(namespace);
  await form.getByRole('combobox', { name: 'Key kind' }).selectOption('integer');
  await form.getByRole('combobox', { name: 'Map item with drafted buildings' }).selectOption({ label: mapName });
  await form.getByRole('combobox', { name: 'Key field of its buildings' }).selectOption('/features/*/properties/bin');
  await form.getByRole('combobox', { name: tableName }).selectOption({ label: 'bin' });
  await form.getByRole('button', { name: 'Declare the key', exact: true }).click();
}

async function confirmEvidence(page) {
  await page.getByText(/Closed: \d+ read, \d+ with a key/).first().waitFor({ timeout: 300000 });
  await page.getByRole('button', { name: `Confirm the evidence of ${namespace}`, exact: true }).click();
  const form = page.getByRole('form', { name: `Confirm the evidence of the key ${namespace}`, exact: true });
  await form.getByRole('button', { name: `Accept every exact single match of this file: ${tableName}`,
    exact: true }).click();
  const decisions = form.getByRole('region', { name: 'Your decisions', exact: true });
  await decisions.waitFor({ timeout: 60000 });
  const accepted = await decisions.getByRole('listitem').allTextContents();
  const keys = accepted.map(words => words.match(/^Accepted: ([^,]+),/)?.[1]).filter(Boolean);
  if (!keys.length) throw new Error('No exact single source-key match selected');
  await form.getByRole('textbox', { name: 'Your acknowledgement', exact: true }).fill(
    'Rehearsal officer test_only: accept the selected exact single BIN matches as register citations. '
    + 'Leave conflicting and unmatched rows undecided. No rights or ownership asserted.');
  await form.getByRole('button', { name: 'Confirm the evidence', exact: true }).click();
  await page.getByText(/Stored with every pin it names/).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  return keys;
}

async function chooseCard(page, keys) {
  const buildings = page.getByRole('region', { name: 'Buildings of the batch', exact: true });
  await buildings.getByRole('combobox', { name: 'Show buildings', exact: true }).selectOption('ready');
  const chosen = await until(page, async () => {
    const names = await buildings.getByRole('checkbox').evaluateAll(nodes => nodes.map(node => ({
      words: node.parentElement.innerText.trim(), enabled: !node.disabled,
    })));
    const match = names.find(row => row.enabled && keys.some(key => row.words === `feature ${key}`));
    if (match) return match.words;
    const more = buildings.getByRole('button', { name: 'Show more', exact: true });
    if (await more.isVisible() && await more.isEnabled()) await more.click();
    return null;
  });
  await buildings.getByRole('checkbox', { name: chosen, exact: true }).check();
  await page.getByRole('textbox', { name: 'Your acknowledgement', exact: true }).fill(
    `Rehearsal officer test_only: record the reviewed packages and make the chosen ${chosen} card with `
    + 'confirmed register evidence. Full package scope acknowledged; no rights, ownership or ULPIN issued.');
  await page.getByRole('button', { name: /^Record \d[\d,]* buildings? and make 1 card$/ }).click();
  await buildings.getByRole('combobox', { name: 'Show buildings', exact: true }).selectOption('');
  return chosen;
}

async function journey(plan, result, env) {
  const shim = `${plan.out}/journey-runtime.mjs`;
  await writeFile(shim, journeyTransport(plan.apiPort, plan.out));
  const child = await command('pnpm', ['journey:check', '--case', result.caseId,
    '--output', `${plan.out}/journey.json`], `${plan.out}/journey.log`,
  { ...env, NODE_OPTIONS: `--import=${new URL('file:///' + shim).href}` });
  result.journey = { exitCode: await child.finished, transport: `http://127.0.0.1:${plan.apiPort}`,
    note: 'The checker prints its legacy demo label; journey-transport-*.json records actual GET destinations.',
    result: JSON.parse(await readFile(`${plan.out}/journey.json`, 'utf8')) };
  if (result.journey.exitCode !== 0 || result.journey.result.summary.pass !== 8) {
    throw new Error(JSON.stringify(result.journey.result.steps.filter(step => step.state !== 'pass')));
  }
}

function stepRecorder(plan, result, session, save) {
  return async (name, action) => {
    const { page } = session;
    const row = { name, startedAt: Date.now(), words: null, screenshot: null };
    result.steps.push(row);
    await save();
    try { row.value = await action(); }
    catch (error) {
      row.error = error.message;
      throw error;
    }
    finally {
      row.finishedAt = Date.now();
      row.seconds = (row.finishedAt - row.startedAt) / 1000;
      if (page) {
        row.words = await page.locator('body').innerText().catch(() => null);
        row.alerts = await page.getByRole('alert').allTextContents().catch(() => []);
        row.screenshot = `${result.steps.length}-${name}.png`;
        await page.screenshot({ path: `${plan.out}/${row.screenshot}` }).catch(error => {
          row.screenshot = null;
          row.screenshotError = error.message;
        });
      }
      await save();
    }
    return row.value;
  };
}

async function launchStudio(plan, env, session) {
  await new Promise((resolve, reject) => {
    const probe = createConnection({ host: '127.0.0.1', port: plan.studioPort });
    probe.once('connect', () => {
      probe.destroy();
      reject(new Error('Preview port is already occupied'));
    });
    probe.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
  const build = await command('pnpm', ['studio:build'], plan.buildLog, env);
  if (await build.finished !== 0) throw new Error('Studio build failed; see build.log');
  const vite = fileURLToPath(new URL('../../apps/studio/node_modules/vite/bin/vite.js', import.meta.url));
  session.preview = await command(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', '5189',
    '--strictPort'], plan.previewLog, env, `${repo}/apps/studio`);
  await until(null, async () => {
    if (session.preview.launchError || session.preview.exitCode !== null) {
      throw new Error('Preview exited; see preview.log');
    }
    return (await fetch('http://127.0.0.1:5189', { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok;
  }, 90000);
  const { chromium } = createRequire(import.meta.url)('@playwright/test');
  allowedPath(chromium.executablePath());
  session.browser = await chromium.launch({ headless: false, env, args: ['--use-angle=d3d11'] });
  session.contexts = [];
  const context = await session.browser.newContext(contextOptions(plan));
  session.contexts.push(context);
  session.page = await context.newPage();
  session.page.setDefaultTimeout(30000);
}

async function drive(page, plan, result, env, step) {
  const dropped = await step('drop-originals', () => drop(page, 'http://127.0.0.1:5189', result.files));
  result.caseId = dropped.caseId;
  await step('retained', () => retainedOriginals(page, result.files));
  await step('officer-layout', () => layout(page));
  await step('inline-table', () => readInlineTable(page, tableName));
  await step('declare-key', () => declareKey(page));
  const keys = await step('confirm-evidence', () => confirmEvidence(page));
  const chosen = await step('record-and-make-card', () => chooseCard(page, keys));
  await step('cited-card', async () => {
    const row = page.getByRole('region', { name: 'Buildings of the batch', exact: true }).getByRole('listitem')
      .filter({ has: page.getByRole('checkbox', { name: chosen, exact: true }) });
    await until(page, async () => {
      if (await row.getByRole('link', { name: 'Verification', exact: true }).isVisible()) return true;
      if (await row.getByText('Stopped', { exact: true }).isVisible()) throw new Error(await row.innerText());
      const more = page.getByRole('region', { name: 'Buildings of the batch', exact: true })
        .getByRole('button', { name: 'Show more', exact: true });
      if (await more.isVisible() && await more.isEnabled()) await more.click();
      return false;
    }, 600000);
    await row.getByRole('link', { name: 'Verification', exact: true }).click();
    await page.getByText('Consistent', { exact: true }).first().waitFor({ timeout: 60000 });
  });
  await step('journey-check', () => journey(plan, result, env));
}

async function run(plan) {
  await videoPreflight(plan);
  await freshOutput(plan);
  await mkdir(plan.out, { recursive: true });
  const result = { version: 'act1/1', test_only: true, runtime: plan.runtime, startedAt: Date.now(),
    caseId: null, steps: [], status: 'incomplete', journey: null, videos: [] };
  const save = () => writeFile(plan.result, JSON.stringify(result, null, 2) + '\n');
  const env = { ...process.env, TMP: 'E:/ulpin-tmp', TEMP: 'E:/ulpin-tmp', TMPDIR: 'E:/ulpin-tmp',
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? 'E:/ms-playwright',
    ULPIN_API_TARGET: `http://127.0.0.1:${plan.apiPort}`, VITE_HOSTED_DEMO: '0' };
  Object.assign(process.env, { TMP: env.TMP, TEMP: env.TEMP, TMPDIR: env.TMPDIR });
  const session = {};
  try {
    result.files = await inputs();
    await launchStudio(plan, env, session);
    await drive(session.page, plan, result, env, stepRecorder(plan, result, session, save));
    result.status = 'passed';
  } catch (error) {
    const failed = result.steps.at(-1);
    result.error = { step: failed?.name ?? 'setup', message: error.message,
      words: failed?.alerts?.join('\n') || failed?.words || error.message };
    console.error(result.error.words);
    process.exitCode = 1;
  } finally {
    try { await closeSession(plan, result, session); }
    finally {
      result.finishedAt = Date.now();
      try { await save(); }
      finally { session.preview?.kill(); }
    }
  }
  console.log(JSON.stringify({ runtime: plan.runtime, caseId: result.caseId, status: result.status }));
}

if (import.meta.main) {
  await run(act1Options(process.argv.slice(2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
