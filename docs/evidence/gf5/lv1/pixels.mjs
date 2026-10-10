import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

async function loadImages(page, before, after, rect) {
  const buffers = await Promise.all([before, after].map((path) => readFile(path)));
  const urls = buffers.map((buffer) => `data:image/png;base64,${buffer.toString('base64')}`);
  await page.evaluate(async ({ urls, rect }) => {
    window.__lv1Pixels = await Promise.all(urls.map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, -rect.x, -rect.y);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }));
  }, { urls, rect });
}

async function difference(page) {
  return page.evaluate(() => {
    const [left, right] = window.__lv1Pixels;
    let error = 0;
    let changed = 0;
    for (let index = 0; index < left.length; index += 4) {
      let differs = false;
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(left[index + channel] - right[index + channel]);
        error += delta;
        if (delta > 8) differs = true;
      }
      if (differs) changed++;
    }
    return { meanAbsoluteError255: error / (left.length * 0.75), changedFraction: changed / (left.length / 4) };
  });
}

async function regionShares(page, rect, regions) {
  return page.evaluate(({ rect, regions }) => {
    const [left, right] = window.__lv1Pixels;
    const width = Math.round(rect.width);
    const counts = Object.fromEntries([...regions.map((region) => region.name), 'remainder'].map((name) => [name, 0]));
    for (let index = 0; index < left.length; index += 4) {
      if (![0, 1, 2].some((channel) => Math.abs(left[index + channel] - right[index + channel]) > 8)) continue;
      const x = index / 4 % width + rect.x;
      const y = Math.floor(index / 4 / width) + rect.y;
      const hit = regions.find((region) => x >= region.x - 2 && x <= region.x + region.width + 2
        && y >= region.y - 2 && y <= region.y + region.height + 2);
      counts[hit?.name ?? 'remainder']++;
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return Object.fromEntries(Object.entries(counts).map(([name, count]) =>
      [name, { changedPixels: count, shareOfChanged: count / total, fractionOfCanvas: count / (left.length / 4) }]));
  }, { rect, regions });
}

async function writeDifferenceImage(page, rect, path) {
  const url = await page.evaluate(({ width, height }) => {
    const [left, right] = window.__lv1Pixels;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const context = canvas.getContext('2d');
    const image = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < left.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) {
        image.data[index + channel] = Math.min(255, Math.abs(left[index + channel] - right[index + channel]) * 8);
      }
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }, rect);
  await writeFile(path, Buffer.from(url.split(',')[1], 'base64'), { flag: 'wx' });
}

export async function comparePixels(before, after, rect, differencePath, regions = []) {
  const browser = await chromium.launch({
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await loadImages(page, before, after, rect);
    if (differencePath) await writeDifferenceImage(page, rect, differencePath);
    const result = await difference(page);
    if (regions.length) result.regions = await regionShares(page, rect, regions);
    return result;
  } finally {
    await browser.close();
  }
}
