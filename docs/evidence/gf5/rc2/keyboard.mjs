// RC2: a candidate card's level, its citation control by keyboard, and the stated size (mocked), read-only.
// Run with the Studio dev server against the demo API (ULPIN_API_TARGET=http://127.0.0.1:3194):
//   node docs/evidence/gf5/rc2/keyboard.mjs http://127.0.0.1:5217
// Writes shots/*.png and keyboard.json beside this file. Every request that is not a GET or a HEAD is aborted
// and listed under `refused`. No demo read holds a stated size, and the demo's build serves no estimate, so the
// last check answers the demo's building read with two fields added to one room in the browser: the line the
// vector reader read beside it (its retained output) and the estimate RC1 recorded for it. Its outputs are
// named `mocked-`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, '..', '..');
const VECTOR_RUN = join(EVIDENCE, 'gf-ai', 'plans', 'vector', '20261010-p1-panels', 'bihar', 'candidates.json');
const RC1_RESULT = join(EVIDENCE, 'gf5', 'rc1', 'result.json');
const STUDIO = process.argv[2] ?? 'http://127.0.0.1:5217';
const API = 'http://127.0.0.1:3194/api/v1';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
const KARNATAKA = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';
const CARD = '[class*="_inspector_"]';
const CITATION = `${CARD} section[aria-label="Citations"] button`;
const MAX_TABS = 400;

async function read(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return response.json();
}

function guard(page, refused) {
  return page.route('**/*', (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'HEAD') return route.fallback();
    refused.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort();
  });
}

async function textOf(page, selector) {
  const text = await page.locator(selector).first().evaluate((node) => (node.innerText ?? '').trim());
  return text.replace(/\s*\n+\s*/g, ' | ');
}

async function shot(page, selector, name) {
  await page.locator(selector).first().screenshot({ path: join(HERE, 'shots', `${name}.png`) });
  return `shots/${name}.png`;
}

/** Tab from the top of the page until the citation control has focus; the number of presses, or null. */
async function tabToCitation(page) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  for (let presses = 1; presses <= MAX_TABS; presses += 1) {
    await page.keyboard.press('Tab');
    const reached = await page.evaluate((selector) => document.activeElement?.matches(selector) ?? false, CITATION);
    if (reached) return presses;
  }
  return null;
}

async function citationByKeyboard(page, name) {
  const tabs = await tabToCitation(page);
  if (tabs === null) return { tabReaches: false };
  const control = page.locator(CITATION).first();
  const accessibleName = await control.getAttribute('aria-label');
  await page.keyboard.press('Enter');
  const dialog = page.locator('[role="dialog"]').first();
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(4000);
  const opened = {
    tabReaches: true, tabs, accessibleName, enterOpens: true,
    controls: await page.locator(CITATION).count(),
    viewerSays: (await textOf(page, '[role="dialog"]')).slice(0, 600),
    shot: await shot(page, '[role="dialog"]', name),
  };
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5000 });
  return opened;
}

async function openCard(page, path, candidateId) {
  await page.goto(`${STUDIO}${path}?candidate=${encodeURIComponent(candidateId)}`);
  await page.locator(`${CARD} h2`).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function levelLine(page) {
  const row = page.locator(`${CARD} dt:text-is("Level")`).first();
  return row.evaluate((node) => node.nextElementSibling?.textContent ?? null);
}

async function roomChecks(page, building) {
  const kitchen = building.candidates.find((candidate) => candidate.levelId);
  const staircase = building.candidates.find((candidate) => !candidate.levelId && !candidate.review);
  const path = `/studio/properties/${MAGNOLIA}/candidates`;
  await openCard(page, path, staircase.candidateId);
  const unattached = { room: staircase.labelLiteral, level: await levelLine(page) };
  await openCard(page, path, kitchen.candidateId);
  const attached = { room: kitchen.labelLiteral, level: await levelLine(page) };
  attached.shot = await shot(page, CARD, 'room-card');
  return { attached, unattached, citation: await citationByKeyboard(page, 'room-citation-open') };
}

async function roofprintChecks(page, area) {
  const roofprint = area.candidates.find((candidate) => candidate.kind === 'roofprint' && !candidate.review);
  await openCard(page, `/studio/areas/${KARNATAKA}/candidates`, roofprint.candidateId);
  const citation = await citationByKeyboard(page, 'roofprint-citation-open');
  return { candidate: roofprint.candidateId.slice(0, 8), citation };
}

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The line the vector reader read beside the room, as a stated size: its text as read and its own box. */
function readStatedSize(room) {
  const ref = room.outputRef.split('#/pages/2/candidates/')[1];
  const [line] = json(VECTOR_RUN).pages['2'].candidates[Number(ref)].output.statedDimensions;
  const [x0, y0, x1, y1] = line.bbox;
  const locator = { kind: 'region', page: 2, x: x0, y: y0, width: x1 - x0, height: y1 - y0, unit: 'pt' };
  return { literal: line.literal, citation: { ...room.citations[0], locator } };
}

/** The estimate RC1 recorded for the building's first room, in the shape the read publishes. */
function recordedEstimate(room) {
  const [{ areaM2, extentM }] = json(RC1_RESULT).demoRead.rooms;
  const basis = { method: 'polygon_area_in_plan_metres@1', scaleState: 'candidate',
    metresPerPdfPoint: room.planFrame.metresPerPdfPoint };
  return { state: 'estimated', areaM2, extentM, basis, limitations: [] };
}

/** The demo's building read with both fields added to its first room in the browser; nothing is sent. */
async function mockedStatedSize(page, building) {
  const [kitchen, ...others] = building.candidates;
  const stated = { ...kitchen, statedSize: readStatedSize(kitchen), planEstimate: recordedEstimate(kitchen) };
  await page.route(`**/api/v1/buildings/${MAGNOLIA}/canonical`, (route) => (
    route.fulfill({ json: { ...building, candidates: [stated, ...others] } })
  ));
  await openCard(page, `/studio/properties/${MAGNOLIA}/candidates`, kitchen.candidateId);
  const section = `${CARD} section[aria-label="Stated size"]`;
  if (!(await page.locator(section).count())) return { shown: false };
  const card = await textOf(page, CARD);
  return {
    shown: true,
    mocked: `statedSize and planEstimate added to ${kitchen.labelLiteral} in the browser`,
    cardSays: await textOf(page, section),
    estimateSays: await textOf(page, `${CARD} section[aria-label="Estimated size"]`),
    statedAboveEstimate: card.indexOf('Stated on the sheet') < card.indexOf('Estimated size'),
    controls: await page.locator(`${section} button`).count(),
    controlName: await page.locator(`${section} button`).first().getAttribute('aria-label'),
    shot: await shot(page, CARD, 'mocked-stated-size'),
  };
}

async function main() {
  mkdirSync(join(HERE, 'shots'), { recursive: true });
  const building = await read(`/buildings/${MAGNOLIA}/canonical`);
  const area = await read(`/areas/${KARNATAKA}/canonical`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const refused = [];
  await guard(page, refused);
  const result = {
    version: 'rc2-keyboard/1',
    studio: STUDIO,
    servedEstimate: building.candidates.some((candidate) => candidate.planEstimate),
    room: await roomChecks(page, building),
    roofprint: await roofprintChecks(page, area),
    statedSize: await mockedStatedSize(page, building),
    refused,
  };
  await browser.close();
  writeFileSync(join(HERE, 'keyboard.json'), `${JSON.stringify(result, null, 1)}\n`);
  console.log(JSON.stringify(result, null, 1));
}

await main();
