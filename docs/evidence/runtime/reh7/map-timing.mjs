import { chromium } from '@playwright/test';
import { attribute, startSampler } from './sampler.mjs';
import { writeFileSync } from 'node:fs';
import { save } from './audit.mjs';
import { summarise } from './profile.mjs';

// REH7 Part C: REH6's map-wait.mjs, the same zoom stages at 1440x900, with each display-window request's time split
// as the browser saw it. Playwright's request.timing() gives the network's own timestamps (queued or stalled before
// sending, waiting for the first byte, download); the Node clock at the request and requestfinished events shows
// whether the page's events arrived late (REH6 timed this span, and read the body before stopping its clock); a
// PerformanceObserver records the page's long main-thread tasks. Aborted requests are kept with their error words.
// Usage: node map-timing.mjs <apiPid> <run> [profile]; writes part-c-run<run>.json and part-c-samples-run<run>.json.
// With `profile`, Chromium's own sampling CPU profiler runs too (1 ms), and profile.mjs summarises its longest busy
// stretch into part-c-profile-run<run>.json; the raw profile stays in scratch, outside Git.
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const url = `http://127.0.0.1:5188/studio/areas/${areaId}`;
const [pid, run, profiling] = [Number(process.argv[2]), process.argv[3], process.argv[4] === 'profile'];
if (!Number.isInteger(pid) || !run) throw new Error('Usage: node map-timing.mjs <apiPid> <run>');
const samples = startSampler(pid);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.__longTasks = [];
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      window.__longTasks.push({ at: Math.round(performance.timeOrigin + entry.startTime),
        ms: Math.round(entry.duration) });
    }
  }).observe({ type: 'longtask', buffered: true });
});
const cdp = profiling ? await page.context().newCDPSession(page) : null;
if (cdp) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
}
const reads = [];
const open = new Map();
let lastActivity = performance.now();
let stageName = 'opened';
const isWindow = request => request.url().includes('/display-window');
const ms = value => (value === undefined || value < 0 ? null : Number(value.toFixed(1)));

/** The network's split of one request, in ms from its start; -1 marks a phase that did not happen. */
function split(timing) {
  const sent = timing.requestStart;
  return { queuedOrStalledMs: ms(sent), waitingForFirstByteMs: ms(timing.responseStart - sent),
    downloadMs: ms(timing.responseEnd - timing.responseStart), networkTotalMs: ms(timing.responseEnd),
    connectMs: timing.connectStart >= 0 ? ms(timing.connectEnd - timing.connectStart) : null };
}

function shape(request) {
  const query = new URL(request.url()).searchParams;
  const [minX, minY, maxX, maxY] = ['minX', 'minY', 'maxX', 'maxY'].map(key => Number(query.get(key)));
  return { widthM: Math.round(maxX - minX), heightM: Math.round(maxY - minY),
    centre: [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)], after: query.has('after'),
    limit: Number(query.get('limit')) };
}

page.on('request', request => {
  if (!isWindow(request)) return;
  open.set(request, { stage: stageName, startAt: Date.now(), begin: performance.now() });
  lastActivity = performance.now();
});
page.on('requestfinished', async request => {
  if (!isWindow(request)) return;
  lastActivity = performance.now();
  const seen = open.get(request);
  const eventSeconds = Number(((performance.now() - seen.begin) / 1000).toFixed(3));
  const endAt = Date.now();
  const response = await request.response();
  const body = await response?.json().catch(() => null);
  const data = body?.data ?? body;
  reads.push({ stage: seen.stage, ...shape(request), status: response?.status() ?? null,
    features: data?.features?.length ?? null, next: data?.next ? 'set' : null, aborted: false,
    nodeEventSeconds: eventSeconds, ...split(request.timing()), startAt: seen.startAt, endAt });
});
page.on('requestfailed', request => {
  if (!isWindow(request)) return;
  lastActivity = performance.now();
  const seen = open.get(request);
  const words = request.failure()?.errorText ?? 'failed';
  reads.push({ stage: seen.stage, ...shape(request), status: null, aborted: /ABORTED/i.test(words), error: words,
    nodeEventSeconds: Number(((performance.now() - seen.begin) / 1000).toFixed(3)), ...split(request.timing()),
    startAt: seen.startAt, endAt: Date.now() });
});
const errors = [];
page.on('pageerror', error => errors.push(String(error.message).slice(0, 200)));
const texts = async selector => (await page.locator(selector).allInnerTexts())
  .map(text => text.trim().replace(/\s+/g, ' ')).filter(Boolean);

/** Waits at least 20 s, and until no window read has started or finished for 8 s, at most 120 s. */
async function quiet() {
  const begin = performance.now();
  await page.waitForTimeout(20000);
  while (performance.now() - lastActivity < 8000 && performance.now() - begin < 120000) {
    await page.waitForTimeout(500);
  }
  return Number(((performance.now() - begin) / 1000).toFixed(1));
}

async function stage(label) {
  const waited = await quiet();
  return { label, waitedSeconds: waited, statusLines: await texts('[role="status"]'),
    scale: await texts('[class*="readout"]') };
}

async function wheel(x, y, ticks) {
  await page.mouse.move(x, y);
  for (let tick = 0; tick < ticks; tick++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
}

const out = { at: new Date().toISOString(), run, browser: `Chromium ${browser.version()} headless`,
  viewport: '1440x900', apiPid: pid, studio: 'http://127.0.0.1:5188 (Vite dev proxy to 127.0.0.1:21026)' };
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
const box = await page.locator('canvas').first().boundingBox();
const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
out.stages = [await stage('opened')];
for (const [label, ticks] of [['8 ticks in at the centre', 8], ['6 more', 6], ['6 more', 6], ['6 more', 6]]) {
  stageName = `${out.stages.length + 1} ${label}`;
  await wheel(x, y, ticks);
  out.stages.push(await stage(stageName));
}
const longTasks = await page.evaluate(() => window.__longTasks);
if (cdp) {
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync(`E:/BhuAayam-data/task-data/reh7/run${run}.cpuprofile`, JSON.stringify(profile));
  save(`part-c-profile-run${run}.json`, summarise(profile, longTasks));
}
out.pageErrors = errors;
await browser.close();
await samples.stop();
for (const read of reads) {
  Object.assign(read, attribute(samples, read.startAt, read.endAt));
  const tasks = longTasks.filter(task => task.at + task.ms >= read.startAt && task.at <= read.endAt);
  read.longTasksDuring = { count: tasks.length, totalMs: tasks.reduce((sum, task) => sum + task.ms, 0),
    longestMs: Math.max(0, ...tasks.map(task => task.ms)) };
}
out.reads = reads.sort((a, b) => a.startAt - b.startAt);
out.longTasks = { count: longTasks.length, totalMs: longTasks.reduce((sum, task) => sum + task.ms, 0),
  over1s: longTasks.filter(task => task.ms > 1000) };
save(`part-c-run${run}.json`, out);
save(`part-c-samples-run${run}.json`, { at: out.at, apiPid: pid, api: samples.api, postgres: samples.postgres });
console.log(JSON.stringify({ reads: reads.length, over3s: reads.filter(r => r.nodeEventSeconds > 3).length,
  over10s: reads.filter(r => r.nodeEventSeconds > 10).length, longTasks: out.longTasks.count, errors }));
