import { readFile } from 'node:fs/promises';
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

export async function comparePixels(before, after, rect) {
  const browser = await chromium.launch({
    headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await loadImages(page, before, after, rect);
    return await difference(page);
  } finally {
    await browser.close();
  }
}
