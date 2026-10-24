// Browser checks behind the F3e2 screenshots. Every step the registry would store is answered here from the
// fixtures (fixtures.json names each source); the demo API is asked for reads only and a write that is not
// answered here is refused and counted. Run from the repository root with the Studio dev server up:
//   node docs/evidence/gf5/f3e2/capture.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.F3E2_STUDIO ?? 'http://127.0.0.1:5190';
const r3 = process.env.F3E2_R3 ?? 'E:/BhuAayam-data/task-data/r3/step3';
const f3d = JSON.parse(readFileSync(resolve(out, '../f3d/responses.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(resolve(out, 'fixtures.json'), 'utf8'));
const { buildingId: TOWER, spaceId: UNIT } = f3d;
const AREA = f3d.snapshots.siteId;
const LABEL = 'Mocked responses · not a registry record';
const WIDE = { viewport: { width: 1440, height: 900 } };
// A 1440 x 900 window at 200% browser zoom: 720 x 450 CSS px, two device pixels per CSS pixel.
const ZOOMED = { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 };
const candidatesUrl = `${studio}/studio/properties/${TOWER}/candidates`;
const areaUrl = `${studio}/studio/areas/${AREA}?feature=${TOWER}`;
const CANONICAL = `GET /api/v1/buildings/${TOWER}/canonical`;
const REVIEWS = `GET /api/v1/usp/identity/records/${UNIT}/reviews`;
const CAPTURE = 'POST /api/v1/usp/snapshots';
const REVIEW = 'POST /api/v1/usp/identity/reviews';
const ASSIGN = 'POST /api/v1/usp/identity/assign';
const CARD_LIST = 'POST /api/v1/usp/property-cards/list';
const ENTRIES = 'POST /api/v1/usp/packets/plans/entries';
const PLAN = 'POST /api/v1/usp/packets/plans/create';
const CONFIRM = 'POST /api/v1/usp/packets/plans/confirm';
const EXECUTE = 'POST /api/v1/usp/packets/plans/execute';
const CARD_READ = 'POST /api/v1/usp/property-cards/read';
const PREVIEW = 'POST /api/v1/usp/property-cards/preview';
const GENERATE = 'POST /api/v1/usp/property-cards/generate';
// The POST reads the Studio already sent before this task: the only non-GET requests that may reach the demo.
const LIVE_POST_READS = new Set([CARD_LIST]);
const LOST = 'lost';

const screenshots = [];
const requests = new Map();
const blockedWrites = [];
const pageErrors = [];
/** What answers a request in place of the demo: route -> { status, json }, a function of the body, or LOST. */
const mock = new Map();
/** The bodies the Studio sent to each mocked route, in order. */
const sent = new Map();

const stored = (file) => JSON.parse(readFileSync(resolve(r3, file), 'utf8'));
const recorded = (route) => ({ status: 200, json: stored(fixtures.recorded[route].file).body });
const shaped = (name) => ({ status: fixtures.shaped[name].status ?? 200, json: fixtures.shaped[name].body });
const count = (key) => requests.set(key, (requests.get(key) ?? 0) + 1);
const generic = (key) => key.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}');

/** Answers a mocked route, lets a read through to the demo, and refuses and counts every other request. */
async function guard(route) {
  const request = route.request();
  const key = `${request.method()} ${new URL(request.url()).pathname}`;
  const answer = mock.get(key);
  if (answer) {
    const body = request.postDataJSON();
    sent.set(key, [...(sent.get(key) ?? []), body]);
    count(`mocked ${generic(key)}`);
    const given = typeof answer === 'function' ? answer(body) : answer;
    return given === LOST ? route.abort('connectionfailed') : route.fulfill(given);
  }
  if (request.method() !== 'GET' && !LIVE_POST_READS.has(key)) {
    blockedWrites.push(key);
    return route.abort('blockedbyclient');
  }
  count(generic(key));
  return route.continue();
}

async function capture(page, file, notes) {
  await page.evaluate(() => document.fonts.ready);
  const mocked = file.startsWith('mocked-');
  if (mocked) {
    await page.evaluate((text) => {
      const tag = document.createElement('div');
      tag.id = 'capture-label';
      tag.textContent = text;
      Object.assign(tag.style, { position: 'fixed', bottom: '8px', left: '16px', zIndex: '9999',
        padding: '8px 12px', background: 'var(--ui-surface)', color: 'var(--ui-ink)',
        border: '1px solid var(--ui-border-strong)', font: '500 13px var(--ui-font-sans)' });
      document.body.append(tag);
    }, LABEL);
  }
  await page.screenshot({ path: resolve(out, file), animations: 'disabled' });
  await page.locator('#capture-label').evaluateAll((tags) => tags.forEach((tag) => tag.remove()));
  screenshots.push({ file, mode: mocked ? 'mocked' : 'live', notes });
}

async function open(browser, size) {
  // Service workers are blocked so that every request of a page passes the guard. The officer's clock is IST.
  const context = await browser.newContext({ ...size, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
  await context.route((url) => url.pathname.startsWith('/api/'), guard);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return page;
}

/** The demo's canonical answer with UNIT-3B as R3 read it before the assignment: no code, record revision 1. */
async function canonicalBefore() {
  const live = await (await fetch(`${studio}/api/v1/buildings/${TOWER}/canonical`)).json();
  const unit = live.levels.flatMap((level) => level.spaces).find((space) => space.spaceId === UNIT);
  unit.proposedCode = { ...unit.proposedCode, value: null, state: 'unknown' };
  live.inputRevisions.find((pin) => pin.namespace === 'registry_record' && pin.id === UNIT).revision = 1;
  return { status: 200, json: live };
}

/** The review R3 stored, as the reviews read lists it while no assignment has used it. */
function listedReview() {
  const request = stored('03-review-request.json');
  const answer = stored('03-review-response.json').body.data;
  return { reviewId: answer.reviewId, operation: 'assign', reason: request.body.reason, createdAt: request.at,
    scope: request.body.scope, expectedManifestId: answer.expectedManifestId, expectedRecordVersion: 1,
    used: null, commandSha256: answer.commandSha256 };
}

const reviews = (body) => ({ status: 200, json: { recordId: UNIT, siteId: AREA, ...body } });
const noReviews = () => reviews(fixtures.shaped.reviewsNone.body);
const oneReview = () => reviews({ items: [listedReview()], truncated: false, unreadable: 0 });
const refusal = (code, message, status) => (
  { status, json: { error: { code, message, retryable: false, requestId: '00000000-0000-4000-8000-000000000000' } } }
);
const reviewBlock = (page) => page.getByRole('region', { name: 'Review and code of UNIT-3B', exact: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

/** True when every control of the dialog's footer lies whole inside the dialog and nothing widens it. */
function footerWhole(page) {
  return page.getByRole('dialog').evaluate((node) => {
    const box = node.getBoundingClientRect();
    const controls = [...node.querySelectorAll('footer button')].map((control) => control.getBoundingClientRect());
    const body = node.querySelector('.ul-dialog__body');
    return { controls: controls.length, widthOverflowPx: body.scrollWidth - body.clientWidth,
      whole: controls.every((rect) => rect.left >= box.left && rect.right <= box.right
        && rect.top >= box.top && rect.bottom <= box.bottom) };
  });
}

async function openReviewDialog(page) {
  mock.set(CANONICAL, await canonicalBefore());
  mock.set(REVIEWS, noReviews());
  await page.goto(candidatesUrl);
  // The reviews are asked for when the block is seen.
  await reviewBlock(page).scrollIntoViewIfNeeded();
  const opener = button(reviewBlock(page), 'Review and assign code');
  await opener.scrollIntoViewIfNeeded();
  await expect(opener).toBeVisible();
  return opener;
}

/** Review, a refused review, the stored review, an assignment with no answer, the read and the code. */
async function reviewAndAssign(page) {
  const opener = await openReviewDialog(page);
  await capture(page, 'mocked-01-unit-without-review.png', 'The unit block of UNIT-3B before it had a code: the '
    + 'reviews read lists no unused review, so the block offers Review and assign code.');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const reason = dialog.getByLabel('Reason for this review (required)');
  await expect(reason).toBeFocused();
  await expect(button(dialog, 'Record review')).toBeDisabled();
  await capture(page, 'mocked-02-review-form.png', 'The dialog as it opens: what is decided, read from the '
    + 'record; an empty reason; Record review is off until a reason is given.');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  // The second open finds the record already read, so the form is there at once: focus must still return.
  await expect(reason).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  await reason.fill(stored('03-review-request.json').body.reason);
  mock.set(CAPTURE, recorded(CAPTURE));
  mock.set(REVIEW, shaped('reviewRefused'));
  await page.keyboard.press('Tab');
  await expect(button(dialog, 'Cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(button(dialog, 'Record review')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('(USP_IDENTITY_EVIDENCE)');
  await expect(reason).toHaveValue(stored('03-review-request.json').body.reason);
  await capture(page, 'mocked-03-review-refused.png', 'A refused review (422 USP_IDENTITY_EVIDENCE): the words '
    + 'of Step 0 with the code; the dialog stays open with the reason as entered.');
  mock.set(REVIEW, recorded(REVIEW));
  await button(dialog, 'Record review').click();
  await expect(dialog.getByRole('heading', { name: 'Assign code · UNIT-3B', exact: true })).toBeVisible();
  await capture(page, 'mocked-04-review-recorded.png', 'The review is stored: its reason, id and the snapshot it '
    + 'is bound to as answered; Assign code is offered.');
  mock.set(ASSIGN, LOST);
  await button(dialog, 'Assign code').click();
  await expect(dialog).toContainText('The result is unknown');
  await expect(button(dialog, 'Assign code')).toBeDisabled();
  await capture(page, 'mocked-05-assignment-unknown.png', 'The assignment got no answer: the dialog says that the '
    + 'result is unknown, Assign code is off and Read the record again is offered.');
  mock.set(REVIEWS, oneReview());
  await button(dialog, 'Read the record again').click();
  await expect(button(dialog, 'Assign code')).toBeEnabled();
  mock.set(ASSIGN, recorded(ASSIGN));
  mock.delete(CANONICAL);
  await button(dialog, 'Assign code').click();
  await expect(dialog.getByRole('button', { name: /^Copy code P3-/ })).toBeVisible();
  await capture(page, 'mocked-06-code-assigned.png', 'After the answered assignment: the code is the one the live '
    + 'canonical record states, with the receipt as answered.');
  await button(dialog, 'Close').click();
  const focusOnUnit = await page.evaluate(() => document.activeElement?.querySelector('h4')?.textContent ?? null);
  return { sentBodies: checkAssignBodies(), focusAfterClose: focusOnUnit };
}

/** What the Studio sent in the flow above, checked against the review it was answered. */
function checkAssignBodies() {
  const captures = sent.get(CAPTURE);
  const [refused, accepted] = sent.get(REVIEW);
  const [lost, answered] = sent.get(ASSIGN);
  const review = stored('03-review-response.json').body.data;
  const { scope } = stored('02-snapshot-response.json').body.data;
  assert.equal(captures.length, 1, 'one capture serves the refused and the accepted review');
  assert.deepEqual(refused, accepted);
  assert.ok(!('location' in accepted) && accepted.operation === 'assign');
  assert.deepEqual(accepted.scope, scope);
  assert.deepEqual(lost, answered, 'the second click sends the same body with the same key');
  assert.deepEqual({ ...answered, requestKey: null }, { scope, expectedManifestId: review.expectedManifestId,
    reviewId: review.reviewId, requestKey: null, recordId: UNIT, expectedRecordVersion: 1 });
  return { captures: captures.length, reviews: 2, reviewHasLocation: false, assignments: 2,
    assignmentsEqual: true, fourValuesAreTheReviews: true, evidence: accepted.evidence };
}

/** A unit whose newest review is unused: the block shows it; a refused assignment offers a new review. */
async function assignFromListedReview(page) {
  mock.set(CANONICAL, await canonicalBefore());
  mock.set(REVIEWS, oneReview());
  await page.goto(candidatesUrl);
  await reviewBlock(page).scrollIntoViewIfNeeded();
  const opener = button(reviewBlock(page), 'Assign code');
  await opener.scrollIntoViewIfNeeded();
  await expect(reviewBlock(page)).toContainText(listedReview().reviewId);
  await capture(page, 'mocked-07-unit-with-unused-review.png', 'The unit block when the reviews read lists an '
    + 'unused assign review: its reason, time and bound snapshot, and Assign code directly.');
  await opener.click();
  const dialog = page.getByRole('dialog');
  mock.set(ASSIGN, refusal('STALE_REVISION', 'The manifest changed. Capture and review a new snapshot.', 409));
  await button(dialog, 'Assign code').click();
  await expect(dialog.getByRole('alert')).toContainText('The manifest changed. Capture and review a new snapshot.');
  await expect(button(dialog, 'Record a new review')).toBeVisible();
  await capture(page, 'mocked-08-assignment-refused.png', 'A refused assignment (409 STALE_REVISION): the '
    + 'sentence of the server with its code; Record a new review leaves the listed review.');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  mock.set(REVIEWS, reviews(fixtures.shaped.reviewsUnreadable.body));
  await page.goto(candidatesUrl);
  await reviewBlock(page).scrollIntoViewIfNeeded();
  await expect(reviewBlock(page)).toContainText('The reviews of this unit could not be read.');
  await button(reviewBlock(page), 'Read again').scrollIntoViewIfNeeded();
  const offered = await reviewBlock(page).getByRole('button').allTextContents();
  assert.deepEqual(offered, ['Read again']);
  await capture(page, 'mocked-09-reviews-unreadable.png', 'The reviews read counts a row it could not read back: '
    + 'no action is offered, only Read again.');
  return { offeredWhenUnreadable: offered };
}

async function zoomedReview(browser) {
  const page = await open(browser, ZOOMED);
  const opener = await openReviewDialog(page);
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason for this review (required)').fill(stored('03-review-request.json').body.reason);
  const form = await footerWhole(page);
  await capture(page, 'mocked-10-zoom-200-review-form.png', '200% zoom (720 x 450 CSS px, device scale 2): the '
    + 'review form; the body scrolls and both actions are whole.');
  mock.set(REVIEW, recorded(REVIEW));
  await button(dialog, 'Record review').click();
  await expect(button(dialog, 'Assign code')).toBeVisible();
  const assign = await footerWhole(page);
  await capture(page, 'mocked-11-zoom-200-assign.png', '200% zoom: the stored review and Assign code.');
  assert.ok(form.whole && assign.whole && form.widthOverflowPx <= 0 && assign.widthOverflowPx <= 0);
  await page.context().close();
  return { method: 'viewport 720x450 at device scale 2', form, assign };
}

const cardsBlock = (page) => page.getByRole('region', { name: 'Cards of UNIT-3B', exact: true });
const meta = () => stored('09-card-response.json').body.meta;
/** A date and time as the officer types it in IST, some hours from now. */
const typedAt = (hours) => new Date(Date.now() + (hours + 5.5) * 3_600_000).toISOString().slice(0, 16);
const typedReason = () => stored('06-plan-request.json').body.input.entries[0].inclusionReason;

/** The entry of UNIT-3B as docs/evidence/gf4/k12/REQUESTS.md (read 1) states the answer; meta is contract-shaped. */
function entryOf(includable) {
  const { bindingId } = stored('06-plan-request.json').body.input.entries[0];
  const { sourceId, revision, locator } = stored('03-review-request.json').body.evidence[0];
  const reasonCode = includable ? null : fixtures.shaped.entryNotIncludable.reasonCode;
  return { bindingId, kind: 'source_statement', label: 'UNIT-3B', includable, reasonCode,
    citation: { sourceId, revision, locator, page: 1, region: [596, 390, 644, 409] } };
}

const entries = (includable) => (body) => (
  { status: 200, json: { data: { target: body.target, entries: [entryOf(includable)] }, meta: meta() } }
);

/** The rows R3's card answered, as the preview of the same inputs (REQUESTS.md, read 2); contract-shaped. */
function preview(mode, revision) {
  const card = stored('09-card-response.json').body.data;
  return (body) => ({ status: 200, json: { meta: meta(),
    data: { mode, revision, facts: card.facts, expiresAt: body.expiresAt, scope: card.scope } } });
}

/** R3's card answer as revision 2 of the same card, with the expiry that was asked for; contract-shaped. */
function secondRevision(body) {
  const answer = stored('09-card-response.json').body;
  const data = { ...answer.data, revision: 2, previousRevision: 1, expiresAt: body.expiresAt };
  return { status: 200, json: { ...answer, data } };
}

/** R3's card list with revision 2 above its revision 1, which it supersedes; contract-shaped. */
function listWithSecondRevision(expiresAt) {
  const listed = stored('13-list-unit-response.json').body;
  const [first] = listed.data.items;
  const second = { ...first, revision: 2, latestRevision: 2, expiresAt, createdAt: new Date().toISOString() };
  const items = [second, { ...first, latestRevision: 2, superseded: true }];
  return { status: 200, json: { ...listed, data: { ...listed.data, items } } };
}

async function openIssueDialog(page, name) {
  await page.goto(candidatesUrl);
  await cardsBlock(page).scrollIntoViewIfNeeded();
  const opener = button(cardsBlock(page), name);
  await opener.scrollIntoViewIfNeeded();
  await expect(opener).toBeVisible();
  return opener;
}

/** The form of a first card: opened by keyboard, an expiry refused in the form, an entry that is not includable. */
async function firstCardForm(page) {
  mock.set(CARD_LIST, shaped('cardsNone'));
  const opener = await openIssueDialog(page, 'Issue card');
  await capture(page, 'mocked-12-unit-without-card.png', 'The Cards block of UNIT-3B when the card list is empty '
    + '(mocked list; every other read is live): it offers Issue card.');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const until = dialog.getByLabel('Valid until (required)');
  const why = dialog.getByLabel('Why this citation is included (required)');
  await expect(until).toBeFocused();
  await expect(until).toHaveValue('');
  await expect(why).toHaveValue('');
  await expect(button(dialog, 'Prepare')).toBeDisabled();
  await capture(page, 'mocked-13-issue-form.png', 'The dialog as it opens: the sentence that Prepare stores a '
    + 'snapshot, a plan and a packet; both inputs empty; Prepare is off.');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  await until.fill(typedAt(-1));
  await why.fill(typedReason());
  await why.press('Tab');
  await expect(button(dialog, 'Cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(button(dialog, 'Prepare')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('Use an expiry within the next 24 hours.');
  assert.equal(sent.get(ENTRIES), undefined, 'a refused expiry sends nothing');
  await capture(page, 'mocked-14-expiry-refused-in-form.png', 'An expiry one hour in the past: the form refuses '
    + 'it with the sentence of the registry and sends nothing.');
  await until.fill(typedAt(12));
  mock.set(CAPTURE, recorded(CAPTURE));
  mock.set(ENTRIES, entries(false));
  await button(dialog, 'Prepare').click();
  await expect(dialog).toContainText('Prepare stopped: no plan was created.');
  await capture(page, 'mocked-15-entry-not-includable.png', 'The entry is answered as not includable: it is shown '
    + 'with its reason code (a contract-shaped placeholder) and Prepare stops before the plan.');
  return { dialog };
}

/** Prepare with a lost answer, the rows, a refused and a lost card request, and the card the registry lists. */
async function firstCardIssued(page, { dialog }) {
  const capturesBefore = sent.get(CAPTURE).length - 1;
  mock.set(ENTRIES, entries(true));
  for (const route of [PLAN, CONFIRM]) mock.set(route, recorded(route));
  mock.set(EXECUTE, LOST);
  await button(dialog, 'Prepare').click();
  await expect(dialog).toContainText('Prepare stopped at the packet. The result is unknown');
  await expect(button(dialog, 'Prepare')).toBeDisabled();
  await capture(page, 'mocked-16-prepare-unknown.png', 'The packet step got no answer: the dialog names the step, '
    + 'says the result is unknown, shows the plan that was answered and offers Read the record again.');
  await button(dialog, 'Read the record again').click();
  mock.set(EXECUTE, recorded(EXECUTE));
  mock.set(PREVIEW, preview('create', 1));
  await button(dialog, 'Prepare').click();
  await expect(dialog.getByRole('region', { name: 'Rows of the card' })).toContainText('Rights / title / issuance');
  await capture(page, 'mocked-17-prepared-rows.png', 'After Prepare: what was typed, the entry, plan and packet as '
    + 'answered, the mode and revision of the preview and its rows in the answered order; Issue card is offered.');
  mock.set(GENERATE, shaped('generateRefused'));
  await button(dialog, 'Issue card').click();
  await expect(dialog.getByRole('alert')).toContainText('(CARD_EXPIRY)');
  await expect(button(dialog, 'Prepare again')).toBeVisible();
  await dialog.getByRole('alert').scrollIntoViewIfNeeded();
  await capture(page, 'mocked-18-card-refused.png', 'A refused card request (422 CARD_EXPIRY): the sentence of the '
    + 'server with its code; the dialog stays open and offers Prepare again.');
  mock.set(GENERATE, LOST);
  await button(dialog, 'Issue card').click();
  await expect(dialog).toContainText('The result is unknown');
  await expect(button(dialog, 'Issue card')).toBeDisabled();
  await dialog.getByText('The result is unknown').scrollIntoViewIfNeeded();
  await capture(page, 'mocked-19-card-unknown.png', 'The card request got no answer: the result is unknown, Issue '
    + 'card is off and Read the record again is offered.');
  await button(dialog, 'Read the record again').click();
  await expect(dialog).toContainText('The registry lists no new card for this unit.');
  mock.set(GENERATE, recorded(GENERATE));
  mock.delete(CARD_LIST);
  await button(dialog, 'Issue card').click();
  await expect(dialog).toBeHidden();
  await expect(cardsBlock(page).getByRole('link', { name: 'Open card PDF, revision 1' })).toBeVisible();
  // The action that opened the dialog is the same control; the listed card is valid, so it now names a revision.
  const action = button(cardsBlock(page), 'Issue new revision');
  await expect(action).toBeFocused();
  await capture(page, 'mocked-20-card-listed.png', 'After the answered card request the cards are read again '
    + '(live list) and the dialog closes on the listed row; focus is back on the action that opened it.');
  return { sentBodies: checkIssueBodies(capturesBefore), focusAfterClose: await action.textContent() };
}

/** What the Studio sent in the first-card flow, checked against what it was answered and what was typed. */
function checkIssueBodies(capturesBefore) {
  const plans = sent.get(PLAN);
  const cards = sent.get(GENERATE);
  const [looked] = sent.get(PREVIEW);
  const planned = stored('06-plan-response.json').body.data;
  const { scope } = stored('02-snapshot-response.json').body.data;
  assert.equal(sent.get(CAPTURE).length - capturesBefore, 1, 'one capture serves every Prepare of the dialog');
  assert.equal(plans.length, 2, 'the Prepare after the lost answer plans again');
  assert.notEqual(plans[0].guard.requestKey, plans[1].guard.requestKey);
  assert.deepEqual(plans[1].input.scope, scope);
  assert.equal(plans[1].input.entries[0].bindingId, entryOf(true).bindingId);
  assert.equal(plans[1].input.entries[0].inclusionReason, typedReason());
  assert.equal(cards.length, 3, 'refused, lost and answered');
  assert.deepEqual(cards[0], cards[1]);
  assert.deepEqual(cards[1], cards[2], 'the click after the read sends the same body with the same key');
  const { requestKey, ...guard } = cards[2].guard;
  assert.deepEqual({ ...cards[2], guard }, looked, 'the card request is the previewed one plus its key');
  assert.deepEqual(looked, { planId: planned.planId, planVersion: planned.version, cardId: null,
    expiresAt: plans[1].input.expiresAt, guard: { mode: 'create' } });
  return { captures: 1, entryReads: sent.get(ENTRIES).length, plans: plans.length, cardRequests: cards.length,
    cardRequestsEqual: true, oneExpiryForPlanPreviewAndCard: true, keyLength: requestKey.length };
}

/** The next revision of the listed card: nothing is planned; the card read gives the plan and the snapshot. */
async function newRevision(page) {
  const opener = await openIssueDialog(page, 'Issue new revision');
  await capture(page, 'live-21-unit-with-valid-card.png', 'Live reads only: UNIT-3B lists a card that is valid '
    + 'now under an unchanged snapshot, so the block offers Issue new revision.');
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('It stores nothing.');
  assert.equal(await dialog.getByLabel('Why this citation is included (required)').count(), 0);
  await dialog.getByLabel('Valid until (required)').fill(typedAt(20));
  await capture(page, 'mocked-22-revision-form.png', 'Issue new revision: Prepare reads the listed card and the '
    + 'rows, so the dialog says it stores nothing and asks for Valid until only.');
  mock.set(CARD_READ, recorded(CARD_READ));
  mock.set(PREVIEW, preview('update', 2));
  await button(dialog, 'Prepare').click();
  await expect(dialog.getByRole('region', { name: 'Rows of the card' })).toContainText('update');
  await capture(page, 'mocked-23-revision-rows.png', 'The preview of the revision: mode update, revision 2 and the '
    + 'rows as answered.');
  const [looked] = sent.get(PREVIEW).slice(-1);
  mock.set(GENERATE, secondRevision);
  mock.set(CARD_LIST, listWithSecondRevision(looked.expiresAt));
  await button(dialog, 'Issue new revision').click();
  await expect(dialog).toBeHidden();
  await expect(cardsBlock(page).getByRole('link', { name: 'Open card PDF, revision 2' })).toBeVisible();
  await capture(page, 'mocked-24-revision-listed.png', 'The cards read after the card request list revision 2 '
    + 'above revision 1; the dialog has closed.');
  const { card } = stored('10-card-read-response.json').body.data;
  assert.deepEqual(looked, { planId: card.planId, planVersion: card.planVersion, cardId: card.cardId,
    expiresAt: looked.expiresAt, guard: { mode: 'update', expectedVersion: card.revision,
      expectedManifestId: card.scope.manifestId } });
  assert.equal(sent.get(PLAN).length, 2, 'a revision plans nothing');
  mock.delete(CARD_LIST);
  return { previewed: { ...looked, expiresAt: 'as typed' }, plansSent: 0 };
}

async function zoomedIssue(browser) {
  const page = await open(browser, ZOOMED);
  mock.set(CARD_LIST, shaped('cardsNone'));
  await (await openIssueDialog(page, 'Issue card')).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valid until (required)').fill(typedAt(12));
  await dialog.getByLabel('Why this citation is included (required)').fill(typedReason());
  const form = await footerWhole(page);
  await capture(page, 'mocked-25-zoom-200-issue-form.png', '200% zoom (720 x 450 CSS px, device scale 2): the '
    + 'form of a first card; the body scrolls and both actions are whole.');
  mock.set(PREVIEW, preview('create', 1));
  await button(dialog, 'Prepare').click();
  await dialog.getByRole('region', { name: 'Rows of the card' }).scrollIntoViewIfNeeded();
  const prepared = await footerWhole(page);
  await capture(page, 'mocked-26-zoom-200-rows.png', '200% zoom: the rows of the card and Issue card.');
  assert.ok(form.whole && prepared.whole && form.widthOverflowPx <= 0 && prepared.widthOverflowPx <= 0);
  await page.context().close();
  mock.delete(CARD_LIST);
  return { method: 'viewport 720x450 at device scale 2', form, prepared };
}

const inspectorOf = (page) => page.getByRole('complementary', { name: 'Inspector', exact: true });

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
  await expect(inspectorOf(page).getByRole('link', { name: 'Open recorded unit', exact: true })).toBeAttached();
  return inspectorOf(page);
}

/** What the inspector offers: the names of its buttons and links below the facts. */
const offered = (inspector) => inspector.locator('footer').getByRole('button').or(
  inspector.locator('footer').getByRole('link')).allTextContents();

/** The map inspector reads the registry and links to the recorded unit; it writes nothing in this browser. */
async function inspectorLinks(page) {
  const live = await (await fetch(`${studio}/api/v1/buildings/${TOWER}/canonical`)).json();
  const unit = live.levels.flatMap((level) => level.spaces).find((space) => space.spaceId === UNIT);
  // The code is printed in its groups, without the hyphens between them.
  const code = unit.proposedCode.value.replaceAll('-', '');
  const inspector = await selectUnit(page);
  await expect(inspector.locator('header')).toContainText('Assigned');
  await expect(inspector).toContainText(code);
  await expect(inspector).toContainText('Listed by the registry');
  const withCode = await offered(inspector);
  assert.deepEqual(withCode, ['Property Card', 'Open recorded unit']);
  await capture(page, 'live-27-inspector-recorded-unit.png', 'Live reads only: UNIT-3B in the map inspector. The '
    + 'header reads Assigned and the code from the canonical record; the actions are the listed card and the '
    + 'link to the recorded unit. No review or draft-code button is left.');
  await inspector.getByRole('link', { name: 'Open recorded unit', exact: true }).click();
  await expect(page).toHaveURL(`${candidatesUrl}#unit-${UNIT}`);
  await expect(page.locator(`[id="unit-${UNIT}"]`)).toBeFocused();
  await capture(page, 'live-28-arrival-at-recorded-unit.png', 'Live reads only: the link opens the record page at '
    + 'the block of UNIT-3B, which is scrolled to and holds the focus.');
  mock.set(CANONICAL, await canonicalBefore());
  mock.set(CARD_LIST, shaped('cardsNone'));
  const cardsRead = page.waitForResponse((response) => response.url().endsWith('/property-cards/list'));
  const before = await selectUnit(page);
  await cardsRead;
  await expect(before).not.toContainText(code);
  const status = await before.locator('header .ul-badge').first().textContent();
  assert.notEqual(status, 'Assigned');
  const withoutCode = await offered(before);
  assert.deepEqual(withoutCode, ['Open recorded unit']);
  await capture(page, 'mocked-29-inspector-unit-without-code.png', 'The canonical record as before the assignment '
    + 'and an empty card list: the header reads the review status of the live ledger, no code is shown, and the '
    + 'one action is the link to the recorded unit.');
  mock.delete(CARD_LIST);
  return { code: 'as the live canonical record states it', withCode, statusWithoutCode: status, withoutCode,
    arrivesFocusedAt: `#unit-${UNIT}` };
}

/** Whether both actions of the inspector lie whole inside it, and how much of the rows is shown above them. */
function inspectorRoom(inspector) {
  return inspector.evaluate((node) => {
    const [above, footer] = node.children;
    const box = node.getBoundingClientRect();
    const controls = [...footer.querySelectorAll('button, a')].map((control) => control.getBoundingClientRect());
    return { heightPx: Math.round(box.height), rowsShownPx: above.clientHeight, rowsContentPx: above.scrollHeight,
      widthOverflowPx: above.scrollWidth - node.clientWidth, actions: controls.length,
      actionsWhole: controls.every((rect) => rect.top >= box.top && rect.bottom <= box.bottom
        && rect.left >= box.left && rect.right <= box.right) };
  });
}

/** The inspector of UNIT-3B at 200% zoom, where it now holds two actions: the listed card and the link. */
async function zoomedInspector(browser) {
  const page = await open(browser, ZOOMED);
  const inspector = await selectUnit(page);
  await expect(inspector).toContainText('Listed by the registry');
  const room = await inspectorRoom(inspector);
  await capture(page, 'live-31-zoom-200-inspector.png', 'Live reads only, 200% zoom (720 x 450 CSS px, device scale '
    + '2): the inspector of UNIT-3B with its two actions.');
  await page.context().close();
  return { method: 'viewport 720x450 at device scale 2', ...room };
}

/** The reviews read of the rolled-out demo, answered by the demo itself; only the canonical record is mocked. */
async function liveReviewsRead(page) {
  mock.set(CANONICAL, await canonicalBefore());
  mock.delete(REVIEWS);
  const live = `GET ${generic(new URL(`${studio}/api/v1/usp/identity/records/${UNIT}/reviews`).pathname)}`;
  const readsBefore = requests.get(live) ?? 0;
  await page.goto(candidatesUrl);
  await reviewBlock(page).scrollIntoViewIfNeeded();
  await expect(button(reviewBlock(page), 'Review and assign code')).toBeVisible();
  await reviewBlock(page).evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const said = await reviewBlock(page).locator('p').allTextContents();
  await capture(page, 'mocked-30-live-reviews-read.png', 'Only the canonical record is mocked (UNIT-3B before its '
    + 'code), so that the block asks for the reviews: the reviews read is the GET the demo answers itself. It '
    + 'lists one review, already used by the assignment, so the block offers a new review and no Assign code.');
  mock.delete(CANONICAL);
  return { liveReviewReads: (requests.get(live) ?? 0) - readsBefore, said,
    offered: await reviewBlock(page).getByRole('button').allTextContents() };
}

/** The control that holds the focus, by its label or text, and whether it lies inside the dialog. */
function focused(page) {
  return page.evaluate(() => {
    const node = document.activeElement;
    const name = node.labels?.[0]?.textContent ?? node.getAttribute('aria-label') ?? node.textContent.trim();
    return `${node.closest('[role="dialog"]') ? '' : 'outside the dialog: '}${node.tagName.toLowerCase()} ${name}`;
  });
}

/**
 * Opens a dialog with Enter on its action, fills its form (nothing is sent), presses Tab until the focus is back
 * where it began, then Escape.
 */
async function walk(page, opener, fill) {
  await opener.focus();
  await page.keyboard.press('Enter');
  // The form appears when the record of the unit is read; its first field then takes the focus.
  const first = page.getByRole('dialog').locator('input, textarea').first();
  await expect(first).toBeFocused();
  await fill(page.getByRole('dialog'));
  await first.focus();
  const stops = [await focused(page)];
  for (let presses = 0; presses < 16; presses += 1) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    if (stop === stops[0] && stops.length > 1) break;
    if (stop !== stops.at(-1)) stops.push(stop);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(opener).toBeFocused();
  return { openedWith: 'Enter', stops, closedWith: 'Escape', focusAfterClose: await opener.textContent() };
}

/** Both dialogs by keyboard alone: the order of the stops, and the focus back on the action that opened them. */
async function keyboardWalk(page) {
  const review = await walk(page, await openReviewDialog(page), () => page.keyboard.type(typedReason()));
  for (const route of [CANONICAL, REVIEWS]) mock.delete(route);
  mock.set(CARD_LIST, shaped('cardsNone'));
  const issue = await walk(page, await openIssueDialog(page, 'Issue card'), async (dialog) => {
    await dialog.getByLabel('Valid until (required)').fill(typedAt(12));
    await dialog.getByLabel('Why this citation is included (required)').fill(typedReason());
  });
  mock.delete(CARD_LIST);
  assert.ok([...review.stops, ...issue.stops].every((stop) => !stop.startsWith('outside')));
  return { review, issue };
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await open(browser, WIDE);
  const assigned = await reviewAndAssign(page);
  const listed = await assignFromListedReview(page);
  const zoomReview = await zoomedReview(browser);
  for (const route of [CANONICAL, REVIEWS]) mock.delete(route);
  const issued = await firstCardIssued(page, await firstCardForm(page));
  const revised = await newRevision(page);
  const zoomIssue = await zoomedIssue(browser);
  const inspector = await inspectorLinks(page);
  const reviewsRead = await liveReviewsRead(page);
  assert.equal(reviewsRead.liveReviewReads, 1);
  const keyboard = await keyboardWalk(page);
  const zoomInspector = await zoomedInspector(browser);
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(pageErrors, []);
  const result = { exit: 0, studio, blockedWrites, pageErrors, apiRequests: Object.fromEntries([...requests].sort()),
    assigned, listed, zoomReview, issued, revised, zoomIssue, inspector, reviewsRead, keyboard, zoomInspector,
    screenshots };
  writeFileSync(resolve(out, 'browser-result.json'), `${JSON.stringify(result)}\n`);
} finally {
  await browser.close();
}
