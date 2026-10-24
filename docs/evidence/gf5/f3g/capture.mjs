// Browser checks behind the F3g screenshots. Live reads unless a file is named mocked-* or local-layer-*; no write
// reaches the API. Run from the repository root with both Studio dev servers up (result.json names them):
//   node docs/evidence/gf5/f3g/capture.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.F3G_STUDIO ?? 'http://127.0.0.1:5190';
// The same Studio with its local data layer on (VITE_LOCAL_DATA=on): the only build that answers the portal reads.
const localStudio = process.env.F3G_LOCAL_STUDIO ?? 'http://127.0.0.1:5191';
const f3d = JSON.parse(readFileSync(resolve(out, '../f3d/responses.json'), 'utf8'));
const { buildingId: TOWER, spaceId: UNIT } = f3d;
const AREA = f3d.snapshots.siteId;
const LIST = '/api/v1/usp/property-cards/list';
const LABELS = {
  'mocked-': 'Mocked response · not a registry record',
  'local-layer-': 'Local data layer · not the demo API',
};
const WIDE = { viewport: { width: 1440, height: 900 } };
// A 1440 x 900 window at 200% browser zoom: 720 x 450 CSS px, two device pixels per CSS pixel.
const ZOOMED = { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 };
const areaUrl = `${studio}/studio/areas/${AREA}?feature=${TOWER}`;
const candidatesUrl = `${studio}/studio/properties/${TOWER}/candidates`;
const screenshots = [];
const requests = new Map();
const blockedWrites = [];
const pageErrors = [];
/** The answer that replaces the live card list for the mocked screenshot: { list: { status, json } }. */
let mock = {};

/** Counts every API request by method and route, lets only reads through, and applies the current mock. */
async function guard(route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const read = request.method() === 'GET' || (request.method() === 'POST' && path === LIST);
  if (!read) {
    blockedWrites.push(`${request.method()} ${path}`);
    return route.abort('blockedbyclient');
  }
  const mocked = path === LIST ? mock.list : undefined;
  const key = `${mocked ? 'mocked ' : ''}${request.method()} ${path.replace(/[0-9a-f-]{36}/g, '{id}')}`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  return mocked ? route.fulfill(mocked) : route.continue();
}

async function capture(page, file, notes) {
  await page.evaluate(() => document.fonts.ready);
  const prefix = Object.keys(LABELS).find((start) => file.startsWith(start));
  if (prefix) {
    await page.evaluate((text) => {
      const tag = document.createElement('div');
      tag.id = 'capture-label';
      tag.textContent = text;
      // Visible in print media too, where the page hides everything but the card.
      Object.assign(tag.style, { position: 'fixed', bottom: '8px', right: '16px', zIndex: '9999', visibility: 'visible',
        padding: '8px 12px', background: 'var(--ui-surface)', color: 'var(--ui-ink)',
        border: '1px solid var(--ui-border-strong)', font: '500 13px var(--ui-font-sans)' });
      document.body.append(tag);
    }, LABELS[prefix]);
  }
  await page.screenshot({ path: resolve(out, file), animations: 'disabled' });
  await page.locator('#capture-label').evaluateAll((tags) => tags.forEach((tag) => tag.remove()));
  screenshots.push({ file, mode: prefix ? prefix.slice(0, -1) : 'live', notes });
}

const isApi = (url) => url.pathname.startsWith('/api/');
const inspectorOf = (page) => page.getByRole('complementary', { name: 'Inspector', exact: true });

