// Browser checks behind the F3a screenshots. Reads are live or intercepted as marked; every write is blocked.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { initialAnswers, recipeBody } from '../../../../../apps/studio/src/features/intake/table/recipe.ts';
import { createContractValidator } from '../../../../../apps/studio/src/local/contract.ts';

const out = import.meta.dirname;
const studio = 'http://127.0.0.1:5188';
const demoApi = 'http://127.0.0.1:3194';
const TOWER = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
const EMPTY = 'No floor or unit has been recorded from a source label for this building.';
const STALE = 'These results are from an earlier state of the case';
const INTERCEPTED = 'Intercepted responses · no live writes';
const CANONICAL = 'GET_buildings_buildingId_canonical_Response_200_application_json';
const TABLE_ROUTE = 'ingestion_cases_caseId_sources_sourceId';
const CHUNK = `GET_${TABLE_ROUTE}_chunk_mapping_jobs_jobId_chunks_chunkIndex_Response_200_application_json`;
const MAPPING_JOB = `POST_${TABLE_ROUTE}_chunk_mapping_Response_202_application_json`;
const RECIPE = `POST_${TABLE_ROUTE}_recipes_Response_201_application_json`;
const RECIPE_HISTORY = 'GET_ingestion_cases_caseId_recipes_recipeId_Response_200_application_json';
const sharedReason = 'Intercepted protocol control only; retain unknown, not property facts or learning truth.';
const recorded = JSON.parse(readFileSync(resolve(out, 'responses.json'), 'utf8'));
const tables = JSON.parse(readFileSync(resolve(out, 'table-responses.json'), 'utf8'));
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const screenshots = [];
const liveReads = [];
const errors = [];
const blockedWrites = [];
let canonicalBody = null;
let table = null;

function checked(schema, value) {
  assert.deepEqual(validate(schema, value), [], schema);
  return value;
}

/** A three-chunk job from the real F2b offline mapping, where only the first chunk carries the questions. */
function threeChunkTable() {
  const file = tables.files[0];
  const chunks = [0, 1, 2].map((chunkIndex) => {
    const chunk = structuredClone(file.chunk);
    chunk.slot = { ...chunk.slot, chunkIndex };
    chunk.payload.chunkIndex = chunkIndex;
    chunk.payload.mapping.metrics.chunkIndex = chunkIndex;
    if (chunkIndex > 0) chunk.payload.mapping.questions = [];
    return checked(CHUNK, chunk);
  });
  const mapping = checked(MAPPING_JOB, { ...file.mapping, slots: chunks.map((chunk) => chunk.slot) });
  return { file, chunks, mapping, revisions: [] };
}

/** A proposed, unapproved recipe for a file: the Studio's own recipe body in the published receipt shape. */
function proposedRecipe(file) {
  const mapping = file.chunk.payload.mapping;
  const answers = initialAnswers(file.profile, mapping);
  for (const column of file.profile.profile.columns) {
    answers[column.name] = { target: 'unknown', reason: sharedReason };
  }
  const { plan } = recipeBody(file.profile, mapping, answers, randomUUID(), 0);
  return checked(RECIPE, { id: randomUUID(), revision: 1, state: 'proposed', plan, destination: null,
    planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    authoredBy: 'intercepted-local-operator', authoredAt: new Date().toISOString(),
    approval: null, execution: null });
}

function fulfilTable(route, path) {
  const { file, chunks, mapping, revisions } = table;
  if (path.endsWith('/events')) return route.abort('failed');
  if (path === `/api/v1/cases/${tables.caseId}`) return route.fulfill({ json: tables.detail });
  if (path.endsWith('/profile')) return route.fulfill({ json: file.profile });
  if (path.includes('/recipes/')) return route.fulfill({ json: revisions });
  if (path.includes('/chunks/')) return route.fulfill({ json: chunks[Number(path.split('/').at(-1))] });
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
  if (canonicalBody && path === `/api/v1/buildings/${TOWER}/canonical`) {
    return route.fulfill({ json: canonicalBody });
  }
  if (table && (path.includes('/ingestion/cases/') || path.startsWith('/api/v1/cases/'))) {
    return fulfilTable(route, path);
  }
  return route.continue();
}

async function capture(page, name, mode, notes) {
  await page.evaluate(() => document.fonts.ready);
  if (mode !== 'live') {
    await page.evaluate((text) => {
      const tag = document.createElement('div');
      tag.id = 'intercepted-label';
      tag.textContent = text;
      Object.assign(tag.style, { position: 'fixed', bottom: '8px', right: '16px', zIndex: '9999',
        padding: '8px 12px', background: 'var(--ui-surface)', color: 'var(--ui-ink)',
        border: '1px solid var(--ui-border-strong)', font: '500 13px var(--ui-font-sans)' });
      document.body.append(tag);
    }, mode);
  }
  await page.screenshot({ path: resolve(out, name), animations: 'disabled' });
  await page.locator('#intercepted-label').evaluateAll((tags) => tags.forEach((tag) => tag.remove()));
  screenshots.push({ file: name, mode, notes });
}

