// Step 0.3: is the 90-column table usable? Keyboard order, shared-reason count, sticky headers, 200% zoom.
// Live reads only; every non-GET is blocked. Nothing is typed into a field or recorded.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const out = import.meta.dirname;
const studio = process.env.STUDIO ?? 'http://127.0.0.1:5188';
const url = `${studio}/studio/work/cases/1ada7796-4e8f-4a19-9b7f-4414e80114c4/tables/` +
  'd6dffbcc-7ee0-4467-9ddf-4952bd23c33c?rawJobId=f186791c-b5e6-4c21-ade2-208ba89c0c3f' +
  '&mappingJobId=4b48f457-2671-4937-a973-f040b5fc20d5';
const blockedWrites = [];
const screenshots = [];

async function guardWrites(route) {
  const request = route.request();
  if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
  blockedWrites.push({ method: request.method(), path: new URL(request.url()).pathname });
  return route.abort('blockedbyclient');
}

const describeFocus = () => {
  const node = document.activeElement;
  const name = node.getAttribute('aria-label') || node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
  return `${node.tagName.toLowerCase()}${node.getAttribute('role') ? `[${node.getAttribute('role')}]` : ''}: ${name}`;
};

/** The focus order from the top of the page until the answer button, capped. */
async function tabOrder(page) {
  await page.goto(url);
  await page.getByRole('table', { name: 'Column mapping candidates' }).locator('tbody tr').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll(
    'section[aria-label="Column mapping candidates"] tbody .ul-badge').length === 90);
  const order = [];
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(describeFocus));
    if (order.at(-1).includes('Answer mapping questions')) break;
  }
  return order;
}

async function stickyHeader(page, selector) {
  return page.evaluate((query) => {
    const box = document.querySelector(query);
    box.scrollTop = 600;
    const head = box.querySelector('thead th').getBoundingClientRect().top;
    return { scrolled: box.scrollTop, headerTopMinusBoxTop: Math.round(head - box.getBoundingClientRect().top),
      position: getComputedStyle(box.querySelector('thead th')).position };
  }, selector);
}

async function formChecks(page) {
  await page.getByRole('button', { name: 'Answer mapping questions', exact: true }).click();
  const status = page.getByRole('status').filter({ hasText: 'Columns this will change' });
  await status.waitFor();
  const submit = page.getByRole('button', { name: 'Record the mapping', exact: true });
  const mark = page.getByRole('button', { name: 'Mark every unanswered column as Unknown field', exact: true });
  const count = await page.getByRole('combobox', { name: /^Target for column/ }).count();
  await status.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, '04-live-schemes-shared-reason.png'), animations: 'disabled' });
  screenshots.push({ file: '04-live-schemes-shared-reason.png', mode: 'live',
    notes: 'The shared-reason control states the number of columns it will change.' });
  const sticky = await stickyHeader(page, '[aria-label^="Column answers"]');
  return { sharedReasonText: (await status.innerText()).split('.')[0], answerRows: count,
    submitDisabled: await submit.isDisabled(), markDisabled: await mark.isDisabled(), answersSticky: sticky };
}

/** CSS 200%: the same page in a 720 px wide viewport at twice the device scale. */
async function zoomed(page, browser) {
  const context = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  const view = await context.newPage();
  await view.route('**/api/**', guardWrites);
  await view.goto(url);
  await view.getByRole('table', { name: 'Column mapping candidates' }).locator('tbody tr').first().waitFor();
  await view.getByRole('button', { name: 'Answer mapping questions', exact: true }).click();
  await view.getByRole('status').filter({ hasText: 'Columns this will change' }).waitFor();
  const overflow = await view.evaluate(() => {
    const main = document.querySelector('h1').closest('div');
    const clipped = [...document.querySelectorAll('h1, h2, button, label, .ul-help, .ul-caption')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
    }).map((node) => node.textContent.trim().slice(0, 40));
    return { pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1,
      mainScrollsSideways: main.scrollWidth > main.clientWidth + 1, clippedControls: clipped };
  });
  await view.getByRole('button', { name: 'Mark every unanswered column as Unknown field', exact: true })
    .scrollIntoViewIfNeeded();
  await view.screenshot({ path: resolve(out, '06-live-schemes-zoom-200.png'), animations: 'disabled' });
  screenshots.push({ file: '06-live-schemes-zoom-200.png', mode: 'live', notes: '720 px viewport at device scale 2.' });
  await context.close();
  return overflow;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route('**/api/**', guardWrites);
  const order = await tabOrder(page);
  const columnsSticky = await stickyHeader(page, '[aria-label^="Column mapping table"]');
  const form = await formChecks(page);
  const zoom = await zoomed(page, browser);
  assert.deepEqual(blockedWrites, []);
  const result = { blockedWrites, order, columnsSticky, form, zoom, screenshots };
  writeFileSync(resolve(out, 'live-usability.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
} finally {
  await browser.close();
}
