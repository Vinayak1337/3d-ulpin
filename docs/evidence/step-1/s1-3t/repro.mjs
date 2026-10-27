// Transport-only synthetic bytes; no runtime, source files, registry records or external services.
import assert from 'node:assert/strict';
import { Agent, createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const totalBytes = 107832285;
const partBytes = 8 * 1024 * 1024;
const hypotheses = {
  proxy: 'Default proxy drops connections: direct versus proxy, same load; then --compare-agent once.',
  deadlines: 'Default 1 s/5 s deadline: compare 1.3 s and 5.2 s responses (--controls).',
  browser: 'HTTP/1.1 host sockets queue requests: compare six and eight concurrent slow GETs.',
  loop: 'A blocked API loop causes timeout: normal versus a controlled 2.5 s stall (--controls).',
  baseline: 'Two sequential-part 107832285-byte uploads, eight slow GETs, small POST, direct Node health.',
  success: 'Reproduce ERR_CONNECTION_TIMED_OUT, not just waiting; report queueing separately.',
  stop: 'One case per variant, 25 s per case, 150 s global deadline; no retries or runtime follow-up.',
  qualification: 'Run 5 instantaneous concurrency is missing; 6/8 GETs bracket HTTP/1.1 host saturation.',
};

function startStub() {
  let records = [];
  let sockets = 0;
  let maxSockets = 0;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return res.end();
    const url = new URL(req.url, 'http://127.0.0.1');
    const record = { path: url.pathname, query: url.search, at: Date.now(), bytes: 0 };
    records.push(record);
    req.on('data', chunk => { record.bytes += chunk.length; });
    req.on('aborted', () => { record.abortedAt = Date.now(); });
    res.on('finish', () => { record.finishedAt = Date.now(); });
    if (url.pathname === '/api/block') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
    await new Promise(done => req.on('end', done));
    await sleep(Number(url.searchParams.get('delay') ?? 0));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ bytes: record.bytes }));
  });
  server.on('connection', socket => {
    sockets++;
    maxSockets = Math.max(maxSockets, sockets);
    socket.on('close', () => { sockets--; });
  });
  parentPort.on('message', message => {
    if (message === 'reset') {
      records = [];
      maxSockets = sockets;
      loop.reset();
      parentPort.postMessage({ reset: true });
    } else parentPort.postMessage({ records, maxSockets, loopMaxMs: loop.max / 1e6 });
  });
  server.listen(0, '127.0.0.1', () => parentPort.postMessage({
    port: server.address().port,
    defaults: { requestTimeout: server.requestTimeout, headersTimeout: server.headersTimeout,
      timeout: server.timeout, keepAliveTimeout: server.keepAliveTimeout },
  }));
}

async function browserLoad(page, options) {
  return page.evaluate(async ({ base, count, delay, block, totalBytes, partBytes }) => {
    const pause = ms => new Promise(done => setTimeout(done, ms));
    const call = async (path, init) => {
      const startedAt = Date.now();
      try {
        const res = await fetch(`${base}${path}`, init);
        await res.arrayBuffer();
        return { path, startedAt, finishedAt: Date.now(), ms: Date.now() - startedAt, status: res.status };
      } catch (error) {
        return { path, startedAt, ms: Date.now() - startedAt, error: String(error) };
      }
    };
    const upload = async stream => {
      const payload = new Uint8Array(partBytes);
      const parts = [];
      for (let sent = 0; sent < totalBytes; sent += partBytes) {
        parts.push(await call(`/api/upload?stream=${stream}&part=${parts.length}&delay=25`, {
          method: 'POST', body: payload.subarray(0, Math.min(partBytes, totalBytes - sent)),
        }));
      }
      return parts;
    };
    const uploads = [upload(0), upload(1)];
    const reads = Array.from({ length: count }, (_, i) => call(`/api/slow?i=${i}&delay=${delay}`));
    await pause(100);
    const blocker = block ? call('/api/block') : Promise.resolve(null);
    const enrol = call('/api/enrol', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"transportProbe":true}',
    });
    return { uploads: await Promise.all(uploads), reads: await Promise.all(reads),
      blocker: await blocker, enrol: await enrol };
  }, { ...options, totalBytes, partBytes });
}

function variantsFor(origin, target) {
  if (process.argv.includes('--compare-agent')) return [
    { name: 'default-agent', base: origin, count: 6, delay: 1300 },
    { name: 'keepalive-agent', base: origin, count: 6, delay: 1300, keepAlive: true },
  ];
  const controls = [
    { name: 'proxy-long', base: origin, count: 8, delay: 5200 },
    { name: 'proxy-block', base: origin, count: 8, delay: 1300, block: true },
  ];
  if (process.argv.includes('--controls')) return controls;
  return [
    { name: 'direct', base: target, count: 8, delay: 1300 },
    { name: 'proxy', base: origin, count: 8, delay: 1300 },
    { name: 'proxy-six', base: origin, count: 6, delay: 1300 },
    ...controls,
  ];
}

