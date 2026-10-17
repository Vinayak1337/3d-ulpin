import { chromium } from '@playwright/test';
import { save } from './audit.mjs';

// REH6 Part B3, second session: map.mjs read the line 3 s after each zoom, and its window reads show that the view
// on screen had not always been read by then (one read during the 8 ticks, one during three zoom rounds). This
// session zooms the same way but, at each stage, waits until no window read has started or finished for 6 s (at
// most 90 s), then records the line, the scale, and the bounds of every window read (width and height in metres).
// Screenshot: map-5.png at the closest stage.
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

/** Waits until no window read has started or finished for 6 s, at most 90 s; returns the seconds waited. */
async function quiet() {
  const begin = performance.now();
  await page.waitForTimeout(1000);
  while (performance.now() - lastActivity < 6000 && performance.now() - begin < 90000) {
    await page.waitForTimeout(500);
  }
  return Number(((performance.now() - begin) / 1000).toFixed(1));
}

async function stage(label, mark) {
  const waited = await quiet();
  return { label, waitedSeconds: waited, statusLines: await texts('[role="status"]'),
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
  why: 'map.mjs read the line before the view on screen had been read; this waits for the reads to stop' };
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
const box = await page.locator('canvas').first().boundingBox();
const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
out.stages = [await stage('opened', 0)];
for (const [label, ticks] of [['8 ticks in at the centre', 8], ['6 more', 6], ['6 more', 6], ['6 more', 6]]) {
  const mark = reads.length;
  await wheel(x, y, ticks);
  out.stages.push(await stage(label, mark));
}
await page.screenshot({ path: `${evidence}/map-5.png`, type: 'png' });
out.screenshot = 'map-5.png';
out.pageErrors = errors;
await browser.close();
save('part-b-map-settle.json', out);
console.log(JSON.stringify(out, null, 1));
