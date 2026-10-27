import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Browser, Page, Route } from '@playwright/test';

/** Separate controlled browser, never a workaround on the live page. No controlled write reaches the API. */
export async function controlWalk(browser: Browser, batchUrl: string, captured: Record<string, any>, scratch: string) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const state = makeState(captured);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await installStreams(page);
  await page.route('**/api/v1/ingestion/**', route => respond(route, state));
  await page.goto(batchUrl);
  await page.getByText('Identifier: doitt_id', { exact: true }).waitFor().catch(async error => {
    await page.screenshot({ path: `${scratch}/control-failure.png`, fullPage: true });
    const body = await page.locator('body').innerText();
    throw new Error(`${error.message}; errors=${JSON.stringify(errors)}; body=${body}`);
  });
  await page.getByText('Written by an officer', { exact: true }).waitFor();
  await page.getByText('Height: not stated', { exact: true }).waitFor();
  const accessibility = await designCheck(page, scratch);
  await staleApproval(page, state);
  await page.getByRole('button', { name: 'Approve layout', exact: true }).click();
  await page.getByText('This layout is approved and is read-only.', { exact: true }).waitFor();
  assert.equal(state.approvals[1].expectedRecipeRevision, 2);
  assert.equal(await page.getByRole('button', { name: 'Approve layout', exact: true }).count(), 0);
  await packageControls(page, state);
  await zeroControl(page, state, scratch);
  assert.deepEqual(errors, []);
  const connections = await page.evaluate(() =>
    (window as any).__streams.filter((stream: any) => !stream.closed).length);
  await page.close();
  return { mode: 'Controlled projections only; not live gate proof', accessibility, errors, connections,
    staleApprovalReloaded: true, displayedRevisionApproved: state.approvals,
    packagePreparedAndLinked: true, approvedAndExecutedReadOnly: true, zeroSelectionEnabled: true,
    zeroBody: state.confirmations[0], screenshots: [`${scratch}/control-layout.png`,
      `${scratch}/control-200.png`, `${scratch}/control-zero.png`] };
}

function makeState(captured: Record<string, any>) {
  const targets = JSON.parse(readFileSync('docs/evidence/gf1/e3b/targets.json', 'utf8'));
  delete targets.choiceIds;
  targets.nextCursor = null;
  const receipt = structuredClone(captured.authored);
  const manifest = structuredClone(captured.manifest);
  manifest.items[0].plan = { recipeId: receipt.id, recipeRevision: receipt.revision,
    recipeState: receipt.state, origin: 'officer', packageId: null };
  manifest.items[0].state = 'planned';
  manifest.items[0].placement = 'undecided';
  manifest.items[0].limitReason = null;
  return { receipt, history: [structuredClone(receipt)], manifest, targets,
    approvals: [] as any[], confirmations: [] as any[], stale: true, hidePackages: false };
}

type State = ReturnType<typeof makeState>;

async function respond(route: Route, state: State) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
  if (request.method() === 'POST' && path.endsWith('/approve')) {
    state.approvals.push(request.postDataJSON());
    state.receipt.revision++;
    if (state.stale) {
      state.stale = false;
      state.history.push(structuredClone(state.receipt));
      return reply({ error: { code: 'STALE_REVISION',
        message: 'The recipe changed; refresh before approval or execution.' } }, 409);
    }
    state.receipt.state = 'approved';
    state.history.push(structuredClone(state.receipt));
    return reply(state.receipt);
  }
  if (request.method() === 'POST' && path.endsWith('/confirmations')) {
    state.confirmations.push(request.postDataJSON());
    return reply({ error: { code: 'CONTROL_END',
      message: 'Control ends at the request; no package is recorded.' } }, 422);
  }
  if (request.method() !== 'GET') throw new Error(`Unexpected controlled write: ${path}`);
  if (path.endsWith('/intake')) return reply(state.manifest);
  if (path.includes('/recipes/')) return reply(state.history);
  if (path.endsWith('/targets')) {
    return reply({ ...state.targets, packages: state.hidePackages ? [] : state.targets.packages });
  }
  throw new Error(`Unexpected controlled read: ${path}`);
}

async function installStreams(page: Page) {
  // A plain browser script avoids host-transpiler name helpers leaking into a serialized callback.
  await page.addInitScript(`
    window.__name = (value) => value;
    window.__streams = [];
    window.EventSource = class {
      closed = false;
      onerror = () => {};
      onopen = () => {};
      handlers = new Map();
      constructor(url) {
        this.url = url;
        window.__streams.push(this);
        setTimeout(() => this.onopen(), 0);
      }
      close() { this.closed = true; }
      addEventListener(kind, handler) { this.handlers.set(kind, handler); }
      emit(kind, data, id) {
        this.handlers.get(kind)?.({ type: kind, data: JSON.stringify(data), lastEventId: id });
      }
    };
  `);
}

