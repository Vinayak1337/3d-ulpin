// Browser checks behind the F3c screenshots. Three jobs are intercepted from contract-valid controls
// (apps/studio/scripts/f3c-fixtures.ts); the TNHB table is read live. Every non-GET request is blocked.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.STUDIO ?? 'http://127.0.0.1:5188';
const INTERCEPTED = 'Intercepted responses · no live writes';
const LIVE_TABLE = '/studio/work/cases/1ada7796-4e8f-4a19-9b7f-4414e80114c4/tables/' +
  'd6dffbcc-7ee0-4467-9ddf-4952bd23c33c?rawJobId=f186791c-b5e6-4c21-ade2-208ba89c0c3f' +
  '&mappingJobId=4b48f457-2671-4937-a973-f040b5fc20d5';
const controls = JSON.parse(readFileSync('E:/BhuAayam-data/task-data/f3c-ui/responses.json', 'utf8'));
const screenshots = [];
const blockedWrites = [];
const errors = [];
let table = null;

function fulfilTable(route, path) {
  const { job } = table;
  if (path.endsWith('/events')) return route.abort('failed');
  if (path === `/api/v1/cases/${controls.caseId}`) return route.fulfill({ json: controls.detail });
  if (path.endsWith('/profile')) return route.fulfill({ json: job.profile });
  if (path.includes('/recipes/')) return route.fulfill({ json: [] });
  if (path.includes('/chunks/')) return route.fulfill({ json: job.chunks[Number(path.split('/').at(-1))] });
  if (path.includes('/streaming-vector/jobs/')) return route.fulfill({ json: job.raw });
  if (path.includes('/chunk-mapping/jobs/')) return route.fulfill({ json: job.mapping });
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
  return route.continue();
}

