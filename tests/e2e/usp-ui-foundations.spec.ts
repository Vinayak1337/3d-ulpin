import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const receiptFile = process.env.ULPIN_D0_RECEIPT_FILE;
test.skip(!receiptFile, 'Requires the isolated D0 Studio fixture');

test('UI-01 local fonts, Hindi glyphs, token contrast and controls in both themes', async ({ page }) => {
  const receipt = JSON.parse(await readFile(receiptFile!, 'utf8'));
  const requests: string[] = [];
  page.on('request', request => {
    if (/font|\.woff2?(?:\?|$)/i.test(request.url())) requests.push(request.url());
  });
  await page.route(/https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
  await page.goto(`/studio/areas/${encodeURIComponent(receipt.areaId)}`);
  await expect(page.locator('.ulpin-app')).toBeVisible();
  const screenshots = process.env.ULPIN_UI01_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });

  for (const theme of ['light', 'dark'] as const) {
    await page.locator('.ulpin-app').evaluate((element, selected) => {
      if (selected === 'dark') element.setAttribute('data-theme', 'dark');
      else element.removeAttribute('data-theme');
    }, theme);
    const result = await page.locator('.ulpin-app').evaluate(element => {
      const style = getComputedStyle(element);
      const value = (name: string) => style.getPropertyValue(name).trim();
      const rgb = (color: string) => {
        const probe = document.createElement('span');
        probe.style.color = color;
        element.appendChild(probe);
        const channels = getComputedStyle(probe).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        probe.remove();
        return channels.map(channel => {
          const x = channel / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
      };
      const contrast = (foreground: string, background: string) => {
        const [a, b] = [rgb(value(foreground)), rgb(value(background))].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      };
      return {
        text: [
          ['--ui-ink', '--ui-background'], ['--ui-ink', '--ui-surface'],
          ['--ui-ink-soft', '--ui-surface'], ['--ui-muted', '--ui-surface'],
          ['--ui-on-primary', '--ui-primary'], ['--ui-info', '--ui-info-soft'],
          ['--ui-success', '--ui-success-soft'], ['--ui-warning', '--ui-warning-soft'],
          ['--ui-danger', '--ui-danger-soft'],
        ].map(([foreground, background]) => ({ foreground, background, ratio: contrast(foreground, background) })),
        control: contrast('--ui-line-control', '--ui-surface'),
        surface: value('--ui-surface'),
        computedFont: style.fontFamily,
      };
    });
    for (const pair of result.text) expect(pair.ratio, `${theme} ${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(4.5);
    expect(result.control, `${theme} control outline`).toBeGreaterThanOrEqual(3);
    expect(result.computedFont).toContain('Noto Sans');
    if (screenshots) await page.screenshot({ path: join(screenshots, `studio-${theme}-desktop.png`) });
  }

  const fonts = await page.evaluate(async () => {
    const hindi = 'भूमि अभिलेख';
    const loaded = await Promise.all([
      document.fonts.load('15px "Noto Sans"', 'Record'),
      document.fonts.load('16px "Noto Sans Devanagari"', hindi),
      document.fonts.load('13px "Noto Sans Mono"', 'ULPIN-123'),
    ]);
    const label = document.createElement('span');
    label.lang = 'hi';
    label.textContent = hindi;
    label.style.cssText = 'font: 16px/1.8 "Noto Sans Devanagari",sans-serif; position: fixed; top: 8px; left: 8px; padding: 8px; background: var(--ui-surface); color: var(--ui-ink); z-index: 1000';
    document.querySelector('.ulpin-app')!.appendChild(label);
    return { loaded: loaded.map(faces => faces.length), text: label.textContent,
      width: label.getBoundingClientRect().width, family: getComputedStyle(label).fontFamily };
  });
  expect(fonts.loaded).toEqual([1, 1, 1]);
  expect(fonts.text).toBe('भूमि अभिलेख');
  expect(fonts.width).toBeGreaterThan(40);
  expect(fonts.family).toContain('Noto Sans Devanagari');
  if (screenshots) await page.locator('[lang="hi"]').last().screenshot({ path: join(screenshots, 'hindi-label.png') });
  expect(requests.filter(url => !url.startsWith(new URL(page.url()).origin))).toEqual([]);
  for (const name of ['NotoSans-Variable', 'NotoSansDevanagari-Variable', 'NotoSansMono-Variable']) {
    expect(requests.some(url => url.endsWith(`/fonts/${name}.woff2`)), `${name} requested locally`).toBeTruthy();
  }
});
