import { chromium } from '@playwright/test';
import { save } from './audit.mjs';

// REH5's map.mjs and map-pick.mjs for REH6 Part B3, one session: the Niagara area opened in the Studio (dev server
// on 5188 from the rehearsal checkout, proxied to its API) in the Playwright Chromium already installed, 1440x900.
// At each stage: the status line, the Key, the scale readout, and the canvas read from a screenshot decoded by the
// browser's own 2D canvas, outside the overlay boxes: how much shows the clear colour #e9eeec (sky, or a flat
// background patch; LA5), how much differs from the most common colour (drawn buildings), and the largest block of
// flat clear colour. A building is picked by clicking drawn pixels, zooming in more over the densest ones if needed.
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const url = `http://127.0.0.1:5188/studio/areas/${areaId}`;
const evidence = 'E:/Projects/ulpin-wt/k2/docs/evidence/runtime/reh6';
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
  const windowRead = request.url().includes('/display-window');
  const body = windowRead ? await response?.json().catch(() => null) : null;
  const data = body?.data ?? body;
  reads.push({ path: plain(new URL(request.url()).pathname), status: response?.status() ?? null,
    features: windowRead ? data?.features?.length ?? null : undefined,
    next: windowRead ? (data?.next ? 'set' : null) : undefined,
    seconds: Number(((performance.now() - started.get(request)) / 1000).toFixed(3)) });
});
page.on('requestfailed', request => {
  if (request.url().includes('/api/v1/')) {
    reads.push({ path: plain(new URL(request.url()).pathname), failed: request.failure()?.errorText ?? true });
  }
});
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));

const texts = async selector => (await page.locator(selector).allInnerTexts())
  .map(text => text.trim().replace(/\s+/g, ' ')).filter(Boolean);

/** Boxes of the elements drawn over the canvas, padded by 6 px: none of their pixels is the scene's. */
async function overlays() {
  const boxes = [];
  for (const selector of ['[role="status"]', 'details', '[class*="readout"]', '[class*="inspectorColumn"]',
    '[class*="nspector"]', '[role="alert"]']) {
    for (const element of await page.locator(selector).all()) {
      const box = await element.boundingBox().catch(() => null);
      if (box && box.width && box.height) {
        boxes.push({ x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 });
      }
    }
  }
  return boxes;
}

