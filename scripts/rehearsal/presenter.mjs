// Ported from S1.3 dress.mjs recorder, install.js drop selectors and b-under-load.js map waits.
import { win32 } from 'node:path';

const observation = name => ({ name, retained: null, layoutQuestionShown: null, layoutQuestionOffered: null,
  firstPartOnMap: null, lastPartOnMap: null, words: null, state: null, parts: null });

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

export function newResult(runtime, files) {
  return { version: 'kit-drop/1', runtime, started: Date.now(), caseId: null, renderer: null,
    files: files.map(file => ({ ...file, ...observation(file.path ? win32.basename(file.path) : null), members: [] })),
    frames: { batch: [], map: [] },
    jobs: null, process: { samples: [], queue: [], exitsBefore: null, exitsAfter: null }, status: 'incomplete' };
}

export function recorder() {
  const state = window.__rehearsal = { from: Date.now(), frames: 0, maxMs: null, over100: 0,
    longestTaskMs: null, hidden: 0 };
  let last = performance.now();
  const tick = now => {
    const ms = Math.round(now - last);
    last = now;
    state.frames += 1;
    state.maxMs = Math.max(state.maxMs ?? 0, ms);
    if (ms > 100) state.over100 += 1;
    if (document.hidden) state.hidden += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.longestTaskMs = Math.max(state.longestTaskMs ?? 0, Math.round(entry.duration));
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { state.longTasksUnavailable = true; }
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

export async function drop(page, studio, files) {
  await page.goto(`${studio}/studio/add-files`, { waitUntil: 'domcontentloaded' });
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
  file.words = await row.innerText(); // Exact shown words, not reconstructed from API fields.
  if ((item.layoutQuestion || item.placement === 'needs_answer')
    && await row.getByRole('button', { name: 'View layout', exact: true }).isVisible()) {
    file.layoutQuestionOffered ??= Date.now();
    if (await page.getByText(`Layout · ${item.name}`, { exact: true }).isVisible()) {
      file.layoutQuestionShown ??= Date.now();
    }
  }
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
    const snapshot = { ...state, to: Date.now() };
    Object.assign(state, { from: snapshot.to, frames: 0, maxMs: null, over100: 0, longestTaskMs: null, hidden: 0 });
    return snapshot;
  }).catch(() => null);
  if (frames) captures.push({ page: name, url: page.url(), ...frames });
}

export async function mapMoment(page, studio, pkg, out, name, captures) {
  await captureFrames(page, 'map', captures);
  await page.goto(`${studio}/studio/areas/${pkg.areaId}?package=${pkg.packageId}`,
    { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ timeout: 15000 });
  await page.getByText(/features · unrecorded proposals/).waitFor({ timeout: 15000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const moment = { at: Date.now(), packageId: pkg.packageId, renderer: await rendererString(page),
    words: await page.locator('body').innerText(), screenshot: `${name}.png` };
  await page.screenshot({ path: `${out}/${name}.png` });
  return moment;
}
