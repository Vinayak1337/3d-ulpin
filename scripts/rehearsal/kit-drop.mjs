// Ported from S1.3 launch.ps1/install.js and REH16 watch.mjs; no runtime lifecycle or direct API writes.
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { win32 } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { allowedPath, checkedPath, readAnswers, readKit, runtimePlan } from './kit-manifest.mjs';
import { answerLayout } from './officer-answers.mjs';
import { attributeFrames, batchItems, captureFrames, captureWatch, cellObservation, drop, mapMoment, newResult,
  observeItem, observeRow, recorder, rendererString, smoothness, uploadWatch } from './presenter.mjs';
import { attributeReads, cpuWatch, dropExits, exitLines, get, jobTiming, lockWatch, processWatch, queueDepth,
  runnerActivity, runnerLoopWatch } from './timing.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (plan, result) => {
  attributeFrames(result.frames, result.process.cpu);
  attributeReads(result.process);
  return writeFile(plan.result, `${JSON.stringify(result)}\n`);
};

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

const pollMs = 15000; // Intake and targets reads under load; the health sampler keeps its own 4.5 s.
const watchIo = { get, observeRow, answerLayout, sleep };

async function poll(io, api, path, polls) {
  const at = Date.now();
  const startMono = performance.now();
  try {
    const body = await io.get(api, path, pollMs);
    polls.push({ at, startMono, path, ms: performance.now() - startMono });
    return body;
  } catch (error) {
    // A slow read is a measurement, not a stop.
    polls.push({ at, startMono, path, ms: performance.now() - startMono, error: error.name });
    return null;
  }
}

function watchError(file, error) {
  const name = error?.name ?? 'Error';
  const message = String(error?.message ?? error).slice(0, 300);
  file.watchErrors ??= [];
  const last = file.watchErrors.at(-1);
  if (last?.name === name && last.message === message) {
    last.count += 1;
    last.lastAt = Date.now();
    return;
  }
  file.watchErrors.push({ at: Date.now(), name, message, count: 1, lastAt: null });
}

async function watchFile(io, page, file, item, result) {
  try {
    await io.observeRow(page, file, item);
    if (result.files.includes(file)) {
      const supplied = result.officerAnswers?.answers.find(answer => answer.file === file.name);
      const before = file.answer?.triedAt;
      const activity = { kind: 'officer_answer', page: 'batch', at: Date.now(), to: null };
      try { await io.answerLayout(page, file, supplied); }
      finally {
        activity.to = Date.now();
        if (file.answer?.triedAt !== before) result.frames.activities.push(activity);
      }
    }
    return true;
  } catch (error) {
    watchError(file, error);
    return false;
  }
}

async function watchPass(io, page, map, plan, result, studio, intake, targets) {
  const originals = result.files.filter(file => file.itemSeenAt !== null);
  for (const [index, [file, item]] of batchItems(originals, intake.items).entries()) {
    if (!result.files.includes(file) && item.sourceId) file.retained ??= Date.now();
    if (!await watchFile(io, page, file, item, result)) continue;
    const packages = (targets.packages ?? []).filter(pkg => pkg.anchorItemId === item.itemId);
    const complete = item.state === 'read' && item.partsPlanned !== null
      && item.partsDone === item.partsPlanned && packages.length === item.partsDone && !targets.packagesTruncated;
    if (item.placement !== 'on_map' || !packages.length) continue;
    for (const phase of ['firstPartOnMap', 'lastPartOnMap']) {
      if (file[phase] || file.mapErrors?.[phase] || (phase === 'lastPartOnMap' && !complete)) continue;
      try {
        const pkg = phase === 'firstPartOnMap' ? packages[0] : packages.at(-1);
        file[phase] = await mapMoment(map, studio, pkg, plan.out, `${index}-${phase}`,
          result.frames.map, result.frames.activities);
        result.renderer ??= file[phase].renderer;
      } catch (error) {
        file.mapErrors ??= {};
        file.mapErrors[phase] = error.name;
      }
    }
  }
}

