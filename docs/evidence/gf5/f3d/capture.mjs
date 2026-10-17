// Browser checks behind the F3d screenshots. Live reads unless a file is named mocked-*; no write reaches the API.
// Run from the repository root with the Studio dev server up: node docs/evidence/gf5/f3d/capture.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.F3D_STUDIO ?? 'http://127.0.0.1:5190';
const { buildingId: TOWER, spaceId: UNIT } = JSON.parse(readFileSync(resolve(out, 'responses.json'), 'utf8'));
const LIST = '/api/v1/usp/property-cards/list';
const CARDS = '/api/v1/usp/property-cards/';
const MOCKED = 'Mocked response · not a registry record';
const NOTICE = 'Draft on this device. Not a registry record: the code, revisions and chain below were created in '
  + 'this browser and are not checked by the server.';
const candidatesUrl = `${studio}/studio/properties/${TOWER}/candidates`;
const registerUrl = `${studio}/studio/properties/${TOWER}/register?record=${UNIT}`;
const screenshots = [];
const requests = new Map();
const blockedWrites = [];
const pageErrors = [];
/** Answers that replace a live read for the mocked screenshots: { list?, verification? }, each { status, json }
 *  or a function of the request that returns one. */
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
  const mocked = path === LIST ? mock.list : path.endsWith('/verification') ? mock.verification : undefined;
  const key = `${mocked ? 'mocked ' : ''}${request.method()} ${path.replace(/[0-9a-f-]{36}/g, '{id}')}`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  if (!mocked) return route.continue();
  return route.fulfill(typeof mocked === 'function' ? mocked(request) : mocked);
}

async function capture(page, file, notes) {
  await page.evaluate(() => document.fonts.ready);
  const mocked = file.startsWith('mocked-');
  if (mocked) {
    await page.evaluate((text) => {
      const tag = document.createElement('div');
      tag.id = 'mocked-label';
      tag.textContent = text;
      Object.assign(tag.style, { position: 'fixed', bottom: '8px', right: '16px', zIndex: '9999',
        padding: '8px 12px', background: 'var(--ui-surface)', color: 'var(--ui-ink)',
        border: '1px solid var(--ui-border-strong)', font: '500 13px var(--ui-font-sans)' });
      document.body.append(tag);
    }, MOCKED);
  }
  await page.screenshot({ path: resolve(out, file), animations: 'disabled' });
  await page.locator('#mocked-label').evaluateAll((tags) => tags.forEach((tag) => tag.remove()));
  screenshots.push({ file, mode: mocked ? 'mocked' : 'live', notes });
}

const cardsOf = (page) => page.getByRole('region', { name: 'Cards of UNIT-3B', exact: true });
const isApi = (url) => url.pathname.startsWith('/api/');
const centre = (block) => block.evaluate((node) => node.scrollIntoView({ block: 'center' }));

/** Opens the recorded panel and returns the list answer the Cards block was drawn from. */
async function openCards(page) {
  await page.goto(candidatesUrl);
  const block = cardsOf(page);
  await expect(block.getByRole('heading', { name: 'Cards', exact: true })).toBeAttached();
  const sentBeforeSeen = requests.get(`POST ${LIST}`) ?? 0;
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === LIST);
  await block.scrollIntoViewIfNeeded();
  const body = await (await answered).json().catch(() => null);
  return { block, body, sentBeforeSeen };
}

async function liveCards(page) {
  const before = requests.get(`POST ${LIST}`) ?? 0;
  const { block, body, sentBeforeSeen } = await openCards(page);
  assert.equal(sentBeforeSeen, before, 'no card read before the block was scrolled into view');
  const [card] = body.data.items;
  const status = card.expired ? 'Expired' : 'Valid until';
  await expect(block.getByRole('row')).toHaveCount(body.data.items.length + 1);
  await expect(block).toContainText('Read under the snapshot of');
  await expect(block).toContainText(status);
  await expect(block.getByRole('button', { name: /Generate|Issue|Revoke/i })).toHaveCount(0);
  await centre(block);
  await capture(page, '01-live-recorded-unit-cards.png',
    'Tower 3, UNIT-3B: the Cards block under the assigned code, from the live snapshots and card list reads.');
  return { card, listed: body.data.items.length, status, readAfterScrollOnly: true };
}

