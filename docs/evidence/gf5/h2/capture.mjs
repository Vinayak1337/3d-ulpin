/**
 * H2 evidence: the register page of two buildings whose register read answers 409, the candidate review at
 * 200% zoom, the focused header search and one forced portal render error, opened read-only (every non-GET
 * request is aborted).
 * Usage: node docs/evidence/gf5/h2/capture.mjs <before|after>   (Studio dev server on 127.0.0.1:5199, API on 3194)
 * "before" writes before.json (not committed); "after" writes result.json with both phases side by side.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const OUT = import.meta.dirname;
const STUDIO = 'http://127.0.0.1:5199';
const API = 'http://127.0.0.1:3194';
const PHASE = process.argv[2];
const SETTLE_MS = 5000;
const WIDE = { name: '100pct', width: 1280, height: 720, scale: 1 };
// 640 x 360 CSS px at device scale 2 is what a 1280 x 720 window shows at 200% browser zoom.
const ZOOM = { name: '200pct', width: 640, height: 360, scale: 2 };
const TOWER3 = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
const KARNATAKA = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';
const ABSENT_TITLE = 'No register is recorded for this building yet';
const REQUESTS_ROUTE = '/api/v1/register-requests';
const PAGES = [
  { name: 'register-tower3', kind: 'register', path: `/studio/properties/${TOWER3}/register`, views: [WIDE, ZOOM] },
  { name: 'register-magnolia', kind: 'register', path: `/studio/properties/${MAGNOLIA}/register`, views: [WIDE] },
  // Batches lists the Magnolia area; its building is the one with room candidates.
  { name: 'review-magnolia', kind: 'review', path: `/studio/properties/${MAGNOLIA}/candidates`, views: [WIDE, ZOOM] },
  { name: 'review-karnataka', kind: 'review', path: `/studio/areas/${KARNATAKA}/candidates`, views: [WIDE, ZOOM] },
];
const FORCED_PORTAL = {
  path: '/portal/records/forced-error',
  pattern: '**/api/v1/public/records/forced-error',
  // Test-only: a record with no elevation fields, which the record page cannot render.
  body: '{"id":"forced-error","buildingId":"b","name":"x","buildingName":"y","sharedSpaces":[]}',
};

async function open(browser, path, view, mock) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.route('**/*', (route) => {
    const method = route.request().method();
    return method === 'GET' || method === 'HEAD' ? route.continue() : route.abort();
  });
  if (mock) {
    await page.route(mock.pattern, (route) => route.fulfill({ contentType: 'application/json', body: mock.body }));
  }
  await page.goto(`${STUDIO}${path}`);
  await page.waitForTimeout(SETTLE_MS);
  return { page, errors, context };
}

const distinct = (errors) => [...new Set(errors.map((error) => error.slice(0, 100)))];

/** What the register page shows: its heading, its links and whether any export control or table is present. */
function registerFacts(page) {
  return page.evaluate((absentTitle) => {
    const main = document.querySelector('main');
    return {
      absentState: main.innerText.includes(absentTitle),
      heading: main.querySelector('h1')?.textContent ?? null,
      links: [...main.querySelectorAll('a')].map((link) => `${link.textContent} -> ${link.getAttribute('href')}`),
      exportControl: [...main.querySelectorAll('button')].some((button) => button.textContent.includes('Export')),
      tables: main.querySelectorAll('table').length,
    };
  }, ABSENT_TITLE);
}

/** The three review columns in document order, and how many elements inside them cut their content off. */
function reviewFacts(page) {
  return page.evaluate(() => {
    const body = document.querySelector('main [class*="_body_"]');
    const columns = [...body.children].map((column) => {
      const box = column.getBoundingClientRect();
      return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width) };
    });
    const clipped = [...body.querySelectorAll('*')].filter((element) => {
      const cuts = ['hidden', 'clip'].includes(getComputedStyle(element).overflowX);
      return cuts && element.scrollWidth > element.clientWidth + 1;
    });
    return { columns, clippedElements: clipped.length };
  });
}

