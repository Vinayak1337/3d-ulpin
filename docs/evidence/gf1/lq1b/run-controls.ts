import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { controlsWalk } from './controls-walk';

const target = process.argv[2];
if (!target) throw new Error('Supply a new result path.');
const captured = JSON.parse(readFileSync('docs/evidence/gf1/lq1a/controls-second.json', 'utf8'));
const scratch = `E:/BhuAayam-data/task-data/lq1b/controls-${randomBytes(8).toString('hex')}`;
mkdirSync(scratch, { recursive: true });
const require = createRequire(resolve('apps/studio/package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const vite = await createServer({ root: 'apps/studio', configFile: 'apps/studio/vite.config.ts', envFile: false,
  server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
let result;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  result = await controlsWalk(page, vite.resolvedUrls.local[0], captured, scratch);
} catch (error: any) {
  result = { failure: error.message, scratch };
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite.close();
  writeFileSync(target, `${JSON.stringify(result)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify(result));
