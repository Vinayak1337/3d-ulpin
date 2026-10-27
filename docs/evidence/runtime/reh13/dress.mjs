import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Playwright as installed in the rehearsal's serving checkout (this worktree has no node_modules).
const { chromium } = createRequire('E:/Projects/ulpin-wt/ulpin-reh-02/package.json')('@playwright/test');

// REH10's presenter reused for REH13: one Chromium page at 1440x900 on the rehearsal's Studio (dev server on
// 5188, API 127.0.0.1:21026), with Playwright's own video and, on every page, a frame recorder
// (requestAnimationFrame deltas and PerformanceObserver long tasks, epoch milliseconds). The presenter's steps are
// sent one at a time to a local control port as small scripts run against `page`; every step, its result, every API
// exchange, page error and console error is appended to the scratch log, so the run can be read back step by step.
// Nothing here writes to the API by itself: only the Studio's own buttons do.
const scratch = 'E:/BhuAayam-data/task-data/reh13';
const studio = 'http://127.0.0.1:5188';
const control = 5399;
mkdirSync(`${scratch}/video`, { recursive: true });
mkdirSync(`${scratch}/shots`, { recursive: true });
const log = (kind, value) => appendFileSync(`${scratch}/dress-log.jsonl`,
  `${JSON.stringify({ at: Date.now(), ...value, kind })}\n`);

function recorder() {
  const state = { frames: [], tasks: [] };
  window.__reh10 = state;
  let last = performance.now();
  const tick = now => {
    state.frames.push([Math.round(performance.timeOrigin + now), Math.round(now - last)]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.tasks.push([Math.round(performance.timeOrigin + entry.startTime), Math.round(entry.duration)]);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { state.tasks = null; }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: `${scratch}/video`, size: { width: 1440, height: 900 } } });
await context.addInitScript(recorder);
const pages = [];
const marks = [];
function watch(page, name) {
  pages.push({ name, page });
  const started = new Map();
  page.on('request', request => {
    if (request.url().includes('/api/')) started.set(request, Date.now());
  });
  page.on('requestfinished', async request => {
    if (!started.has(request)) return;
    const response = await request.response();
    const url = new URL(request.url());
    log('api', { page: name, method: request.method(), path: url.pathname, query: url.search.slice(0, 200),
      status: response?.status() ?? null, ms: Date.now() - started.get(request) });
  });
  page.on('requestfailed', request => {
    if (!started.has(request)) return;
    log('api-failed', { page: name, method: request.method(), path: new URL(request.url()).pathname,
      error: request.failure()?.errorText ?? null, ms: Date.now() - started.get(request) });
  });
  page.on('pageerror', error => log('pageerror', { page: name, message: String(error.message).slice(0, 400) }));
  page.on('console', message => {
    if (message.type() === 'error') log('console-error', { page: name, text: message.text().slice(0, 400) });
  });
}
const page = await context.newPage();
watch(page, 'main');
context.on('page', next => { if (!pages.some(entry => entry.page === next)) watch(next, `page-${pages.length}`); });

const helpers = {
  page, context, pages, marks, scratch,
  mark(label, extra = {}) { const value = { ...extra, at: Date.now(), label }; marks.push(value); log('mark', value);
    return value; },
  async shot(name, target = page) { const path = `${scratch}/shots/${name}.png`;
    await target.screenshot({ path, type: 'png' }); log('shot', { name }); return path; },
  async text(target = page) { return (await target.locator('body').innerText()).replace(/[ \t]+/g, ' '); },
  /** Frame figures between two epoch times on a page: count, largest, over 50 and over 100 ms, long tasks. */
  async frames(from, to = Date.now(), target = page) {
    return target.evaluate(([from, to]) => {
      const state = window.__reh10;
      const frames = state.frames.filter(([at]) => at >= from && at <= to).map(([, ms]) => ms);
      const tasks = state.tasks?.filter(([at]) => at >= from && at <= to) ?? null;
      return { from, to, frames: frames.length, largestMs: frames.length ? Math.max(...frames) : null,
        over50: frames.filter(ms => ms > 50).length, over100: frames.filter(ms => ms > 100).length,
        longTasks: tasks?.length ?? null, longestTaskMs: tasks?.length ? Math.max(...tasks.map(([, ms]) => ms)) : null,
        worst: state.frames.filter(([at, ms]) => at >= from && at <= to && ms > 100).slice(0, 40) };
    }, [from, to]);
  },
};

const AsyncFunction = (async () => {}).constructor;
const server = createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', async () => {
    const { step, code } = JSON.parse(body || '{}');
    log('step', { step, code: code.slice(0, 2000) });
    let result;
    try {
      result = { ok: true, value: await new AsyncFunction('h', `const { page, context } = h;\n${code}`)(helpers) };
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error).slice(0, 1500) };
    }
    log('result', { step, ...result, value: JSON.stringify(result.value ?? null).slice(0, 4000) });
    if (step === 'close') {
      await context.close();
      await browser.close();
      server.close();
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  });
});
server.listen(control, '127.0.0.1');
log('ready', { browser: `Chromium ${browser.version()} headless`, viewport: '1440x900', studio });
await page.goto(`${studio}/studio/work`, { waitUntil: 'domcontentloaded' });
console.log(`ready on ${control}`);
