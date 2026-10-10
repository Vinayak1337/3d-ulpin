/**
 * H3 evidence, read-only (every non-GET request is aborted): the building page at 200% zoom and at 1440 px, the
 * building workspace under a refused register read, and (after) the Documents tab and the recorded panel beside a
 * source whose document reading the server states is not current.
 * Usage: node docs/evidence/gf5/h3/capture.mjs <before|after>   (Studio dev server on 127.0.0.1:5199, API on 3194)
 * "before" writes before.json (not committed); "after" writes capture.json with both phases side by side.
 * An answer the demo does not give is mocked in the browser, on real pages; its screenshot is named "-mocked".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const OUT = import.meta.dirname;
const STUDIO = 'http://127.0.0.1:5199';
const API = 'http://127.0.0.1:3194';
const PHASE = process.argv[2];
const SETTLE_MS = 5000;
const DESKTOP = { name: '1440', width: 1440, height: 900, scale: 1 };
// 640 x 360 CSS px at device scale 2 is what a 1280 x 720 window shows at 200% browser zoom.
const ZOOM = { name: '200pct', width: 640, height: 360, scale: 2 };
// The same zoom on a 1920 x 1080 window.
const ZOOM_WIDE = { name: '200pct-of-1920', width: 960, height: 540, scale: 2 };
const TOWER3 = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
// The one source the recorded floor of Tower 3 cites (read from its canonical record).
const TOWER3_CITED = '5293cd72-2377-4deb-a51c-c76d11ccb429';
const REQUESTS_ROUTE = '/api/v1/register-requests';

// Test-only answers for the consolidated read, shown on real pages: one source stated with a known reason and a
// code this build does not know, every other source stated as current (which prints nothing).
const MOCK_STATED = { current: false, reasons: ['source_superseded', 'something_new'] };
const MOCK_CURRENT = { current: true, reasons: [] };
const consolidated = (buildingId, sources) => ({ schemaVersion: 'building-registry-summary/1', recordState: 'recorded',
  selection: { id: buildingId, kind: 'building' }, records: [], groups: [], parcels: [], omissions: [], sources });
const consolidatedSource = (id, documentResult) => ({ id, revision: 1, sha256: id.replaceAll('-', '').padEnd(64, '0'),
  profile: 'mocked', receivedAt: '2026-10-10T00:00:00.000Z', documentResult });
const REFUSED = {
  status: 409, body: { error: { code: 'STALE_REVISION', message: 'Mocked refusal.', requestId: 'mocked' } },
};

/** A mock for one register read of one building: the consolidated profile or the default one. */
function registerMock(buildingId, profile, answer) {
  const matches = (url) => url.pathname === `/api/v1/buildings/${buildingId}/register`
    && (url.searchParams.get('profile') === 'consolidated') === (profile === 'consolidated');
  return { matches, status: answer.status ?? 200, body: JSON.stringify(answer.body ?? answer) };
}

async function open(browser, path, view, mocks = []) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
  });
  const page = await context.newPage();
  const errors = [];
  const asked = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await page.route('**/*', (route) => {
    const method = route.request().method();
    return method === 'GET' || method === 'HEAD' ? route.continue() : route.abort();
  });
  for (const mock of mocks) {
    await page.route((url) => mock.matches(url), (route) => route.fulfill({
      status: mock.status, contentType: 'application/json', body: mock.body,
    }));
  }
  await page.goto(`${STUDIO}${path}`);
  await page.waitForTimeout(SETTLE_MS);
  return { page, errors, asked, context };
}

const shot = (page, name) => page.screenshot({ path: resolve(OUT, PHASE, `${name}.png`) });
/** Scrolls whatever holds the element until it sits in the middle of the window. */
const centre = (locator) => locator.evaluate((element) => element.scrollIntoView({ block: 'center' }));
const mainText = async (page) => (await page.locator('main').innerText()).replace(/\s*\n+\s*/g, ' | ');

/** The review and the recorded panel of the building page: where they sit and which of them scrolls. */
function layoutFacts(page) {
  return page.evaluate(() => {
    const review = document.querySelector('main [class*="_body_"]').parentElement;
    const layout = review.parentElement;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return [rect.left, rect.top, rect.width, rect.height].map(Math.round);
    };
    return {
      review: box(review), recorded: box(layout.children[1]),
      reviewScroll: [review.scrollHeight, review.clientHeight], pageScroll: [layout.scrollHeight, layout.clientHeight],
      documentWidth: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    };
  });
}

