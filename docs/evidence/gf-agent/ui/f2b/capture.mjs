import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createContractValidator } from '../../../../../apps/studio/src/local/contract.ts';

const out = import.meta.dirname;
const controls = JSON.parse(readFileSync(resolve(out, 'responses.json'), 'utf8'));
const openapi = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
const streamContent = openapi.paths['/api/v1/ingestion/cases/{caseId}/events'].get.responses['200']
  .content['text/event-stream'];
openapi.components.schemas.F2bEvent = streamContent['x-change-data-schema'];
openapi.components.schemas.F2bControl = streamContent['x-control-data-schema'];
const validate = createContractValidator(openapi);
const studio = 'http://127.0.0.1:5188';
const screenshots = [];
const errors = [];
const resumes = [];
const writes = [];
let active = controls.files[0];
let deny = false;
const sockets = new Set();
const revisions = [];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reason = 'Intercepted protocol control only; retain unknown, not property facts or learning truth.';

function checked(schema, value) {
  assert.deepEqual(validate(schema, value), [], schema);
  return value;
}

function streamFrames(file, cursor) {
  const base = revisions.length >= 2 ? 3 : 0;
  const common = { version: 'case-ingestion/1', caseId: controls.caseId, caseRevision: 1, requiresRefresh: true };
  const ready = { ...common, kind: 'ready', reason: 'connected', cursor, headCursor: String(base + 3) };
  const changes = [
    { kind: 'streaming-vector.changed', jobId: file.raw.jobId, sourceId: file.profile.source.sourceId,
      sourceRevision: 1, status: file.raw.status },
    { kind: 'chunk-mapping.changed', jobId: file.mapping.jobId, rawJobId: file.raw.jobId,
      sourceId: file.profile.source.sourceId, sourceRevision: 1, status: file.mapping.status },
    file.chunk.payload.mapping.metrics,
  ];
  checked('F2bControl', ready);
  const frames = [`id: ${cursor}\nevent: ready\ndata: ${JSON.stringify(ready)}\n\n`];
  changes.forEach((change, index) => {
    const sequence = String(base + index + 1);
    const data = { ...common, sequence, createdAt: new Date().toISOString(), change };
    checked('F2bEvent', data);
    if (BigInt(sequence) > BigInt(cursor)) {
      frames.push(`id: ${sequence}\nevent: ingestion.change\ndata: ${JSON.stringify(data)}\n\n`);
    }
  });
  return frames.join('');
}

const eventServer = createServer((request, response) => {
  resumes.push({ cursor: new URL(request.url, 'http://x').searchParams.get('cursor'),
    lastEventId: request.headers['last-event-id'] ?? null });
  response.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': studio,
    'access-control-allow-credentials': 'true', 'cache-control': 'no-store' });
  const cursor = request.headers['last-event-id'] ?? new URL(request.url, 'http://x').searchParams.get('cursor') ?? '0';
  response.write(streamFrames(active, cursor));
});
eventServer.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
await new Promise((done) => eventServer.listen(0, '127.0.0.1', done));
const eventPort = eventServer.address().port;

function sourceFile(path) {
  return controls.files.find((file) => path.includes(file.profile.source.sourceId)) ?? active;
}

async function intercept(route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const file = sourceFile(path);
  if (path.endsWith('/events')) {
    const query = new URL(request.url()).search;
    return route.fulfill({ status: 307, headers: { location: `http://127.0.0.1:${eventPort}/events${query}` } });
  }
  if (request.method() === 'GET') return interceptRead(route, path, file);
  writes.push({ method: request.method(), path });
  if (path.endsWith('/sources')) {
    if (deny) return route.fulfill({ status: 422, json: checked(
      'GET_ingestion_cases_caseId_events_Response_403_application_json', { error: {
        code: 'TABULAR_DATA_DENIED', message: 'Only exact public D8 development originals qualify.',
        requestId: controls.caseId,
      } }) });
    return route.fulfill({ status: 201, json: file.profile });
  }
  if (path.endsWith('/streaming-vector')) {
    checked('POST_ingestion_cases_caseId_sources_sourceId_streaming_vector_Request_application_json',
      request.postDataJSON());
    return route.fulfill({ status: 202, json: file.raw });
  }
  if (path.endsWith('/chunk-mapping')) {
    checked('POST_ingestion_cases_caseId_sources_sourceId_chunk_mapping_Request_application_json',
      request.postDataJSON());
    return route.fulfill({ status: 202, json: file.mapping });
  }
  if (path.endsWith('/recipes')) return proposeControl(route, file);
  if (path.endsWith('/approve')) return approveControl(route, file);
  if (path === '/api/v1/cases') {
    checked('POST_cases_Request_application_json', request.postDataJSON());
    return route.fulfill({ status: 201, json: checked(
      'POST_cases_Response_201_application_json', controls.detail.case) });
  }
  // Unrecognised writes are always blocked; no live write can escape this harness.
  return route.abort('blockedbyclient');
}