function discoverCells(file, item, cases, parentCaseId) {
  for (const ref of item.cellBatches ?? []) {
    file.cells ??= [];
    let cell = file.cells.find(row => row.cellKey === ref.cellKey);
    if (!cell) file.cells.push(cell = cellObservation(ref));
    // Reference state is not a child intake measurement. Only an accessible case/item pair may be polled.
    Object.assign(cell, { caseId: ref.caseId, itemId: ref.itemId });
    if (!ref.caseId || !ref.itemId) {
      cell.itemReason = 'Cell batch is unavailable or not accessible; no intake polled.';
      continue;
    }
    if (ref.caseId === parentCaseId) {
      cell.itemReason = 'Cell reference points to the parent batch; no extra intake polled.';
      continue;
    }
    let entry = cases.get(ref.caseId);
    if (!entry && cases.size >= 30) {
      cell.itemReason = 'Child-case polling limit reached (30 cases).';
      continue;
    }
    if (!entry) cases.set(ref.caseId, entry = { nextAt: 0, cells: [] });
    if (!entry.cells.includes(cell)) entry.cells.push(cell);
  }
}

function observeIntake(result, intake, cases) {
  const at = Date.now();
  for (const [file, item] of batchItems(result.files, intake.items)) {
    observeItem(file, item, at, result.dropAt);
    discoverCells(file, item, cases, result.caseId);
  }
}

async function pollCells(io, api, result, cases, polls) {
  for (const [caseId, entry] of cases) {
    const cells = entry.cells.filter(cell => cell.caseId === caseId && cell.itemId);
    if (!cells.length || Date.now() < entry.nextAt) continue;
    const at = Date.now();
    const intake = await poll(io, api, `/ingestion/cases/${encodeURIComponent(caseId)}/intake`, polls);
    entry.nextAt = Date.now() + 10000; // Cooldown includes failed reads; no overlapping child polls.
    for (const cell of cells) {
      cell.lastAttemptAt = at;
      if (!intake) {
        cell.itemReason = `Child intake poll failed: ${polls.at(-1).error}.`;
        continue;
      }
      const item = intake.items.find(item => item.itemId === cell.itemId);
      if (!item) {
        cell.itemReason = 'Referenced cell item is absent from the child intake answer.';
        continue;
      }
      cell.name = item.name;
      observeItem(cell, item, Date.now(), result.dropAt);
      for (const [member, child] of batchItems([cell], intake.items).slice(1)) {
        observeItem(member, child, Date.now(), result.dropAt);
      }
    }
  }
}

function retentionWatch(page, result) {
  const documents = [];
  result.uploadsFinished = null;
  result.reloadsDuringRetention = [];
  for (const file of result.files) Object.assign(file, { itemSeenAt: null, retained: false });
  const updateReloads = () => {
    const until = Math.min(result.dropAt + 180000, result.uploadsFinished ?? Infinity);
    result.reloadsDuringRetention = documents.filter(({ at }) => result.dropAt != null
      && at >= result.dropAt && at <= until);
  };
  const request = request => {
    if (!request.isNavigationRequest() || request.redirectedFrom() || request.frame() !== page.mainFrame()) return;
    documents.push({ at: Date.now() }); // Main-frame document requests, not SPA or child-frame navigation.
    updateReloads();
  };
  page?.on('request', request);
  return {
    observe(items) {
      updateReloads();
      const at = Date.now();
      // A large original can enrol after the 180 s retention window; it is still seen and watched, only later.
      if (result.uploadsFinished !== null) return;
      for (const file of result.files) {
        if (!items.some(item => !item.parentItemId && !item.archiveItemId
          && item.name === file.name && item.sizeBytes === file.bytes)) continue;
        file.itemSeenAt ??= at;
        file.retained = true;
      }
      if (result.files.length && result.files.every(file => file.itemSeenAt !== null)) result.uploadsFinished = at;
    },
    stop() { updateReloads(); page?.off('request', request); },
  };
}

