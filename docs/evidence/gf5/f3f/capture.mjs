// Browser checks behind the F3f screenshots. Live reads unless a file is named mocked-* or local-layer-*; no write
// reaches the API. Run from the repository root with both Studio dev servers up (result.json names them):
//   node docs/evidence/gf5/f3f/capture.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.F3F_STUDIO ?? 'http://127.0.0.1:5190';
// The same Studio with its local data layer on (VITE_LOCAL_DATA=on): the only build that answers the portal reads.
const localStudio = process.env.F3F_LOCAL_STUDIO ?? 'http://127.0.0.1:5191';
const f3d = JSON.parse(readFileSync(resolve(out, '../f3d/responses.json'), 'utf8'));
const { buildingId: TOWER, spaceId: UNIT } = f3d;
const AREA = f3d.snapshots.siteId;
const LIST = '/api/v1/usp/property-cards/list';
const SNAPSHOTS = 'GET /api/v1/buildings/{id}/snapshots';
const DRAFT = 'Draft on this device, not a registry record';
const LABELS = {
  'mocked-': 'Mocked response · not a registry record',
  'local-layer-': 'Local data layer · not the demo API',
};
const WIDE = { viewport: { width: 1440, height: 900 } };
// A 1440 px window at 200% browser zoom: 720 CSS px wide, two device pixels per CSS pixel.
const ZOOMED = { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 };
const areaUrl = `${studio}/studio/areas/${AREA}?feature=${TOWER}`;
const screenshots = [];
const requests = new Map();
const blockedWrites = [];
const pageErrors = [];
/** The answer that replaces the live card list for the mocked screenshots: { list: { status, json } }. */
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
      Object.assign(tag.style, { position: 'fixed', bottom: '8px', right: '16px', zIndex: '9999',
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
const sent = (key) => requests.get(key) ?? 0;
const inspectorOf = (page) => page.locator('aside').filter({ hasText: 'UNIT-3B' });
const cardButton = (page) => inspectorOf(page).getByRole('button', { name: 'Property Card', exact: true });
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth
  - document.documentElement.clientWidth);

async function open(browser, size, origin = studio) {
  // Service workers are blocked so that every request of a page passes the guard, the local data layer's too.
  const context = await browser.newContext({ ...size, serviceWorkers: 'block' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.route(isApi, guard);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return page;
}

/** UNIT-3B has no geometry to click on the map: it is chosen in the Tools list of its floor. */
async function selectUnit(page) {
  await page.goto(areaUrl);
  const tools = page.locator('details').first();
  await expect(tools).toContainText('TOWER 3');
  // A narrow window keeps the Tools closed.
  if (!(await tools.evaluate((node) => node.open))) await tools.locator('summary').first().click();
  const before = { list: sent(`POST ${LIST}`), snapshots: sent(SNAPSHOTS) };
  await tools.getByText('View', { exact: true }).click();
  await tools.getByText('Floors', { exact: true }).click();
  await expect(tools).toContainText('Spaces on 2ND FLOOR PLAN');
  assert.deepEqual({ list: sent(`POST ${LIST}`), snapshots: sent(SNAPSHOTS) }, before,
    'no card read while only the building and its floor are selected');
  await tools.getByText('UNIT-3B', { exact: true }).click();
  await expect(inspectorOf(page)).toBeVisible();
  return page.url();
}

async function liveInspector(page) {
  const address = await selectUnit(page);
  const inspector = inspectorOf(page);
  await expect(inspector).toContainText('Listed by the registry');
  await expect(cardButton(page)).toBeEnabled();
  await expect(inspector).not.toContainText(/Draft on this device|3D ULPIN \(proposed\)/);
  await expect(inspector.getByRole('button', { name: /Assign|Record reviewed/ })).toHaveCount(0);
  await capture(page, '01-live-map-inspector-registry-card.png', 'Map, Tower 3, UNIT-3B chosen in the Tools list '
    + '(no geometry to click): the registry lists a card, so Property Card is the action; no draft in this browser.');
  await cardButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Property cards · UNIT-3B', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Verification, revision 1', exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('Draft on this device');
  await capture(page, '02-live-map-registry-cards-dialog.png',
    'The same inspector after Property Card: the registry cards of the unit, as on the register page.');
  return { address, cardsRow: 'Listed by the registry', opens: 'registry cards', draftShown: false,
    cardReadsBeforeUnitSelected: 0 };
}

/** From the open cards dialog to the verification page; the card id there is copied with the keyboard. */
async function copyCardId(page, file) {
  await page.getByRole('dialog').getByRole('link', { name: 'Verification, revision 1', exact: true }).click();
  const main = page.getByRole('main');
  await expect(main.getByText('Passed', { exact: true })).toHaveCount(6);
  const cardId = new URL(page.url()).pathname.split('/')[3];
  const copy = main.getByRole('button', { name: `Copy card id ${cardId}`, exact: true });
  await copy.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(copy).toBeFocused();
  const focusOutline = await copy.evaluate((node) => getComputedStyle(node).outlineWidth);
  await page.keyboard.press('Enter');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, cardId, 'the copy control puts the exact card id on the clipboard');
  await capture(page, file, 'The verification page of the live card: the card id with the copy control, focused.');
  return { cardId, copiedEqualsCardId: true, focusOutline, overflowPx: await overflowOf(page) };
}

async function refusedCards(page) {
  const refusal = { code: 'USP_SCOPE_STALE', message: 'Mocked refusal.', retryable: false, requestId: randomUUID() };
  mock = { list: { status: 409, json: { error: refusal } } };
  await page.goto(page.url());
  const inspector = inspectorOf(page);
  await expect(inspector).toContainText('The registry could not be asked for the cards of this unit.');
  await expect(inspector).toContainText('(USP_SCOPE_STALE)');
  await expect(inspector).not.toContainText('Listed by the registry');
  await expect(cardButton(page)).toHaveCount(0);
  await capture(page, 'mocked-13-map-inspector-cards-refused.png', 'Card list mocked as refused (409), no draft in '
    + 'this browser: the inspector states the refusal with its code and offers no Property Card.');
  mock = {};
  return { stated: refusal.code, propertyCardOffered: false };
}

/** The browser-only flow, the card list mocked as empty: review and assign write to this browser's store only. */
async function assignDraft(page) {
  mock = { list: { status: 200, json: { data: { items: [], truncated: false }, meta: {} } } };
  await page.goto(page.url());
  const inspector = inspectorOf(page);
  await inspector.getByRole('button', { name: 'Record reviewed details', exact: true }).click();
  await inspector.getByRole('button', { name: 'Assign draft code', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toHaveText(
    `${DRAFT}: the code assigned here is made in this browser and is not sent to the server.`);
  await capture(page, 'mocked-14-assign-dialog-draft-notice.png', 'Card list mocked as empty and the review '
    + 'recorded in this browser: the assign dialog says before the action that the code is a draft.');
  await dialog.getByRole('button', { name: 'Assign draft code', exact: true }).click();
  const toast = page.locator('.ul-toast');
  await expect(toast).toContainText(DRAFT);
  await expect(inspector).toContainText('3D ULPIN (proposed) · Draft');
  await expect(inspector).toContainText(`${DRAFT}.`);
  await expect(inspector).not.toContainText('Listed by the registry');
  await capture(page, 'mocked-15-assign-toast-and-inspector-draft.png', 'After the assignment: the toast and the '
    + 'inspector both name the code a draft on this device; no registry row is shown.');
  await toast.getByRole('button', { name: 'Make Property Card', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status').first()).toContainText(DRAFT);
  mock = {};
  return { before: 'draft notice in the assign dialog', toast: DRAFT, cardOpened: 'browser draft' };
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

/** The draft this browser holds for the unit, read from the Studio's own store module. */
function heldDraft(page) {
  return page.evaluate(async (spaceId) => {
    const workflow = await (await import('/src/local/workflow.ts')).getSpaceWorkflow(spaceId);
    return { code: workflow.code, revision: workflow.events[0].revision };
  }, UNIT);
}

async function draftBesideRegistry(page) {
  await page.goto(page.url());
  const inspector = inspectorOf(page);
  await expect(inspector).toContainText('3D ULPIN (proposed) · Draft');
  await expect(inspector).toContainText(`${DRAFT}.`);
  await expect(inspector).toContainText('Listed by the registry');
  await capture(page, '05-live-map-inspector-draft-and-registry.png', 'Live card list, and a draft this capture '
    + 'browser made: the code is labelled a draft on this device, the Cards row is the registry statement.');
  await cardButton(page).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Property cards · UNIT-3B', exact: true }))
    .toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('Draft on this device');
  return { codeLabel: '3D ULPIN (proposed) · Draft', cardsRow: 'Listed by the registry', opens: 'registry cards' };
}

async function draftVerifyPage(page, draft, file) {
  await page.goto(`${studio}/verify/${encodeURIComponent(draft.code)}?rev=${draft.revision}`);
  const main = page.getByRole('main');
  const lead = `Draft revision r${draft.revision} on this device`;
  await expect(main.getByRole('status')).toContainText(`${DRAFT}: the code, revisions and chain below`);
  await expect(main.getByText(lead, { exact: true })).toBeVisible();
  await expect(main).toContainText('3D ULPIN (proposed) · Draft');
  await expect(main).not.toContainText(/Valid: revision|· Assigned/);
  const order = await main.evaluate((node, text) => node.innerText.indexOf('not a registry record')
    < node.innerText.indexOf(text), lead);
  assert.ok(order, 'the lead line is under the notice');
  await capture(page, file, 'The verify page of the draft: the notice, then a neutral line that names the draft.');
  const result = { lead, underNotice: true, overflowPx: await overflowOf(page) };
  if (draft.revision < 2) return result;
  await page.goto(`${studio}/verify/${encodeURIComponent(draft.code)}?rev=1`);
  await expect(main.getByText(`Superseded by revision r${draft.revision}`, { exact: true })).toBeVisible();
  return { ...result, olderRevision: `Superseded by revision r${draft.revision}` };
}

async function portalNotServed(page) {
  await page.goto(`${studio}/portal/records/${UNIT}`);
  await expect(page.getByText('This record is not released', { exact: true })).toBeVisible();
  await capture(page, '06-live-portal-record-not-served.png', 'The portal record page against the demo API, which '
    + 'does not serve the portal reads (local routes): the nearest live state.');
  return { shown: 'This record is not released', read: 'GET /api/v1/public/records/{id} answered 404 by the API' };
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
    const draft = await workflow.assignProposedCode({ spaceId: unit.id, buildingId: lake.register.property.id,
      spaceName: unit.name, recordRevision: unit.revision });
    const released = flats.find((flat) => reviewed.has(flat.id));
    return { unit: unit.id, name: unit.name, code: draft.code, released: released.id };
  });
}

async function portalRecord(page, file, printFile) {
  await page.goto(`${localStudio}/portal`);
  const made = await localDraft(page);
  await page.goto(`${localStudio}/portal/records/${made.unit}`);
  const main = page.getByRole('main');
  await expect(main).toContainText('3D ULPIN (proposed) · Draft');
  await expect(main.getByRole('status')).toHaveText(
    `${DRAFT}: the code and the Property Card of this record were made in this browser and are not checked by the `
    + 'server.');
  await expect(main.getByRole('button', { name: 'Download draft Property Card', exact: true })).toBeVisible();
  await capture(page, file, `Local data layer, ${made.name}: a code made in this capture browser is named a draft.`);
  const overflowPx = await overflowOf(page);
  if (printFile) {
    await page.emulateMedia({ media: 'print' });
    const card = page.locator('.ul-card');
    await expect(card).toContainText(DRAFT);
    await expect(card).toContainText('Local chain consistent');
    await expect(card.getByText('Chain consistent', { exact: true })).toHaveCount(0);
    await capture(page, printFile, 'The same page as print media: the card that Download prints carries the draft '
      + 'row and the local chain words.');
    await page.emulateMedia({ media: 'screen' });
  }
  await page.goto(`${localStudio}/portal/records/${made.released}`);
  await expect(main).toContainText('3D ULPIN (proposed): not assigned yet');
  await expect(main).not.toContainText('Draft on this device');
  return { record: made.name, notice: true, printedCard: `${DRAFT}; Local chain consistent`, overflowPx,
    releasedWithoutCode: 'no draft notice' };
}

/** How much of the inspector a 450 CSS px-high window shows: its rows and its action, measured, not judged by eye. */
function roomAtZoom(page) {
  return inspectorOf(page).evaluate((node) => {
    const bottom = node.getBoundingClientRect().bottom;
    const action = [...node.querySelectorAll('button')].find((button) => button.textContent === 'Property Card')
      .getBoundingClientRect();
    return {
      widthOverflowPx: Math.max(...[...node.children].map((child) => child.scrollWidth)) - node.clientWidth,
      heightPx: Math.round(node.getBoundingClientRect().height),
      headerPx: Math.round(node.querySelector('header').getBoundingClientRect().height),
      rowsVisiblePx: node.querySelector('dl').parentElement.clientHeight,
      actionVisiblePx: Math.round(Math.min(bottom, action.bottom) - action.top),
      actionHeightPx: Math.round(action.height),
    };
  });
}

async function zoomed(browser) {
  const page = await open(browser, ZOOMED);
  await selectUnit(page);
  await expect(cardButton(page)).toBeEnabled();
  const inspector = await roomAtZoom(page);
  await capture(page, '07-zoom-200-map-inspector-registry-card.png', '200% zoom (720 CSS px, device scale 2): the '
    + 'inspector keeps its width; the 450 px-high window leaves its rows no height (browser-result.json, zoom).');
  await cardButton(page).focus();
  await page.keyboard.press('Enter');
  const copy = await copyCardId(page, '08-zoom-200-verification-copy-card-id.png');
  const verify = await draftVerifyPage(page, await makeDraft(page), '09-zoom-200-draft-verify-page.png');
  await page.context().close();
  const local = await open(browser, ZOOMED, localStudio);
  const portal = await portalRecord(local, 'local-layer-12-zoom-200-portal-record-draft.png');
  await local.context().close();
  return { method: 'viewport 720x450 at device scale 2', inspector, opensByKeyboard: true,
    copyFocusOutline: copy.focusOutline,
    verificationOverflowPx: copy.overflowPx, draftVerifyOverflowPx: verify.overflowPx,
    portalOverflowPx: portal.overflowPx };
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await open(browser, WIDE);
  const inspector = await liveInspector(page);
  const copy = await copyCardId(page, '03-live-verification-copy-card-id.png');
  await page.goto(inspector.address);
  const refused = await refusedCards(page);
  const assign = await assignDraft(page);
  await page.goto(inspector.address);
  const both = await draftBesideRegistry(page);
  const verify = await draftVerifyPage(page, await heldDraft(page), '04-live-draft-verify-page.png');
  const notServed = await portalNotServed(page);
  const local = await open(browser, WIDE, localStudio);
  const portal = await portalRecord(local, 'local-layer-10-portal-record-draft.png',
    'local-layer-11-portal-record-printed-card.png');
  const zoom = await zoomed(browser);
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(pageErrors, []);
  writeFileSync(resolve(out, 'browser-result.json'), `${JSON.stringify({ exit: 0, studio, localStudio,
    viewport: [1440, 900], blockedWrites, pageErrors, apiRequests: Object.fromEntries([...requests].sort()),
    inspector, copy, refused, assign, both, verify, notServed, portal, zoom, screenshots })}\n`);
} finally {
  await browser.close();
}
