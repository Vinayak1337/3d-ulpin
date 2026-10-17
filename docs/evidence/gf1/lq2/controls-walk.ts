import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';

export async function controlsWalk(page: Page, url: string, capture: any, scratch: string) {
  const asset = JSON.parse(readFileSync('docs/evidence/gf1/da6/result.json', 'utf8')).assets[0];
  const state = { capture, failures: 0, resumed: false, requests: [] as any[],
    receipt: { id: capture.authored.id, revision: 1, currentCaseRevision: 0, state: 'receiving',
      receivedBytes: 0, partBytes: 8388608, partCount: 6, parts: [] as any[], source: null as any } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript('window.__name = value => value;');
  await page.route('**/api/v1/**', route => reply(route, state));
  await page.goto(`${url}studio/add-files`);
  await page.locator('input[type=file]').setInputFiles(asset.retainedPath);
  await page.getByLabel('New case name', { exact: true }).fill('Controlled upload transport, no runtime writes');
  const outline = await retryWalk(page, state, scratch);
  validateRequests(state, asset);
  await review(page, scratch);
  const cancellation = await cancelProof(page, url, asset.retainedPath, state);
  assert.deepEqual(errors, []);
  return { cancellation, mode: 'Fully intercepted transport controls, no runtime upload or record',
    input: asset.retainedPath, requests: state.requests, hashMatchesDA6: true, threeFailuresStopped: true,
    resumedAtPart: 2, wholeFileHashBeforeCreate: true, noPublisherInvented: true,
    focusOutline: outline, errors, scratch };
}

async function retryWalk(page: Page, state: State, scratch: string) {
  await page.getByText('Keep this page open until the upload finishes.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.getByText(/^Checking the file:/).waitFor();
  await page.screenshot({ path: `${scratch}/checking.png`, fullPage: true });
  await page.getByText(/^Uploading:/).waitFor();
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  assert.equal(state.failures, 3);
  await page.getByRole('button', { name: 'Try again', exact: true }).focus();
  const outline = await page.getByRole('button', { name: 'Try again', exact: true })
    .evaluate(element => getComputedStyle(element).outlineWidth);
  await page.screenshot({ path: `${scratch}/stopped.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await page.screenshot({ path: `${scratch}/stopped-200.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  state.resumed = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('Verifying the upload', { exact: true }).waitFor();
  await page.screenshot({ path: `${scratch}/verifying.png`, fullPage: true });
  await page.waitForURL(/\/intake$/);
  return outline;
}

function validateRequests(state: State, asset: any) {
  const sent = state.requests.find(request => request.kind === 'create').body;
  assert.deepEqual(sent.provenance, { origin: 'not_stated', acquiredAt: sent.provenance.acquiredAt });
  assert.equal(sent.sha256, asset.sha256);
  const retry = state.requests.filter(request => request.kind === 'part' && request.number === 2);
  assert.equal(retry.length, 4);
  assert(retry.every(request => request.key === retry[0].key));
}

type State = { capture: any; failures: number; resumed: boolean; requests: any[]; receipt: any };
async function reply(route: Route, state: State) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const json = (body: any, status = 200) => route.fulfill({ status, json: body });
  if (path.endsWith('/upload-limits')) return json(uploadLimits());
  if (path.endsWith('/cases') && request.method() === 'POST') return json({ case: {
    id: state.capture.manifest.caseId, revision: 0, name: 'Transport control only', archived: false } }, 201);
  if (request.method() === 'POST' && path.endsWith('/uploads')) {
    state.requests.push({ kind: 'create', body: request.postDataJSON() });
    return json(state.receipt, 201);
  }
  if (request.method() === 'PUT') return receivePart(route, state);
  if (path.endsWith('/finalize')) {
    state.requests.push({ kind: 'finalize', body: request.postDataJSON() });
    await new Promise(resolve => setTimeout(resolve, 1000));
    return json({ ...state.receipt, state: 'retained', source: { sourceId: state.capture.profile.source.sourceId } });
  }
  if (path.endsWith('/abort')) {
    state.requests.push({ kind: 'abort', body: request.postDataJSON() });
    state.receipt = { ...state.receipt, state: 'aborted' };
    return json(state.receipt);
  }
  if (path.includes('/uploads/')) return json(state.receipt);
  if (request.method() === 'POST' && path.endsWith('/items')) {
    state.requests.push({ kind: 'enroll', body: request.postDataJSON() });
    return json(state.capture.manifest.items[0], 201);
  }
  return reads(route, state);
}

async function receivePart(route: Route, state: State) {
  const request = route.request();
  const number = Number(new URL(request.url()).pathname.split('/').at(-1));
  state.requests.push({ kind: 'part', number, key: request.headers()['x-request-key'],
    revision: request.headers()['x-upload-revision'], bytes: request.postDataBuffer()!.length });
  if (number === 2 && !state.resumed) {
    state.failures++;
    return route.abort('failed');
  }
  await new Promise(resolve => setTimeout(resolve, 400));
  state.receipt = { ...state.receipt, revision: state.receipt.revision + 2,
    receivedBytes: state.receipt.receivedBytes + request.postDataBuffer()!.length };
  return route.fulfill({ json: state.receipt });
}

function reads(route: Route, state: State) {
  const path = new URL(route.request().url()).pathname;
  const json = (body: any) => route.fulfill({ json: body });
  if (path.endsWith('/intake')) return json(state.capture.manifest);
  if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream',
    body: 'event: ready\nid: 1\ndata: {"kind":"ready"}\n\n' });
  if (path.endsWith('/targets')) return json({ caseId: state.capture.manifest.caseId, items: [], nextCursor: null,
    counts: { preparing: 0, ready: 0, needs_answer: 0, held: 0, confirmed: 0, recorded: 0, carded: 0, stopped: 0 },
    packages: [{ packageId: state.capture.authored.id, areaId: state.capture.manifest.caseId,
      anchorItemId: state.capture.manifest.items[0].itemId, revision: 1, state: 'READY_FOR_REVIEW',
      reviewFingerprint: null, findingCounts: null, counts: {},
      reviewRefusal: { code: 'CONTROL_ONLY', message: 'Controlled review refusal: exact words stay here.' } }],
    packagesTruncated: false });
  if (path.endsWith('/profile')) return json(state.capture.profile);
  if (path.includes('/recipes/')) return json([]);
  if (/\/cases\/[^/]+$/.test(path)) return json({
    case: { id: state.capture.manifest.caseId, revision: 0, archived: false },
  });
  return route.fulfill({ status: 503, json: { error: { message: 'Controlled check; no runtime read.' } } });
}

async function review(page: Page, scratch: string) {
  await page.getByText('Controlled review refusal: exact words stay here.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Its review has not run yet.', { exact: true }).count(), 0);
  assert(await page.getByRole('button', { name: 'Record packages and make chosen cards', exact: true }).isDisabled());
  await page.screenshot({ path: `${scratch}/refused-review.png`, fullPage: true });
}

