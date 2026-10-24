import type { Browser, CDPSession, Page } from '@playwright/test';

type Request = { id: string; method: string; path: string; startedMs: number; status?: number; endedMs?: number;
  bytes?: number; failure?: string };
const BOUND_MS = 90000;
// Long tasks are the main-thread blocks the browser itself reports; 50 ms is its own threshold.
const LONG_TASKS = `window.__longTasks = [];
  new PerformanceObserver(list => { for (const entry of list.getEntries()) {
    window.__longTasks.push({ startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) });
  } }).observe({ type: 'longtask', buffered: true });`;

/** Every API request of one page visit, with status, milliseconds from navigation and transferred bytes. */
async function recordRequests(session: CDPSession, requests: Map<string, Request>, origin: { at: number }) {
  await session.send('Network.enable');
  const ms = (timestamp: number) => Math.round((timestamp - origin.at) * 1000);
  session.on('Network.requestWillBeSent', event => {
    if (event.type === 'Document' && !origin.at) origin.at = event.timestamp;
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith('/api/')) return;
    requests.set(event.requestId, { id: event.requestId, method: event.request.method, path: url.pathname + url.search,
      startedMs: ms(event.timestamp) });
  });
  session.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  session.on('Network.loadingFinished', event => {
    const request = requests.get(event.requestId);
    if (request) Object.assign(request, { endedMs: ms(event.timestamp), bytes: event.encodedDataLength });
  });
  session.on('Network.loadingFailed', event => {
    const request = requests.get(event.requestId);
    if (request) Object.assign(request, { endedMs: ms(event.timestamp), failure: event.errorText });
  });
}

/** Scene draw progress read from the engine the map exposes; polled every 100 ms from navigation. */
async function drawProgress(page: Page, expected: number) {
  return page.evaluate(async ({ expected, bound }) => {
    const engine = () => (window as any).__ulpinScene;
    const now = () => Math.round(performance.now());
    let first: number | null = null;
    let whole: number | null = null;
    let last = { count: 0, pending: 0 };
    while (now() < bound && whole === null) {
      const drawn = engine()?.drawnBuildings();
      if (drawn) last = { count: drawn.count, pending: drawn.pending };
      if (first === null && last.count > 0) first = now();
      if (last.count >= expected && last.pending === 0) whole = now();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { firstFootprintsMs: first, wholeAreaMs: whole, drawnBuildings: last.count, pending: last.pending };
  }, { expected, bound: BOUND_MS });
}

function rendererOf(page: Page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? String(gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  });
}

/** Open one area screen cold and report what it requested, when it drew and how long the page was blocked. */
export async function openArea(browser: Browser, url: string, areaId: string, expected: number, screenshot: string) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript('window.__name = value => value;');
  await page.addInitScript(LONG_TASKS);
  const console: string[] = [];
  page.on('console', message => { if (message.type() === 'error') console.push(message.text()); });
  page.on('pageerror', error => console.push(error.message));
  const requests = new Map<string, Request>();
  const origin = { at: 0 };
  await recordRequests(await page.context().newCDPSession(page), requests, origin);
  await page.goto(`${url}studio/areas/${areaId}`, { waitUntil: 'commit' });
  const draw = await drawProgress(page, expected);
  await page.waitForTimeout(1500);
  const longTasks: { startMs: number; durationMs: number }[] = await page.evaluate(() => (window as any).__longTasks);
  const words = await page.locator('main').innerText().catch(() => '');
  await page.screenshot({ path: screenshot });
  const result = { areaId, expectedBuildings: expected, renderer: await rendererOf(page), ...draw,
    longestTaskMs: Math.max(0, ...longTasks.map(task => task.durationMs)),
    tasksOver200Ms: longTasks.filter(task => task.durationMs > 200), requests: [...requests.values()].map(request => ({
      ...request, id: undefined, durationMs: request.endedMs === undefined ? null : request.endedMs - request.startedMs,
    })), mainWords: words.slice(0, 2000), console: console.slice(0, 20), screenshot };
  await page.close();
  return result;
}
