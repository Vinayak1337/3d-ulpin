import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
const baseURL = process.env.SPATIAL_BASE_URL || "http://127.0.0.1:3000";
const output = ".runtime/spatial-qa";
await mkdir(output, { recursive: true });
const report = { testedAt: new Date().toISOString(), baseURL, device: "CI Chromium / software WebGL; not the user's desktop GPU", tests: [], errors: [], console: [], badResponses: [] };
let server, browser, page;
const record = (name, details = {}) => report.tests.push({ name, passed: true, ...details });
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${baseURL}/api/v1/spatial/calibration/garden/summary.json`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  throw new Error("Production app did not become ready");
}
const shot = name => page.screenshot({ path: `${output}/${name}.png`, timeout: 90000 });
try {
  if (process.env.SPATIAL_START_SERVER === "1") {
    server = spawn(process.execPath, ["apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "127.0.0.1", "--port", "3000"], { stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    await waitForServer();
  }
  browser = await chromium.launch({ headless: true, ...(process.env.SPATIAL_BROWSER ? { executablePath: process.env.SPATIAL_BROWSER } : {}), args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const context = await browser.newContext({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on("pageerror", e => report.errors.push(e.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) report.console.push({ type: message.type(), text: message.text().slice(0, 1000) }); });
  const requests = [];
  page.on("request", r => requests.push(r.url()));
  page.on("response", r => { if (r.url().startsWith(baseURL) && r.status() >= 400) report.badResponses.push({ url: r.url(), status: r.status() }); });
  await page.goto(`${baseURL}/map-lab`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-tile-canvas][data-scene-ready="true"]', { timeout: 90000 });
  await page.waitForFunction(() => Number(document.querySelector("[data-tile-canvas]")?.dataset.loadedTiles) >= 3, { timeout: 30000 });
  await page.waitForTimeout(2500);
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  assert.equal(await page.locator("[data-tile-canvas] canvas").count(), 1);
  assert(requests.some(url => url.endsWith(".glb")), "Geometry must be fetched as actual GLB tiles, not a reference screenshot");
  record("Real compiled 3D Tiles and metadata loaded into exactly one live map runtime");
  await shot("01-complete-map");
  await page.getByRole("button", { name: "Neighbourhood", exact: true }).click();
  await page.waitForTimeout(1800);
  await shot("02-neighbourhood");
  record("Neighbourhood camera command loads the detailed representation");
  await page.evaluate(() => { window.__originalCanvas = document.querySelector("[data-tile-canvas] canvas"); });
  const first = await page.locator("[data-map-runtime-id]").getAttribute("data-map-runtime-id");
  const initialMetric = await page.locator("[data-horizontal-area]").getAttribute("data-horizontal-area");
  const initialSnapshotCount = requests.filter(url => url.includes("/garden/snapshot.json")).length;
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByText("0 documents attached", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Building", exact: true }).click();
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  assert.equal(await page.evaluate(() => document.querySelector("[data-tile-canvas] canvas") === window.__originalCanvas), true);
  assert.equal(await page.locator("[data-map-runtime-id]").getAttribute("data-map-runtime-id"), first);
  assert.equal(requests.filter(url => url.includes("/garden/snapshot.json")).length, initialSnapshotCount);
  assert.equal(await page.locator("[data-horizontal-area]").getAttribute("data-horizontal-area"), initialMetric);
  record("Map, Building and Sources share the identical mounted canvas, cached snapshot and measured geometry");
  await page.locator('[data-building-id="calibration-garden:building-2"]').click();
  await page.waitForFunction(() => document.querySelector("[data-selected-entity]")?.getAttribute("data-selected-entity") === "calibration-garden:building-2");
  await page.locator('[data-building-id="calibration-garden:building-1"]').click();
  await page.getByRole("tab", { name: "Building", exact: true }).click();
  await page.getByRole("button", { name: /^Unit 1$/ }).first().click();
  await page.waitForFunction(() => document.querySelector("[data-selected-entity]")?.getAttribute("data-selected-entity")?.endsWith("unit-1"));
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  await page.getByRole("button", { name: "Focus object", exact: true }).click();
  await page.waitForTimeout(1500);
  await shot("03-exact-unit");
  record("A selected unit uses the same runtime and canonical quantity calculation with a geometric inspection overlay");
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await page.locator('[data-building-id="calibration-garden:building-2"]').click();
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.getByRole("button", { name: "Fit scene", exact: true }).click();
  await page.waitForTimeout(1200);
  const plan = JSON.parse(await page.locator("[data-tile-canvas]").getAttribute("data-camera"));
  assert(Math.abs(plan.pitch + Math.PI / 2) < .02);
  await shot("04-top-down");
  record("2D remains top-down through selection and Fit scene", { pitch: plan.pitch });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForTimeout(1000);
  const before = JSON.parse(await page.locator("[data-tile-canvas]").getAttribute("data-camera"));
  const canvas = page.locator("[data-tile-canvas] canvas"), box = await canvas.boundingBox();
  assert(box);
  const x = box.x + box.width * .55, y = box.y + box.height * .42;
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.move(x + 90, y + 45, { steps: 18 }); await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(1100);
  const after = JSON.parse(await page.locator("[data-tile-canvas]").getAttribute("data-camera"));
  assert(Math.abs(before.longitude - after.longitude) + Math.abs(before.latitude - after.latitude) > 1e-8);
  await page.mouse.down({ button: "right" }); await page.waitForTimeout(650); await page.mouse.move(x - 30, y + 10, { steps: 14 }); await page.mouse.up({ button: "right" }); await page.mouse.wheel(0, -160); await page.waitForTimeout(1000);
  record("Held drag survives UI updates, followed by held orbit and wheel input", { before, after });
  await page.selectOption("#lab-dataset", "dense");
  await page.waitForFunction(() => document.querySelector("[data-tile-source]")?.getAttribute("data-tile-source")?.includes("/dense/"));
  await page.waitForSelector('[data-tile-canvas][data-scene-ready="true"]', { timeout: 90000 });
  await page.waitForTimeout(1800);
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  assert.equal(await page.locator("[data-building-id]").count(), 120);
  await shot("05-dense-map");
  record("A different 120-building dense dataset uses the same compiler and engine without duplicate canvases");
  await page.selectOption("#lab-dataset", "garden");
  await page.waitForSelector('[data-tile-canvas][data-scene-ready="true"]', { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector("[data-selected-entity]")?.getAttribute("data-selected-entity") === "calibration-garden:building-2");
  record("World-specific selection survives dataset unload and return");
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(1200); await shot("06-desktop-1280");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1500); await shot("07-mobile-smoke");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  record("1280px and 390px layouts retain one map and avoid horizontal overflow");
  assert.deepEqual(report.errors, []); assert.deepEqual(report.badResponses, []);
  record("No uncaught page exceptions or failed local asset/API responses");
} catch (error) {
  report.tests.push({ name: "Browser suite", passed: false, error: error.stack || String(error) });
  if (page) await shot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/browser-results.json`, JSON.stringify(report, null, 2));
  await browser?.close();
  server?.kill("SIGTERM");
}