async function interceptRead(route, path, file) {
  if (path === `/api/v1/cases/${controls.caseId}`) return route.fulfill({ json: controls.detail });
  if (path.endsWith('/profile')) {
    const profile = [controls.duplicateProfile, controls.nativeProfile]
      .find((profile) => path.includes(profile.source.sourceId)) ?? file.profile;
    return route.fulfill({ json: profile });
  }
  if (path.includes('/recipes/')) {
    checked('GET_ingestion_cases_caseId_recipes_recipeId_Response_200_application_json', revisions);
    return route.fulfill({ json: revisions });
  }
  if (path.includes('/chunks/')) return route.fulfill({ json: file.chunk });
  if (path.includes('/streaming-vector/jobs/')) return route.fulfill({ json: file.raw });
  if (path.includes('/chunk-mapping/jobs/')) return route.fulfill({ json: file.mapping });
  return route.continue();
}

async function proposeControl(route, file) {
  const body = route.request().postDataJSON();
  checked('POST_ingestion_cases_caseId_sources_sourceId_recipes_Request_application_json', body);
  assert.equal(body.destination, null);
  assert.deepEqual(body.plan.decisions.map((decision) => decision.sourceField),
    file.profile.profile.columns.map((column) => column.name));
  assert(body.plan.decisions.every((decision) => decision.reason === reason));
  const receipt = { id: randomUUID(), revision: 1, state: 'proposed', plan: body.plan,
    destination: null, planHash: hash(body.plan), authoredBy: 'intercepted-local-operator',
    authoredAt: new Date().toISOString(), approval: null, execution: null };
  checked('POST_ingestion_cases_caseId_sources_sourceId_recipes_Response_201_application_json', receipt);
  revisions.push(receipt);
  return route.fulfill({ status: 201, json: receipt });
}

async function approveControl(route, file) {
  const body = route.request().postDataJSON();
  checked('POST_ingestion_cases_caseId_recipes_recipeId_approve_Request_application_json', body);
  assert.equal(body.expectedRecipeRevision, revisions.at(-1).revision);
  const receipt = { ...revisions.at(-1), revision: 2, state: 'approved', approval: {
    subject: 'intercepted-local-operator', at: new Date().toISOString(), planHash: revisions.at(-1).planHash,
    provenance: 'server_configured_local_operator',
  } };
  checked('POST_ingestion_cases_caseId_sources_sourceId_recipes_Response_201_application_json', receipt);
  revisions.push(receipt);
  approvedControl(file, receipt);
  return route.fulfill({ status: 201, json: receipt });
}

function approvedControl(file, receipt) {
  const jobId = randomUUID();
  file.mapping = { ...file.mapping, jobId, route: 'approved_recipe', recipeId: receipt.id,
    recipeRevision: receipt.revision, status: 'completed' };
  const mapping = file.chunk.payload.mapping;
  mapping.plan = receipt.plan.mapping;
  mapping.questions = [];
  mapping.fieldSources = mapping.plan.fields.map((field) => ({ sourceField: field.sourceField,
    source: 'officer', method: mapping.plan.method }));
  mapping.metrics = { ...mapping.metrics, jobId, layout: 'new', teacherFields: 0, studentFields: 0,
    teacherCalls: 0, memoryHits: 0, needsInput: 0 };
  file.chunk.payload = { ...file.chunk.payload, jobId, recipeRevision: receipt.revision, mapping };
  checked('POST_ingestion_cases_caseId_sources_sourceId_chunk_mapping_Response_202_application_json', file.mapping);
  const schema = 'GET_ingestion_cases_caseId_sources_sourceId_chunk_mapping_jobs_jobId_chunks_chunkIndex_' +
    'Response_200_application_json';
  checked(schema, file.chunk);
}

