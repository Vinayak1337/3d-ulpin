// Browser checks behind the intercepted F3b screenshots. Reads are intercepted as marked; every write is blocked.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { recipeBody } from '../../../../../apps/studio/src/features/intake/table/recipe.ts';
import { createContractValidator } from '../../../../../apps/studio/src/local/contract.ts';
import { checkViewer } from './viewer-checks.mjs';

const out = import.meta.dirname;
const studio = process.env.STUDIO ?? 'http://127.0.0.1:5188';
const INTERCEPTED = 'Intercepted responses · no live writes';
const STALE = 'These results are from an earlier state of the case';
const TABLE_ROUTE = 'ingestion_cases_caseId_sources_sourceId';
const MAPPING_JOB = `POST_${TABLE_ROUTE}_chunk_mapping_Response_202_application_json`;
const RECIPE = `POST_${TABLE_ROUTE}_recipes_Response_201_application_json`;
const RECIPE_HISTORY = 'GET_ingestion_cases_caseId_recipes_recipeId_Response_200_application_json';
const CHUNK = `GET_${TABLE_ROUTE}_chunk_mapping_jobs_jobId_chunks_chunkIndex_Response_200_application_json`;
const tables = JSON.parse(readFileSync(resolve(out, '../f3a/table-responses.json'), 'utf8'));
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const recorded = JSON.parse(readFileSync(resolve(out, '../f3a/responses.json'), 'utf8'));
const TOWER = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const CANONICAL = 'GET_buildings_buildingId_canonical_Response_200_application_json';
const PAGES = 'GET_sources_sourceId_pages_Response_200_application_json';
const screenshots = [];
const blockedWrites = [];
const errors = [];
const pageRequests = [];
let table = null;
let canonicalBody = null;
let pageReads = null;

function checked(schema, value) {
  assert.deepEqual(validate(schema, value), [], schema);
  return value;
}

/** A proposed, unapproved recipe for a file: the Studio's own recipe body in the published receipt shape. */
function proposedRecipe(file) {
  const mapping = file.chunk.payload.mapping;
  const answers = {};
  for (const column of file.profile.profile.columns) {
    answers[column.name] = { target: 'unknown', reason: 'Intercepted protocol control only.' };
  }
  const { plan } = recipeBody(file.profile, mapping, answers, randomUUID(), 0);
  return checked(RECIPE, { id: randomUUID(), revision: 1, state: 'proposed', plan, destination: null,
    planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    authoredBy: 'intercepted-local-operator', authoredAt: new Date().toISOString(),
    approval: null, execution: null });
}

function fulfilTable(route, path) {
  const { file, chunk, mapping, revisions } = table;
  if (path.endsWith('/events')) return route.abort('failed');
  if (path === `/api/v1/cases/${tables.caseId}`) return route.fulfill({ json: tables.detail });
  if (path.endsWith('/profile')) return route.fulfill({ json: file.profile });
  if (path.includes('/recipes/')) return route.fulfill({ json: revisions });
  if (path.includes('/chunks/')) return route.fulfill({ json: chunk });
  if (path.includes('/streaming-vector/jobs/')) return route.fulfill({ json: file.raw });
  if (path.includes('/chunk-mapping/jobs/')) return route.fulfill({ json: mapping });
  return route.continue();
}

async function intercept(route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (request.method() !== 'GET') {
    blockedWrites.push({ method: request.method(), path });
    return route.abort('blockedbyclient');
  }
  if (table && (path.includes('/ingestion/cases/') || path.startsWith('/api/v1/cases/'))) {
    return fulfilTable(route, path);
  }
  if (canonicalBody && path === `/api/v1/buildings/${TOWER}/canonical`) return route.fulfill({ json: canonicalBody });
  if (pageReads && /^\/api\/v1\/sources\/[^/]+\/pages/.test(path)) return pageReads(route, request.url(), path);
  return route.continue();
}

async function capture(page, name, mode, notes) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((text) => {
    const tag = document.createElement('div');
    tag.id = 'intercepted-label';
    tag.textContent = text;
    Object.assign(tag.style, { position: 'fixed', bottom: '8px', right: '16px', zIndex: '9999',
      padding: '8px 12px', background: 'var(--ui-surface)', color: 'var(--ui-ink)',
      border: '1px solid var(--ui-border-strong)', font: '500 13px var(--ui-font-sans)' });
    document.body.append(tag);
  }, mode);
  await page.screenshot({ path: resolve(out, name), animations: 'disabled' });
  await page.locator('#intercepted-label').evaluateAll((tags) => tags.forEach((tag) => tag.remove()));
  screenshots.push({ file: name, mode, notes });
}

function tableUrl(file, recipeId) {
  const params = new URLSearchParams({ rawJobId: file.raw.jobId, mappingJobId: file.mapping.jobId, recipeId });
  return `${studio}/studio/work/cases/${tables.caseId}/tables/${file.profile.source.sourceId}?${params}`;
}

