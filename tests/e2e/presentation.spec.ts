import { test, expect, type APIRequestContext } from "@playwright/test";
import type {
  CaseDetail,
  CaseRecord,
} from "../../packages/contracts/src/index";

async function getCase(
  request: APIRequestContext,
  id: string,
): Promise<CaseDetail> {
  const response = await request.get(`/api/v1/cases/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(`/api/v1${path}`, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function buildFixture(
  request: APIRequestContext,
  dataset: "c001" | "c002",
) {
  const created = (await post(request, "/cases", {
    name: `Architectural presentation · ${dataset.toUpperCase()}`,
  })) as CaseRecord;
  const path = `/cases/${created.id}`;
  await post(request, `${path}/demo-inputs`, { dataset });
  await expect
    .poll(
      async () => {
        const detail = await getCase(request, created.id);
        return (
          detail.sources.length === 5 &&
          detail.sources.every((source) =>
            ["ready", "needs_input"].includes(source.status),
          )
        );
      },
      { timeout: 40_000 },
    )
    .toBeTruthy();
  let detail = await getCase(request, created.id);
  const source = (profile: string) =>
    detail.sources.find((item) => item.profile === profile)!.id;
  await post(request, `${path}/prepare`, {
    spatialSourceId: source("parcel-local-json-v1"),
    levelSourceId: source("levels-csv-v1"),
    controlSourceId: source("control-csv-v1"),
  });
  detail = await getCase(request, created.id);
  await post(request, `${path}/build`, {
    expectedRevision: detail.case.revision,
  });
  await expect
    .poll(
      async () => (await getCase(request, created.id)).model?.units.length,
      { timeout: 40_000 },
    )
    .toBe(dataset === "c001" ? 7 : 5);
  return getCase(request, created.id);
}

for (const dataset of ["c001", "c002"] as const) {
  test(`${dataset}: architectural presentation preserves exact property geometry`, async ({
    page,
    request,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const before = await buildFixture(request, dataset);
    await page.goto(`/?case=${before.case.id}`);
    const viewer = page.locator("[data-presentation]");
    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect(viewer).toHaveAttribute("data-presentation", "building");
    await expect(
      page.getByRole("group", { name: "3D presentation" }),
    ).toHaveCSS("position", "absolute");
    await expect(page.getByText(/Conceptual façade/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("building.png") });
    if (dataset === "c001") {
      await expect(viewer).toHaveAttribute("data-basement-revealed", "false");
      await page
        .getByRole("button", { name: "Reveal basement", exact: true })
        .click();
      await expect(viewer).toHaveAttribute("data-basement-revealed", "true");
      await expect(viewer).toHaveAttribute("data-visible-unit-count", "7");
      await page.screenshot({ path: info.outputPath("basement-section.png") });
      await page
        .getByRole("button", { name: "Reveal basement", exact: true })
        .click();
      await expect(viewer).toHaveAttribute("data-basement-revealed", "false");
    }

    await page
      .getByRole("button", { name: "Property volumes", exact: true })
      .click();
    await expect(viewer).toHaveAttribute("data-presentation", "volumes");
    await page.screenshot({ path: info.outputPath("property-volumes.png") });
    await page.getByRole("button", { name: "Building", exact: true }).click();
    await expect(viewer).toHaveAttribute("data-presentation", "building");

    const upper = before.units.find(
      (unit) => unit.lower != null && unit.lower > 0 && unit.kind !== "common",
    )!;
    await page
      .getByRole("button", { name: new RegExp(`^${upper.alias} `) })
      .click();
    await page.getByLabel("Visible floor").selectOption(upper.levelLabel);
    await page
      .getByRole("button", { name: "Isolate selected space", exact: true })
      .click();
    await expect(viewer).toHaveAttribute("data-visible-unit-count", "1");
    await page.getByLabel("Separate floors visually").focus();
    await page.keyboard.press("End");
    await page
      .getByRole("button", { name: "Reset camera", exact: true })
      .click();
    await expect(canvas).toBeVisible();
    await page.screenshot({ path: info.outputPath("isolated-space.png") });
    await page
      .getByRole("button", { name: "Isolate selected space", exact: true })
      .click();
    await page.getByLabel("Visible floor").selectOption("all");
    await page.getByLabel("Separate floors visually").focus();
    await page.keyboard.press("Home");

    await page.getByRole("button", { name: "Checks", exact: true }).click();
    await page
      .getByRole("button", { name: /shared volume/ })
      .first()
      .click();
    await expect(viewer).toHaveAttribute("data-presentation", "volumes");
    await expect(page.locator(".overlap-label")).toContainText(
      dataset === "c001" ? "6.4" : "14.4",
    );
    await page.screenshot({ path: info.outputPath("analytical-overlap.png") });
    await page.getByRole("button", { name: "Building", exact: true }).click();
    await expect(viewer).toHaveAttribute("data-presentation", "building");
    await page
      .getByRole("button", { name: /shared volume/ })
      .first()
      .click();
    await expect(viewer).toHaveAttribute("data-presentation", "volumes");
    const after = await getCase(request, before.case.id);
    expect(after.case.revision).toBe(before.case.revision);
    expect(after.units).toEqual(before.units);
    expect(after.sources).toEqual(before.sources);
    expect(after.model).toEqual(before.model);
    if (dataset === "c001") {
      await page.reload();
      await expect(canvas).toBeVisible();
      const widthBefore = (await canvas.boundingBox())!.width;
      await page
        .getByRole("button", { name: "Focus model", exact: true })
        .click();
      await expect
        .poll(async () => (await canvas.boundingBox())!.width)
        .toBeGreaterThan(widthBefore + 100);
      await page
        .getByRole("button", { name: "Exit model focus", exact: true })
        .click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(canvas).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await page.screenshot({ path: info.outputPath("narrow-building.png") });
      await page
        .getByRole("button", { name: "Create new case", exact: true })
        .click();
      await expect(page.getByLabel("Workspace name")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByLabel("Workspace name")).toBeHidden();
    }
    expect(errors).toEqual([]);
    await info.attach("unchanged-model", {
      body: JSON.stringify({
        caseId: before.case.id,
        snapshotId: before.model!.id,
        revision: after.case.revision,
        unitCount: after.model!.units.length,
        dataset,
      }),
      contentType: "application/json",
    });
  });
}
