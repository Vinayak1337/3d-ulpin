// H8: every screen this task changes, read at 1440 wide and at 200% zoom, read-only.
//   node docs/evidence/gf5/h8/capture.mjs before   (staging, before the fixes)
//   node docs/evidence/gf5/h8/capture.mjs after    (the task branch)
//   node docs/evidence/gf5/h8/capture.mjs after <screen>   (one screen while working; writes no JSON)
// Run with the Studio dev server of this worktree on 127.0.0.1:5198 (5199 was another worker's that evening)
// against the demo API. Writes <state>/*.png and <state>.json beside this file. Every request that is not a
// GET, a HEAD or one of the two card reads is refused and listed. Nothing is clicked.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = process.argv[2] === 'after' ? 'after' : 'before';
const ONLY = process.argv[3] ?? null;
const STUDIO = 'http://127.0.0.1:5198';
const CARD_READS = ['/usp/identity/resolve', '/usp/property-cards/list'];
const TOWER3 = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const VIEWS = [
  { name: '1440', width: 1440, height: 900, scale: 1 },
  { name: '200pct', width: 640, height: 360, scale: 2 },
];
const SCREENS = [
  { name: 'batches', path: '/studio/work', read: 'main [role="table"]' },
  { name: 'residents', path: `/studio/properties/${TOWER3}/register?tab=residents`, read: '[class*="_tabBody_"]' },
  { name: 'register-buildings', path: '/studio/registry?tab=buildings', read: 'main table' },
  { name: 'workspace-check', path: `/studio/review/${TOWER3}?stage=check`, read: 'main [class*="_recordFoot_"]' },
];

// Step 0 of item 4 and the module of item 3, as read in the code and the demo's answers on staging (39ed2dbb).
const STEP0 = {
  buildingColumns: [
    { header: '3D ULPIN (proposed)', column: 'apps/studio/src/features/register/RequestsPage.tsx:271',
      readsFrom: 'featureCode(b): the feature\'s projectCode, apps/studio/src/api/queries.ts:367-368 (a cast)',
      inTheRead: 'no: a feature of GET /api/v1/areas/{areaId}/context has no projectCode (schema and all 65 '
        + 'building features of the demo\'s 4 areas). Only the local layer adds it: local/public.ts:135, '
        + 'local/story.ts:40, api/demo-import.ts:9',
      assignmentStateInTheRead: 'none' },
    { header: 'Building identifier', column: 'apps/studio/src/features/register/RequestsPage.tsx:272',
      readsFrom: 'b.identifier: features[].identifier of GET /api/v1/areas/{areaId}/context',
      inTheRead: 'yes: a string on all 65 building features of the demo, of the form 3DU-…:B001' },
  ],
  sameIdentity: false,
  recordTitle: { builtIn: 'apps/studio/src/features/review/WorkspacePage.tsx:377 (inline in the button\'s click)',
    today: '`r${revision + 1} Recorded`',
    movesTo: 'apps/studio/src/features/review/recordTitle.ts (new, pure, with its test)' },
};

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

/** Whether the page scrolls sideways, and whether the read element lies inside the window's width. */
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

async function capture(context, seen, screen, view) {
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
  await page.goto(`${STUDIO}${screen.path}`);
  await page.waitForTimeout(6000);
  const entry = { screen: screen.name, view: view.name, states: await textOf(page, screen.read),
    ...(await fit(page, screen.read)), consoleErrors: [...new Set(errors)] };
  const target = page.locator(screen.read).first();
  if (await target.count()) await target.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: join(HERE, STATE, `${screen.name}-${view.name}.png`) });
  await page.close();
  return entry;
}

async function main() {
  mkdirSync(join(HERE, STATE), { recursive: true });
  const seen = { refused: [] };
  const browser = await chromium.launch();
  const screens = [];
  for (const view of VIEWS) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
    });
    const wanted = SCREENS.filter((screen) => !ONLY || screen.name === ONLY);
    for (const screen of wanted) screens.push(await capture(context, seen, screen, view));
    await context.close();
  }
  await browser.close();
  const result = { state: STATE, refused: seen.refused, ...(STATE === 'before' ? { step0: STEP0 } : {}), screens };
  if (!ONLY) writeFileSync(join(HERE, `${STATE}.json`), `${JSON.stringify(result)}\n`);
  for (const entry of screens) console.log(JSON.stringify(entry));
  console.log(`refused ${seen.refused.length}`);
}

await main();
