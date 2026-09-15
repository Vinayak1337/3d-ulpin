/** Browser acceptance against actual local services. No mocked routes, AI or geometry. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
const ids = JSON.parse(
  await readFile("fixtures/reference-neighborhood/installed.json", "utf8"),
);
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000",
  dir = "docs/evidence/reference";
await mkdir(dir, { recursive: true });
const executable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(executable) ? { executablePath: executable } : {}),
  args: [
    "--enable-webgl",
    process.env.PLAYWRIGHT_ANGLE
      ? `--use-angle=${process.env.PLAYWRIGHT_ANGLE}`
      : `--use-angle=${process.platform === "darwin" ? "metal" : "swiftshader"}`,
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
let page = await context.newPage();
const report: {
  checks: { name: string; result: string; detail?: string }[];
  errors: string[];
  warnings: string[];
} = { checks: [], errors: [], warnings: [] };
function preparePage() {
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "warning" && !report.warnings.includes(msg.text()))
      report.warnings.push(msg.text());
  });
}
preparePage();
const A = ids.properties.A.buildingId,
  B = ids.properties.B.buildingId,
  D = ids.properties.D.buildingId,
  area = ids.areaId;
const block = `/blocks/${area}?feature=${A}`,
  register = `/properties/${A}/register?area=${area}`,
  workspace = `/properties/${A}/workspace?area=${area}`;
async function go(path: string) {
  await page.goto(base + path);
  await page.locator(".ui-topbar").waitFor();
}
async function capture(name: string) {
  for (const label of [
    "Loading register…",
    "Opening building…",
    "Loading block context…",
  ]) {
    const loading = page.getByText(label, { exact: true });
    if (await loading.count())
      await loading.waitFor({ state: "hidden", timeout: 45000 });
  }
  const propertyScene = page.locator(
    ".property-scene:not(.property-scene--compact)",
  );
  if (await propertyScene.count())
    await propertyScene
      .locator(".area-cesium-host")
      .waitFor({ timeout: 45000 });
  const host = page.locator(".area-cesium-host:visible");
  if (await host.count())
    await expect(host.first()).toHaveAttribute("data-scene-ready", "true", {
      timeout: 45000,
    });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/${name}.png`, timeout: 45000 });
}
async function check(name: string, action: () => Promise<void>) {
  try {
    await action();
    report.checks.push({ name, result: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, result: "FAIL", detail: String(error) });
    console.error(`FAIL ${name}: ${error}`);
    await capture(`failure-${report.checks.length}`).catch(() => {});
  }
  await writeFile(
    `${dir}/browser-report.json`,
    JSON.stringify(report, null, 2),
  );
  await page.close();
  page = await context.newPage();
  preparePage();
}
const main = () => page.getByRole("navigation", { name: "Main navigation" });
await check(
  "Directory destinations remain fixed after selecting a property",
  async () => {
    await go(block);
    await page
      .getByRole("heading", { name: "12 Lake View Road", exact: true })
      .waitFor();
    for (const [name, path] of [
      ["Block Map", "/blocks"],
      ["Property Register", "/register"],
      ["Plan Workspace", "/workspace"],
    ]) {
      await expect(
        main().getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", path);
      await main().getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(base + path);
      await capture(
        name === "Block Map"
          ? "block-directory"
          : name === "Property Register"
            ? "register-directory"
            : "workspace-directory",
      );
    }
  },
);
await check(
  "Shared block → same register, floors, plans → same block; reload and history",
  async () => {
    await go(block);
    await page
      .getByRole("heading", { name: "12 Lake View Road", exact: true })
      .waitFor();
    await page.locator("canvas").first().waitFor();
    await capture("block-1440");
    const cameraBefore = await page.evaluate(() =>
      sessionStorage.getItem(
        `ulpin-area-camera:v3:block:${location.pathname.split("/").at(-1)}`,
      ),
    );
    await page
      .getByRole("link", { name: "Open register", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/properties/${A}/register`));
    await page
      .getByRole("heading", { name: "Building & floors", exact: true })
      .waitFor();
    await capture("register-1440");
    await page.getByRole("button", { name: /^Ground 5 spaces/ }).click();
    await expect(page).toHaveURL(/record=/);
    await page
      .getByRole("heading", { name: "Unit register", exact: true })
      .waitFor();
    const selected = new URL(page.url()).searchParams.get("record");
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`record=${selected}`));
    await capture("floors-and-units");
    await page
      .getByRole("link", { name: "Open Workspace", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/properties/${A}/workspace`));
    await page
      .getByRole("heading", { name: "Measurements", exact: true })
      .waitFor();
    await page
      .getByRole("img", { name: /A-floor-plans.pdf; drag to pan/ })
      .waitFor();
    await capture("workspace-1440");
    await page.getByRole("button", { name: "Floor 1", exact: true }).click();
    await expect(page).toHaveURL(/source=/);
    const source = new URL(page.url()).searchParams.get("source");
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`source=${source}`));
    await page
      .getByRole("img", { name: /A-floor-1.png; drag to pan/ })
      .waitFor();
    await page.getByRole("link", { name: /Property register/ }).click();
    await page
      .getByRole("link", { name: "Back to Block", exact: true })
      .click();
    await expect(page).toHaveURL(base + block);
    await page
      .getByRole("heading", { name: "12 Lake View Road", exact: true })
      .waitFor();
    if (cameraBefore) {
      const after = await page.evaluate(
        (key) => sessionStorage.getItem(key),
        `ulpin-area-camera:v3:block:${area}`,
      );
      const beforeCamera = JSON.parse(cameraBefore),
        afterCamera = JSON.parse(after || "{}");
      for (const key of Object.keys(beforeCamera))
        expect(afterCamera[key]).toBeCloseTo(
          beforeCamera[key],
          key === "height" ? 3 : 8,
        );
    }
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/properties/${A}/register`));
    await page.goForward();
    await expect(page).toHaveURL(base + block);
  },
);
await check(
  "Picking a building in the actual 3D canvas preserves its canonical identity",
  async () => {
    await go(block);
    await page
      .getByRole("heading", { name: "12 Lake View Road", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: /18 Lake View Road building/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`feature=${B}`));
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw Error("No interactive canvas");
    await page.mouse.click(box.x + box.width * 0.24, box.y + box.height * 0.56);
    await expect(page).toHaveURL(new RegExp(`feature=${A}`));
    await expect(
      page.getByRole("link", { name: "Open register", exact: true }),
    ).toHaveAttribute("href", register);
    await capture("scene-picking");
  },
);
await check(
  "Picking a recorded space in the floor stack opens that same property record",
  async () => {
    await go(register);
    await capture("floor-stack-ready");
    const canvas = page.locator(".property-scene .cesium-widget canvas");
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await canvas.click({
      position: { x: box!.width * 0.5, y: box!.height * 0.55 },
    });
    await expect(page).toHaveURL(/record=/);
    expect(page.url()).toContain(`/properties/${A}/register`);
    const selected = new URL(page.url()).searchParams.get("record");
    const dossier = await (
      await page.request.get(`${base}/api/v1/buildings/${A}/dossier`)
    ).json();
    expect(
      dossier.records.find((record: { id: string }) => record.id === selected)
        ?.kind,
    ).toBe("space");
    await capture("floor-stack-picking");
  },
);
await check(
  "Global address search changes canonical property and closes with keyboard",
  async () => {
    await go(register);
    await capture("search-ready");
    await page.keyboard.press("Control+k");
    await page
      .getByRole("textbox", { name: "Property identifier", exact: true })
      .fill("18 Lake View Road");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /18 Lake View Road/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/properties/${B}/register`));
    await expect(
      page.getByRole("heading", { name: "18 Lake View Road", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
);
await check(
  "Original PDF calibration and measurement use the drawn 20 m dimension",
  async () => {
    await go(workspace);
    await page
      .getByRole("img", { name: /A-floor-plans.pdf; drag to pan/ })
      .waitFor();
    await page.getByRole("tab", { name: "Calibrate", exact: true }).click();
    const svg = page.getByRole("img", {
      name: /A-floor-plans.pdf; click to add a point/,
    });
    await svg.locator("image").waitFor({ state: "visible" });
    const endpoints = () =>
      svg.evaluate((node) => {
        const el = node as SVGSVGElement;
        const img = el.querySelector("image")!;
        const scale = Number(img.getAttribute("width")) / 1000;
        return [
          [222.222222, 645],
          [777.777778, 645],
        ].map(([x, y]) => {
          const p = new DOMPoint(x * scale, y * scale).matrixTransform(
            el.getScreenCTM()!,
          );
          return { x: p.x, y: p.y };
        });
      });
    for (const p of await endpoints()) await page.mouse.click(p.x, p.y);
    await page.getByLabel("Known distance · metres").fill("20");
    await page
      .getByLabel("Dimension or control evidence")
      .fill(
        "Authored fictional A plan, sheet 1: 20.00 m dimension between exterior wall endpoints. Display measurement only.",
      );
    await page
      .getByRole("button", { name: "Apply calibration", exact: true })
      .click();
    await capture("workspace-calibrate");
    await page.getByRole("tab", { name: "Measure", exact: true }).click();
    await page.getByRole("button", { name: "Distance", exact: true }).click();
    for (const p of await endpoints()) await page.mouse.click(p.x, p.y);
    await expect(page.getByText(/^20(?:\.0+)? m$/).first()).toBeVisible();
    await capture("workspace-measure");
  },
);
await check(
  "Original comparison, reviewed draft, and honest assistance status",
  async () => {
    await go(workspace);
    await page.getByRole("tab", { name: "Compare", exact: true }).click();
    await page
      .getByLabel(/^Compare with/)
      .selectOption({ label: "A-floor-1.png" });
    await page
      .getByRole("button", { name: "Side by side", exact: true })
      .click();
    await capture("workspace-compare");
    await page.getByRole("tab", { name: "Build details", exact: true }).click();
    await page
      .getByRole("button", { name: "Build proposed 3D details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review proposed records", exact: true })
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Review proposed records", exact: true })
      .click();
    await page.getByRole("heading", { name: /proposed records/ }).waitFor();
    await page
      .getByRole("heading", { name: /proposed records/ })
      .scrollIntoViewIfNeeded();
    await capture("workspace-review");
    await page.locator(".assistance-panel summary").click();
    await page.locator(".assistance-panel").scrollIntoViewIfNeeded();
    await expect(page.locator(".assistance-panel")).toContainText(
      /unconfigured|not configured|missing|available|unavailable/i,
    );
    await capture("assistance-status");
  },
);
await check("Incomplete property and retained investigation", async () => {
  const dossier = await (
    await page.request.get(`${base}/api/v1/buildings/${D}/dossier`)
  ).json();
  const retainedCase = dossier.investigations.find(
    (item: { reference: string }) => item.reference === "LV-DEMO-001",
  );
  expect(retainedCase).toBeTruthy();
  await go(
    `/properties/${D}/register?area=${area}&tab=investigation&case=${retainedCase.id}`,
  );
  await page
    .getByRole("heading", { name: "LV-DEMO-001", exact: true })
    .waitFor();
  await capture("investigation");
  await go(`/properties/${D}/workspace?area=${area}&mode=build`);
  await page
    .getByRole("heading", { name: "Build details", exact: true })
    .waitFor();
  await capture("missing-inputs");
  await page
    .getByRole("button", { name: "Add documents", exact: true })
    .click();
  await page
    .locator('input[type=file][aria-label="Source documents"]')
    .setInputFiles("fixtures/reference-neighborhood/D-floor-0.png");
  const retained = page.waitForResponse(
    (response) =>
      response.url().includes("/documents") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Retain documents", exact: true })
    .click();
  expect((await retained).ok()).toBe(true);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: /D-floor-0.png/ })
    .last()
    .click();
  await capture("document-upload");
});
await check(
  "Block secondary states: layers, parcel, utility, photos, history and import",
  async () => {
    await go(block);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page.getByRole("button", { name: "2D Map", exact: true }).click();
    await capture("block-layers-2d");
    for (const [name, file] of [
      ["Parcel", "block-parcel"],
      ["Utility", "block-utility"],
      ["Photos", "block-photos"],
      ["History", "block-history"],
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await capture(file);
    }
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await capture("block-import");
    await page.keyboard.press("Escape");
  },
);
await check("Reference anchors at 1920 × 1080", async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await go(block);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await capture("block-1920");
  await go(register);
  await page
    .getByRole("heading", { name: "Building & floors", exact: true })
    .waitFor();
  await capture("register-1920");
  await go(workspace);
  await page
    .getByRole("img", { name: /A-floor-plans.pdf; drag to pan/ })
    .waitFor();
  await capture("workspace-1920");
});
await check(
  "Smaller screens, reachable global navigation, and no horizontal document overflow",
  async () => {
    for (const width of [800, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [name, path] of [
        ["block", block],
        ["register", register],
        ["workspace", workspace],
      ]) {
        await go(path);
        await page.waitForTimeout(2500);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await capture(`${name}-${width}`);
      }
      await main()
        .getByRole("link", { name: "Property Register", exact: true })
        .click();
      await expect(page).toHaveURL(base + "/register");
    }
  },
);
await check(
  "Historical links resolve identifiers without a second interface",
  async () => {
    for (const [old, target] of [
      [
        `/v2/properties/${A}/register?area=${area}`,
        `/properties/${A}/register?area=${area}`,
      ],
      [
        `/legacy/?case=${ids.properties.A.caseId}`,
        `/workspace/${ids.properties.A.caseId}?case=${ids.properties.A.caseId}`,
      ],
      [`/areas/${area}?feature=${A}`, block],
    ]) {
      await go(old);
      await expect(page).toHaveURL(base + target);
    }
    expect(await page.title()).not.toMatch(/v2/i);
  },
);
await browser.close();
await writeFile(
  `${dir}/browser-report.json`,
  JSON.stringify(report, null, 2) + "\n",
);
if (report.errors.length || report.checks.some((c) => c.result === "FAIL"))
  process.exitCode = 1;
