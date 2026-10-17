import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as httpServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium, type Page } from '@playwright/test';
import { bootstrap } from '../../../../apps/api/src/main';
import { migrate, query, closePool } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { controlWalk } from './walk-controls';

const nonce = process.env.ULPIN_LQ1A_NONCE!;
assert.match(nonce, /^[a-f0-9]{16}$/);
const scratch = `E:/BhuAayam-data/task-data/lq1a/${nonce}`;
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const inputPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const input = readFileSync(inputPath);
const digest = createHash('sha256').update(input).digest('hex');
assert.equal(digest, '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e');
mkdirSync(scratch, { recursive: true });
const controls: Record<string, any> = {};
const screenshots: string[] = [];
let api: Awaited<ReturnType<typeof bootstrap>> | undefined;
let vite: any;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let dispatcher: ReturnType<typeof setInterval> | undefined;
const server = httpServer(inspect);

async function inspect(request: any, response: any) {
  try {
    const chunks: Buffer[] = [];
    for await (const bytes of request) chunks.push(Buffer.from(bytes));
    assert.equal(request.url, '/internal/area/inspect-gis');
    const code = 'import sys,json;sys.path.insert(0,"services/geo");'
      + 'from geo.gis_inspection import inspect_gis;print(json.dumps(inspect_gis(json.load(sys.stdin))))';
    const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8', timeout: 60000,
      input: Buffer.concat(chunks), maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(result.stdout);
  } catch (error: any) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  }
}

async function loopbackPort(listener: ReturnType<typeof httpServer>) {
  await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
  const address = listener.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function createBucket() {
  const require = createRequire(resolve('packages/server/package.json'));
  const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
  const store = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });
  try { await store.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET })); }
  finally { store.destroy(); }
}

async function infrastructure() {
  process.env.GEO_URL = `http://127.0.0.1:${await loopbackPort(server)}`;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  await query(sql('bootstrap.postgis'));
  await migrate();
  await createBucket();
  const reservation = httpServer();
  process.env.API_PORT = String(await loopbackPort(reservation));
  await new Promise<void>(done => reservation.close(() => done()));
  api = await bootstrap();
  process.env.ULPIN_API_TARGET = `http://127.0.0.1:${process.env.API_PORT}`;
  const studioRequire = createRequire(resolve('apps/studio/package.json'));
  const { createServer } = await import(pathToFileURL(studioRequire.resolve('vite')).href);
  vite = await createServer({ root: 'apps/studio', configFile: 'apps/studio/vite.config.ts',
    envFile: false, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen();
  // Owned runtime dispatcher, not a second request or an approval/execute helper.
  dispatcher = setInterval(() => void dispatchTick(), 1000);
  return vite.resolvedUrls.local[0];
}

function observe(page: Page, calls: string[], errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (!response.url().includes('/api/v1/')) return;
    const path = new URL(response.url()).pathname;
    calls.push(`${response.request().method()} ${path} ${response.status()}`);
    if (!response.ok() || response.headers()['content-type']?.includes('text/event-stream')) return;
    const body = await response.json().catch(() => null);
    if (path.endsWith('/sources')) controls.profile = body;
    if (path.endsWith('/intake')) controls.manifest = body;
    if (path.endsWith('/targets')) controls.targets = body;
  });
}

