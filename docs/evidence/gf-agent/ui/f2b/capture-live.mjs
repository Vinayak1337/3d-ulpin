import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createContractValidator } from '../../../../../apps/studio/src/local/contract.ts';

const out = import.meta.dirname;
const receipt = JSON.parse(execFileSync('git', [
  'show', 'task/a3c-tabular-live:docs/evidence/gf-agent/a3c/result.json',
], { encoding: 'utf8' }));
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const base = `http://127.0.0.1:3194/api/v1/ingestion/cases/${receipt.caseId}`;
const screenshots = [];
const responses = [];
const errors = [];
const deniedWrites = [];

async function get(path, schema) {
  const response = await fetch(`${base}${path}`);
  const value = await response.json();
  const actualSchema = response.ok ? schema : 'GET_ingestion_cases_caseId_events_Response_403_application_json';
  assert.deepEqual(validate(actualSchema, value), [], path);
  responses.push({ path, status: response.status, code: value.error?.code ?? null,
    message: value.error?.message ?? null });
  return value;
}

async function screenshot(page, name, notes) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, name), animations: 'disabled' });
  screenshots.push({ file: name, mode: 'live', notes });
}

async function openFile(page, key) {
  const file = receipt[key];
  const sourcePath = `/sources/${file.source.sourceId}`;
  const profile = await get(`${sourcePath}/profile`,
    'POST_ingestion_cases_caseId_sources_Response_201_application_json');
  await get(`${sourcePath}/streaming-vector/jobs/${file.rawJobId}`,
    'POST_ingestion_cases_caseId_sources_sourceId_streaming_vector_Response_202_application_json');
  await get(`${sourcePath}/chunk-mapping/jobs/${file.jobId}`,
    'POST_ingestion_cases_caseId_sources_sourceId_chunk_mapping_Response_202_application_json');
  const params = new URLSearchParams({ rawJobId: file.rawJobId, mappingJobId: file.jobId });
  await page.goto(`http://127.0.0.1:5188/studio/work/cases/${receipt.caseId}/tables/${file.source.sourceId}?${params}`);
  await expect(page.getByRole('heading', { name: file.asset, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('STALE_REVISION');
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toBeVisible();
  assert.equal(await page.getByRole('table', { name: 'Column mapping candidates' })
    .locator('tbody tr').count(), profile.headers.length);
  return file;
}

async function captureFiles(page) {
  const first = await openFile(page, 'first');
  await page.getByRole('alert').scrollIntoViewIfNeeded();
  await screenshot(page, '15-live-first-progress-stale.png',
    'A3c first source: current profile and raw status; historical mapping status refuses STALE_REVISION.');
  await page.getByRole('region', { name: 'Mapping learner' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toContainText('new');
  await screenshot(page, '16-live-first-learner.png',
    'Live durable SSE: first file new/memory/new; zero teacher calls; no positive accuracy claim.');
  assert(page.url().includes(first.jobId), 'Historical URL job selection stays pinned during case replay.');
  const second = await openFile(page, 'second');
  await page.getByRole('region', { name: 'Mapping learner' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toContainText('memory');
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toContainText('v44');
  await screenshot(page, '17-live-second-memory.png',
    'Live accepted-memory SSE for second file; mapped columns unavailable after case revision advanced.');
  assert(page.url().includes(second.jobId));
  await openFile(page, 'xlsx');
  await screenshot(page, '18-live-xlsx-selected-headers.png',
    'Live native workbook profile: T_18, rows 4/5; mapping status correctly reports stale pins.');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.continue();
    deniedWrites.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await captureFiles(page);
  await get(`/recipes/${receipt.approval.recipeId}`,
    'GET_ingestion_cases_caseId_recipes_recipeId_Response_200_application_json');
  assert.deepEqual(deniedWrites, []);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'live-result.json'), JSON.stringify({ exit: 0, liveWrites: 0, errors,
    caseId: receipt.caseId, screenshots, responses,
    owed: 'Historical mapping reads and automatic dispatcher rollout' }));
} finally {
  await browser.close();
}
