import { chromium } from '@playwright/test';
import { save } from './audit.mjs';

// REH6 Part B3, third session: map-settle.mjs waited only until 6 s had passed since the last window read, which
// was 1 s after each zoom since no read started, so it cannot tell a late read from none. This session waits at
// least 20 s after each zoom and until no window read has started or finished for 8 s (at most 120 s); then it
// records the line, the scale, every window read's bounds, and whether the canvas still repaints (two screenshots
// 1 s apart, equal or not): the reader reads the view 300 ms after the last rendered frame (areaWindow.ts:88-90).
// Screenshot: map-6.png at the closest stage.
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const url = `http://127.0.0.1:5188/studio/areas/${areaId}`;
const evidence = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/reh6';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const reads = [];
const started = new Map();
let lastActivity = performance.now();
const isWindow = request => request.url().includes('/display-window');
page.on('request', request => {
  if (!isWindow(request)) return;
  started.set(request, performance.now());
  lastActivity = performance.now();
});
page.on('requestfinished', async request => {
  if (!isWindow(request)) return;
  lastActivity = performance.now();
  const response = await request.response();
  const body = await response?.json().catch(() => null);
  const data = body?.data ?? body;
  const query = new URL(request.url()).searchParams;
  const [minX, minY, maxX, maxY] = ['minX', 'minY', 'maxX', 'maxY'].map(key => Number(query.get(key)));
  reads.push({ status: response?.status() ?? null, widthM: Math.round(maxX - minX), heightM: Math.round(maxY - minY),
    centre: [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)], after: query.has('after'),
    features: data?.features?.length ?? null, next: data?.next ? 'set' : null,
    seconds: Number(((performance.now() - started.get(request)) / 1000).toFixed(3)) });
});
page.on('requestfailed', request => {
  if (!isWindow(request)) return;
  lastActivity = performance.now();
  reads.push({ failed: request.failure()?.errorText ?? true });
});
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
const texts = async selector => (await page.locator(selector).allInnerTexts())
  .map(text => text.trim().replace(/\s+/g, ' ')).filter(Boolean);

/** Waits at least 20 s, and until no window read has started or finished for 8 s, at most 120 s. */
async function quiet() {
  const begin = performance.now();
  await page.waitForTimeout(20000);
  while (performance.now() - lastActivity < 8000 && performance.now() - begin < 120000) {
    await page.waitForTimeout(500);
  }
  return Number(((performance.now() - begin) / 1000).toFixed(1));
}

async function stage(label, mark) {
  const waited = await quiet();
  const first = await page.locator('canvas').first().screenshot();
  await page.waitForTimeout(1000);
  const repaints = !first.equals(await page.locator('canvas').first().screenshot());
  return { label, waitedSeconds: waited, canvasStillChanging: repaints, statusLines: await texts('[role="status"]'),
    scale: await texts('[class*="readout"]'), reads: reads.slice(mark) };
}

async function wheel(x, y, ticks) {
  await page.mouse.move(x, y);
  for (let tick = 0; tick < ticks; tick++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
}

const out = { at: new Date().toISOString(), browser: `Chromium ${browser.version()} headless`, viewport: '1440x900',
  why: 'map-settle.mjs could not tell a late read from none; this waits at least 20 s per stage' };
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
const box = await page.locator('canvas').first().boundingBox();
const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
out.stages = [await stage('opened', 0)];
for (const [label, ticks] of [['8 ticks in at the centre', 8], ['6 more', 6], ['6 more', 6], ['6 more', 6]]) {
  const mark = reads.length;
  await wheel(x, y, ticks);
  out.stages.push(await stage(label, mark));
}
await page.screenshot({ path: `${evidence}/map-6.png`, type: 'png' });
out.screenshot = 'map-6.png';
out.pageErrors = errors;
await browser.close();
save('part-b-map-wait.json', out);
console.log(JSON.stringify(out, null, 1));
