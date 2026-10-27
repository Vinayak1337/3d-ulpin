// MP2: the Karnataka area's map with its retained imagery on, off and with one picture made to fail, and
// Magnolia's map with the building selected, at 1440 wide and at 200% zoom. Read-only.
//   node docs/evidence/gf5/mp2/capture.mjs [before]
// `before` (run on the code this task started from) keeps only the two screens that exist there.
// Needs the Studio dev server pointed at the demo API (MP2_STUDIO, default http://127.0.0.1:5193).
// Writes shots/<run>-*.png and captured-<run>.json beside this file. Every request that is not a GET, a HEAD
// or one of the two card reads the Studio sends as POST is aborted, listed under `refused`, and fails the run.
// The failing picture is a double in the browser: one overlay's PNG request is answered 404 before it leaves.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = process.env.MP2_STUDIO ?? 'http://127.0.0.1:5193';
const RUN = process.argv[2] === 'before' ? 'before' : 'after';
const CARD_READS = ['/usp/identity/resolve', '/usp/property-cards/list'];
const KARNATAKA = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';
const MAGNOLIA_AREA = 'e5742536-cedd-455b-b59d-c8172875c6f2';
const MAGNOLIA = 'e8777ffc-9409-4129-bacf-f680160d8795';
const MAGNOLIA_MAP = `/studio/areas/${MAGNOLIA_AREA}?feature=${MAGNOLIA}&mode=building`;
const VIEWS = [
  { name: '1440', width: 1440, height: 900, scale: 1 },
  { name: '200pct', width: 720, height: 450, scale: 2 },
];
const NOTE = '[class*="_viewNote_"]';
const LAYERS = 'section[aria-label="Layers"]';
const SETTLE_MS = 7000;

function allowed(request) {
  if (request.method() === 'GET' || request.method() === 'HEAD') return true;
  const { pathname } = new URL(request.url());
  return request.method() === 'POST' && CARD_READS.some((read) => pathname.endsWith(read));
}

/** Guards the page against writes; answers `failUrl` (one picture) with 404 when it is given. */
async function guard(page, seen, failUrl) {
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!allowed(request)) {
      seen.refused.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (failUrl && `${url.pathname}${url.search}` === failUrl) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
  const pictures = { answered: 0 };
  page.on('response', (response) => {
    if (response.ok() && response.headers()['content-type'] === 'image/png') pictures.answered += 1;
  });
  return pictures;
}

async function textOf(page, selector) {
  const element = page.locator(selector).first();
  if (!(await element.count())) return null;
  const text = await element.evaluate((node) => (node.innerText ?? node.textContent ?? '').trim());
  return text.replace(/\s*\n+\s*/g, ' | ').slice(0, 700);
}

/** Whether the page scrolls sideways, and whether the note lies inside the map and clear of the readout. */
function fit(page) {
  return page.evaluate((selector) => {
    const box = (target) => document.querySelector(target)?.getBoundingClientRect() ?? null;
    const note = box(selector);
    const readout = box('[class*="_readout_"]');
    const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    return {
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
      noteInsideWidth: note ? note.left >= 0 && note.right <= window.innerWidth : null,
      noteClearOfReadout: note && readout ? apart(note, readout) : null,
    };
  }, NOTE);
}

/** Contrast of the note's words on its own backing, over the darkest and the lightest picture beneath it. */
function noteContrast(page) {
  return page.evaluate((selector) => {
    const note = document.querySelector(selector);
    if (!note) return null;
    const rgba = (value) => {
      const context = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((channel) => channel / 255);
    };
    const linear = (channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const style = getComputedStyle(note);
    const ink = rgba(style.color);
    const backing = rgba(style.backgroundColor);
    const ratioOver = (under) => {
      const mixed = backing.slice(0, 3).map((channel) => channel * backing[3] + under * (1 - backing[3]));
      const [high, low] = [luminance(ink), luminance(mixed)].sort((a, b) => b - a);
      return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
    };
    return { overBlack: ratioOver(0), overWhite: ratioOver(1), fontSize: style.fontSize };
  }, NOTE);
}

async function openLayers(page) {
  const summary = page.locator('main summary', { hasText: 'Tools' }).first();
  const open = await summary.evaluate((node) => node.parentElement.open);
  if (!open) await summary.click();
  await page.waitForTimeout(500);
}

/** What the keyboard focus is on: the closed Tools summary, the Imagery switch, or neither. */
function focusedControl(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element?.tagName === 'SUMMARY' && element.textContent.trim() === 'Tools') {
      return element.parentElement.open ? null : 'tools';
    }
    const imagery = element?.getAttribute('role') === 'switch' && element.getAttribute('aria-label') === 'Imagery';
    return imagery ? 'imagery' : null;
  });
}

