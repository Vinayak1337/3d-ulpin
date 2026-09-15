/** Actual UI evidence-request workflow. Creates a clearly labeled fictional verification case. */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const ids = JSON.parse(
  await readFile("fixtures/reference-neighborhood/installed.json", "utf8"),
);
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000";
const executable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(executable) ? { executablePath: executable } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(20000);
const buildingId = ids.properties.D.buildingId;
const path = `/properties/${buildingId}/register?area=${ids.areaId}&tab=investigation`;
const reference = `LV-UI-${Date.now()}`;
try {
  await page.goto(base + path);
  await page.getByRole("button", { name: "+ New case", exact: true }).click();
  await page
    .getByLabel("Local case reference", { exact: true })
    .fill(reference);
  await page
    .locator('select[name="classification"]')
    .selectOption("missing_evidence");
  await page
    .getByLabel("Initial observation", { exact: true })
    .fill(
      "Fictional browser verification: the supplied entrance schedule has no upper level. No geometry is approved by this case.",
    );
  const opened = page.waitForResponse(
    (r) =>
      r.url().endsWith("/investigations") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Open local case", exact: true })
    .click();
  const response = await opened;
  expect(response.ok()).toBe(true);
  const created = await response.json();
  await page.getByRole("heading", { name: reference, exact: true }).waitFor();
  await page.getByRole("button", { name: /^Evidence requests/ }).click();
  const question =
    "Supply the source-supported upper level and named vertical benchmark for the entrance lobby. Fictional verification request; saved locally only.";
  await page
    .getByLabel("Measurement or document needed", { exact: true })
    .fill(question);
  const requested = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/investigations/${created.id}/requests`) &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Add evidence request", exact: true })
    .click();
  const requestResponse = await requested;
  expect(requestResponse.ok()).toBe(true);
  const retained = await requestResponse.json();
  expect(retained.status).toBe("NEEDS_EVIDENCE");
  await page.getByRole("heading", { name: question, exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Ready for review", exact: true })
    .click();
  await page
    .getByLabel("Decision reason", { exact: true })
    .fill(
      "Retain the missing-level request. The upper level remains unknown and no interior measurement is inferred.",
    );
  const decided = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/investigations/${created.id}`) &&
      r.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  const decision = await decided;
  expect(decision.status()).toBe(422);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Resolve the pending requests",
  );
  await page.screenshot({
    path: "docs/evidence/reference/investigation-review-guard.png",
  });
  await page.goto(base + path + `&case=${created.id}`);
  await page.getByRole("heading", { name: reference, exact: true }).waitFor();
  await page.getByRole("button", { name: /^Evidence requests/ }).click();
  await expect(
    page.getByRole("heading", { name: question, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/reference/investigation-request.png",
  });
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await expect(
    page.getByText("In-app evidence request created.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/reference/investigation-decision.png",
  });
  expect(errors).toEqual([]);
  await writeFile(
    "docs/evidence/reference/investigation-browser-report.json",
    JSON.stringify(
      {
        result: "PASS",
        reference,
        buildingId,
        investigationId: created.id,
        status: retained.status,
        requestCount: retained.requests.length,
        historyCount: retained.history.length,
        pendingEvidenceReviewGuard: "PASS",
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS Actual UI creates a fictional investigation, retains a missing-level request, records NEEDS_EVIDENCE and reopens the same case with its request and decision history.",
  );
} catch (error) {
  await page.screenshot({
    path: "docs/evidence/reference/investigation-failure.png",
  });
  throw error;
} finally {
  await browser.close();
}
