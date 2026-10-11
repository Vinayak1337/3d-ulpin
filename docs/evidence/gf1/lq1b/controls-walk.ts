import assert from 'node:assert/strict';
import type { Page, Route } from '@playwright/test';

export async function controlsWalk(page: Page, url: string, captured: any, scratch: string) {
  const state = { manifest: structuredClone(captured.manifest), receipt: structuredClone(captured.authored),
    history: [] as any[], authorBodies: [] as any[], approvalBodies: [] as any[], streams: 0, approvalFail: true };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript('window.__name = value => value;');
  await page.route('**/api/v1/**', route => respond(route, state, captured));
  await page.goto(`${url}studio/work/cases/${captured.manifest.caseId}/intake`);
  await page.getByLabel('What is each feature in this file?', { exact: true }).waitFor().catch(async error => {
    await page.screenshot({ path: `${scratch}/failure.png`, fullPage: true });
    throw new Error(`${error.message}; errors=${JSON.stringify(errors)}; body=${await page.locator('body').innerText()}`);
  });
  assert.equal(await page.getByLabel('What is each feature in this file?').inputValue(), '');
  assert.equal(await page.getByLabel('Which field identifies each one?').inputValue(), '');
  assert.equal(await page.getByLabel('Does a field give its height?').inputValue(), '');
  const press = page.getByRole('button', { name: 'Use this layout', exact: true });
  assert(await press.isDisabled());
  await answer(page);
  const design = await designCheck(page, scratch);
  await press.click();
  await page.getByRole('button', { name: 'Approve layout', exact: true }).waitFor();
  assert.equal(state.authorBodies.length, 1);
  await page.getByText('Controlled approval refusal.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Approve layout', exact: true }).click();
  await page.getByText('Approved; the file is being read.', { exact: true }).waitFor();
  assert.equal(state.authorBodies.length, 1);
  const change = await changeControl(page, state, scratch);
  await page.waitForTimeout(5200);
  assert(state.streams >= 2, 'The terminated controlled stream should reconnect.');
  assert(state.streams <= 4, 'Tray and run must not each open their own stream.');
  const inspectionFailure = await failedInspection(page, url);
  assert.deepEqual(errors, []);
  return { inspectionFailure, mode: 'Controlled browser only; no live runtime writes', scratch, design, change,
    initialRequiredChoicesEmpty: true, approvalFailureKeptOneAuthor: true, authorBodies: state.authorBodies,
    approvalBodies: state.approvalBodies, eventRequests: state.streams, pageErrors: errors,
    screenshots: [`${scratch}/question.png`, `${scratch}/question-200.png`, `${scratch}/change.png`] };
}

type State = { manifest: any; receipt: any; history: any[]; authorBodies: any[]; approvalBodies: any[];
  streams: number; approvalFail: boolean };

async function respond(route: Route, state: State, captured: any) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
  if (request.method() === 'POST' && path.endsWith('/recipes')) {
    const body = request.postDataJSON();
    state.authorBodies.push(body);
    state.receipt = { ...state.receipt, plan: body.plan, revision: body.expectedRecipeRevision + 1,
      state: 'proposed', approval: null, execution: null };
    state.history.push(structuredClone(state.receipt));
    state.manifest.items[0].plan = { recipeId: state.receipt.id, recipeRevision: state.receipt.revision,
      recipeState: 'proposed', origin: 'officer', packageId: null };
    return reply(state.receipt, 201);
  }
  if (request.method() === 'POST' && path.endsWith('/approve')) {
    state.approvalBodies.push(request.postDataJSON());
    if (state.approvalFail) {
      state.approvalFail = false;
      return reply({ error: { code: 'TEST_CONTROL', message: 'Controlled approval refusal.' } }, 422);
    }
    state.receipt = { ...state.receipt, revision: state.receipt.revision + 1, state: 'approved' };
    state.history.push(structuredClone(state.receipt));
    return reply(state.receipt);
  }
  if (request.method() === 'POST') throw new Error(`Unexpected controlled write: ${path}`);
  if (path.endsWith('/events')) {
    state.streams++;
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: 'event: ready\nid: 1\ndata: {"kind":"ready"}\n\n' });
  }
  if (path.endsWith('/intake')) return reply(state.manifest);
  if (path.endsWith('/profile')) return reply(captured.profile);
  if (path.includes('/recipes/')) return reply(state.history);
  if (path.endsWith('/targets')) return reply({ caseId: captured.manifest.caseId, items: [], nextCursor: null,
    counts: { preparing: 0, ready: 0, needs_answer: 0, held: 0, confirmed: 0, recorded: 0, carded: 0, stopped: 0 },
    packages: [], packagesTruncated: false });
  return reply({ error: { code: 'CONTROL_ONLY', message: 'No live runtime in this controlled check.' } }, 503);
}