async function probeHealth(target, variant) {
  await sleep(200);
  const at = Date.now();
  try {
    const res = await fetch(`${target}/api/health?delay=${variant.name === 'proxy-long' ? 5200 : 0}`,
      { signal: AbortSignal.timeout(4500) });
    await res.text();
    return { at, ms: Date.now() - at, status: res.status };
  } catch (error) { return { at, ms: Date.now() - at, error: error.name }; }
}

async function observeBrowser(browser, out) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
    recordVideo: { dir: `${out}/video`, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const failures = [];
  const network = [];
  const transportFailures = [];
  page.on('requestfailed', req => failures.push({ at: Date.now(), url: req.url(), error: req.failure() }));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', event => network.push({
    url: event.response.url, protocol: event.response.protocol, connectionId: event.response.connectionId,
    timing: event.response.timing, requestId: event.requestId,
  }));
  cdp.on('Network.loadingFailed', event => transportFailures.push(event));
  return { context, page, failures, network, transportFailures };
}

async function runVariant(harness, variant) {
  const { proxy, origin, rpc, target, page, arrivals, network } = harness;
  const agent = variant.keepAlive ? new Agent({ keepAlive: true }) : undefined;
  proxy.config.preview.proxy['/api'].agent = agent;
  await page.goto(origin);
  arrivals.length = 0;
  network.length = 0;
  await rpc('reset');
  const start = Date.now();
  const cpu = process.cpuUsage();
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const timeout = setTimeout(() => { console.error(`Case stop: ${variant.name}`); process.exit(1); }, 25000);
  try {
    const health = probeHealth(target, variant);
    const traffic = await browserLoad(page, variant);
    return { name: variant.name, start, elapsedMs: Date.now() - start, traffic, health: await health,
      stub: await rpc('sample'), proxyLoopMaxMs: loop.max / 1e6, proxyCpu: process.cpuUsage(cpu),
      network: [...network], proxyArrivals: [...arrivals] };
  } finally {
    clearTimeout(timeout);
    loop.disable();
    agent?.destroy();
  }
}

function checkResult(result) {
  const { name, traffic, health, stub } = result;
  const responses = [...traffic.uploads.flat(), ...traffic.reads, traffic.enrol];
  console.log(JSON.stringify({ name, browserResponses: responses.length, enrolMs: traffic.enrol.ms, health,
    maxSockets: stub.maxSockets, loopMaxMs: stub.loopMaxMs,
    errors: responses.filter(response => response.status !== 200) }));
  assert.equal(stub.records.reduce((sum, req) => sum + (req.path === '/api/upload' ? req.bytes : 0), 0),
    2 * totalBytes, `${name}: both byte streams fully received`);
  if (name === 'proxy-long') assert.equal(health.error, 'TimeoutError');
  if (name === 'proxy-block') assert.ok(stub.loopMaxMs >= 2400);
}

async function main() {
  console.log(JSON.stringify({ hypotheses }));
  const out = resolve(process.argv[2] ?? 'E:/ulpin-tmp/s1-3t/offline');
  assert.ok(out.replaceAll('\\', '/').startsWith('E:/ulpin-tmp/'));
  mkdirSync(`${out}/site`, { recursive: true });
  writeFileSync(`${out}/site/index.html`, '<!doctype html><title>Transport probe</title>');
  const worker = new Worker(new URL(import.meta.url));
  const first = await new Promise(done => worker.once('message', done));
  const rpc = message => new Promise(done => { worker.once('message', done); worker.postMessage(message); });
  const target = `http://127.0.0.1:${first.port}`;
  process.env.ULPIN_API_TARGET = target;
  const { preview } = await import(pathToFileURL(resolve('apps/studio/node_modules/vite/dist/node/index.js')));
  const { chromium } = await import('@playwright/test');
  let proxy;
  let browser;
  const watchdog = setTimeout(() => { console.error('Global stop condition reached'); process.exit(1); }, 150000);
  try {
    proxy = await preview({ root: resolve('apps/studio'), configFile: resolve('apps/studio/vite.config.ts'),
      envDir: false, build: { outDir: `${out}/site` }, preview: { port: 0, strictPort: true, open: false } });
    const origin = `http://127.0.0.1:${proxy.httpServer.address().port}`;
    browser = await chromium.launch({ headless: false, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist',
      `--log-net-log=${out}/netlog.json`] });
    const arrivals = [];
    proxy.httpServer.on('request', req => arrivals.push({ at: Date.now(), url: req.url }));
    const observed = await observeBrowser(browser, out);
    const results = [];
    for (const variant of variantsFor(origin, target)) {
      const result = await runVariant({ proxy, origin, rpc, target, arrivals, ...observed }, variant);
      results.push(result);
      writeFileSync(`${out}/observations.json`, JSON.stringify({ hypotheses, node: process.version,
        browser: browser.version(), serverDefaults: first.defaults, failures: observed.failures,
        transportFailures: observed.transportFailures, results }, null, 2));
      checkResult(result);
    }
    await observed.context.close();
    assert.equal(observed.failures.length, 0, 'Browser connection failure reproduced; inspect observations.json');
  } finally {
    await browser?.close();
    proxy?.httpServer.closeAllConnections();
    if (proxy) await new Promise(done => proxy.httpServer.close(done));
    await worker.terminate();
    clearTimeout(watchdog);
  }
}

if (isMainThread) await main();
else startStub();
