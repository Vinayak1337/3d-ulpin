/**
 * H5 evidence, read-only. The browser may send GET and HEAD, and the two POST reads the Studio sends for a unit's
 * cards (identity resolve, property-card list); every other request is aborted and counted under `refused`.
 * Usage: node docs/evidence/gf5/h5/capture.mjs <before|after>   (Studio dev server on 127.0.0.1:5199, API on 3194)
 * Each phase writes <phase>.json and its screenshots into <phase>/. The demo holds no reading statement for the
 * source the recorded labels cite, so the pinned-page viewer with a statement is mocked in the browser (the
 * statement of another source of the same building is copied onto it); those screenshots are named "mocked-".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
const VIEWS = [DESKTOP, ZOOM];
const TOWER3 = { name: 'tower3', id: '6f95d04e-2067-4ac8-a3c2-6cc21ea46325' };
const MAGNOLIA = { name: 'magnolia', id: 'e8777ffc-9409-4129-bacf-f680160d8795' };
const CARD_READS = ['/usp/identity/resolve', '/usp/property-cards/list'];
const PANE = 'main [class*="_canvasWrap_"]';
const TAB_BODY = 'main [class*="_tabBody_"]';
const RAIL = 'main [role="listbox"][aria-label="Levels"]';
const NO_GEOMETRY = 'No geometry is recorded for this building';
const refused = [];

const getJson = async (path) => (await fetch(`${API}${path}`)).json();

function allowed(request) {
  if (request.method() === 'GET' || request.method() === 'HEAD') return true;
  const { pathname } = new URL(request.url());
  return request.method() === 'POST' && CARD_READS.some((read) => pathname.endsWith(read));
}

/** Answers the consolidated register read with the live answer, changed by `mock`; every other request is live. */
async function guard(page, mock) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!allowed(request)) {
      refused.push(`${request.method()} ${new URL(request.url()).pathname}`);
      return route.abort();
    }
    const consolidated = new URL(request.url()).searchParams.get('profile') === 'consolidated';
    if (!mock || !consolidated) return route.continue();
    const response = await route.fetch();
    return route.fulfill({ response, json: mock(await response.json()) });
  });
}

async function open(browser, path, view, mock = null) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await guard(page, mock);
  await page.goto(`${STUDIO}${path}`);
  await page.waitForTimeout(SETTLE_MS);
  return { page, errors, context };
}

const shot = (page, name) => page.screenshot({ path: resolve(OUT, PHASE, `${name}.png`) });
const oneLine = (text) => text.replace(/\s*\n+\s*/g, ' | ').trim();
/** The text of the first element matching the selector, or null when the page has none. */
async function textOf(page, selector) {
  const element = page.locator(selector).first();
  return (await element.count()) ? oneLine(await element.innerText()) : null;
}

/** The window as it stands, then with each named part of the page brought to the middle of it. */
async function shots(page, name, parts) {
  await shot(page, name);
  for (const [part, selector] of Object.entries(parts)) {
    const element = page.locator(selector).first();
    if (!(await element.count())) continue;
    await element.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await shot(page, `${name}-${part}`);
  }
}

const box = async (locator) => ((await locator.count()) ? locator.first().boundingBox() : null);
const overlap = (a, b) => Boolean(a && b
  && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height);

/** Whether the level rail is on the page, what it lists, and whether it lies over the no-geometry statement. */
async function railFacts(page) {
  const rail = await box(page.locator(RAIL));
  const title = await box(page.getByText(NO_GEOMETRY, { exact: true }));
  const lines = await box(page.locator(`${PANE} ul`));
  return {
    rail: await textOf(page, RAIL),
    railOverStatement: rail ? overlap(rail, title) || overlap(rail, lines) : null,
    paneWidth: (await box(page.locator(PANE)))?.width ?? null,
  };
}

