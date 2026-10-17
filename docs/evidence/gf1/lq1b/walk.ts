import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { startHttp, stopHttp } from '../kn2/http';
import { assertOwnBox, startSandbox, stopSandbox } from './sandbox';
import { browserWalk } from './walk-browser';

assertOwnBox();
const scratch = `E:/BhuAayam-data/task-data/lq1b/${process.env.ULPIN_LQ1B_NONCE}`;
mkdirSync(scratch, { recursive: true });
const inputs = ['buildings-original.geojson', 'parks.geojson'].map(name => {
  const path = `E:/BhuAayam-data/datasets/nyc-10013/files/${name}`;
  return { path, bytes: readFileSync(path).length,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
});
const result: Record<string, any> = { scratch, inputs };
let browser;
let vite;
let dispatcher;
try {
  await startSandbox();
  await query(sql('bootstrap.postgis'));
  await migrate();
  await startHttp();
  process.env.ULPIN_API_TARGET = `http://127.0.0.1:${process.env.API_PORT}`;
  const require = createRequire(resolve('apps/studio/package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const eventRequests = new Set<any>();
  vite = await createServer({ root: 'apps/studio', configFile: 'apps/studio/vite.config.ts', envFile: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: {
      '/api': { target: process.env.ULPIN_API_TARGET, changeOrigin: true, configure(proxy) {
        proxy.on('proxyReq', (request, incoming) => {
          if (!incoming.url?.split('?')[0].endsWith('/events')) return;
          eventRequests.add(request);
          request.once('close', () => eventRequests.delete(request));
        });
      } },
    } } });
  await vite.listen();
  dispatcher = setInterval(() => void dispatchTick().catch(error => { result.dispatchFailure = error.message; }), 500);
  browser = await chromium.launch({ headless: true });
  await browserWalk(browser, vite.resolvedUrls.local[0], scratch, result, () => {
    result.networkCut = { ownedViteEventRequestsClosed: eventRequests.size };
    for (const request of eventRequests) request.destroy(new Error('Bounded owned-runtime network cut'));
  });
} catch (error: any) {
  result.failure = error.message;
  process.exitCode = 1;
} finally {
  clearInterval(dispatcher);
  await browser?.close();
  await vite?.close();
  result.jobs = (await query('SELECT operation,status,error FROM jobs ORDER BY created_at')).rows;
  result.http = await stopHttp();
  await stopSandbox();
  await closePool();
  result.originalHashesUnchanged = inputs.every(input => createHash('sha256')
    .update(readFileSync(input.path)).digest('hex') === input.sha256);
  console.log(JSON.stringify(result));
}
