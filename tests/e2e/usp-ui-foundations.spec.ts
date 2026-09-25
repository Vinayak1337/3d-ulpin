import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

type ContrastSample = {
  name: string;
  enabled: boolean;
  text: number;
  icon: number | null;
  boundary: number | null;
  foreground: string;
  background: string;
  opacity: number;
  runningAnimations: number;
  outline: number | null;
  outlineWidth: number;
};

async function sampleControl(locator: Locator, name: string): Promise<ContrastSample> {
  return locator.evaluate((element, label) => {
    type Color = [number, number, number, number];
    const parse = (value: string): Color => {
      const parts = value.match(/rgba?\(([^)]+)\)/)?.[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (!parts || parts.length < 3) throw new Error(`Unresolved CSS color: ${value}`);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const over = (front: Color, back: Color): Color => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [0, 1, 2].map(index => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha)
        .concat(alpha) as Color;
    };
    const background = (target: Element): Color => {
      const path: Element[] = [];
      for (let node: Element | null = target; node; node = node.parentElement) path.unshift(node);
      return path.reduce((color, node) => over(parse(getComputedStyle(node).backgroundColor), color), [255, 255, 255, 1] as Color);
    };
    const luminance = (color: Color) => color.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (a: Color, b: Color) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };
    const style = getComputedStyle(element);
    const bg = background(element);
    const text = over(parse(style.color), bg);
    const svg = element.querySelector('svg');
    const icon = svg ? over(parse(getComputedStyle(svg).color), background(svg)) : null;
    const border = parse(style.borderTopColor);
    const boundary = parseFloat(style.borderTopWidth) > 0 && border[3] > 0
      ? ratio(over(border, background(element.parentElement ?? element)), background(element.parentElement ?? element))
      : null;
    const outlineWidth = parseFloat(style.outlineWidth);
    const outline = outlineWidth >= 2 && style.outlineStyle !== 'none'
      ? ratio(over(parse(style.outlineColor), background(element.parentElement ?? element)), background(element.parentElement ?? element))
      : null;
    return {
      name: label,
      enabled: !(element instanceof HTMLButtonElement && element.disabled) && element.getAttribute('aria-disabled') !== 'true',
      text: ratio(text, bg),
      icon: icon ? ratio(icon, background(svg!)) : null,
      boundary,
      foreground: style.color,
      background: style.backgroundColor,
      opacity: Number(style.opacity),
      runningAnimations: element.getAnimations().filter(animation => animation.playState === 'running').length,
      outline,
      outlineWidth,
    };
  }, name);
}

async function visibleControls(page: Page) {
  const targets: [string, Locator][] = [
    ['Add files', page.getByRole('link', { name: 'Add files' })],
    ['Export', page.getByRole('button', { name: 'Export', exact: true })],
    ['Layers', page.getByRole('button', { name: 'Layers', exact: true })],
    ['Fit block', page.getByRole('button', { name: 'Fit block', exact: true })],
    ['Orient north', page.getByRole('button', { name: 'Orient north' })],
    ['Zoom in', page.getByRole('button', { name: 'Zoom in' })],
    ['Zoom out', page.getByRole('button', { name: 'Zoom out' })],
    ['Return to block view', page.getByRole('button', { name: 'Return to block view' })],
    ['Checks', page.getByRole('button', { name: /Checks/ })],
  ];
  return Promise.all(targets.map(async ([name, locator]) => {
    await expect(locator, `${name} visible`).toBeVisible();
    return sampleControl(locator, name);
  }));
}