export async function watchBatch(page, map, plan, result, api, studio, minutes, io = watchIo,
  retention = retentionWatch(page, result)) {
  const deadline = Date.now() + minutes * 60000;
  const polls = result.process.polls ??= [];
  const childCases = new Map();
  try {
    while (Date.now() < deadline || (result.dropAt != null && result.uploadsFinished === null
      && Date.now() < result.dropAt + 180000)) {
      const intake = await poll(io, api, `/ingestion/cases/${result.caseId}/intake`, polls);
      if (intake) {
        retention.observe(intake.items);
        observeIntake(result, intake, childCases);
      }
      const targets = intake ? await poll(io, api, `/ingestion/cases/${result.caseId}/targets`, polls) : null;
      await pollCells(io, api, result, childCases, polls);
      if (targets) await watchPass(io, page, map, plan, result, studio, intake, targets);
      await save(plan, result);
      await io.sleep(1000);
    }
  } finally { retention.stop(); }
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

async function finish(plan, result, api, session, stopWatch, loop) {
  const { page, map } = session;
  if (page && !page.isClosed()) {
    result.renderer ??= await rendererString(page).catch(() => null);
    await captureFrames(page, 'batch', result.frames.batch);
  }
  if (map) await captureFrames(map, 'map', result.frames.map);
  if (stopWatch) result.process.samples = await stopWatch();
  if (result.caseId) {
    try {
      result.jobs = await runnerActivity(result.frames.activities, 'job_query',
        () => jobTiming(plan.runtime, result.caseId));
    }
    catch (error) { result.jobsError = error.message; }
    result.process.exitsAfter = await exitLines(plan.runtime).catch(() => null);
    if (result.dropAt) Object.assign(result.process, dropExits(result.process.exitsAfter, result.dropAt));
  }
  loop?.stop();
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
  let stopUploads;
  let stopCpu;
  let stopLocks;
  let loop;
  let retention;
  try {
    await build(plan, env);
    const vite = fileURLToPath(new URL('../../apps/studio/node_modules/vite/bin/vite.js', import.meta.url));
    preview = await command(process.execPath,
      [vite, 'preview', '--host', '127.0.0.1', '--port', '5189', '--strictPort'], plan.previewLog, env, false,
      fileURLToPath(new URL('../../apps/studio/', import.meta.url)));
    await waitPreview(studio, preview);
    if (!(await get(api, '/health')).ok) throw new Error('Rehearsal health check refused');
    result.process.exitsBefore = await exitLines(plan.runtime);
    loop = runnerLoopWatch(result.process.runnerLoop);
    stopWatch = processWatch(api);
    stopCpu = cpuWatch(result.process.cpu);
    session = await presenter(env); // Separate headed windows avoid a background batch tab.
    stopUploads = uploadWatch(session.page, result);
    stopCaptures = captureWatch(session.page, session.map, result.frames, async () => {
      loop.capture();
      if (!result.caseId) return;
      try {
        result.process.queue.push(await runnerActivity(result.frames.activities, 'job_query',
          () => queueDepth(plan.runtime, result.caseId)));
      }
      catch { result.process.queue.push({ at: Date.now(), counts: null, error: 'Read-only queue query failed' }); }
    });
    retention = retentionWatch(session.page, result);
    stopLocks = await lockWatch(plan.runtime, `${plan.out}/lock-waits.jsonl`, result.process.lockWaits);
    const dropped = await drop(session.page, studio, files, result.frames.activities);
    result.caseId = dropped.caseId;
    result.dropAt = dropped.at;
    await watchBatch(session.page, session.map, plan, result, api, studio, minutes, watchIo, retention);
    result.status = 'observation_window_complete';
  } catch (error) {
    result.error = { name: error.name, message: error.message.slice(0, 300) };
    process.exitCode = 1;
  } finally {
    retention?.stop();
    try {
      await stopLocks?.();
      await stopCaptures?.();
      await stopUploads?.();
      await stopCpu?.();
      await finish(plan, result, api, session, stopWatch, loop);
    }
    finally {
      loop?.stop();
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

if (import.meta.main) {
  await main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
