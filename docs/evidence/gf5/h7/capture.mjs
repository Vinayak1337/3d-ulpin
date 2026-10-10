// H7: every screen this task changes, read at 1440 wide and at 200% zoom, read-only.
//   node docs/evidence/gf5/h7/capture.mjs before   (staging, before the fixes)
//   node docs/evidence/gf5/h7/capture.mjs after    (the task branch)
//   node docs/evidence/gf5/h7/capture.mjs after <screen>   (one screen while working; writes no JSON)
// Run with the Studio dev server on 127.0.0.1:5199 against the demo API. Writes <state>/*.png and <state>.json
// beside this file. Every request that is not a GET, a HEAD or one of the two card reads is refused and listed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = process.argv[2] === 'after' ? 'after' : 'before';
const ONLY = process.argv[3] ?? null;
const STUDIO = 'http://127.0.0.1:5199';
const CARD_READS = ['/usp/identity/resolve', '/usp/property-cards/list'];
const TOWER3 = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const CANDIDATE = 'a2ea9cd6-da0d-413a-9a48-03d7f25cd5e4';
const CASES = {
  oneTable: '1ada7796-4e8f-4a19-9b7f-4414e80114c4',
  fiveTables: '4ad9cb6d-56c0-445e-a9b6-357d1dc1d452',
  noSource: '6d183fef-bcaf-40f6-90dc-2694bc9873a5',
  noTable: 'a73b66c7-8eca-4b29-893f-a46c06dba7bb',
};
const TABLE = 'd6dffbcc-7ee0-4467-9ddf-4952bd23c33c';
const VIEWS = [
  { name: '1440', width: 1440, height: 900, scale: 1 },
  { name: '200pct', width: 640, height: 360, scale: 2 },
];
const SCREENS = [
  { name: 'register-index', path: '/studio/registry', read: 'main' },
  { name: 'register-buildings', path: '/studio/registry?tab=buildings', read: 'main' },
  { name: 'candidate-register', path: `/studio/properties/${CANDIDATE}/register`, read: 'main' },
  { name: 'case-one-table', path: `/studio/cases/${CASES.oneTable}`, read: 'main' },
  { name: 'case-five-tables', path: `/studio/cases/${CASES.fiveTables}`, read: 'main' },
  { name: 'case-no-source', path: `/studio/cases/${CASES.noSource}`, read: 'main' },
  { name: 'case-no-table', path: `/studio/cases/${CASES.noTable}`, read: 'main' },
  { name: 'table-columns', path: `/studio/work/cases/${CASES.oneTable}/tables/${TABLE}`,
    read: 'section[aria-label="Column mapping candidates"] tbody tr' },
  { name: 'workspace-check', path: `/studio/review/${TOWER3}?stage=check`, read: 'main [class*="_top_"]' },
  { name: 'workspace-review', path: `/studio/review/${TOWER3}`, read: 'main' },
  { name: 'register-history', path: `/studio/properties/${TOWER3}/register?tab=history`,
    read: '[class*="_tabBody_"]' },
  { name: 'register-header', path: `/studio/properties/${TOWER3}/register`, read: 'main header' },
];

function allowed(request) {
  if (request.method() === 'GET' || request.method() === 'HEAD') return true;
  const { pathname } = new URL(request.url());
  return request.method() === 'POST' && CARD_READS.some((read) => pathname.endsWith(read));
}

async function textOf(page, selector) {
  const element = page.locator(selector).first();
  if (!(await element.count())) return null;
  const text = await element.evaluate((node) => (node.innerText ?? node.textContent ?? '').trim());
  return text.replace(/\s*\n+\s*/g, ' | ').slice(0, 900);
}

/** Whether the page scrolls sideways, and the height of the read element (a change of it is a layout shift). */
function fit(page, selector) {
  return page.evaluate((target) => {
    const box = document.querySelector(target)?.getBoundingClientRect();
    return {
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
      insideWidth: box ? box.left >= 0 && box.right <= window.innerWidth : null,
      heightPx: box ? Math.round(box.height) : null,
    };
  }, selector);
}

async function open(context, seen) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().split('\n')[0].slice(0, 160));
  });
  await page.route('**/*', (route) => {
    if (allowed(route.request())) return route.continue();
    seen.refused.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
  return { page, errors };
}

async function capture(context, seen, screen, view) {
  const { page, errors } = await open(context, seen);
  await page.goto(`${STUDIO}${screen.path}`);
  await page.waitForTimeout(6000);
  const at = new URL(page.url());
  const entry = { screen: screen.name, view: view.name, at: `${at.pathname}${at.search}`,
    states: await textOf(page, screen.read), ...(await fit(page, screen.read)) };
  // React's duplicate-key report and failed reads; the 404 of a read the demo does not serve is expected.
  entry.consoleErrors = [...new Set(errors)];
  const target = page.locator(screen.read).first();
  if (await target.count()) await target.evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(HERE, STATE, `${screen.name}-${view.name}.png`) });
  await page.close();
  return entry;
}

/** The click a person makes: the first row of Batches whose action is "Continue import", and where it lands. */
async function continueImport(context, seen) {
  const { page } = await open(context, seen);
  await page.goto(`${STUDIO}/studio/work`);
  const row = page.locator('a[role="row"]', { hasText: 'Continue import' }).first();
  await row.waitFor({ timeout: 15000 });
  const batch = (await row.locator('b').first().innerText()).trim();
  await row.click();
  await page.waitForTimeout(6000);
  const at = new URL(page.url());
  const states = await textOf(page, 'main h1, main h2, main h3');
  await page.close();
  return { batch, landsOn: `${at.pathname}${at.search}`, heading: states };
}

async function main() {
  mkdirSync(join(HERE, STATE), { recursive: true });
  const seen = { refused: [] };
  const browser = await chromium.launch();
  const screens = [];
  let click = null;
  for (const view of VIEWS) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
    });
    const wanted = SCREENS.filter((screen) => !ONLY || screen.name === ONLY);
    for (const screen of wanted) screens.push(await capture(context, seen, screen, view));
    if (view.name === '1440' && !ONLY) click = await continueImport(context, seen);
    await context.close();
  }
  await browser.close();
  const result = { state: STATE, refused: seen.refused, continueImport: click, screens };
  if (!ONLY) writeFileSync(join(HERE, `${STATE}.json`), `${JSON.stringify(result)}\n`);
  for (const entry of screens) console.log(JSON.stringify(entry));
  console.log(JSON.stringify(click));
  console.log(`refused ${seen.refused.length}`);
}

await main();
