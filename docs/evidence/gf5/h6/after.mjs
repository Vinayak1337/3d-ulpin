// H6 part 2: the four screens the fixes change, read again at 1440 wide and at 200% zoom, read-only.
//   node docs/evidence/gf5/h6/after.mjs
// Writes after/*.png and after.json beside this file. The request guard is the one of capture.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = 'http://127.0.0.1:5199';
const CARD_READS = ['/usp/identity/resolve', '/usp/property-cards/list'];
const TOWER3 = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
const VIEWS = [
  { name: '1440', width: 1440, height: 900, scale: 1 },
  { name: '200pct', width: 640, height: 360, scale: 2 },
];
const TAB_BODY = '[class*="_tabBody_"]';
const SCREENS = [
  { name: 'magnolia-units', path: `/studio/properties/${MAGNOLIA}/register`, read: TAB_BODY },
  { name: 'tower3-header', path: `/studio/properties/${TOWER3}/register`, read: 'main header p' },
  { name: 'tower3-checks', path: `/studio/properties/${TOWER3}/register?tab=checks`, read: TAB_BODY,
    also: '[role="tablist"]' },
  { name: 'tower3-workspace', path: `/studio/review/${TOWER3}?stage=check`, read: 'main [class*="_side_"]' },
];

function allowed(request) {
  if (request.method() === 'GET' || request.method() === 'HEAD') return true;
  const { pathname } = new URL(request.url());
  return request.method() === 'POST' && CARD_READS.some((read) => pathname.endsWith(read));
}

async function textOf(page, selector) {
  const element = page.locator(selector).first();
  if (!(await element.count())) return null;
  const text = await element.evaluate((node) => (node.innerText ?? node.textContent ?? '').trim());
  return text.replace(/\s*\n+\s*/g, ' | ').slice(0, 500);
}

/** Whether the page scrolls sideways, and whether the stated element lies inside the viewport's width. */
function fit(page, selector) {
  return page.evaluate((target) => {
    const box = document.querySelector(target)?.getBoundingClientRect();
    return {
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
      insideWidth: box ? box.left >= 0 && box.right <= window.innerWidth : null,
    };
  }, selector);
}

/** Tabs from the top of the page until the named link has the focus; the number of presses, or null. */
async function tabsTo(page, name) {
  for (let presses = 1; presses <= 60; presses += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (focused === name) return presses;
  }
  return null;
}

async function capture(context, seen, screen, view) {
  const page = await context.newPage();
  await page.route('**/*', (route) => {
    if (allowed(route.request())) return route.continue();
    seen.refused.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
  await page.goto(`${STUDIO}${screen.path}`);
  await page.waitForTimeout(6000);
  const entry = { screen: screen.name, view: view.name, states: await textOf(page, screen.read) };
  if (screen.also) entry.also = await textOf(page, screen.also);
  Object.assign(entry, await fit(page, screen.read));
  // Counted before anything scrolls, so the presses are those of a person starting at the top of the page.
  if (screen.name === 'magnolia-units') entry.tabsToOpenRecord = await tabsTo(page, 'Open record');
  await page.locator(screen.read).first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: join(HERE, 'after', `${screen.name}-${view.name}.png`) });
  await page.close();
  return entry;
}

async function main() {
  mkdirSync(join(HERE, 'after'), { recursive: true });
  const seen = { refused: [] };
  const browser = await chromium.launch();
  const screens = [];
  for (const view of VIEWS) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
    });
    for (const screen of SCREENS) screens.push(await capture(context, seen, screen, view));
    await context.close();
  }
  await browser.close();
  writeFileSync(join(HERE, 'after.json'), `${JSON.stringify({ refused: seen.refused, screens })}\n`);
  for (const entry of screens) console.log(JSON.stringify(entry));
  console.log(`refused ${seen.refused.length}`);
}

await main();
