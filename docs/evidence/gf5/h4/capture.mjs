/**
 * H4 evidence, read-only (every non-GET request is aborted): the scene pane of the register page and of the
 * building workspace for the two buildings recorded without geometry, and the places that cite a source.
 * Usage: node docs/evidence/gf5/h4/capture.mjs <before|after>   (Studio dev server on 127.0.0.1:5199, API on 3194)
 * Each phase writes <phase>.json and its screenshots into <phase>/. The one answer the demo does not give, a
 * failed consolidated register read, is mocked in the browser; its screenshot is named "-mocked".
 */
import { writeFileSync } from 'node:fs';
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
const BUILDINGS = [
  { name: 'tower3', id: '6f95d04e-2067-4ac8-a3c2-6cc21ea46325' },
  { name: 'magnolia', id: 'e8777ffc-9409-4129-bacf-f680160d8795' },
];
const [TOWER3, MAGNOLIA] = BUILDINGS;
const REFUSED = { error: { code: 'REGISTRY_SOURCE_UNAVAILABLE', message: 'Mocked refusal.', requestId: 'mocked' } };

async function open(browser, path, view, refuseConsolidated = false) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const request = route.request();
    if (request.method() !== 'GET' && request.method() !== 'HEAD') return route.abort();
    const consolidated = new URL(request.url()).searchParams.get('profile') === 'consolidated';
    if (!refuseConsolidated || !consolidated) return route.continue();
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(REFUSED) });
  });
  await page.goto(`${STUDIO}${path}`);
  await page.waitForTimeout(SETTLE_MS);
  return { page, errors, context };
}

const shot = (page, name) => page.screenshot({ path: resolve(OUT, PHASE, `${name}.png`) });
const PANE = 'main [class*="_canvasWrap_"]';
/** The window as it stands, and at 200% a second shot with the scene pane brought to the middle of it. */
async function sceneShots(page, name, view) {
  await shot(page, `${name}-${view.name}`);
  if (view !== ZOOM) return;
  await page.locator(PANE).first().evaluate((pane) => pane.scrollIntoView({ block: 'center' }));
  await shot(page, `${name}-${view.name}-scene`);
}
const oneLine = (text) => text.replace(/\s*\n+\s*/g, ' | ').trim();
/** The text of the first element matching the selector, or null when the page has none. */
async function textOf(page, selector) {
  const element = page.locator(selector).first();
  return (await element.count()) ? oneLine(await element.innerText()) : null;
}

/** What the scene pane of a page holds: its words, how many canvases it draws, and whether it fits the window. */
async function sceneFacts(page) {
  return {
    pane: await textOf(page, PANE),
    canvases: await page.locator('main canvas').count(),
    fitsWidth: await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  };
}

/** The register page: its header line and its scene pane. */
async function captureRegister(browser, building, view) {
  const { page, errors, context } = await open(browser, `/studio/properties/${building.id}/register`, view);
  const facts = { header: await textOf(page, 'main header p'), ...await sceneFacts(page) };
  await sceneShots(page, `register-${building.name}`, view);
  await context.close();
  return { page: 'register', building: building.name, view: view.name, ...facts, pageErrors: errors };
}

/** The building workspace at its check stage, the one with a scene pane. */
async function captureWorkspace(browser, building, view) {
  const { page, errors, context } = await open(browser, `/studio/review/${building.id}?stage=check`, view);
  const facts = await sceneFacts(page);
  await sceneShots(page, `workspace-${building.name}`, view);
  await context.close();
  return { page: 'workspace', building: building.name, view: view.name, ...facts, pageErrors: errors };
}

/** The Documents tab: the whole Sources panel as text, live or with the consolidated read refused. */
async function captureDocuments(browser, name, refused) {
  const path = `/studio/properties/${TOWER3.id}/register?tab=documents`;
  const { page, context } = await open(browser, path, DESKTOP, refused);
  const panel = page.getByRole('heading', { name: 'Sources', exact: true }).locator('xpath=ancestor::section[1]');
  const text = oneLine(await panel.innerText());
  await shot(page, `documents-tab-${name}`);
  await context.close();
  return { name, panel: text };
}

/** What the evidence viewer's dialog says once the page's chip for a source file is pressed. */
async function viewerFacts(page, file, name) {
  await page.getByRole('button', { name: file }).first().click();
  await page.waitForTimeout(SETTLE_MS);
  const dialog = await textOf(page, '[role="dialog"]');
  await shot(page, `evidence-viewer-${name}`);
  return dialog?.slice(0, 400) ?? null;
}

/** The evidence viewer opened from the Documents tab of the register page. */
async function captureViewerFromDocuments(browser) {
  const path = `/studio/properties/${TOWER3.id}/register?tab=documents`;
  const { page, context } = await open(browser, path, DESKTOP);
  const dialog = await viewerFacts(page, /site-plan/, 'tower3');
  await context.close();
  return { opened: 'haryana-2831-site-plan.pdf from the Documents tab of the register page', dialog };
}

/** The evidence viewer opened from the Evidence tab of the map inspector. */
async function captureViewerFromInspector(browser) {
  const { page, context } = await open(browser, await inspectorPath(MAGNOLIA), DESKTOP);
  await page.getByRole('tab', { name: 'Evidence' }).first().click();
  const dialog = await viewerFacts(page, /magnolia/, 'magnolia');
  await context.close();
  return { opened: 'bihar-magnolia-sanctioned-layout-original.pdf from the map inspector', dialog };
}

/** The area map with the building selected: the address its inspector opens at. */
async function inspectorPath(building) {
  const register = await (await fetch(`${API}/api/v1/buildings/${building.id}/register`)).json();
  return `/studio/areas/${register.area.id}?feature=${building.id}&mode=building`;
}

/** The map inspector of a building, on its Evidence tab. */
async function captureInspector(browser, building) {
  const { page, context } = await open(browser, await inspectorPath(building), DESKTOP);
  const tab = page.getByRole('tab', { name: 'Evidence' });
  const reached = (await tab.count()) > 0;
  if (reached) await tab.first().click();
  await page.waitForTimeout(1000);
  const inspector = await textOf(page, 'aside[aria-label="Inspector"]');
  await shot(page, `inspector-evidence-${building.name}`);
  await context.close();
  return { building: building.name, reached, inspector };
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

const browser = await chromium.launch();
const run = { scenes: [], documents: [], inspectors: [], candidateCards: [], viewers: [] };
for (const building of BUILDINGS) {
  for (const view of [DESKTOP, ZOOM]) {
    run.scenes.push(await captureRegister(browser, building, view));
    run.scenes.push(await captureWorkspace(browser, building, view));
  }
  run.inspectors.push(await captureInspector(browser, building));
  run.candidateCards.push(await captureCandidateCard(browser, building));
}
run.documents.push(await captureDocuments(browser, 'tower3-live', false));
run.documents.push(await captureDocuments(browser, 'tower3-refused-mocked', true));
run.viewers.push(await captureViewerFromDocuments(browser));
run.viewers.push(await captureViewerFromInspector(browser));
await browser.close();
writeFileSync(resolve(OUT, `${PHASE}.json`), JSON.stringify(run));
console.log(JSON.stringify(run));