/** The canvas outside the overlays: clear-colour share, drawn pixels and the largest flat clear-colour block. */
async function canvasRead(box) {
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  const masks = await overlays();
  return decoder.evaluate(async ({ png, box, masks }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data, width } = context.getImageData(0, 0, image.width, image.height);
    const at = (x, y) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const masked = (x, y) => masks.some(m => x >= m.x && x <= m.x + m.width && y >= m.y && y <= m.y + m.height);
    const clear = ([r, g, b]) => Math.abs(r - 233) <= 3 && Math.abs(g - 238) <= 3 && Math.abs(b - 236) <= 3;
    const x0 = Math.ceil(box.x) + 4, y0 = Math.ceil(box.y) + 4;
    const x1 = Math.floor(box.x + box.width) - 4, y1 = Math.floor(box.y + box.height) - 4;
    const counts = new Map();
    const samples = [];
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        if (masked(x, y)) continue;
        const colour = at(x, y);
        samples.push([x, y, colour]);
        const key = colour.map(value => value >> 3).join();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const [modeKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const mode = modeKey.split(',').map(value => (Number(value) << 3) + 4);
    const far = ([r, g, b]) => Math.abs(r - mode[0]) + Math.abs(g - mode[1]) + Math.abs(b - mode[2]) > 30;
    const clearCount = samples.filter(([, , colour]) => clear(colour)).length;
    const drawn = samples.filter(([, , colour]) => far(colour) && !clear(colour)).map(([x, y]) => [x, y]);
    // Flat clear-colour cells of 16 px (every sampled pixel clear, none masked), grouped 4-connected.
    const cell = 16, cols = Math.floor((x1 - x0) / cell), rows = Math.floor((y1 - y0) / cell);
    const flat = new Set();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let all = true;
        for (let dy = 0; dy < cell && all; dy += 4) {
          for (let dx = 0; dx < cell && all; dx += 4) {
            const x = x0 + col * cell + dx, y = y0 + row * cell + dy;
            if (masked(x, y) || !clear(at(x, y))) all = false;
          }
        }
        if (all) flat.add(row * cols + col);
      }
    }
    let largest = null;
    const seen = new Set();
    for (const start of flat) {
      if (seen.has(start)) continue;
      const stack = [start];
      seen.add(start);
      let n = 0, minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
      while (stack.length) {
        const index = stack.pop();
        n++;
        const row = Math.floor(index / cols), col = index % cols;
        minC = Math.min(minC, col);
        maxC = Math.max(maxC, col);
        minR = Math.min(minR, row);
        maxR = Math.max(maxR, row);
        for (const next of [col > 0 && index - 1, col < cols - 1 && index + 1, row > 0 && index - cols,
          row < rows - 1 && index + cols]) {
          if (next !== false && flat.has(next) && !seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      if (!largest || n > largest.cells) {
        largest = { cells: n, x: x0 + minC * cell, y: y0 + minR * cell, width: (maxC - minC + 1) * cell,
          height: (maxR - minR + 1) * cell };
      }
    }
    return { sampled: samples.length, mostCommonColour: mode,
      clearShare: Number((clearCount / samples.length).toFixed(3)), drawnPixels: drawn.length,
      drawnShare: Number((drawn.length / samples.length).toFixed(3)), flatClearCells: flat.size,
      largestFlatClearBlock: largest, drawn };
  }, { png, box, masks });
}

async function look(label, shot, box) {
  await page.screenshot({ path: `${evidence}/${shot}`, type: 'png' });
  const { drawn, ...pixels } = await canvasRead(box);
  const value = { label, at: new Date().toISOString(), url: plain(page.url()),
    statusLines: await texts('[role="status"]'),
    key: { shown: await page.locator('details', { hasText: 'Key' }).count() > 0,
      open: await page.locator('details[open]', { hasText: 'Key' }).count() > 0, text: await texts('details') },
    scale: await texts('[class*="readout"]'), banners: await texts('[role="alert"]'), canvas: pixels,
    screenshot: shot, readsSoFar: reads.length };
  return { value, drawn };
}

const windowReads = list => {
  const rows = list.filter(read => read.path.endsWith('/display-window'));
  return { count: rows.length, statuses: [...new Set(rows.map(read => read.status ?? 'failed'))],
    seconds: rows.map(read => read.seconds ?? null), features: rows.map(read => read.features ?? null),
    lastNext: rows.at(-1)?.next ?? null };
};

async function wheel(x, y, ticks) {
  await page.mouse.move(x, y);
  for (let tick = 0; tick < ticks; tick++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
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

const out = { at: new Date().toISOString(), url: plain(url), route: '/studio/areas/:areaId',
  browser: `Chromium ${browser.version()} headless`, viewport: '1440x900' };
const begin = performance.now();
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(3000);
out.loadSeconds = Number(((performance.now() - begin) / 1000).toFixed(1));
const box = await page.locator('canvas').first().boundingBox();
out.canvasBox = box;
const opened = await look('opened', 'map-1.png', box);
out.open = { ...opened.value, reads: [...reads], windowReads: windowReads(reads) };

let mark = reads.length;
await wheel(box.x + box.width / 2, box.y + box.height / 2, 8);
const zoomed = await look('after 8 wheel ticks in over the canvas centre', 'map-2.png', box);
out.zoomed = { ...zoomed.value, reads: reads.slice(mark), windowReads: windowReads(reads.slice(mark)) };

// Pick: click drawn pixels nearest the densest point; if none answers, zoom 6 ticks more there (at most 3 times).
const link = page.getByRole('link', { name: 'Open register' });
let hits = zoomed.drawn;
out.pick = { rounds: [] };
mark = reads.length;
for (let round = 0; round < 4 && !(await link.count()); round++) {
  const centre = densest(hits);
  const entry = { round: round + 1, drawnPixels: hits.length, densest: centre, clicks: 0 };
  out.pick.rounds.push(entry);
  if (!centre) break;
  const ordered = [...hits].sort((a, b) => Math.hypot(a[0] - centre.x, a[1] - centre.y)
    - Math.hypot(b[0] - centre.x, b[1] - centre.y)).filter((_, index) => index % 3 === 0).slice(0, 40);
  for (const [x, y] of ordered) {
    entry.clicks++;
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    if (await link.count()) {
      entry.pickedAt = [x, y];
      break;
    }
  }
  if (await link.count() || round === 3) break;
  await page.keyboard.press('Escape');
  await wheel(centre.x, centre.y, 6);
  entry.statusAfterZoom = await texts('[role="status"]');
  entry.scaleAfterZoom = await texts('[class*="readout"]');
  hits = (await canvasRead(box)).drawn;
}
await page.waitForTimeout(1000);
const picked = await look('after picking a building', 'map-3.png', box);
out.picked = { ...picked.value, inspector: await link.count() > 0, reads: reads.slice(mark),
  windowReads: windowReads(reads.slice(mark)) };
if (out.picked.inspector) {
  out.picked.inspectorText = await texts('[class*="inspectorColumn"]');
  out.picked.inspectorBox = await page.locator('[class*="inspectorColumn"]').first().boundingBox().catch(() => null);
  out.picked.registerHref = plain((await link.first().getAttribute('href')) ?? '');
  mark = reads.length;
  await link.first().click();
  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${evidence}/map-4.png`, type: 'png' });
  out.register = { url: plain(page.url()), banners: await texts('[role="alert"]'),
    text: (await page.locator('main').allInnerTexts()).join('\n').split('\n').map(line => line.trim())
      .filter(Boolean).slice(0, 40), reads: reads.slice(mark), screenshot: 'map-4.png' };
}
out.windowReads = windowReads(reads);
out.pageErrors = errors;
await browser.close();
save('part-b-map.json', out);
console.log(JSON.stringify(out, (key, value) => (key === 'reads' ? value.length : value), 1));
