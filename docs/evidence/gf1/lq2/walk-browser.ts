import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { drawingProof, reconnectProof } from './walk-proofs';
import { observeEventReads } from './event-observation';

type Result = Record<string, any>;
const niagara = 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Condominiums_7254610803234545967.geojson';
const buildings = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';

export async function browserWalk(browser: Browser, url: string, scratch: string, result: Result,
  api: { start: () => Promise<void>; stop: () => Promise<void> }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  await page.addInitScript('window.__name = value => value;');
  await observeEventReads(page);
  observe(page, result);
  result.firstBatchUrl = await parcelWalk(page, url, scratch, result);
  const buildingUrl = await buildingWalk(page, url, scratch, result);
  await drawingProof(page, result.buildings.packageLink, scratch, result)
    .catch(error => { result.drawing = { failure: error.message }; });
  await page.goto(buildingUrl);
  // No-card confirmations have no chosen target ID for the discovery sweep after navigation.
  // Wait for the actual committed package read instead; do not invent a confirmation listing.
  await page.getByText('This package is already recorded.', { exact: true }).waitFor();
  await page.waitForFunction(() => (window as any).__eventReads.some((read: any) => read.bytes > 0));
  await page.waitForTimeout(1000);
  result.reconnect = await reconnectProof(page, api, scratch);
  result.gates = { pv1: receipt('pv1'), zb1: receipt('zb1'), lp3b: receipt('lp3b') };
  result.waitingSteps = [];
  if (!result.gates.pv1?.uploadWithoutCitation) result.waitingSteps.push('step 3 waits for PV1 on staging');
  if (!result.gates.zb1?.reviewOutcomePublished) result.waitingSteps.push('step 4 waits for ZB1 on staging');
  await page.close();
}

async function parcelWalk(page: Page, url: string, scratch: string, result: Result) {
  const first = await newBatch(page, url, niagara, 'Niagara test_only whole-number parcels', result);
  await page.getByRole('option', { name: 'OBJECTID (whole number)', exact: true }).waitFor({ state: 'attached' });
  await answer(page, 'parcel', '/features/*/properties/OBJECTID');
  result.niagara = await packageResult(page, scratch, 'niagara');
  await page.getByLabel('Your acknowledgement').fill('I reviewed this retained Niagara test_only parcel package.');
  const confirmation = page.getByRole('button', { name: 'Record packages and make chosen cards', exact: true });
  result.niagara.confirmationAvailable = await confirmation.isEnabled();
  if (result.niagara.confirmationAvailable) await confirmation.click();
  await newBatch(page, url, niagara, 'Niagara test_only repeated original', result);
  await page.waitForTimeout(6500);
  result.duplicate = { body: await page.locator('main').innerText(),
    prepareButtons: await page.getByRole('button', { name: 'Use this layout', exact: true }).count() };
  await page.screenshot({ path: `${scratch}/duplicate.png`, fullPage: true });
  return first;
}

async function buildingWalk(page: Page, url: string, scratch: string, result: Result) {
  const path = await newBatch(page, url, buildings, 'NYC test_only reconnect and drawing', result);
  await answer(page, 'building', '/features/*/properties/doitt_id');
  result.buildings = await packageResult(page, scratch, 'buildings');
  await page.getByLabel('Your acknowledgement').fill('I reviewed the NYC test_only buildings for recording.');
  await page.getByRole('button', { name: 'Record packages and make chosen cards', exact: true }).click();
  await page.getByText('1661 recorded · 0 carded · 0 stopped', { exact: false }).waitFor({ timeout: 120000 });
  return path;
}

async function newBatch(page: Page, url: string, path: string, name: string, result: Result) {
  if (!result.inputs.some((input: any) => input.path === path)) result.inputs.push({ path,
    bytes: readFileSync(path).length, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
  await page.goto(`${url}studio/add-files`);
  await page.locator('input[type=file]').setInputFiles(path);
  await page.getByRole('dialog', { name: 'Retain map files' }).waitFor();
  await page.getByLabel('New case name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.waitForURL(/\/studio\/work\/cases\/[^/]+\/intake$/);
  return page.url();
}

async function answer(page: Page, kind: string, identifier: string) {
  await page.getByLabel('What is each feature in this file?', { exact: true }).waitFor();
  await page.getByLabel('What is each feature in this file?', { exact: true }).selectOption(kind);
  await page.getByLabel('Which field identifies each one?', { exact: true }).selectOption(identifier);
  assert.equal(await page.getByLabel('Which field is its name?', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Does a field give its height?', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'Use this layout', exact: true }).click();
}

async function packageResult(page: Page, scratch: string, name: string) {
  const link = page.getByRole('link', { name: 'Open package', exact: true });
  await link.waitFor({ timeout: 120000 });
  await page.waitForTimeout(5500);
  await page.screenshot({ path: `${scratch}/${name}.png`, fullPage: true });
  return { packageLink: await link.getAttribute('href'), body: await page.locator('main').innerText() };
}

function observe(page: Page, result: Result) {
  result.calls = [];
  result.console = [];
  page.on('console', message => result.console.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', error => result.console.push({ type: 'pageerror', text: error.message }));
  page.on('response', async response => {
    if (!response.url().includes('/api/v1/')) return;
    const path = new URL(response.url()).pathname;
    const body = !response.ok() ? await response.json().catch(() => null) : null;
    result.calls.push({ path, status: response.status(), method: response.request().method(),
      ...(body ? { refusal: body } : {}) });
    if (path.endsWith('/recipes') && response.request().method() === 'POST')
      result.authorBodies = [...(result.authorBodies ?? []), response.request().postDataJSON()];
  });
}

function receipt(task: string) {
  try { return JSON.parse(execFileSync('git', ['show', `staging:docs/evidence/gf1/${task}/result.json`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { return null; }
}
