import { chromium } from '@playwright/test';
import { save } from './audit.mjs';

// REH4's map.mjs for REH5 Part B4: the Niagara area opened in the Studio (dev server on 5188, proxied to the
// rehearsal API) as the officer opens it, in the Playwright Chromium already installed. Records the status line, any
// banner or the empty sentence, the display reads with their seconds, a picked building's inspector and the
// register its link opens, with four screenshots.
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const url = `http://127.0.0.1:5188/studio/areas/${areaId}`;
const evidence = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/reh5';
const empty = 'This area has no buildings recorded or proposed to draw yet.';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const reads = [];
const started = new Map();
const plain = text => text.replace(areaId, '{areaId}');
page.on('request', request => {
  if (request.url().includes('/api/v1/')) started.set(request, performance.now());
});
page.on('requestfinished', async request => {
  if (!request.url().includes('/api/v1/')) return;
  const response = await request.response();
  const body = request.url().includes('/display-window') ? await response?.json().catch(() => null) : null;
  reads.push({ path: plain(new URL(request.url()).pathname), query: new URL(request.url()).search.slice(0, 110) || null,
    status: response?.status() ?? null, features: body?.data?.features?.length ?? body?.features?.length,
    seconds: Number(((performance.now() - started.get(request)) / 1000).toFixed(3)) });
});
page.on('requestfailed', request => {
  if (request.url().includes('/api/v1/')) {
    reads.push({ path: plain(new URL(request.url()).pathname), failed: request.failure()?.errorText ?? true });
  }
});
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));

async function look(label, shot) {
  const status = await page.locator('[role="status"]').allInnerTexts();
  const banners = await page.locator('[role="alert"], [class*="banner"]').allInnerTexts();
  const heading = await page.locator('h1, h2').allInnerTexts();
  await page.screenshot({ path: `${evidence}/${shot}`, type: 'png' });
  return { label, at: new Date().toISOString(), url: plain(page.url()),
    statusLines: status.map(text => text.trim()).filter(Boolean),
    banners: banners.map(text => text.trim().slice(0, 200)).filter(Boolean),
    emptySentence: await page.getByText(empty).count() > 0,
    headings: heading.map(text => text.trim().slice(0, 120)).slice(0, 6), screenshot: shot,
    readsSoFar: reads.length };
}

const windowReads = list => {
  const rows = list.filter(read => read.path.endsWith('/display-window'));
  return { count: rows.length, statuses: [...new Set(rows.map(read => read.status ?? 'failed'))],
    seconds: rows.map(read => read.seconds ?? null), features: rows.map(read => read.features ?? null) };
};

const out = { at: new Date().toISOString(), url: plain(url), route: '/studio/areas/:areaId',
  browser: `Chromium ${browser.version()} headless`, viewport: '1440x900' };
const begin = performance.now();
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(3000);
out.loadSeconds = Number(((performance.now() - begin) / 1000).toFixed(1));
const canvas = page.locator('canvas').first();
out.canvas = await canvas.count() ? await canvas.boundingBox() : null;
out.open = await look('opened', 'map-1.png');
out.open.reads = [...reads];
out.open.windowReads = windowReads(reads);
if (out.canvas) {
  const { x: left, y: top, width, height } = out.canvas;
  const x = left + width / 2, y = top + height / 2;
  await page.mouse.move(x, y);
  const before = reads.length;
  for (let tick = 0; tick < 8; tick++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => undefined);
  out.zoomed = await look('after 8 wheel ticks in over the canvas centre, 2 s', 'map-2.png');
  out.zoomed.reads = reads.slice(before);
  out.zoomed.windowReads = windowReads(out.zoomed.reads);
  // A drawn building is found by clicking a grid over the canvas, centre first, until the inspector shows its
  // "Open register" link; the scene exposes no screen positions to the page.
  const beforeClick = reads.length;
  const link = page.getByRole('link', { name: 'Open register' });
  const points = [];
  for (let row = 1; row < 12; row++) {
    for (let column = 1; column < 16; column++) points.push([left + width * column / 16, top + height * row / 12]);
  }
  points.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
  let clicks = 0;
  for (const [px, py] of points) {
    clicks++;
    await page.mouse.click(px, py);
    await page.waitForTimeout(250);
    if (await link.count()) break;
  }
  await page.waitForTimeout(1000);
  out.clicked = await look('after clicks on a grid, centre first, until a building is picked', 'map-3.png');
  out.clicked.clicks = clicks;
  out.clicked.inspector = await link.count() > 0;
  if (out.clicked.inspector) {
    const identifier = page.locator('dt', { hasText: 'Identifier' }).locator('xpath=following-sibling::dd[1]');
    out.clicked.identifier = (await identifier.allInnerTexts()).map(text => text.trim()).join(' ') || null;
    out.clicked.inspectorTitle = (await page.locator('[class*="inspector"] h2, [class*="inspector"] h3')
      .allInnerTexts()).map(text => text.trim()).slice(0, 3);
    out.clicked.registerHref = plain((await link.first().getAttribute('href')) ?? '');
  }
  out.clicked.reads = reads.slice(beforeClick);
  if (out.clicked.inspector) {
    const beforeRegister = reads.length;
    await link.first().click();
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    out.register = await look('the register the link opens', 'map-4.png');
    out.register.text = (await page.locator('main').allInnerTexts()).join('\n').trim().slice(0, 1200)
      .split('\n').map(line => line.trim()).filter(Boolean);
    out.register.reads = reads.slice(beforeRegister);
  }
}
out.windowReads = windowReads(reads);
out.pageErrors = errors;
await browser.close();
save('part-b-map.json', out);
console.log(JSON.stringify(out, null, 1));
