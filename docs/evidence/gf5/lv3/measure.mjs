// LV0 measuring algorithm, redirected to LV1-owned outputs: node docs/evidence/gf5/lv1/measure.mjs
// Starts only an owned Vite dev server; no API, Docker, database, provider, or GPU operation.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { freePort, startServer, stopServer } from './server.mjs';
import { chromium } from '@playwright/test';
import { installProbe, instrumentModules } from './browser-probe.mjs';
import { writeEvidence } from './evidence-json.mjs';

const root = process.cwd().replaceAll('\\', '/');
const evidence = resolve('docs/evidence/gf5/lv3');
const scratch = `E:/BhuAayam-data/task-data/lv3/run-${Date.now()}`;
const port = Number(process.env.LV0_PORT || 5234);
const pack = process.env.LV0_PACK || 'E:/BhuAayam-data/datasets/nyc-10013/nyc-10013-multimodal.zip';
const python = process.env.LV0_PYTHON || 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const capture = process.env.LV1_CAPTURE || (process.env.LV1_CPU_RATE === '4' ? 'throttled' : 'after');
if (!['lv3-before', 'lv3-after', 'lv3-throttled', 'lv3-headed'].includes(capture)) {
  throw new Error('Unknown capture name');
}
const headed = process.env.LV2_HEADED === '1';
const forbidden = /(^|[\\/])(heldout|holdout|evaluator|provisional|acquisitions|runtime)([\\/]|$)/i;
if (forbidden.test(pack) || forbidden.test(python)) throw new Error('Forbidden input path');
if ([5188, 5190, 5193, 5198, 5199, 5217, 5226, 5229].includes(port)) throw new Error('Reserved port');
await mkdir(scratch, { recursive: true });

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const groups = {};
  const functions = {};
  const totalUs = profile.timeDeltas.reduce((sum, delta) => sum + delta, 0);
  function category(stack) {
    if (stack.some((node) => node.callFrame.functionName === 'setBuildings')) return 'setBuildings';
    if (stack.some((node) => node.callFrame.functionName === 'setBase')) return 'setBase';
    if (stack.some((node) => node.callFrame.functionName === 'setQueryData')) return 'setQueryData';
    if (stack.some((node) => /toFootprints|toBase/.test(node.callFrame.functionName))) return 'conversion';
    if (stack.some((node) => /react-dom|react_jsx|react\.js/.test(node.callFrame.url))) return 'React';
    return 'other';
  }
  profile.samples.forEach((id, index) => {
    const stack = [];
    for (let current = id; current; current = parents.get(current)) stack.push(nodes.get(current));
    const group = category(stack);
    const delta = profile.timeDeltas[index];
    groups[group] = (groups[group] || 0) + delta;
    const leaf = nodes.get(id).callFrame;
    const url = leaf.url.replace(/^http:\/\/127\.0\.0\.1:\d+\//, '').replace(/\?.*$/, '');
    const module = url.replace(/^@fs\/.*?\/a2\//, '');
    const key = `${leaf.functionName || '(anonymous)'} ${module}:${leaf.lineNumber + 1}`;
    functions[key] = (functions[key] || 0) + delta;
  });
  const shares = (entries) => entries.map(([name, us]) => ({ name, ms: us / 1000, percent: 100 * us / totalUs }));
  return {
    totalMs: totalUs / 1000,
    groups: shares(Object.entries(groups)),
    topSelfFunctions: shares(Object.entries(functions).sort((a, b) => b[1] - a[1]).slice(0, 35)),
    denominator: 'All sampled main-thread time, including idle; groups exclusive by ancestor priority.',
  };
}

function summarize(probe, profile, input) {
  const chunks = probe.parts.filter((part) => part.type === 'chunk');
  const finalCount = chunks.reduce((sum, part) => sum + part.buildings, 0);
  const firstFinalDraw = probe.calls.find((call) => call.name === 'renderFrame' && call.buildings === finalCount);
  const drawAt = firstFinalDraw.at + firstFinalDraw.ms;
  const frames = probe.frames.filter((frame) => frame.at >= chunks[0].at && frame.at <= drawAt + 17)
    .map((frame) => frame.ms);
  let buildings = 0;
  chunks.forEach((part, index) => {
    part.intervalMs = index ? part.at - chunks[index - 1].at : null;
    part.buildingsBefore = buildings;
    buildings += part.buildings;
    const end = chunks[index + 1]?.at || probe.end;
    const calls = probe.calls.filter((call) => call.at >= part.at && call.at < end);
    part.sceneApplyMs = calls.filter((call) => call.name === 'setBuildings').reduce((sum, call) => sum + call.ms, 0);
    part.baseApplyMs = calls.filter((call) => call.name === 'setBase').reduce((sum, call) => sum + call.ms, 0);
  });
  return {
    git: input.git, input, environment: probe.environment,
    frames: {
      count: frames.length, p50Ms: percentile(frames, 0.5), p95Ms: percentile(frames, 0.95),
      longestMs: Math.max(...frames), over50: frames.filter((ms) => ms > 50).length,
      over100: frames.filter((ms) => ms > 100).length,
    },
    startToLastDrawMs: drawAt - probe.start,
    streamWindow: { from: chunks[0].at, to: drawAt, ms: drawAt - chunks[0].at },
    startToCompleteMs: probe.parts.find((part) => part.type === 'complete').at - probe.start,
    heap: probe.heap, chunks, longTasks: probe.tasks, cpu: profileSummary(profile),
    react: { commits: probe.commits.length, performedWorkByComponent: probe.renderNames },
    rawTimingFile: `${scratch}/timings.json`, rawCpuFile: `${scratch}/cpu.cpuprofile`,
    measurementLimits: [
      'rAF intervals are frame gaps, not GPU durations; Chromium runs headless at 1440 x 900.',
      'CPU sampling and hooks add overhead; development build, not a production benchmark.',
      'React fiber flags count renders; shared reconciler CPU is not attributable per component.',
      'Last draw is first render with all buildings, before grow-in completes; not a GPU readback fence.',
    ],
  };
}

async function runBrowser() {
  const browser = await chromium.launch({
    headless: !headed,
    channel: headed ? 'chrome' : undefined,
    args: headed ? ['--enable-precise-memory-info']
      : ['--enable-precise-memory-info', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const screenshots = [];
    let acknowledgements = 0;
    page.on('request', (request) => {
      if (!request.url().endsWith('/ack')) return;
      acknowledgements += 1;
      const name = acknowledgements === 1 ? 'first' : acknowledgements === 13 ? 'middle' : null;
      if (name) screenshots.push(page.screenshot({ path: `${scratch}/${name}.png` }));
    });
    await page.addInitScript(installProbe);
    await page.route('**/api/**', (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' || path.startsWith('/api/demo/')) return route.continue();
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/studio/add-files`);
    await page.locator('input[type=file]').setInputFiles(pack);
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 30000 });
    await page.evaluate(instrumentModules, root);
    const session = await page.context().newCDPSession(page);
    const throttle = Number(process.env.LV1_CPU_RATE || 1);
    if (throttle !== 1) await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 1000 });
    await session.send('Profiler.start');
    await page.evaluate((throttle) => {
      window.__lv1Throttle = throttle;
      const probe = window.__lv0;
      probe.start = performance.now();
      probe.heap = { startBytes: performance.memory.usedJSHeapSize };
      probe.active = true;
    }, throttle);
    await page.getByRole('button', { name: 'Start import', exact: true }).click();
    await page.waitForFunction(() => window.__lv0.completed || window.__lv0.failed, null, { timeout: 180000 });
    {
      // Sender completion is not renderer completion; capture the entire arrived scene.
      await page.waitForFunction(() => {
        const expected = window.__lv0.parts.reduce((sum, part) => sum + (part.buildings || 0), 0);
        return window.__lv0.failed || window.__ulpinScene?.drawnBuildings().count === expected;
      }, null, { timeout: 180000 });
    }
    await page.waitForFunction(() => !window.__ulpinScene.flight);
    await page.waitForTimeout(1000);
    const probe = await page.evaluate(() => {
      const probe = window.__lv0;
      probe.end = performance.now();
      probe.active = false;
      probe.heap.endBytes = performance.memory.usedJSHeapSize;
      const gl = window.__ulpinScene.renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      probe.environment = {
        browser: navigator.userAgent.match(/(?:HeadlessChrome|Chrome)\/[^ ]+/)?.[0], pixelRatio: devicePixelRatio,
        cpuThrottleRate: Number(window.__lv1Throttle || 1),
        gpuRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'Unavailable',
      };
      return probe;
    });
    const { profile } = await session.send('Profiler.stop');
    const scene = await page.evaluate(() => {
      const engine = window.__ulpinScene;
      return {
        ids: [...engine.buildingBounds.keys()].sort(),
        bounds: [engine.areaBox.min.toArray(), engine.areaBox.max.toArray()],
        camera: engine.camera.position.toArray(),
        target: engine.controls.target.toArray(),
        baseBounds: [engine.baseBox.min.toArray(), engine.baseBox.max.toArray()],
        framedBounds: engine.framedBox && [engine.framedBox.min.toArray(), engine.framedBox.max.toArray()],
        padBatches: engine.padBatches?.size,
        drawCalls: engine.renderer.info.render.calls,
      };
    });
    await writeFile(`${scratch}/scene.json`, JSON.stringify(scene));
    await page.screenshot({ path: `${scratch}/final.png` });
    await screenshots.reduce(async (previous, screenshot) => { await previous; await screenshot; }, Promise.resolve());
    const before = JSON.parse(await readFile('docs/evidence/gf5/lv1/before.json', 'utf8'));
    const beforeFolder = before.rawTimingFile.replace(/\/timings.json$/, '');
    const beforeScene = JSON.parse(await readFile(`${beforeFolder}/scene.json`, 'utf8'));
    await page.evaluate((pose) => {
      const engine = window.__ulpinScene;
      engine.camera.position.fromArray(pose.camera);
      engine.controls.target.fromArray(pose.target);
      engine.controls.update();
      engine.requestRender();
    }, beforeScene);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${scratch}/aligned.png` });
    const canvasRect = await page.locator('canvas').first().boundingBox();
    await writeFile(`${scratch}/canvas-rect.json`, JSON.stringify(canvasRect));
    if (probe.failed) throw new Error('Demo normalizer failed; inspect owned server log');
    await writeFile(`${scratch}/cpu.cpuprofile`, JSON.stringify(profile));
    await writeFile(`${scratch}/timings.json`, JSON.stringify(probe));
    return { probe, profile };
  } finally {
    await browser.close();
  }
}

await freePort(port);
const server = startServer({ root, scratch, port, python });
try {
  await server.ready;
  const { probe, profile } = await runBrowser();
  const bytes = await readFile(pack);
  const git = await new Promise((accept) => {
    const child = spawn('git', ['rev-parse', 'HEAD']);
    let text = '';
    child.stdout.on('data', (bytes) => { text += bytes; });
    child.once('exit', () => accept(text.trim()));
  });
  const input = { path: pack, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), git };
  const result = summarize(probe, profile, input);
  await writeEvidence(`${evidence}/${capture}.json`, result);
  process.env.LV1_ANALYZE_FILE = capture;
  await import('./analyze.mjs');
  console.log(JSON.stringify(result.frames));
} finally {
  await writeFile(`${scratch}/server.log`, server.log());
  await stopServer(server.child, port);
  console.log(`Owned port ${port} is free.`);
}
