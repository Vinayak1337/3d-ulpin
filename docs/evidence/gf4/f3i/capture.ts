import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, type Page, type Route } from '@playwright/test';
import {
  UspListPropertyCardsSchema, UspPreviewPropertyCardSchema, UspPropertyCardListSchema,
  UspPropertyCardPreviewSchema, UspPropertyCardViewSchema, UspReadPropertyCardSchema,
} from '../../../../packages/contracts/src/usp/property-card';

const out = import.meta.dirname;
const studio = 'http://127.0.0.1:5231';
const recorded = JSON.parse(readFileSync(resolve(out, '../../gf5/f3d/responses.json'), 'utf8'));
const stored = JSON.parse(readFileSync(
  'E:/BhuAayam-data/task-data/r3/step3/10-card-read-response.json', 'utf8',
)).body;
const card = stored.data.card;
const requests: { route: string; body: unknown; mock: boolean }[] = [];
const refused: string[] = [];
const pageErrors: string[] = [];
const views = [
  { name: '1440', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: '200pct', viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 },
];

async function actualRead(route: Route, schema: { parse: (body: unknown) => unknown }) {
  const answer = await route.fetch();
  assert.equal(answer.status(), 200);
  schema.parse((await answer.json()).data);
  return route.fulfill({ response: answer });
}

async function guard(route: Route) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  if (method === 'GET') return route.continue();
  const body = request.postDataJSON();
  const mocked = path === '/api/v1/usp/property-cards/read';
  requests.push({ route: path, body, mock: mocked });
  if (method === 'POST' && path === '/api/v1/usp/property-cards/list') {
    UspListPropertyCardsSchema.parse(body);
    return actualRead(route, UspPropertyCardListSchema);
  }
  if (method === 'POST' && path === '/api/v1/usp/property-cards/read') {
    const parsed = UspReadPropertyCardSchema.safeParse(body);
    if (!parsed.success) return route.fulfill({ status: 400, json: { error: 'Strict read refused the body.' } });
    assert.equal(body.cardId, card.cardId);
    assert.equal(body.revision, card.revision);
    UspPropertyCardViewSchema.parse(stored.data);
    return route.fulfill({ json: stored });
  }
  if (method === 'POST' && path === '/api/v1/usp/property-cards/preview') {
    UspPreviewPropertyCardSchema.parse(body);
    // Ask this read-only route for its actual rows, not a made-up revision or facts.
    return actualRead(route, UspPropertyCardPreviewSchema);
  }
  refused.push(`${method} ${path}`);
  return route.abort();
}

async function mockLabel(page: Page) {
  await page.evaluate(() => {
    const tag = document.createElement('div');
    tag.textContent = 'Mocked card read · actual preview read · no card stored';
    tag.setAttribute('id', 'mock-note');
    Object.assign(tag.style, { position: 'fixed', bottom: '8px', left: '16px', zIndex: '9999',
      background: 'var(--ui-surface)', color: 'var(--ui-ink)', padding: '8px' });
    document.body.append(tag);
  });
}

async function prepare(page: Page, name: string) {
  const action = page.getByRole('button', { name: 'Issue new revision', exact: true });
  await expect(action).toBeVisible();
  await mockLabel(page);
  await page.screenshot({ path: resolve(out, `mocked-${name}-listed.png`) });
  await page.locator('#mock-note').evaluate((node) => node.remove());
  await action.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const expiry = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(expiry.getTime() + 330 * 60 * 1000).toISOString().slice(0, 16);
  await dialog.getByLabel('Valid until', { exact: false }).fill(local);
  await dialog.getByRole('button', { name: 'Prepare', exact: true }).click();
  await expect(dialog.getByText('Mode', { exact: true })).toBeVisible();
  await mockLabel(page);
  await page.screenshot({ path: resolve(out, `mocked-${name}-prepared.png`) });
}

async function measure(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  const layout = await dialog.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll('footer button')].map((item) => item.getBoundingClientRect());
    const body = node.querySelector('.ul-dialog__body')!;
    return { overflow: body.scrollWidth - body.clientWidth,
      footerWhole: buttons.every((rect) => rect.left >= box.left && rect.right <= box.right
        && rect.top >= box.top && rect.bottom <= box.bottom) };
  });
  assert.equal(layout.overflow, 0);
  assert.equal(layout.footerWhole, true);
  await dialog.locator('.ul-dialog__body').evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.screenshot({ path: resolve(out, `mocked-${name}-rows.png`) });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  return layout;
}

async function capture(browser: Awaited<ReturnType<typeof chromium.launch>>, view: typeof views[number]) {
  const context = await browser.newContext({ ...view, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
  await context.route('**/api/**', guard);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${studio}/studio/properties/${recorded.buildingId}/candidates#unit-${recorded.spaceId}`);
  await prepare(page, view.name);
  const layout = await measure(page, view.name);
  await context.close();
  return { view: view.name, layout, keyboard: 'Enter opens; Escape closes; no issue action clicked' };
}

const browser = await chromium.launch();
try {
  const captures = [];
  for (const view of views) captures.push(await capture(browser, view));
  assert.deepEqual(refused, []);
  assert.deepEqual(pageErrors, []);
  const result = {
    captures, refused, pageErrors, storingRequestsSent: 0,
    cardListReads: requests.filter((request) => request.route.endsWith('/list')).length,
    revisionReads: requests.filter((request) => request.route.endsWith('/read')),
    previews: requests.filter((request) => request.route.endsWith('/preview')),
    contracts: 'List, stored view and preview response data parsed by their original response schemas.',
  };
  writeFileSync(resolve(out, 'browser-result.json'), `${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
