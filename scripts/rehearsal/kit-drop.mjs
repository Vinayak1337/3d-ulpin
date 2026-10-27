// Ported from S1.3 launch.ps1/install.js and REH16 watch.mjs; no runtime lifecycle or direct API writes.
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { win32 } from 'node:path';
import { parseArgs } from 'node:util';
import { allowedPath, checkedPath, readAnswers, readKit, runtimePlan } from './kit-manifest.mjs';
import { answerLayout } from './officer-answers.mjs';
import { batchItems, captureFrames, captureWatch, drop, mapMoment, newResult, observeRow, recorder,
  rendererString, smoothness } from './presenter.mjs';
import { dropExits, exitLines, get, jobTiming, processWatch, queueDepth } from './timing.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (plan, result) => writeFile(plan.result, `${JSON.stringify(result)}\n`);

async function outputGuard(out) {
  let ancestor = out;
  while (true) {
    try {
      const canonical = await checkedPath(ancestor);
      const candidate = win32.resolve(canonical, win32.relative(ancestor, out)).replaceAll('\\', '/');
      runtimePlan('ulpin-reh-03', candidate);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = win32.dirname(ancestor);
    }
  }
  if (await stat(out).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  })) throw new Error('Use a new output folder; prior evidence is never overwritten');
}

async function command(executable, args, path, env, shell = false, cwd = root) {
  const log = await open(path, 'wx');
  const child = spawn(executable, args, { cwd, env, shell, windowsHide: true,
    stdio: ['ignore', log.fd, log.fd] });
  child.finished = new Promise(resolve => {
    child.once('error', error => { child.launchError = error; resolve(-1); });
    child.once('exit', resolve);
  });
  await log.close();
  return child;
}

async function build(plan, env) {
  const child = await command('pnpm', ['studio:build'], plan.buildLog, env, process.platform === 'win32');
  const code = await child.finished;
  if (code !== 0) throw new Error(`Studio build exit ${code}`);
}

async function waitPreview(studio, child) {
  for (let n = 0; n < 90; n += 1) {
    if (child.launchError || child.exitCode !== null) throw new Error('Preview exited; see preview.log');
    const response = await fetch(`${studio}/studio/work`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) return;
    await sleep(1000);
  }
  throw new Error('Preview did not become ready');
}

async function watchBatch(page, map, plan, result, api, studio, minutes) {
  const deadline = Date.now() + minutes * 60000;
  while (Date.now() < deadline) {
    const intake = await get(api, `/ingestion/cases/${result.caseId}/intake`);
    const targets = await get(api, `/ingestion/cases/${result.caseId}/targets`);
    for (const [index, [file, item]] of batchItems(result.files, intake.items).entries()) {
      if (item.sourceId) file.retained ??= Date.now();
      await observeRow(page, file, item);
      if (result.files.includes(file)) {
        await answerLayout(page, file, result.officerAnswers?.answers.find(answer => answer.file === file.name));
      }
      const packages = (targets.packages ?? []).filter(pkg => pkg.anchorItemId === item.itemId);
      const complete = item.state === 'read' && item.partsPlanned !== null
        && item.partsDone === item.partsPlanned && packages.length === item.partsDone && !targets.packagesTruncated;
      if (item.placement !== 'on_map' || !packages.length) continue;
      for (const phase of ['firstPartOnMap', 'lastPartOnMap']) {
        if (file[phase] || file.mapErrors?.[phase] || (phase === 'lastPartOnMap' && !complete)) continue;
        try {
          const pkg = phase === 'firstPartOnMap' ? packages[0] : packages.at(-1);
          file[phase] = await mapMoment(map, studio, pkg, plan.out, `${index}-${phase}`, result.frames.map);
          result.renderer ??= file[phase].renderer;
        } catch (error) {
          file.mapErrors ??= {};
          file.mapErrors[phase] = error.name;
        }
      }
    }
    await save(plan, result);
    await sleep(1000);
  }
}

