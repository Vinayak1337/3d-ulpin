// Read-only EV2 capture. Whole-sheet mocks use K9e's real listing and PNG; region answers stay live.
// All screenshots and sheet text stay outside Git. Start Studio against demo 3194 on the port below.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const STUDIO = process.argv[2] ?? 'http://127.0.0.1:5223';
const OUT = `E:/BhuAayam-data/task-data/ev2/capture-${Date.now()}`;
const PRODUCT = JSON.parse(readFileSync(
  'E:/BhuAayam-data/task-data/k9e/product-entry/product-entry-1791653024579.json', 'utf8'));
const SOURCE = new URL(PRODUCT.listing.page.url, STUDIO).pathname.split('/')[4];
const BUILDING = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const REGION = /^\/api\/v1\/usp\/packets\/sources\/[^/]+\/pages\/[1-8]\/region$/;
const posts = [];
const prevented = [];
const answers = [];
const shots = [];
const errors = [];

async function guard(context, mocked) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && REGION.test(path)) {
      posts.push({ path, body: request.postDataJSON() });
      return route.continue();
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      prevented.push({ method: request.method(), path });
      return route.abort();
    }
    if (mocked && path === `/api/v1/sources/${SOURCE}/pages`) {
      const response = await route.fetch();
      const listing = await response.json();
      assert.equal(listing.sourceSha256, PRODUCT.sourceSha256);
      return route.fulfill({ json: { ...listing, pages: [PRODUCT.listing.page] } });
    }
    if (mocked && path === new URL(PRODUCT.listing.page.url, STUDIO).pathname) {
      return route.fulfill({ contentType: 'image/png', body: readFileSync(PRODUCT.picture.kept) });
    }
    return route.continue();
  });
}

async function shot(page, name) {
  const dialog = page.getByRole('dialog');
  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { inside: rect.left >= 0 && rect.right <= innerWidth,
      sideways: element.scrollWidth > element.clientWidth + 1 };
  });
  assert(layout.inside && !layout.sideways, 'Dialog must fit at this zoom.');
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  shots.push({ file, ...layout, text: await dialog.innerText() });
}

async function pressRegion(page) {
  const button = page.getByRole('button', { name: 'Show the cited region', exact: true });
  for (let count = 0; count < 12; count += 1) {
    await page.keyboard.press('Tab');
    if (await button.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press('Enter');
      return;
    }
  }
  throw new Error('Tab did not reach the region action.');
}

async function wholeSheet(page, mocked, prefix, view) {
  const dialog = page.getByRole('dialog');
  if (mocked) {
    await dialog.getByText('Small text is not readable at this scale.', { exact: false }).waitFor();
    assert.equal(await dialog.locator('svg image').count(), 1);
    const placement = await dialog.locator('svg').first().evaluate((element) => ({
      viewBox: element.getAttribute('viewBox'),
      width: element.querySelector('image').getAttribute('width'),
      height: element.querySelector('image').getAttribute('height'),
      outline: Boolean(element.querySelector('rect')),
    }));
    assert.deepEqual(placement, { viewBox: '0 0 2586 1695', width: '2586', height: '1695', outline: true });
    await shot(page, `${prefix}-whole-${view}`);
    await dialog.locator('section[aria-label="Reduced sheet preview"]').scrollIntoViewIfNeeded();
    await shot(page, `${prefix}-statement-${view}`);
  } else {
    await dialog.getByText('This sheet is too large to show whole', { exact: true }).waitFor();
    assert.equal(await dialog.locator('svg image').count(), 0);
  }
}

async function capture(context, mocked, view) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (!REGION.test(new URL(response.url()).pathname)) return;
    const encoded = response.headers()['x-region-provenance'];
    answers.push({ status: response.status(), provenance: encoded ?
      JSON.parse(Buffer.from(encoded, 'base64url').toString()) : null });
  });
  await page.goto(`${STUDIO}/studio/properties/${BUILDING}/register`);
  const initial = posts.length;
  await page.locator('main [class*="_citation_"] button').first().click();
  const dialog = page.getByRole('dialog');
  const prefix = mocked ? 'mocked-reduced' : 'live-unsupported';
  await wholeSheet(page, mocked, prefix, view);
  assert.equal(posts.length, initial, 'Opening is not acknowledgement.');
  await pressRegion(page);
  await dialog.getByText('drawn by the server from the original', { exact: false }).waitFor({ timeout: 40000 });
  assert.equal(posts.length, initial + 1);
  assert.equal(await dialog.locator('svg image').count(), mocked ? 2 : 1);
  if (mocked) {
    const order = await dialog.locator('figure').evaluateAll((figures) =>
      figures.map((figure) => Boolean(figure.textContent.includes('drawn by the server'))));
    assert.deepEqual(order, [false, true], 'Region must follow the whole sheet.');
  }
  await shot(page, `${prefix}-region-${view}`);
  await dialog.locator('figcaption').last().scrollIntoViewIfNeeded();
  await shot(page, `${prefix}-detail-${view}`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.close();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const mocked of [true, false]) {
    for (const view of ['1440', '200pct']) {
      const zoomed = view === '200pct';
      const context = await browser.newContext({
        viewport: { width: zoomed ? 720 : 1440, height: zoomed ? 500 : 1000 },
        deviceScaleFactor: zoomed ? 2 : 1,
      });
      await guard(context, mocked);
      await capture(context, mocked, view);
      await context.close();
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(posts.length, 4);
  assert.equal(answers.length, 4);
  assert(answers.every((answer) => answer.status === 200));
  writeFileSync(join(OUT, 'capture.json'), JSON.stringify({ shots, posts, prevented, answers, errors }, null, 2));
  console.log(`${shots.length} screenshots at ${OUT}; 4 region POST reads; no storing request sent.`);
} finally {
  await browser.close();
}
