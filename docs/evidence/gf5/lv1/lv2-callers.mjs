// Actual caller components, retained records only. No backend or generated demo register routes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { freePort, startServer, stopServer } from './server.mjs';
import { writeEvidence } from './evidence-json.mjs';

const root = process.cwd().replaceAll('\\', '/');
const scratch = `E:/BhuAayam-data/task-data/lv1/lv2-callers-${Date.now()}`;
const port = 5235;
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const register = await load('apps/studio/src/local/data/swiss-floor-register.json');
const context = await load('apps/studio/src/local/data/swiss-floor-context.json');
const nyc = await load('apps/studio/src/local/data/nyc-bronx-context.json');
const roof = await load('docs/evidence/gf-backend/k2c/roofprint-building-candidate.json');
await mkdir(scratch, { recursive: true });

async function guard(page) {
  await page.route('**/api/**', (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.abort();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let body;
    if (path === `/api/v1/buildings/${register.property.id}/register`) body = register;
    if (path === `/api/v1/areas/${context.area.id}/context`) body = context;
    if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function mount(page, name) {
  await page.evaluate(async (data) => {
    const probe = await import(`/@fs/${data.root}/docs/evidence/gf5/lv1/caller-probe.mjs`);
    await probe.prepareCapture(data.root);
    await probe.mountCaller(data);
  }, { root, name, register, nyc, roof });
}

async function waitForRegister(page, errors, reads) {
  try {
    await page.getByRole('heading', { name: register.property.name }).waitFor();
  } catch (error) {
    await page.screenshot({ path: `${scratch}/register-failed.png` });
    await writeFile(`${scratch}/register-errors.json`, JSON.stringify({ errors, reads }), { flag: 'wx' });
    throw error;
  }
}

async function capture(browser, name) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const errors = [];
  const reads = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/')) reads.push({ path, status: response.status() });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await guard(page);
  await page.route('**/lv2-capture', (route) => route.fulfill({ contentType: 'text/html',
    body: '<html><body><div id="root"></div></body></html>' }));
  await page.goto(`http://127.0.0.1:${port}/lv2-capture`);
  await mount(page, name);
  if (name === 'register') await waitForRegister(page, errors, reads);
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.fonts.ready);
  // The portal caller has no owning page CSS in this isolated read-only capture.
  if (name === 'portal') await page.locator('canvas').evaluate((canvas) => {
    canvas.parentElement.style.height = '850px';
    canvas.parentElement.style.width = '1440px';
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${scratch}/${name}.png` });
  const result = { name, screenshot: `${scratch}/${name}.png`, errors,
    canvases: await page.locator('canvas').count(), reads };
  await page.close();
  return result;
}

await freePort(port);
const server = startServer({ root, scratch, port, python });
try {
  await server.ready;
  const browser = await chromium.launch({
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const captures = [];
    for (const name of ['register', 'review-workspace', 'roofprint-map', 'portal']) {
      captures.push(await capture(browser, name));
    }
    await writeEvidence('docs/evidence/gf5/lv1/lv2-callers.json', {
      captures, inputs: ['Swiss retained floor register/context (unplaced, unknown heights)',
        'NYC Bronx retained context', 'k2c retained roofprint candidate record'],
      limit: 'Isolated actual caller components using retained reads. Unknown Swiss frame/heights remain unknown.',
    });
    if (captures.some((capture) => capture.errors.length)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
} finally {
  await writeFile(`${scratch}/server.log`, server.log(), { flag: 'wx' });
  await stopServer(server.child, port);
}
