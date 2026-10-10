// Read-only MP3 evidence: node docs/evidence/gf5/mp3/capture.mjs [before], with Studio on 5194.
// Run 'before' only against the starting code. The guard aborts and reports every storing request.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const run = process.argv[2] === 'before' ? 'before' : 'after';
const studio = 'http://127.0.0.1:5194';
const area = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';
const allowedReads = ['/usp/identity/resolve', '/usp/property-cards/list'];
const refused = [];
const views = [
  { name: '1440', width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: '200pct', width: 720, height: 450, deviceScaleFactor: 2 },
];

async function guard(page, failUrl) {
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const read = request.method() === 'POST' && allowedReads.some((path) => url.pathname.endsWith(path));
    if (!['GET', 'HEAD'].includes(request.method()) && !read) {
      refused.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (failUrl && url.pathname === failUrl) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
}

async function pose(page, distance) {
  return page.evaluate((distanceM) => {
    const engine = window.__ulpinScene;
    const entry = [...engine.entries.values()].find((entry) => entry.kind === 'building');
    const centre = entry.bounds.getCenter(engine.controls.target.clone());
    engine.flight = null;
    engine.controls.target.set(centre.x, 0, centre.z);
    engine.camera.position.set(centre.x, distanceM * 0.8, centre.z + distanceM * 0.6);
    engine.controls.update();
    engine.requestRender();
    engine.camera.updateMatrixWorld();
    const projected = engine.project(entry.id);
    const rect = engine.renderer.domElement.getBoundingClientRect();
    return { id: entry.id, x: rect.left + projected.x, y: rect.top + projected.y };
  }, distance);
}

async function measure(page) {
  return page.evaluate(() => {
    const engine = window.__ulpinScene;
    const surface = (mesh) => {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      const material = mesh.material;
      return {
        bottomM: box.min.y, topM: box.max.y, renderOrder: mesh.renderOrder,
        depthTest: material.depthTest, depthWrite: material.depthWrite, transparent: material.transparent,
        polygonOffset: material.polygonOffset, factor: material.polygonOffsetFactor, units: material.polygonOffsetUnits,
      };
    };
    const records = [...engine.entries.values()].map((entry) => ({
      kind: entry.kind, id: entry.id, known: entry.known, ...surface(entry.meshes[0]),
    }));
    const pictures = engine.overlays.children.filter((mesh) => mesh.userData.overlay).map(surface);
    const pictureStyles = [...new Set(pictures.map((picture) => JSON.stringify(picture)))].map(JSON.parse);
    return { records, pictureCount: pictures.length, pictureStyles };
  });
}

async function stableFrames(page) {
  const hashes = [];
  for (let frame = 0; frame < 3; frame += 1) {
    await page.evaluate(() => window.__ulpinScene.requestRender());
    await page.waitForTimeout(150);
    const pixels = await page.evaluate(() => window.__ulpinScene.renderer.domElement.toDataURL());
    hashes.push(createHash('sha256').update(pixels).digest('hex'));
  }
  return new Set(hashes).size === 1;
}

async function imageryOff(page, prefix, view) {
  const tools = page.locator('main summary', { hasText: 'Tools' }).first();
  if (!(await tools.evaluate((node) => node.parentElement.open))) await tools.click();
  const imagery = page.getByRole('switch', { name: 'Imagery', exact: true });
  const layers = await page.locator('section[aria-label="Layers"]').innerText();
  const failureNote = layers.includes('1 of 22 images did not load');
  await imagery.focus();
  await page.keyboard.press('Space');
  const off = await imagery.getAttribute('aria-checked');
  await tools.click();
  for (const distance of [30, 120]) {
    await pose(page, distance);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(here, 'shots', `${prefix}-${view.name}-off-${distance}.png`) });
  }
  return { off, failureNote };
}

async function captureView(browser, view, failUrl) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.deviceScaleFactor,
  });
  const page = await context.newPage();
  await guard(page, failUrl);
  await page.goto(`${studio}/studio/areas/${area}`);
  await page.waitForFunction(() => window.__ulpinScene?.overlays.children.length >= 21);
  const samples = [];
  const prefix = failUrl ? `${run}-one-fails` : run;
  for (const distance of [30, 60, 120]) {
    const point = await pose(page, distance);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(here, 'shots', `${prefix}-${view.name}-on-${distance}.png`) });
    const pick = await page.evaluate(({ x, y }) => window.__ulpinScene.pick(x, y), point);
    samples.push({ distance, pick, stableFrames: await stableFrames(page) });
  }
  const scene = await measure(page);
  // A real canvas click: only opens the inspector; guarded against all storing routes.
  const point = await pose(page, 120);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(1000);
  const clicked = await page.evaluate(() => window.__ulpinScene.state.buildingId);
  await page.screenshot({ path: join(here, 'shots', `${prefix}-${view.name}-selected.png`) });
  await page.keyboard.press('Escape');
  const { off, failureNote } = await imageryOff(page, prefix, view);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await context.close();
  return { view: view.name, failedPicture: Boolean(failUrl), failureNote, scene, samples, clicked, off, sideways };
}

async function main() {
  mkdirSync(join(here, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const captures = [];
  try {
    for (const view of views) captures.push(await captureView(browser, view, null));
    if (run === 'after') {
      const response = await fetch(`${studio}/api/v1/areas/${area}/canonical`);
      const canonical = await response.json();
      const first = canonical.overlays.find((overlay) => overlay.kind === 'image');
      captures.push(await captureView(browser, views[0], new URL(first.originalUrl, studio).pathname));
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(here, `captured-${run}.json`), `${JSON.stringify({ run, refused, captures }, null, 2)}\n`);
  console.log(JSON.stringify({ run, refused, captures: captures.length }));
  const invalid = captures.some((capture) => capture.off !== 'false' || !capture.clicked
    || capture.failedPicture !== capture.failureNote
    || capture.samples.some((sample) => sample.pick.kind !== 'building' || !sample.stableFrames));
  if (refused.length || (run === 'after' && invalid)) process.exitCode = 1;
}

await main();
