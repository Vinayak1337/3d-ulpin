// Citation viewer checks: the cited page and region, refusals, and the live 503 state. Page reads are
// intercepted from contract-valid bodies except in liveRuntimeUnavailable, which reads the demo runtime.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';

const FRAME = { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 2586, height: 1694 };
const UNAVAILABLE = 'Page preview is not available on this runtime';
const CHANGED = 'The original changed after this was cited';

/** A contract-valid page listing for the cited original; overrides change the response or its one page. */
function pagesBody(env, overrides = {}, pageOverrides = {}) {
  const { cited } = env;
  const raster = `/api/v1/sources/${cited.sourceId}/pages/1/raster?revision=${cited.sourceRevision}` +
    `&sha256=${cited.sourceSha256}`;
  const entry = { page: 1, label: 'Page 1', sourceLabel: null, frame: FRAME, mediaBox: [0, 0, 2586, 1694],
    cropBox: [0, 0, 2586, 1694], boxConvention: 'pymupdf_page_rectangles/1', renderSupport: 'supported',
    url: raster, locator: { kind: 'pdf_page', page: 1 }, calibration: null, ...pageOverrides };
  return env.checked(env.schema, { version: 'document-pages/1', sourceId: cited.sourceId, caseId: randomUUID(),
    caseRevision: 1, sourceRevision: cited.sourceRevision, sourceSha256: cited.sourceSha256, sourceBytes: 1024,
    name: 'intercepted-test-plan.pdf', revision: String(cited.sourceRevision), pageCount: 1, offset: 0, limit: 1,
    hasMore: false, pages: [entry], anchors: [{ locator: 'page:1', page: 1, region: null }], ...overrides });
}

/** A plain test page, clearly not a plan: the viewer is checked against the contract, not against a drawing. */
async function testRaster(page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1293;
    canvas.height = 847;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#c9ced6';
    for (let step = 0; step < canvas.width; step += 129) context.strokeRect(step, 0, 1, canvas.height);
    context.fillStyle = '#6b7380';
    context.font = '28px sans-serif';
    context.fillText('Intercepted test raster · not a real page', 40, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(encoded, 'base64');
}

function pageRoutes(env, png, body, refusal = null) {
  return (route, url, path) => {
    env.pageRequests.push(url);
    if (refusal) return route.fulfill(refusal);
    if (path.endsWith('/raster')) return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    return route.fulfill({ json: body });
  };
}

async function openCitation(env, page) {
  env.setCanonical();
  await page.goto(`${env.studio}/studio/properties/${env.building}/candidates`);
  const panel = page.locator('section', {
    has: page.getByRole('heading', { name: 'Recorded floors and units', exact: true }) });
  const chips = panel.getByTitle(/^Open evidence/);
  await expect(chips).toHaveCount(2);
  await chips.nth(1).click();
  const dialog = page.getByRole('dialog', { name: 'UNIT-3B · p.1' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function regionViewer(env, page, png) {
  const { cited } = env;
  env.setPageReads(pageRoutes(env, png, pagesBody(env)));
  env.pageRequests.length = 0;
  const dialog = await openCitation(env, page);
  const words = dialog.locator('dl');
  await expect(words).toContainText('Page 1 · region at x 206.88, y 254.25 · 1034.4 wide × 305.1 high · unit pt');
  await expect(words).toContainText(`${cited.sourceId} · revision ${cited.sourceRevision}`);
  const view = dialog.getByRole('img', { name: /cited region outlined/ });
  await expect(view).toBeVisible();
  assert.equal(await view.getAttribute('viewBox'), '0 0 2586 1694');
  const box = await view.locator('rect').evaluate((node) => ['x', 'y', 'width', 'height']
    .map((name) => Number(node.getAttribute(name))));
  assert.deepEqual(box, [206.88, 254.25, 1034.4, 305.1]);
  await expect(dialog).toContainText('the citation names the unit, not the frame');
  const query = new URL(env.pageRequests.find((url) => url.includes('/pages?'))).searchParams;
  assert.deepEqual([query.get('sha256'), query.get('revision'), query.get('offset'), query.get('limit')],
    [cited.sourceSha256, String(cited.sourceRevision), '0', '1']);
  assert.ok(env.pageRequests.some((url) => url.includes('/raster?')));
  await env.capture(page, '11-viewer-region.png', 'Intercepted page reads and canonical response · no live writes',
    'The cited page with its region outlined, the page and region in words, the pins on both page reads.');
  await page.keyboard.press('Escape');
  return { box, viewBox: '0 0 2586 1694', query: { sha256: cited.sourceSha256, revision: cited.sourceRevision,
    offset: 0, limit: 1 } };
}

async function refusedViewer(env, page, reads, heading, fileView) {
  env.setPageReads(reads);
  const dialog = await openCitation(env, page);
  await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveCount(0);
  const offered = await dialog.getByRole('button', { name: 'Open the file view', exact: true }).count();
  assert.equal(offered, fileView ? 1 : 0, `${heading}: file view offered`);
  await page.keyboard.press('Escape');
  return { heading, fileViewOffered: offered === 1 };
}

async function refusals(env, page, png) {
  const stale = { status: 409, json: { error: { code: 'DOCUMENT_SOURCE_STALE', requestId: randomUUID(),
    message: 'The retained original is not the pinned revision.' } } };
  const otherHash = pagesBody(env, { sourceSha256: 'b'.repeat(64) });
  const unsupported = pagesBody(env, {}, { renderSupport: 'unsupported', url: null });
  return {
    serverRefusal409: await refusedViewer(env, page, pageRoutes(env, png, null, stale), CHANGED, false),
    otherHash: await refusedViewer(env, page, pageRoutes(env, png, otherHash), CHANGED, false),
    unsupported: await refusedViewer(env, page, pageRoutes(env, png, unsupported),
      'The server cannot render this page', true),
  };
}

/** Page reads go to the live demo runtime, which answers 503 until the PDF runtime is configured. */
async function liveRuntimeUnavailable(env, page) {
  env.setPageReads(null);
  const dialog = await openCitation(env, page);
  await expect(dialog.getByRole('heading', { name: UNAVAILABLE, exact: true })).toBeVisible();
  await expect(dialog).toContainText('DOCUMENT_PAGES_RUNTIME_UNAVAILABLE');
  await expect(dialog.locator('dl')).toContainText('Page 1 · region at x 206.88');
  await expect(dialog.locator('dl')).toContainText(env.cited.sourceId);
  await env.capture(page, '07-live-viewer-503.png', 'Intercepted canonical response · page reads live',
    'The live demo runtime answers 503 DOCUMENT_PAGES_RUNTIME_UNAVAILABLE: stated, with page, region and source.');
  await dialog.getByRole('button', { name: 'Open the file view', exact: true }).click();
  const fileView = page.getByRole('dialog');
  await expect(fileView.getByText('This original is not a text file')).toBeVisible();
  await expect(fileView.getByRole('link', { name: 'Open original' })).toBeVisible();
  const fileName = await fileView.getByRole('heading').first().innerText();
  await env.capture(page, '12-live-file-view-pdf.png', 'Intercepted canonical response · source file read live',
    'The existing file view on the live PDF original: it states the file is not text instead of printing bytes.');
  await page.keyboard.press('Escape');
  return { heading: UNAVAILABLE, code: 'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE', fileViewOpens: true, fileName };
}

export async function checkViewer(env, page) {
  const png = await testRaster(page);
  const region = await regionViewer(env, page, png);
  const refused = await refusals(env, page, png);
  const runtime = await liveRuntimeUnavailable(env, page);
  return { region, refused, runtime };
}
