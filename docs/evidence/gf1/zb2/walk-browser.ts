import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { observeEventFrames } from './event-observation';

type Result = Record<string, any>;
const niagara = 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Condominiums_7254610803234545967.geojson';
const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const recordName = 'Record packages and make chosen cards';

export async function browserWalk(browser: Browser, url: string, scratch: string, result: Result) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  await page.addInitScript('window.__name = value => value;');
  await observeEventFrames(page);
  observe(page, result);
  result.parcels = await parcelStep(page, url, scratch, result);
  result.parks = await parksStep(page, url, scratch, result);
  result.zeroBuildingReviewReachesPage = Boolean(result.parcels.recordedWithoutReload
    && result.parks.recordedWithoutReload);
  await page.close();
}

async function parcelStep(page: Page, url: string, scratch: string, result: Result) {
  await newBatch(page, url, niagara, 'ZB2 Niagara test_only parcels', result);
  const loadsBefore = result.loads;
  await page.getByRole('option', { name: 'OBJECTID (whole number)', exact: true }).waitFor({ state: 'attached' });
  const answeredAt = new Date().toISOString();
  await answer(page, 'parcel', '/features/*/properties/OBJECTID');
  const opened = await openPackage(page);
  const offered = await offerPackage(page, 'I reviewed this retained Niagara test_only parcel package.');
  await page.screenshot({ path: `${scratch}/parcels-offered.png`, fullPage: true });
  const recorded = await recordFromPanel(page, scratch, 'parcels-recorded');
  return { answeredAt, opened, ...offered, ...recorded, reloads: result.loads - loadsBefore,
    recordedWithoutReload: result.loads === loadsBefore };
}

async function parksStep(page: Page, url: string, scratch: string, result: Result) {
  await newBatch(page, url, folder + 'buildings-original.geojson', 'ZB2 NYC test_only buildings then parks', result);
  const loadsBefore = result.loads;
  await answer(page, 'building', '/features/*/properties/doitt_id');
  await openPackage(page);
  await page.getByRole('button', { name: 'Choose the first 100 ready', exact: true }).click({ timeout: 300000 });
  await page.getByText('100 buildings chosen for a card.', { exact: true }).waitFor({ timeout: 120000 });
  await offerPackage(page, 'I reviewed the NYC test_only buildings for recording.');
  const startedAt = new Date().toISOString();
  await page.getByRole('button', { name: recordName, exact: true }).click();
  await page.getByText(/\d+ recorded · 100 carded/).waitFor({ timeout: 1800000 });
  const buildingsCarded = { startedAt, hundredthCardAt: new Date().toISOString() };
  await page.screenshot({ path: `${scratch}/buildings-carded.png`, fullPage: true });
  await addToBatch(page, folder + 'parks.geojson', result);
  const row = page.getByRole('row', { name: /parks\.geojson/ });
  await row.getByRole('button', { name: 'View layout', exact: true }).click();
  await answer(page, 'public_land', '/features/*/id');
  await row.getByRole('link', { name: 'Open package', exact: true }).waitFor({ timeout: 120000 });
  await page.getByLabel('Your acknowledgement').fill('I reviewed the NYC test_only parks for recording.');
  const offeredAt = await untilRecordable(page);
  await page.screenshot({ path: `${scratch}/parks-offered.png`, fullPage: true });
  const recorded = await recordFromPanel(page, scratch, 'parks-recorded');
  return { buildingsCarded, offeredAt, ...recorded, reloads: result.loads - loadsBefore,
    recordedWithoutReload: result.loads === loadsBefore };
}

/** The package link is the first sign the draft is ready; the page is then left untouched. */
async function openPackage(page: Page) {
  await page.getByRole('link', { name: 'Open package', exact: true }).first().waitFor({ timeout: 120000 });
  const reviewWords = await page.getByText('Its review has not run yet.').count();
  return { at: new Date().toISOString(), reviewNotRunYetShown: reviewWords > 0 };
}

