// Actual candidate controls, GETs and the acknowledged EV1 region read only. No storing route can pass.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const STUDIO = process.argv[2] ?? 'http://127.0.0.1:5223';
const OUT = `E:/BhuAayam-data/task-data/ev2/candidates-${Date.now()}`;
const BUILDING = 'e8777ffc-9409-4129-bacf-f680160d8795';
const API = 'http://127.0.0.1:3194/api/v1';
const canonical = await (await fetch(`${API}/buildings/${BUILDING}/canonical`)).json();
const register = await (await fetch(`${API}/buildings/${BUILDING}/register`)).json();
const candidate = canonical.candidates.find((item) => item.levelId);
const citation = candidate.citations[0];
const source = register.sources.find((item) => item.id === citation.sourceId);
assert.equal(source.sha256, citation.sourceSha256);
const REGION = /^\/api\/v1\/usp\/packets\/sources\/[^/]+\/pages\/[1-8]\/region$/;
const shots = [];
const reads = [];
const posts = [];
const prevented = [];
const errors = [];

async function guard(context, pinned) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && REGION.test(url.pathname)) {
      posts.push({ path: url.pathname, body: request.postDataJSON() });
      return route.continue();
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      prevented.push({ method: request.method(), path: url.pathname });
      return route.abort();
    }
    if (!pinned && url.pathname === `/api/v1/buildings/${BUILDING}/register` && !url.search) {
      return route.fulfill({ json: { ...register, sources: [] } });
    }
    if (url.pathname === `/api/v1/sources/${source.id}/pages`) {
      reads.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    }
    return route.continue();
  });
}

async function keyboardOpen(page) {
  const button = page.locator('[class*="_inspector_"] section[aria-label="Citations"] button').first();
  for (let count = 0; count < 200; count += 1) {
    await page.keyboard.press('Tab');
    if (await button.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press('Enter');
      return count + 1;
    }
  }
  throw new Error('Tab did not reach the candidate citation.');
}

async function shot(page, name, tabs) {
  const dialog = page.getByRole('dialog');
  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { inside: rect.left >= 0 && rect.right <= innerWidth,
      sideways: element.scrollWidth > element.clientWidth + 1 };
  });
  assert(layout.inside && !layout.sideways);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  shots.push({ file, tabs, text: await dialog.innerText(), ...layout });
}

async function pinnedPreview(page, view, tabs, initialReads, initialPosts) {
  const dialog = page.getByRole('dialog');
  await dialog.getByText('This sheet is too large to show whole', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(reads.length, initialReads + 1);
  const query = reads.at(-1).query;
  assert.equal(query.revision, String(source.revision));
  assert.equal(query.sha256, source.sha256);
  assert.equal(query.offset, String(citation.locator.page - 1));
  assert.equal(posts.length, initialPosts, 'Opening must not acknowledge the region.');
  await shot(page, `live-candidate-page-${view}`, tabs);
  await dialog.getByRole('button', { name: 'Show the cited region', exact: true }).click();
  await dialog.getByText('drawn by the server from the original', { exact: false }).waitFor({ timeout: 40000 });
  assert.equal(posts.length, initialPosts + 1);
  assert.equal(await dialog.locator('svg rect').count(), 1);
  await shot(page, `live-candidate-region-${view}`, tabs);
  await dialog.locator('figcaption').scrollIntoViewIfNeeded();
  await shot(page, `live-candidate-detail-${view}`, tabs);
}

async function unpinnedPreview(page, view, tabs, initialReads, initialPosts) {
  const dialog = page.getByRole('dialog');
  await dialog.getByText("The cited page is not shown because the source's revision", { exact: false }).waitFor();
  await dialog.getByRole('link', { name: 'Open original', exact: true }).waitFor();
  assert.equal(reads.length, initialReads, 'An unpinned candidate must not send a page read.');
  assert.equal(posts.length, initialPosts);
  assert.equal(await dialog.locator('svg image').count(), 0);
  await shot(page, `mocked-candidate-unpinned-${view}`, tabs);
}

async function capture(context, pinned, view) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const selected = encodeURIComponent(candidate.candidateId);
  const path = `/studio/properties/${BUILDING}/candidates?candidate=${selected}`;
  const pinRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/v1/buildings/${BUILDING}/register` &&
    !new URL(response.url()).search);
  await page.goto(`${STUDIO}${path}`);
  const control = page.locator('[class*="_inspector_"] section[aria-label="Citations"] button').first();
  await control.waitFor();
  // Wait for the pin read before pressing, without relying on elapsed time.
  await pinRead;
  const initialPosts = posts.length;
  const initialReads = reads.length;
  const tabs = await keyboardOpen(page);
  const dialog = page.getByRole('dialog');
  if (pinned) await pinnedPreview(page, view, tabs, initialReads, initialPosts);
  else await unpinnedPreview(page, view, tabs, initialReads, initialPosts);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.close();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const pinned of [true, false]) {
    for (const view of ['1440', '200pct']) {
      const zoomed = view === '200pct';
      const context = await browser.newContext({
        viewport: { width: zoomed ? 720 : 1440, height: zoomed ? 500 : 1000 },
        deviceScaleFactor: zoomed ? 2 : 1,
      });
      await guard(context, pinned);
      await capture(context, pinned, view);
      await context.close();
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(posts.length, 2);
  writeFileSync(join(OUT, 'candidates.json'), JSON.stringify({ shots, reads, posts, prevented, errors }, null, 2));
  console.log(`${shots.length} screenshots at ${OUT}; pinned page queries verified; 2 region reads; no stores.`);
} finally {
  await browser.close();
}