async function presenter(env) {
  Object.assign(process.env, { TMP: env.TMP, TEMP: env.TEMP, TMPDIR: env.TMPDIR });
  const { chromium } = createRequire(import.meta.url)('@playwright/test');
  allowedPath(chromium.executablePath()); // Do not install or launch browser binaries on C:.
  const browser = await chromium.launch({ headless: false, env,
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const mapContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(recorder);
    await mapContext.addInitScript(recorder);
    return { browser, page: await context.newPage(), map: await mapContext.newPage() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function finish(plan, result, api, session, stopWatch) {
  const { page, map } = session;
  if (page && !page.isClosed()) {
    result.renderer ??= await rendererString(page).catch(() => null);
    await captureFrames(page, 'batch', result.frames.batch);
  }
  if (map) await captureFrames(map, 'map', result.frames.map);
  if (stopWatch) result.process.samples = await stopWatch();
  if (result.caseId) {
    try { result.jobs = jobTiming(plan.runtime, result.caseId); }
    catch (error) { result.jobsError = error.message; }
    result.process.exitsAfter = await exitLines(plan.runtime).catch(() => null);
    if (result.dropAt) Object.assign(result.process, dropExits(result.process.exitsAfter, result.dropAt));
  }
  result.frames.verdict = result.status === 'incomplete' ? 'not_a_smoothness_verdict'
    : smoothness(result.renderer, [...result.frames.batch, ...result.frames.map]);
  result.finished = Date.now();
  await save(plan, result);
}

async function run(plan, files, minutes, answers) {
  await new Promise((resolve, reject) => {
    const probe = createConnection({ host: '127.0.0.1', port: plan.studioPort });
    probe.once('connect', () => { probe.destroy(); reject(new Error('Preview port is already occupied')); });
    probe.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
  await mkdir(plan.out, { recursive: true });
  const env = { ...process.env, TMP: 'E:/ulpin-tmp', TEMP: 'E:/ulpin-tmp', TMPDIR: 'E:/ulpin-tmp',
    ULPIN_API_TARGET: `http://127.0.0.1:${plan.apiPort}`, VITE_HOSTED_DEMO: '0' };
  const api = `${env.ULPIN_API_TARGET}/api/v1`;
  const studio = `http://127.0.0.1:${plan.studioPort}`;
  const result = newResult(plan.runtime, files);
  if (answers) result.officerAnswers = answers;
  let preview;
  let session = {};
  let stopWatch;
  let stopCaptures;
  try {
    await build(plan, env);
    const vite = fileURLToPath(new URL('../../apps/studio/node_modules/vite/bin/vite.js', import.meta.url));
    preview = await command(process.execPath,
      [vite, 'preview', '--host', '127.0.0.1', '--port', '5189', '--strictPort'], plan.previewLog, env, false,
      fileURLToPath(new URL('../../apps/studio/', import.meta.url)));
    await waitPreview(studio, preview);
    if (!(await get(api, '/health')).ok) throw new Error('Rehearsal health check refused');
    result.process.exitsBefore = await exitLines(plan.runtime);
    stopWatch = processWatch(api);
    session = await presenter(env); // Separate headed windows avoid a background batch tab.
    stopCaptures = captureWatch(session.page, session.map, result.frames, () => {
      if (!result.caseId) return;
      try { result.process.queue.push(queueDepth(plan.runtime, result.caseId)); }
      catch { result.process.queue.push({ at: Date.now(), counts: null, error: 'Read-only queue query failed' }); }
    });
    const dropped = await drop(session.page, studio, files);
    result.caseId = dropped.caseId;
    result.dropAt = dropped.at;
    const uploaded = session.page.getByText('Files in this drop', { exact: true })
      .waitFor({ state: 'hidden', timeout: 180000 }).then(() => { result.uploadsFinished = Date.now(); })
      .catch(() => { result.uploadsFinished = null; });
    await watchBatch(session.page, session.map, plan, result, api, studio, minutes);
    await uploaded;
    result.status = 'observation_window_complete';
  } catch (error) {
    result.error = { name: error.name, message: error.message.slice(0, 300) };
    process.exitCode = 1;
  } finally {
    try {
      await stopCaptures?.();
      await finish(plan, result, api, session, stopWatch);
    }
    finally {
      try { await session.browser?.close(); }
      finally { preview?.kill(); } // Only the preview created here; never the runtime.
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: { runtime: { type: 'string' }, kit: { type: 'string' },
    out: { type: 'string' }, 'dry-run': { type: 'boolean' }, 'verify-hash': { type: 'boolean' },
    answers: { type: 'string' }, minutes: { type: 'string', default: '30' } } });
  const plan = runtimePlan(values.runtime, values.out);
  const minutes = Number(values.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) throw new Error('Minutes must be in (0, 120]');
  const answers = values.answers ? await readAnswers(values.answers, plan.runtime) : null;
  const files = await readKit(values.kit, values['verify-hash']);
  await outputGuard(plan.out);
  console.log(JSON.stringify({ ...plan, files, answers, minutes, dryRun: Boolean(values['dry-run']) }, null, 2));
  if (!values['dry-run']) await run(plan, files, minutes, answers);
}

await main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