async function offerPackage(page: Page, words: string) {
  await page.getByLabel('Your acknowledgement').fill(words);
  return { offeredAt: await untilRecordable(page) };
}

/** Waits, with no reload, until the recording button is pressable; returns when the screen first allowed it. */
async function untilRecordable(page: Page) {
  const button = page.getByRole('button', { name: recordName, exact: true, disabled: false });
  await button.waitFor({ timeout: 300000 });
  return { at: new Date().toISOString(), frames: await frames(page) };
}

async function recordFromPanel(page: Page, scratch: string, name: string) {
  const before = await page.getByText('This package is already recorded.', { exact: true }).count();
  const pressedAt = new Date().toISOString();
  await page.getByRole('button', { name: recordName, exact: true }).click();
  await page.waitForFunction(count => (document.body.innerText.match(/This package is already recorded\./g) ?? [])
    .length > count, before, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${scratch}/${name}.png`, fullPage: true });
  const panel = await page.locator('main').innerText();
  return { pressedAt, confirmedLine: /Confirmed [^\n]*/.exec(panel)?.[0] ?? null,
    countsLine: /\d+ recorded · \d+ carded · \d+ stopped/.exec(panel)?.[0] ?? null,
    screenshot: `${scratch}/${name}.png` };
}

async function frames(page: Page) {
  const text: string = await page.evaluate(() => (window as any).__eventFrames
    .map((frame: any) => frame.text).join(''));
  return text.split('\n\n').filter(frame => frame.includes('event: ingestion.change'))
    .map(frame => JSON.parse(/data: (.*)/.exec(frame)![1]))
    .map(event => ({ sequence: event.sequence, kind: event.change.kind, at: event.createdAt })).slice(-6);
}

async function newBatch(page: Page, url: string, path: string, name: string, result: Result) {
  const bytes = readFileSync(path);
  result.inputs.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await page.goto(`${url}studio/add-files`);
  await page.locator('input[type=file]').setInputFiles(path);
  await page.getByRole('dialog', { name: 'Retain map files' }).waitFor();
  await page.getByLabel('New case name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.waitForURL(/\/studio\/work\/cases\/[^/]+\/intake$/);
}

async function addToBatch(page: Page, path: string, result: Result) {
  const bytes = readFileSync(path);
  result.inputs.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await page.getByRole('button', { name: 'Add files to batch', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path);
  await page.getByRole('dialog', { name: 'Retain map files' }).waitFor();
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.getByRole('dialog', { name: 'Retain map files' }).waitFor({ state: 'detached' });
}

async function answer(page: Page, kindValue: string, identifier: string) {
  const what = page.getByLabel('What is each feature in this file?', { exact: true });
  await what.waitFor();
  await what.selectOption(kindValue);
  await page.getByLabel('Which field identifies each one?', { exact: true }).selectOption(identifier);
  assert.equal(await page.getByLabel('Which field is its name?', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Does a field give its height?', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'Use this layout', exact: true }).click();
}

function observe(page: Page, result: Result) {
  result.calls = [];
  result.console = [];
  result.packages = {};
  result.loads = 0;
  page.on('load', () => { result.loads += 1; });
  page.on('console', message => result.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => result.console.push({ type: 'pageerror', text: error.message }));
  page.on('response', async response => {
    if (!response.url().includes('/api/v1/')) return;
    const path = new URL(response.url()).pathname;
    result.calls.push({ path, status: response.status(), method: response.request().method() });
    if (path.endsWith('/targets') && response.ok()) await readPackages(response, result);
  });
}

async function readPackages(response: any, result: Result) {
  const body = await response.json().catch(() => null);
  for (const pkg of body?.packages ?? []) {
    result.packages[pkg.packageId] = { state: pkg.state, reviewed: Boolean(pkg.reviewFingerprint),
      refusal: pkg.reviewRefusal?.code ?? null, at: new Date().toISOString() };
  }
}
