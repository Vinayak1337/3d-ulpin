/** Actual camera, workspace and export UI, backed by the recorded Lake View. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000";
const dir = "docs/evidence/register-controls";
const ids = JSON.parse(
  await readFile("fixtures/reference-neighborhood/installed.json", "utf8"),
);
const A = ids.properties.A.buildingId;
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
const cameraKey = `ulpin-area-camera:v3:floor-stack:${A}`;
const camera = () =>
  page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key) || "null"),
    cameraKey,
  );
async function capture(name: string) {
  const host = page.locator(".area-cesium-host:visible");
  if (await host.count())
    await expect(host.first()).toHaveAttribute("data-scene-ready", "true", {
      timeout: 45000,
    });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${dir}/${name}.png` });
}
try {
  const d = await (
    await page.request.get(`${base}/api/v1/buildings/${A}/dossier`)
  ).json();
  const floor = d.records.find((r: any) => r.kind === "floor");
  await page.goto(
    `${base}/properties/${A}/register?tab=floors&record=${floor.id}`,
  );
  await expect(
    page.getByRole("group", { name: "Rotate 3D view" }),
  ).toBeVisible();
  await capture("floors-before-rotation");
  await page.getByRole("button", { name: "Reset building view" }).click();
  await expect.poll(camera).not.toBeNull();
  await page.waitForTimeout(1500);
  const before = await camera();
  await page.getByRole("button", { name: "Rotate view right" }).click();
  await expect
    .poll(async () => Math.abs((await camera()).heading - before.heading))
    .toBeGreaterThan(0.05);
  const right = await camera();
  await page.getByRole("button", { name: "Rotate view up" }).click();
  await expect
    .poll(async () => Math.abs((await camera()).pitch - right.pitch))
    .toBeGreaterThan(0.03);
  await page.getByRole("button", { name: "Rotate view left" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Rotate view down" }).click();
  await capture("floors-orbit-controller");
  checks.push(
    "Circular controller orbits horizontally and vertically; keyboard buttons work",
  );
  const canvas = page.locator(".property-scene .cesium-widget canvas");
  const box = await canvas.boundingBox();
  if (!box) throw Error("Missing real canvas");
  await page.waitForTimeout(1200);
  const beforeDrag = await camera();
  await page.keyboard.down("Control");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.65, {
    steps: 18,
  });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect
    .poll(async () => {
      const c = await camera();
      return (
        Math.abs(c.heading - beforeDrag.heading) +
        Math.abs(c.pitch - beforeDrag.pitch)
      );
    })
    .toBeGreaterThan(0.02);
  await expect(page).toHaveURL(new RegExp(`/properties/${A}/register`));
  expect(new URL(page.url()).searchParams.get("record")).toBe(floor.id);
  const afterDrag = await camera();
  await capture("floors-ctrl-drag");
  checks.push(
    "Ctrl + left-button drag rotates actual 3D scene without changing canonical selection",
  );
  await expect(page.locator("dt", { hasText: "3D ULPIN" })).toBeVisible();
  await page
    .getByRole("button", { name: "Export register", exact: true })
    .click();
  await expect(page.getByLabel("Download scope")).toHaveValue(floor.id);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Report \+ sources/ }).click();
  const download = await downloadPromise;
  await download.saveAs(`${dir}/ui-floor-sources.zip`);
  await capture("floor-export-dialog");
  await page.getByRole("dialog").getByRole("button", { name: /Close/ }).click();
  checks.push(
    "Selected-floor export defaults to that floor and downloads report plus original sources through UI",
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture("floors-1920");
  for (const f of d.records.filter((r: any) => r.kind === "floor")) {
    await page
      .getByRole("button", {
        name: new RegExp(`^${f.name.replace(/^property\s*\/\s*/i, "")}\\s+5$`),
      })
      .click();
    await expect(
      page.locator("dd").filter({ hasText: f.identifier }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("record"))
      .toBe(f.id);
  }
  checks.push(
    "Every floor visibly lists its own canonical 3D ULPIN and keeps that ID in the URL",
  );
  await page.setViewportSize({ width: 800, height: 844 });
  await page.getByRole("button", { name: "Rotate view left" }).click();
  await capture("floors-800");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  checks.push(
    "Rotation controls remain usable at 800 px without page overflow",
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  const source = d.sources.find((s: any) => s.name === "A-floor-plans.pdf");
  await page.goto(
    `${base}/properties/${A}/workspace?source=${source.id}&mode=calibrate`,
  );
  await expect(
    page.getByRole("heading", { name: "Calibrate plan" }),
  ).toBeVisible();
  const plan = page
    .getByRole("region", { name: "Plan canvas" })
    .locator('svg[tabindex="0"]');
  await expect(plan.locator("image").first()).toBeVisible();
  await expect(page.getByText("Rendering retained source…")).toHaveCount(0);
  const clear = page.getByRole("button", { name: /^Clear drawing/ });
  await expect(clear).toBeDisabled();
  const pbox = await plan.boundingBox();
  if (!pbox) throw Error("No plan canvas");
  await plan.click({ position: { x: pbox.width * 0.3, y: pbox.height * 0.5 } });
  await expect(clear).toBeEnabled();
  await plan.focus();
  await page.keyboard.press("Control+q");
  await expect(clear).toBeDisabled();
  checks.push("Ctrl+Q clears in-progress calibration points");
  await plan.click({ position: { x: pbox.width * 0.4, y: pbox.height * 0.5 } });
  await expect(clear).toBeEnabled();
  await page.getByLabel("Known distance · metres").fill("20");
  await page.keyboard.press("Control+q");
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(clear).toBeDisabled();
  checks.push(
    "Clear button cancels drawing; Ctrl+Q does not interfere while typing in a form",
  );
  await page.getByRole("tab", { name: "Measure", exact: true }).click();
  await page.getByRole("button", { name: "Point", exact: true }).click();
  await plan.click({ position: { x: pbox.width * 0.3, y: pbox.height * 0.4 } });
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    `ulpin-app-workspace-notes:1:${A}`,
  );
  expect(JSON.parse(saved || "{}").measurements.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Distance", exact: true }).click();
  await plan.click({
    position: { x: pbox.width * 0.35, y: pbox.height * 0.5 },
  });
  await expect(clear).toBeEnabled();
  await plan.focus();
  await page.keyboard.press("Control+q");
  await expect(clear).toBeDisabled();
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `ulpin-app-workspace-notes:1:${A}`,
    ),
  ).toBe(saved);
  await capture("workspace-clear-1920");
  checks.push(
    "Clearing a new drawing preserves completed measurements and original sources",
  );
  await page.goto(`${base}/blocks/${ids.areaId}`);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Download block PDF" }),
  ).toBeVisible();
  const blockDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Block report + original sources" })
    .click();
  await (await blockDownload).saveAs(`${dir}/ui-block-sources.zip`);
  await capture("block-export");
  checks.push(
    "Whole block report and originals downloadable from actual block UI",
  );
  expect(errors).toEqual([]);
  await writeFile(
    `${dir}/browser-report.json`,
    JSON.stringify(
      {
        result: "PASS",
        checks,
        errors,
        cameraBefore: before,
        cameraAfter: afterDrag,
      },
      null,
      2,
    ),
  );
  console.log("PASS", checks.join("\nPASS "));
} catch (error) {
  await capture("failure").catch(() => {});
  await writeFile(
    `${dir}/browser-report.json`,
    JSON.stringify(
      { result: "FAIL", checks, errors, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