async function author(page: Page, caseId: string) {
  const sourceId = controls.profile.source.sourceId;
  const inspectedResponse = await page.request.get(`${process.env.ULPIN_API_TARGET}`
    + `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/profile`);
  assert.equal(inspectedResponse.status(), 200);
  const inspected = await inspectedResponse.json();
  const source = (await query('SELECT inspection FROM sources WHERE id=$1', [sourceId])).rows[0];
  const body = { requestKey: randomUUID(), expectedRecipeRevision: 0,
    plan: { version: inspected.version, mode: 'manual_mapping', source: inspected.source, caseId,
      workspaceRevision: inspected.workspaceRevision, workspaceFingerprint: inspected.workspaceFingerprint,
      operations: [
        { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
          conversionId: 'literal_identifier@1' },
        { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
      ] }, destination: { kind: 'new_area', name: source.inspection.gis.suggestedTitle,
      namespace: source.inspection.gis.suggestedNamespace } };
  const response = await page.request.post(`${process.env.ULPIN_API_TARGET}`
    + `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/recipes`, { data: body });
  assert.equal(response.status(), 201, await response.text());
  controls.authored = await response.json();
  controls.authorBody = body;
  return controls.authored;
}

async function realWalk(url: string, page: Page) {
  await page.goto(`${url}studio/add-files`);
  await page.locator('input[type=file]').setInputFiles({ name: 'buildings-original.geojson',
    mimeType: 'application/geo+json', buffer: input });
  await page.getByRole('dialog', { name: 'Retain map files' }).waitFor();
  await page.getByLabel('New case name', { exact: true }).fill('NYC test_only batch walk');
  const started = performance.now();
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.waitForURL(/\/studio\/work\/cases\/[^/]+\/intake$/);
  const batchUrl = page.url();
  const caseId = batchUrl.split('/').at(-2)!;
  await page.getByText('File checked', { exact: true }).waitFor({ timeout: 90000 });
  const checkedMs = Math.round(performance.now() - started);
  await page.getByText('That question is not on this screen yet.', { exact: false }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${scratch}/real-no-layout.png`, fullPage: true });
  screenshots.push(`${scratch}/real-no-layout.png`);
  const authored = await author(page, caseId);
  // Bound observation of the recipe event and stored projection; never substitute event facts into the tray.
  await page.waitForTimeout(6500);
  const manifestResponse = await page.request.get(`${url}api/v1/ingestion/cases/${caseId}/intake`);
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  const jobs = (await query('SELECT operation,status,error FROM jobs WHERE case_id=$1 ORDER BY created_at',
    [caseId])).rows;
  const historyResponse = await page.request.get(`${url}api/v1/ingestion/cases/${caseId}/recipes/${authored.id}`);
  assert.equal(historyResponse.status(), 200);
  controls.recipeHistory = await historyResponse.json();
  controls.manifest = manifest;
  await page.screenshot({ path: `${scratch}/real-authored-no-projection.png`, fullPage: true });
  screenshots.push(`${scratch}/real-authored-no-projection.png`);
  assert.equal(manifest.items[0].plan, null, 'If projection now works, extend the real browser walk.');
  assert.equal(authored.plan.heightField, undefined);
  return { caseId, batchUrl, checkedMs, authorStatus: 201, jobs, item: manifest.items[0],
    stoppedAt: 'Stop rule (a): authored proposed recipe exists, but item.plan remains null.',
    notRun: ['UI approval', 'package/area', 'first-100 confirmation', 'card timings', 'last-row priority',
      'PDF', 'verification', 'confirmation persistence'] };
}

async function main() {
  let failure: string | undefined;
  let result: unknown;
  const calls: string[] = [];
  const errors: string[] = [];
  try {
    const url = await infrastructure();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    observe(page, calls, errors);
    const real = await realWalk(url, page);
    result = { real, calls, pageErrors: errors };
    const control = await controlWalk(browser, real.batchUrl, controls, scratch);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    result = { real, control, calls, pageErrors: errors };
  } catch (error: any) {
    failure = error.message;
    process.exitCode = 1;
  } finally {
    if (dispatcher) clearInterval(dispatcher);
    writeFileSync(process.env.ULPIN_LQ1A_CONTROLS_PATH!, `${JSON.stringify(controls)}\n`, { flag: 'wx' });
    await browser?.close();
    await vite?.close();
    await api?.close();
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    closeStorageClient();
    await closePool();
  }
  assert.equal(createHash('sha256').update(readFileSync(inputPath)).digest('hex'), digest);
  console.log(JSON.stringify({ result, failure, input: { path: inputPath, bytes: input.length, sha256: digest },
    scratch, screenshots, network: 'Loopback only. Gateway disabled. Original unchanged.' }));
}

main().catch(error => {
  console.log(JSON.stringify({ failure: error.message }));
  process.exitCode = 1;
});