/** The building page (review above, recorded panel below) at one viewport; at 200% also scrolled to its end. */
async function captureBuildingPage(browser, view) {
  const { page, context } = await open(browser, `/studio/properties/${MAGNOLIA}/candidates`, view);
  const facts = await layoutFacts(page);
  await shot(page, `building-page-${view.name}`);
  if (view === ZOOM) {
    await page.evaluate(() => {
      const layout = document.querySelector('main [class*="_body_"]').parentElement.parentElement;
      layout.scrollTo(0, layout.scrollHeight);
    });
    await shot(page, `building-page-${view.name}-end`);
  }
  await context.close();
  return { view: view.name, ...facts, nestedScroller: facts.reviewScroll[0] > facts.reviewScroll[1] + 1 };
}

/** The building workspace when the register read is refused: live while the demo refuses it, else mocked. */
async function captureRefusedWorkspace(browser, api) {
  const live = api.reads.find((read) => read.route.endsWith(`${TOWER3}/register`)).status === 409;
  const mocks = live ? [] : [registerMock(TOWER3, 'default', REFUSED)];
  const mode = live ? 'live' : 'mocked';
  const { page, context } = await open(browser, `/studio/review/${TOWER3}`, DESKTOP, mocks);
  const text = await mainText(page);
  await shot(page, `building-workspace-409-${mode}`);
  await context.close();
  return { mode, text };
}

/** Whether every caption line of the page lies inside the window's width and the page does not scroll sideways. */
function captionsFit(page) {
  return page.evaluate(() => {
    const captions = [...document.querySelectorAll('main .ul-caption')];
    const inside = captions.every((caption) => caption.getBoundingClientRect().right <= window.innerWidth);
    return inside && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  });
}

/** The list's size, and whether its first row can be pointed at once scrolled to or something clips it away. */
function listFacts(list) {
  return list.evaluate((element) => {
    const size = element.getBoundingClientRect();
    const row = element.querySelector('li').getBoundingClientRect();
    const reachable = element.contains(document.elementFromPoint(row.left + 8, row.top + row.height / 2));
    return { size: [size.width, size.height].map(Math.round), reachable };
  });
}

/** The Documents tab: each listed source as the lines the page shows for it. */
async function captureDocuments(browser, buildingId, name, mocks, view = DESKTOP) {
  const path = `/studio/properties/${buildingId}/register?tab=documents`;
  const { page, errors, context } = await open(browser, path, view, mocks);
  const list = page.getByRole('heading', { name: 'Sources', exact: true }).locator('xpath=ancestor::section[1]');
  await centre(list);
  const rows = await list.locator('li').evaluateAll((items) => items.map(
      (item) => item.innerText.split('\n').map((line) => line.trim()).filter(Boolean)));
  const seen = { fits: await captionsFit(page), ...await listFacts(list) };
  await shot(page, `documents-tab-${name}`);
  await context.close();
  return { name, rows, ...seen, pageErrors: errors.filter((error) => !error.startsWith('Failed to load resource')) };
}

/** A citation's chip and the recorded panel around it, as boxes. */
function citationBoxes(panel) {
  return panel.evaluate((element) => {
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return [rect.width, rect.height].map(Math.round);
    };
    return { chip: box(element.querySelector('.ul-evid')), panel: box(element) };
  });
}

/**
 * The recorded panel's citation lines on the building page. The citation's wrapper is then made transparent to
 * layout (`display: contents`, the page as it was before the wrapper existed) to measure whether it moved anything.
 */
