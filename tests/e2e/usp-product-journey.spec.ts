import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

type D0Receipt = {
  schemaVersion: "usp-d0-import-receipt/1";
  areaId: string;
  siteId: string;
  physicalFeatures: Record<string, string>;
  records: Record<string, string>;
};

// The DATA importer writes this receipt only after applying its authored pack
// through real services. Without it there is no V0 browser integration claim.
const receiptFile = process.env.ULPIN_D0_RECEIPT_FILE;
test.skip(!receiptFile, "Requires an applied D0 import receipt and live services");

test("D0 Studio selection compiles exact PACK0 and reopens its saved receipt", async ({ page, request }, info) => {
  const receipt = JSON.parse(await readFile(receiptFile!, "utf8")) as D0Receipt;
  expect(receipt.schemaVersion).toBe("usp-d0-import-receipt/1");
  const buildingId = receipt.physicalFeatures["B-A"];
  const spaceId = receipt.records["U-A101"];
  expect(buildingId).toBeTruthy();
  expect(spaceId).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(`/studio/areas/${encodeURIComponent(receipt.areaId)}?feature=${encodeURIComponent(buildingId)}`);
  await page.getByRole("button", { name: "Inspect floors & units" }).click();
  await expect(page.locator(`[data-quick-register="${buildingId}"]`)).toBeVisible();
  await page.locator(`[data-record-id="${spaceId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`record=${spaceId}`));
  const panel = page.locator(`[data-usp-target="${spaceId}"]`);
  await expect(panel).toContainText("ONLY_A101");
  await expect(panel).not.toContainText("NEVER_A102");
  await expect(panel).toContainText("line 3");
  await page.screenshot({ path: info.outputPath("d0-exact-evidence.png") });

  await panel.getByRole("button", { name: "Compile scoped packet" }).click();
  await expect(panel).toContainText("Scoped packet saved");
  const packetId = await panel.locator("[data-usp-packet]").getAttribute("data-usp-packet");
  expect(packetId).toBeTruthy();
  const response = await request.get(`/api/v1/usp/packets/${packetId}`);
  expect(response.ok(), `Packet HTTP ${response.status()}`).toBeTruthy();
  const bytes = await response.body();
  const text = bytes.toString("utf8");
  expect(text).toContain("ONLY_A101");
  expect(text).not.toContain("NEVER_A102");
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(response.headers()["x-artifact-sha256"]).toBe(hash);
  await page.reload();
  await expect(page.locator(`[data-usp-packet="${packetId}"]`)).toContainText("Scoped packet saved");
  await expect(page).toHaveURL(new RegExp(`packet=${packetId}`));
  await page.screenshot({ path: info.outputPath("d0-packet-reloaded.png") });

  const invalid = randomUUID();
  await page.goto(`/studio/areas/${encodeURIComponent(receipt.areaId)}?feature=${encodeURIComponent(buildingId)}&record=${invalid}`);
  await expect(page.getByRole("alert")).toContainText("not part of this building");
  await expect(page.locator(".usp-packet-action")).toHaveCount(0);
  expect(errors).toEqual([]);
});
