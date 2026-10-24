// Same captured source records AND application ids as the before run, not a second performance design.
// Fresh import intents change ids (and deterministic facade tints), so compare a snapshot replay as well.
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { freePort, startServer, stopServer } from './server.mjs';
import { comparePixels } from '../lv1/pixels.mjs';
import { checkImagery } from '../lv3/imagery-check.mjs';

const directory = 'docs/evidence/gf5/lv4';
const root = process.cwd().replaceAll('\\', '/');
const scratch = `E:/BhuAayam-data/task-data/lv4/parity-${Date.now()}`;
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const port = 5235;
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const before = await load('docs/evidence/gf5/lv1/before.json');
const reference = await load('docs/evidence/gf5/lv3/parity.json');
const folder = before.rawTimingFile.replace(/\/timings.json$/, '');
const pose = await load(`${folder}/scene.json`);
const lv2After = await load('docs/evidence/gf5/lv1/lv2-after.json');
const lv2Scene = await load(lv2After.rawTimingFile.replace('/timings.json', '/scene.json'));
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

async function replayParts(page) {
  await page.evaluate(async ({ root, features }) => {
    const { toBase, toFootprints } = await import(`/@fs/${root}/apps/studio/src/features/map/footprints.ts`);
    const engine = window.__ulpinScene;
    engine.setBase([]);
    engine.setBuildings([]);
    await engine.waitForDrawn([], []);
    engine.cameraKey = '';
    engine.setImportStreaming(true);
    let base = [];
    for (let count = 96; count < features.length + 96; count += 96) {
      const arrived = features.slice(0, count);
      base = toBase(arrived, base);
      const buildings = toFootprints(arrived);
      engine.setBase(base);
      engine.setBuildings(buildings);
      await engine.waitForDrawn(buildings.map((input) => input.id), base.map((input) => input.id));
    }
  }, { root, features: state.features });
  await page.waitForFunction(() => !window.__ulpinScene.flight);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${scratch}/natural.png` });
}

async function capture() {
  const browser = await chromium.launch({
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // Map only: never call the legacy adapter's generated-floor/register routes.
    await page.route('**/api/v1/buildings/**', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/studio/areas/${state.area.id}?package=${state.id}`);
    await page.waitForFunction((count) => {
      const drawn = window.__ulpinScene?.drawnBuildings();
      return drawn?.count === count && !drawn.pending;
    }, pose.ids.length, { timeout: 120000 });
    await replayParts(page);
    await page.evaluate((pose) => {
      const engine = window.__ulpinScene;
      engine.flight = null;
      engine.camera.position.fromArray(pose.camera);
      engine.controls.target.fromArray(pose.target);
      engine.controls.update();
      engine.requestRender();
    }, pose);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${scratch}/final.png` });
    const rect = await page.locator('canvas').first().boundingBox();
    const ids = await page.evaluate(() => [...window.__ulpinScene.buildingBounds.keys()].sort());
    const scene = await page.evaluate(async ({ root, features }) => {
      const { toBase } = await import(`/@fs/${root}/apps/studio/src/features/map/footprints.ts`);
      const engine = window.__ulpinScene;
      const expectedBaseIds = toBase(features).map((input) => input.id).sort();
      const baseIds = [...engine.baseEntries.keys()].sort();
      return {
        bounds: [engine.areaBox.min.toArray(), engine.areaBox.max.toArray()],
        baseBounds: [engine.baseBox.min.toArray(), engine.baseBox.max.toArray()],
        identicalSourceBaseIds: JSON.stringify(baseIds) === JSON.stringify(expectedBaseIds),
        baseCount: baseIds.length,
        baseBatches: engine.baseBatches.size,
        padBatches: engine.padBatches.size,
        imagery: engine.overlays.children.filter((child) => child.material.map).map((child) => ({
          width: child.material.map.image.width,
          height: child.material.map.image.height,
        })),
      };
    }, { root, features: state.features });
    const imageryCheck = await checkImagery(page, root, state, scratch, rect);
    return { rect, imageryCheck, identicalApplicationIds: JSON.stringify(ids) === JSON.stringify(pose.ids),
      identicalBounds: JSON.stringify(scene.bounds) === JSON.stringify(pose.bounds),
      identicalBaseBounds: JSON.stringify(scene.baseBounds) === JSON.stringify(lv2Scene.baseBounds),
      sourceGit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      drawn: ids.length, scene };
  } finally {
    await browser.close();
  }
}

await freePort(port);
const server = startServer({ root, scratch, port, python });
try {
  await server.ready;
  const result = await capture();
  result.pixels = await comparePixels(reference.screenshot, `${scratch}/final.png`, result.rect,
    `${scratch}/difference.png`);
  result.screenshot = `${scratch}/final.png`;
  result.qualification = 'Fixed-id replay against LV3 after-capture, assets present, same pose and preferences.';
  result.reference = reference.screenshot;
  await writeFile(`${directory}/parity.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await writeFile(`${scratch}/server.log`, server.log());
  await stopServer(server.child, port);
  console.log(`Owned port ${port} is free.`);
}
