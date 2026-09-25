import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cameraDelta, readCamera } from "./usp-camera";

async function frameGeometry(page: import("@playwright/test").Page, label: string) {
  return page.evaluate(label => {
    const names = [
      '.city-search', '.city-dataset > button', '.city-theme-toggle',
      '.city-header-actions button[aria-label="Local workspace status"]',
      '.city-mobile-menu', '.ui-block-title > a',
      '.ui-context-actions .ui-button', '.ui-map-mode button',
      '.ui-panel-switches button', '.ui-map-toolbar > .ui-button',
    ];
    const targets = names.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]).filter(element => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && !element.closest("[inert]");
    }).map(element => {
      const box = element.getBoundingClientRect();
      const center = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { name: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 32) || element.className,
        width: box.width, height: box.height, x: box.x, right: box.right,
        hit: !!center && (element === center || element.contains(center)) };
    });
    return { label, viewport: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      targets };
  }, label);
}

async function contrast(page: import("@playwright/test").Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const channels = (value: string) => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => {
      const v = value / 255;
      return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const foreground = channels(getComputedStyle(element).color);
    let background = [255, 255, 255];
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    for (const node of ancestors) {
      const values = channels(getComputedStyle(node).backgroundColor);
      if (values.length >= 3) {
        const alpha = values[3] ?? 1;
        background = values.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
      }
    }
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return { text: getComputedStyle(element).color, background, ratio: (light + .05) / (dark + .05) };
  });
}

const receiptFile = process.env.ULPIN_D0_RECEIPT_FILE;
test.skip(!receiptFile, "Requires the isolated D0 Studio fixture");