async function open(browser, size, origin = studio) {
  // Service workers are blocked so that every request of a page passes the guard, the local data layer's too.
  const context = await browser.newContext({ ...size, serviceWorkers: 'block' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.route(isApi, guard);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return page;
}

async function selectBuilding(page) {
  await page.goto(areaUrl);
  await expect(inspectorOf(page).getByRole('heading', { level: 2 })).toContainText(/tower 3/i);
  // The action of a building whose floors have loaded; before that the inspector still shows placeholders.
  await expect(inspectorOf(page).getByRole('button', { name: 'Explore floors', exact: true })).toBeVisible();
}

/** UNIT-3B has no geometry to click on the map: it is chosen in the Tools list of its floor. */
async function selectUnit(page) {
  await page.goto(areaUrl);
  const tools = page.locator('details').first();
  await expect(tools).toContainText('TOWER 3');
  // A narrow window keeps the Tools closed.
  if (!(await tools.evaluate((node) => node.open))) await tools.locator('summary').first().click();
  await tools.getByText('View', { exact: true }).click();
  await tools.getByText('Floors', { exact: true }).click();
  await tools.getByText('UNIT-3B', { exact: true }).click();
  await expect(inspectorOf(page).getByRole('heading', { level: 2 })).toHaveText('UNIT-3B');
  await expect(inspectorOf(page)).toContainText('Listed by the registry');
}

/**
 * The inspector's boxes, measured: the box above the actions (header, tabs, body), which of them scrolls, and
 * whether every control of the footer lies whole inside the inspector.
 */
function room(page) {
  return inspectorOf(page).evaluate((node) => {
    const [above, footer] = node.children;
    const box = node.getBoundingClientRect();
    const body = above.lastElementChild;
    const controls = [...footer.querySelectorAll('button, a')].map((control) => control.getBoundingClientRect());
    return {
      heightPx: Math.round(box.height),
      headerPx: Math.round(above.querySelector('header').getBoundingClientRect().height),
      widthOverflowPx: Math.max(above.scrollWidth, body.scrollWidth) - node.clientWidth,
      aboveShownPx: above.clientHeight,
      aboveContentPx: above.scrollHeight,
      aboveScrolls: getComputedStyle(above).overflowY === 'auto',
      bodyScrolls: getComputedStyle(body).overflowY === 'auto',
      bodyShownPx: body.clientHeight,
      footerControls: controls.length,
      footerControlsWhole: controls.every((rect) => rect.top >= box.top && rect.bottom <= box.bottom
        && rect.left >= box.left && rect.right <= box.right),
    };
  });
}

/** Scrolls the one region above the actions to its end and says whether the last row is then in view. */
function lastRowAfterScroll(page) {
  return inspectorOf(page).evaluate((node) => {
    const above = node.firstElementChild;
    above.scrollTop = above.scrollHeight;
    const region = above.getBoundingClientRect();
    const rows = [...above.querySelectorAll('dt')];
    const last = rows.at(-1).getBoundingClientRect();
    return { rows: rows.length, lastRow: rows.at(-1).textContent, scrolledPx: Math.round(above.scrollTop),
      lastRowInView: last.top >= region.top && last.bottom <= region.bottom };
  });
}

async function wideInspectors(page) {
  await selectBuilding(page);
  const building = await room(page);
  assert.ok(building.bodyScrolls && !building.aboveScrolls, 'at 900 px high the header stays and the body scrolls');
  assert.ok(building.footerControlsWhole && building.widthOverflowPx <= 0);
  await capture(page, '01-live-1440-building-inspector.png', 'Map, Tower 3 at 1440 x 900: the building inspector '
    + 'in the same shell; header and tabs stay, the body scrolls, the actions are whole.');
  await selectUnit(page);
  const space = await room(page);
  assert.ok(space.bodyScrolls && !space.aboveScrolls && space.footerControlsWhole && space.widthOverflowPx <= 0);
  const inline = await inspectorOf(page).locator('header .ul-mono').getAttribute('style');
  assert.equal(inline, null, 'the record identifier carries no inline style');
  await capture(page, '02-live-1440-space-inspector.png', 'UNIT-3B at 1440 x 900: the identifier wraps by the '
    + 'stylesheet, nothing is cut on the right, Property Card is whole.');
  return { building, space, identifierInlineStyle: inline };
}

/** A copy control reached with the keyboard: the ring is measured against the code box that would clip it. */
async function focusedCopy(page, copy, expected) {
  await copy.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(copy).toBeFocused();
  const ring = await copy.evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.parentElement.getBoundingClientRect();
    const own = node.getBoundingClientRect();
    const offset = parseFloat(style.outlineOffset);
    return { outline: `${style.outlineWidth} ${style.outlineStyle}`, offsetPx: offset,
      insideCodeBox: own.top - offset >= box.top && own.bottom + offset <= box.bottom
        && own.left - offset >= box.left && own.right + offset <= box.right,
      boxClips: getComputedStyle(node.parentElement).overflow === 'hidden' };
  });
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected, 'the exact string is copied');
  assert.ok(ring.insideCodeBox && ring.outline === '2px solid', 'a 2 px ring drawn inside the code box');
  return { ...ring, copiedExact: true };
}