async function livePdf(page, card) {
  const link = cardsOf(page).getByRole('link', { name: 'Open card PDF, revision 1', exact: true });
  const href = await link.getAttribute('href');
  const answer = await page.request.get(`${studio}${href}`);
  const sha256 = createHash('sha256').update(await answer.body()).digest('hex');
  const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
  await popup.waitForLoadState('load');
  await popup.waitForTimeout(2500);
  await popup.screenshot({ path: resolve(out, '03-live-card-pdf.png') });
  screenshots.push({ file: '03-live-card-pdf.png', mode: 'live',
    notes: 'The new tab the Open card PDF link opened, drawn by the browser PDF viewer.' });
  const opened = new URL(popup.url()).pathname;
  await popup.close();
  return { href, opened, status: answer.status(), contentType: answer.headers()['content-type'], sha256,
    equalsListedArtifact: sha256 === card.artifact?.sha256 };
}

async function liveVerification(page, card) {
  await cardsOf(page).getByRole('link', { name: 'Verification, revision 1', exact: true }).click();
  await expect(page).toHaveURL(`${studio}/verify/card/${card.cardId}/${card.revision}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Property card verification', exact: true })).toBeVisible();
  const banner = (await main.locator('div').first().innerText()).trim();
  await expect(main).toContainText('Reported by the server, which checked this card revision on');
  await expect(main.getByText('Passed', { exact: true })).toHaveCount(6);
  await expect(main).toContainText('Signature: not assessed. Reason: no trusted key policy exists');
  await expect(main).toContainText('No official ULPIN issuance, title or legal approval is implied.');
  await expect(main).not.toContainText(/unsigned|UNIT-3B|P3-/);
  await expect(main.getByRole('link', { name: 'Open card PDF', exact: true })).toHaveAttribute('target', '_blank');
  await capture(page, '02-live-verification.png',
    'The verification page of the live card: the server report, its six checks and the signature line.');
  return { banner, checksPassed: 6 };
}

async function unknownAndMalformed(page) {
  const heading = page.getByRole('heading', { name: 'No card with this id and revision', exact: true });
  await page.goto(`${studio}/verify/card/${randomUUID()}/1`);
  await expect(heading).toBeVisible();
  await expect(page.getByRole('main')).toContainText('The server holds no card revision at this address.');
  await capture(page, '04-live-verification-unknown-card.png',
    'A card id the server does not hold (a random UUID, one read): the page for an unknown card or revision.');
  const sent = requests.get('GET /api/v1/usp/property-cards/{id}/revisions/1/verification') ?? 0;
  for (const address of ['not-a-card/1', `${randomUUID()}/0`, `${randomUUID()}/latest`]) {
    await page.goto(`${studio}/verify/card/${address}`);
    await expect(heading).toBeVisible();
    await expect(page.getByRole('main')).toContainText('so the server was not asked');
  }
  const total = [...requests].filter(([key]) => key.includes(CARDS) && key.endsWith('/verification'))
    .reduce((sum, [, count]) => sum + count, 0);
  assert.equal(total, sent, 'a malformed address sends no read');
  return { unknownCard: 'No card with this id and revision', malformedAddressesTried: 3, malformedReadsSent: 0 };
}

async function openCardButton(page) {
  await page.goto(registerUrl);
  const button = page.getByRole('button', { name: 'Property Card', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  return page.getByRole('dialog');
}

async function registerButton(page) {
  const dialog = await openCardButton(page);
  await expect(dialog.getByRole('heading', { name: 'Property cards · UNIT-3B', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Verification, revision 1', exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('Draft on this device');
  await capture(page, '05-live-register-registry-cards.png',
    'Register page, UNIT-3B selected: the primary button opens the registry cards; this browser holds no draft.');
  return { opens: 'registry cards', draftShown: false };
}

async function zoomed(browser) {
  // A 1440 px window at 200% browser zoom: 720 CSS px wide, two device pixels per CSS pixel.
  const context = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.route(isApi, guard);
  const { block } = await openCards(page);
  await expect(block.getByRole('row')).toHaveCount(2);
  const link = block.getByRole('link', { name: 'Open card PDF, revision 1', exact: true });
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const focusOutline = await link.evaluate((node) => getComputedStyle(node).outlineWidth);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth
    - document.documentElement.clientWidth);
  const cardsOverflowPx = await overflow();
  await centre(block);
  await capture(page, '06-zoom-200-recorded-unit-cards.png',
    '200% zoom (720 CSS px, device scale 2): the Cards block with the keyboard focus on Open card PDF.');
  await block.getByRole('link', { name: 'Verification, revision 1', exact: true }).click();
  await expect(page.getByText('Passed', { exact: true })).toHaveCount(6);
  const verificationOverflowPx = await overflow();
  await capture(page, '07-zoom-200-verification.png', '200% zoom: the verification page.');
  await context.close();
  return { method: 'viewport 720x450 at device scale 2', focusOutline, cardsOverflowPx, verificationOverflowPx };
}

/** A draft made the way the Studio makes one: its own local workflow module, in this capture browser only. */
async function makeDraft(page) {
  await page.goto(registerUrl);
  return page.evaluate(async ({ buildingId, spaceId }) => {
    const register = await (await fetch(`/api/v1/buildings/${buildingId}/register`)).json();
    const unit = register.register.find((record) => record.id === spaceId);
    const workflow = await import('/src/local/workflow.ts');
    const draft = await workflow.assignProposedCode({ spaceId, buildingId, spaceName: unit.name,
      recordRevision: unit.revision });
    return { code: draft.code, revision: draft.events[0].revision };
  }, { buildingId: TOWER, spaceId: UNIT });
}

async function draftScreens(page) {
  const draft = await makeDraft(page);
  await page.goto(`${studio}/verify/${encodeURIComponent(draft.code)}?rev=${draft.revision}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('status')).toHaveText(NOTICE);
  await expect(main).toContainText('Local chain consistent');
  await expect(main.getByText('Chain consistent', { exact: true })).toHaveCount(0);
  await capture(page, '08-live-draft-verify-page.png',
    'The verify page of a code this capture browser made with the Studio local workflow: draft notice on top.');
  // The registry lists a card for the only selectable unit of the demo, so the list answer is emptied here.
  mock = { list: { status: 200, json: { data: { items: [], truncated: false }, meta: {} } } };
  const dialog = await openCardButton(page);
  await expect(dialog.getByRole('status').first()).toHaveText(NOTICE);
  await expect(dialog).toContainText('Local chain consistent');
  await expect(dialog).toContainText('Draft on this device, not a registry record');
  await capture(page, 'mocked-09-draft-card-dialog.png',
    'Card list mocked as empty: the Property Card button reaches the browser draft, which says what it is.');
  mock = {};
  return { notice: NOTICE, chainWords: 'Local chain consistent', draftCodeMadeBy: 'local/workflow.ts in the browser' };
}

