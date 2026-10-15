import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { startHttp, stopHttp } from '../kn2/http';
import { startSandbox, stopSandbox } from '../aq1/sandbox';
import { idle, startDispatcher, stopDispatcher, waitFor } from '../zb1/jobs';
import { confirm, drop, layers, makeCase, packageRead, targets, type Layer } from './http-walk';
import { openArea } from './browser';
import { areaReadTiming, drawableBuildings } from './server-timing';

const nonce = process.env.ULPIN_AD1_NONCE!;
const phase = process.env.ULPIN_AD1_PHASE!;
const scratch = `E:/BhuAayam-data/task-data/ad1/${nonce}`;
const results: Record<string, unknown> = { phase, scratch };
const failures: unknown[] = [];
const hashes = layers.map(layer => ({ name: layer.name, sha256: sha256(readFileSync(layer.folder + layer.name)) }));

function ownBox() {
  const container = process.env.ULPIN_AD1_CONTAINER!;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  assert.equal(container, `ulpin-ad1-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'ad1_control');
  assert.equal(url.pathname, `/ad1_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'AD1']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

async function startStudio() {
  process.env.ULPIN_API_TARGET = `http://127.0.0.1:${process.env.API_PORT}`;
  const require = createRequire(resolve('apps/studio/package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const vite = await createServer({ root: 'apps/studio', configFile: 'apps/studio/vite.config.ts', envFile: false,
    logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen();
  return vite;
}

async function recordedCounts(areaId: string) {
  return (await query(`SELECT body->>'kind' kind,count(*)::int count FROM physical_features
    WHERE area_id=$1 AND revision>0 GROUP BY 1 ORDER BY 1`, [areaId])).rows;
}

/** Server timing first (nothing else running), then a cold browser visit of the area screen. */
async function measure(label: string, areaId: string, browser: Browser, url: string) {
  const expected = await drawableBuildings(areaId);
  const server = await areaReadTiming(areaId);
  const screen = await openArea(browser, url, areaId, expected, `${scratch}/${label}.png`);
  results[label] = { areaId, recorded: await recordedCounts(areaId), server, screen };
}

/** Drop one layer and record it with no cards once its automatic review is published (no review request). */
async function record(caseId: string, layer: Layer) {
  const dropped = await drop(caseId, layer);
  await waitFor(() => targets(caseId), page => Boolean(page.packages.find(pkg => pkg.packageId === dropped.packageId)
    ?.reviewFingerprint), 240000);
  await idle(caseId);
  await confirm(caseId, dropped.packageId, 0);
  return (await packageRead(dropped.packageId)).areaId;
}

async function nycArea(browser: Browser, url: string) {
  const caseId = await makeCase('AD1 NYC demo area test_only');
  const buildings = await drop(caseId, layers[0]);
  await idle(caseId);
  const cards = await confirm(caseId, buildings.packageId, 100);
  const areaId = (await packageRead(buildings.packageId)).areaId;
  results.nyc = { caseId, areaId, cards: cards.confirmation.counts };
  await measure('buildings1661', areaId, browser, url);
  for (const layer of layers.slice(1, 3)) await record(caseId, layer);
  await measure('demoArea2148', areaId, browser, url);
}

async function niagaraArea(browser: Browser, url: string) {
  const caseId = await makeCase('AD1 Niagara condominium parcels test_only');
  const areaId = await record(caseId, layers[3]);
  results.niagaraCase = { caseId, areaId };
  await measure('niagara', areaId, browser, url);
}

async function main() {
  ownBox();
  mkdirSync(scratch, { recursive: true });
  let vite;
  let browser;
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await startSandbox();
    await startHttp();
    startDispatcher();
    vite = await startStudio();
    browser = await chromium.launch({ headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const url = vite.resolvedUrls.local[0];
    await nycArea(browser, url);
    await niagaraArea(browser, url);
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n').slice(0, 8) });
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await vite?.close();
    await stopDispatcher();
    results.http = await stopHttp();
    await stopSandbox();
    await closePool();
    for (const entry of hashes) {
      assert.equal(sha256(readFileSync(layers.find(layer => layer.name === entry.name)!.folder + entry.name)),
        entry.sha256);
    }
    console.log(JSON.stringify({ task: 'AD1', results, failures, hashes, originalHashesUnchanged: true,
      providers: 0, network: 'Loopback tmpfs SQL, memory object storage, product Python offline' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
