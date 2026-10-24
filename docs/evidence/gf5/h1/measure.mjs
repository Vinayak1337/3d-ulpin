/**
 * H1 evidence: screenshots and frame-header measurements for three Studio routes at 1280, 640 and 320 CSS px.
 * 640x400 at scale 2 and 320x200 at scale 4 are what a 1280x800 window shows at 200% and 400% browser zoom.
 * Usage: node docs/evidence/gf5/h1/measure.mjs <before|after>   (Studio dev server on 127.0.0.1:5199, read-only)
 * "after" exits non-zero when a row breaks an acceptance rule; "before" only records the defect.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const OUT = import.meta.dirname;
const STUDIO = 'http://127.0.0.1:5199';
const PHASE = process.argv[2];
const ROUTES = {
  map: '/studio/areas/cb24dc86-2b91-4793-9586-24e8a443b8d8',
  candidates: '/studio/properties/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/candidates',
  register: '/studio/registry',
};
const VIEWS = [
  { cssWidth: 1280, cssHeight: 800, scale: 1, routes: Object.keys(ROUTES) },
  { cssWidth: 640, cssHeight: 400, scale: 2, routes: Object.keys(ROUTES) },
  { cssWidth: 320, cssHeight: 200, scale: 4, routes: ['map'] },
  // The difficult input: the API is unreachable, so the header has no areas and no request count to show.
  { cssWidth: 640, cssHeight: 400, scale: 2, routes: ['register'], apiDown: true },
];
// Pages have panel headers of their own; the frame header is the one that holds the Studio navigation.
const HEADER = 'header:has(> nav[aria-label="Studio"])';
const MAX_TAB_PRESSES = 20;
const SETTLE_MS = 5000;

/** Runs in the page: sizes of the document and header, and every header label that is cut off or collides. */
function measureHeader(headerSelector) {
  const root = document.documentElement;
  const header = document.querySelector(headerSelector);
  const text = (element) => (element.getAttribute('aria-label') ?? element.textContent).trim() || element.title;
  const box = (element) => element.getBoundingClientRect();
  const controls = [...header.querySelectorAll('a, button, input, [title]')];
  const labels = [...header.querySelectorAll('a, button span, small')];
  const outside = controls.filter((element) => box(element).left < 0 || box(element).right > root.clientWidth);
  const clipped = labels.filter((element) => element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0);
  const overlapping = controls.filter((element, index) => controls.slice(index + 1).some((other) => {
    if (element.contains(other) || other.contains(element)) return false;
    const [a, b] = [box(element), box(other)];
    return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  }));
  // A placeholder has no measurable overflow, so the hint is typed into the box for one reading and removed.
  const input = header.querySelector('input');
  input.value = input.placeholder;
  const searchHintFits = input.scrollWidth <= input.clientWidth;
  input.value = '';
  return {
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
    headerHeight: Math.round(box(header).height),
    mainHeight: Math.round(box(document.querySelector('main')).height),
    controlBoxes: controls.map((element) => {
      const rect = box(element);
      return [rect.left, rect.top, rect.width, rect.height].map((value) => Math.round(value * 10) / 10);
    }),
    outsideViewport: outside.map(text),
    clippedLabels: clipped.map(text),
    overlapping: overlapping.map(text),
    searchHintFits,
  };
}

/** Runs in the page: whether keyboard focus is still in the frame chrome, and how it shows. */
async function describeFocus(headerSelector) {
  // Reduced motion leaves a 0.01 ms transition on every property: let the skip link finish moving into view.
  const transitions = document.getAnimations().filter((animation) => animation instanceof CSSTransition);
  await Promise.all(transitions.map((transition) => transition.finished));
  const element = document.activeElement;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const viewport = document.documentElement;
  return {
    inChrome: Boolean(element.closest(headerSelector)) || element.getAttribute('href') === '#main',
    outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
    inView: rect.left >= 0 && rect.right <= viewport.clientWidth
      && rect.top >= 0 && rect.bottom <= viewport.clientHeight,
  };
}