function tableUrl(file) {
  const params = new URLSearchParams({ rawJobId: file.raw.jobId, mappingJobId: file.mapping.jobId });
  return `${studio}/studio/work/cases/${controls.caseId}/tables/${file.profile.source.sourceId}?${params}`;
}

async function capture(page, name, notes) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const tag = document.createElement('div');
    tag.id = 'intercepted-label';
    tag.textContent = 'Intercepted responses · no live writes';
    Object.assign(tag.style, { position: 'fixed', bottom: '8px', right: '16px', zIndex: '9999',
      padding: '8px 12px', background: 'var(--ui-surface)', color: 'var(--ui-ink)',
      border: '1px solid var(--ui-border-strong)', font: '500 13px var(--ui-font-sans)' });
    document.body.append(tag);
  });
  await page.screenshot({ path: resolve(out, name), animations: 'disabled' });
  await page.locator('#intercepted-label').evaluate((tag) => tag.remove());
  screenshots.push({ file: name, mode: 'intercepted', notes });
}

async function readCaptures(page) {
  await page.goto(tableUrl(active));
  await expect(page.getByRole('table', { name: 'Column mapping candidates' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toBeVisible();
  await capture(page, '01-import-progress-columns.png',
    'Real mi-d10-02.csv headers, offline proposal; no live import.');
  await page.getByRole('region', { name: 'Mapping learner' }).scrollIntoViewIfNeeded();
  await capture(page, '02-first-layout-new.png', 'First offline file: layout new; teacher calls zero.');
  await failoverCapture(page);
  active = controls.files[1];
  await page.goto(tableUrl(active));
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toContainText('memory');
  await page.getByRole('region', { name: 'Mapping learner' }).scrollIntoViewIfNeeded();
  await capture(page, '03-second-layout-memory.png',
    'Real mi-d10-03.csv; offline job-local reuse, not live approval memory.');
}

async function openImport(page, name = 'mi-d10-02.csv') {
  await page.goto(`${studio}/studio/add-files`);
  await page.locator('input[type=file]').setInputFiles(resolve('fixtures/usp/D8-messy-india/dev/d1b', name));
  await page.getByRole('button', { name: 'Import as a table', exact: true }).click();
  await page.getByLabel('Case ID', { exact: true }).fill(controls.caseId);
}

async function addFilesCaptures(page) {
  active = controls.files[0];
  await openImport(page);
  await capture(page, '04-add-files-table-path.png', 'Officer chooses an existing source case; explicit D8 limit.');
  deny = true;
  await page.getByRole('button', { name: 'Retain table and start mapping' }).click();
  await expect(page.getByRole('alert')).toContainText('TABULAR_DATA_DENIED');
  await capture(page, '05-tabular-data-denied.png', 'Exact server refusal wording; option remains available.');
  deny = false;
  const queued = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/chunk-mapping'));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await queued;
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toBeVisible();
  assert(writes.some((write) => write.path.endsWith('/streaming-vector')));
  assert(writes.some((write) => write.path.endsWith('/chunk-mapping')));
}

async function createCaseCapture(page) {
  active = controls.files[1];
  await openImport(page, 'mi-d10-03.csv');
  await page.getByRole('combobox', { name: /Source case/ }).selectOption('create');
  await page.getByLabel('New case name', { exact: true }).fill('mi-d10-03.csv');
  await capture(page, '19-create-source-case.png', 'Create an unassigned source case; intercepted protocol receipt.');
  const queued = page.waitForResponse((response) => response.request().method() === 'POST' &&
    response.url().endsWith('/chunk-mapping'));
  await page.getByRole('button', { name: 'Retain table and start mapping', exact: true }).click();
  await queued;
  await expect(page.getByRole('table', { name: 'Learner metrics per chunk' })).toBeVisible();
  assert(writes.some((write) => write.path === '/api/v1/cases'));
}

async function approvalCaptures(page) {
  await page.getByRole('button', { name: 'Answer mapping questions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record the mapping', exact: true })).toBeDisabled();
  for (let index = 1; index <= active.profile.headers.length; index += 1) {
    await page.getByRole('combobox', { name: `Target for column ${index}`, exact: true }).selectOption('unknown');
    await page.getByRole('textbox', { name: `Reason for column ${index}`, exact: true }).fill(reason);
  }
  await page.getByRole('button', { name: 'Record the mapping', exact: true }).scrollIntoViewIfNeeded();
  await page.getByLabel('Column answers, scroll for more').evaluate((table) => { table.scrollTop = 0; });
  await capture(page, '06-officer-answer-form.png', 'All columns explicitly unknown with a protocol-control reason.');
  await page.getByRole('button', { name: 'Record the mapping', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Propose this mapping?' })).toBeVisible();
  await capture(page, '07-confirm-proposal.png', 'First confirmation: save an unapproved recipe.');
  await page.getByRole('button', { name: 'Confirm proposal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve mapping', exact: true })).toBeVisible();
  await capture(page, '08-mapping-proposed.png', 'Proposed revision read through the recipe history route.');
  await page.getByRole('button', { name: 'Approve mapping', exact: true }).click();
  await capture(page, '09-confirm-approval.png',
    'Second confirmation: approval permits draft mapping and learning only.');
  await page.getByRole('button', { name: 'Confirm approval', exact: true }).click();
  await expect(page.getByText('Mapping approved · revision 2', { exact: true })).toBeVisible();
  await page.getByText('Recipe revision history · 2', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Recipe revisions' })).toContainText('approved');
  await page.getByRole('table', { name: 'Recipe revisions' }).scrollIntoViewIfNeeded();
  await capture(page, '10-approved-history.png', 'Intercepted operator receipt and append-only revision history.');
  await expect(page.getByRole('table', { name: 'Column mapping candidates' })).toContainText('Officer decision');
  await expect(page.getByRole('button', { name: /execute/i })).toHaveCount(0);
}

async function failoverCapture(page) {
  for (const socket of sockets) socket.destroy();
  await expect(page.getByText('Polling · stream unavailable', { exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Import progress' }).scrollIntoViewIfNeeded();
  await capture(page, '11-stream-fallback.png', 'Native stream disconnect; job status polling is disclosed.');
  await page.getByRole('button', { name: 'Reconnect stream', exact: true }).click();
  await expect(page.getByText('Event stream', { exact: true })).toBeVisible();
  assert(resumes.some((resume) => resume.cursor === '3' || resume.lastEventId === '3'));
}

async function difficultCaptures(page) {
  await openImport(page, 'mi-d19-01.xlsx');
  const selection = controls.nativeProfile.tabular.selection;
  await page.getByLabel('Exact sheet name', { exact: true }).fill(selection.sheet);
  await page.getByLabel('Header row numbers', { exact: true }).fill(selection.headerRows.join(', '));
  await capture(page, '12-xlsx-header-selection.png',
    'Native T_18 sheet and header rows 4/5, from real mi-d19-01.xlsx.');
  const sourceId = controls.duplicateProfile.source.sourceId;
  await page.goto(`${studio}/studio/work/cases/${controls.caseId}/tables/${sourceId}`);
  await expect(page.getByRole('heading', { name: 'mi-d11-01.csv', exact: true })).toBeVisible();
  await capture(page, '13-duplicate-headers-unknown.png',
    'Real duplicate literal headers remain positional; no job selected.');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await page.getByRole('button', { name: 'Copy hash', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Copy hash', exact: true })).toBeFocused();
  const focusWidth = await page.getByRole('button', { name: 'Copy hash', exact: true })
    .evaluate((button) => getComputedStyle(button).outlineWidth);
  assert.equal(focusWidth, '2px');
  await capture(page, '14-zoom-200-percent.png', 'CSS 200% zoom; table overflow stays keyboard reachable.');
  const columns = page.getByLabel('Column mapping table, scroll for more columns and rows', { exact: true });
  await columns.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => columns.evaluate((table) => table.scrollLeft)).toBeGreaterThan(0);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', intercept);
  await readCaptures(page);
  await addFilesCaptures(page);
  await approvalCaptures(page);
  await createCaseCapture(page);
  await difficultCaptures(page);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'browser-result.json'), JSON.stringify({ exit: 0, errors, screenshots, writes,
    liveWrites: 0, sse: 'Native EventSource, schema-validated intercepted SSE at a temporary loopback test server',
    keyboard: { focusOutline: '2px', zoomFactor: 2, horizontalArrowScroll: true }, resumes }));
} finally {
  await browser.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((done) => eventServer.close(done));
}
