// Ported from S1.3 dress.mjs recorder, install.js drop selectors and b-under-load.js map waits.
import { win32 } from 'node:path';
import { lockWaitSummary, nearestCpu, runnerActivity } from './timing.mjs';

const observation = name => ({ name, retained: null, layoutQuestionShown: null, layoutQuestionOffered: null,
  firstPartOnMap: null, lastPartOnMap: null, words: null, rowWords: null, state: null, placement: null,
  parts: null, partsPlanned: null, partsDone: null, firstPartAt: null, allPartsAt: null,
  firstPartSeconds: null, allPartsSeconds: null, lastPollAt: null, timeline: [],
  itemReason: 'No matching intake item observed.' });

export function batchItems(files, items) {
  return files.flatMap(file => {
    const item = items.find(item => item.name === file.name && !item.parentItemId && !item.archiveItemId);
    if (!item) return [];
    const members = items.filter(child => child.archiveItemId === item.itemId || child.parentItemId === item.itemId);
    return [[file, item], ...members.map(child => {
      let member = file.members.find(row => row.itemId === child.itemId);
      if (!member) file.members.push(member = { ...observation(child.name), itemId: child.itemId });
      return [member, child];
    })];
  });
}

export function observeItem(file, item, at, dropAt) {
  const values = { state: item.state ?? null, placement: item.placement ?? null,
    partsPlanned: item.partsPlanned ?? null, partsDone: item.partsDone ?? null,
    words: item.words ?? item.limitReason ?? item.what ?? null };
  const last = file.timeline.at(-1);
  if (!last || Object.keys(values).some(key => last[key] !== values[key])) {
    file.timeline.push({ at, ...values });
  }
  Object.assign(file, values, { itemId: item.itemId, lastPollAt: at, itemReason: null,
    parts: [values.partsDone, values.partsPlanned] });
  if (values.partsDone > 0) {
    file.firstPartAt ??= at;
    if (values.partsDone === values.partsPlanned) file.allPartsAt ??= at;
  }
  file.firstPartSeconds = file.firstPartAt !== null && dropAt != null ? (file.firstPartAt - dropAt) / 1000 : null;
  file.allPartsSeconds = file.allPartsAt !== null && dropAt != null ? (file.allPartsAt - dropAt) / 1000 : null;
}

export function cellObservation(ref) {
  return { ...observation(null), cellKey: ref.cellKey, caseId: ref.caseId, itemId: ref.itemId,
    members: [], lastAttemptAt: null };
}

export function newResult(runtime, files) {
  return { version: 'kit-drop/1', runtime, started: Date.now(), caseId: null, renderer: null,
    files: files.map(file => ({ ...file, ...observation(file.path ? win32.basename(file.path) : null), members: [] })),
    frames: { batch: [], map: [], activities: [] }, uploadRows: [], consoleErrors: [],
    jobs: null, process: { samples: [], cpu: [], queue: [], runnerLoop: [], lockWaits: lockWaitSummary(),
      exitsBefore: null, exitsAfter: null },
    status: 'incomplete' };
}

