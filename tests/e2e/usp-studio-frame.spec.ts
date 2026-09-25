import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cameraDelta, readCamera } from "./usp-camera";

const receiptFile = process.env.ULPIN_D0_RECEIPT_FILE;
test.skip(!receiptFile, "Requires the isolated D0 Studio fixture");

test("UI-02 frame keeps one scene and selection across panels, tray, theme and phone", async ({ page, request }) => {
  const receipt = JSON.parse(await readFile(receiptFile!, "utf8"));
  const buildingId = receipt.physicalFeatures["B-A"];
  const area = await (await request.get(`/api/v1/areas/${receipt.areaId}/context`)).json();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const screenshots = process.env.ULPIN_UI02_SCREENSHOT_DIR;
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
  await expect(page.locator("[data-product-header]")).toHaveCSS("height", "56px");
  await expect(page.getByRole("navigation", { name: "Product sections" })).toContainText("Batches");
  await expect(page.getByRole("navigation", { name: "Product sections" })).toContainText("Map");
  await expect(page.getByRole("navigation", { name: "Product sections" })).toContainText("Register");
  await expect(page.getByRole("complementary", { name: /panel$/ })).toHaveCount(0);
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-selected-light-1440.png") });

  for (const name of ["Layers", "Spaces", "Sources", "Checks"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    await expect(page.getByRole("complementary", { name: `${name} panel` })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /panel$/ })).toHaveCount(1);
    await expect(runtime).toHaveAttribute("data-map-runtime-id", runtimeId!);
    await expect.poll(async () => cameraDelta(camera, await readCamera(scene))).toBeLessThan(1);
    await expect(page).toHaveURL(new RegExp(`feature=${buildingId}`));
    if (name === "Layers" && screenshots) await page.screenshot({ path: join(screenshots, "d0-layers-light-1440.png") });
    await page.getByRole("button", { name: `Close ${name.toLowerCase()} panel` }).click();
    await expect(page.getByRole("button", { name, exact: true }).first()).toBeFocused();
  }
  await expect(page.getByRole("region", { name: "Block findings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Block findings" })).toHaveCSS("height", "172px");
  await page.getByRole("button", { name: "Close findings" }).click();
  await expect(page.getByRole("region", { name: "Block findings" })).toHaveCount(0);

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator(".ulpin-app")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-layers-dark-1440.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Layers panel" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toBeFocused();
  await expect(runtime).toHaveAttribute("data-map-runtime-id", runtimeId!);
  await expect.poll(async () => cameraDelta(camera, await readCamera(scene))).toBeLessThan(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scope).toBeVisible();
  await expect(scope).toContainText(area.area.name);
  await expect(scope.getByRole("link", { name: "Add files" })).toBeVisible();
  await expect(scope.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(page.locator("[data-product-header]")).toHaveCSS("height", "56px");
  const scopeBounds = await scope.boundingBox();
  expect(scopeBounds).toBeTruthy();
  expect(scopeBounds!.y).toBeGreaterThanOrEqual(56);
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-selected-dark-390.png") });
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const sheet = page.getByRole("complementary", { name: "Layers panel" });
  await expect(sheet).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds!.width).toBeGreaterThanOrEqual(389);
  if (screenshots) await page.screenshot({ path: join(screenshots, "d0-layers-dark-390.png") });
  await page.getByRole("button", { name: "Close layers panel" }).click();
  await expect(runtime).toHaveAttribute("data-map-runtime-id", runtimeId!);
  await expect(page).toHaveURL(new RegExp(`feature=${buildingId}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toBeVisible();
  await expect(scope).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const motion = await sheet.evaluate(element => getComputedStyle(element).transitionDuration);
  expect(motion).toBe("0s");
  await page.getByRole("button", { name: "Close layers panel" }).click();
  expect(errors).toEqual([]);
  if (screenshots) await writeFile(join(screenshots, "measurements.json"), JSON.stringify({ areaId: receipt.areaId, selectedFeatureId: buildingId, runtimeId, camera, pageErrors: errors }, null, 2) + "\n");
});