async function cancelProof(page: Page, url: string, input: string, state: State) {
  state.resumed = false;
  state.failures = 0;
  state.receipt = { ...state.receipt, revision: 1, receivedBytes: 0, parts: [], state: 'receiving' };
  await page.goto(`${url}studio/add-files`);
  await page.locator('input[type=file]').setInputFiles(input);
  await page.getByLabel('New case name', { exact: true }).fill('Controlled cancellation, no runtime writes');
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).waitFor();
  let nativeLeave = '';
  page.once('dialog', async dialog => {
    nativeLeave = dialog.type();
    await dialog.dismiss();
  });
  await page.evaluate(() => { window.location.assign('/studio/work'); });
  await page.waitForTimeout(200);
  assert.equal(nativeLeave, 'beforeunload');
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await page.waitForURL(/\/intake$/);
  assert.equal(state.requests.filter(request => request.kind === 'abort').length, 1);
  return { nativeLeaveQuestion: nativeLeave, cancelledAbortRequests: 1 };
}

function uploadLimits() {
  const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const properties = published.components.schemas.GET_ingestion_upload_limits_Response_200_application_json.properties;
  const literals = (schema: any) => Object.fromEntries(Object.entries(schema.properties)
    .map(([name, value]: any) => [name, value.enum[0]]));
  return { limits: literals(properties.limits), largeProfile: {
    limits: literals(properties.largeProfile.properties.limits), capacity: {} }, profile: 'opaque_original_only',
    conversion: 'unsupported' };
}
