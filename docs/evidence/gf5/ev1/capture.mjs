// EV1: actual register clicks for caption/label; page-only at the viewer boundary with real server pins.
// Start Studio on 5199 against 3194. Run with `before` on staging's viewer or `after` on EV1's viewer.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHASE = process.argv[2] ?? 'after';
assert(['before', 'after'].includes(PHASE));
const STUDIO = 'http://127.0.0.1:5199';
const BUILDING = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const URL = `${STUDIO}/studio/properties/${BUILDING}/register`;
const REGION_ROUTE = /^\/api\/v1\/usp\/packets\/sources\/[^/]+\/pages\/[1-8]\/region$/;
const posts = [];
const prevented = [];
const failures = [];
const shots = [];
const answers = [];

function observeAnswers(page) {
  page.on('response', (response) => {
    if (!REGION_ROUTE.test(new globalThis.URL(response.url()).pathname)) return;
    const headers = response.headers();
    const encoded = headers['x-region-provenance'];
    const provenance = encoded ? JSON.parse(Buffer.from(encoded, 'base64url').toString()) : null;
    answers.push({ status: response.status(), type: headers['content-type'],
      sha256: headers['x-region-sha256'], bytes: provenance?.output.bytes,
      pixels: provenance?.output.pixels, pixelToDisplay: provenance?.transform.pixelToDisplay });
  });
}

async function guard(context) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new globalThis.URL(request.url()).pathname;
    if (['GET', 'HEAD'].includes(method)) return route.continue();
    if (method === 'POST' && REGION_ROUTE.test(path)) {
      posts.push({ path, body: request.postDataJSON() });
      return route.continue();
    }
    prevented.push({ method, path });
    return route.abort();
  });
}

async function pageOnlyAtViewerBoundary(page) {
  await page.evaluate(async ({ building, phase }) => {
    const [canonical, register] = await Promise.all([
      fetch(`/api/v1/buildings/${building}/canonical`).then((response) => response.json()),
      fetch(`/api/v1/buildings/${building}/register`).then((response) => response.json()),
    ]);
    const citation = canonical.name.citations[0];
    const source = register.sources.find((item) => item.id === citation.sourceId);
    if (!source || citation.locator.kind !== 'page') throw new Error('Real page-only citation not available.');
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const dependency = (file) => resources.find((url) => url.includes(`/deps/${file}?`));
    const [react, dom, query, viewer] = await Promise.all([
      import(dependency('react.js')), import(dependency('react-dom_client.js')),
      import(dependency('@tanstack_react-query.js')),
      import(phase === 'before' ? '/src/features/evidence/CitedPageViewer.tsx' :
        '/src/features/evidence/EvidenceViewer.tsx'),
    ]);
    const client = new query.QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['buildings', building, 'register'], register);
    const host = document.createElement('div');
    document.body.append(host);
    const root = (dom.default ?? dom).createRoot(host);
    const React = react.default ?? react;
    const place = { kind: 'page', page: citation.locator.page, text: citation.locator.text };
    const evidence = { sourceId: source.id, label: source.name, locator: place };
    const props = { evidence, onClose: () => root.unmount() };
    if (phase === 'before') {
      props.place = place;
      props.pin = { revision: source.revision, sha256: source.sha256 };
      props.openFile = () => root.unmount();
    } else {
      props.still = null;
    }
    const Viewer = phase === 'before' ? viewer.CitedPageViewer : viewer.EvidenceViewer;
    root.render(React.createElement(query.QueryClientProvider, { client }, React.createElement(Viewer, props)));
  }, { building: BUILDING, phase: PHASE });
}

async function keyboardShow(page) {
  const button = page.getByRole('button', { name: 'Show the cited region', exact: true });
  for (let count = 0; count < 12; count += 1) {
    await page.keyboard.press('Tab');
    if (await button.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press('Enter');
      return;
    }
  }
  throw new Error('Keyboard did not reach Show the cited region.');
}

async function recordShot(page, name, view) {
  const dialog = page.getByRole('dialog');
  const text = await dialog.innerText();
  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { insideViewport: rect.left >= 0 && rect.right <= innerWidth,
      scrollsSideways: element.scrollWidth > element.clientWidth + 1 };
  });
  assert(layout.insideViewport && !layout.scrollsSideways, 'Dialog overflows at this zoom.');
  if (PHASE === 'after') {
    assert(text.includes('This sheet is too large to show whole'));
    assert(!text.includes('cannot render') && !text.includes('has no raster'));
  }
  const file = `${name}-${view}.png`;
  await page.screenshot({ path: join(HERE, PHASE, file) });
  shots.push({ file, text: text.split('\n').flatMap(wrapWords), ...layout });
}

