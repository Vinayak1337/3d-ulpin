import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const OUT = resolve(import.meta.dirname);
const API = 'http://127.0.0.1:3194/api/v1';
const STUDIO = 'http://127.0.0.1:5188';
const AREA = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
const TOWER = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const REASON = 'F2c UI check: reject-only command and history; not an accuracy label or registry admission.';
const ROOM_REASON = 'F2c intercepted UI check only; not an accuracy label or a live room decision.';
const RECORD_ONE = process.argv.includes('--record-one');
const livePath = resolve(OUT, 'live-decision.json');
const attemptPath = resolve(OUT, 'live-attempt.json');
const pageErrors = [];
const intercepted = [];
const refused = [];
let liveWrites = 0;

function save(name, value) {
  writeFileSync(resolve(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function get(path) {
  const response = await fetch(`${API}${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}

function itemId(candidate) {
  return /\/spatial-ml\/items\/([0-9a-f-]{36})#/.exec(candidate.outputRef)?.[1];
}

function candidateUrl(scope, id, candidateId) {
  return `${STUDIO}/studio/${scope}/${id}/candidates?candidate=${encodeURIComponent(candidateId)}`;
}

async function openCard(page, scope, id, candidate) {
  await page.goto(candidateUrl(scope, id, candidate.candidateId));
  const title = candidate.kind === 'roofprint'
    ? `Roofprint ${candidate.candidateId.slice(0, 8)}` : candidate.labelLiteral;
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function screenshot(page, name, interceptedLabel) {
  if (interceptedLabel) {
    await page.evaluate((label) => {
      const tag = document.createElement('div');
      tag.id = 'f2c-intercepted-capture';
      tag.textContent = label;
      Object.assign(tag.style, {
        position: 'fixed', top: '8px', left: '360px', zIndex: '9999', padding: '8px 12px',
        background: 'var(--ui-surface)', color: 'var(--ui-ink)', border: '1px solid var(--ui-border-strong)',
        font: '500 13px var(--ui-font-sans)',
      });
      document.body.append(tag);
    }, interceptedLabel);
    intercepted.push(name);
  }
  await page.screenshot({ path: resolve(OUT, name) });
  await page.locator('#f2c-intercepted-capture').evaluateAll((tags) => tags.forEach((tag) => tag.remove()));
}

async function guardWrites(page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.continue();
    const path = new URL(request.url()).pathname;
    const roofRoute = /^\/api\/v1\/spatial-ml\/items\/[^/]+\/footprint-drafts$/.test(path);
    if (!RECORD_ONE || !roofRoute || liveWrites || existsSync(attemptPath)) {
      return route.abort('blockedbyclient');
    }
    const body = request.postDataJSON();
    assert.deepEqual(body.selections, []);
    assert.equal(body.rejected.length, 1);
    assert.equal(body.rejected[0].reason, REASON);
    assert.equal(Object.hasOwn(body, 'reason'), false);
    save('live-attempt.json', { path, body, time: new Date().toISOString() });
    liveWrites += 1;
    return route.continue();
  });
}

async function chooseCleanImage(area) {
  const decided = new Set(area.candidates.filter((candidate) => candidate.review).map(itemId));
  for (const candidate of area.candidates) {
    const id = itemId(candidate);
    if (candidate.review || !id || decided.has(id)) continue;
    const item = await get(`/spatial-ml/items/${id}`);
    if (!(item.footprintDrafts ?? []).length) return candidate;
  }
  throw new Error('No undecided image; do not write.');
}

async function recordOneRoofprint(page, area) {
  assert.equal(existsSync(attemptPath), false, 'A prior attempt exists; never repeat the live write.');
  const candidate = await chooseCleanImage(area);
  const id = itemId(candidate);
  await openCard(page, 'areas', AREA, candidate);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill(REASON);
  await page.getByRole('button', { name: 'Stage rejection', exact: true }).click();
  const recordButton = page.getByRole('button', { name: 'Record 1 decision', exact: true });
  await expect(recordButton).toBeEnabled();
  const pending = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().endsWith(`/spatial-ml/items/${id}/footprint-drafts`));
  await recordButton.click();
  const response = await pending;
  const result = await response.json();
  const decision = {
    candidateId: candidate.candidateId, itemId: id, status: response.status(),
    result: { package: result.package, receipt: {
      selections: result.receipt.selections, decisions: result.receipt.decisions,
    } },
  };
  save('live-decision.json', decision);
  assert.equal(response.status(), 200);
  assert.equal(result.package, null);
  await expect(page.getByRole('status')).toContainText('without a draft package');
  await screenshot(page, '01-roofprint-recorded.png');
  return decision;
}

async function assertNoActions(page) {
  for (const name of ['Accept', 'Reject', 'Accept on this level']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
}

async function roofprintCaptures(page, live) {
  const area = await get(`/areas/${AREA}/canonical`);
  const candidate = area.candidates.find((entry) => entry.candidateId === live.candidateId);
  assert.equal(candidate.review.outcome, 'rejected');
  assert.equal(candidate.review.reason, REASON);
  await openCard(page, 'areas', AREA, candidate);
  await assertNoActions(page);
  await screenshot(page, '03-decided-candidate-no-actions.png');
  await page.getByRole('tab', { name: /^History/ }).click();
  await expect(page.getByRole('list', { name: 'Decisions on record' })).toContainText(REASON);
  await screenshot(page, '02-roofprint-history.png');
  const accepted = area.candidates.find((entry) => entry.review?.outcome === 'accepted');
  await openCard(page, 'areas', AREA, accepted);
  await assertNoActions(page);
  return candidate.review;
}

async function levelPickerCapture(page, building, candidate) {
  await openCard(page, 'properties', MAGNOLIA, candidate);
  const picker = page.getByRole('combobox', { name: 'Level', exact: true });
  await expect(picker).toBeEnabled();
  const labels = await picker.locator('option').allTextContents();
  assert.deepEqual(labels.slice(1), building.levels.map((level) => level.label.value));
  assert.equal(labels.length, 4);
  await picker.selectOption(building.levels[0].levelId);
  await expect(page.getByRole('button', { name: 'Accept on this level' })).toBeEnabled();
  await picker.click();
  await screenshot(page, '06-live-magnolia-level-picker.png');
  await page.keyboard.press('Escape');
  return labels.slice(1);
}

async function roomInterception(page, original, candidate) {
  let decided = null;
  const actor = original.candidates.find((entry) => entry.review).review.actor;
  const path = `**/api/v1/buildings/${MAGNOLIA}/candidates`;
  await page.route(`**/api/v1/buildings/${MAGNOLIA}/canonical`, (route) => {
    return route.fulfill({ json: decided ?? original });
  });
  await page.route(path, async (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.action, 'reject');
    assert.equal(body.candidateId, candidate.candidateId);
    assert.equal(body.reason, ROOM_REASON);
    assert.equal(body.expectedCanonicalRevision, original.revisionId);
    assert.equal(route.request().headers()['idempotency-key'], body.requestKey);
    const time = new Date().toISOString();
    decided = structuredClone(original);
    const target = decided.candidates.find((entry) => entry.candidateId === candidate.candidateId);
    target.state = 'reviewed';
    target.review = { outcome: 'rejected', reason: body.reason, actor, time };
    await route.fulfill({ status: 201, json: {
      requestKey: body.requestKey, buildingId: MAGNOLIA,
      recordRevision: original.inputRevisions.find((entry) => entry.namespace === 'registry_record').revision + 1,
      candidateIds: [candidate.candidateId], actor, time, derivativeSha256: null,
    } });
  });
  await openCard(page, 'properties', MAGNOLIA, candidate);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill(ROOM_REASON);
  await screenshot(page, '04-room-reject-dialog-intercepted.png', 'Intercepted room rejection · no live write');
  await page.getByRole('button', { name: 'Record rejection', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Recorded the rejection');
  await assertNoActions(page);
  await screenshot(page, '05-room-reject-success-intercepted.png', 'Intercepted room success · no live write');
  await page.unroute(path);
  await page.unroute(`**/api/v1/buildings/${MAGNOLIA}/canonical`);
}

async function roomRefusal(page, candidate) {
  const path = `**/api/v1/buildings/${MAGNOLIA}/candidates`;
  const message = 'This candidate already has a review decision.';
  await page.route(path, (route) => route.fulfill({ status: 409, json: {
    error: { code: 'CANDIDATE_DECIDED', message },
  } }));
  await openCard(page, 'properties', MAGNOLIA, candidate);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill(ROOM_REASON);
  await page.getByRole('button', { name: 'Record rejection', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(`${message} (CANDIDATE_DECIDED)`);
  await screenshot(page, '07-room-refusal-intercepted.png', 'Intercepted CANDIDATE_DECIDED · server wording');
  refused.push('CANDIDATE_DECIDED');
  await page.unroute(path);
}

async function roofprintRefusal(page, area) {
  const candidate = area.candidates.find((entry) => !entry.review && itemId(entry));
  const path = `**/api/v1/spatial-ml/items/${itemId(candidate)}/footprint-drafts`;
  const message = 'This retained component already has a source-selection decision.';
  await page.route(path, (route) => route.fulfill({ status: 422, json: {
    error: { code: 'ML_REVIEW_SELECTION', message },
  } }));
  await openCard(page, 'areas', AREA, candidate);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill(REASON);
  await page.getByRole('button', { name: 'Stage rejection', exact: true }).click();
  await page.getByRole('button', { name: 'Record 1 decision', exact: true }).click();
  await expect(page.getByText(`${message} (ML_REVIEW_SELECTION)`, { exact: true })).toBeVisible();
  await screenshot(page, '08-roofprint-refusal-intercepted.png', 'Intercepted ML_REVIEW_SELECTION · server wording');
  refused.push('ML_REVIEW_SELECTION');
  await page.unroute(path);
}

async function difficultInput(page) {
  const tower = await get(`/buildings/${TOWER}/canonical`);
  assert.equal(tower.candidates.length, 0);
  await page.goto(`${STUDIO}/studio/properties/${TOWER}/candidates`);
  await expect(page.getByRole('heading', { name: 'Room candidates', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Select a candidate', exact: true })).toBeVisible();
  await assertNoActions(page);
  await screenshot(page, '09-live-tower-no-room-records.png');
  return { buildingId: TOWER, candidateCount: tower.candidates.length, gaps: tower.gaps };
}

async function zoomAndKeyboard(browser, room) {
  const page = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await guardWrites(page);
  await openCard(page, 'properties', MAGNOLIA, room);
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  const bounds = await reject.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 720);
  await reject.focus();
  await page.keyboard.press('Enter');
  const field = page.getByRole('textbox', { name: 'Reason (required)' });
  await field.fill('F2c keyboard-only check; dialog cancelled without submission.');
  await page.getByRole('button', { name: 'Record rejection', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(reject).toBeFocused();
  await screenshot(page, '10-zoom-equivalent-200-percent.png');
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.close();
  return { zoomEquivalentPercent: 200, focusTrap: true, escapeReturnsFocus: true, headerScrollWidth: scrollWidth };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const area = await get(`/areas/${AREA}/canonical`);
  const building = await get(`/buildings/${MAGNOLIA}/canonical`);
  const browser = await chromium.launch({ headless: true, args: [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await guardWrites(page);
    const live = RECORD_ONE ? await recordOneRoofprint(page, area) : JSON.parse(readFileSync(livePath, 'utf8'));
    const review = await roofprintCaptures(page, live);
    const room = building.candidates.find((entry) => !entry.review && entry.polygons?.length);
    const levels = await levelPickerCapture(page, building, room);
    await roomInterception(page, building, room);
    await roomRefusal(page, room);
    await roofprintRefusal(page, await get(`/areas/${AREA}/canonical`));
    const difficult = await difficultInput(page);
    for (const candidate of building.candidates.filter((entry) => entry.review)) {
      await openCard(page, 'properties', MAGNOLIA, candidate);
      await assertNoActions(page);
    }
    const accessibility = await zoomAndKeyboard(browser, room);
    assert.deepEqual(await get(`/buildings/${MAGNOLIA}/canonical`), building, 'No live room write.');
    assert.deepEqual(pageErrors, []);
    save('browser-result.json', {
      viewport: [1440, 900], liveWritesThisRun: liveWrites, liveRoomWrites: 0, liveRoomRecordUnchanged: true,
      roofprint: { candidateId: live.candidateId, itemId: live.itemId, package: live.result.package, review },
      magnolia: { buildingId: MAGNOLIA, levels, interceptedRoomOutputRef: room.outputRef },
      difficult, accessibility, intercepted, refusals: refused, pageErrors,
    });
    console.log('F2c captures passed; live room record unchanged.');
  } finally {
    await browser.close();
  }
}

await main();
