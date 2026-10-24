/**
 * M1 evidence: the three map areas opened read-only, with console errors and screenshots.
 * Usage: node docs/evidence/gf5/m1/capture.mjs <before|after>   (Studio dev server on 127.0.0.1:5199, API on 3194)
 * "before" records the crash and writes before.json (not committed). "after" reads the new list, forces one
 * render error from a mocked response (marked as such) and writes result.json with both phases side by side.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const OUT = import.meta.dirname;
const STUDIO = 'http://127.0.0.1:5199';
const PHASE = process.argv[2];
const AREAS = {
  haryana: 'ed4bc3ae-1b02-412e-a5cc-02accf693a1b',
  bihar: 'e5742536-cedd-455b-b59d-c8172875c6f2',
  karnataka: 'cb24dc86-2b91-4793-9586-24e8a443b8d8',
};
const SETTLE_MS = 6000;
const LIST_HEADING = 'Buildings without recorded geometry';

/** Every non-GET request is aborted, so the run cannot write to the demo runtime. */
async function blockWrites(page) {
  await page.route('**/*', (route) => {
    const method = route.request().method();
    return method === 'GET' || method === 'HEAD' ? route.continue() : route.abort();
  });
}

async function open(browser, path, { scale = 1, width = 1280, height = 800, mock } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await blockWrites(page);
  if (mock) {
    await page.route(mock.pattern, (route) => route.fulfill({ contentType: 'application/json', body: mock.body }));
  }
  await page.goto(`${STUDIO}${path}`);
  await page.waitForTimeout(SETTLE_MS);
  return { page, errors, context };
}

async function countFeatures(page, areaId) {
  const response = await page.request.get(`${STUDIO}/api/v1/areas/${areaId}/context`);
  const { area, features } = await response.json();
  const buildings = features.filter((feature) => feature.kind === 'building');
  const withGeometry = buildings.filter((feature) => feature.geometry !== null);
  // What the area record itself holds: a recorded boundary (extent) and a reference system.
  return { total: features.length, buildings: buildings.length, withGeometry: withGeometry.length,
    withoutGeometry: buildings.length - withGeometry.length,
    areaBoundary: area.extent !== null || area.geographicExtent !== null, areaReference: area.reference !== null };
}

async function readPage(page) {
  const text = await page.locator('body').innerText();
  return {
    listShown: text.includes(LIST_HEADING),
    emptyWords: text.includes('No geometry is recorded for this area yet'),
    footprintWords: (text.match(/No footprint recorded · not drawn on the map/g) ?? []).length,
    errorScreen: /Unexpected Application Error|This page could not be shown/.test(text),
    scaleBar: await page.locator('[title^="Horizontal"], [title^="No reference"]').count(),
  };
}

async function captureArea(browser, name) {
  const { page, errors, context } = await open(browser, `/studio/areas/${AREAS[name]}`);
  const counts = await countFeatures(page, AREAS[name]);
  const state = await readPage(page);
  await page.screenshot({ path: resolve(OUT, PHASE, `${name}-1280.png`) });
  await context.close();
  const distinct = [...new Set(errors.map((error) => error.slice(0, 110)))];
  return { name, ...counts, ...state, consoleErrors: errors.length, distinct };
}

/** After: the new list at 200% zoom (a 640x400 viewport at scale 2) and one forced render error. */
async function captureAfterOnly(browser) {
  const zoom = await open(browser, `/studio/areas/${AREAS.haryana}`, { scale: 2, width: 640, height: 400 });
  await zoom.page.screenshot({ path: resolve(OUT, 'after', 'haryana-200pct.png') });
  await zoom.page.locator('summary', { hasText: 'Tools' }).click();
  await zoom.page.getByRole('link', { name: /Open register of/ }).scrollIntoViewIfNeeded();
  await zoom.page.screenshot({ path: resolve(OUT, 'after', 'haryana-200pct-list.png') });
  await zoom.context.close();
  // Test-only: the area response is replaced by one with no area, which the page cannot render.
  const mock = { pattern: `**/api/v1/areas/${AREAS.bihar}/context`, body: '{"features":[]}' };
  const forced = await open(browser, `/studio/areas/${AREAS.bihar}`, { mock });
  const text = await forced.page.locator('body').innerText();
  await forced.page.screenshot({ path: resolve(OUT, 'after', 'forced-error-mocked.png') });
  await forced.context.close();
  return { forcedError: { mocked: true, headerKept: text.includes('Batches'), retry: text.includes('Retry'),
    message: text.includes('This page could not be shown') } };
}

const browser = await chromium.launch();
const areas = [];
for (const name of Object.keys(AREAS)) areas.push(await captureArea(browser, name));
const extra = PHASE === 'after' ? await captureAfterOnly(browser) : {};
await browser.close();
writeFileSync(resolve(OUT, `${PHASE}.json`), JSON.stringify({ areas, ...extra }));
if (PHASE === 'after') {
  const before = JSON.parse(readFileSync(resolve(OUT, 'before.json'), 'utf8'));
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ before: before.areas, after: areas, ...extra }));
}
console.log(JSON.stringify({ areas, ...extra }, null, 1));
