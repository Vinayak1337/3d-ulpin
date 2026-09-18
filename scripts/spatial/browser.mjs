import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const output = path.resolve(process.env.SPATIAL_QA_DIR || ".runtime/spatial-qa");
await mkdir(output, { recursive: true });
const base = process.env.SPATIAL_BASE_URL || "http://127.0.0.1:3000";
let server;
if (process.env.SPATIAL_START_SERVER === "1") {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3000"], { cwd: path.resolve("apps/web"), env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore" });
}
let browser, page;
const report = { testedAt: new Date().toISOString(), baseURL: base, device: "CI Chromium / software WebGL; not the user's desktop GPU", tests: [], errors: [], console: [], badResponses: [] };
const record = name => report.tests.push({ name, passed: true });
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/api/v1/spatial/calibration/garden/summary.json`)).ok) break; } catch { /* Wait for this explicitly started local server. */ }
    if (attempt === 49) throw new Error("Local map server did not become ready");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  page = await browser.newPage({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 });
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
  page.on("response", response => { if (response.status() >= 400 && !response.url().endsWith("favicon.ico")) report.badResponses.push({ url: response.url(), status: response.status() }); });
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  await page.goto(`${base}/map-lab`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const waitReady = () => page.waitForFunction(() => {
    const host = document.querySelector(".spatial-canvas");
    return host?.getAttribute("data-scene-ready") === "true" && Number(host.getAttribute("data-loaded-tiles")) >= 3;
  }, null, { timeout: 90000 });
  await waitReady(); await page.waitForTimeout(700);
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  const runtimeId = await page.locator("[data-map-runtime-id]").getAttribute("data-map-runtime-id");
  const areaBefore = await page.locator("[data-metric-area]").innerText();
  const snapshotFetches = () => requests.filter(url => url.endsWith("/garden/snapshot.json")).length;
  const countBefore = snapshotFetches();
  record("Real compiled 3D Tiles and metadata loaded into exactly one live map runtime");
  await page.screenshot({ path: path.join(output, "01-complete-neighbourhood.png") });
  await page.getByRole("button", { name: "Neighbourhood", exact: true }).click();
  await waitReady(); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, "02-neighbourhood-detail.png") });
  record("Neighbourhood camera command loads the detailed representation");

  for (const tab of ["Sources", "Building", "Map"]) await page.getByRole("tab", { name: tab, exact: true }).click();
  assert.equal(await page.locator("[data-map-runtime-id]").getAttribute("data-map-runtime-id"), runtimeId);
  assert.equal(snapshotFetches(), countBefore);
  assert.equal(await page.locator("[data-metric-area]").innerText(), areaBefore);
  record("Map/building/source panels share one canvas, one data request and one selection");

  await page.getByRole("button", { name: "Building 2 building-2", exact: false }).first().click();
  await page.waitForFunction(() => document.querySelector("[data-selected-entity]")?.getAttribute("data-selected-entity") === "calibration-garden:building-2");
  await page.getByRole("button", { name: "Building 1 building-1", exact: true }).click();
  await page.getByRole("tab", { name: "Building", exact: true }).click();
  await page.getByRole("button", { name: "Unit 1", exact: true }).first().click();
  assert.match(await page.locator("[data-selected-entity]").getAttribute("data-selected-entity"), /level-0-unit-1$/);
  await page.getByRole("button", { name: "Focus object", exact: true }).click();
  await waitReady(); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, "03-linked-unit-inspection.png") });
  record("Canonical unit selection creates a source-derived inspection overlay in the same renderer");
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Building 1 building-1", exact: true }).click();
  await page.getByRole("button", { name: "Fit scene", exact: true }).click();
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Building 2 building-2", exact: false }).first().click();
  assert.equal(await page.getByRole("button", { name: "2D", exact: true }).getAttribute("aria-pressed"), "true");
  const camera2d = JSON.parse(await page.locator("[data-camera]").getAttribute("data-camera"));
  assert.ok(Math.abs(camera2d.pitch + Math.PI / 2) < .002);
  await page.screenshot({ path: path.join(output, "04-linked-top-down.png") });
  record("Selection preserves the 2D mode and top-down camera");

  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.getByRole("button", { name: "Neighbourhood", exact: true }).click();
  await waitReady(); await page.waitForTimeout(800);
  const camera = () => page.locator("[data-camera]").getAttribute("data-camera");
  const before = await camera();
  const canvas = await page.locator(".spatial-canvas canvas").boundingBox();
  const x = canvas.x + canvas.width * .55, y = canvas.y + canvas.height * .50;
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(650);
  await page.mouse.move(x + 100, y + 35, { steps: 14 }); await page.mouse.up(); await page.waitForTimeout(1100);
  assert.notEqual(await camera(), before);
  await page.mouse.move(x, y); await page.mouse.down({ button: "right" }); await page.waitForTimeout(650);
  await page.mouse.move(x + 80, y - 25, { steps: 12 }); await page.mouse.up({ button: "right" });
  await page.mouse.wheel(0, -120); await page.waitForTimeout(800);
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  record("Held pan, orbit and wheel remain connected across shared-state updates");

  await page.selectOption("#lab-dataset", "dense");
  await waitReady(); await page.waitForTimeout(1000);
  assert.equal(await page.locator(".lab-buildings button").count(), 120);
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  await page.getByRole("button", { name: "Neighbourhood", exact: true }).click();
  await waitReady(); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, "05-dense-shared-compiler.png") });
  record("A different 120-building layout uses the same compiler, viewer and bounded tile loader");
  await page.selectOption("#lab-dataset", "garden");
  await waitReady(); await page.waitForTimeout(700);
  assert.equal(await page.locator("[data-selected-entity]").getAttribute("data-selected-entity"), "calibration-garden:building-2");
  assert.equal(await page.locator("[data-map-runtime-id]").count(), 1);
  record("Dataset return restores its scoped canonical selection without duplicated runtimes");

  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(700);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "06-desktop-1280.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(700);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "07-narrow-layout.png") });
  record("Viewport resize retains a single map and avoids horizontal document overflow");
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  assert.equal(report.badResponses.length, 0, JSON.stringify(report.badResponses));
  record("No uncaught browser exceptions or failed application/tile responses");
} catch (error) {
  report.tests.push({ name: "Browser suite", passed: false, error: error.stack || String(error) });
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, "browser-results.json"), JSON.stringify(report, null, 2));
  await browser?.close();
  server?.kill("SIGTERM");
}
console.log(JSON.stringify({ tests: report.tests.length, passed: report.tests.filter(t => t.passed).length, errors: report.errors, output }));
