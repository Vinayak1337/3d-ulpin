// Same captured source records AND application ids as the before run, not a second performance design.
// Fresh import intents change ids (and deterministic facade tints), so compare a snapshot replay as well.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { freePort, startServer, stopServer } from './server.mjs';
import { comparePixels } from './pixels.mjs';

const directory = 'docs/evidence/gf5/lv1';
const root = process.cwd().replaceAll('\\', '/');
const scratch = `E:/BhuAayam-data/task-data/lv1/parity-${Date.now()}`;
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

async function capture() {
  const browser = await chromium.launch({
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // Map only: never call the legacy adapter's generated-floor/register routes.
    await page.route('**/api/v1/**', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/studio/areas/${state.area.id}?package=${state.id}`);
    await page.waitForFunction((count) => window.__ulpinScene?.drawnBuildings().count === count,
      pose.ids.length, { timeout: 120000 });
    await page.evaluate((pose) => {
      const engine = window.__ulpinScene;
      engine.camera.position.fromArray(pose.camera);
      engine.controls.target.fromArray(pose.target);
      engine.controls.update();
      engine.requestRender();
    }, pose);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${scratch}/final.png` });
    const rect = await page.locator('canvas').first().boundingBox();
    const ids = await page.evaluate(() => [...window.__ulpinScene.buildingBounds.keys()].sort());
    return { rect, identicalApplicationIds: JSON.stringify(ids) === JSON.stringify(pose.ids), drawn: ids.length };
  } finally {
    await browser.close();
  }
}

await freePort(port);
const server = startServer({ root, scratch, port, python });
try {
  await server.ready;
  const result = await capture();
  result.pixels = await comparePixels(`${folder}/final.png`, `${scratch}/final.png`, result.rect);
  result.screenshot = `${scratch}/final.png`;
  result.qualification = 'Snapshot replay for visual parity only; streamed runs remain before/after in lag.json.';
  await writeFile(`${directory}/parity.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await writeFile(`${scratch}/server.log`, server.log());
  await stopServer(server.child, port);
  console.log(`Owned port ${port} is free.`);
}
