// H6: the judges' five steps, walked by clicks from the Studio's first screen at 1440 wide, read-only.
// Run with the Studio dev server on 127.0.0.1:5199 against the demo API:
//   node docs/evidence/gf5/h6/capture.mjs
// Writes shots/*.png and captured.json beside this file. Every request that is not a GET, a HEAD or one of
// the two card reads the Studio sends as POST is aborted and listed under `refused`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = 'http://127.0.0.1:5199';
const CARD_READS = ['/usp/identity/resolve', '/usp/property-cards/list'];
const TOWER3 = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
const TABLE = '/studio/work/cases/1ada7796-4e8f-4a19-9b7f-4414e80114c4/tables/d6dffbcc-7ee0-4467-9ddf-4952bd23c33c';
const FIRST = { say: 'The first screen', url: '/', shot: null };
const CARD = '[class*="_inspector_"]';

const nav = (name) => (page) => page.getByRole('link', { name, exact: true }).first();
const link = (name) => (page) => page.getByRole('link', { name }).first();
const tab = (name) => (page) => page.getByRole('tab', { name }).first();
const css = (selector, hasText) => (page) => page.locator(selector, hasText ? { hasText } : undefined).first();
const batch = (text) => css('main a', text);
const candidate = (text) => css('ul[aria-label="Candidates"] button', text);
const filter = (text) => css('[aria-label="Filter by state"] button', text);

const STEPS = [
  { step: 0, title: 'First screen', actions: [{ ...FIRST, shot: '0-first', read: 'main', max: 900, reached: true }] },
  { step: 1, title: 'The map', actions: [
    FIRST,
    { say: 'Map (side navigation)', click: nav('Map'), shot: '1-map', read: 'main', reached: true, wait: 7000 },
    { say: 'Tools', click: css('main summary', 'Tools') },
    { say: 'Layers', click: css('main button', 'Layers'), shot: '1-layers', read: 'section[aria-label="Layers"]' },
    { say: 'Review candidates', click: link('Review candidates'), shot: '1-candidates', read: 'main', wait: 7000 },
    { say: 'Filter: Needs review', click: filter('Needs review') },
    { say: 'The first candidate that needs review', click: candidate(), shot: '1-needs-review', read: CARD,
      max: 1700 },
    { say: 'Filter: Reviewed', click: filter('Reviewed') },
    { say: 'The reviewed candidate', click: candidate(), shot: '1-reviewed', read: CARD, max: 900 },
    { say: 'Its Registry section', scroll: 'section[aria-label="Registry"]', shot: '1-reviewed-registry',
      read: 'section[aria-label="Registry"]' },
    FIRST,
    { say: 'Batch row: Imagery footprint review 74d6fc25', click: batch('Imagery footprint review'),
      shot: '1-package', read: 'main', max: 700, wait: 7000 },
    FIRST,
    { say: 'Register (side navigation)', click: nav('Register'), shot: '1-registry', read: 'main' },
    { say: 'Buildings', click: css('main :text-is("Buildings")'), shot: '1-registry-buildings', read: 'main' },
    { say: 'Reviewed roof projection candidate', click: css('main a', 'Reviewed roof projection candidate'),
      shot: '1-listed-building', read: 'main' },
  ] },
  { step: 2, title: 'Tower 3', actions: [
    FIRST,
    { say: 'Batch row: Haryana RERA 2831, TOWER 3 source records', click: batch('TOWER 3 source records'),
      shot: '2-map', read: 'main', wait: 7000 },
    { say: 'Open register of TOWER 3', click: link('Open register of TOWER 3'), shot: '2-register',
      read: 'main header', reached: true, wait: 7000 },
    { say: 'The citation of UNIT-3B', click: css('main [class*="_citation_"] button'), shot: '2-cited-region',
      read: '[role="dialog"]', wait: 6000 },
    { say: 'Close the viewer (Escape)', key: 'Escape', wait: 1000 },
    { say: 'Documents', click: tab('Documents'), shot: '2-documents', read: '[class*="_tabBody_"]' },
    { say: 'Checks', click: tab('Checks'), shot: '2-checks', read: '[role="tablist"]' },
    { say: 'History', click: tab('History'), shot: '2-history', read: '[class*="_tabBody_"]', max: 400 },
    { say: 'Back to map', click: link('Back to map'), shot: '2-inspector', read: 'aside[aria-label="Inspector"]',
      wait: 7000 },
  ] },
  { step: 3, title: 'A live import', actions: [
    FIRST,
    { say: 'Batch row: TNHB scheme register table (Continue import)', click: batch('TNHB scheme register table'),
      shot: '3-continue-import', read: 'main' },
    { say: 'Back to Batches', click: link('Back to Batches') },
    { say: 'Add files', click: link('Add files'), shot: '3-add-files', read: '[role="dialog"]' },
    { say: 'The table page of the TNHB case, by typed URL', url: TABLE, shot: '3-table', read: 'main', max: 1500,
      wait: 9000 },
    { say: 'The learner panel on that page', scroll: 'section[aria-label="Mapping learner"]', shot: '3-learner',
      read: 'section[aria-label="Mapping learner"]', max: 700 },
  ] },
  { step: 4, title: 'Rooms and units (Magnolia)', actions: [
    FIRST,
    { say: 'Batch row: Magnolia Residency', click: batch('Magnolia Residency'), shot: '4-map', read: 'main',
      wait: 7000 },
    { say: 'Open register of Magnolia Residency', click: link('Open register of Magnolia Residency'),
      shot: '4-register', read: '[class*="_tabBody_"]', wait: 7000 },
    { say: 'Back to map', click: link('Back to map'), shot: '4-map-selected', read: 'main', max: 900, wait: 7000 },
    { say: 'Review candidates', click: link('Review candidates'), shot: '4-candidates', read: 'main', max: 700,
      reached: true, wait: 7000 },
    { say: 'The candidate KITCHEN', click: candidate('KITCHEN'), shot: '4-kitchen', read: CARD, max: 1500 },
  ] },
  { step: 5, title: 'Identity and card', actions: [
    FIRST,
    { say: 'Batch row: Haryana RERA 2831, TOWER 3 source records', click: batch('TOWER 3 source records'),
      wait: 7000 },
    { say: 'Open register of TOWER 3', click: link('Open register of TOWER 3'), shot: '5-units',
      read: '[class*="_tabBody_"]', max: 900, reached: true, wait: 7000 },
    { say: 'Verification, revision 1', click: link('Verification, revision 1'), shot: '5-verification',
      read: 'body', max: 1100, wait: 6000 },
  ] },
  { step: 6, title: 'The building workspace (no click path leads to it for these buildings)', actions: [
    { say: 'Tower 3, Review details, by typed URL', url: `/studio/review/${TOWER3}`, shot: 'w-review-tower3',
      read: 'main', wait: 7000 },
    { say: 'Tower 3, Check and record, by typed URL', url: `/studio/review/${TOWER3}?stage=check`,
      shot: 'w-check-tower3', read: 'main [class*="_side_"]', wait: 7000 },
    { say: 'Magnolia, Check and record, by typed URL', url: `/studio/review/${MAGNOLIA}?stage=check`,
      shot: 'w-check-magnolia', read: 'main [class*="_side_"]', wait: 7000 },
  ] },
];

