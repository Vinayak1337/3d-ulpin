import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../../../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const routerPath = 'apps/studio/src/app/router.tsx';
const captures = 'E:/BhuAayam-data/task-data/e3b/captures';

async function startVite(endpoint) {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
    '--port', '5297', '--strictPort'], { cwd: 'apps/studio', env: { ...process.env, ULPIN_API_TARGET: endpoint,
    VITE_LOCAL_DATA: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite was not ready in 30 seconds.')), 30000);
    const accept = bytes => {
      output += bytes;
      if (output.includes('5297')) { clearTimeout(timer); resolve(); }
    };
    vite.stdout.on('data', accept);
    vite.stderr.on('data', accept);
    vite.on('exit', () => { clearTimeout(timer); reject(new Error(`Vite exited: ${output.slice(-1000)}`)); });
  });
  try {
    await ready;
  } catch (error) {
    vite.kill();
    throw error;
  }
  return vite;
}

async function keyboardAndZoom(page) {
  const reachable = [];
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press('Tab');
    reachable.push(await page.evaluate(() => ({ tag: document.activeElement.tagName,
      type: document.activeElement.getAttribute('type'), text: document.activeElement.textContent.slice(0, 80),
      outline: getComputedStyle(document.activeElement).outlineWidth })));
  }
  await page.locator('body').evaluate(element => { element.style.zoom = '2'; });
  await page.screenshot({ path: `${captures}/zoom-200.png`, fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.locator('body').evaluate(element => { element.style.zoom = ''; });
  return { reachable, zoom200HorizontalOverflow: overflow, zoomMethod: 'CSS zoom 2, Chromium' };
}

async function readContrast(page) {
  return page.evaluate(() => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255);
      const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const elements = [...document.querySelectorAll('h2, .ul-help, textarea, button.ul-btn--primary')];
    return elements.slice(0, 8).map(element => {
      let parent = element;
      while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)' && parent.parentElement) {
        parent = parent.parentElement;
      }
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(parent).backgroundColor);
      return { element: element.tagName, ratio: Math.round(((Math.max(foreground, background) + 0.05)
        / (Math.min(foreground, background) + 0.05)) * 100) / 100 };
    });
  });
}

async function pressAndWatch(page) {
  const checkboxes = page.locator('input[type=checkbox]:enabled');
  for (let index = 0; index < 3; index++) {
    await checkboxes.nth(index).focus();
    await page.keyboard.press('Space');
  }
  const acknowledgement = page.getByLabel('Your acknowledgement');
  assert.equal(await acknowledgement.inputValue(), '');
  await acknowledgement.fill('Record the cited publisher exteriors and make cards for these three buildings. '
    + 'Heights, floors, units and rights remain unknown.');
  await acknowledgement.focus();
  await page.keyboard.press('Tab');
  const pressReachedByTab = await page.evaluate(() => document.activeElement.textContent);
  assert.match(pressReachedByTab, /Record packages and make chosen cards/);
  await page.screenshot({ path: `${captures}/before-press.png`, fullPage: false });
  let presses = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && /\/confirmations$/.test(new URL(request.url()).pathname)) presses++;
  });
  const pressed = performance.now();
  await page.getByRole('button', { name: 'Record packages and make chosen cards' }).click();
  await page.getByText(/1661 recorded · [1-3] carded/).waitFor({ timeout: 60000 });
  const firstObservedCount = await page.getByText(/1661 recorded · [1-3] carded/).textContent();
  const firstCardMs = Math.round(performance.now() - pressed);
  await page.screenshot({ path: `${captures}/first-card.png`, fullPage: false });
  await page.getByText(/1661 recorded · 3 carded · 0 stopped/).waitFor({ timeout: 60000 });
  const thirdCardMs = Math.round(performance.now() - pressed);
  assert.equal(presses, 1);
  return { firstCardMs, thirdCardMs, firstObservedCount, confirmationPosts: presses, pressReachedByTab };
}

async function openCards(page, browser, endpoint) {
  const progress = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Confirmed / }) });
  await progress.locator('summary').first().click();
  const link = progress.getByRole('link', { name: 'Open card PDF' }).first();
  const path = await link.getAttribute('href');
  const popup = page.waitForEvent('popup');
  await link.click();
  const pdf = await popup;
  const response = await browser.request.get(`${endpoint}${path}`);
  assert.equal(response.status(), 200);
  assert.match(response.headers()['content-type'], /pdf/);
  const pdfBytes = (await response.body()).length;
  await pdf.close();
  await progress.getByRole('link', { name: 'Verification', exact: true }).first().click();
  await page.getByText('Consistent', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${captures}/verification.png`, fullPage: false });
  await page.goto('http://127.0.0.1:5297/e3b-walk');
  await page.getByText(/1661 recorded · 3 carded · 0 stopped/).waitFor({ timeout: 30000 });
  await page.reload();
  await page.getByText(/1661 recorded · 3 carded · 0 stopped/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${captures}/reload.png`, fullPage: false });
  return { pdfBytes, verificationOpened: true, reloadRecovered: true };
}

export async function browserWalk(caseId, endpoint) {
  const original = readFileSync(routerPath);
  const panelImport = "import { IntakeRunPanel } from '../features/intake/run';\n";
  const route = `\n  { path: '/e3b-walk', element: <IntakeRunPanel caseId="${caseId}" /> },`;
  const patched = original.toString().replace('import { VerifyPage }', panelImport + 'import { VerifyPage }')
    .replace('export const router = createBrowserRouter([', 'export const router = createBrowserRouter([' + route);
  writeFileSync(routerPath, patched);
  mkdirSync(captures, { recursive: true });
  let vite;
  let browser;
  try {
    vite = await startVite(endpoint);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__e3bStream = { targets: 0, ready: 0, resync: 0, errors: 0 };
      const NativeSource = window.EventSource;
      window.EventSource = class extends NativeSource {
        constructor(url, options) {
          super(url, options);
          this.addEventListener('ingestion.change', event => {
            if (JSON.parse(event.data).change?.kind === 'intake.target') window.__e3bStream.targets++;
          });
          for (const kind of ['ready', 'resync']) this.addEventListener(kind, () => window.__e3bStream[kind]++);
          this.addEventListener('error', () => window.__e3bStream.errors++);
        }
      };
    });
    const errors = [];
    const refused = [];
    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('/ingestion/')) {
        refused.push({ path: new URL(response.url()).pathname, status: response.status() });
      }
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5297/e3b-walk');
    await page.getByText('1661 ready to record', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.locator('input[type=checkbox]:enabled').first().waitFor();
    const accessibility = await keyboardAndZoom(page);
    accessibility.contrast = await readContrast(page);
    const timing = await pressAndWatch(page);
    const stream = await page.evaluate(() => window.__e3bStream);
    const opened = await openCards(page, context, endpoint);
    assert.deepEqual(errors, []);
    return { caseId, timing, opened, accessibility, stream, refused, pageErrors: errors, captures };
  } finally {
    if (browser) await browser.close();
    if (vite) {
      vite.kill();
      await new Promise(resolve => vite.on('exit', resolve));
    }
    writeFileSync(routerPath, original);
  }
}