async function copyOnVerification(page) {
  await inspectorOf(page).getByRole('button', { name: 'Property Card', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Verification, revision 1', exact: true }).click();
  const main = page.getByRole('main');
  await expect(main.getByText('Passed', { exact: true })).toHaveCount(6);
  const cardId = new URL(page.url()).pathname.split('/')[3];
  const ring = await focusedCopy(page, main.getByRole('button', { name: `Copy card id ${cardId}`, exact: true }),
    cardId);
  await capture(page, '03-live-verification-copy-focus.png', 'The verification page of the live card: the copy '
    + 'control of the card id focused with the keyboard; the ring is whole, inside the code box.');
  return ring;
}

async function copyOnRecordedUnit(page) {
  await page.goto(candidatesUrl);
  const copy = page.getByRole('button', { name: /^Copy code / }).first();
  await expect(copy).toBeVisible();
  const code = (await copy.getAttribute('aria-label')).slice('Copy code '.length);
  await copy.scrollIntoViewIfNeeded();
  const ring = await focusedCopy(page, copy, code);
  await capture(page, '04-live-recorded-unit-copy-focus.png', 'The recorded unit on the review page: the copy '
    + 'control of its application code (now the same component) focused with the keyboard.');
  return { ...ring, controls: await page.getByRole('button', { name: /^Copy code / }).count() };
}

/** A draft made the way the Studio makes one: its own local workflow module, in this capture browser only. */
function makeDraft(page) {
  return page.evaluate(async ({ buildingId, spaceId }) => {
    const register = await (await fetch(`/api/v1/buildings/${buildingId}/register`)).json();
    const unit = register.register.find((record) => record.id === spaceId);
    const workflow = await import('/src/local/workflow.ts');
    const draft = await workflow.assignProposedCode({ spaceId, buildingId, spaceName: unit.name,
      recordRevision: unit.revision });
    return { code: draft.code, revision: draft.events[0].revision };
  }, { buildingId: TOWER, spaceId: UNIT });
}

/** The draft card of the dialog (the card list mocked as empty, so the draft opens) and the draft verify page. */
async function draftCard(page) {
  const draft = await makeDraft(page);
  mock = { list: { status: 200, json: { data: { items: [], truncated: false }, meta: {} } } };
  await selectUnitMocked(page);
  await inspectorOf(page).getByRole('button', { name: 'Property Card', exact: true }).click();
  const card = page.getByRole('dialog').locator('.ul-card');
  await expect(card).toContainText('3D ULPIN (proposed) · Draft');
  await expect(card).toContainText('Draft made');
  await expect(card).not.toContainText('Assigned');
  await capture(page, 'mocked-05-draft-card-dialog.png', 'Card list mocked as empty and a draft made in this capture '
    + 'browser: the draft card labels its code Draft and its day "Draft made"; no "Assigned".');
  mock = {};
  await page.goto(`${studio}/verify/${encodeURIComponent(draft.code)}?rev=${draft.revision}`);
  const main = page.getByRole('main');
  await expect(main).toContainText('Draft made');
  await expect(main).not.toContainText('Assigned');
  await capture(page, '06-live-draft-verify-draft-made.png', 'The verify page of that draft (live reads for its '
    + 'facts): the day row reads "Draft made".');
  return { dialogCard: '3D ULPIN (proposed) · Draft; Draft made; no "Assigned"', verifyPage: 'Draft made' };
}

async function selectUnitMocked(page) {
  await page.goto(areaUrl);
  const tools = page.locator('details').first();
  await tools.getByText('View', { exact: true }).click();
  await tools.getByText('Floors', { exact: true }).click();
  await tools.getByText('UNIT-3B', { exact: true }).click();
  await expect(inspectorOf(page)).toContainText('3D ULPIN (proposed) · Draft');
}

/** Lake View as the local layer serves it after its imports, and a draft code, both made in this browser only. */
function localDraft(page) {
  return page.evaluate(async () => {
    const day = 24 * 60 * 60 * 1000;
    (await import('/src/local/session.ts')).writeSession({ areaStartedAt: Date.now() - day,
      floorsStartedAt: Date.now() - day });
    const { lake } = await import('/src/local/sources.ts');
    const flats = lake.register.register.filter((record) => record.kind === 'space' && record.use === 'apartment');
    const reviewed = new Set(lake.ledger.spaces.filter((space) => space.status === 'reviewed')
      .map((space) => space.spaceId));
    const unit = flats.find((flat) => !reviewed.has(flat.id));
    const workflow = await import('/src/local/workflow.ts');
    await workflow.assignProposedCode({ spaceId: unit.id, buildingId: lake.register.property.id,
      spaceName: unit.name, recordRevision: unit.revision });
    return { unit: unit.id, name: unit.name };
  });
}

async function printedCard(browser) {
  const page = await open(browser, WIDE, localStudio);
  await page.goto(`${localStudio}/portal`);
  const made = await localDraft(page);
  await page.goto(`${localStudio}/portal/records/${made.unit}`);
  await expect(page.getByRole('main')).toContainText('3D ULPIN (proposed) · Draft');
  await page.emulateMedia({ media: 'print' });
  const card = page.locator('.ul-card');
  await expect(card).toContainText('3D ULPIN (proposed) · Draft');
  await expect(card).not.toContainText('Assigned');
  await capture(page, 'local-layer-07-portal-printed-draft-card.png', `Local data layer, ${made.name}, as print `
    + 'media: the card that Download prints labels its code Draft.');
  await page.context().close();
  return { record: made.name, codeLabel: '3D ULPIN (proposed) · Draft', assignedPrinted: false };
}

async function zoomed(browser) {
  const page = await open(browser, ZOOMED);
  await selectUnit(page);
  const space = await room(page);
  assert.ok(space.aboveScrolls && space.footerControlsWhole && space.widthOverflowPx <= 0,
    'at 450 px high one region scrolls above the actions and Property Card is whole');
  await capture(page, '08-zoom-200-space-inspector.png', '200% zoom (720 x 450 CSS px, device scale 2), UNIT-3B: '
    + 'Property Card is whole; the header, tabs and rows are one scrolling region above it.');
  const scrolled = await lastRowAfterScroll(page);
  assert.ok(scrolled.lastRowInView, 'the last row is reached by scrolling');
  await capture(page, '09-zoom-200-space-inspector-scrolled.png', 'The same inspector scrolled to its end: the '
    + 'rows are in view and the action has not moved.');
  const action = inspectorOf(page).getByRole('button', { name: 'Property Card', exact: true });
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Property cards · UNIT-3B', exact: true }))
    .toBeVisible();
  await selectBuilding(page);
  const building = await room(page);
  assert.ok(building.aboveScrolls && building.footerControlsWhole && building.widthOverflowPx <= 0);
  await capture(page, '10-zoom-200-building-inspector.png', '200% zoom, Tower 3: the building inspector in the '
    + 'same shell; its actions are whole.');
  const buildingScrolled = await lastRowAfterScroll(page);
  await capture(page, '11-zoom-200-building-inspector-scrolled.png', 'The building inspector scrolled to its end.');
  await page.context().close();
  return { method: 'viewport 720x450 at device scale 2', space, scrolled, opensByKeyboard: true, building,
    buildingScrolled };
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await open(browser, WIDE);
  const wide = await wideInspectors(page);
  const verification = await copyOnVerification(page);
  const recordedUnit = await copyOnRecordedUnit(page);
  const draft = await draftCard(page);
  const printed = await printedCard(browser);
  const zoom = await zoomed(browser);
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(pageErrors, []);
  writeFileSync(resolve(out, 'browser-result.json'), `${JSON.stringify({ exit: 0, studio, localStudio,
    blockedWrites, pageErrors, apiRequests: Object.fromEntries([...requests].sort()),
    wide, copyFocus: { verification, recordedUnit }, draft, printed, zoom, screenshots })}\n`);
} finally {
  await browser.close();
}