/** What a register page says: header, the Units tab and its badge, the tab's body, the scene pane, the rail. */
async function registerFacts(page) {
  return {
    header: await textOf(page, 'main header p'),
    unitsTab: await textOf(page, 'main [role="tab"]'),
    tabBody: await textOf(page, TAB_BODY),
    pane: await textOf(page, PANE),
    ...await railFacts(page),
    canvases: await page.locator('main canvas').count(),
    fitsWidth: await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  };
}

/** The register page of a building on its Units tab, with or without a floor selected. */
async function captureRegister(browser, building, view, floor) {
  const query = floor ? `?level=${floor.id}` : '';
  const { page, errors, context } = await open(browser, `/studio/properties/${building.id}/register${query}`, view);
  const facts = await registerFacts(page);
  const name = `register-${building.name}${floor ? '-floor' : ''}-${view.name}`;
  await shots(page, name, view === ZOOM ? { scene: PANE, rail: RAIL, units: TAB_BODY } : { units: TAB_BODY });
  await context.close();
  return { building: building.name, view: view.name, floor: floor?.label ?? null, ...facts, pageErrors: errors };
}

/** The building workspace at its check stage: how wide the scene pane is and how much room the checks have. */
async function captureCheckStage(browser, building, view) {
  const { page, errors, context } = await open(browser, `/studio/review/${building.id}?stage=check`, view);
  const side = page.locator('main [class*="_check_"] > [class*="_side_"]').first();
  const facts = {
    pane: await textOf(page, PANE),
    paneWidth: (await box(page.locator(PANE)))?.width ?? null,
    checksWidth: (await box(side))?.width ?? null,
    checksHeight: (await box(side))?.height ?? null,
    fitsWidth: await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  };
  await shots(page, `workspace-check-${building.name}-${view.name}`, view === ZOOM ? { scene: PANE } : {});
  if (await side.count()) {
    await side.evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await shot(page, `workspace-check-${building.name}-${view.name}-checks`);
  }
  await context.close();
  return { building: building.name, view: view.name, ...facts, pageErrors: errors };
}

/** The live consolidated read with the reading statement of one source copied onto the source the labels cite. */
function withStatement(citedId) {
  return (report) => {
    const donor = report.sources.find((source) => source.documentResult);
    const sources = report.sources.map(
      (source) => (source.id === citedId && donor ? { ...source, documentResult: donor.documentResult } : source));
    return { ...report, sources };
  };
}

/** The pinned-page viewer, opened from the first citation of the recorded panel on the building's candidates page. */
async function capturePinnedViewer(browser, name, mock) {
  const { page, errors, context } = await open(browser, `/studio/properties/${TOWER3.id}/candidates`, DESKTOP, mock);
  const chip = page.locator('main [class*="_citation_"] button').first();
  const reached = (await chip.count()) > 0;
  if (reached) await chip.click();
  await page.waitForTimeout(SETTLE_MS);
  const dialog = await textOf(page, '[role="dialog"]');
  await shot(page, name);
  await context.close();
  return { name, reached, dialog: dialog?.slice(0, 700) ?? null, pageErrors: errors };
}

/** The first candidate's card on a building page: its Citations section, brought into view. */
async function captureCandidateCard(browser, building) {
  const { page, context } = await open(browser, `/studio/properties/${building.id}/candidates`, DESKTOP);
  const row = page.locator('main ul[aria-label="Candidates"] button').first();
  const reached = (await row.count()) > 0;
  if (reached) await row.click();
  await page.waitForTimeout(1500);
  const section = page.locator('section[aria-label="Citations"]').first();
  const citations = (await section.count()) ? oneLine(await section.innerText()) : null;
  if (citations) await section.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await shot(page, `candidate-card-${building.name}`);
  await context.close();
  return { building: building.name, reached, citations };
}

