// Browser checks behind the F3h screenshots. The demo API is asked for GET reads and for the card list (a POST
// read the Studio already sends) only; every step the registry would store is answered here from the fixtures
// (fixtures.json names each source) and a write that is not answered here is refused and counted. Run from the
// repository root with the Studio dev server up:
//   node docs/evidence/gf5/f3h/capture.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.F3H_STUDIO ?? 'http://127.0.0.1:5190';
const r3 = process.env.F3H_R3 ?? 'E:/BhuAayam-data/task-data/r3/step3';
const f3d = JSON.parse(readFileSync(resolve(out, '../f3d/responses.json'), 'utf8'));
const f3e2 = JSON.parse(readFileSync(resolve(out, '../f3e2/fixtures.json'), 'utf8'));
const { shaped } = JSON.parse(readFileSync(resolve(out, 'fixtures.json'), 'utf8'));
const { buildingId: TOWER, spaceId: UNIT } = f3d;
const AREA = f3d.snapshots.siteId;
const LABEL = 'Mocked responses · not a registry record';
const WIDE = { viewport: { width: 1440, height: 900 } };
// A 1440 x 900 window at 200% browser zoom: 720 x 450 CSS px, two device pixels per CSS pixel.
const ZOOMED = { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 };
const ZOOM = '200% zoom (720 x 450 CSS px, device scale 2)';
const candidatesUrl = `${studio}/studio/properties/${TOWER}/candidates`;
const areaUrl = `${studio}/studio/areas/${AREA}?feature=${TOWER}`;
const CANONICAL = `GET /api/v1/buildings/${TOWER}/canonical`;
const REGISTER = `GET /api/v1/buildings/${TOWER}/register`;
const REVIEWS = `GET /api/v1/usp/identity/records/${UNIT}/reviews`;
const CAPTURE = 'POST /api/v1/usp/snapshots';
const ASSIGN = 'POST /api/v1/usp/identity/assign';
const CARD_LIST = 'POST /api/v1/usp/property-cards/list';
const ENTRIES = 'POST /api/v1/usp/packets/plans/entries';
const PLAN = 'POST /api/v1/usp/packets/plans/create';
const CONFIRM = 'POST /api/v1/usp/packets/plans/confirm';
const EXECUTE = 'POST /api/v1/usp/packets/plans/execute';
const PREVIEW = 'POST /api/v1/usp/property-cards/preview';
// The POST read the Studio already sends: the only non-GET request that may reach the demo.
const LIVE_POST_READS = new Set([CARD_LIST]);
const LOST = 'lost';
const UNKNOWN = 'The result is unknown: no answer says whether the registry stored anything.';

const screenshots = [];
const requests = new Map();
const blockedWrites = [];
const pageErrors = [];
/** What answers a request in place of the demo: route -> { status, json }, a function of the body, or LOST. */
const mock = new Map();

const stored = (file) => JSON.parse(readFileSync(resolve(r3, file), 'utf8'));
const recorded = (route) => ({ status: 200, json: stored(f3e2.recorded[route].file).body });
const count = (key) => requests.set(key, (requests.get(key) ?? 0) + 1);
const generic = (key) => key.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}');
const live = async (path) => (await fetch(`${studio}${path}`)).json();