const panelOf = (page) => page.locator('section', {
  has: page.getByRole('heading', { name: 'Recorded floors and units', exact: true }) });

async function liveEmpty(page, buildingId, name, file) {
  const response = await fetch(`${demoApi}/api/v1/buildings/${buildingId}/canonical`);
  const body = checked(CANONICAL, await response.json());
  liveReads.push({ buildingId, status: response.status, name: body.name.value, levels: body.levels.length,
    recordedFloors: body.levels.filter((level) => level.registryFloorId).length });
  await page.goto(`${studio}/studio/properties/${buildingId}/candidates`);
  await expect(panelOf(page)).toContainText(EMPTY);
  await expect(panelOf(page).getByRole('listitem')).toHaveCount(0);
  await panelOf(page).scrollIntoViewIfNeeded();
  await capture(page, file, 'live', `${name}: live canonical read, nothing recorded, empty state.`);
}

async function openRecorded(page, body) {
  canonicalBody = checked(CANONICAL, body);
  await page.goto(`${studio}/studio/properties/${TOWER}/candidates`);
  const panel = panelOf(page);
  await expect(panel.getByRole('heading', { name: '2ND FLOOR PLAN', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'UNIT-3B', exact: true })).toBeVisible();
  await expect(panel.getByText('Reviewed', { exact: true })).toHaveCount(1);
  await expect(panel).toContainText('Recorded from a source label · geometry not recorded');
  await expect(panel.getByText('Unknown', { exact: true })).toHaveCount(4);
  await expect(panel.getByRole('status')).toHaveText(body.gaps.at(-1));
  await expect(panel).not.toContainText(/verified|official|ULPIN|parcel|floor 2|level 2/i);
  await expect(panel).not.toContainText(EMPTY);
  await panel.scrollIntoViewIfNeeded();
  return panel;
}