async function tabThroughChrome(page) {
  const stops = [];
  for (let presses = 0; presses < MAX_TAB_PRESSES; presses += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(describeFocus, HEADER);
    if (!focus.inChrome) break;
    const snapshot = await page.locator(':focus').ariaSnapshot();
    stops.push({ name: snapshot.split('\n')[0].replace(/^- /, '').replace(/:$/, ''), ...focus });
  }
  return stops;
}

async function openRoute(page, route) {
  await page.goto(`${STUDIO}${ROUTES[route]}`);
  await page.locator(HEADER).waitFor();
  // The demo API may be restarting: the header is measured whether or not data arrives within the settle time.
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
}

async function measureRoute(browser, view, route) {
  const page = await browser.newPage({
    viewport: { width: view.cssWidth, height: view.cssHeight },
    deviceScaleFactor: view.scale,
    reducedMotion: 'reduce',
  });
  await page.route('**/api/v1/**', (request) => {
    const readOnly = request.request().method() === 'GET' && !view.apiDown;
    return readOnly ? request.continue() : request.abort('blockedbyclient');
  });
  await openRoute(page, route);
  const name = `${route}-${view.cssWidth}${view.apiDown ? '-api-down' : ''}.png`;
  // Full page: at 320 px the stacked header is taller than the window and the document scrolls.
  await page.screenshot({ path: resolve(OUT, PHASE, name), fullPage: true });
  const headerPng = await page.locator(HEADER).screenshot();
  const header = await page.evaluate(measureHeader, HEADER);
  const stops = await tabThroughChrome(page);
  await page.close();
  return {
    route,
    cssWidth: view.cssWidth,
    apiDown: Boolean(view.apiDown),
    ...header,
    headerPngSha256: createHash('sha256').update(headerPng).digest('hex'),
    tabStopCount: stops.length,
    tabStops: stops.map((stop) => stop.name),
    focusWithoutOutline: stops.filter((stop) => !stop.outline).map((stop) => stop.name),
    focusOutOfView: stops.filter((stop) => !stop.inView).map((stop) => stop.name),
  };
}

/** The acceptance rules that hold whatever the live data is. Labels may stack at 320 px but not at 640 px. */
function failures(row) {
  const rules = [
    [row.scrollWidth > row.clientWidth, 'the page scrolls sideways'],
    [row.outsideViewport.length > 0, 'a control is outside the window'],
    [row.overlapping.length > 0, 'controls overlap'],
    [row.focusOutOfView.length > 0, 'a focused control is out of view'],
    [row.cssWidth === 640 && row.clippedLabels.length > 0, 'a label is cut off'],
    [row.cssWidth === 640 && !row.searchHintFits, 'the search hint is cut off'],
  ];
  return rules.filter(([broken]) => broken).map(([, reason]) => `${row.route} ${row.cssWidth}: ${reason}`);
}

function report(row, baseline) {
  const size = `${row.scrollWidth}/${row.clientWidth}, ${row.tabStopCount} stops`;
  const same = baseline?.headerPngSha256 === row.headerPngSha256;
  const pixels = baseline ? `, header pixels ${same ? 'same as' : 'differ from'} before` : '';
  console.log(`${PHASE} ${row.route} ${row.cssWidth}: ${size}${pixels}`);
}

/** Keeps the other phase's rows, writes one row per line, and returns both phases. */
function saveRows(rows) {
  const path = resolve(OUT, 'result.json');
  const result = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  result[PHASE] = rows;
  const phases = Object.entries(result).map(([phase, phaseRows]) => {
    return `"${phase}":[\n${phaseRows.map((row) => JSON.stringify(row)).join(',\n')}\n]`;
  });
  writeFileSync(path, `{${phases.join(',\n')}}\n`);
  return result;
}

async function main() {
  assert(['before', 'after'].includes(PHASE), 'Pass the phase: before or after.');
  mkdirSync(resolve(OUT, PHASE), { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const rows = [];
  try {
    for (const view of VIEWS) {
      for (const route of view.routes) rows.push(await measureRoute(browser, view, route));
    }
  } finally {
    await browser.close();
  }
  const result = saveRows(rows);
  const baseline = PHASE === 'after' ? result.before ?? [] : [];
  rows.forEach((row, index) => report(row, baseline[index]));
  if (PHASE === 'after') assert.deepEqual(rows.flatMap(failures), []);
}

await main();