/** Answers a mocked route, lets a read through to the demo, and refuses and counts every other request. */
async function guard(route) {
  const request = route.request();
  const key = `${request.method()} ${new URL(request.url()).pathname}`;
  const answer = mock.get(key);
  if (answer) {
    count(`mocked ${generic(key)}`);
    const given = typeof answer === 'function' ? answer(request.postDataJSON()) : answer;
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

/**
 * Counts, inside the page, the card list reads that are under way at once: from the call of fetch until its
 * answer arrives or fails. The count starts again with every document.
 */
function countCardReads() {
  const reads = { now: 0, most: 0 };
  const send = window.fetch;
  window.cardReads = reads;
  window.fetch = async (...args) => {
    if (!String(args[0]?.url ?? args[0]).endsWith('/property-cards/list')) return send(...args);
    reads.now += 1;
    reads.most = Math.max(reads.most, reads.now);
    try {
      return await send(...args);
    } finally {
      reads.now -= 1;
    }
  };
}
const mostCardReads = (page) => page.evaluate(() => window.cardReads.most);

async function open(browser, size) {
  // Service workers are blocked so that every request of a page passes the guard. The officer's clock is IST.
  const context = await browser.newContext({ ...size, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
  await context.route((url) => url.pathname.startsWith('/api/'), guard);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(countCardReads);
  return page;
}

const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const floorItem = (page) => page.getByRole('list', { name: 'Floors recorded from a source label' })
  .locator('> li').first();
const cardsBlock = (page) => page.getByRole('region', { name: 'Cards of UNIT-3B', exact: true });
const reviewBlock = (page) => page.getByRole('region', { name: 'Review and code of UNIT-3B', exact: true });
const centre = (locator) => locator.evaluate((node) => node.scrollIntoView({ block: 'center' }));
const top = (locator) => locator.evaluate((node) => node.scrollIntoView({ block: 'start' }));
/** How far the page is wider than its window: 0 when nothing scrolls it sideways. */
const pageOverflow = (page) => page.evaluate(() => {
  const root = document.documentElement;
  return root.scrollWidth - root.clientWidth;
});
/** The rows of a description list as label -> text. */
const facts = (scope) => scope.locator('dl').first().evaluate((list) => Object.fromEntries(
  [...list.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling.textContent])));

/** The recorded panel on live reads: the floor's identifier from the register read, and the unit's states. */
async function recordedPanel(page, files, zoom) {
  const register = await live(`/api/v1/buildings/${TOWER}/register`);
  const canonical = await live(`/api/v1/buildings/${TOWER}/canonical`);
  const level = canonical.levels.find((item) => item.registryFloorId);
  const unit = level.spaces.find((space) => space.spaceId === UNIT);
  const entry = register.register.find((record) => record.id === level.registryFloorId);
  await page.goto(candidatesUrl);
  const floor = floorItem(page);
  await expect(button(floor, `Copy identifier ${entry.identifier}`)).toBeVisible();
  const floorFacts = await facts(floor);
  const unitFacts = await facts(page.locator(`[id="unit-${UNIT}"]`));
  assert.equal(floorFacts.Identifier, entry.identifier);
  assert.deepEqual([unit.kind.state, unit.areaM2.state], ['unknown', 'unknown']);
  assert.deepEqual([unitFacts.Kind, unitFacts.Area], ['Unknown', 'Unknown']);
  // The cards are asked for when their block is seen; the screenshot waits for the answer.
  await cardsBlock(page).scrollIntoViewIfNeeded();
  await expect(cardsBlock(page)).toContainText('Read under');
  await top(floor);
  await capture(page, files[0], `Live reads only${zoom}: the floor prints the identifier the register read `
    + 'states, with the copy control. UNIT-3B reads Unknown for Kind and Area because the canonical read itself '
    + 'says unknown for both.');
  return { floor: floorFacts, unit: { Kind: unitFacts.Kind, Area: unitFacts.Area },
    identifierFrom: 'register[].identifier of the entry whose id is the floor\'s registryFloorId',
    pageOverflowPx: await pageOverflow(page) };
}

/** The cards block on live reads: every listed snapshot is asked, one read at a time, and the card is listed once. */
async function liveCards(page, file, zoom) {
  const listing = await live(`/api/v1/buildings/${TOWER}/snapshots`);
  const key = generic(CARD_LIST);
  const before = requests.get(key) ?? 0;
  await page.goto(candidatesUrl);
  await cardsBlock(page).scrollIntoViewIfNeeded();
  const said = `Read under ${listing.items.length} snapshots`;
  await expect(cardsBlock(page)).toContainText(said);
  const rows = await cardsBlock(page).locator('tbody tr').allInnerTexts();
  const sentences = await cardsBlock(page).locator('p').allTextContents();
  const mostInFlight = await mostCardReads(page);
  assert.equal((requests.get(key) ?? 0) - before, listing.items.length);
  assert.equal(mostInFlight, 1);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /At its present revision/);
  await centre(cardsBlock(page));
  await capture(page, file, `Live reads only${zoom}: the ${listing.items.length} snapshots of the listing each `
    + 'list the same card revision; it is listed once, with the state of the unit in its snapshot.');
  return { snapshotsListed: listing.items.length, cardListReads: listing.items.length, mostInFlight,
    rows: rows.map((row) => row.replace(/\s+/g, ' ')), sentences, pageOverflowPx: await pageOverflow(page) };
}

/** The live canonical answer with the kind and the area of UNIT-3B stated as absent. */
async function canonicalAbsent() {
  const answer = await live(`/api/v1/buildings/${TOWER}/canonical`);
  const unit = answer.levels.flatMap((level) => level.spaces).find((space) => space.spaceId === UNIT);
  unit.kind = { ...unit.kind, state: 'absent' };
  unit.areaM2 = { ...unit.areaM2, state: 'absent' };
  return { status: 200, json: answer };
}

/** The live register answer without the entry of the recorded floor. */
async function registerWithoutFloor() {
  const answer = await live(`/api/v1/buildings/${TOWER}/register`);
  const canonical = await live(`/api/v1/buildings/${TOWER}/canonical`);
  const floorId = canonical.levels.find((level) => level.registryFloorId).registryFloorId;
  answer.register = answer.register.filter((record) => record.id !== floorId);
  return { status: 200, json: answer };
}

/** A floor the register read states no identifier for, and a unit whose kind and area the record states absent. */
async function statesInWords(page, file, zoom) {
  mock.set(CANONICAL, await canonicalAbsent());
  mock.set(REGISTER, await registerWithoutFloor());
  await page.goto(candidatesUrl);
  const floor = floorItem(page);
  await expect(floor).toContainText('The register read states no identifier for this floor.');
  const floorFacts = await facts(floor);
  const unitFacts = await facts(page.locator(`[id="unit-${UNIT}"]`));
  assert.deepEqual([unitFacts.Kind, unitFacts.Area], ['Not recorded', 'Not recorded']);
  assert.equal(await floor.getByRole('button', { name: /^Copy identifier/ }).count(), 0);
  await top(floor);
  await capture(page, file, `Mocked canonical and register reads${zoom}: the register lists no entry for the floor, `
    + 'so the row says so in words; Kind and Area read Not recorded where the record states absent.');
  mock.set(REGISTER, { status: 503, body: '' });
  await page.goto(candidatesUrl);
  await expect(floorItem(page)).toContainText('The register could not be read, so no identifier is shown.');
  for (const route of [CANONICAL, REGISTER]) mock.delete(route);
  return { floorIdentifier: floorFacts.Identifier, unit: { Kind: unitFacts.Kind, Area: unitFacts.Area },
    registerFailed: 'The register could not be read, so no identifier is shown.',
    pageOverflowPx: await pageOverflow(page) };
}

/** One answer per snapshot of the live listing, as fixtures.json (cardsAcrossSnapshots) lays them out. */
async function cardsBySnapshot() {
  const listing = await live(`/api/v1/buildings/${TOWER}/snapshots`);
  const plan = shaped.cardsAcrossSnapshots;
  const { marker, ...changed } = plan.olderCard;
  const [listed] = f3d.cardList.data.items;
  const answers = {
    none: { status: 200, json: { data: { items: [], truncated: false } } },
    lost: LOST,
    cards: { status: 200, json: { data: { items: [listed, { ...listed, ...changed }], truncated: false } } },
    gateway: { status: shaped.gateway.status, body: '' },
  };
  // Every snapshot of a site shares its scopeId; the manifest is what tells them apart.
  const order = listing.items.map((item) => item.scope.manifestId);
  assert.equal(order.length, plan.bySnapshot.length);
  assert.equal(new Set(order).size, order.length);
  return (body) => answers[plan.bySnapshot[order.indexOf(body.scope.manifestId)]];
}

/** Cards from an older snapshot stay listed, and the snapshots that could not be read are counted under them. */
async function mockedCards(page, file, zoom) {
  mock.set(CARD_LIST, await cardsBySnapshot());
  await page.goto(candidatesUrl);
  await cardsBlock(page).scrollIntoViewIfNeeded();
  await expect(cardsBlock(page)).toContainText('2 of 4 snapshots could not be read.');
  const rows = (await cardsBlock(page).locator('tbody tr').allInnerTexts()).map((row) => row.replace(/\s+/g, ' '));
  const sentences = await cardsBlock(page).locator('p').allTextContents();
  assert.equal(rows.length, 2);
  assert.match(rows[0], /At its present revision/);
  assert.match(rows[1], /Expired .* Changed since this card/);
  const mostInFlight = await mostCardReads(page);
  assert.equal(mostInFlight, 1);
  // The whole list decides the action: the valid card of the third snapshot can take a revision.
  await expect(button(cardsBlock(page), 'Issue new revision')).toBeVisible();
  // A short window shows the sentence under the list; a tall one shows the whole block.
  await centre(zoom ? cardsBlock(page).getByText('snapshots could not be read') : cardsBlock(page));
  await capture(page, file, `Mocked card lists${zoom}: the newest snapshot lists none, the second read gets no `
    + 'answer, the third lists two cards and the fourth is answered 502. Both cards stay listed, each with the '
    + 'state of the unit in its snapshot, and the two failed reads are counted in one sentence.');
  mock.delete(CARD_LIST);
  return { rows, sentences, mostInFlight, action: 'Issue new revision',
    pageOverflowPx: await pageOverflow(page) };
}

/** The demo's canonical answer with UNIT-3B as R3 read it before the assignment: no code, record revision 1. */
async function canonicalBefore() {
  const answer = await live(`/api/v1/buildings/${TOWER}/canonical`);
  const unit = answer.levels.flatMap((level) => level.spaces).find((space) => space.spaceId === UNIT);
  unit.proposedCode = { ...unit.proposedCode, value: null, state: 'unknown' };
  answer.inputRevisions.find((pin) => pin.namespace === 'registry_record' && pin.id === UNIT).revision = 1;
  return { status: 200, json: answer };
}

/** The review R3 stored, as the reviews read lists it while no assignment has used it. */
function listedReview() {
  const request = stored('03-review-request.json');
  const answer = stored('03-review-response.json').body.data;
  const item = { reviewId: answer.reviewId, operation: 'assign', reason: request.body.reason,
    createdAt: request.at, scope: request.body.scope, expectedManifestId: answer.expectedManifestId,
    expectedRecordVersion: 1, used: null, commandSha256: answer.commandSha256 };
  return { status: 200, json: { recordId: UNIT, siteId: AREA, items: [item], truncated: false, unreadable: 0 } };
}

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

async function openAssignDialog(page) {
  mock.set(CANONICAL, await canonicalBefore());
  mock.set(REVIEWS, listedReview());
  await page.goto(candidatesUrl);
  await reviewBlock(page).scrollIntoViewIfNeeded();
  const opener = button(reviewBlock(page), 'Assign code');
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(button(dialog, 'Assign code')).toBeEnabled();
  return dialog;
}

/** One assignment that is answered as `answer`, and the sentence the dialog then states. */
async function unknownOutcome(page, dialog, answer, said) {
  mock.set(ASSIGN, answer);
  await button(dialog, 'Assign code').click();
  const notice = dialog.getByRole('alert').or(dialog.getByRole('status')).filter({ hasText: 'The result is' });
  await expect(notice).toHaveText(said);
  await expect(button(dialog, 'Assign code')).toBeDisabled();
  return (await notice.textContent()).trim();
}

/** The three unknown outcomes of an assignment: no answer, a 502 without a body, a fault with a code. */
async function unknownSentences(page) {
  const dialog = await openAssignDialog(page);
  const reviewIds = await dialog.getByRole('button', { name: /^Copy (review|snapshot) id / }).count();
  assert.equal(reviewIds, 2);
  const noAnswer = await unknownOutcome(page, dialog, LOST, UNKNOWN);
  await capture(page, 'mocked-09-unknown-no-answer.png', 'The assignment got no answer: the fixed sentence alone, '
    + 'without the words of the browser. The review and its snapshot carry the copy control.');
  await button(dialog, 'Read the record again').click();
  await expect(button(dialog, 'Assign code')).toBeEnabled();
  const gateway = await unknownOutcome(page, dialog, { status: shaped.gateway.status, body: '' }, UNKNOWN);
  await capture(page, 'mocked-10-unknown-502-without-body.png', 'The assignment is answered 502 with an empty '
    + 'body: the same fixed sentence, with no status line after it.');
  await button(dialog, 'Read the record again').click();
  await expect(button(dialog, 'Assign code')).toBeEnabled();
  const fault = { status: shaped.faultWithCode.status, json: shaped.faultWithCode.body };
  const code = shaped.faultWithCode.body.error.code;
  const withCode = await unknownOutcome(page, dialog, fault, `${UNKNOWN} (${code})`);
  await capture(page, 'mocked-11-unknown-fault-with-code.png', `The assignment is answered 503 ${code}: the fixed `
    + 'sentence and the code of the server, without its sentence.');
  for (const text of [noAnswer, gateway, withCode]) assert.doesNotMatch(text, /fetch|502|post-state/i);
  await page.keyboard.press('Escape');
  for (const route of [CANONICAL, REVIEWS, ASSIGN]) mock.delete(route);
  return { noAnswer, gateway502: gateway, faultWithCode: withCode };
}

async function zoomedUnknown(browser) {
  const page = await open(browser, ZOOMED);
  const dialog = await openAssignDialog(page);
  const said = await unknownOutcome(page, dialog, LOST, UNKNOWN);
  await dialog.getByText(UNKNOWN).scrollIntoViewIfNeeded();
  const room = await footerWhole(page);
  await capture(page, 'mocked-12-zoom-200-unknown-no-answer.png', `${ZOOM}: the unknown outcome of an assignment `
    + 'that got no answer; the actions are whole.');
  assert.ok(room.whole && room.widthOverflowPx <= 0);
  for (const route of [CANONICAL, REVIEWS, ASSIGN]) mock.delete(route);
  await page.context().close();
  return { said, ...room };
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
  return inspectorOf(page);
}

/** What the inspector holds: its footer's actions, the link to the recorded unit, and the room the rows get. */
function inspectorState(inspector) {
  return inspector.evaluate((node) => {
    const [above, footer] = node.children;
    const box = node.getBoundingClientRect();
    const actions = [...(footer?.querySelectorAll('button, a') ?? [])];
    const link = [...node.querySelectorAll('a')].find((item) => item.textContent.trim() === 'Open recorded unit');
    const rects = actions.map((action) => action.getBoundingClientRect());
    return { actions: actions.map((action) => action.textContent.trim()),
      link: link ? { inFooter: Boolean(link.closest('footer')), asButton: link.classList.contains('ul-btn'),
        underlined: getComputedStyle(link).textDecorationLine === 'underline' } : null,
      heightPx: Math.round(box.height), rowsShownPx: above.clientHeight, rowsContentPx: above.scrollHeight,
      widthOverflowPx: above.scrollWidth - node.clientWidth,
      actionsWhole: rects.every((rect) => rect.top >= box.top && rect.bottom <= box.bottom
        && rect.left >= box.left && rect.right <= box.right) };
  });
}

/** With a card listed (live): one button, and the way to the recorded unit as a text link in the note. */
async function inspectorWithCard(page, file, zoom) {
  const inspector = await selectUnit(page);
  await expect(inspector).toContainText('Listed by the registry');
  const link = inspector.getByRole('link', { name: 'Open recorded unit', exact: true });
  await link.scrollIntoViewIfNeeded();
  const state = await inspectorState(inspector);
  assert.deepEqual(state.actions, ['Property Card']);
  assert.deepEqual(state.link, { inFooter: false, asButton: false, underlined: true });
  assert.ok(state.actionsWhole && state.widthOverflowPx <= 0);
  await capture(page, file, `Live reads only${zoom}: UNIT-3B with a listed card. Property Card is the one button; `
    + 'Open recorded unit is a text link at the end of the note.');
  return state;
}

/** With no card listed (mocked empty lists): the link is the inspector's one button. */
async function inspectorWithoutCard(page, file, zoom) {
  mock.set(CARD_LIST, { status: 200, json: f3e2.shaped.cardsNone.body });
  const inspector = await selectUnit(page);
  const link = inspector.getByRole('link', { name: 'Open recorded unit', exact: true });
  await expect(link).toBeVisible();
  await expect(inspector).not.toContainText('Listed by the registry');
  const state = await inspectorState(inspector);
  assert.deepEqual(state.actions, ['Open recorded unit']);
  assert.deepEqual([state.link.inFooter, state.link.asButton], [true, true]);
  assert.ok(state.actionsWhole && state.widthOverflowPx <= 0);
  await capture(page, file, `Mocked empty card lists${zoom}: UNIT-3B with no card listed. Open recorded unit is `
    + 'the one button.');
  mock.delete(CARD_LIST);
  return state;
}

const meta = () => stored('09-card-response.json').body.meta;
/** A date and time as the officer types it in IST, some hours from now. */
const typedAt = (hours) => new Date(Date.now() + (hours + 5.5) * 3_600_000).toISOString().slice(0, 16);
const typedReason = () => stored('06-plan-request.json').body.input.entries[0].inclusionReason;

/** The entry of UNIT-3B as docs/evidence/gf4/k12/REQUESTS.md (read 1) states the answer; contract-shaped. */
function entries(body) {
  const { bindingId } = stored('06-plan-request.json').body.input.entries[0];
  const { sourceId, revision, locator } = stored('03-review-request.json').body.evidence[0];
  const entry = { bindingId, kind: 'source_statement', label: 'UNIT-3B', includable: true, reasonCode: null,
    citation: { sourceId, revision, locator, page: 1, region: [596, 390, 644, 409] } };
  return { status: 200, json: { data: { target: body.target, entries: [entry] }, meta: meta() } };
}

/** The rows R3's card answered, as the preview of the same inputs (REQUESTS.md, read 2); contract-shaped. */
function preview(body) {
  const card = stored('09-card-response.json').body.data;
  return { status: 200, json: { meta: meta(),
    data: { mode: 'create', revision: 1, facts: card.facts, expiresAt: body.expiresAt, scope: card.scope } } };
}

/** After Prepare the binding, the plan and the packet ids each carry the copy control. */
async function answeredIds(page, file, zoom) {
  mock.set(CARD_LIST, { status: 200, json: f3e2.shaped.cardsNone.body });
  for (const route of [CAPTURE, PLAN, CONFIRM, EXECUTE]) mock.set(route, recorded(route));
  mock.set(ENTRIES, entries);
  mock.set(PREVIEW, preview);
  await page.goto(candidatesUrl);
  await cardsBlock(page).scrollIntoViewIfNeeded();
  await button(cardsBlock(page), 'Issue card').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valid until (required)').fill(typedAt(12));
  await dialog.getByLabel('Why this citation is included (required)').fill(typedReason());
  await button(dialog, 'Prepare').click();
  const answered = dialog.getByLabel('Answered by the registry');
  const plan = stored('06-plan-response.json').body.data;
  const copyPlan = button(answered, `Copy plan id ${plan.planId}`);
  await expect(copyPlan).toBeVisible();
  const copies = await answered.getByRole('button').evaluateAll((nodes) => nodes.map(
    (node) => node.getAttribute('aria-label').replace(/ [0-9a-f-]{36,64}$/, ' {id}')));
  assert.deepEqual(copies, ['Copy binding id {id}', 'Copy plan id {id}', 'Copy packet id {id}']);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copyPlan.click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, plan.planId);
  await centre(answered);
  const room = await footerWhole(page);
  assert.ok(room.whole && room.widthOverflowPx <= 0);
  await capture(page, file, `Mocked Prepare${zoom}: the binding, the plan and the packet as answered, each id with `
    + 'its copy control; the sha256 stays text.');
  await page.keyboard.press('Escape');
  for (const route of [CARD_LIST, CAPTURE, PLAN, CONFIRM, EXECUTE, ENTRIES, PREVIEW]) mock.delete(route);
  return { copies, copiedPlanIdEqualsAnswer: true, ...room };
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const wide = await open(browser, WIDE);
  const zoomed = await open(browser, ZOOMED);
  const at = ` at ${ZOOM}`;
  const panel = await recordedPanel(wide, ['live-01-recorded-floor-and-unit.png'], '');
  const panelZoomed = await recordedPanel(zoomed, ['live-02-zoom-200-recorded-floor-and-unit.png'], at);
  const cards = await liveCards(wide, 'live-03-cards-across-snapshots.png', '');
  const cardsZoomed = await liveCards(zoomed, 'live-04-zoom-200-cards-across-snapshots.png', at);
  const states = await statesInWords(wide, 'mocked-05-no-identifier-and-not-recorded.png', '');
  const statesZoomed = await statesInWords(zoomed, 'mocked-06-zoom-200-no-identifier-and-not-recorded.png', at);
  const older = await mockedCards(wide, 'mocked-07-cards-of-older-snapshots-and-failed-reads.png', '');
  const olderZoomed = await mockedCards(zoomed, 'mocked-08-zoom-200-cards-and-failed-reads.png', at);
  const unknown = await unknownSentences(wide);
  const unknownZoomed = await zoomedUnknown(browser);
  const withCard = await inspectorWithCard(wide, 'live-13-inspector-card-listed.png', '');
  const withCardZoomed = await inspectorWithCard(zoomed, 'live-14-zoom-200-inspector-card-listed.png', at);
  const withoutCard = await inspectorWithoutCard(wide, 'mocked-15-inspector-no-card.png', '');
  const withoutCardZoomed = await inspectorWithoutCard(zoomed, 'mocked-16-zoom-200-inspector-no-card.png', at);
  const ids = await answeredIds(wide, 'mocked-17-answered-ids-with-copy.png', '');
  const idsZoomed = await answeredIds(zoomed, 'mocked-18-zoom-200-answered-ids-with-copy.png', at);
  for (const result of [panel, panelZoomed, cards, cardsZoomed, states, statesZoomed, older, olderZoomed]) {
    assert.ok(result.pageOverflowPx <= 0);
  }
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(pageErrors, []);
  const result = { exit: 0, studio, zoomMethod: 'viewport 720x450 at device scale 2', blockedWrites, pageErrors,
    apiRequests: Object.fromEntries([...requests].sort()), panel, panelZoomed, cards, cardsZoomed, states,
    statesZoomed, older, olderZoomed, unknown, unknownZoomed, withCard, withCardZoomed, withoutCard,
    withoutCardZoomed, ids, idsZoomed, screenshots };
  writeFileSync(resolve(out, 'browser-result.json'), `${JSON.stringify(result)}\n`);
} finally {
  await browser.close();
}
