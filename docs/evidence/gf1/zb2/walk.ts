import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { geometryBridge } from './geometry-bridge';
import { apiProcesses } from './process-control';
import { browserWalk } from './walk-browser';

const nonce = process.env.ULPIN_ZB2_NONCE!;
assert.match(nonce, /^[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL!).pathname, `/zb2_${nonce}`);
assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
const scratch = `E:/BhuAayam-data/task-data/zb2/${nonce}`;
mkdirSync(scratch, { recursive: true });
const result: Record<string, any> = { scratch, inputs: [] };
const api = await apiProcesses(result);
let bridge;
let vite;
let browser;
try {
  bridge = await geometryBridge();
  await query(sql('bootstrap.postgis'));
  await migrate();
  await createBucket();
  await api.start();
  process.env.ULPIN_API_TARGET = `http://127.0.0.1:${process.env.API_PORT}`;
  const require = createRequire(resolve('apps/studio/package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  vite = await createServer({ root: 'apps/studio', configFile: 'apps/studio/vite.config.ts', envFile: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await browserWalk(browser, vite.resolvedUrls.local[0], scratch, result);
} catch (error: any) {
  result.failure = error.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await api.stop();
  await vite?.close();
  bridge?.closeAllConnections();
  await new Promise<void>(resolve => bridge ? bridge.close(() => resolve()) : resolve());
  result.originalsUnchanged = result.inputs.every((input: any) => hash(input.path) === input.sha256);
  await closePool();
  writeFileSync(`${scratch}/result-raw.json`, JSON.stringify(result), { flag: 'wx' });
  console.log(JSON.stringify(result));
}

async function createBucket() {
  const require = createRequire(resolve('packages/server/package.json'));
  const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });
  try { await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET })); }
  finally { client.destroy(); }
}

function hash(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
