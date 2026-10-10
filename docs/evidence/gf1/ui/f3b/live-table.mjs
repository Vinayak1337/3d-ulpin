// Step 0: the table page against the live demo API, read-only. Every non-GET request is blocked and counted.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.STUDIO ?? 'http://127.0.0.1:5188';
const api = 'http://127.0.0.1:3194/api/v1';
const SCHEMES = { caseId: '1ada7796-4e8f-4a19-9b7f-4414e80114c4', sourceId: 'd6dffbcc-7ee0-4467-9ddf-4952bd23c33c' };
const D11 = { caseId: '4ad9cb6d-56c0-445e-a9b6-357d1dc1d452', sourceId: '333d5cdd-9778-4fb0-a89a-61794a532497' };
const OLDER = { caseId: D11.caseId, sourceId: 'ac36d0c4-74ca-4173-a954-4431e81d299d' };
const blockedWrites = [];
const consoleErrors = [];
const failedReads = [];
const screenshots = [];

async function read(path) {
  const response = await fetch(`${api}${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}

/** The latest raw and mapping job of a source, and what the API says about them. */
async function apiTruth({ caseId, sourceId }) {
  const detail = await read(`/cases/${caseId}`);
  const jobs = detail.jobs.filter((job) => job.sourceId === sourceId);
  const base = `/ingestion/cases/${caseId}/sources/${sourceId}`;
  const mappingJob = jobs.find((job) => job.operation === 'chunk-mapping');
  const mapping = await read(`${base}/chunk-mapping/jobs/${mappingJob.id}`);
  const profile = await read(`${base}/profile`);
  const chunks = [];
  for (let index = 0; index < mapping.nextPublishIndex; index += 1) {
    chunks.push(await read(`${base}/chunk-mapping/jobs/${mapping.jobId}/chunks/${index}`));
  }
  const questions = new Set(chunks.flatMap((chunk) => chunk.payload.mapping.questions.map((item) => item.sourceField)));
  const metrics = chunks.map((chunk) => chunk.payload.mapping.metrics);
  const sum = (key) => metrics.reduce((total, item) => total + item[key], 0);
  return { rawJobId: mapping.rawJobId, mappingJobId: mapping.jobId, current: mapping.current,
    reasons: mapping.reasons, status: mapping.status, columns: profile.headers.length, records: profile.records,
    slotsListed: mapping.slots.length, chunks: chunks.length,
    chunksNotCurrent: chunks.filter((chunk) => !chunk.current).length, questions: questions.size,
    published: mapping.nextPublishIndex, teacherCalls: sum('teacherCalls'), memoryHits: sum('memoryHits'),
    studentFields: sum('studentFields'), teacherFields: sum('teacherFields'), needsInput: sum('needsInput') };
}

async function guardWrites(route) {
  const request = route.request();
  if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
  blockedWrites.push({ method: request.method(), path: new URL(request.url()).pathname });
  return route.abort('blockedbyclient');
}

/** What the page shows, read from its own regions. */
async function pageNumbers(page) {
  return page.evaluate(() => {
    const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const region = (label) => document.querySelector(`section[aria-label="${label}"]`);
    const rows = (label) => region(label)?.querySelectorAll('tbody tr').length ?? null;
    const totals = [...document.querySelectorAll('section[aria-label="Mapping learner"] p')]
      .map(text).find((value) => value.startsWith('Totals')) ?? null;
    const progress = [...(region('Import progress')?.querySelectorAll('tbody tr') ?? [])]
      .map((row) => [...row.children].map(text));
    return { header: text(document.querySelector('h1')), subtitle: text(region('Retained table')?.children[1]),
      columnRows: rows('Column mapping candidates'), learnerRows: rows('Mapping learner'),
      questionBadges: region('Column mapping candidates')?.querySelectorAll('tbody .ul-badge').length ?? 0,
      progress, learnerTotals: totals,
      stale: text([...document.querySelectorAll('.ul-banner')].find((item) => /earlier state/.test(item.textContent))),
      approveButtons: [...document.querySelectorAll('button')]
        .filter((item) => /^Approve/.test(item.textContent)).length };
  });
}

async function openTable(page, target, truth, withJobs = true) {
  const params = withJobs ? `?rawJobId=${truth.rawJobId}&mappingJobId=${truth.mappingJobId}` : '';
  const started = Date.now();
  await page.goto(`${studio}/studio/work/cases/${target.caseId}/tables/${target.sourceId}${params}`);
  const columns = page.getByRole('table', { name: 'Column mapping candidates' }).locator('tbody tr');
  await columns.first().waitFor();
  // Settled: every published chunk row and every question the chunks raise are on the page.
  await page.waitForFunction(({ chunks, questions }) => {
    const rows = document.querySelectorAll('section[aria-label="Mapping learner"] tbody tr').length;
    const badges = document.querySelectorAll('section[aria-label="Column mapping candidates"] tbody .ul-badge').length;
    return rows >= chunks && badges === questions;
  }, { chunks: truth.chunks, questions: truth.questions }, { timeout: 30000 });
  return { loadMs: Date.now() - started };
}

async function capture(page, name, notes) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, name), animations: 'disabled' });
  screenshots.push({ file: name, mode: 'live', notes });
}

async function checkTable(page, label, target, shots) {
  const truth = await apiTruth(target);
  const timing = await openTable(page, target, truth);
  const shown = await pageNumbers(page);
  for (const shot of shots) await shot(page);
  return { label, api: truth, page: shown, ...timing };
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    failedReads.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  await page.route('**/api/**', guardWrites);
  const scheme = await checkTable(page, 'TNHB schemes · 90 columns', SCHEMES, [
    (view) => capture(view, '01-live-schemes-top.png', 'Top of the 90-column table page.'),
    async (view) => {
      await view.getByRole('table', { name: 'Column mapping candidates' }).scrollIntoViewIfNeeded();
      await capture(view, '02-live-schemes-questions.png', 'Columns with their questions.');
    },
    async (view) => {
      await view.locator('section[aria-label="Mapping learner"]').scrollIntoViewIfNeeded();
      await capture(view, '03-live-schemes-learner.png', 'Learner panel with totals.');
    },
  ]);
  const small = await checkTable(page, 'mi-d11-01.csv · 9 columns', D11, []);
  const older = await checkTable(page, 'mi-d10-01.csv · older A3c table', OLDER, [
    async (view) => {
      await view.getByText(/These results are from an earlier state/).scrollIntoViewIfNeeded();
      await capture(view, '05-live-stale-table.png', 'An older A3c table the server returns as current: false.');
    },
  ]);
  const result = { blockedWrites, consoleErrors, failedReads, screenshots, tables: [scheme, small, older] };
  writeFileSync(resolve(out, 'live-table.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ blocked: blockedWrites.length, errors: consoleErrors.length, failedReads,
    tables: result.tables.map(({ label, loadMs, api: truth, page: shown }) => ({ label, loadMs, truth, shown })) },
  null, 1));
} finally {
  await browser.close();
}