/** The live row in the three states the demo does not hold; an inconsistent row lists nulls, as the server does. */
function unheldRows(card) {
  const nulls = Object.fromEntries(Object.keys(card).map((key) => [key, null]));
  return [
    { ...card, revision: 4, revoked: true, revokedAt: card.createdAt },
    { ...nulls, cardId: card.cardId, revision: 3, integrity: 'inconsistent' },
    { ...card, revision: 2, expired: true, expiresAt: card.createdAt },
  ];
}

async function mockedCards(page, card) {
  mock = { list: { status: 200, json: { data: { items: unheldRows(card), truncated: false }, meta: {} } } };
  const { block } = await openCards(page);
  await expect(block.getByRole('row')).toHaveCount(4);
  await expect(block).toContainText('Revoked');
  await expect(block).toContainText('Inconsistent');
  await expect(block).toContainText('Expired');
  await expect(block.getByRole('link', { name: /Open card PDF/ })).toHaveCount(2);
  await expect(block.getByRole('link', { name: 'Open card PDF, revision 3', exact: true })).toHaveCount(0);
  await centre(block);
  await capture(page, 'mocked-10-cards-revoked-inconsistent-expired.png',
    'Card list mocked from the live row: revoked, inconsistent (no PDF link) and expired.');
  const refusal = { code: 'USP_SCOPE_STALE', message: 'Mocked refusal.', retryable: false, requestId: randomUUID() };
  mock = { list: { status: 409, json: { error: refusal } } };
  const refused = (await openCards(page)).block;
  await expect(refused.getByRole('status')).toContainText('(USP_SCOPE_STALE)');
  await expect(refused).not.toContainText('No card has been issued');
  await expect(refused.getByRole('row')).toHaveCount(0);
  await centre(refused);
  await capture(page, 'mocked-11-cards-refused.png',
    'Card list mocked as refused (409): the block names the refusal and its code, and shows no empty list.');
  mock = {};
  return { rows: ['Revoked', 'Inconsistent', 'Expired'], inconsistentPdfLink: false, refusalShownAs: refusal.code };
}