function assertControls(samples: ContrastSample[], theme: string) {
  for (const sample of samples) {
    expect.soft(sample.enabled, `${theme} ${sample.name} must be enabled`).toBe(true);
    expect.soft(sample.opacity, `${theme} ${sample.name} opacity`).toBe(1);
    expect.soft(sample.text, `${theme} ${sample.name} text`).toBeGreaterThanOrEqual(4.5);
    if (sample.icon !== null) expect.soft(sample.icon, `${theme} ${sample.name} icon`).toBeGreaterThanOrEqual(3);
    if (sample.boundary !== null) expect.soft(sample.boundary, `${theme} ${sample.name} border`).toBeGreaterThanOrEqual(3);
  }
}

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
  await expect(page.locator('[data-tile-canvas]')).toHaveAttribute('data-scene-ready', 'true');
  const screenshots = process.env.ULPIN_UI01_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const diagnostics: Record<string, unknown> = { themes: [] };
  const saveMeasurements = async () => {
    if (screenshots) await writeFile(join(screenshots, 'measurements.json'), JSON.stringify(diagnostics, null, 2) + '\n');
  };

  for (const theme of ['light', 'dark'] as const) {
    await page.locator('.ulpin-app').evaluate((element, selected) => {
      if (selected === 'dark') element.setAttribute('data-theme', 'dark');
      else element.removeAttribute('data-theme');
    }, theme);
    const immediate = await sampleControl(page.getByRole('link', { name: 'Add files' }), 'Add files immediate');
    await page.waitForTimeout(250); // Allow ordinary UI transitions to finish before contrast and screenshots.
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
      const actual = [
        ['brand', '.city-brand', '.city-header'],
        ['navigation', '.city-nav a', '.city-header'],
        ['area heading', '.ui-block-title h1', '.ui-contextbar'],
        ['source world', '.ui-map-world', '.ui-map-world'],
        ['map mode', '.ui-map-mode button[aria-pressed="false"]', '.ui-map-mode'],
        ['selected map mode', '.ui-map-mode button[aria-pressed="true"]', '.ui-map-mode button[aria-pressed="true"]'],
        ['map status', '.ui-map-status', '.ui-map-status'],
      ].map(([name, foreground, background]) => {
        const foregroundElement = element.querySelector(foreground)!;
        const backgroundElement = element.querySelector(background)!;
        const a = rgb(getComputedStyle(foregroundElement).color);
        const b = rgb(getComputedStyle(backgroundElement).backgroundColor);
        return { name, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
      return {
        text: [
          ['--ui-ink', '--ui-background'], ['--ui-ink', '--ui-surface'],
          ['--ui-ink-soft', '--ui-surface'], ['--ui-muted', '--ui-surface'],
          ['--ui-on-primary', '--ui-primary'], ['--ui-info', '--ui-info-soft'],
          ['--ui-success', '--ui-success-soft'], ['--ui-warning', '--ui-warning-soft'],
          ['--ui-danger', '--ui-danger-soft'],
        ].map(([foreground, background]) => ({ foreground, background, ratio: contrast(foreground, background) })),
        control: contrast('--ui-line-control', '--ui-surface'),
        actual,
        surface: value('--ui-surface'),
        computedFont: style.fontFamily,
      };
    });
    for (const pair of result.text) expect(pair.ratio, `${theme} ${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(4.5);
    for (const pair of result.actual) expect(pair.ratio, `${theme} visible ${pair.name}`).toBeGreaterThanOrEqual(4.5);
    expect(result.control, `${theme} control outline`).toBeGreaterThanOrEqual(3);
    expect(result.computedFont).toContain('Noto Sans');
    const controls = await visibleControls(page);
    assertControls(controls, theme);
    expect(controls.every(sample => sample.runningAnimations === 0), `${theme} controls settled`).toBe(true);
    (diagnostics.themes as unknown[]).push({ theme, immediate, tokens: result, controls });
    if (screenshots) await page.screenshot({ path: join(screenshots, `studio-${theme}-desktop.png`) });
    await saveMeasurements();
  }

  const addFiles = page.getByRole('link', { name: 'Add files' });
  await addFiles.hover();
  await page.waitForTimeout(250);
  const hovered = await sampleControl(addFiles, 'Add files hover');
  assertControls([hovered], 'dark hover');
  await addFiles.focus();
  await page.keyboard.press('Tab');
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  await expect.soft(exportButton).toBeFocused();
  const focused = await sampleControl(exportButton, 'Export keyboard focus');
  expect.soft(await exportButton.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  expect.soft(focused.outlineWidth).toBeGreaterThanOrEqual(2);
  expect.soft(focused.outline, 'dark keyboard focus outline').toBeGreaterThanOrEqual(3);
  diagnostics.interaction = { hovered, focused };
  await saveMeasurements();

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
  diagnostics.fonts = fonts;
  diagnostics.fontRequests = requests;

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneResults: unknown[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await page.locator('.ulpin-app').evaluate((element, selected) => {
      if (selected === 'dark') element.setAttribute('data-theme', 'dark');
      else element.removeAttribute('data-theme');
    }, theme);
    await page.waitForTimeout(250);
    const phone = await page.evaluate(() => ({
      viewport: [innerWidth, innerHeight],
      documentWidth: document.documentElement.scrollWidth,
      appWidth: document.querySelector('.ulpin-app')!.getBoundingClientRect().width,
      font: getComputedStyle(document.querySelector('.ulpin-app')!).fontFamily,
    }));
    expect.soft(phone.font).toContain('Noto Sans');
    expect.soft(phone.appWidth).toBeLessThanOrEqual(390);
    const mobileFit = page.getByRole('button', { name: 'Fit block', exact: true });
    await expect.soft(mobileFit).toBeVisible();
    phoneResults.push({ theme, ...phone });
    if (screenshots) await page.screenshot({ path: join(screenshots, `studio-${theme}-phone.png`) });
  }
  diagnostics.phone = phoneResults;
  await saveMeasurements();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.ulpin-app').evaluate(element => element.removeAttribute('data-theme'));
  await page.waitForTimeout(250);
  const brand = page.locator('.city-brand > span');
  const normalHeight = (await brand.boundingBox())!.height;
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const zoomHeight = (await brand.boundingBox())!.height;
  expect.soft(zoomHeight / normalHeight, '200% visible font scaling').toBeGreaterThanOrEqual(1.9);
  await expect.soft(page.getByRole('button', { name: 'Fit block', exact: true })).toBeVisible();
  diagnostics.zoom200 = { normalHeight, zoomHeight, ratio: zoomHeight / normalHeight };
  if (screenshots) await page.screenshot({ path: join(screenshots, 'studio-light-200-percent.png') });
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.evaluate(() => {
    const button = document.querySelector('.ulpin-app .ui-button')!;
    const spinner = document.createElement('span');
    spinner.className = 'ui-spin';
    document.querySelector('.ulpin-app')!.appendChild(spinner);
    const result = { transition: getComputedStyle(button).transitionDuration, animation: getComputedStyle(spinner).animationName };
    spinner.remove();
    return result;
  });
  expect.soft(motion.transition).toBe('0s');
  expect.soft(motion.animation).toBe('none');
  diagnostics.reducedMotion = motion;
  await saveMeasurements();
});