test("UI-02 frame keeps one scene and selection across panels, tray, theme and phone", async ({ page, request }) => {
  const receipt = JSON.parse(await readFile(receiptFile!, "utf8"));
  const buildingId = receipt.physicalFeatures["B-A"];
  const area = await (await request.get(`/api/v1/areas/${receipt.areaId}/context`)).json();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const screenshots = process.env.ULPIN_UI02_SCREENSHOT_DIR;
  const measurements: unknown[] = [];
  if (screenshots) await mkdir(screenshots, { recursive: true });
  await page.goto(`/studio/areas/${receipt.areaId}?feature=${buildingId}`);
  const scene = page.locator("[data-tile-canvas]");
  await expect(scene).toHaveAttribute("data-scene-ready", "true");
  const runtime = page.locator("[data-map-runtime-id]");
  await expect(runtime).toHaveCount(1);
  const runtimeId = await runtime.getAttribute("data-map-runtime-id");
  const camera = await readCamera(scene);
  const scope = page.getByLabel("Area scope");
  await expect(scope).toContainText(area.area.name);
  await expect(scope).toContainText(`Revision ${area.area.revision}`);
  await expect(scope).toContainText(area.features.find((feature: { id: string }) => feature.id === buildingId).name);
  await expect(page.locator("[data-product-header]")).toHaveCSS("height", "56px");
  await expect(page.getByRole("navigation", { name: "Product sections" })).toContainText("Batches");
  await expect(page.getByRole("navigation", { name: "Product sections" })).toContainText("Map");
  await expect(page.getByRole("navigation", { name: "Product sections" })).toContainText("Register");
  await expect(page.getByRole("complementary", { name: /panel$/ })).toHaveCount(0);
  await expect(page.getByLabel("Workspace snapshot status unavailable")).toContainText("Status unavailable");
  expect(await page.getByLabel("Workspace snapshot status unavailable").textContent()).not.toContain("Snapshot");
  measurements.push(await frameGeometry(page, "1440-light"));
  const lightCoverage = await contrast(page, ".ui-source-details summary");
  expect(lightCoverage.ratio).toBeGreaterThanOrEqual(4.5);
  measurements.push({ label: "light-evidence-coverage", ...lightCoverage });
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-selected-light-1440.png") });

  for (const name of ["Layers", "Spaces", "Sources", "Checks"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    await expect(page.getByRole("complementary", { name: `${name} panel` })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /panel$/ })).toHaveCount(1);
    await expect(runtime).toHaveAttribute("data-map-runtime-id", runtimeId!);
    await expect.poll(async () => cameraDelta(camera, await readCamera(scene))).toBeLessThan(1);
    await expect(page).toHaveURL(new RegExp(`feature=${buildingId}`));
    if (name === "Layers") {
      const layerContrast = await contrast(page, ".saved-layer-opacity summary");
      expect(layerContrast.ratio).toBeGreaterThanOrEqual(4.5);
      measurements.push({ label: "light-layer-appearance", ...layerContrast });
      if (screenshots) await page.screenshot({ path: join(screenshots, "d0-layers-light-1440.png") });
    }
    if (name === "Sources") {
      await expect(page.getByRole("complementary", { name: "Sources panel" })).toContainText("Revision");
    }
    await page.getByRole("button", { name: `Close ${name.toLowerCase()} panel` }).click();
    await expect(page.getByRole("button", { name, exact: true }).first()).toBeFocused();
  }
  await page.getByRole("button", { name: "2D Map", exact: true }).click();
  await expect(page.getByRole("button", { name: "2D Map", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(runtime).toHaveAttribute("data-map-runtime-id", runtimeId!);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(scene).toHaveAttribute("data-scene-ready", "true");
  await expect.poll(async () => cameraDelta(camera, await readCamera(scene))).toBeLessThan(1);
  await page.getByRole("button", { name: /Open documents \(/ }).click();
  await page.locator(".quick-evidence .quick-source").first().click();
  await expect(page.getByRole("dialog", { name: "Original property evidence" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Context inspector" })).toHaveAttribute("data-evidence-open", "true");
  await expect.poll(async () => (await page.getByRole("complementary", { name: "Context inspector" }).boundingBox())?.width).toBe(400);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(async () => (await page.getByRole("complementary", { name: "Context inspector" }).boundingBox())?.width).toBe(360);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Block findings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Block findings" })).toHaveCSS("height", "172px");
  await page.getByRole("button", { name: "Close findings" }).click();
  await expect(page.getByRole("region", { name: "Block findings" })).toHaveCount(0);

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator(".ulpin-app")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const darkLayer = await contrast(page, ".saved-layer-opacity summary");
  expect(darkLayer.ratio).toBeGreaterThanOrEqual(4.5);
  measurements.push({ label: "dark-layer-appearance", ...darkLayer });
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-layers-dark-1440.png") });
  // The panel and inspector remain mounted when desktop is resized to a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scope).toBeVisible();
  await expect(scope).toContainText(area.area.name);
  await expect(scope.getByRole("link", { name: "Add files" })).toBeVisible();
  await expect(scope.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(page.locator("[data-product-header]")).toHaveCSS("height", "56px");
  const scopeBounds = await scope.boundingBox();
  expect(scopeBounds).toBeTruthy();
  expect(scopeBounds!.y).toBeGreaterThanOrEqual(56);
  const sheet = page.getByRole("complementary", { name: "Layers panel" });
  await expect(sheet).toBeVisible();
  await expect(page.locator('.ui-block-inspector[data-sheet-hidden="true"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Close layers panel" })).toBeFocused();
  await expect(scope.getByRole("button", { name: "Back to map" })).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds!.width).toBeGreaterThanOrEqual(389);
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-layers-dark-390.png") });
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox", { name: "Search properties and record IDs" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Close layers panel" })).toBeFocused();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeFocused();
  const darkCoverage = await contrast(page, ".ui-source-details summary");
  expect(darkCoverage.ratio).toBeGreaterThanOrEqual(4.5);
  measurements.push({ label: "dark-evidence-coverage", ...darkCoverage });
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-selected-dark-390.png") });
  await page.getByRole("button", { name: /Open documents \(/ }).click();
  await page.locator(".quick-evidence .quick-source").first().click();
  await expect(page.getByRole("dialog", { name: "Original property evidence" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Original property evidence" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();
  await scope.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();
  await scope.getByRole("button", { name: "Back to map" }).click();
  await expect(page.getByRole("button", { name: "Close inspector" })).toHaveCount(0);
  measurements.push(await frameGeometry(page, "390-dark"));
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Spaces panel" })).toBeVisible();
  await page.getByRole("complementary", { name: "Spaces panel" }).locator(".ui-panel-list > button").first().click();
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeFocused();
  await scope.getByRole("button", { name: "Back to map" }).click();
  await expect(runtime).toHaveAttribute("data-map-runtime-id", runtimeId!);
  await expect(page).toHaveURL(new RegExp(`feature=${buildingId}`));

  for (const width of [620, 900]) {
    await page.setViewportSize({ width, height: 900 });
    measurements.push(await frameGeometry(page, `${width}-dark`));
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toBeVisible();
  await expect(scope).toBeVisible();
  measurements.push(await frameGeometry(page, "1440-zoom-200-dark"));
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const motion = await sheet.evaluate(element => getComputedStyle(element).transitionDuration);
  expect(motion).toBe("0s");
  await page.getByRole("button", { name: "Close layers panel" }).click();
  await page.reload();
  await expect(page.locator(".ulpin-app")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(new RegExp(`feature=${buildingId}`));
  let releaseDossier!: () => void;
  const dossierGate = new Promise<void>(resolve => { releaseDossier = resolve; });
  await page.route(`**/api/v1/buildings/${buildingId}/dossier`, async route => {
    await dossierGate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Source dossier temporarily unavailable" }) });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const sourcesPanel = page.getByRole("complementary", { name: "Sources panel" });
  await expect(sourcesPanel).toContainText("Loading source evidence");
  if (area.packages.length) await expect(sourcesPanel).toContainText(area.packages[0].name);
  releaseDossier();
  await expect(sourcesPanel).toContainText("Source evidence unavailable");
  await expect(sourcesPanel).not.toContainText("No sources in this scope");
  if (area.packages.length) await expect(sourcesPanel).toContainText(area.packages[0].name);
  await page.unroute(`**/api/v1/buildings/${buildingId}/dossier`);
  for (const item of measurements) {
    if (typeof item !== "object" || !item || !("targets" in item)) continue;
    const geometry = item as { label: string; overflow: number; targets: { name: string; width: number; height: number; x: number; right: number; hit: boolean }[] };
    expect(geometry.overflow, `${geometry.label} horizontal overflow`).toBeLessThanOrEqual(1);
    for (const target of geometry.targets) {
      expect(target.width, `${geometry.label}: ${target.name} width`).toBeGreaterThanOrEqual(43.5);
      expect(target.height, `${geometry.label}: ${target.name} height`).toBeGreaterThanOrEqual(43.5);
      expect(target.hit, `${geometry.label}: ${target.name} hit test`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
  if (screenshots) await writeFile(join(screenshots, "measurements.json"), JSON.stringify({ areaId: receipt.areaId, selectedFeatureId: buildingId, runtimeId, camera, measurements, pageErrors: errors }, null, 2) + "\n");
});