export function recorder() {
  const state = window.__rehearsal = { from: Date.now(), frames: 0, maxMs: null, over100: 0,
    longestTaskMs: null, hidden: 0, slowFrames: [], animationFrames: [] };
  let last = performance.now();
  const tick = now => {
    const start = performance.timeOrigin + last;
    const duration = now - last;
    const ms = Math.round(duration);
    last = now;
    state.frames += 1;
    state.maxMs = Math.max(state.maxMs ?? 0, ms);
    if (duration > 100) {
      state.over100 += 1;
      state.slowFrames.push({ start, duration });
    }
    if (document.hidden) state.hidden += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    if (PerformanceObserver.supportedEntryTypes && !PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      throw new Error('Long tasks unavailable');
    }
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.longestTaskMs = Math.max(state.longestTaskMs ?? 0, Math.round(entry.duration));
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { state.longTasksUnavailable = true; }
  try {
    const type = 'long-animation-frame';
    if (PerformanceObserver.supportedEntryTypes && !PerformanceObserver.supportedEntryTypes.includes(type)) {
      throw new Error('Long animation frames unavailable');
    }
    const record = list => {
      for (const entry of list.getEntries()) {
        const scripts = [...(entry.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 3)
          .map(script => ({ sourceURL: script.sourceURL ? new URL(script.sourceURL, location.href).pathname : '',
            sourceFunctionName: script.sourceFunctionName ?? null, invoker: script.invoker ?? null,
            duration: script.duration }));
        state.animationFrames.push({ start: performance.timeOrigin + entry.startTime,
          duration: entry.duration, blockingDuration: entry.blockingDuration, scripts });
      }
    };
    const observer = new PerformanceObserver(record);
    observer.observe({ type, buffered: true });
    window.__rehearsalFlush = () => record({ getEntries: () => observer.takeRecords() });
  } catch { state.longAnimationFramesUnavailable = true; }
}

const overlaps = (a, b) => a.start < b.start + b.duration && b.start < a.start + a.duration;

export function attributeFrames(frames, cpu = []) {
  const captures = [...frames.batch, ...frames.map];
  const slow = captures.flatMap(capture => (capture.slowFrames ?? []).map(frame => ({ page: capture.page, frame })));
  const counts = { script: 0, not_script: 0, browser_wide: 0, runner_activity: 0 };
  for (const capture of captures) {
    // Entries can be delivered after the frame's capture window. Match across windows, but never across pages.
    const entries = captures.filter(other => other.page === capture.page)
      .flatMap(other => other.animationFrames ?? []);
    for (const frame of capture.slowFrames ?? []) {
      const matching = entries.filter(entry => overlaps(frame, entry));
      frame.animationFrames = matching;
      frame.blockingDuration = matching.length ? matching.reduce((sum, entry) => sum + entry.blockingDuration, 0)
        : null;
      frame.scripts = matching.flatMap(entry => entry.scripts).sort((a, b) => b.duration - a.duration).slice(0, 3);
      frame.browserWide = slow.some(other => other.page !== capture.page
        && Math.abs(other.frame.start - frame.start) <= 50);
      frame.cpu = nearestCpu(frame.start, cpu);
      // A named script outranks a shared stall: one renderer can stall both pages from either page's script.
      frame.cause = frame.scripts.length ? 'script' : frame.browserWide ? 'browser_wide' : 'not_script';
      frame.runnerActivities = (frames.activities ?? []).filter(activity => overlaps(frame,
        { start: activity.at, duration: Math.max(1, (activity.to ?? Date.now()) - activity.at) }));
      counts[frame.cause] += 1;
      if (frame.runnerActivities.length) counts.runner_activity += 1;
    }
  }
  frames.causes = counts;
  return counts;
}

export function smoothness(renderer, captures) {
  const hardware = typeof renderer === 'string' && /Direct3D11|D3D11/i.test(renderer)
    && !/swiftshader|software|llvmpipe|softpipe|lavapipe|basic render|warp/i.test(renderer);
  const measured = ['batch', 'map'].every(page => captures.some(c => c.page === page))
    && captures.every(c => c.frames > 0 && c.hidden === 0 && !c.longTasksUnavailable);
  if (!hardware || !measured) return 'not_a_smoothness_verdict';
  return captures.some(c => c.over100 > 0) ? 'slow_frames_observed' : 'no_slow_frames_in_captures';
}

export async function rendererString(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') ?? document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  });
}

export async function drop(page, studio, files, activities = []) {
  await runnerActivity(activities, 'page_goto',
    () => page.goto(`${studio}/studio/add-files`, { waitUntil: 'domcontentloaded' }), 'batch');
  await page.locator('input[type=file]').setInputFiles(files.map(file => file.path));
  await page.getByRole('combobox').selectOption('create');
  await page.getByRole('textbox', { name: 'New case name' }).fill('Kit drop test_only');
  const at = Date.now();
  await page.getByRole('button', { name: /^Add \d+ files?$/ }).click();
  await page.waitForURL(/cases\//);
  return { at, caseId: page.url().match(/cases\/([^/?]+)/)[1] };
}

export async function observeRow(page, file, item) {
  file.state = item.state;
  file.parts = [item.partsDone, item.partsPlanned];
  const rows = page.getByRole('region', { name: 'Files in this batch', exact: true }).locator('tbody tr');
  const matches = await rows.evaluateAll((rows, name) => rows.flatMap((row, index) =>
    row.querySelector('td:first-child button.ul-table__rowbtn')?.textContent === name ? [index] : []), item.name);
  let kind = 'one';
  if (matches.length !== 1) kind = matches.length ? 'many' : 'none';
  file.rowMatch = { kind, count: matches.length };
  if (matches.length !== 1) return;
  const row = rows.nth(matches[0]);
  file.rowWords = await row.innerText(); // Exact shown words, separate from the last intake poll.
  if ((item.layoutQuestion || item.placement === 'needs_answer')
    && await row.getByRole('button', { name: 'View layout', exact: true }).isVisible()) {
    file.layoutQuestionOffered ??= Date.now();
    if (await page.getByText(`Layout · ${item.name}`, { exact: true }).isVisible()) {
      file.layoutQuestionShown ??= Date.now();
    }
  }
}

export function uploadWatch(page, result) {
  let pending = null;
  const consoleError = message => {
    if (message.type() === 'error') result.consoleErrors.push({ at: Date.now(), kind: 'console',
      words: message.text() });
  };
  const pageError = error => result.consoleErrors.push({ at: Date.now(), kind: 'pageerror',
    words: error.message });
  page.on('console', consoleError);
  page.on('pageerror', pageError);
  const sample = async () => {
    const snapshot = { at: Date.now(), rows: null };
    try {
      snapshot.rows = await page.getByRole('region', { name: 'Files being retained', exact: true })
        .locator('tbody tr').evaluateAll(rows => rows.map((row, index) => ({
          file: row.querySelector('td:first-child')?.textContent ?? null,
          phase: row.closest('[data-upload-phases]')?.getAttribute('data-upload-phases')?.split(' ')[index] ?? null,
          words: row.innerText,
        })));
    } catch (error) { snapshot.error = { name: error.name, message: error.message.slice(0, 300) }; }
    result.uploadRows.push(snapshot);
  };
  // Independent of intake/API polls and layout/map waits: uploads need not have enrolled an item to be observed.
  const timer = setInterval(() => {
    if (!pending) pending = sample().finally(() => { pending = null; });
  }, 10000);
  return async () => {
    clearInterval(timer);
    await pending;
    await sample();
    page.off('console', consoleError);
    page.off('pageerror', pageError);
  };
}

export function captureWatch(page, map, frames, sample = () => {}) {
  let pending = null;
  const timer = setInterval(() => {
    if (pending) return;
    pending = Promise.all([captureFrames(page, 'batch', frames.batch), captureFrames(map, 'map', frames.map)])
      .then(sample).finally(() => { pending = null; });
  }, 10000);
  return async () => { clearInterval(timer); await pending; };
}

export async function captureFrames(page, name, captures) {
  if (page.isClosed() || page.url() === 'about:blank') return;
  const frames = await page.evaluate(() => {
    const state = window.__rehearsal;
    if (!state) return null;
    window.__rehearsalFlush?.();
    const snapshot = { ...state, to: Date.now() };
    Object.assign(state, { from: snapshot.to, frames: 0, maxMs: null, over100: 0,
      longestTaskMs: null, hidden: 0, slowFrames: [], animationFrames: [] });
    return snapshot;
  }).catch(() => null);
  if (frames) captures.push({ page: name, url: page.url(), ...frames });
}

export async function mapMoment(page, studio, pkg, out, name, captures, activities = []) {
  await captureFrames(page, 'map', captures);
  await runnerActivity(activities, 'page_goto',
    () => page.goto(`${studio}/studio/areas/${pkg.areaId}?package=${pkg.packageId}`,
      { waitUntil: 'domcontentloaded' }), 'map');
  await page.locator('canvas').first().waitFor({ timeout: 15000 });
  await page.waitForFunction(packageId => Array.from(document.querySelectorAll('[data-drawn-packages]'))
    .some(node => (node.getAttribute('data-drawn-packages') ?? '').split(/\s+/).includes(packageId)),
  pkg.packageId, { timeout: 15000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const moment = { at: Date.now(), packageId: pkg.packageId, renderer: await rendererString(page),
    words: await page.locator('body').innerText(), screenshot: `${name}.png` };
  await runnerActivity(activities, 'screenshot', () => page.screenshot({ path: `${out}/${name}.png` }), 'map');
  return moment;
}