async function capture(page, name, mode, notes) {
  await page.evaluate(() => document.fonts.ready);
  if (mode) {
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
  screenshots.push({ file: name, mode: mode ?? 'live', notes });
}

const columnsOf = (page) => page.getByRole('table', { name: 'Column mapping candidates' });
const learnerOf = (page) => page.locator('section[aria-label="Mapping learner"]');

async function openJob(page, name) {
  table = { job: controls.jobs[name] };
  const { raw, mapping, profile } = table.job;
  const params = `rawJobId=${raw.jobId}&mappingJobId=${mapping.jobId}`;
  await page.goto(`${studio}/studio/work/cases/${controls.caseId}/tables/${profile.source.sourceId}?${params}`);
  await expect(columnsOf(page).locator('tbody tr')).toHaveCount(profile.headers.length);
  await expect(learnerOf(page).locator('tbody tr')).toHaveCount(3);
}

async function totalsText(page) {
  const paragraphs = await learnerOf(page).locator('p').allInnerTexts();
  return paragraphs.map((text) => text.replace(/\s+/g, ' ').trim()).find((text) => text.startsWith('Totals'));
}

/** From and Confidence of each column row, as the page words them. */
async function columnCells(page) {
  return columnsOf(page).locator('tbody tr').evaluateAll((rows) => rows.map((row) => ({
    confidence: row.children[5].textContent.replace(/\s+/g, ' ').trim(),
    from: row.children[6].textContent.replace(/\s+/g, ' ').trim() })));
}

async function shots(page, job, label, notes) {
  await columnsOf(page).scrollIntoViewIfNeeded();
  await capture(page, `${job}-columns.png`, INTERCEPTED, `${label}: From and Confidence. ${notes}`);
  await learnerOf(page).scrollIntoViewIfNeeded();
  await capture(page, `${job}-learner.png`, INTERCEPTED, `${label}: learner panel and totals. ${notes}`);
}

async function unansweredJob(page) {
  await openJob(page, 'unanswered');
  const columns = table.job.profile.headers.length;
  const cells = await columnCells(page);
  assert.ok(cells.every((cell) => cell.from === 'Needs reviewNo answer · teacher unavailable'));
  assert.ok(cells.every((cell) => cell.confidence === '—No confidence: nobody answered'));
  const totals = await totalsText(page);
  assert.ok(totals.includes(`Unanswered: ${columns * 3}`), totals);
  assert.ok(totals.includes(`${columns} open questions`), totals);
  assert.ok(!/\d+ questions/.test(totals), totals);
  await expect(learnerOf(page).getByRole('columnheader', { name: 'Unanswered' })).toBeVisible();
  await expect(page.getByText('0%')).toHaveCount(0);
  await shots(page, '01-unanswered', 'Every column unanswered, count reported',
    'Questions are counted once; the per-chunk header says what it counts.');
  return { columns, totals, from: cells[0].from, confidence: cells[0].confidence };
}

async function mixedJob(page) {
  await openJob(page, 'mixed');
  const cells = await columnCells(page);
  const answered = cells.filter((cell) => cell.from === 'student');
  const open = cells.filter((cell) => cell.from.startsWith('Needs reviewNo answer'));
  assert.equal(answered.length + open.length, cells.length);
  assert.ok(answered.every((cell) => /^\d+%$/.test(cell.confidence)));
  assert.ok(open.every((cell) => cell.from.endsWith('teacher rate limited')));
  const totals = await totalsText(page);
  assert.ok(totals.includes(`Unanswered: ${open.length * 3}`), totals);
  assert.ok(totals.includes(`${open.length} open questions`), totals);
  await shots(page, '02-mixed', 'Six columns answered by the student, ten unanswered',
    'Real student rows keep their confidence.');
  return { answered: answered.length, unanswered: open.length, totals };
}

async function oldJob(page) {
  await openJob(page, 'old');
  const cells = await columnCells(page);
  const noAnswer = cells.filter((cell) => cell.from.includes('No answer'));
  assert.equal(noAnswer.length, 2);
  assert.ok(cells.slice(0, -2).every((cell) => !cell.from.includes('No answer')));
  const totals = await totalsText(page);
  assert.ok(totals.includes('Unanswered: Not reported for 3 of 3 chunks'), totals);
  const reported = await learnerOf(page).locator('tbody tr').first().innerText();
  assert.ok(reported.includes('Not reported'));
  await expect(learnerOf(page).getByText(/recorded before the server counted unanswered fields/)).toBeVisible();
  await shots(page, '03-old-shape', 'Old-shape job without the count',
    'Not reported, never 0; two manual columns stored as memory read as no answer.');
  return { noAnswerColumns: noAnswer.length, totals };
}

/** The TNHB table on the live demo API, which still reports the old shape: shown as stored. */
async function liveTable(page) {
  table = null;
  await page.goto(`${studio}${LIVE_TABLE}`);
  const badges = columnsOf(page).locator('tbody .ul-badge');
  await expect(badges).toHaveCount(90, { timeout: 30000 });
  await expect(learnerOf(page).locator('tbody tr')).toHaveCount(51);
  const totals = await totalsText(page);
  assert.ok(totals.includes('90 open questions'), totals);
  assert.ok(!/\d{4} questions/.test(totals), totals);
  await learnerOf(page).locator('p').last().scrollIntoViewIfNeeded();
  await capture(page, '04-live-tnhb-totals.png', null,
    'Live demo API, old shape: 90 open questions from 51 chunks; the unanswered count is not reported.');
  await columnsOf(page).scrollIntoViewIfNeeded();
  await capture(page, '05-live-tnhb-columns.png', null,
    'Live demo API, old shape: sources and 0 % confidence are shown as the server stored them.');
  return { openQuestions: 90, chunks: 51, totals };
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', intercept);
  const unanswered = await unansweredJob(page);
  const mixed = await mixedJob(page);
  const old = await oldJob(page);
  const live = await liveTable(page);
  assert.deepEqual(blockedWrites, []);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'browser-result.json'), JSON.stringify({ exit: 0, liveWrites: 0, blockedWrites,
    pageErrors: errors, unanswered, mixed, old, live, screenshots }));
} finally {
  await browser.close();
}
