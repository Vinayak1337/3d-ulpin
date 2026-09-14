import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type TestInfo,
} from "@playwright/test";
import type { CaseDetail } from "../../packages/contracts/src/index";
import path from "node:path";

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page), "No uncaught browser exceptions").toEqual([]);
});

async function detail(
  request: APIRequestContext,
  id: string,
): Promise<CaseDetail> {
  const response = await request.get(`/api/v1/cases/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createWorkspace(page: Page, name: string) {
  await page.goto("/workbench");
  // Start this workflow after the previous workspace's lazy 3D initialization.
  // Cold Cesium startup under SwiftShader can otherwise stall animation frames
  // while Playwright is checking the new-workspace dialog for stability.
  await expect(page.locator(".viewer-loading")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator(".viewer-error")).toHaveCount(0);
  if (await page.locator("[data-presentation]").count()) {
    await expect(page.locator(".cesium-widget canvas")).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(
    page.getByRole("button", { name: "Create new case", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create new case", exact: true })
    .click();
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("case");
  expect(id).toBeTruthy();
  return id!;
}

async function loadAndBuild(
  page: Page,
  request: APIRequestContext,
  dataset: "c001" | "c002",
  name: string,
) {
  const id = await createWorkspace(page, name);
  await page.getByLabel("Sample dataset").selectOption(dataset);
  await page.getByRole("button", { name: "Load sample inputs" }).click();
  await expect
    .poll(async () => {
      const current = await detail(request, id);
      return (
        current.sources.length === 5 &&
        current.sources.every((source) =>
          ["ready", "needs_input"].includes(source.status),
        )
      );
    })
    .toBeTruthy();
  let current = await detail(request, id);
  expect(current.units).toHaveLength(0);
  expect(current.model).toBeNull();
  await page
    .getByRole("button", { name: "Prepare geometry", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Prepare draft spaces" }).click();
  await expect
    .poll(async () => (await detail(request, id)).units.length)
    .toBe(dataset === "c001" ? 7 : 5);
  await page
    .getByRole("button", { name: "Build model", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => (await detail(request, id)).model?.units.length, {
      timeout: 40_000,
    })
    .toBe(dataset === "c001" ? 7 : 5);
  await expect(page.locator(".cesium-widget canvas")).toBeVisible();
  current = await detail(request, id);
  return { id, current };
}

function overlap(current: CaseDetail) {
  return current.model!.findings.reduce(
    (sum, finding) => sum + (finding.overlap?.volume || 0),
    0,
  );
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}

for (const [rehearsal, dataset] of (
  ["c001", "c001", "c001", "c002"] as const
).entries()) {
  test(`rehearsal ${rehearsal + 1}: ${dataset} sources, overlap, explicit evidence correction`, async ({
    page,
    request,
  }, info) => {
    const { id, current: draft } = await loadAndBuild(
      page,
      request,
      dataset,
      `Browser rehearsal ${rehearsal + 1} · ${dataset.toUpperCase()}`,
    );
    expect(overlap(draft)).toBeCloseTo(dataset === "c001" ? 6.4 : 14.4, 8);
    await page.getByRole("button", { name: "Checks", exact: true }).click();
    await page
      .getByRole("button", { name: /shared volume/ })
      .first()
      .click();
    await expect(page.locator(".overlap-label")).toContainText(
      dataset === "c001" ? "6.4" : "14.4",
    );
    await screenshot(page, info, "draft-overlap");
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    await page
      .getByRole("button", { name: "Load revised demo levels" })
      .click();
    await expect(
      page.getByRole("button", { name: "Apply this level evidence" }),
    ).toBeEnabled();
    const received = await detail(request, id);
    expect(received.case.revision).toBe(draft.case.revision);
    expect(received.model!.id).toBe(draft.model!.id);
    const revision = received.sources.find(
      (source) => source.profile === "levels-csv-v1" && source.revision === 2,
    )!;
    expect(revision).toBeTruthy();
    await page
      .getByRole("button", { name: "Apply this level evidence" })
      .click();
    await expect(
      page.getByRole("button", { name: "Rebuild model", exact: true }),
    ).toBeEnabled();
    const applied = await detail(request, id);
    expect(applied.case.revision).toBeGreaterThan(draft.case.revision);
    expect(applied.model!.id).toBe(draft.model!.id);
    expect(applied.model!.revision).toBeLessThan(applied.case.revision);
    await page
      .getByRole("button", { name: "Rebuild model", exact: true })
      .click();
    await expect
      .poll(async () => (await detail(request, id)).model!.id, {
        timeout: 40_000,
      })
      .not.toBe(draft.model!.id);
    const corrected = await detail(request, id);
    expect(overlap(corrected)).toBe(0);
    expect(corrected.model!.revision).toBe(corrected.case.revision);
    await page.getByRole("button", { name: "Checks", exact: true }).click();
    await expect(
      page.getByText("No positive-volume overlaps", { exact: true }),
    ).toBeVisible();
    await screenshot(page, info, "corrected-model");
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: `Browser rehearsal ${rehearsal + 1} · ${dataset.toUpperCase()}`,
        exact: true,
      }),
    ).toBeVisible();
    expect((await detail(request, id)).model!.id).toBe(corrected.model!.id);
    await info.attach("persisted-evidence", {
      body: JSON.stringify(
        {
          caseId: id,
          draftSnapshot: draft.model!.id,
          revisedSource: revision.id,
          correctedSnapshot: corrected.model!.id,
          overlapBefore: overlap(draft),
          overlapAfter: overlap(corrected),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
}

test("linked editing, display-only controls, calibrated PNG/PDF tracing, rejected upload and narrow layout", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  const { id, current: initial } = await loadAndBuild(
    page,
    request,
    "c001",
    "Browser editing and reference rehearsal",
  );
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await page
    .getByRole("button", {
      name: "U03 Upper west apartment Unverified elevation",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Lower elevation in metres")).toHaveValue("2.8");
  await page.getByLabel("Visible floor").selectOption("Level 1");
  await page
    .getByRole("button", { name: "Isolate selected space", exact: true })
    .click();
  await page.getByLabel("Separate floors visually").focus();
  await page.keyboard.press("Home");
  for (let step = 0; step < 6; step++) await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Separate floors visually")).toHaveValue("1.5");
  const displayed = await detail(request, id);
  expect(displayed.case.revision).toBe(initial.case.revision);
  expect(displayed.model).toEqual(initial.model);
  await screenshot(page, info, "isolated-upper-space");
  await page.getByLabel("Separate floors visually").focus();
  await page.keyboard.press("Home");
  await page
    .getByRole("button", { name: "Isolate selected space", exact: true })
    .click();
  await page.getByLabel("Lower elevation in metres").fill("3.1");
  await page.getByRole("button", { name: "Save limits", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await detail(request, id)).units.find((unit) => unit.alias === "U03")!
          .lower,
    )
    .toBe(3.1);
  const edited = await detail(request, id);
  const unit = edited.units.find((unit) => unit.alias === "U03")!;
  expect(unit.lowerVerified).toBe(false);
  expect(edited.model!.id).toBe(initial.model!.id);
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit footprint", exact: true })
    .click();
  const handle = page.locator(".vertex-handle").first();
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 12,
    box!.y + box!.height / 2 - 8,
    { steps: 8 },
  );
  await page.mouse.up();
  const draggedX = Number(
    await page.getByLabel("Vertex 1 X in metres").inputValue(),
  );
  expect(draggedX).not.toBe(unit.footprint[0][0]);
  await page
    .getByRole("button", { name: "Save footprint", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await detail(request, id)).units.find((item) => item.id === unit.id)!
          .footprint[0][0],
    )
    .toBe(draggedX);
  await page.reload();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await page.getByRole("button", { name: /U03 Upper west apartment/ }).click();
  await expect(page.getByLabel("Lower elevation in metres")).toHaveValue("3.1");
  await page
    .getByRole("button", { name: "Rebuild model", exact: true })
    .click();
  await expect
    .poll(async () => (await detail(request, id)).model!.id, {
      timeout: 40_000,
    })
    .not.toBe(initial.model!.id);

  const tracedAreas = new Map<string, number>();
  for (const extension of ["png", "pdf"]) {
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    await page
      .locator(".source-row")
      .filter({ hasText: `plan.${extension}` })
      .click();
    await expect(
      page.getByRole("button", { name: "Calibrate & trace", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Calibrate & trace", exact: true })
      .click();
    const scale = extension === "pdf" ? 1.5 : 1;
    const clickPoint = async (x: number, y: number) => {
      const screen = await page.locator(".reference-sheet > svg").evaluate(
        (node, point) => {
          const matrix = (node as SVGSVGElement).getScreenCTM()!;
          const result = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return { x: result.x, y: result.y };
        },
        { x: x * scale, y: y * scale },
      );
      await page.mouse.click(screen.x, screen.y);
    };
    await clickPoint(218, 682);
    await clickPoint(611, 368);
    await page
      .getByRole("button", { name: "Use calibration", exact: true })
      .click();
    // Rectangle around control A. Two-point similarity makes its expected area independently calculable.
    for (const [x, y] of [
      [218, 682],
      [296.6, 682],
      [296.6, 603.4],
      [218, 603.4],
    ])
      await clickPoint(x, y);
    await page
      .getByLabel("Alias", { exact: true })
      .fill(`TRACE-${extension.toUpperCase()}`);
    await page
      .getByLabel("Name", { exact: true })
      .fill(`Calibrated ${extension.toUpperCase()} space`);
    await page.getByLabel("Lower / m", { exact: true }).fill("8");
    await page.getByLabel("Upper / m", { exact: true }).fill("10");
    const pickedPixels = await page
      .locator(".reference-sheet > svg > circle")
      .evaluateAll((nodes) =>
        nodes.map((node) => [
          Number(node.getAttribute("cx")),
          Number(node.getAttribute("cy")),
        ]),
      );
    expect(pickedPixels).toHaveLength(4);
    await screenshot(page, info, `${extension}-calibrated-trace`);
    await page
      .getByRole("button", { name: "Save traced space", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await detail(request, id)).units.some(
          (item) => item.alias === `TRACE-${extension.toUpperCase()}`,
        ),
      )
      .toBe(true);
    const traced = (await detail(request, id)).units.find(
      (item) => item.alias === `TRACE-${extension.toUpperCase()}`,
    )!;
    expect(traced.calibration?.page).toBe(1);
    expect(traced.calibration?.worldPoints).toEqual([
      [2, 2],
      [12, 10],
    ]);
    expect(traced.lowerVerified).toBe(false);
    expect(traced.upperVerified).toBe(false);
    expect(traced.footprint).toHaveLength(4);
    // Mouse events quantize to CSS pixels. Check the metric result against
    // the points actually picked, using independent shoelace area + scale².
    const pixelArea =
      Math.abs(
        pickedPixels.reduce((sum, point, index) => {
          const next = pickedPixels[(index + 1) % pickedPixels.length];
          return sum + point[0] * next[1] - next[0] * point[1];
        }, 0),
      ) / 2;
    const [controlA, controlB] = traced.calibration!.imagePoints;
    const scaleSquared =
      164 /
      ((controlB[0] - controlA[0]) ** 2 + (controlB[1] - controlA[1]) ** 2);
    const area = pixelArea * scaleSquared;
    // At this rendered size a one-pixel click shifts a corner by ~0.05 m.
    expect(Math.abs(area - 4.0039733644213475)).toBeLessThan(0.25);
    tracedAreas.set(traced.alias, area);
  }
  const beforeBuild = await detail(request, id);
  await page
    .getByRole("button", { name: "Rebuild model", exact: true })
    .click();
  await expect
    .poll(async () => (await detail(request, id)).model!.id, {
      timeout: 40_000,
    })
    .not.toBe(beforeBuild.model!.id);
  const tracedModel = await detail(request, id);
  for (const alias of ["TRACE-PNG", "TRACE-PDF"]) {
    const computed = tracedModel.model!.units.find(
      (item) => item.alias === alias,
    )!;
    expect(computed.area).toBeCloseTo(tracedAreas.get(alias)!, 6);
    expect(computed.volume).toBeCloseTo(tracedAreas.get(alias)! * 2, 6);
  }
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Input profile", exact: true })
    .selectOption("parcel-local-json-v1");
  await page.getByLabel("Choose original source file").setInputFiles({
    name: "invalid-browser-input.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ invalid JSON"),
  });
  await page
    .getByRole("button", { name: "Receive & inspect", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await detail(request, id)).sources.find(
          (source) => source.name === "invalid-browser-input.json",
        )?.status,
    )
    .toBe("failed");
  const invalidSource = (await detail(request, id)).sources.find(
    (source) => source.name === "invalid-browser-input.json",
  )!;
  expect(
    invalidSource.inspection!.issues.some(
      (issue) => issue.code === "INVALID_SOURCE" && issue.severity === "error",
    ),
  ).toBe(true);
  await expect(page.locator(".source-identity")).toContainText(/failed/i);
  await expect(page.locator(".source-identity")).toContainText(
    "could not be parsed",
  );
  expect((await detail(request, id)).model!.id).toBe(tracedModel.model!.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await screenshot(page, info, "narrow-layout");
  await page
    .getByRole("button", { name: "Create new case", exact: true })
    .click();
  await expect(page.getByLabel("Workspace name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await info.attach("editing-evidence", {
    body: JSON.stringify(
      {
        caseId: id,
        snapshotId: tracedModel.model!.id,
        units: tracedModel.model!.units.length,
        traceAreasFromPickedPixels: Object.fromEntries(tracedAreas),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("user file chooser uploads real spatial, level and control files", async ({
  page,
  request,
}, info) => {
  const id = await createWorkspace(
    page,
    "Browser original file upload rehearsal",
  );
  for (const [filename, profile] of [
    ["spatial.json", "parcel-local-json-v1"],
    ["levels-r1.csv", "levels-csv-v1"],
    ["controls.csv", "control-csv-v1"],
  ]) {
    await page
      .getByRole("button", { name: "Import files", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Input profile", exact: true })
      .selectOption(profile);
    await page
      .getByLabel("Choose original source file")
      .setInputFiles(path.resolve("fixtures/c001", filename));
    await page
      .getByRole("button", { name: "Receive & inspect", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect
      .poll(async () =>
        ["ready", "needs_input"].includes(
          (await detail(request, id)).sources.find(
            (source) => source.name === filename,
          )?.status || "",
        ),
      )
      .toBe(true);
  }
  const received = await detail(request, id);
  expect(received.sources).toHaveLength(3);
  expect(received.units).toHaveLength(0);
  expect(received.model).toBeNull();
  await page
    .getByRole("button", { name: "Prepare geometry", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Prepare draft spaces", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Build model", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => (await detail(request, id)).model?.units.length, {
      timeout: 40_000,
    })
    .toBe(7);
  await expect(page.locator(".cesium-widget canvas")).toBeVisible();
  const built = await detail(request, id);
  expect(overlap(built)).toBeCloseTo(6.4, 8);
  expect(built.model!.units.find((unit) => unit.alias === "U01")!.area).toBe(
    32,
  );
  await screenshot(page, info, "uploaded-originals-built");
});
