// Attribute only the frozen difference outside UI regions to a controlled shadow-frustum comparison.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { writeEvidence } from './evidence-json.mjs';

const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const directory = 'docs/evidence/gf5/lv1';
const before = await load(`${directory}/before.json`);
const parity = await load(`${directory}/parity.json`);
const diagnosis = await load(`${directory}/lv2-diagnosis-assets-present.json`);
const paths = [before.rawTimingFile.replace('/timings.json', '/final.png'), parity.screenshot,
  `${diagnosis.scratch}/unmodified.png`, `${diagnosis.scratch}/shadow-forced-update.png`];
const urls = await Promise.all(paths.map(async (path) =>
  `data:image/png;base64,${(await readFile(path)).toString('base64')}`));
const regions = diagnosis.regions.map((region) => region.name === 'assetErrorNote'
  ? { ...region, x: 28, y: 628, width: 379, height: 56 } : region);

function matchMask({ urls, rect, regions }) {
  return Promise.all(urls.map(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, -rect.x, -rect.y);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  })).then(([before, frozen, original, changed]) => {
    let residualPixels = 0;
    let shadowMaskMatchedPixels = 0;
    for (let index = 0; index < before.length; index += 4) {
      const x = index / 4 % rect.width + rect.x;
      const y = Math.floor(index / 4 / rect.width) + rect.y;
      if (regions.some((region) => x >= region.x - 2 && x <= region.x + region.width + 2
        && y >= region.y - 2 && y <= region.y + region.height + 2)) continue;
      if (![0, 1, 2].some((channel) => Math.abs(before[index + channel] - frozen[index + channel]) > 8)) continue;
      residualPixels++;
      if ([0, 1, 2].some((channel) => Math.abs(original[index + channel] - changed[index + channel]) > 8)) {
        shadowMaskMatchedPixels++;
      }
    }
    return { residualPixels, shadowMaskMatchedPixels };
  });
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(matchMask, { urls, rect: parity.rect, regions });
  await writeEvidence(`${directory}/lv2-shadow-difference.json`, {
    ...result, paths,
    limit: 'A matching changed-pixel mask supports a shadow cause; no lighting/frustum code was changed for pixels.',
  });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
