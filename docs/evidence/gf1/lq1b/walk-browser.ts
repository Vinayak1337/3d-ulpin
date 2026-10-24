import assert from 'node:assert/strict';
import type { Browser, Page } from '@playwright/test';

type Result = Record<string, any>;
type Observation = ReturnType<typeof observe>;

export async function browserWalk(browser: Browser, url: string, scratch: string,
  result: Result, cutNetwork: () => void) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript('window.__name = value => value;');
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const primary = observe(page, result, 'primary');
  result.observed = primary;
  const batchUrl = await startBatch(page, url, scratch, result);
  await buildings(page, batchUrl, scratch, result, primary);
  const other = await context.newPage();
  other.setDefaultTimeout(60000);
  const secondary = observe(other, result, 'second-window');
  await other.goto(batchUrl);
  await other.getByRole('button', { name: 'Choose the first 100 ready', exact: true }).waitFor();
  await cards(page, other, scratch, result);
  await parks(page, scratch, result, primary);
  await context.setOffline(true);
  cutNetwork();
  await page.getByRole('button', { name: 'Reconnect updates', exact: true }).waitFor({ timeout: 30000 });
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Reconnect updates', exact: true }).click();
  await page.waitForTimeout(5500);
  result.streams = { primary: primary.streams, second: secondary.streams,
    offlineThenReconnect: true, bannerCleared: await page.getByRole('button',
      { name: 'Reconnect updates', exact: true }).count() === 0 };
  await other.close();
  await page.close();
}

async function startBatch(page: Page, url: string, scratch: string, result: Result) {
  const start = performance.now();
  await page.goto(`${url}studio/add-files`);
  await page.locator('input[type=file]').setInputFiles(result.inputs[0].path);
  await page.getByRole('dialog', { name: 'Retain map files' }).waitFor();
  await page.getByLabel('New case name', { exact: true }).fill('NYC test_only layout and cards');
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.waitForURL(/\/studio\/work\/cases\/[^/]+\/intake$/);
  result.caseId = page.url().split('/').at(-2);
  await page.getByLabel('What is each feature in this file?', { exact: true }).waitFor();
  result.dropToQuestionMs = Math.round(performance.now() - start);
  await page.screenshot({ path: `${scratch}/question.png`, fullPage: true });
  return page.url();
}

async function buildings(page: Page, batchUrl: string, scratch: string, result: Result, observed: Observation) {
  await choose(page, 'building', '/features/*/properties/doitt_id');
  const pressed = performance.now();
  await page.getByRole('button', { name: 'Use this layout', exact: true }).click();
  const packageLink = page.getByRole('link', { name: 'Open package', exact: true });
  await packageLink.waitFor({ timeout: 120000 });
  result.pressToPackageMs = Math.round(performance.now() - pressed);
  result.buildingBody = observed.authorBodies[0];
  assert(!('destination' in result.buildingBody));
  assert(!('heightField' in result.buildingBody.plan));
  result.areaUrl = await packageLink.getAttribute('href');
  await packageLink.click();
  await page.waitForTimeout(3000);
  result.area = { url: page.url(), canvasCount: await page.locator('canvas').count(),
    body: await page.locator('main').innerText() };
  await page.screenshot({ path: `${scratch}/area.png`, fullPage: true });
  await page.goto(batchUrl);
  await page.getByRole('button', { name: 'Choose the first 100 ready', exact: true }).waitFor();
}

async function cards(page: Page, other: Page, scratch: string, result: Result) {
  await page.getByRole('button', { name: 'Choose the first 100 ready', exact: true }).click();
  await page.getByText('100 buildings chosen for a card.', { exact: true }).waitFor();
  await page.getByLabel('Your acknowledgement')
    .fill('I reviewed this NYC test_only package and choose the first 100 building cards.');
  const recorded = performance.now();
  await page.getByRole('button', { name: 'Record packages and make chosen cards', exact: true }).click();
  await page.getByRole('heading', { name: /^Confirmed / }).waitFor();
  const last = page.locator('details').last();
  await last.locator('summary').click();
  result.openedLastBeforeCard = !(await last.innerText()).includes('card made and verified');
  await page.getByRole('link', { name: 'Open card PDF', exact: true }).first().waitFor({ timeout: 120000 });
  result.pressToFirstCardMs = Math.round(performance.now() - recorded);
  await page.getByText('1661 recorded · 100 carded · 0 stopped', { exact: false }).waitFor({ timeout: 180000 });
  result.pressToHundredthMs = Math.round(performance.now() - recorded);
  await other.getByText('1661 recorded · 100 carded · 0 stopped', { exact: false }).waitFor();
  await page.screenshot({ path: `${scratch}/cards.png`, fullPage: true });
  result.cards = { pdfLinks: await page.getByRole('link', { name: 'Open card PDF', exact: true }).count() };
  await page.reload();
  await page.getByText('1661 recorded · 100 carded · 0 stopped', { exact: false }).waitFor();
  result.reloadKeptConfirmation = true;
}