/** The walk across snapshot scopes, the list answer mocked per call: which scopes were asked, and where it stopped. */
async function mockedWalk(page, card) {
  const listing = await (await page.request.get(`${studio}/api/v1/buildings/${TOWER}/snapshots`)).json();
  const scopes = listing.items.map((snapshot) => snapshot.scope);
  const answer = (items) => ({ status: 200, json: { data: { items, truncated: false }, meta: {} } });
  let asked = [];
  mock = { list: (request) => {
    asked.push(request.postDataJSON().scope);
    return answer(asked.length === 2 ? [card] : []);
  } };
  const second = (await openCards(page)).block;
  await expect(second.getByRole('row')).toHaveCount(2);
  assert.deepEqual(asked, scopes.slice(0, 2), 'newest scope first, unchanged; none after the one that lists');
  asked = [];
  mock = { list: (request) => { asked.push(request.postDataJSON().scope); return answer([]); } };
  const none = (await openCards(page)).block;
  const searchedAll = !listing.truncated && listing.unreadable === 0;
  const sentence = searchedAll ? 'No card has been issued for this unit.'
    : 'No card is listed under the newest snapshots of this building.';
  await expect(none).toContainText(sentence);
  assert.deepEqual(asked, scopes, 'every listed scope asked once, newest first, before saying none lists a card');
  await centre(none);
  await capture(page, 'mocked-13-no-card-listed.png',
    'Card list mocked as empty under every scope: the block says so only after asking each listed snapshot.');
  mock = {};
  return { snapshotsListed: scopes.length, stoppedAfter: 2, askedWhenNoneLists: asked.length, sentence };
}

async function mockedVerification(page, card) {
  const live = await (await page.request.get(
    `${studio}/api/v1/usp/property-cards/${card.cardId}/revisions/${card.revision}/verification`)).json();
  const checks = live.data.checks.map((check) => (check.key === 'artifact_bytes'
    ? { ...check, state: 'fail', reasonCode: 'CARD_ARTIFACT_INTEGRITY' } : check));
  const data = { ...live.data, result: 'inconsistent', checks };
  mock = { verification: { status: 200, json: { ...live, data } } };
  await page.goto(`${studio}/verify/card/${card.cardId}/${card.revision}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toHaveText('Not consistent');
  await expect(main).toContainText('CARD_ARTIFACT_INTEGRITY');
  await expect(main.getByText('Failed', { exact: true })).toHaveCount(1);
  await capture(page, 'mocked-12-verification-not-consistent.png',
    'Verification mocked from the live report with one failed check: Not consistent, with the server reason code.');
  mock = {};
  return { banner: 'Not consistent', failedCheck: 'artifact_bytes: CARD_ARTIFACT_INTEGRITY' };
}

// The full Chromium build draws a PDF in a tab; the headless shell only downloads it.
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route(isApi, guard);
  const cards = await liveCards(page);
  const pdf = await livePdf(page, cards.card);
  const verification = await liveVerification(page, cards.card);
  const absent = await unknownAndMalformed(page);
  const register = await registerButton(page);
  const zoom = await zoomed(browser);
  const draft = await draftScreens(page);
  const unheld = await mockedCards(page, cards.card);
  const walk = await mockedWalk(page, cards.card);
  const inconsistent = await mockedVerification(page, cards.card);
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(pageErrors, []);
  const { card, ...block } = cards;
  writeFileSync(resolve(out, 'browser-result.json'), `${JSON.stringify({ exit: 0, studio, viewport: [1440, 900],
    blockedWrites, pageErrors, apiRequests: Object.fromEntries([...requests].sort()),
    liveCard: { cardId: card.cardId, revision: card.revision, expiresAt: card.expiresAt, expired: card.expired },
    block, pdf, verification, absent, register, zoom, draft, unheld, walk, inconsistent, screenshots })}\n`);
} finally {
  await browser.close();
}