/** What has the focus, in the words a person would use for it. */
function focused(page) {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (!node || node === document.body) return 'the page';
    const role = node.getAttribute('role') ?? node.tagName.toLowerCase();
    const name = node.getAttribute('aria-label') ?? node.textContent?.replace(/\s+/g, ' ').trim().slice(0, 70) ?? '';
    let where = 'shell';
    if (node.closest('main')) where = 'main';
    if (node.closest('[role="dialog"]')) where = 'dialog';
    return `${where} · ${role} · ${name}`;
  });
}

/** Presses one key and says where the focus went. */
async function press(page, key, walk) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  walk.push({ pressed: key, focus: await focused(page) });
}

/** Presses Tab until the focus matches, at most `limit` times. */
async function tabTo(page, walk, pattern, limit = 30) {
  for (let presses = 0; presses < limit; presses += 1) {
    await press(page, 'Tab', walk);
    if (pattern.test(walk.at(-1).focus)) return;
  }
}

/** What the page shows at a point of the walk. */
async function seen(page, what, walk) {
  walk.push({
    seen: what,
    address: new URL(page.url()).search,
    unitsTab: await textOf(page, 'main [role="tab"]'),
    tabBody: (await textOf(page, TAB_BODY))?.slice(0, 80) ?? null,
    dialog: (await textOf(page, '[role="dialog"]'))?.slice(0, 160) ?? null,
  });
}

/**
 * The Tower 3 register page walked with the keyboard alone, every press recorded with where the focus went:
 * to the rail and a floor on it, across the tabs, to the unit's citation and into its viewer, past its card links.
 */
async function keyboardWalk(browser) {
  const { page, errors, context } = await open(browser, `/studio/properties/${TOWER3.id}/register`, DESKTOP);
  const walk = [];
  await tabTo(page, walk, /listbox · Levels/);
  await press(page, 'ArrowDown', walk);
  await seen(page, 'after ArrowDown on the rail', walk);
  await shot(page, 'keyboard-rail-floor-selected');
  await tabTo(page, walk, /tab · Units/);
  await press(page, 'ArrowRight', walk);
  await press(page, 'ArrowLeft', walk);
  await tabTo(page, walk, /button · All units/);
  await press(page, 'Tab', walk);
  await press(page, 'Tab', walk);
  await press(page, 'Enter', walk);
  await page.waitForTimeout(SETTLE_MS);
  await seen(page, 'after Enter on the unit citation', walk);
  await shot(page, 'keyboard-citation-opened');
  await press(page, 'Tab', walk);
  await press(page, 'Escape', walk);
  await tabTo(page, walk, /^(?!main)/, 12);
  await context.close();
  return { walk, pageErrors: errors };
}

mkdirSync(resolve(OUT, PHASE), { recursive: true });
const canonical = await getJson(`/api/v1/buildings/${TOWER3.id}/canonical`);
const recorded = canonical.levels.find((level) => level.registryFloorId);
const floor = { id: recorded.registryFloorId, label: recorded.label.value };
const citedId = recorded.label.citations[0].sourceId;

const browser = await chromium.launch();
const run = { floor, registers: [], checkStages: [], viewers: [], candidateCards: [] };
for (const view of VIEWS) {
  run.registers.push(await captureRegister(browser, TOWER3, view, null));
  run.registers.push(await captureRegister(browser, TOWER3, view, floor));
  run.registers.push(await captureRegister(browser, MAGNOLIA, view, null));
  run.checkStages.push(await captureCheckStage(browser, TOWER3, view));
}
run.viewers.push(await capturePinnedViewer(browser, 'pinned-viewer-tower3-live', null));
run.viewers.push(await capturePinnedViewer(browser, 'mocked-pinned-viewer-tower3-statement', withStatement(citedId)));
run.candidateCards.push(await captureCandidateCard(browser, MAGNOLIA));
if (PHASE === 'after') {
  run.keyboard = await keyboardWalk(browser);
}
await browser.close();
run.refused = refused;
writeFileSync(resolve(OUT, `${PHASE}.json`), JSON.stringify(run));
console.log(JSON.stringify(run));
