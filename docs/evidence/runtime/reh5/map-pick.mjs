import { chromium } from '@playwright/test';
import { save } from './audit.mjs';

// REH5 Part B4, second session: map.mjs's 165 grid clicks picked no building, because after 8 wheel ticks each
// footprint is one or two pixels. This session opens the area the same way, zooms 8 ticks at the centre as before,
// then zooms further over the densest drawn pixels and clicks drawn pixels (found in a screenshot decoded by the
// browser's own 2D canvas, nearest the densest point first) until the inspector shows "Open register"; then
// follows the link. Screenshots: map-3b.png (the inspector) and map-4.png (the register).
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const url = `http://127.0.0.1:5188/studio/areas/${areaId}`;
const evidence = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/reh5';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const decoder = await browser.newPage();
const reads = [];
const started = new Map();
const plain = text => text.replaceAll(areaId, '{areaId}');
page.on('request', request => {
  if (request.url().includes('/api/v1/')) started.set(request, performance.now());
});
page.on('requestfinished', async request => {
  if (!request.url().includes('/api/v1/')) return;
  const response = await request.response();
  reads.push({ path: plain(new URL(request.url()).pathname), status: response?.status() ?? null,
    seconds: Number(((performance.now() - started.get(request)) / 1000).toFixed(3)) });
});
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));

/** Pixels of the canvas box that differ from the ground grey and the sky: drawn features, in page coordinates. */
async function drawn(box) {
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  return decoder.evaluate(async ({ png, box }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data, width } = context.getImageData(0, 0, image.width, image.height);
    const at = (x, y) => data.slice((y * width + x) * 4, (y * width + x) * 4 + 3);
    // The ground is a flat grey with almost equal channels; a footprint is tinted (red above blue).
    const hits = [];
    for (let y = Math.ceil(box.y) + 4; y < box.y + box.height - 60; y += 2) {
      for (let x = Math.ceil(box.x) + 4; x < box.x + box.width - 4; x += 2) {
        const [r, g, b] = at(x, y);
        if (r - b > 18 && r > 120) hits.push([x, y]);
      }
    }
    return hits;
  }, { png, box });
}

/** The point with the most drawn pixels within 40 px. */
function densest(hits) {
  let best = null;
  for (const [x, y] of hits.filter((_, index) => index % 7 === 0)) {
    const near = hits.filter(([a, b]) => Math.abs(a - x) < 40 && Math.abs(b - y) < 40).length;
    if (!best || near > best.near) best = { x, y, near };
  }
  return best;
}

const out = { at: new Date().toISOString(), url: plain(url), browser: `Chromium ${browser.version()} headless`,
  viewport: '1440x900', why: 'map.mjs grid clicks picked nothing (footprints 1 to 2 px after 8 ticks)' };
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(3000);
const box = await page.locator('canvas').first().boundingBox();
const link = page.getByRole('link', { name: 'Open register' });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let tick = 0; tick < 8; tick++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2000);
out.zoomSteps = [];
for (let step = 0; step < 3; step++) {
  const hits = await drawn(box);
  const target = densest(hits);
  out.zoomSteps.push({ step: step + 1, drawnPixels: hits.length, target });
  if (!target) break;
  await page.mouse.move(target.x, target.y);
  for (let tick = 0; tick < 6; tick++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2500);
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => undefined);
}
out.afterZoom = { statusLines: (await page.locator('[role="status"]').allInnerTexts()).map(text => text.trim()),
  scale: (await page.locator('[class*="readout"]').allInnerTexts()).map(text => text.trim().replace(/\s+/g, ' ')) };
const hits = await drawn(box);
const centre = densest(hits);
out.candidates = hits.length;
let clicks = 0;
if (centre) {
  const ordered = hits.sort((a, b) => Math.hypot(a[0] - centre.x, a[1] - centre.y)
    - Math.hypot(b[0] - centre.x, b[1] - centre.y)).filter((_, index) => index % 3 === 0).slice(0, 120);
  for (const [x, y] of ordered) {
    clicks++;
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    if (await link.count()) {
      out.pickedAt = [x, y];
      break;
    }
  }
}
out.clicks = clicks;
out.inspector = await link.count() > 0;
await page.waitForTimeout(800);
await page.screenshot({ path: `${evidence}/map-3b.png`, type: 'png' });
if (out.inspector) {
  const panel = page.locator('[class*="inspectorColumn"]');
  out.inspectorText = (await panel.allInnerTexts()).join('\n').split('\n').map(line => line.trim()).filter(Boolean);
  out.registerHref = plain((await link.first().getAttribute('href')) ?? '');
  const beforeRegister = reads.length;
  await link.first().click();
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${evidence}/map-4.png`, type: 'png' });
  out.register = { url: plain(page.url()),
    banners: (await page.locator('[role="alert"]').allInnerTexts()).map(text => text.trim().slice(0, 200)),
    text: (await page.locator('main').allInnerTexts()).join('\n').split('\n').map(line => line.trim())
      .filter(Boolean).slice(0, 40), reads: reads.slice(beforeRegister), screenshot: 'map-4.png' };
}
out.screenshot = 'map-3b.png';
out.reads = reads;
out.pageErrors = errors;
await browser.close();
save('part-b-map-pick.json', out);
console.log(JSON.stringify(out, null, 1));
