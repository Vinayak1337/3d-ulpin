import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { cameraDelta, readCamera } from './usp-camera';

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
  await expect(page.locator('[data-tile-canvas]')).toHaveAttribute('data-scene-ready', 'true');
  await expect(page.locator('[data-map-runtime-id]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('d0-neighbourhood-desktop.png') });
  await page.getByRole("button", { name: "Inspect floors & units" }).click();
  await expect(page.locator(`[data-quick-register="${buildingId}"]`)).toBeVisible();
  await page.locator(`[data-record-id="${spaceId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`record=${spaceId}`));
  const panel = page.locator(`[data-usp-target="${spaceId}"]`);
  await expect(panel).toContainText("ONLY_A101");
  await expect(panel).not.toContainText("NEVER_A102");
  await expect(panel).toContainText("line 3");
  await page.screenshot({ path: info.outputPath('d0-unit-desktop.png') });
  await panel.locator(".usp-packet-source").filter({ hasText: "ONLY_A101" }).first()
    .screenshot({ path: info.outputPath("d0-exact-evidence.png") });

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
  await page.locator(`[data-usp-target="${spaceId}"] .usp-packet-receipt`)
    .screenshot({ path: info.outputPath("d0-packet-reloaded.png") });

  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 390) {
      await expect(page.getByLabel('Selected scope')).toContainText('Cross Parcel House');
      await expect(page.getByLabel('Selected scope')).toContainText('A101');
    }
    const action = page.locator(`[data-usp-packet="${packetId}"]`);
    await action.scrollIntoViewIfNeeded();
    await expect(action).toContainText('Scoped packet saved');
    const bounds = await action.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({ path: info.outputPath(`d0-packet-${viewport.width}.png`) });
  }

  const invalid = randomUUID();
  await page.goto(`/studio/areas/${encodeURIComponent(receipt.areaId)}?feature=${encodeURIComponent(buildingId)}&record=${invalid}`);
  await expect(page.locator(".quick-warning[role=alert]")).toContainText("not part of this building");
  await expect(page.locator(".usp-packet-action")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('D0 map navigation, supplied levels and building switches preserve exact records', async ({ page, request }, info) => {
  const receipt = JSON.parse(await readFile(receiptFile!, 'utf8')) as D0Receipt;
  const buildingId = receipt.physicalFeatures['B-A'];
  const dossierBefore = await (await request.get(`/api/v1/buildings/${buildingId}/dossier`)).json();
  await page.goto(`/studio/areas/${receipt.areaId}?feature=${buildingId}`);
  const scene = page.locator('[data-tile-canvas]');
  await expect(scene).toHaveAttribute('data-scene-ready', 'true');
  const canvas = scene.locator('canvas');
  const cameraBefore = await readCamera(scene);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * .62, box.y + box.height * .56, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => cameraDelta(cameraBefore, await readCamera(scene))).toBeGreaterThan(100);
  const orbited = await readCamera(scene);
  await page.mouse.wheel(0, -140);
  await expect.poll(async () => cameraDelta(orbited, await readCamera(scene))).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Fit block', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect floors & units' }).click();
  for (const level of ['Basement', 'Mezzanine', 'First']) {
    const id = receipt.records[`property / B-A / ${level}`];
    expect(id).toBeTruthy();
    await page.locator(`[data-record-id="${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`record=${id}`));
    await expect(page.locator('.quick-unit-card')).toContainText(level);
    if (level === 'Basement') {
      await expect(page.locator('[data-underground-cutaway]')).toHaveAttribute('data-underground-cutaway', 'true');
      await expect(page.getByRole('status')).toContainText('recorded levels unchanged');
      const basementUnit = receipt.records['U-AB01'];
      // This floor's supplied geometry is its unit; the floor has no separate solid.
      await expect.poll(async () => JSON.parse((await scene.getAttribute('data-ready-overlay-ids')) || '[]'))
        .toContain(`record:${basementUnit}`);
      await expect(scene).toHaveAttribute('data-scene-ready', 'true');
      await page.screenshot({ path: info.outputPath('d0-level-basement.png') });
      await page.locator(`[data-record-id="${basementUnit}"]`).click();
      await expect(page).toHaveURL(new RegExp(`record=${basementUnit}`));
      // A floor covers the building; its supplied unit is off-centre. Focus the
      // selected unit through the real control before checking its scene pick.
      // List selection may already focus it, so this command can be idempotent.
      await page.getByRole('button', { name: 'Focus selected property', exact: true }).click();
      await expect.poll(async () => JSON.parse((await scene.getAttribute('data-ready-overlay-ids')) || '[]'))
        .toContain(`record:${basementUnit}`);
      await expect(scene).toHaveAttribute('data-scene-ready', 'true');
      const focused = (await canvas.boundingBox())!;
      await page.mouse.click(focused.x + focused.width * .5, focused.y + focused.height * .5);
      await expect.poll(async () => ({
        entity: await scene.getAttribute('data-picked-entity-id'),
        kind: await scene.getAttribute('data-pick-kind'),
      })).toEqual({ entity: `record:${basementUnit}`, kind: 'entity' });
      await expect(page).toHaveURL(new RegExp(`record=${basementUnit}`));
      await page.screenshot({ path: info.outputPath('d0-unit-basement.png') });
    } else {
      await expect(page.locator('[data-underground-cutaway]')).toHaveAttribute('data-underground-cutaway', 'false');
      await page.screenshot({ path: info.outputPath(`d0-level-${level.toLowerCase()}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Separate floors', exact: true }).click();
  await page.screenshot({ path: info.outputPath('d0-separated-floors.png') });
  await page.getByRole('button', { name: 'Stack floors', exact: true }).click();
  await page.getByRole('button', { name: '2D Map', exact: true }).click();
  await page.getByRole('button', { name: 'Fit block', exact: true }).click();
  const map = page.getByRole('group', { name: '2D block map', exact: true });
  const area = await (await request.get(`/api/v1/areas/${receipt.areaId}/context`)).json();
  for (const alias of ['B-B', 'B-A']) {
    const id = receipt.physicalFeatures[alias];
    const name = area.features.find((feature: { id: string }) => feature.id === id).name;
    await map.getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`feature=${id}`));
    expect(new URL(page.url()).searchParams.has('record')).toBe(false);
    await expect(page.locator('.usp-packet-action')).toHaveCount(0);
    await page.getByRole('button', { name: 'Inspect floors & units' }).click();
    await expect(page.locator(`[data-quick-register="${id}"]`)).toBeVisible();
  }
  const dossierAfter = await (await request.get(`/api/v1/buildings/${buildingId}/dossier`)).json();
  expect(dossierAfter.records).toEqual(dossierBefore.records);
  expect(dossierAfter.sources).toEqual(dossierBefore.sources);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('[data-map-runtime-id]')).toHaveCount(1);
});