async function populated(page) {
  const panel = await openRecorded(page, recorded.withoutCode);
  await expect(panel).toContainText('No code assigned');
  await expect(panel.getByRole('button', { name: /Copy code/ })).toHaveCount(0);
  await capture(page, '03-recorded-without-code.png', INTERCEPTED,
    'K4c source labels through the K4b offline protocol double; no code on the unit.');
  const code = recorded.withCode.levels[0].spaces[0].proposedCode.value;
  const coded = await openRecorded(page, recorded.withCode);
  await expect(coded.locator('.ul-code')).toHaveText(code);
  await coded.getByRole('button', { name: `Copy code ${code}`, exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
  await capture(page, '04-recorded-with-code.png', `${INTERCEPTED} · the code is a test value`,
    'Same record with a code allocated in memory by the existing generator: a test value, not an issued identity.');
  return coded;
}

async function citation(page, panel) {
  const chips = panel.getByTitle(/^Open evidence/);
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toContainText('p.1 · x 206.9, y 254.3 · 1034.4 × 305.1 pt');
  await chips.nth(1).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open original' })).toBeVisible();
  const text = await dialog.innerText();
  await capture(page, '05-citation-evidence-viewer.png', 'Intercepted canonical response · source reads live',
    'The unit citation opens the existing evidence viewer on the cited source; what it shows is in result.json.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  return { title: text.split('\n')[0], showsLocator: text.includes('p.1 · x 206.9, y 254.3'),
    showsPage: /Whole page|Zoom to the cited part/.test(text),
    fileFallback: text.includes('The record does not name a position in this file.') };
}

async function zoomed(page, panel) {
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const chip = panel.getByTitle(/^Open evidence/).first();
  await chip.focus();
  // Leave and re-enter with the keyboard, so the outline measured is the keyboard focus ring.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(chip).toBeFocused();
  assert.equal(await chip.evaluate((button) => getComputedStyle(button).outlineWidth), '2px');
  const clipped = await panel.evaluate((root) => {
    const box = root.getBoundingClientRect();
    const page = document.documentElement.getBoundingClientRect();
    const outside = (rect) => rect.width < 1 || rect.left < box.left - 1 || rect.right > box.right + 1;
    const cut = [...root.querySelectorAll('h2, h3, h4, dt, dd, p, button, .ul-code__seg')]
      .filter((node) => outside(node.getBoundingClientRect())).map((node) => node.textContent);
    return box.right > page.right + 1 ? ['panel wider than the page', ...cut] : cut;
  });
  assert.deepEqual(clipped, []);
  await panel.getByRole('heading', { name: 'UNIT-3B', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, '06-zoom-200-percent.png', INTERCEPTED,
    'CSS 200% zoom: the full-width panel keeps every label inside it; the chip has a 2 px keyboard focus ring.');
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  return { focusOutline: '2px', clippedLabels: clipped.length };
}

function tableUrl(control, recipeId) {
  const params = new URLSearchParams({ rawJobId: control.raw.jobId, mappingJobId: control.mapping.jobId });
  if (recipeId) params.set('recipeId', recipeId);
  return `${studio}/studio/work/cases/${tables.caseId}/tables/${control.profile.source.sourceId}?${params}`;
}

async function sharedUnknown(page) {
  canonicalBody = null;
  table = threeChunkTable();
  const { file } = table;
  const columns = file.profile.headers.length;
  await page.goto(tableUrl({ ...file, mapping: table.mapping }));
  const questions = file.chunk.payload.mapping.questions.length;
  await expect(page.getByRole('table', { name: 'Column mapping candidates' }).getByText('Needs review'))
    .toHaveCount(questions);
  await page.getByRole('button', { name: 'Answer mapping questions', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Columns this will change' }))
    .toContainText(`Columns this will change: ${columns}.`);
  const mark = page.getByRole('button', { name: 'Mark every unanswered column as Unknown field', exact: true });
  await expect(mark).toBeDisabled();
  await page.getByRole('combobox', { name: 'Target for column 1', exact: true }).selectOption('building.name');
  await page.getByRole('textbox', { name: 'Reason for column 1', exact: true }).fill('Answered by the officer first.');
  await page.getByRole('textbox', { name: 'Shared reason for unknown fields', exact: true }).fill(sharedReason);
  await mark.scrollIntoViewIfNeeded();
  await capture(page, '07-table-shared-reason.png', INTERCEPTED,
    'Three-chunk job with questions only in chunk 0: badges and the answer control stay; shared reason ready.');
  await mark.click();
  await expect(page.getByRole('textbox', { name: 'Reason for column 1', exact: true }))
    .toHaveValue('Answered by the officer first.');
  await expect(page.getByRole('combobox', { name: 'Target for column 2', exact: true })).toHaveValue('unknown');
  await expect(page.getByRole('textbox', { name: `Reason for column ${columns}`, exact: true }))
    .toHaveValue(sharedReason);
  await page.getByRole('button', { name: 'Record the mapping', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose this mapping?' });
  await expect(dialog).toContainText(`Columns carrying the shared reason: ${columns - 1}.`);
  await capture(page, '08-table-shared-reason-confirmation.png', INTERCEPTED,
    'The confirmation counts the columns that carry the shared reason; the proposal is not sent.');
  return { chunks: 3, chunksWithQuestions: 1, questionBadges: questions, columns, sharedReasonColumns: columns - 1 };
}

async function openProposed(page, control, recipe) {
  table = { file: control, chunks: [checked(CHUNK, control.chunk)], mapping: checked(MAPPING_JOB, control.mapping),
    revisions: checked(RECIPE_HISTORY, [recipe]) };
  await page.goto(tableUrl(control, recipe.id));
  await expect(page.getByText('Mapping proposed · revision 1', { exact: true })).toBeVisible();
}

async function freshness(page) {
  const recipe = proposedRecipe(tables.files[1]);
  const notice = page.getByRole('status').filter({ hasText: STALE });
  const approve = page.getByRole('button', { name: 'Approve mapping', exact: true });
  await openProposed(page, tables.files[1], recipe);
  await expect(approve).toHaveCount(1);
  await expect(notice).toHaveCount(0);
  await openProposed(page, tables.stale, recipe);
  await expect(notice).toHaveText(new RegExp(`^Needs review\\s*${STALE}: case advanced\\.$`));
  await expect(approve).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Column mapping candidates' }).locator('tbody tr'))
    .toHaveCount(tables.stale.profile.headers.length);
  await page.getByRole('button', { name: 'Answer mapping questions', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Reason for column 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mark every unanswered column/ })).toHaveCount(0);
  await notice.scrollIntoViewIfNeeded();
  await capture(page, '09-table-stale-notice.png', INTERCEPTED,
    'Second F2b file marked current: false, case_advanced: one notice, results readable, no approve control.');
  table = null;
  return { currentShowsApprove: true, staleHidesApprove: true, staleHidesSharedReason: true,
    reasons: tables.stale.mapping.reasons };
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', intercept);
  await liveEmpty(page, TOWER, 'Tower 3', '01-live-tower-empty.png');
  await liveEmpty(page, MAGNOLIA, 'Magnolia Residency', '02-live-magnolia-empty.png');
  const panel = await populated(page);
  const viewer = await citation(page, panel);
  const zoom = await zoomed(page, panel);
  const tableReview = await sharedUnknown(page);
  const resultFreshness = await freshness(page);
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'browser-result.json'), JSON.stringify({ exit: 0, liveWrites: 0, blockedWrites,
    pageErrors: errors, liveReads, viewer, zoom, tableReview, resultFreshness, screenshots }));
} finally {
  await browser.close();
}