/** One screenshot per stacked column (a single one while the columns sit side by side). */
async function reviewShots(page, name, view) {
  const columns = page.locator('main [class*="_body_"]').first().locator('> *');
  const tops = await columns.evaluateAll((all) => all.map((column) => Math.round(column.getBoundingClientRect().top)));
  const stacked = new Set(tops).size > 1;
  for (let index = 0; index < (stacked ? tops.length : 1); index += 1) {
    await columns.nth(index).evaluate((column) => column.scrollIntoView({ block: 'start' }));
    const suffix = stacked ? `-column${index + 1}` : '';
    await page.screenshot({ path: resolve(OUT, PHASE, `${name}-${view.name}${suffix}.png`) });
  }
}

async function capturePage(browser, spec) {
  const rows = [];
  for (const view of spec.views) {
    const { page, errors, context } = await open(browser, spec.path, view);
    const sizes = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    }));
    const facts = spec.kind === 'register' ? await registerFacts(page) : await reviewFacts(page);
    if (spec.kind === 'review') await reviewShots(page, spec.name, view);
    else await page.screenshot({ path: resolve(OUT, PHASE, `${spec.name}-${view.name}.png`) });
    rows.push({ page: spec.name, view: view.name, ...sizes, ...facts, consoleErrors: errors.length,
      distinct: distinct(errors) });
    await context.close();
  }
  return rows;
}

/** The focus treatment of the header search, read from the browser after the "/" shortcut focuses it. */
async function captureSearchFocus(browser) {
  const { page, context } = await open(browser, '/studio/work', WIDE);
  await page.keyboard.press('/');
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement.parentElement);
    return { focused: document.activeElement.id, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset, outlineColor: style.outlineColor };
  });
  const clip = { x: 0, y: 0, width: 1280, height: 60 };
  await page.screenshot({ path: resolve(OUT, PHASE, 'header-search-focus.png'), clip });
  await context.close();
  return outline;
}

async function captureForcedPortalError(browser) {
  const { page, errors, context } = await open(browser, FORCED_PORTAL.path, WIDE, FORCED_PORTAL);
  const text = await page.locator('body').innerText();
  await page.screenshot({ path: resolve(OUT, PHASE, 'forced-portal-error-mocked.png') });
  await context.close();
  return { mocked: true, portalHeaderKept: text.includes('Track a request'),
    pageErrorShown: text.includes('This page could not be shown'), consoleErrors: errors.length };
}

/** Step 0: what the demo API answers for the reads behind these pages (GET only). */
async function readStatus(path) {
  const response = await fetch(`${API}${path}`);
  const body = await response.json().catch(() => null);
  return { route: `GET ${path}`, status: response.status, code: body?.error?.code ?? null };
}

async function apiReads() {
  const reads = [];
  for (const buildingId of [TOWER3, MAGNOLIA]) {
    for (const read of ['register', 'ledger', 'canonical']) {
      reads.push(await readStatus(`/api/v1/buildings/${buildingId}/${read}`));
    }
  }
  const openapi = JSON.parse(readFileSync(resolve(OUT, '../../../api/openapi.json'), 'utf8'));
  const requests = { ...await readStatus(`${REQUESTS_ROUTE}?state=open`), inOpenApi: REQUESTS_ROUTE in openapi.paths };
  return { reads, requests };
}

const browser = await chromium.launch();
const pages = [];
for (const spec of PAGES) pages.push(...await capturePage(browser, spec));
const searchFocus = await captureSearchFocus(browser);
const forcedPortalError = await captureForcedPortalError(browser);
await browser.close();
const run = { pages, searchFocus, forcedPortalError };
if (PHASE === 'before') {
  writeFileSync(resolve(OUT, 'before.json'), JSON.stringify(run));
} else {
  const before = JSON.parse(readFileSync(resolve(OUT, 'before.json'), 'utf8'));
  const views = Object.fromEntries([WIDE, ZOOM].map((view) => [view.name, `${view.width}x${view.height} CSS px`]));
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ views, api: await apiReads(), before, after: run }));
}
console.log(JSON.stringify(run));