function allowed(request) {
  if (request.method() === 'GET' || request.method() === 'HEAD') return true;
  const { pathname } = new URL(request.url());
  return request.method() === 'POST' && CARD_READS.some((read) => pathname.endsWith(read));
}

function watch(page, seen) {
  page.on('console', (message) => {
    if (message.type() === 'error') seen.consoleErrors.add(message.text().slice(0, 160));
  });
  page.on('response', (response) => {
    const { pathname } = new URL(response.url());
    const failed = pathname.startsWith('/api/') && response.status() >= 400;
    if (failed) seen.failedReads.add(`${response.status()} ${pathname}`);
  });
  return page.route('**/*', (route) => {
    const request = route.request();
    if (allowed(request)) return route.continue();
    seen.refused.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort();
  });
}

async function textOf(page, selector, max) {
  const element = page.locator(selector).first();
  if (!(await element.count())) return null;
  const text = await element.evaluate((node) => (node.innerText ?? node.textContent ?? '').trim());
  return text.replace(/\s*\n+\s*/g, ' | ').slice(0, max);
}

async function perform(page, action) {
  if (action.url) await page.goto(`${STUDIO}${action.url}`);
  if (action.click) await action.click(page).click({ timeout: 10000 });
  if (action.key) await page.keyboard.press(action.key);
  if (action.scroll) await page.locator(action.scroll).first().evaluate((node) => node.scrollIntoView());
  await page.waitForTimeout(action.wait ?? 4000);
  if (action.shot) await page.screenshot({ path: join(HERE, 'shots', `${action.shot}.png`) });
}

async function record(page, action, clicks) {
  const entry = { say: action.say, clicks, at: new URL(page.url()).pathname + new URL(page.url()).search };
  if (action.url && action.url !== '/') entry.typedUrl = true;
  if (action.shot) entry.shot = `shots/${action.shot}.png`;
  if (action.read) entry.states = await textOf(page, action.read, action.max ?? 500);
  return entry;
}

async function walk(page, step) {
  const result = { step: step.step, title: step.title, reachedIn: null, actions: [] };
  let clicks = 0;
  for (const action of step.actions) {
    try {
      await perform(page, action);
    } catch (error) {
      result.actions.push({ say: action.say, failed: String(error.message).split('\n')[0].slice(0, 160) });
      break;
    }
    if (action === FIRST) clicks = 0;
    if (action.click) clicks += 1;
    if (action.reached) result.reachedIn = clicks;
    if (action !== FIRST) result.actions.push(await record(page, action, clicks));
  }
  return result;
}

async function main() {
  mkdirSync(join(HERE, 'shots'), { recursive: true });
  const seen = { refused: [], consoleErrors: new Set(), failedReads: new Set() };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await watch(page, seen);
  const steps = [];
  for (const step of STEPS) steps.push(await walk(page, step));
  await browser.close();
  const captured = {
    viewport: '1440x900', allowedWrites: CARD_READS, refused: seen.refused, steps,
    failedReads: [...seen.failedReads].sort(), consoleErrors: [...seen.consoleErrors],
  };
  writeFileSync(join(HERE, 'captured.json'), `${JSON.stringify(captured)}\n`);
  console.log(`steps ${steps.length}; refused ${seen.refused.length}`);
  for (const step of steps) {
    const failed = step.actions.filter((entry) => entry.failed).map((entry) => `${entry.say}: ${entry.failed}`);
    console.log(`step ${step.step}: reached in ${step.reachedIn}; actions ${step.actions.length}`, failed);
  }
}

await main();