/** The same file with its mapping job and chunk turned stale, as a later read of the server would return them. */
function staled(file) {
  const mapping = { ...file.mapping, current: false, reasons: ['case_advanced'] };
  const chunk = checked(CHUNK, { ...file.chunk, current: false, reasons: ['case_advanced'] });
  return { mapping: checked(MAPPING_JOB, mapping), chunk };
}

async function openProposed(page, file, recipe) {
  table = { file, chunk: checked(CHUNK, file.chunk), mapping: checked(MAPPING_JOB, file.mapping),
    revisions: checked(RECIPE_HISTORY, [recipe]) };
  await page.goto(tableUrl(file, recipe.id));
  await expect(page.getByText('Mapping proposed · revision 1', { exact: true })).toBeVisible();
}

const notice = (page) => page.locator('#table-stale-notice');

async function turnStale(page, file) {
  Object.assign(table, staled(file));
  await expect(notice(page)).toContainText(STALE, { timeout: 15000 });
}

async function noWritesLeft(page) {
  for (const name of ['Record the mapping', 'Approve mapping', 'Mark every unanswered column as Unknown field']) {
    const control = page.getByRole('button', { name, exact: true });
    const hidden = (await control.count()) === 0;
    assert.ok(hidden || await control.isDisabled(), `${name} is still usable on a stale result`);
  }
}

async function staleUnderApproval(page, file, recipe) {
  await openProposed(page, file, recipe);
  await page.getByRole('button', { name: 'Approve mapping', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve this mapping?' });
  await expect(dialog).toBeVisible();
  await capture(page, '08-approval-dialog-open.png', INTERCEPTED,
    'A current result: the approval dialog is open before the next read turns the result stale.');
  await turnStale(page, file);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve mapping', exact: true })).toHaveCount(0);
  await expect(notice(page)).toBeFocused();
  const icons = await notice(page).locator('svg').count();
  assert.equal(icons, 1);
  await capture(page, '09-dialog-closed-on-stale.png', INTERCEPTED,
    'The same dialog after the next read returned current: false. It closed, focus is on the notice.');
  return { dialogClosed: true, noticeFocused: true, noticeIcons: icons };
}

async function staleUnderProposal(page, file, recipe) {
  await openProposed(page, file, recipe);
  await page.getByRole('button', { name: 'Answer mapping questions', exact: true }).click();
  const columns = file.profile.headers.length;
  const reasons = page.getByRole('textbox', { name: /^Reason for column/ });
  for (let index = 1; index <= columns; index += 1) {
    await page.getByRole('combobox', { name: `Target for column ${index}`, exact: true }).selectOption('unknown');
    await reasons.nth(index - 1).fill('Intercepted protocol control only.');
  }
  await page.getByRole('button', { name: 'Record the mapping', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose this mapping?' });
  await expect(dialog).toBeVisible();
  await turnStale(page, file);
  await expect(dialog).toHaveCount(0);
  await expect(notice(page)).toBeFocused();
  await noWritesLeft(page);
  return { dialogClosed: true, noticeFocused: true, formStillShowsAnswers: await reasons.first().inputValue() !== '' };
}

async function staleOpenForm(page, file, recipe) {
  await openProposed(page, file, recipe);
  await page.getByRole('button', { name: 'Answer mapping questions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark every unanswered column as Unknown field', exact: true }))
    .toBeVisible();
  await turnStale(page, file);
  await noWritesLeft(page);
  await expect(page.getByRole('button', { name: 'Record the mapping', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Record the mapping', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, '10-stale-open-form.png', INTERCEPTED,
    'An open answer form when the result turns stale: no shared-reason control, Record disabled, no Approve.');
  return { recordDisabled: true, sharedReasonHidden: true, approveHidden: true };
}

const viewerEnv = {
  studio,
  building: TOWER,
  cited: recorded.withCode.levels[0].spaces[0].label.citations[0],
  schema: PAGES,
  pageRequests,
  checked,
  capture,
  setCanonical: () => { canonicalBody = checked(CANONICAL, recorded.withCode); },
  setPageReads: (reads) => { pageReads = reads; },
};

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', intercept);
  const file = tables.files[1];
  const recipe = proposedRecipe(file);
  const approval = await staleUnderApproval(page, file, recipe);
  const proposal = await staleUnderProposal(page, file, recipe);
  const form = await staleOpenForm(page, file, recipe);
  table = null;
  const viewer = await checkViewer(viewerEnv, page);
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'browser-result.json'), JSON.stringify({ exit: 0, liveWrites: 0, blockedWrites,
    pageErrors: errors, approval, proposal, form, viewer, screenshots }));
} finally {
  await browser.close();
}
