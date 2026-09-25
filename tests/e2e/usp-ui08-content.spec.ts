import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('UI-08 saved-record screens and explicit unselected map', async ({ page }) => {
  const base = process.env.DEMO_BASE_URL;
  const directory = process.env.ULPIN_UI08_SCREENSHOT_DIR;
  if (!base || !directory || new URL(base).origin !== 'http://127.0.0.1:3108')
    throw new Error('UI-08 captures require the isolated loopback3108 preview');
  await mkdir(directory, { recursive: true });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const captures: { screen: string; route: string; file: string; classification?: string }[] = [];
  const capture = async (screen: string, route: string, ready: () => Promise<void>, classification?: string) => {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `${screen} route status`).toBeTruthy();
    await ready();
    const file = join(directory, `${screen}.png`);
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    captures.push({ screen, route, file, classification });
  };
  await capture('S1-batches', '/studio/work', async () => {
    await expect(page.getByRole('heading', { name: 'Batches', exact: true })).toBeVisible();
    await expect(page.locator('.work-list')).toBeVisible();
    await expect(page.locator('.work-list')).not.toContainText('Loading saved work');
  });
  const area = process.env.ULPIN_UI08_AREA_ID;
  const building = process.env.ULPIN_UI08_BUILDING_ID;
  if (area && building) {
    await capture('S4-area-map', `/studio/areas/${area}`, async () => {
      await expect(page.locator('.ui-scope-classification')).toContainText('Classification:');
      await page.getByRole('button', { name: '2D Map' }).click();
      await expect(page.locator('.ui-renderer[aria-hidden="false"] svg').first()).toBeVisible();
    });
    await capture('S5-building-selection', `/studio/areas/${area}?feature=${building}`, async () => {
      await expect(page.locator('.ui-scope-classification')).toContainText('Classification:');
      await expect(page.locator('.ui-scope-selection')).toBeVisible();
      await page.getByRole('button', { name: '2D Map' }).click();
      await expect(page.locator('.ui-renderer[aria-hidden="false"] svg').first()).toBeVisible();
    });
    await capture('S12-property-register', `/studio/properties/${building}/register`, async () => {
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.locator('main').getByText(/Observed|Synthetic|Planned|Mixed|Unknown/).first()).toBeVisible();
    });
  } else {
    await capture('S4-unavailable', '/studio/datasets', async () => {
      await expect(page.getByRole('heading', { name: 'Maps' })).toBeVisible();
    });
    captures.push({ screen: 'S5/S12', route: '', file: '', classification: 'No building in the pinned snapshot' });
  }
  await capture('saved-map-unselected', '/studio/showcase', async () => {
    await expect(page.getByRole('heading', { name: 'No saved dataset selected' })).toBeVisible();
    await expect(page.getByText('Choose a saved dataset, or import a source package.')).toBeVisible();
  });
  await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify(captures, null, 2) + '\n');
});
