import { chromium } from '@playwright/test';
import { save } from './audit.mjs';

// Part B4: the Niagara area opened in the Studio (dev server on 5188, proxied to the rehearsal API) as the officer
// opens it, in the Playwright Chromium already installed. Records the status line, any banner, the display reads
// the page made and three screenshots.
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const url = `http://127.0.0.1:5188/studio/areas/${areaId}`;
const evidence = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/reh4';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const reads = [];
const started = new Map();
page.on('request', request => {
  if (request.url().includes('/api/v1/')) started.set(request, performance.now());
});
page.on('requestfinished', async request => {
  if (!request.url().includes('/api/v1/')) return;
  const response = await request.response();
  const path = new URL(request.url()).pathname.replace(areaId, '{areaId}');
  reads.push({ path, query: new URL(request.url()).search.slice(0, 110) || null, status: response?.status() ?? null,
    seconds: Number(((performance.now() - started.get(request)) / 1000).toFixed(3)) });
});
page.on('requestfailed', request => {
  if (request.url().includes('/api/v1/')) reads.push({ path: new URL(request.url()).pathname, failed: true });
});
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));

async function look(label, shot) {
  const status = await page.locator('[role="status"]').allInnerTexts();
  const banners = await page.locator('[role="alert"], [class*="banner"]').allInnerTexts();
  const heading = await page.locator('h1, h2').allInnerTexts();
  await page.screenshot({ path: `${evidence}/${shot}`, type: 'png' });
  return { label, at: new Date().toISOString(), url: page.url().replace(areaId, '{areaId}'),
    statusLines: status.map(text => text.trim()).filter(Boolean),
    banners: banners.map(text => text.trim().slice(0, 200)),
    headings: heading.map(text => text.trim().slice(0, 120)).slice(0, 6), screenshot: shot,
    readsSoFar: reads.length };
}

const out = { at: new Date().toISOString(), url: url.replace(areaId, '{areaId}'), route: '/studio/areas/:areaId',
  browser: `Chromium ${browser.version()} headless`, viewport: '1440x900' };
const begin = performance.now();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
out.loadSeconds = Number(((performance.now() - begin) / 1000).toFixed(1));
const canvas = page.locator('canvas').first();
out.canvas = await canvas.count() ? await canvas.boundingBox() : null;
out.open = await look('opened', 'map-1.png');
out.open.reads = [...reads];
if (out.canvas) {
  const x = out.canvas.x + out.canvas.width / 2, y = out.canvas.y + out.canvas.height / 2;
  await page.mouse.move(x, y);
  const before = reads.length;
  for (let tick = 0; tick < 8; tick++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2000);
  out.zoomed = await look('after 8 wheel ticks in, 2 s', 'map-2.png');
  out.zoomed.reads = reads.slice(before);
  const beforeClick = reads.length;
  await page.mouse.click(x, y);
  await page.waitForTimeout(1500);
  out.clicked = await look('after a click at the canvas centre', 'map-3.png');
  out.clicked.inspector = await page.locator('text=Identifier').count() > 0;
  out.clicked.reads = reads.slice(beforeClick);
}
out.windowReads = reads.filter(read => read.path.endsWith('/display-window'));
out.pageErrors = errors;
await browser.close();
save('part-b-map.json', out);
console.log(JSON.stringify(out, null, 1));