function wrapWords(text) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line.length + word.length > 100) {
      lines.push(line);
      line = '';
    }
    line += `${line ? ' ' : ''}${word}`;
  }
  lines.push(line);
  return lines;
}

async function trackObjectURLs(page) {
  await page.addInitScript(() => {
    const create = globalThis.URL.createObjectURL.bind(globalThis.URL);
    const revoke = globalThis.URL.revokeObjectURL.bind(globalThis.URL);
    window.regionURLs = { created: [], revoked: [] };
    globalThis.URL.createObjectURL = (blob) => {
      const href = create(blob);
      window.regionURLs.created.push(href);
      return href;
    };
    globalThis.URL.revokeObjectURL = (href) => {
      window.regionURLs.revoked.push(href);
      revoke(href);
    };
  });
}

async function waitForPreview(page, name, initialPosts) {
  const dialog = page.getByRole('dialog');
  if (PHASE === 'before') {
    await dialog.getByText('The server cannot render this page', { exact: true }).waitFor();
    return;
  }
  await dialog.getByText('This sheet is too large to show whole', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(posts.length, initialPosts, 'Opening a citation must not acknowledge a selection.');
  if (name === 'page-only') {
    await dialog.getByText('This citation names the page, not a region.', { exact: false }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Show the cited region' }).count(), 0);
    return;
  }
  await keyboardShow(page);
  await dialog.getByText('The cited region is shown on its own.', { exact: false }).waitFor({ timeout: 40000 });
  assert.equal(posts.length, initialPosts + 1);
  assert.equal(await dialog.locator('svg image[href^="blob:"]').count(), 1);
  assert.equal(await dialog.locator('svg rect').count(), 1);
}

async function capture(context, name, index, view) {
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  observeAnswers(page);
  await trackObjectURLs(page);
  await page.goto(URL);
  await page.locator('main [class*="_citation_"] button').first().waitFor();
  const initialPosts = posts.length;
  if (name === 'page-only') {
    await pageOnlyAtViewerBoundary(page);
  } else {
    await page.locator('main [class*="_citation_"] button').nth(index).click();
  }
  await waitForPreview(page, name, initialPosts);
  const dialog = page.getByRole('dialog');
  await recordShot(page, name, view);
  if (PHASE === 'after' && name !== 'page-only' && view === '200pct') {
    await dialog.locator('figcaption').scrollIntoViewIfNeeded();
    await recordShot(page, `${name}-detail`, view);
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  if (PHASE === 'after' && name !== 'page-only') {
    const urls = await page.evaluate(() => window.regionURLs);
    assert.equal(urls.created.length, 1);
    assert.deepEqual(urls.created, urls.revoked, 'Closing must revoke the region object URL.');
  }
  await page.close();
}

function summariseRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    const key = JSON.stringify(row);
    const existing = unique.get(key);
    if (existing) existing.count += 1;
    else unique.set(key, { ...row, count: 1 });
  }
  return [...unique.values()];
}

// Keep evidence compact without truncating sentences or putting any line over the review ceiling.
function evidenceJson(value, indent = '', lead = indent.length) {
  const compact = JSON.stringify(value);
  if (lead + compact.length <= 120) return compact;
  const childIndent = `${indent}  `;
  if (Array.isArray(value)) {
    const rows = value.map((item) => childIndent + evidenceJson(item, childIndent));
    return `[\n${rows.join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const rows = Object.entries(value).map(([key, item]) => {
      const prefix = `${childIndent}${JSON.stringify(key)}: `;
      return prefix + evidenceJson(item, childIndent, prefix.length);
    });
    return `{\n${rows.join(',\n')}\n${indent}}`;
  }
  throw new Error('Evidence contains an overlong scalar.');
}

mkdirSync(join(HERE, PHASE), { recursive: true });
const browser = await chromium.launch();
try {
  for (const view of ['1440', '200pct']) {
    // Same 1440 physical-pixel display: 720 CSS pixels and DPR 2 emulate desktop 200% zoom.
    const zoomed = view === '200pct';
    const context = await browser.newContext({
      viewport: { width: zoomed ? 720 : 1440, height: zoomed ? 500 : 1000 },
      deviceScaleFactor: zoomed ? 2 : 1,
    });
    await guard(context);
    await capture(context, 'caption', 0, view);
    await capture(context, 'label', 1, view);
    await capture(context, 'page-only', 0, view);
    await context.close();
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  assert.equal(posts.length, PHASE === 'after' ? 4 : 0);
  const evidence = { shots, postCount: posts.length, posts: summariseRows(posts),
    answers: summariseRows(answers), prevented: summariseRows(prevented), failures };
  writeFileSync(join(HERE, `${PHASE}.json`), `${evidenceJson(evidence)}\n`);
  console.log(`${PHASE}: ${shots.length} screens, ${posts.length} region POST reads, no other POST sent.`);
} finally {
  await browser.close();
}
