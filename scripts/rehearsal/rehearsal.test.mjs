// Ported from S1.3 acceptance.test.mjs; recorded figures are test_only, never new rehearsal verdicts.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { allowedPath, readKit, runtimePlan } from './kit-manifest.mjs';
import { newResult, recorder, smoothness } from './presenter.mjs';

const scratch = await mkdtemp('E:/ulpin-tmp/s3-3-test-');
const miniPath = fileURLToPath(new URL('./mini-kit.json', import.meta.url));
const mini = JSON.parse(await readFile(miniPath, 'utf8'));
const fixture = JSON.parse(await readFile(new URL('./recorded.fixture.json', import.meta.url), 'utf8'));
const temporary = [];
async function manifest(body) {
  const path = `${scratch}/${temporary.length}.json`;
  temporary.push(path);
  await writeFile(path, JSON.stringify(body));
  return path;
}
after(async () => {
  for (const path of temporary) await rm(path);
  await rmdir(scratch);
});

test('real NYC and Tweed mini manifest has the recorded sizes and verified hashes', async () => {
  const files = await readKit(miniPath, true);
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(f => f.bytes), [1103282, 151552]);
});
test('wrong size is refused before a run', async () => {
  const entries = structuredClone(mini.entries);
  entries[0].bytes += 1; // test_only corruption control.
  await assert.rejects(readKit(await manifest({ entries })), /Size mismatch/);
});
test('hashing is optional, but a requested wrong hash is refused', async () => {
  const entries = [{ ...mini.entries[1], sha256: '0'.repeat(64) }]; // test_only corruption control.
  const path = await manifest({ entries });
  assert.equal((await readKit(path)).length, 1);
  await assert.rejects(readKit(path, true), /Hash mismatch/);
});
test('closed-kit manifest and entry are refused before filesystem access', async () => {
  const closed = 'E:/BhuAayam-data/holdout/judge-kit-closed/not-opened.json';
  await assert.rejects(readKit(closed), /Protected path/);
  await assert.rejects(readKit(await manifest({ entries: [{ ...mini.entries[0], path: closed }] })), /Protected/);
  assert.throws(() => allowedPath(closed.replaceAll('/', '\\').toUpperCase()), /Protected/);
});
test('C:, private runtime, alternate streams and Windows path aliases are refused', () => {
  for (const path of ['C:/no', 'E:/BhuAayam-data/runtime/no', 'E:/safe/a:stream', 'E:/holdout./no']) {
    assert.throws(() => allowedPath(path));
  }
});
test('demo, malformed runtime, protected reh-01 and output escape are refused', () => {
  for (const name of ['ulpin-demo', 'ulpin-reh-3', 'ulpin-reh-030', 'ulpin-reh-03\n', 'ulpin-reh-01']) {
    assert.throws(() => runtimePlan(name, `${scratch}/run`));
  }
  assert.throws(() => runtimePlan('ulpin-reh-03', 'E:/ulpin-tmp/../outside'));
  assert.equal(runtimePlan('ulpin-reh-03', `${scratch}/run`).apiPort, 21036);
});
test('recorded S1.3 figures fit the compact result without inventing missing moments', () => {
  const result = newResult(fixture.runtime, fixture.files);
  result.renderer = fixture.renderer;
  result.files[0].words = fixture.files[0].tray;
  fixture.frames.captures.forEach((row, index) => {
    const capture = Object.fromEntries(fixture.frames.columns.map((name, i) => [name, row[i]]));
    result.frames[index ? 'map' : 'batch'].push(capture);
  });
  result.jobs = fixture.jobRows;
  const saved = JSON.parse(JSON.stringify(result));
  assert.equal(fixture.test_only, true);
  assert.equal(saved.frames.batch[0].over100, 1);
  assert.equal(saved.frames.map[0].maxMs, 78);
  assert.equal(saved.jobs[0].queue_s, 0.421);
  assert.equal(saved.jobs[0].exec_s, 0.092);
  assert.equal(saved.jobs[0].retries, 0);
  for (const field of ['retained', 'layoutQuestionShown', 'firstPartOnMap', 'lastPartOnMap']) {
    assert.equal(saved.files[0][field], null);
  }
  assert.deepEqual(saved.process.samples, []);
  assert.equal(saved.process.exitsBefore, null);
});
test('SwiftShader, software, unknown renderer and hidden pages never give a smoothness verdict', () => {
  const captures = ['batch', 'map'].map(page => ({ page, frames: 20, over100: 0, hidden: 0 }));
  for (const renderer of ['ANGLE (SwiftShader D3D11)', 'D3D11 Microsoft Basic Render Driver', 'llvmpipe', null]) {
    assert.equal(smoothness(renderer, captures), 'not_a_smoothness_verdict');
  }
  assert.equal(smoothness(fixture.renderer, captures), 'no_slow_frames_in_captures');
  assert.equal(smoothness(fixture.renderer, [{ ...captures[0], hidden: 1 }, captures[1]]),
    'not_a_smoothness_verdict');
});
test('ported recorder counts frame deltas and the longest task without storing an unbounded trace', () => {
  const window = {};
  let tick;
  let observe;
  runInNewContext(`(${recorder.toString()})()`, { window, document: { hidden: false },
    performance: { now: () => 0 }, requestAnimationFrame: callback => { tick = callback; },
    PerformanceObserver: class {
      constructor(callback) { observe = callback; }
      observe() {}
    } });
  tick(125);
  tick(140);
  observe({ getEntries: () => [{ duration: 93 }] });
  assert.equal(window.__rehearsal.frames, 2);
  assert.equal(window.__rehearsal.maxMs, 125);
  assert.equal(window.__rehearsal.over100, 1);
  assert.equal(window.__rehearsal.longestTaskMs, 93);
});
test('dry-run prints files, isolated runtime, ports and output paths without creating output', async () => {
  const out = `${scratch}/never-created`;
  const run = spawnSync(process.execPath, ['scripts/rehearsal/kit-drop.mjs', '--runtime', 'ulpin-reh-03',
    '--kit', miniPath, '--out', out, '--dry-run'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const plan = JSON.parse(run.stdout);
  assert.equal(plan.files.length, 2);
  assert.equal(plan.apiPort, 21036);
  assert.equal(plan.studioPort, 5189);
  assert.equal(plan.result, `${out}/result.json`);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});