async function captureRecorded(browser, name, mocks, view = DESKTOP) {
  const { page, context } = await open(browser, `/studio/properties/${TOWER3}/candidates`, view, mocks);
  const panel = page.getByRole('heading', { name: 'Recorded floors and units' }).locator('xpath=ancestor::section[1]');
  const cited = panel.locator('dt:has-text("Citation") + dd');
  const citations = await cited.allInnerTexts();
  const fits = await captionsFit(page);
  await centre(cited.first());
  // At 1440 px the whole panel is the picture; at 200% the window around the first citation is.
  if (view === DESKTOP) await panel.screenshot({ path: resolve(OUT, PHASE, `recorded-panel-${name}.png`) });
  else await shot(page, `recorded-panel-${name}`);
  const withWrapper = await citationBoxes(panel);
  await page.addStyleTag({ content: '[class*="_citation_"] { display: contents; }' });
  const withoutWrapper = await citationBoxes(panel);
  await context.close();
  const lines = citations.map((text) => text.replace(/\s*\n+\s*/g, ' | '));
  return { name, citations: lines, fits, withWrapper, withoutWrapper };
}

/** Whether any page of the frame asks for the public requests route this build does not serve. */
async function captureRequestsBadge(browser) {
  const { asked, context } = await open(browser, '/studio/work', DESKTOP);
  await context.close();
  return { route: REQUESTS_ROUTE, requestsFromTheFrame: asked.filter((path) => path === REQUESTS_ROUTE).length };
}

async function readStatus(path) {
  const response = await fetch(`${API}${path}`);
  const body = await response.json().catch(() => null);
  const stated = (body?.sources ?? []).filter((source) => source.documentResult)
    .map((source) => ({ source: source.id.slice(0, 8), ...source.documentResult }));
  return { route: `GET ${path}`, status: response.status, code: body?.error?.code ?? null, stated };
}

/** What the demo API answers for the reads behind these pages (GET only). */
async function apiReads() {
  const reads = [];
  for (const buildingId of [TOWER3, MAGNOLIA]) {
    for (const read of ['register', 'register?profile=consolidated&format=json', 'ledger']) {
      reads.push(await readStatus(`/api/v1/buildings/${buildingId}/${read}`));
    }
  }
  return { reads, requests: await readStatus(`${REQUESTS_ROUTE}?state=open`) };
}

/** The Documents tab and the recorded panel: as the demo serves them, and with the consolidated read mocked. */
async function captureFreshness(browser) {
  const register = await (await fetch(`${API}/api/v1/buildings/${TOWER3}/register`)).json();
  const mocked = consolidated(TOWER3, register.sources.map(
    (source) => consolidatedSource(source.id, source.id === TOWER3_CITED ? MOCK_STATED : MOCK_CURRENT)));
  const mocks = [registerMock(TOWER3, 'consolidated', mocked)];
  return {
    documents: [
      await captureDocuments(browser, TOWER3, 'tower3-live', []),
      await captureDocuments(browser, TOWER3, 'tower3-live-200pct', [], ZOOM),
      await captureDocuments(browser, TOWER3, 'tower3-live-200pct-of-1920', [], ZOOM_WIDE),
      await captureDocuments(browser, MAGNOLIA, 'magnolia-live', []),
      await captureDocuments(browser, TOWER3, 'tower3-mocked', mocks),
    ],
    recorded: [
      await captureRecorded(browser, 'live', []),
      await captureRecorded(browser, 'mocked', mocks),
      await captureRecorded(browser, 'mocked-200pct', mocks, ZOOM),
    ],
  };
}

/** The before phase of an earlier run: its own file while it exists, else the copy kept in capture.json. */
function beforeRun() {
  const kept = resolve(OUT, 'before.json');
  if (existsSync(kept)) return JSON.parse(readFileSync(kept, 'utf8'));
  return JSON.parse(readFileSync(resolve(OUT, 'capture.json'), 'utf8')).before;
}

const api = await apiReads();
const browser = await chromium.launch();
const run = {
  buildingPage: [await captureBuildingPage(browser, ZOOM), await captureBuildingPage(browser, DESKTOP)],
  refusedWorkspace: await captureRefusedWorkspace(browser, api),
  requestsBadge: await captureRequestsBadge(browser),
};
if (PHASE === 'after') run.freshness = await captureFreshness(browser);
await browser.close();
if (PHASE === 'before') {
  writeFileSync(resolve(OUT, 'before.json'), JSON.stringify(run));
} else {
  writeFileSync(resolve(OUT, 'capture.json'), JSON.stringify({ api, before: beforeRun(), after: run }));
}
console.log(JSON.stringify({ api, run }));
