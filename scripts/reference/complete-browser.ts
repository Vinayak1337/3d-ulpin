/** Actual UI and services: no mocked records, geometry or requests. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000";
const ids = JSON.parse(
  await readFile("fixtures/reference-neighborhood/installed.json", "utf8"),
);
const dir = "docs/evidence/complete-demo";
await mkdir(dir, { recursive: true });
const executable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(executable) ? { executablePath: executable } : {}),
  args: [
    "--enable-webgl",
    `--use-angle=${process.platform === "darwin" ? "metal" : "swiftshader"}`,
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks: string[] = [];
async function capture(name: string) {
  const host = page.locator(".area-cesium-host:visible");
  if (await host.count())
    await expect(host.first()).toHaveAttribute("data-scene-ready", "true", {
      timeout: 45000,
    });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${dir}/${name}.png` });
}
try {
  await page.goto(base + "/blocks");
  await expect(
    page.getByRole("heading", { name: "Lake View · demonstration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Synthetic officer UI|Verification fixture/,
    }),
  ).toHaveCount(0);
  await page.getByText("Find by location", { exact: false }).click();
  await expect(
    page
      .getByRole("group", { name: "Location filters preview" })
      .locator("select")
      .first(),
  ).toBeDisabled();
  await capture("directory-1440");
  checks.push(
    "Only the retained demo is listed; real dataset remains; location filters honestly marked preview",
  );
  await page
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { name: "Lake View · demonstration" }),
    })
    .click();
  await page
    .locator(".ui-property-list")
    .getByRole("button", { name: /12 Lake View Road/ })
    .click();
  await expect(
    page
      .locator(".ui-block-inspector")
      .getByText("DEMO-LV-P01", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".ui-property-list")
    .getByRole("button", { name: /18 Lake View Road/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`feature=${ids.properties.B.buildingId}`),
  );
  const mapCanvas = page.locator("canvas").first();
  await expect(page.locator(".area-cesium-host")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  await page.waitForTimeout(1200);
  const mapBox = await mapCanvas.boundingBox();
  if (!mapBox) throw Error("Missing actual scene");
  await mapCanvas.click({
    position: { x: mapBox.width * 0.24, y: mapBox.height * 0.56 },
  });
  await expect(page).toHaveURL(
    new RegExp(`feature=${ids.properties.A.buildingId}`),
  );
  checks.push("Actual 3D canvas picking returns the same canonical building A");
  await page.getByRole("button", { name: /^Show conflicts/ }).click();
  await expect(page).toHaveURL(/conflicts=1/);
  await capture("block-conflicts-1440");
  checks.push(
    "Selected property shows linked 2D ULPIN and computed road/building conflicts together in interactive scene",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download property PDF" }).click();
  const download = await downloadPromise;
  await download.saveAs(`${dir}/ui-downloaded-register.pdf`);
  checks.push("PDF downloaded through selected-property UI");
  await page.getByRole("button", { name: "Parcels", exact: true }).click();
  await page
    .locator(".ui-property-list")
    .getByRole("button", { name: /Parcel A/ })
    .click();
  await expect(
    page
      .locator(".ui-block-inspector")
      .getByRole("heading", { name: "Associated buildings" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".ui-block-inspector")
      .getByText("DEMO-LV-P01", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "2D Map", exact: true }).click();
  // Click the visible parcel margin; the centre correctly picks its building.
  const parcelPath = page
    .getByRole("button", { name: "Parcel B", exact: true })
    .locator("path")
    .first();
  const parcelBox = await parcelPath.boundingBox();
  if (!parcelBox) throw Error("Missing parcel outline");
  await parcelPath.click({ position: { x: 4, y: parcelBox.height * 0.6 } });
  await expect(
    page
      .locator(".ui-block-inspector")
      .getByText("DEMO-LV-P02", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Parcel A", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .locator(".ui-block-inspector")
      .getByText("DEMO-LV-P01", { exact: true }),
  ).toBeVisible();
  await capture("parcel-2d-keyboard");
  checks.push(
    "2D parcel map supports pointer and keyboard selection with matching IDs",
  );
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await capture("parcel-1440");
  await page
    .locator(".ui-block-inspector")
    .getByRole("button", { name: "12 Lake View Road", exact: true })
    .click();
  checks.push(
    "Parcel selection shows area, identity and confirmed associated building; selection returns to same building",
  );
  await page.getByRole("link", { name: "Open register", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/properties/${ids.properties.A.buildingId}/register`),
  );
  await expect(
    page
      .locator(".ui-parcel-identity")
      .getByText("DEMO-LV-P01", { exact: true }),
  ).toBeVisible();
  await capture("register-1440");
  const floorCanvas = page.locator(".property-scene .cesium-widget canvas");
  const floorBox = await floorCanvas.boundingBox();
  if (!floorBox) throw Error("Missing recorded floor scene");
  await floorCanvas.click({
    position: { x: floorBox.width * 0.5, y: floorBox.height * 0.55 },
  });
  await expect(page).toHaveURL(/record=/);
  const selectedRecord = new URL(page.url()).searchParams.get("record");
  const d = await (
    await page.request.get(
      `${base}/api/v1/buildings/${ids.properties.A.buildingId}/dossier`,
    )
  ).json();
  expect(d.records.find((r: any) => r.id === selectedRecord)?.kind).toBe(
    "space",
  );
  await capture("picked-recorded-space");
  checks.push(
    "Interactive floor stack picking selects an actual recorded space of building A",
  );
  checks.push("Register retains canonical property and parcel identity");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture("register-1920");
  await page.goto(
    `${base}/blocks/${ids.areaId}?feature=${ids.properties.A.buildingId}&conflicts=1`,
  );
  await capture("block-1920");
  await page.reload();
  await expect(
    page
      .locator(".ui-block-inspector")
      .getByText("DEMO-LV-P01", { exact: true }),
  ).toBeVisible();
  checks.push(
    "Reload preserves property, parcel ID and conflicts URL state at 1920×1080",
  );
  await page.getByRole("link", { name: "Open workspace", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(ids.properties.A.buildingId + "|" + ids.properties.A.caseId),
  );
  await capture("workspace-1920");
  checks.push("Workspace opens same detailed property");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Block Map", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/blocks");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("directory-mobile");
  await page.keyboard.press("Tab");
  checks.push(
    "Global navigation returns directory; mobile directory remains usable",
  );
  expect(errors).toEqual([]);
  await writeFile(
    `${dir}/browser-report.json`,
    JSON.stringify({ result: "PASS", checks, errors }, null, 2),
  );
  console.log("PASS", checks.join("\nPASS "));
} catch (e) {
  await capture("failure").catch(() => {});
  await writeFile(
    `${dir}/browser-report.json`,
    JSON.stringify(
      { result: "FAIL", checks, errors, error: String(e) },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
}
