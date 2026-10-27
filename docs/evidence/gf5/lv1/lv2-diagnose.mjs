// Fixed ids, records, camera and look. Changes here are temporary diagnostic browser mutations only.
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { chromium } from '@playwright/test';
import { freePort, startServer, stopServer } from './server.mjs';
import { comparePixels } from './pixels.mjs';
import { writeEvidence } from './evidence-json.mjs';

const directory = 'docs/evidence/gf5/lv1';
const root = process.cwd().replaceAll('\\', '/');
const scratch = `E:/BhuAayam-data/task-data/lv1/lv2-diagnosis-${Date.now()}`;
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const port = 5235;
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const before = await load(`${directory}/before.json`);
const folder = before.rawTimingFile.replace(/\/timings.json$/, '');
const pose = await load(`${folder}/scene.json`);
const jobs = (await readdir(`${folder}/transport`)).filter((name) => /^d30d[0-9a-f-]+$/.test(name));
const bytes = await readFile(`${folder}/transport/${jobs[0]}/state.json`);
const state = JSON.parse(bytes);
await mkdir(`${scratch}/transport/${state.id}`, { recursive: true });
await writeFile(`${scratch}/transport/${state.id}/state.json`, bytes, { flag: 'wx' });
for (const name of await readdir(`${folder}/transport/${jobs[0]}`)) {
  if (name === 'state.json' || name === 'events.ndjson') continue;
  await copyFile(`${folder}/transport/${jobs[0]}/${name}`, `${scratch}/transport/${state.id}/${name}`,
    constants.COPYFILE_EXCL);
}

async function image(page, name) {
  await page.evaluate(() => window.__ulpinScene.requestRender());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${scratch}/${name}.png` });
}

async function mergePads(page) {
  return page.evaluate(async (root) => {
    const { padGeometry } = await import(`/@fs/${root}/packages/scene/src/look.ts`);
    const engine = window.__ulpinScene;
    const footprints = [...engine.footprintPolygons.values()];
    const start = performance.now();
    const geometry = padGeometry(footprints, 2.2, 0.004);
    const mergedMs = performance.now() - start;
    const template = engine.pads.values().next().value;
    const mesh = template.clone();
    mesh.geometry = geometry;
    for (const pad of engine.pads.values()) engine.dressing.remove(pad);
    engine.dressing.add(mesh);
    const batchTimes = [];
    for (let index = 0; index < footprints.length; index += 24) {
      const start = performance.now();
      const batch = padGeometry(footprints.slice(index, index + 24), 2.2, 0.004);
      batchTimes.push(performance.now() - start);
      batch?.dispose();
    }
    return { mergedMs, batch24MaxMs: Math.max(...batchTimes), padDrawCallsBefore: new Set(engine.pads.values()).size,
      padDrawCallsMerged: 1, shadowFar: engine.sun.shadow.camera.far, shadowRight: engine.sun.shadow.camera.right };
  }, root);
}

async function shadowComparison(page) {
  const shadowBefore = await page.evaluate(() => {
    const engine = window.__ulpinScene;
    engine.fitGroundAndShadow();
    return { far: engine.sun.shadow.camera.far, right: engine.sun.shadow.camera.right };
  });
  await image(page, 'shadow-refit');
  await page.evaluate(() => {
    const engine = window.__ulpinScene;
    engine.sun.shadow.camera.right = 0;
    engine.followSun();
  });
  await image(page, 'shadow-forced-update');
  const shadowForced = await page.evaluate(() => ({ far: window.__ulpinScene.sun.shadow.camera.far }));
  return { shadowBefore, shadowForced };
}

async function capture() {
  const browser = await chromium.launch({
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/v1/buildings/**', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/studio/areas/${state.area.id}?package=${state.id}`);
    await page.waitForFunction((count) => window.__ulpinScene?.drawnBuildings().count === count,
      pose.ids.length, { timeout: 120000 });
    await page.evaluate((pose) => {
      const engine = window.__ulpinScene;
      engine.flight = null;
      engine.camera.position.fromArray(pose.camera);
      engine.controls.target.fromArray(pose.target);
      engine.controls.update();
    }, pose);
    await page.evaluate(() => document.fonts.ready);
    await image(page, 'unmodified');
    const regions = await page.locator('[class*="viewNote"], [class*="labels"] span')
      .evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { name: node.className.includes('viewNote') ? 'assetErrorNote' : 'labels',
          x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }));
    const timings = await mergePads(page);
    await image(page, 'merged-pads');
    const shadows = await shadowComparison(page);
    return { timings, ...shadows, regions,
      rect: await page.locator('canvas').first().boundingBox() };
  } finally {
    await browser.close();
  }
}

await freePort(port);
const server = startServer({ root, scratch, port, python });
try {
  await server.ready;
  const result = await capture();
  result.comparisons = {};
  for (const name of ['unmodified', 'merged-pads', 'shadow-refit', 'shadow-forced-update']) {
    result.comparisons[name] = await comparePixels(`${folder}/final.png`, `${scratch}/${name}.png`, result.rect,
      `${scratch}/${name}-difference.png`, result.regions);
  }
  const missingAssets = await load(`${directory}/lv2-diagnosis.json`);
  const originalRegions = result.regions.map((region) => region.name === 'assetErrorNote'
    ? { ...region, x: 28, y: 628, width: 379, height: 56 } : region);
  result.missingAssetsRegions = await comparePixels(`${folder}/final.png`,
    `${missingAssets.scratch}/unmodified.png`, result.rect, undefined, originalRegions);
  result.regionLimit = 'Missing-assets note bounds read from its captured screenshot; text bounds from live DOM.';
  result.scratch = scratch;
  await writeEvidence(`${directory}/lv2-diagnosis-assets-present.json`, result);
  console.log(JSON.stringify(result));
} finally {
  await writeFile(`${scratch}/server.log`, server.log(), { flag: 'wx' });
  await stopServer(server.child, port);
}