/** By keyboard alone from the top of the page: opens Tools, then presses Space on the Imagery switch. */
async function switchImageryByKeyboard(page) {
  for (let presses = 1; presses <= 80; presses += 1) {
    await page.keyboard.press('Tab');
    const control = await focusedControl(page);
    if (control === 'tools') await page.keyboard.press('Enter');
    if (control !== 'imagery') continue;
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    return presses;
  }
  return null;
}

async function read(page, name, view, pictures) {
  await page.screenshot({ path: join(HERE, 'shots', `${RUN}-${name}-${view.name}.png`) });
  return {
    screen: name, view: view.name, layers: await textOf(page, LAYERS), note: await textOf(page, NOTE),
    imagerySwitch: await page.getByRole('switch', { name: 'Imagery' }).first().getAttribute('aria-checked')
      .catch(() => null),
    picturesAnswered: pictures.answered, ...(await fit(page)), contrast: await noteContrast(page),
  };
}

async function openMap(context, seen, path, failUrl) {
  const page = await context.newPage();
  const pictures = await guard(page, seen, failUrl);
  await page.goto(`${STUDIO}${path}`);
  await page.waitForTimeout(SETTLE_MS);
  return { page, pictures };
}

async function karnataka(browser, seen, view, failUrl) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
  });
  const { page, pictures } = await openMap(context, seen, `/studio/areas/${KARNATAKA}`, failUrl);
  await openLayers(page);
  const entries = [await read(page, failUrl ? 'karnataka-one-fails' : 'karnataka-on', view, pictures)];
  if (!failUrl && RUN === 'after') {
    pictures.answered = 0;
    await page.reload();
    await page.waitForTimeout(SETTLE_MS);
    const tabsToSwitch = await switchImageryByKeyboard(page);
    entries.push({ ...(await read(page, 'karnataka-off', view, pictures)), tabsToSwitch });
  }
  await context.close();
  return entries;
}

async function magnolia(browser, seen, view) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
  });
  const { page } = await openMap(context, seen, MAGNOLIA_MAP, null);
  const card = await textOf(page, '[class*="_emptyOverlay_"] [class*="_emptyCard_"]');
  await page.screenshot({ path: join(HERE, 'shots', `${RUN}-magnolia-${view.name}.png`) });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await context.close();
  return { screen: 'magnolia', view: view.name, card, pageScrollsSideways: sideways };
}

/** The first image overlay the area's canonical read lists: the picture the double fails. */
async function firstPictureUrl() {
  const response = await fetch(`${STUDIO}/api/v1/areas/${KARNATAKA}/canonical`);
  const area = await response.json();
  const images = area.overlays.filter((overlay) => overlay.kind === 'image');
  return { url: images[0].originalUrl, listed: images.length };
}

async function main() {
  mkdirSync(join(HERE, 'shots'), { recursive: true });
  const seen = { refused: [] };
  const failed = await firstPictureUrl();
  const browser = await chromium.launch();
  const screens = [];
  for (const view of VIEWS) {
    screens.push(...(await karnataka(browser, seen, view, null)));
    if (RUN === 'after') screens.push(...(await karnataka(browser, seen, view, failed.url)));
    screens.push(await magnolia(browser, seen, view));
  }
  await browser.close();
  const captured = { run: RUN, studio: STUDIO, listedImages: failed.listed, refused: seen.refused, screens };
  writeFileSync(join(HERE, `captured-${RUN}.json`), `${JSON.stringify(captured)}\n`);
  for (const entry of screens) console.log(JSON.stringify(entry));
  console.log(`refused ${seen.refused.length}`);
  if (seen.refused.length) process.exitCode = 1;
}

await main();
