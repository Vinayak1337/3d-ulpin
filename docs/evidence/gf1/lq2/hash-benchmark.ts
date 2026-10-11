import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const output = process.argv[2];
if (!output) throw new Error('Supply a new receipt path.');
const input = JSON.parse(readFileSync('docs/evidence/gf1/da6/result.json', 'utf8')).assets[0];
const require = createRequire(resolve('apps/studio/package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const vite = await createServer({ root: 'apps/studio', configFile: 'apps/studio/vite.config.ts', envFile: false,
  server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript('window.__name = value => value;');
  await page.route('**/benchmark', route => route.fulfill({ contentType: 'text/html',
    body: '<input type="file" aria-label="Unchanged hash input">' }));
  await page.goto(`${vite.resolvedUrls.local[0]}benchmark`);
  await page.locator('input').setInputFiles(input.retainedPath);
  const modulePath = '/@fs/' + resolve('node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/sha256.js')
    .replaceAll('\\', '/');
  const measure = await page.evaluate(async ({ modulePath }) => {
    const { sha256 } = await import(/* @vite-ignore */ modulePath);
    const file = (document.querySelector('input') as HTMLInputElement).files![0]!;
    const hash = sha256.create();
    let beats = 0;
    let last = performance.now();
    let longestGapMs = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      longestGapMs = Math.max(longestGapMs, now - last);
      last = now;
      beats++;
    }, 16);
    const started = performance.now();
    for (let offset = 0; offset < file.size; offset += 8388608) {
      const bytes = new Uint8Array(await file.slice(offset, offset + 8388608).arrayBuffer());
      hash.update(bytes);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    clearInterval(timer);
    const elapsedMs = performance.now() - started;
    return { bytes: file.size, elapsedMs, MiBPerSecond: file.size / 1024 ** 2 / (elapsedMs / 1000),
      beats, longestGapMs, sha256: Array.from(hash.digest(), (byte: number) => byte.toString(16).padStart(2, '0')).join('') };
  }, { modulePath });
  if (measure.sha256 !== input.sha256) throw new Error('The unchanged input hash differed.');
  writeFileSync(output, `${JSON.stringify({ input: input.retainedPath, dependency: '@noble/hashes@1.8.0',
    partBytes: 8388608, ...measure, hashMatches: true, mode: 'Browser hashing only; no upload or runtime' })}\n`,
    { flag: 'wx' });
  console.log(JSON.stringify(measure));
} finally {
  await browser?.close();
  await vite.close();
}