async function answer(page: Page) {
  await page.getByLabel('What is each feature in this file?', { exact: true }).selectOption('building');
  await page.getByLabel('Which field identifies each one?', { exact: true })
    .selectOption('/features/*/properties/doitt_id');
  await page.getByRole('button', { name: 'Use this layout', exact: true }).focus();
  assert(await page.getByRole('button', { name: 'Use this layout', exact: true }).isEnabled());
}

async function changeControl(page: Page, state: State, scratch: string) {
  state.receipt = { ...state.receipt, state: 'proposed', revision: 5 };
  state.history.push(structuredClone(state.receipt));
  state.manifest.items[0].plan = { ...state.manifest.items[0].plan, origin: 'memory', recipeRevision: 5 };
  await page.getByRole('button', { name: 'Refresh batch', exact: true }).click();
  await page.waitForTimeout(5200);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  assert.equal(await page.getByLabel('What is each feature in this file?').inputValue(), 'building');
  assert.equal(await page.getByLabel('Which field identifies each one?').inputValue(), '/features/*/properties/doitt_id');
  await page.screenshot({ path: `${scratch}/change.png`, fullPage: true });
  await page.getByRole('button', { name: 'Use this layout', exact: true }).click();
  await page.getByText('Approved; the file is being read.', { exact: true }).waitFor();
  assert.equal(state.authorBodies[1].expectedRecipeRevision, 5);
  assert.equal(state.approvalBodies.at(-1).expectedRecipeRevision, 6);
  return { controlled: true, prefilled: true, authoredExpectedRevision: 5, approvedReturnedRevision: 6 };
}

async function failedInspection(page: Page, url: string) {
  await page.route('**/api/v1/import-packages/inspect', route => route.abort('failed'));
  await page.goto(`${url}studio/add-files`);
  // Labelled empty transport control, never retained or interpreted as a real map.
  await page.locator('input[type=file]').setInputFiles({ name: 'transport-control.gpkg',
    mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) });
  const words = 'This file could not be checked: the server did not answer. Try again.';
  await page.getByText(words, { exact: true }).waitFor();
  assert.equal(await page.getByText('Reading…', { exact: true }).count(), 0);
  return { controlled: true, words, readingCleared: true };
}

async function designCheck(page: Page, scratch: string) {
  await page.screenshot({ path: `${scratch}/question.png`, fullPage: true });
  const press = page.getByRole('button', { name: 'Use this layout', exact: true });
  const keyboard = await press.evaluate(element => ({ reachable: document.activeElement === element,
    outlineWidth: getComputedStyle(element).outlineWidth }));
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await press.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${scratch}/question-200.png`, fullPage: true });
  const zoom = await page.locator('section[aria-label^="Layout for"]').evaluate(element => ({
    clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
  }));
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  assert.equal(keyboard.outlineWidth, '2px');
  assert(zoom.scrollWidth <= zoom.clientWidth + 1);
  return { keyboard, zoom, method: 'Controlled Chromium UI; CSS zoom 2' };
}
