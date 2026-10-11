import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { controlWalk } from './walk-controls';

const target = process.argv[2];
if (!target) throw new Error('Supply new result path.');
const controls = JSON.parse(readFileSync('docs/evidence/gf1/lq1a/controls-second.json', 'utf8'));
const scratch = `E:/BhuAayam-data/task-data/lq1a/controls-${randomBytes(8).toString('hex')}`;
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
  const context = await browser.newContext();
  await context.route('**/api/v1/**', route => route.fulfill({ status: 503,
    json: { error: { code: 'CONTROL_ONLY', message: 'No live runtime in this isolated UI control.' } } }));
  // controlWalk creates a browser page in its own context; install the global fallback via a narrow wrapper.
  const wrapper = { newPage: async (options: any) => {
    const page = await context.newPage();
    if (options?.viewport) await page.setViewportSize(options.viewport);
    return page;
  } } as unknown as typeof browser;
  const url = `${vite.resolvedUrls.local[0]}studio/work/cases/${controls.manifest.caseId}/intake`;
  result = await controlWalk(wrapper, url, controls, scratch);
} catch (error: any) {
  result = { failure: error.message, scratch };
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite.close();
  writeFileSync(target, `${JSON.stringify(result)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify(result));