async function notify(page: Page, sequence: number) {
  await page.evaluate(number => {
    for (const stream of (window as any).__streams.filter((item: any) => !item.closed)) {
      stream.emit('ingestion.change', { kind: 'change', sequence: String(number),
        change: { kind: 'intake.item' } }, String(number));
    }
  }, sequence);
}

async function staleApproval(page: Page, state: State) {
  await page.getByRole('button', { name: 'Approve layout', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByText('The layout changed. Read the current layout before approving it.', { exact: true }).waitFor();
  await page.getByText('Revision 2 · proposed', { exact: true }).waitFor();
  assert.equal(state.approvals[0].expectedRecipeRevision, 1);
  assert.match(state.approvals[0].requestKey, /^[a-f0-9-]{36}$/);
}

async function packageControls(page: Page, state: State) {
  state.receipt.state = 'executed';
  state.receipt.revision++;
  state.history.push(structuredClone(state.receipt));
  state.manifest.items[0].plan.packageId = state.targets.packages[0].packageId;
  state.manifest.items[0].plan.recipeState = 'executed';
  state.manifest.items[0].state = 'read';
  state.manifest.items[0].placement = 'on_map';
  state.hidePackages = true;
  await notify(page, 10);
  await page.getByText('Package prepared', { exact: true }).waitFor();
  await page.getByText('This layout is executed and is read-only.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve layout', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Open package', exact: true }).count(), 0);
  state.hidePackages = false;
  await notify(page, 11);
  const link = page.getByRole('link', { name: 'Open package', exact: true });
  await link.waitFor();
  const pkg = state.targets.packages[0];
  assert.equal(await link.getAttribute('href'), `/studio/areas/${pkg.areaId}?package=${pkg.packageId}`);
}

async function zeroControl(page: Page, state: State, scratch: string) {
  const zero = Object.fromEntries(Object.keys(state.targets.counts).map(key => [key, 0]));
  state.targets.counts = zero;
  state.targets.items = [];
  state.targets.packages[0].counts = zero;
  await notify(page, 12);
  await page.getByText('No building in this package; its features will be recorded.', { exact: true }).waitFor();
  await page.getByText('These packages will be recorded in the register. No building is chosen, '
    + 'so no card is made now.', { exact: true }).waitFor();
  const press = page.getByRole('button', { name: 'Record packages and make chosen cards', exact: true });
  assert(await press.isDisabled());
  await page.getByLabel('Your acknowledgement').fill('This is a controlled request, not a live registry decision.');
  assert(await press.isEnabled());
  await page.screenshot({ path: `${scratch}/control-zero.png`, fullPage: true });
  await press.click();
  await page.getByText('Control ends at the request; no package is recorded.', { exact: true }).waitFor();
  assert.deepEqual(state.confirmations[0].targets, []);
  assert.equal(state.confirmations[0].packages.length, 1);
}

async function designCheck(page: Page, scratch: string) {
  await page.screenshot({ path: `${scratch}/control-layout.png`, fullPage: true });
  const approve = page.getByRole('button', { name: 'Approve layout', exact: true });
  await page.getByRole('button', { name: 'View layout', exact: true }).focus();
  await page.keyboard.press('Tab');
  const keyboard = await approve.evaluate(element => ({ reachable: element === document.activeElement,
    outlineWidth: getComputedStyle(element).outlineWidth }));
  assert(keyboard.reachable);
  const contrast = await contrastRatios(page);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await approve.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${scratch}/control-200.png`, fullPage: true });
  const zoom = await page.locator('section[aria-label^="Layout for"]').evaluate(element => ({
    clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
  }));
  assert(zoom.scrollWidth <= zoom.clientWidth + 1);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  return { keyboard, contrast, zoom, method: 'Chromium CSS zoom 2; controlled recipe with mounted real panel' };
}

async function contrastRatios(page: Page) {
  return page.evaluate(() => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255);
      const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    return [...document.querySelectorAll('section[aria-label^="Layout for"] p, textarea, button.ul-btn--primary')]
      .map(element => {
        let parent = element;
        while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)' && parent.parentElement) {
          parent = parent.parentElement;
        }
        const foreground = luminance(getComputedStyle(element).color);
        const background = luminance(getComputedStyle(parent).backgroundColor);
        return { tag: element.tagName, ratio: Math.round(((Math.max(foreground, background) + 0.05)
          / (Math.min(foreground, background) + 0.05)) * 100) / 100 };
      });
  });
}
