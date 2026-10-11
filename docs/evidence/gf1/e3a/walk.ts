import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as httpServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chromium, type Page } from '@playwright/test';
import { bootstrap } from '../../../../apps/api/src/main';
import { migrate, query, closePool } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';

const nonce = process.env.ULPIN_E3A_NONCE!;
assert.match(nonce, /^[a-f0-9]{16}$/);
const scratch = `E:/BhuAayam-data/task-data/e3a/${nonce}`;
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const pack = 'E:/BhuAayam-data/datasets/nyc-10013/nyc-10013-multimodal.zip';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const controls: Record<string, any> = {};
const screenshots: string[] = [];
let api: Awaited<ReturnType<typeof bootstrap>> | undefined;
let vite: any;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const server = httpServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const bytes of request) chunks.push(Buffer.from(bytes));
    assert.equal(request.url, '/internal/area/inspect-gis');
    const code = 'import sys,json;sys.path.insert(0,"services/geo");'
      + 'from geo.gis_inspection import inspect_gis;print(json.dumps(inspect_gis(json.load(sys.stdin))))';
    const result = spawnSync(python, ['-B', '-c', code], { encoding: 'utf8', timeout: 60000,
      input: Buffer.concat(chunks), maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(result.stdout);
  } catch (error: any) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  }
});

async function listen() {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

function extract() {
  mkdirSync(scratch, { recursive: true });
  const code = 'import zipfile,pathlib,sys;z=zipfile.ZipFile(sys.argv[1]);p=pathlib.Path(sys.argv[2]);'
    + '[p.joinpath(n.split("/")[-1]).write_bytes(z.read(n)) '
    + 'for n in ["layers/buildings-original.geojson","layers/sidewalk.geojson"]]';
  const result = spawnSync(python, ['-B', '-c', code, pack, scratch], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  return ['buildings-original.geojson', 'sidewalk.geojson'].map((name) => {
    const bytes = readFileSync(`${scratch}/${name}`);
    return { name, sha256: hash(bytes), sizeBytes: bytes.length, base64: bytes.toString('base64') };
  });
}

async function infrastructure() {
  const geoPort = await listen();
  process.env.GEO_URL = `http://127.0.0.1:${geoPort}`;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  await query(sql('bootstrap.postgis'));
  await migrate();
  const require = createRequire(resolve('packages/server/package.json'));
  const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
  const store = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });
  try { await store.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET })); }
  finally { store.destroy(); }
  // Reserve a free loopback port for the API; only our listener is opened and closed.
  const reservation = httpServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address();
  assert(address && typeof address !== 'string');
  process.env.API_PORT = String(address.port);
  await new Promise<void>((done) => reservation.close(() => done()));
  api = await bootstrap();
  process.env.ULPIN_API_TARGET = `http://127.0.0.1:${process.env.API_PORT}`;
  const studioRequire = createRequire(resolve('apps/studio/package.json'));
  const { createServer } = await import(pathToFileURL(studioRequire.resolve('vite')).href);
  vite = await createServer({ root: 'apps/studio', configFile: 'apps/studio/vite.config.ts',
    envFile: false, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen();
  return vite.resolvedUrls.local[0];
}

async function walk(url: string, originals: ReturnType<typeof extract>) {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const calls: string[] = [];
  const errors: string[] = [];
  observe(page, calls, errors);
  await page.goto(`${url}studio/add-files`);
  await dropOriginals(page, originals);
  await page.getByRole('dialog', { name: 'Retain map files' }).waitFor();
  await page.getByLabel('New case name', { exact: true }).fill('NYC 10013 retained intake test_only');
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.waitForURL(/\/studio\/work\/cases\/[^/]+\/intake$/);
  await page.getByRole('region', { name: 'Intake tray', exact: true }).waitFor();
  await dispatchTick();
  await page.getByRole('button', { name: 'View layout fields', exact: true }).first().waitFor({ timeout: 90000 });
  await dispatchTick();
  await page.getByRole('button', { name: 'View layout fields', exact: true }).nth(1).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'View layout fields', exact: true }).first().click();
  await page.getByText('No suggested identifier is supplied by this profile.', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Propose layout', exact: true }).isDisabled());
  const accessibility = await checkAccessibility(page);
  assert(!calls.some((call) => call.includes('/import-packages')));
  assert.equal(controls.profiles.length, 2);
  assert.equal(controls.manifest.items.length, 2);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  for (const [index, original] of originals.entries()) {
    assert.equal(controls.profiles[index].source.sourceSha256, original.sha256);
  }
  return { url, calls, errors, ...accessibility, screenshots,
    gap: 'Stopped at the missing profile destination suggestions and manifest planRef; no approval or package walk.' };
}

