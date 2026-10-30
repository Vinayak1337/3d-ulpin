// Ported from S1.3 dress.mjs recorder, install.js drop selectors and b-under-load.js map waits.
import { win32 } from 'node:path';
import { readFile } from 'node:fs/promises';
import { lockWaitSummary, nearestCpu, runnerActivity } from './timing.mjs';

export const observation = name => ({ name, retained: null, layoutQuestionShown: null, layoutQuestionOffered: null,
  firstPartOnMap: null, lastPartOnMap: null, words: null, rowWords: null, state: null, placement: null,
  parts: null, partsPlanned: null, partsDone: null, firstPartAt: null, allPartsAt: null,
  firstPartSeconds: null, allPartsSeconds: null, lastPollAt: null, timeline: [],
  itemReason: 'No matching intake item observed.' });

export function batchItems(files, items) {
  return files.flatMap(file => {
    const item = items.find(item => item.name === file.name && !item.parentItemId && !item.archiveItemId);
    if (!item) return [];
    const members = items.filter(child => child.archiveItemId === item.itemId || child.parentItemId === item.itemId
      || file.members.some(member => member.itemId === child.itemId));
    return [[file, item], ...members.map(child => {
      let member = file.members.find(row => row.itemId === child.itemId);
      if (!member) file.members.push(member = { ...observation(child.name), itemId: child.itemId });
      return [member, child];
    })];
  });
}

/**
 * A converted layer is its own root item; its parent's omissions read names its source (intake-native-derivative.ts).
 * Each loose root so named becomes a member of that kit file under a generic name: the parent name, derived, ordinal.
 */
export async function claimDerived(files, items, readLayers) {
  const known = new Set(files.flatMap(file => file.members.map(member => member.itemId)));
  const names = new Set(files.map(file => file.name));
  const loose = items.filter(item => item.sourceId && !item.parentItemId && !item.archiveItemId
    && !names.has(item.name) && !known.has(item.itemId));
  if (!loose.length) return;
  for (const file of files) {
    const parent = items.find(item => item.name === file.name && !item.parentItemId && !item.archiveItemId);
    if (!parent) continue;
    for (const layer of await readLayers(parent)) {
      const child = loose.find(item => item.sourceId === layer.derivativeSourceId && !known.has(item.itemId));
      if (!child) continue;
      file.members.push({ ...observation(`${file.name} derived ${layer.ordinal + 1}`), itemId: child.itemId });
      known.add(child.itemId);
    }
  }
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
    requestFailures: [], requestFailureSummary: [], expectedStreamEnds: [], expectedStreamEndCount: 0,
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

// Only published route literals are safe; unknown segments can be opaque tokens or file names.
const routePaths = Object.keys(JSON.parse(await readFile(new URL('../../docs/api/openapi.json', import.meta.url),
  'utf8')).paths);
const routeWords = new Set(['studio', 'assets', 'work', 'add-files', ...routePaths.flatMap(path =>
  path.split('/').filter(segment => /^[a-z][a-z0-9-]*$/.test(segment)))]);

export function requestLocation(value) {
  try {
    const url = new URL(value);
    const template = routePaths.find(route => {
      const parts = route.split('/'), actual = url.pathname.split('/');
      return parts.length === actual.length && parts.every((part, index) =>
        /^\{\w+\}$/.test(part) || part === actual[index]);
    });
    const path = template ? template.replace(/\{(\w+)\}/g, ':$1') : url.pathname.split('/').map(segment => {
      if (!segment) return '';
      const text = decodeURIComponent(segment);
      if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)) return ':uuid';
      if (/^\d+$/.test(text)) return ':id';
      if (/^[0-9a-f]{8,}$/i.test(text)) return ':hash';
      return routeWords.has(text) ? text : ':value';
    }).join('/');
    const queryKeys = [...new Set(url.searchParams.keys())].sort();
    return { path, queryKeys };
  } catch { return { path: ':unknown', queryKeys: [] }; }
}

function recordRequest(result, page, name, request, status, kind) {
  const method = request.method();
  const row = { at: Date.now(), kind, method: /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)
    ? method : 'OTHER', ...requestLocation(request.url()), status, code: null, page: name,
    pagePath: requestLocation(page.url()).path };
  result.requestFailures.push(row);
  let summary = result.requestFailureSummary.find(entry => entry.path === row.path && entry.status === status);
  if (!summary) result.requestFailureSummary.push(summary = { path: row.path, status, count: 0 });
  summary.count += 1;
  return row;
}