function observe(page: Page, result: Result, label: string) {
  const state = { authorBodies: [] as any[], streams: { maximum: 0, open: 0, requests: 0,
    documentSegments: [] as { url: string; maximum: number }[] } };
  const open = new Set<any>();
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    state.streams.documentSegments.push({ url: frame.url(), maximum: state.streams.maximum });
    // A new document cannot own the previous document's request, even if its terminal callback is delayed.
    open.clear();
    state.streams.open = 0;
    state.streams.maximum = 0;
  });
  result.calls ??= [];
  result.errors ??= [];
  page.on('pageerror', error => result.errors.push({ label, words: error.message }));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/events')) {
      open.add(request);
      state.streams.requests++;
      state.streams.open = open.size;
      state.streams.maximum = Math.max(state.streams.maximum, open.size);
    }
    if (request.method() === 'POST' && path.endsWith('/recipes')) state.authorBodies.push(request.postDataJSON());
    if (request.method() === 'POST' && path.endsWith('/confirmations'))
      result.confirmBodies = [...(result.confirmBodies ?? []), request.postDataJSON()];
  });
  const closed = (request: any) => { open.delete(request); state.streams.open = open.size; };
  page.on('requestfinished', closed);
  page.on('requestfailed', closed);
  page.on('response', response => void responseFacts(response, result, label));
  return state;
}

async function responseFacts(response: any, result: Result, label: string) {
  if (!response.url().includes('/api/v1/')) return;
  const path = new URL(response.url()).pathname;
  const words = !response.ok() ? await response.json().catch(() => null) : undefined;
  if (response.ok() && ['intake', 'targets'].some(end => path.endsWith(`/${end}`))) {
    const body = await response.json();
    result[path.endsWith('/intake') ? 'manifest' : 'targets'] = body;
    if (new URL(response.url()).searchParams.get('readiness') === 'ready') result.readyChoice = body;
  }
  if (response.ok() && path.includes('/confirmations/')) {
    result.confirmation = await response.json();
    if (!result.firstSeenCarded && result.confirmation.counts.carded > 0)
      result.firstSeenCarded = result.confirmation.progress.filter((target: any) => target.readiness === 'carded')
        .map((target: any) => target.targetId);
  }
  result.calls.push({ label, method: response.request().method(), path, status: response.status(),
    ...(words ? { refusal: words } : {}) });
}

async function choose(page: Page, kind: string, identifier: string) {
  assert.equal(await page.getByLabel('Which field is its name?', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Does a field give its height?', { exact: true }).inputValue(), '');
  await page.getByLabel('What is each feature in this file?', { exact: true }).selectOption(kind);
  await page.getByLabel('Which field identifies each one?', { exact: true }).selectOption(identifier);
}

async function parks(page: Page, scratch: string, result: Result, observed: Observation) {
  await page.getByRole('button', { name: 'Add files to batch', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(result.inputs[1].path);
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  const parksRow = page.getByRole('row').filter({ hasText: 'parks.geojson' });
  await parksRow.getByRole('button', { name: 'View layout' }).click();
  await page.getByLabel('What is each feature in this file?', { exact: true }).waitFor();
  await choose(page, 'public_land', '/features/*/id');
  await page.getByRole('button', { name: 'Use this layout', exact: true }).click();
  await parksRow.getByRole('link', { name: 'Open package' }).waitFor({ timeout: 120000 });
  result.parksBody = observed.authorBodies.at(-1);
  await page.waitForTimeout(5500);
  await page.screenshot({ path: `${scratch}/parks.png`, fullPage: true });
  if (!await page.getByText('No building in this package; its features will be recorded.', { exact: true }).count()) {
    result.parks = { notConfirmed: true, publishedPackages: result.targets.packages,
      blocker: 'No current review fingerprint is published for this zero-building package. No refusal reason is published.',
      stopRule: 'a; no alternate review request or invented review pin' };
    return;
  }
  await page.getByLabel('Your acknowledgement')
    .fill('I reviewed the retained NYC parks public land package; no building card is chosen.');
  const before = result.calls.length;
  await page.getByRole('button', { name: 'Record packages and make chosen cards', exact: true }).click();
  await page.waitForTimeout(12000);
  result.parks = { body: await page.locator('main').innerText(),
    responses: result.calls.slice(before).filter((call: any) => call.method === 'POST') };
  await page.screenshot({ path: `${scratch}/parks.png`, fullPage: true });
}
