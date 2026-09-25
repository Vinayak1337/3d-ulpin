import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';

async function hitTest(locator: Locator, scroll = true) {
  if (scroll) await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      insideViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      unobscured: !!hit && (element === hit || element.contains(hit)),
      hit: hit?.tagName ?? null };
  });
}

test('UI-03 area map reads one unchanged saved snapshot', async ({ page }) => {
  const base = process.env.DEMO_BASE_URL;
  const directory = process.env.ULPIN_UI03_SCREENSHOT_DIR;
  const area = process.env.ULPIN_UI03_AREA_ID;
  const building = process.env.ULPIN_UI03_BUILDING_ID;
  if (!base || !directory || new URL(base).origin !== 'http://127.0.0.1:3108')
    throw new Error('UI-03 captures require the isolated loopback preview');
  await mkdir(directory, { recursive: true });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const captures: { screen: string; route: string; width: number; height: number; ready: string; file: string }[] = [];
  if (!area || !building) {
    const response = await page.goto('/studio/datasets', { waitUntil: 'domcontentloaded' });
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole('main')).toBeVisible();
    const file = join(directory, 'unavailable-1440.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: file, fullPage: true });
    captures.push({ screen: 'unavailable', route: '/studio/datasets', width: 1440, height: 900, ready: 'no saved area/building in pinned snapshot', file });
  } else {
    for (const [width, height] of [[1440, 900], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      for (const [screen, suffix] of [['area', ''], ['selected', `?feature=${building}`]]) {
        const route = `/studio/areas/${area}${suffix}`;
        const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(response?.ok(), route).toBeTruthy();
        await expect(page.locator('.ui-contextbar h1')).toBeVisible();
        await expect(page.getByText('Recorded source', { exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: '2D Map' }).click();
        await expect(page.locator('.ui-renderer[aria-hidden="false"] svg').first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const file = join(directory, `${screen}-${width}.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        captures.push({ screen, route, width, height, ready: '2D geometry visible', file });
        if (screen === 'selected') {
          expect(new URL(page.url()).searchParams.get('feature')).toBe(building);
          await expect(page.getByLabel('Underground')).toBeDisabled();
          if (await page.getByLabel('Colour by').count()) {
            await page.getByLabel('Colour by').selectOption('readiness');
            await expect(page.getByText('Not assessed for a named task in this area.')).toBeVisible();
            expect(new URL(page.url()).searchParams.get('feature')).toBe(building);
            await page.getByLabel('Colour by').selectOption('findings');
            await expect(page.getByRole('heading', { name: 'Findings', exact: true })).toBeVisible();
            if (width === 1440) {
              const findingsFile = join(directory, 'selected-findings-1440.png');
              await page.screenshot({ path: findingsFile, animations: 'disabled' });
              captures.push({ screen: 'selected-findings', route, width, height, ready: 'saved findings mode', file: findingsFile });
            }
            await page.getByLabel('Colour by').selectOption('none');
          }
          if (width === 1440) {
            const layers = page.getByRole('button', { name: 'Layers', exact: true });
            await layers.focus();
            await layers.press('Enter');
            await expect(page.getByRole('complementary', { name: 'Layers panel' })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(layers).toBeFocused();
            await expect(page.getByRole('group', { name: 'Map readout' })).toBeVisible();
          }
        }
      }
    }
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto(`/studio/areas/${area}?feature=${building}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Close inspector' }).click();
    const layout = await page.evaluate(() => Object.fromEntries(
      ['.ui-block-grid', '.ui-map-column', '.area-map-surface', '.area-map-toolbar', '.area-map-canvas']
        .map(selector => {
          const element = document.querySelector(selector);
          const rect = element?.getBoundingClientRect();
          return [selector, { width: rect?.width, left: rect?.left, right: rect?.right,
            columns: element ? getComputedStyle(element).gridTemplateColumns : null }];
        }),
    ));
    await writeFile(join(directory, 'layout-equivalent-200-percent-zoom.json'), JSON.stringify(layout, null, 2) + '\n');
    expect(layout['.ui-map-column'].width).toBeGreaterThan(650);
    await page.getByRole('button', { name: '2D Map' }).click();
    await expect(page.locator('.ui-renderer[aria-hidden="false"] svg').first()).toBeVisible();
    const controls: [string, Locator][] = [
      ['3D', page.getByRole('button', { name: '3D', exact: true })],
      ['2D', page.getByRole('button', { name: '2D Map' })],
      ['Layers', page.getByRole('button', { name: 'Layers', exact: true })],
      ['Colour by', page.getByLabel('Colour by')],
      ['Underground', page.getByLabel('Underground')],
      ['Fit block', page.getByRole('button', { name: 'Fit block' })],
      ['Focus selected', page.getByRole('button', { name: 'Focus selected property' })],
      ['Source world', page.getByLabel('Source world')],
      ['Levels', page.getByText('Levels not supplied')],
      ['Legend', page.getByRole('complementary', { name: 'Map legend' })],
      ['North', page.getByRole('button', { name: 'Orient north' })],
      ['Zoom in', page.getByRole('button', { name: 'Zoom in' })],
      ['Zoom out', page.getByRole('button', { name: 'Zoom out' })],
      ['Return', page.getByRole('button', { name: 'Return to block view' })],
      ['Inspector', page.getByRole('button', { name: 'Inspector' })],
      ['Checks', page.locator('.area-map-actions').getByRole('button', { name: /Checks/ })],
    ];
    const hitResults: Record<string, Awaited<ReturnType<typeof hitTest>>> = {};
    for (const [name, control] of controls) {
      hitResults[name] = await hitTest(control);
      expect(hitResults[name].insideViewport, `${name} outside the viewport`).toBe(true);
      expect(hitResults[name].unobscured, `${name} covered by ${hitResults[name].hit}`).toBe(true);
    }
    await writeFile(join(directory, 'control-occlusion-equivalent-200-percent-zoom.json'), JSON.stringify(hitResults, null, 2) + '\n');
    const legend = page.getByRole('complementary', { name: 'Map legend' });
    expect(await legend.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await legend.focus();
    await legend.press('End');
    await expect.poll(() => legend.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await legend.evaluate(element => { element.scrollTop = 0; });
    await page.locator('.area-map-toolbar').evaluate(element => { element.scrollLeft = 0; });
    const fit = page.getByRole('button', { name: 'Fit block' });
    await fit.focus();
    await expect(fit).toBeFocused();
    expect((await hitTest(fit, false)).unobscured, 'keyboard focus should reveal Fit block in the scrollable toolbar').toBe(true);
    await page.locator('.area-map-toolbar').evaluate(element => { element.scrollLeft = 0; });
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Layers panel' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Layers panel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Layers', exact: true })).toBeFocused();
    const zoomFile = join(directory, 'selected-equivalent-200-percent-zoom.png');
    await page.screenshot({ path: zoomFile, animations: 'disabled' });
    captures.push({ screen: 'selected-equivalent-200-percent-zoom', route: `/studio/areas/${area}?feature=${building}`, width: 720, height: 450, ready: '2D geometry; 720 CSS-pixel responsive equivalent; browser chrome zoom not instrumented; Escape restores panel focus', file: zoomFile });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/studio/areas/${area}?feature=${building}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D', exact: true }).click();
    try {
      await page.locator('[data-scene-ready="true"]').first().waitFor({ timeout: 10000 });
      await expect(page.locator('[data-underground-cutaway]')).toHaveAttribute('data-underground-cutaway', 'false');
      const file = join(directory, 'selected-3d-1440.png');
      await page.screenshot({ path: file, animations: 'disabled' });
      captures.push({ screen: 'selected-3d', route: `/studio/areas/${area}?feature=${building}`, width: 1440, height: 900, ready: 'scene-ready', file });
    } catch {
      const file = join(directory, 'selected-3d-unavailable-1440.png');
      await page.screenshot({ path: file, animations: 'disabled' });
      captures.push({ screen: 'selected-3d', route: `/studio/areas/${area}?feature=${building}`, width: 1440, height: 900, ready: 'scene not ready in software browser', file });
    }
  }
  await writeFile(join(directory, 'capture-manifest.json'), JSON.stringify(captures, null, 2) + '\n');
});