function consoleWatch(page, name, result) {
  const responses = new Map(), consoles = new Map();
  const consoleError = message => {
    if (message.type() !== 'error') return;
    const url = message.location?.()?.url || message.text().match(/https?:\/\/[^\s)]+/)?.[0];
    const row = { at: Date.now(), kind: 'console', page: name,
      words: message.text().replace(/https?:\/\/[^\s)]+/g, value => requestLocation(value).path),
      ...requestLocation(url), status: responses.get(url)?.shift() ?? null };
    result.consoleErrors.push(row);
    if (url && row.status === null) {
      if (!consoles.has(url)) consoles.set(url, []);
      consoles.get(url).push(row);
    }
  };
  const pageError = error => result.consoleErrors.push({ at: Date.now(), kind: 'pageerror', page: name,
    words: error.message });
  page.on('console', consoleError);
  page.on('pageerror', pageError);
  return {
    response(url, status) {
      const row = consoles.get(url)?.shift();
      if (row) row.status = status;
      else {
        if (!responses.has(url)) responses.set(url, []);
        responses.get(url).push(status);
      }
    },
    stop() {
      page.off('console', consoleError);
      page.off('pageerror', pageError);
      responses.clear();
      consoles.clear();
    },
  };
}

export function requestWatch(page, name, result) {
  const pending = new Set(), logged = consoleWatch(page, name, result);
  const response = response => {
    if (response.status() < 400) return;
    const request = response.request();
    const row = recordRequest(result, page, name, request, response.status(), 'response');
    logged.response(request.url(), row.status);
    // Only the structured error code survives parsing; no messages, details, headers or payloads are retained.
    const task = Promise.resolve().then(() => response.json()).then(body => {
      const code = body?.error?.code ?? body?.code;
      if (typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/.test(code)) row.code = code;
    }).catch(() => {}).finally(() => pending.delete(task));
    pending.add(task);
  };
  const failed = request => {
    const location = requestLocation(request.url());
    const failure = request.failure?.()?.errorText ?? '';
    const events = /^\/api\/v1\/ingestion\/cases\/[^/]+\/events$/.test(location.path);
    if (events && /^(net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled|canceled|Load request cancelled)$/i.test(failure)) {
      result.expectedStreamEnds.push({ at: Date.now(), page: name, ...location, kind: 'expected_stream_end' });
      result.expectedStreamEndCount += 1;
    } else recordRequest(result, page, name, request, null, 'requestfailed');
  };
  page.on('response', response);
  page.on('requestfailed', failed);
  return async () => {
    logged.stop();
    page.off('response', response);
    page.off('requestfailed', failed);
    await Promise.all(pending);
  };
}

export function uploadWatch(page, result) {
  let pending = null;
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

/** A package is drawn by its own features; a surface item once one of its parts is in the scene (useSurfaceLayer),
 * opened with its batch, as an area of its own has a site of its own (S9.4d). */
export async function mapMoment(page, studio, target, out, name, captures, activities = []) {
  const [attribute, id] = target.packageId ? ['data-drawn-packages', target.packageId]
    : ['data-drawn-items', target.itemId];
  const query = target.packageId ? `?package=${target.packageId}` : target.caseId ? `?case=${target.caseId}` : '';
  await captureFrames(page, 'map', captures);
  await runnerActivity(activities, 'page_goto',
    () => page.goto(`${studio}/studio/areas/${target.areaId}${query}`, { waitUntil: 'domcontentloaded' }), 'map');
  await page.locator('canvas').first().waitFor({ timeout: 15000 });
  await page.waitForFunction(([attribute, id]) => Array.from(document.querySelectorAll(`[${attribute}]`))
    .some(node => (node.getAttribute(attribute) ?? '').split(/\s+/).includes(id)),
  [attribute, id], { timeout: 15000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const moment = { at: Date.now(), ...(target.packageId ? { packageId: id } : { itemId: id }),
    renderer: await rendererString(page), words: await page.locator('body').innerText(), screenshot: `${name}.png` };
  await runnerActivity(activities, 'screenshot', () => page.screenshot({ path: `${out}/${name}.png` }), 'map');
  return moment;
}