function observe(page: Page, calls: string[], errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', async (response) => {
    if (!response.url().includes('/api/v1/')) return;
    calls.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
    if (!response.ok() || response.headers()['content-type']?.includes('text/event-stream')) return;
    const body = await response.json().catch(() => null);
    if (response.url().endsWith('/sources')) controls.profiles = [...(controls.profiles ?? []), body];
    if (response.url().endsWith('/intake')) controls.manifest = body;
  });
}

async function dropOriginals(page: Page, originals: ReturnType<typeof extract>) {
  await page.getByText('Drop files here, or choose files', { exact: true }).waitFor();
  await page.evaluate((files) => {
    const transfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.base64), (value) => value.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: 'application/geo+json' }));
    }
    const drop = document.querySelector('input[type="file"]')!.closest('label')!;
    drop.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, originals.map(({ name, base64 }) => ({ name, base64 })));
}

async function checkAccessibility(page: Page) {
  await page.screenshot({ path: `${scratch}/tray-and-question.png`, fullPage: true });
  screenshots.push(`${scratch}/tray-and-question.png`);
  await page.getByRole('region', { name: 'Intake tray', exact: true }).focus();
  await page.keyboard.press('Tab');
  const keyboard = await page.evaluate(() => ({ tag: document.activeElement?.tagName,
    text: document.activeElement?.textContent?.trim() }));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  const panelKeyboard = await page.getByRole('combobox').evaluate((element) => ({
    reachable: element === document.activeElement, focusWidth: getComputedStyle(element).outlineWidth,
  }));
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const tray = page.getByRole('region', { name: 'Intake tray', exact: true });
  await tray.scrollIntoViewIfNeeded();
  const zoomTray = await tray.evaluate((element) => ({
    scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
    textVisible: element.querySelector('td')!.clientWidth >= 100,
  }));
  await page.screenshot({ path: `${scratch}/tray-200.png`, fullPage: true });
  await page.getByRole('combobox').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${scratch}/question-200.png`, fullPage: true });
  screenshots.push(`${scratch}/tray-200.png`, `${scratch}/question-200.png`);
  assert(panelKeyboard.reachable, 'The layout field must be reachable by Tab from the tray.');
  assert(zoomTray.textVisible, 'At 200% the tray must scroll rather than crush file names.');
  return { keyboard, panelKeyboard, zoomTray };
}

async function main() {
  let failure: string | undefined;
  let result: unknown;
  const originals = extract();
  try {
    const url = await infrastructure();
    result = await walk(url, originals);
    writeFileSync(process.env.ULPIN_E3A_CONTROLS_PATH!, `${JSON.stringify(controls)}\n`, { flag: 'wx' });
  } catch (error: any) {
    failure = error.message;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await vite?.close();
    await api?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    closeStorageClient();
    await closePool();
  }
  console.log(JSON.stringify({ result, failure, originals: originals.map(({ base64, ...file }) => file),
    scratch, screenshots, originalPackAccess: 'Read-only ZipFile; members copied to owned scratch.',
    network: 'Loopback API, MinIO and unchanged Python inspection.' }));
}

main().catch((error) => {
  console.log(JSON.stringify({ failure: error.message }));
  process.exitCode = 1;
});
