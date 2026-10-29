// Ported from S1.3 acceptance.test.mjs; recorded figures are test_only, never new rehearsal verdicts.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { allowedPath, readAnswers, readKit, runtimePlan } from './kit-manifest.mjs';
import { answerLayout, chooseOption, officerSeconds } from './officer-answers.mjs';
import { attributeFrames, batchItems, captureFrames, captureWatch, mapMoment, newResult, observeItem, observeRow,
  recorder, smoothness, uploadWatch } from './presenter.mjs';
import { attributeReads, cpuWatch, dropExits, exitLines, jobQuery, jobTiming, lockWaits, lockWaitSummary, lockWatch,
  processWatch, queueDepth, runnerActivity, runnerLoopWatch } from './timing.mjs';
import { performance } from 'node:perf_hooks';
import { watchBatch } from './kit-drop.mjs';
import { act1Options, declareKey, freshOutput, journeyTransport, layout, readInlineTable,
  retainedOriginals } from './act1.mjs';
import { setImmediate } from 'node:timers/promises';

await mkdir('E:/ulpin-tmp/s3-16h', { recursive: true });
const scratch = await mkdtemp('E:/ulpin-tmp/s3-16h/rehearsal-');
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
  for (const path of temporary) await rm(path, { force: true }); // A failed watch run never writes its result.
  await rmdir(scratch);
});

test('Act 1 arguments refuse unsafe runtimes, output paths, omissions and repeated or unknown flags', () => {
  const out = `${scratch}/act1-not-created`;
  assert.equal(act1Options(['--runtime', 'ulpin-reh-17', '--out', out]).apiPort, 21176);
  for (const runtime of ['demo', 'ulpin-demo', 'ulpin-reh-01', 'ulpin-reh-1', 'ulpin-reh-170', 'ulpin-reh-17\n']) {
    assert.throws(() => act1Options(['--runtime', runtime, '--out', out]));
  }
  for (const args of [[], ['--runtime'], ['--out', out], ['--runtime', '--out', out],
    ['--runtime', 'ulpin-reh-17', '--runtime', 'ulpin-reh-18', '--out', out],
    ['--runtime', 'ulpin-reh-17', '--out', out, '--closed-kit']]) assert.throws(() => act1Options(args));
  for (const path of ['C:/no', 'E:/outside', 'E:/ulpin-tmp/../outside', 'E:/ulpin-tmp/runtime/no']) {
    assert.throws(() => act1Options(['--runtime', 'ulpin-reh-17', '--out', path]));
  }
});

test('Act 1 output refuses existing folders and canonical escapes before writing evidence', async t => {
  await assert.rejects(freshOutput(act1Options(['--runtime', 'ulpin-reh-17', '--out', scratch])), /new output/);
  const link = `${scratch}/act1-escape`;
  await symlink('E:/Projects', link, 'junction');
  t.after(() => rmdir(link));
  await assert.rejects(freshOutput(act1Options(['--runtime', 'ulpin-reh-17', '--out', `${link}/new`])),
    /Output must be under/);
});

test('Act 1 reads automatic and officer-started synthetic table states inline without a navigation wait', async () => {
  for (const automatic of [true, false]) {
    let read = automatic;
    const presses = [];
    const table = {
      waitFor: async () => {}, innerText: async () => 'Read as a table. test_only synthetic reading',
      getByText: () => ({ isVisible: async () => read, waitFor: async () => assert.equal(read, true) }),
      getByRole: (role, { name }) => ({ isVisible: async () => !read, isEnabled: async () => true,
        click: async () => { presses.push(name); read = true; } }),
    };
    const page = { getByRole: (role, { name }) => role === 'region' ? table : {
      click: async () => presses.push(name),
    } };
    assert.match(await readInlineTable(page, 'synthetic.csv'), /Read as a table/);
    assert.deepEqual(presses, automatic ? ['Open the table: synthetic.csv']
      : ['Open the table: synthetic.csv', 'Read as a table']);
  }
});

test('Act 1 replaces a remembered proposal with the officer question before answering it', async () => {
  for (const memory of [true, false]) {
    let changed = false;
    const view = { waitFor: async () => {}, click: async () => {} };
    const change = { isVisible: async () => memory && !changed, click: async () => { changed = true; } };
    const section = { getByRole: role => role === 'button' ? change : { isVisible: async () => !memory } };
    const row = { getByRole: () => view };
    const tray = { getByRole: () => ({ filter: () => row }) };
    const page = { getByRole: (role, { name }) => name.startsWith('Layout for') ? section : tray };
    const result = await layout(page, async (page, file) => {
      assert.equal(changed, memory);
      file.answer = { state: 'used' };
    });
    assert.equal(result.state, 'used');
  }
});

test('Act 1 key selects use control names, not exact label text containing nested option words', async () => {
  const selected = [];
  const form = { getByLabel: () => ({ fill: async () => {} }),
    getByRole: (role, { name }) => ({ click: async () => {}, selectOption: async value => {
      assert.equal(role, 'combobox');
      selected.push([name, value]);
    } }) };
  const page = { getByRole: role => role === 'form' ? form : { click: async () => {} } };
  await declareKey(page);
  assert.deepEqual(selected.map(([name]) => name), ['Key kind', 'Map item with drafted buildings',
    'Key field of its buildings', 'gpmc-yuvp.csv']);
});

test('Act 1 retention waits for each exact original row even when the finished upload panel disappears', async () => {
  const seen = [];
  const tray = { getByRole: (role, { name, exact }) => ({ waitFor: async () => {
    assert.equal(role, 'button');
    assert.equal(exact, true);
    seen.push(name);
  } }), innerText: async () => 'synthetic originals kept' };
  const page = { getByRole: () => tray };
  await retainedOriginals(page, [{ path: 'E:/test_only/map.geojson' }, { path: 'E:/test_only/register.csv' }]);
  assert.deepEqual(seen, ['map.geojson', 'register.csv']);
});

test('Act 1 journey transport redirects GET only and refuses other origins and writes before any socket', async () => {
  const requests = [];
  const context = { assert, URL, process: { once: () => {} },
    globalThis: { fetch: async (url, options) => { requests.push({ url, options }); return 'test_only'; } } };
  const source = journeyTransport(21176, scratch);
  runInNewContext(source.slice(source.indexOf('const original')), context);
  assert.equal(await context.globalThis.fetch('http://127.0.0.1:3194/api/v1/health', { method: 'GET' }),
    'test_only');
  assert.equal(requests[0].url, 'http://127.0.0.1:21176/api/v1/health');
  for (const [url, options] of [['http://127.0.0.1:3194/api/v1/cases', { method: 'POST' }],
    ['http://example.invalid/api/v1/health', {}]]) assert.throws(() => context.globalThis.fetch(url, options));
  assert.equal(requests.length, 1);
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
async function closedFixture(t, entryPath = 'test-only.txt') {
  await mkdir('E:/ulpin-tmp/s8-1a', { recursive: true });
  const base = await mkdtemp('E:/ulpin-tmp/s8-1a/admission-');
  const root = `${base}/holdout/judge-kit-closed`;
  const dirs = [base, `${base}/holdout`, root], paths = [], junctions = [];
  t.after(async () => {
    for (const path of junctions) await rmdir(path); // Never recursively follow a junction.
    for (const path of paths) await rm(path);
    for (const path of dirs.reverse()) await rmdir(path);
  });
  await mkdir(root, { recursive: true });
  const content = 'test_only admission fixture\n';
  const sha256 = createHash('sha256').update(content).digest('hex');
  paths.push(`${root}/test-only.txt`);
  await writeFile(paths.at(-1), content);
  const entries = [{ path: entryPath, bytes: Buffer.byteLength(content), sha256, family: 'test_only' }];
  const bytes = JSON.stringify({ entries });
  const manifest = `${root}/manifest.json`;
  paths.push(manifest);
  await writeFile(manifest, bytes);
  const seal = { root, sealedManifestSha256: createHash('sha256').update(bytes).digest('hex'), fileCount: 1 };
  const admission = { closedKit: true, runtime: 'ulpin-reh-03', out: `${base}/output` };
  return { base, root, dirs, paths, junctions, manifest, seal, admission };
}

test('closed-kit admission verifies seal, count, size and original hash without changing bytes', async t => {
  const kit = await closedFixture(t);
  const before = await readFile(`${kit.root}/test-only.txt`);
  const files = await readKit(kit.manifest, true, kit.admission, kit.seal);
  assert.equal(files.length, kit.seal.fileCount);
  assert.equal(files[0].path.toLowerCase(), `${kit.root}/test-only.txt`.toLowerCase());
  assert.deepEqual(await readFile(files[0].path), before);
  assert.equal((await readKit(kit.manifest.toUpperCase(), false, kit.admission, kit.seal)).length, 1);
});

test('a wrong sealed hash is refused before resolving or reading an absent entry', async t => {
  const kit = await closedFixture(t, 'absent-entry.txt');
  await assert.rejects(readKit(kit.manifest, true, kit.admission,
    { ...kit.seal, sealedManifestSha256: '0'.repeat(64) }), { message: 'Sealed manifest hash mismatch' });
});

test('a wrong sealed count is refused before resolving or reading an absent entry', async t => {
  const kit = await closedFixture(t, 'absent-entry.txt');
  await assert.rejects(readKit(kit.manifest, false, kit.admission, { ...kit.seal, fileCount: 2 }),
    { message: 'Sealed manifest entry count mismatch' });
});

test('closed-kit admission refuses parent traversal and every other protected entry segment', async t => {
  const kit = await closedFixture(t);
  for (const path of ['../other/not-opened.txt', 'heldout/not-opened', 'evaluator/not-opened',
    'holdout/not-opened', 'runtime/not-opened', 'keys/not-opened', 'credentials/not-opened', '.env',
    'demo.env', 'provisional/not-opened', 'acquisitions/not-opened']) {
    const body = JSON.stringify({ entries: [{ path, bytes: 1, sha256: '0'.repeat(64), family: 'test_only' }] });
    await writeFile(kit.manifest, body);
    const seal = { ...kit.seal, sealedManifestSha256: createHash('sha256').update(body).digest('hex') };
    await assert.rejects(readKit(kit.manifest, false, kit.admission, seal), /Protected path refused/);
  }
});

test('closed-kit admission refuses an entry junction escaping its root', async t => {
  const kit = await closedFixture(t, 'escape/test-only.txt');
  const outside = `${kit.base}/outside`;
  await mkdir(outside);
  kit.dirs.push(outside);
  const escapedFile = `${outside}/test-only.txt`;
  await writeFile(escapedFile, 'test_only outside the admitted root\n');
  kit.paths.push(escapedFile);
  const link = `${kit.root}/escape`;
  await symlink(outside, link, 'junction');
  kit.junctions.push(link);
  await assert.rejects(readKit(kit.manifest, false, kit.admission, kit.seal), /Protected path refused/);
});

test('another holdout folder and an alias to the admitted folder remain refused with the flag', async t => {
  const kit = await closedFixture(t);
  await assert.rejects(readKit(`${kit.base}/holdout/other/not-opened.json`, false, kit.admission, kit.seal),
    /Protected path refused/);
  const alias = `${kit.base}/alias`;
  await symlink(kit.root, alias, 'junction');
  kit.junctions.push(alias);
  await assert.rejects(readKit(`${alias}/manifest.json`, false, kit.admission, kit.seal), /Protected path refused/);
  await assert.rejects(readKit(`${alias}/manifest.json`, false, kit.admission, { ...kit.seal, root: alias }),
    /Protected path refused/); // Even an injected lexical root must equal its real path.
  await assert.rejects(readKit(kit.manifest, false, {}, kit.seal), /Protected path refused/);
});

test('closed-kit admission requires a rehearsal runtime and scratch output before reading a manifest', async t => {
  const kit = await closedFixture(t);
  for (const runtime of ['ulpin-demo', 'ulpin-reh-01']) {
    await assert.rejects(readKit(`${kit.root}/not-opened.json`, false, { ...kit.admission, runtime }, kit.seal),
      /Expected ulpin-reh-NN/);
  }
  await assert.rejects(readKit(kit.manifest, false, { ...kit.admission, out: 'E:/outside' }, kit.seal),
    /Output must be under E:\/ulpin-tmp/);
  // A protected canonical output path is rejected even though its lexical path is scratch.
  const protectedLink = `${kit.base}/output-protected`;
  await symlink(kit.root, protectedLink, 'junction');
  kit.junctions.push(protectedLink);
  await assert.rejects(readKit(kit.manifest, false,
    { ...kit.admission, out: `${protectedLink}/new` }, kit.seal), /Protected path refused/);
});

test('closed-kit preflight errors never copy entry names into console-bound messages', async t => {
  const kit = await closedFixture(t, 'absent-private-name.txt');
  await assert.rejects(readKit(kit.manifest, false, kit.admission, kit.seal),
    { message: 'Closed-kit preflight failed; no file names copied' });
  await assert.rejects(readKit(kit.manifest, false, kit.admission), /Protected path refused/);
});

test('closed-kit size and original hash refusals contain no entry file names', async t => {
  const kit = await closedFixture(t);
  const path = `${kit.root}/test-only.txt`;
  const original = await readFile(path);
  await writeFile(path, 'x');
  await assert.rejects(readKit(kit.manifest, false, kit.admission, kit.seal),
    { message: 'Size mismatch: closed-kit entry' });
  await writeFile(path, 'x'.repeat(original.length));
  await assert.rejects(readKit(kit.manifest, true, kit.admission, kit.seal),
    { message: 'Hash mismatch: closed-kit entry' });
});

test('closed-kit CLI flag has no root or seal override and refuses an unadmitted manifest without names', () => {
  for (const extra of [[], ['--closed-kit-root', scratch], ['--closed-kit-hash', '0'.repeat(64)]]) {
    const run = spawnSync(process.execPath, ['scripts/rehearsal/kit-drop.mjs', '--runtime', 'ulpin-reh-03',
      '--kit', miniPath, '--out', `${scratch}/never-created`, '--dry-run', '--closed-kit', ...extra],
    { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.ok(!run.stderr.includes('mini-kit.json'));
    assert.match(run.stderr, extra.length ? /Unknown option/ : /Protected path refused/);
  }
});

test('closed-kit CLI summary contains counts, not kit paths or officer answer file names', async () => {
  const source = await readFile(new URL('./kit-drop.mjs', import.meta.url), 'utf8');
  const main = source.slice(source.indexOf('async function main()'), source.indexOf('if (import.meta.main)'));
  const values = { runtime: 'ulpin-reh-03', out: `${scratch}/never-created`, kit: 'not-opened',
    minutes: '30', 'closed-kit': true, 'dry-run': true, answers: 'not-opened' };
  let summary;
  await runInNewContext(`(${main})()`, {
    parseArgs: () => ({ values }), runtimePlan, Number, Boolean, JSON,
    readAnswers: async () => ({ answers: [{ file: 'private-kit-name.txt' }] }),
    readKit: async (path, hash, admission) => {
      assert.equal(admission.closedKit, true);
      assert.equal(admission.runtime, values.runtime);
      assert.equal(admission.out, values.out);
      return [{ path: 'E:/not-opened/private-kit-name.txt' }];
    },
    outputGuard: async () => {}, console: { log: text => { summary = JSON.parse(text); } },
    run: () => assert.fail('dry-run must not start a runtime or presenter'),
  });
  assert.equal(summary.fileCount, 1);
  assert.equal(summary.answerCount, 1);
  assert.ok(!JSON.stringify(summary).includes('private-kit-name'));
  assert.equal(summary.files, undefined);
  assert.equal(summary.answers, undefined);
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
  const observers = {};
  runInNewContext(`(${recorder.toString()})()`, { window, document: { hidden: false },
    performance: { now: () => 0, timeOrigin: 1000 }, requestAnimationFrame: callback => { tick = callback; },
    PerformanceObserver: class {
      constructor(callback) { this.callback = callback; }
      observe({ type, buffered }) { assert.equal(buffered, true); observers[type] = this.callback; }
    } });
  tick(125);
  tick(140);
  observers.longtask({ getEntries: () => [{ duration: 93 }] });
  assert.equal(window.__rehearsal.frames, 2);
  assert.equal(window.__rehearsal.maxMs, 125);
  assert.equal(window.__rehearsal.over100, 1);
  assert.equal(window.__rehearsal.longestTaskMs, 93);
  assert.equal(window.__rehearsal.slowFrames[0].start, 1000);
  assert.equal(window.__rehearsal.slowFrames[0].duration, 125);
});

test('unsupported observers stay explicit and a fractional frame over 100 ms is retained', () => {
  const window = {};
  let tick;
  runInNewContext(`(${recorder.toString()})()`, { window, document: { hidden: false },
    performance: { now: () => 0, timeOrigin: 1000 }, requestAnimationFrame: callback => { tick = callback; },
    PerformanceObserver: class { static supportedEntryTypes = []; } });
  tick(100);
  tick(200.25);
  assert.equal(window.__rehearsal.longAnimationFramesUnavailable, true);
  assert.equal(window.__rehearsal.longTasksUnavailable, true);
  assert.equal(window.__rehearsal.over100, 1);
  assert.equal(window.__rehearsal.slowFrames[0].duration, 100.25);
});

test('long animation frames retain blocking time and only the three longest script paths', async () => {
  const window = {};
  let observer, tick;
  const entry = { startTime: 10, duration: 140, blockingDuration: 80,
    scripts: [1, 4, 2, 3].map(duration => ({ duration, sourceURL: 'http://localhost:5388/assets/map.js?private=1',
      sourceFunctionName: `draw${duration}`, invoker: 'FrameRequestCallback' })) };
  runInNewContext(`(${recorder.toString()})()`, { window, document: { hidden: false }, URL,
    location: { href: 'http://localhost:5388/' }, performance: { now: () => 0, timeOrigin: 1000 },
    requestAnimationFrame: callback => { tick = callback; }, PerformanceObserver: class {
      static supportedEntryTypes = ['longtask', 'long-animation-frame'];
      constructor(callback) { this.callback = callback; }
      observe({ type }) { if (type === 'long-animation-frame') observer = this; }
      takeRecords() { return [entry]; }
    } });
  tick(150);
  const captures = [];
  await captureFrames({ isClosed: () => false, url: () => 'http://test_only/map',
    evaluate: async fn => runInNewContext(`(${fn.toString()})()`, { window }) }, 'map', captures);
  const animation = captures[0].animationFrames[0];
  assert.equal(animation.start, 1010);
  assert.equal(animation.blockingDuration, 80);
  assert.deepEqual(Array.from(animation.scripts, script => script.duration), [4, 3, 2]);
  assert.ok(animation.scripts.every(script => script.sourceURL === '/assets/map.js'));
  assert.equal(animation.scripts[0].sourceFunctionName, 'draw4');
  assert.equal(animation.scripts[0].invoker, 'FrameRequestCallback');
  assert.equal(window.__rehearsal.slowFrames.length, 0);
  assert.equal(window.__rehearsal.animationFrames.length, 0);
});

test('slow frames match delayed script entries only on their page and count runner overlap separately', () => {
  const script = { sourceURL: '/assets/map.js', sourceFunctionName: 'draw', invoker: 'callback', duration: 120 };
  const frames = { activities: [{ kind: 'job_query', at: 1450, to: 1600 },
    { kind: 'screenshot', page: 'map', at: 1050, to: 1070 }], batch: [
    { page: 'batch', slowFrames: [{ start: 1000, duration: 150 }] },
  ], map: [
    { page: 'map', slowFrames: [{ start: 1000, duration: 150 }, { start: 1400, duration: 150 },
      { start: 1800, duration: 150 }] },
    { page: 'map', animationFrames: [{ start: 1020, duration: 140, blockingDuration: 80, scripts: [script] },
      { start: 1800, duration: 150, blockingDuration: 0, scripts: [] }] },
  ] };
  assert.deepEqual(attributeFrames(frames), { script: 1, not_script: 2, browser_wide: 1, runner_activity: 3 });
  assert.equal(frames.batch[0].slowFrames[0].cause, 'browser_wide');
  assert.equal(frames.batch[0].slowFrames[0].runnerActivities[0].kind, 'screenshot');
  const [draw, runner, empty] = frames.map[0].slowFrames;
  assert.equal(draw.cause, 'script');
  assert.equal(draw.browserWide, true);
  assert.equal(draw.blockingDuration, 80);
  assert.deepEqual(draw.scripts, [script]);
  assert.equal(runner.cause, 'not_script');
  assert.equal(runner.blockingDuration, null);
  assert.equal(runner.runnerActivities[0].kind, 'job_query');
  assert.equal(empty.cause, 'not_script');
  assert.equal(empty.blockingDuration, 0);
  assert.equal(draw.runnerActivities[0].kind, 'screenshot');
  assert.deepEqual(attributeFrames(frames), { script: 1, not_script: 2, browser_wide: 1, runner_activity: 3 });
});

test('slow frames join nearest CPU samples and other-page starts within 50 ms across captures', () => {
  const frames = { batch: [{ page: 'batch', slowFrames: [{ start: 1000, duration: 150 }] }], map: [
    { page: 'map', slowFrames: [{ start: 1050, duration: 200 }, { start: 1051, duration: 120 }] },
    { page: 'map', slowFrames: [{ start: 3000, duration: 140 }] },
  ] };
  const cpu = [{ at: 900, percent: 75, top: [{ name: 'test_only', pid: 42, percent: 30 }] },
    { at: 1200, percent: 10 }, { at: 3001, percent: null, top: null }];
  assert.deepEqual(attributeFrames(frames, cpu), { script: 0, not_script: 2, browser_wide: 2, runner_activity: 0 });
  const batch = frames.batch[0].slowFrames[0];
  assert.equal(batch.browserWide, true);
  assert.deepEqual(batch.cpu, { ...cpu[0], offsetMs: -100 });
  assert.equal(frames.map[0].slowFrames[0].browserWide, true);
  assert.equal(frames.map[0].slowFrames[1].browserWide, false);
  assert.deepEqual(frames.map[1].slowFrames[0].cpu, { ...cpu[2], offsetMs: 1 });
  attributeFrames(frames); // Missing telemetry does not retain an earlier join or invent zero CPU.
  assert.equal(batch.cpu, null);
  assert.equal(batch.browserWide, true);
});

test('drop 2 run 4 retains all 50 slow frames: 22 shared stalls and six batch-only frames', async () => {
  const evidence = new URL('../../docs/evidence/step-3/s3-11/', import.meta.url);
  const result = JSON.parse(await readFile(new URL('runner-result-f.json', evidence), 'utf8'));
  const cpu = (await readFile(new URL('cpu-f.jsonl', evidence), 'utf8')).trim().split('\n')
    .map(line => JSON.parse(line)).map(sample => ({ ...sample, at: Date.parse(sample.at) }));
  assert.deepEqual(attributeFrames(result.frames, cpu),
    { script: 0, not_script: 6, browser_wide: 44, runner_activity: 0 });
  const slow = [...result.frames.batch, ...result.frames.map].flatMap(capture => capture.slowFrames);
  assert.equal(slow.length, 50);
  assert.ok(slow.every(frame => frame.cpu.top === null && Math.abs(frame.cpu.offsetMs) <= 5000));
  assert.equal(Math.max(...slow.map(frame => frame.cpu.percent)), 69);
});

test('CPU sampler keeps split JSON lines and stops only its own asynchronous read-only process', async () => {
  const child = new EventEmitter();
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stderr = { resume() {} };
  child.kill = () => child.emit('close', 0);
  const samples = [];
  const launch = (command, args, options) => {
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-NonInteractive'));
    assert.match(args.at(-1), /Win32_PerfFormattedData_PerfProc_Process/);
    assert.doesNotMatch(args.at(-1), /CommandLine|EnvironmentVariable/);
    assert.equal(options.windowsHide, true);
    return child;
  };
  const stop = cpuWatch(samples, launch, 'win32');
  child.stdout.emit('data', '{"at":1000,"percent":45,"top":');
  assert.deepEqual(samples, []);
  child.stdout.emit('data', '[{"name":"test_only","pid":42,"percent":20}]}\r\n');
  await stop();
  assert.deepEqual(samples, [{ at: 1000, percent: 45, top: [{ name: 'test_only', pid: 42, percent: 20 }] }]);
  await cpuWatch([], () => assert.fail('unsupported platform must not launch'), 'other')();
});

test('runner activity preserves start and finish for successful and failed actions', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const activities = [];
  assert.equal(await runnerActivity(activities, 'job_query', () => { t.mock.timers.tick(125); return 4; }), 4);
  await assert.rejects(runnerActivity(activities, 'screenshot', () => {
    t.mock.timers.tick(250);
    throw new Error('test_only failure');
  }, 'map'));
  assert.deepEqual(activities, [{ kind: 'job_query', page: null, at: 1000, to: 1125 },
    { kind: 'screenshot', page: 'map', at: 1125, to: 1375 }]);
});

function momentPage(drawn) {
  let frames = 0, screenshots = 0;
  const page = { isClosed: () => false, url: () => 'about:blank', goto: async () => {},
    locator: selector => selector === 'canvas' ? { first: () => ({ waitFor: async options => {
      assert.equal(options.timeout, 15000);
    } }) } : { innerText: async () => '' },
    waitForFunction: async (fn, packageId, options) => {
      assert.equal(options.timeout, 15000);
      const ready = runInNewContext(`(${fn.toString()})(packageId)`, { packageId,
        document: { querySelectorAll: () => [{ getAttribute: () => drawn }] } });
      if (!ready) throw new DOMException('Package not drawn', 'TimeoutError');
    },
    evaluate: async fn => runInNewContext(`(${fn.toString()})()`, {
      requestAnimationFrame: callback => { frames++; callback(); },
      document: { querySelector: () => ({ getContext: () => null }) },
    }),
    screenshot: async () => { screenshots++; },
  };
  return { page, counts: () => [frames, screenshots] };
}
test('map moment uses exact drawn package ids with no page words, then waits two frames', async () => {
  const fake = momentPage('other wanted');
  const activities = [];
  const moment = await mapMoment(fake.page, 'http://test_only', { areaId: 'area', packageId: 'wanted' },
    scratch, 'first', [], activities);
  assert.equal(moment.packageId, 'wanted');
  assert.equal(moment.words, '');
  assert.deepEqual(fake.counts(), [2, 1]);
  assert.deepEqual(activities.map(activity => activity.kind), ['page_goto', 'screenshot']);
});
test('map moment times out when its exact package is absent, without taking a screenshot', async () => {
  const fake = momentPage('wanted-other');
  await assert.rejects(mapMoment(fake.page, 'http://test_only', { areaId: 'area', packageId: 'wanted' },
    scratch, 'absent', []), { name: 'TimeoutError' });
  assert.deepEqual(fake.counts(), [0, 0]);
});
function tray(names) {
  const rows = names.map(name => ({ querySelector: selector => {
    assert.equal(selector, 'td:first-child button.ul-table__rowbtn');
    return { textContent: name };
  } }));
  return { getByRole: (role, options) => {
    assert.equal(role, 'region');
    assert.equal(options.name, 'Files in this batch');
    return { locator: selector => {
      assert.equal(selector, 'tbody tr');
      return { evaluateAll: (fn, name) => fn(rows, name),
        nth: index => ({ innerText: async () => `${names[index]}\nKept only` }) };
    } };
  } };
}
const rowItem = { name: 'india-123133321.geojsonl', state: 'probed', partsDone: 0, partsPlanned: null };
test('exact name cell picks NDJSON, not its substring sibling; none and many are recorded', async () => {
  for (const names of [[`${rowItem.name}.csv.gz`, rowItem.name], [], [rowItem.name, rowItem.name]]) {
    const file = {};
    await observeRow(tray(names), file, rowItem);
    const count = names.filter(name => name === rowItem.name).length;
    let kind = 'one';
    if (count !== 1) kind = count ? 'many' : 'none';
    assert.deepEqual(file.rowMatch, { kind, count });
    assert.equal(file.rowWords, count === 1 ? `${rowItem.name}\nKept only` : undefined);
    assert.equal(file.state, 'probed');
  }
});
test('archive and parent derived items persist under the original with the same observations', async () => {
  const result = newResult('ulpin-reh-04', [{ path: 'E:/test_only/archive.zip' }]);
  const items = [{ name: 'archive.zip', itemId: 'archive' },
    { ...rowItem, itemId: 'member', archiveItemId: 'archive' },
    { ...rowItem, name: 'layer', itemId: 'layer', parentItemId: 'archive' }];
  for (const [file, item] of batchItems(result.files, items)) await observeRow(tray([item.name]), file, item);
  batchItems(result.files, items);
  assert.deepEqual(result.files[0].members.map(m => m.name), [rowItem.name, 'layer']);
  for (const member of result.files[0].members) {
    assert.deepEqual(member.parts, [0, null]);
    assert.equal(member.state, 'probed');
    assert.equal(member.rowWords, `${member.name}\nKept only`);
    for (const field of ['layoutQuestionOffered', 'firstPartOnMap', 'lastPartOnMap']) {
      assert.equal(member[field], null);
    }
  }
});
test('batch and map captures every ten seconds carry their browser end time and reset the window', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  const page = () => {
    const window = { __rehearsal: { from: 0, frames: 20 } };
    return { isClosed: () => false, url: () => 'http://test_only/studio',
      evaluate: async fn => runInNewContext(`(${fn.toString()})()`, { window, Date }) };
  };
  const frames = { batch: [], map: [] };
  let samples = 0;
  const stop = captureWatch(page(), page(), frames, () => { samples += 1; });
  for (const to of [10000, 20000]) {
    t.mock.timers.tick(10000);
    await setImmediate();
    for (const captures of Object.values(frames)) {
      assert.equal(captures.at(-1).to, to);
      assert.equal(captures.at(-1).from, to - 10000);
    }
  }
  await stop();
  t.mock.timers.tick(10000);
  assert.equal(frames.batch.length, 2);
  assert.equal(samples, 2);
});
test('upload rows and page errors are observed every ten seconds without an enrolled intake item', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  const result = newResult('ulpin-reh-04', []), page = new EventEmitter();
  let fail = false;
  const rows = ['first.tif', 'second.tif', 'third.tif'].map((file, index) => ({
    querySelector: selector => {
      assert.equal(selector, 'td:first-child');
      return { textContent: file };
    },
    closest: selector => {
      assert.equal(selector, '[data-upload-phases]');
      return { getAttribute: name => {
        assert.equal(name, 'data-upload-phases');
        return 'stopped uploading waiting';
      } };
    },
    innerText: `${file}\n${['The upload stopped at part 13 of 48: Part refused.', 'Uploading: 2%', 'Waiting'][index]}`,
  }));
  page.getByRole = (role, options) => {
    assert.deepEqual([role, options], ['region', { name: 'Files being retained', exact: true }]);
    return { locator: selector => {
      assert.equal(selector, 'tbody tr');
      return { evaluateAll: async fn => {
        if (fail) throw new Error('Page disconnected');
        return fn(rows);
      } };
    } };
  };
  const stop = uploadWatch(page, result);
  page.emit('console', { type: () => 'log', text: () => 'not an error' });
  page.emit('console', { type: () => 'error', text: () => 'PUT part failed: 422' });
  page.emit('pageerror', new TypeError('Failed to fetch'));
  for (const at of [10000, 20000]) {
    t.mock.timers.tick(10000);
    await setImmediate();
    assert.deepEqual(result.uploadRows.at(-1), { at, rows: rows.map((row, index) => ({
      file: row.querySelector('td:first-child').textContent, phase: ['stopped', 'uploading', 'waiting'][index],
      words: row.innerText,
    })) });
  }
  assert.deepEqual(result.consoleErrors, [
    { at: 0, kind: 'console', words: 'PUT part failed: 422' },
    { at: 0, kind: 'pageerror', words: 'Failed to fetch' },
  ]);
  fail = true;
  await stop();
  assert.deepEqual(result.uploadRows.at(-1), { at: 20000, rows: null,
    error: { name: 'Error', message: 'Page disconnected' } });
  t.mock.timers.tick(10000);
  assert.equal(result.uploadRows.length, 3);
  assert.equal(page.listenerCount('console') + page.listenerCount('pageerror'), 0);
});

test('queue count uses one guarded read-only SELECT and refuses unsafe targets before exec', async () => {
  const id = 'a3cd789b-226f-4e46-9f3b-e51b85f3389a';
  const counts = { queued: 4, running: 2 };
  const sample = await queueDepth('ulpin-reh-04', id, async (command, args, options) => {
    assert.equal(command, 'docker');
    assert.deepEqual(args.slice(0, 5), ['exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
      'ulpin-reh-04-postgres-1']);
    assert.match(args.at(-1), /psql -X -A -t/);
    assert.match(options.input, /^select json_build_object\(/);
    assert.equal(options.input.split(';').length, 2);
    assert.match(options.input, new RegExp(`from jobs where case_id = '${id}'`));
    assert.doesNotMatch(options.input, /\b(insert|update|delete|create|alter|drop)\b/i);
    for (const status of Object.keys(counts)) assert.ok(options.input.includes(`status = '${status}'`));
    return { status: 0, stdout: JSON.stringify(counts) };
  });
  assert.deepEqual(sample.counts, counts);
  assert.equal(typeof sample.at, 'number');
  const refuse = () => assert.fail('invalid target must not execute');
  for (const runtime of ['ulpin-demo', 'ulpin-reh-01', 'ulpin-reh-04\n']) {
    await assert.rejects(queueDepth(runtime, id, refuse), /Invalid read-only job target/);
  }
  for (const caseId of ["'; delete from jobs; --", '-'.repeat(36), `${id}\n`]) {
    await assert.rejects(queueDepth('ulpin-reh-04', caseId, refuse), /Invalid read-only job target/);
  }
});
test('job query awaits an async executor and keeps query refusal words private', async () => {
  let resolved = false;
  const query = jobQuery('ulpin-reh-04', 'select 1;', async (command, args, options) => {
    assert.equal(command, 'docker');
    assert.equal(options.timeout, 30000);
    assert.equal(options.maxBuffer, 64 * 1024 * 1024);
    assert.equal(options.encoding, 'utf8');
    assert.equal(options.windowsHide, true);
    assert.equal(options.input, 'select 1;');
    await setImmediate();
    resolved = true;
    return { status: 0, stdout: ' [1] \n' };
  });
  assert.equal(resolved, false);
  assert.deepEqual(await query, [1]);
  for (const execute of [async () => ({ status: 1 }), async () => ({ status: null }),
    async () => { throw new Error('private stderr or launch error'); }]) {
    await assert.rejects(jobQuery('ulpin-reh-04', 'select 1;', execute),
      { message: 'Read-only job query failed; private stderr not copied' });
  }
});

// test_only psql-shaped JSON fixture; no runtime lock observation is claimed.
const lockPsql = `[{"at":"2026-10-24T12:00:06Z","pid":42,"wait_event":"transactionid",
  "xact_start":"2026-10-24T12:00:00Z","query_start":"2026-10-24T12:00:00Z",
  "query":"select id from uploads where id = $1 for update","wait_start":"2026-10-24T12:00:00Z",
  "waited_s":6,"locks":[{"locktype":"transactionid","mode":"ShareLock","relation":null,
    "transactionid":"100","classid":null,"objid":null,"objsubid":null}],
  "blockers":[{"pid":41,"state":"idle in transaction","xact_start":"2026-10-24T11:59:50Z",
    "query_start":"2026-10-24T11:59:51Z","wait_event":"ClientRead",
    "query":"update uploads set status = $1 where id = $2"}]}]\n`;
const lockRows = () => JSON.parse(lockPsql);
const lockPath = () => {
  const path = `${scratch}/locks-${temporary.length}.jsonl`;
  temporary.push(path);
  return path;
};

async function lockSampleDone(summary, sample) {
  // File writes complete through real I/O, not necessarily on the next immediate callback.
  for (let attempt = 0; attempt < 100 && summary.samples < sample; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(summary.samples, sample);
}

test('lock query reads one waiter and its blocker using bounded read-only psql arguments', async () => {
  const rows = await lockWaits('ulpin-reh-04', async (command, args, options) => {
    assert.equal(command, 'docker');
    assert.deepEqual(args, ['exec', '-i', '-e',
      'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=4000',
      'ulpin-reh-04-postgres-1', 'sh', '-c', 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB"']);
    assert.equal(options.timeout, 4000);
    assert.equal(options.input.split(';').length, 2);
    for (const expression of ['pg_stat_activity', 'pg_blocking_pids(w.pid)', 'pg_locks', 'not k.granted',
      "w.wait_event_type = 'Lock'", "interval '5 seconds'", 'current_database()', 'k.waitstart',
      'w.state_change', 'k.locktype', 'k.mode', 'k.relation', 'k.classid', 'k.objid', 'k.objsubid']) {
      assert.ok(options.input.includes(expression), expression);
    }
    assert.match(options.input, /left\(regexp_replace/); // Redaction precedes query truncation in SQL too.
    assert.doesNotMatch(options.input, /\b(insert|update|delete|create|alter|drop)\b/i);
    return { status: 0, stdout: lockPsql };
  });
  assert.deepEqual(rows, lockRows());
  for (const runtime of ['ulpin-demo', 'ulpin-reh-01', 'ulpin-reh-04\n']) {
    await assert.rejects(lockWaits(runtime, () => assert.fail('unsafe runtime must not execute')));
  }
});

test('lock watcher saves changes only, includes the holder, and sums observed blocker seconds', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-24T12:00:06Z') });
  const summary = lockWaitSummary(), path = lockPath();
  let calls = 0;
  const stop = await lockWatch('ulpin-reh-04', path, summary, async () => {
    const rows = lockRows();
    rows[0].at = new Date().toISOString();
    rows[0].waited_s += calls * 5;
    if (calls === 2) rows[0].blockers[0].state = 'active';
    return { status: 0, stdout: ++calls === 4 ? '[]\n' : JSON.stringify(rows) };
  });
  for (let sample = 1; sample <= 4; sample++) {
    await lockSampleDone(summary, sample);
    if (sample < 4) t.mock.timers.tick(5000);
  }
  await stop();
  const records = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.map(row => row.event), ['wait', 'wait', 'no_longer_observed']);
  assert.deepEqual(records[0].blockers, lockRows()[0].blockers);
  assert.equal(summary.samples, 4);
  assert.equal(summary.waitsOver5s, 1);
  assert.equal(summary.longestSeconds, 16);
  assert.deepEqual(summary.blockerQueries, [{ query: lockRows()[0].blockers[0].query, totalBlockedSeconds: 10 }]);
  assert.equal(summary.records, 3);
  assert.equal(summary.failedSamples, 0);
});

test('failed lock samples do not invent blocked time or end waits; a later episode counts separately', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-10-24T12:00:06Z') });
  const summary = lockWaitSummary(), path = lockPath();
  let calls = 0;
  const stop = await lockWatch('ulpin-reh-04', path, summary, async () => {
    const call = calls++, rows = lockRows();
    if (call === 1) return { status: 1, stdout: 'private failure words' };
    if (call === 4) return { status: 0, stdout: '[]' };
    rows[0].at = new Date().toISOString();
    rows[0].waited_s += call * 5;
    if (call === 5) Object.assign(rows[0], { wait_start: '2026-10-24T12:00:25Z', waited_s: 6 });
    return { status: 0, stdout: JSON.stringify(rows) };
  });
  for (let sample = 1; sample <= 6; sample++) {
    await lockSampleDone(summary, sample);
    if (sample < 6) t.mock.timers.tick(5000);
  }
  await stop();
  assert.equal(summary.failedSamples, 1);
  assert.equal(summary.waitsOver5s, 2);
  assert.equal(summary.longestSeconds, 21);
  assert.equal(summary.blockerQueries[0].totalBlockedSeconds, 5);
  const saved = await readFile(path, 'utf8');
  assert.doesNotMatch(saved, /private failure words/);
  assert.equal(saved.trim().split('\n').length, 3); // First wait, disappearance, new episode.
});

test('no lock waits writes an empty file; missing observations never become zero-length waits', async () => {
  const path = lockPath(), summary = newResult('ulpin-reh-04', []).process.lockWaits;
  assert.equal(summary.started, false);
  const stop = await lockWatch('ulpin-reh-04', path, summary, async () => ({ status: 0, stdout: '[]\n' }));
  await stop();
  assert.equal(await readFile(path, 'utf8'), '');
  assert.equal(summary.waitsOver5s, 0);
  assert.equal(summary.longestSeconds, null);
  assert.deepEqual(summary.blockerQueries, []);
  const unavailable = lockWaitSummary();
  await (await lockWatch('ulpin-reh-04', path, unavailable, () => assert.fail('no overwrite')))();
  assert.equal(unavailable.started, false);
  assert.equal(unavailable.failedSamples, 1);
});

test('a lock sample times out at four seconds, skips overlapping ticks, and recovers nonfatally', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 0 });
  const summary = lockWaitSummary(), path = lockPath();
  let calls = 0, release;
  const stop = await lockWatch('ulpin-reh-04', path, summary, () => {
    if (++calls === 1) return new Promise(resolve => { release = resolve; });
    return Promise.resolve({ status: 0, stdout: '[]' });
  });
  t.mock.timers.tick(3999);
  await setImmediate();
  assert.equal(summary.failedSamples, 0);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(summary.failedSamples, 1);
  t.mock.timers.tick(10000); // Microtasks have not completed when the second tick is delivered.
  await setImmediate();
  assert.equal(calls, 2);
  assert.equal(summary.skippedTicks, 1);
  release({ status: 0, stdout: lockPsql }); // A late response from the expired sample is never saved.
  await stop();
  assert.equal(summary.samples, 2);
  assert.equal(summary.waitsOver5s, 0);
  assert.equal(await readFile(path, 'utf8'), '');
});

test('lock queries strip email and long hex literals before saving or summarising, but keep markers', async () => {
  const rows = lockRows();
  const email = 'test_only@example.invalid', secret = 'abcd'.repeat(16);
  rows[0].query = `select '${email}', '${secret}', $1`;
  rows[0].blockers[0].query = `select '${secret}', '${email}', $2 ${'x'.repeat(400)}`;
  const summary = lockWaitSummary(), path = lockPath();
  await (await lockWatch('ulpin-reh-04', path, summary,
    async () => ({ status: 0, stdout: JSON.stringify(rows) })))();
  const saved = await readFile(path, 'utf8');
  for (const text of [saved, JSON.stringify(summary)]) {
    assert.ok(!text.includes(email));
    assert.ok(!text.includes(secret));
    assert.match(text, /redacted-email/);
    assert.match(text, /redacted-hex/);
  }
  const record = JSON.parse(saved);
  assert.match(record.query, /\$1/);
  assert.match(record.blockers[0].query, /\$2/);
  assert.equal(record.blockers[0].query.length, 300);
});

test('lock log is bounded to 2000 records while the summary continues counting waits', async () => {
  const rows = Array.from({ length: 2001 }, (_, index) => ({ ...lockRows()[0], pid: index + 1 }));
  const summary = lockWaitSummary(), path = lockPath();
  await (await lockWatch('ulpin-reh-04', path, summary,
    async () => ({ status: 0, stdout: JSON.stringify(rows) })))();
  assert.equal((await readFile(path, 'utf8')).trim().split('\n').length, 2000);
  assert.equal(summary.records, 2000);
  assert.equal(summary.waitsOver5s, 2001);
  assert.equal(summary.capped, true);
});

test('job timing awaits the same executor and refuses unsafe targets', async () => {
  const id = 'a3cd789b-226f-4e46-9f3b-e51b85f3389a';
  const jobs = await jobTiming('ulpin-reh-04', id, async (command, args, options) => {
    assert.match(options.input, /j\.dispatched_at/);
    assert.match(options.input, /usp_job_attempts/);
    assert.ok(args.includes('PGOPTIONS=-c default_transaction_read_only=on'));
    await setImmediate();
    return { status: 0, stdout: '[]' };
  });
  assert.deepEqual(jobs, []);
  await assert.rejects(jobTiming('ulpin-reh-01', id), /Invalid read-only job target/);
});

test('a timer and health read finish while the asynchronous queue query is still pending', async () => {
  let release;
  let timerFired = false;
  const timer = new Promise(resolve => setTimeout(() => { timerFired = true; resolve(); }, 0));
  const query = queueDepth('ulpin-reh-04', 'a3cd789b-226f-4e46-9f3b-e51b85f3389a',
    () => new Promise(resolve => { release = resolve; }));
  let healthRead = false;
  const stop = processWatch('http://test_only', async () => { healthRead = true; return { ok: true }; });
  try {
    await timer;
    assert.equal(timerFired, true);
    assert.equal(healthRead, true);
  } finally {
    release({ status: 0, stdout: '{"queued":4,"running":2}' });
    const samples = await stop();
    assert.equal(samples.length, 1);
    assert.equal(typeof samples[0].startMono, 'number');
    assert.equal(typeof samples[0].at, 'number');
    assert.ok(samples[0].healthMs >= 0);
    assert.equal(samples[0].healthOk, true);
  }
  assert.deepEqual((await query).counts, { queued: 4, running: 2 });
});

test('health success and failure keep monotonic timing when wall time moves backwards', async t => {
  let wall = 1000, mono = 200;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  for (const fails of [false, true]) {
    wall = 1000;
    mono = 200;
    const stop = processWatch('http://test_only', async () => {
      wall = 500;
      mono = 250;
      if (fails) throw new DOMException('test_only timeout', 'TimeoutError');
      return { ok: true };
    });
    const [sample] = await stop();
    assert.equal(sample.at, 1000);
    assert.equal(sample.startMono, 200);
    assert.equal(sample.healthMs, 50);
    assert.equal(sample.healthOk, fails ? null : true);
  }
});

test('observation modules use no synchronous child process or file APIs', async () => {
  for (const name of ['timing', 'kit-drop', 'presenter']) {
    const source = await readFile(new URL(`./${name}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b\w+Sync\b/);
    assert.doesNotMatch(source, /from ['"]node:fs['"]/);
  }
});

test('loop windows retain histogram max and p99 and locate stalls on the monotonic clock', () => {
  let now = 0, enabled = false, resets = 0;
  const windows = [];
  const loop = runnerLoopWatch(windows, options => {
    assert.deepEqual(options, { resolution: 20 });
    return { count: 1, max: 1500e6, percentile: p => { assert.equal(p, 99); return 1400e6; },
      enable: () => { enabled = true; }, disable: () => { enabled = false; }, reset: () => { resets++; } };
  }, () => now);
  assert.equal(enabled, true);
  now = 1500;
  loop.capture();
  now = 1520;
  loop.stop();
  loop.stop(); // Cleanup after finish must not emit a second partial window.
  assert.equal(windows.length, 2);
  assert.equal(enabled, false);
  assert.equal(resets, 2);
  assert.deepEqual(windows[0].delays, [{ startMono: 0, endMono: 1500, ms: 1500 }]);
  assert.equal(windows[0].maxMs, 1500);
  assert.equal(windows[0].p99Ms, 1400);
  assert.equal(windows[1].startMono, 1500);
  assert.equal(windows[1].endMono, 1520);
  assert.deepEqual(windows[1].delays, []);
});

test('loop monitor reports actual samples and keeps an empty histogram unknown', async () => {
  const windows = [];
  const loop = runnerLoopWatch(windows);
  try {
    loop.capture();
    assert.equal(windows[0].maxMs, null);
    assert.equal(windows[0].p99Ms, null);
    // A Windows timer firing is not proof the histogram's sampling callback has run yet.
    let measured;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      loop.capture();
      measured = windows.at(-1);
      if (measured.maxMs !== null) break;
    }
    assert.ok(measured.maxMs > 0);
    assert.ok(measured.p99Ms > 0);
  } finally { loop.stop(); }
});

test('polls and health reads overlapping a recorded loop delay are marked, even after a later capture', () => {
  const process = { runnerLoop: [], polls: [
    { at: 10000, startMono: 90, ms: 1500 }, { at: 90000, startMono: 2000, ms: 1200 },
    { at: 90001, startMono: 0, ms: 100 },
  ], samples: [{ at: 1, startMono: 1500, healthMs: 1200 },
    { at: 2, startMono: 1600, healthMs: 1300 }, { at: 3, startMono: 200, healthMs: 10 }] };
  attributeReads(process);
  assert.equal(process.polls[0].runnerBlocked, false);
  process.runnerLoop.push({ delays: [{ startMono: 100, endMono: 1600, ms: 1500 }] });
  assert.deepEqual(attributeReads(process), { thresholdMs: 1000,
    polls: { runnerBlocked: 1, unblocked: 1 }, health: { runnerBlocked: 1, unblocked: 1 } });
  assert.deepEqual(process.polls.map(poll => poll.runnerBlocked), [true, false, false]);
  assert.deepEqual(process.samples.map(sample => sample.runnerBlocked), [true, false, true]);
});

test('exitLines keeps start and exit events; only timed exits count and no start means missing hook', async () => {
  const records = [{ event: 'start', pid: 42, at: 1 }, { event: 'exit', pid: 42, at: 2 },
    { event: 'start', pid: 43, at: 3 }, { event: 'exit', pid: 43, at: 5 }];
  const lines = await exitLines('ulpin-reh-04', async path => {
    if (path.endsWith('dispatcher-exit.jsonl')) throw Object.assign(new Error(), { code: 'ENOENT' });
    return records.map(line => JSON.stringify(line)).join('\n');
  });
  assert.deepEqual(lines.api, records);
  assert.equal(lines.dispatcher, null);
  assert.deepEqual(dropExits(lines, 4), { api: { exitHook: 'present', exitsDuringDrop: [records[3]] },
    dispatcher: { exitHook: 'missing', exitsDuringDrop: [] } });
  assert.equal(dropExits({ api: [records[3]] }, 4).api.exitHook, 'missing');
  assert.deepEqual(dropExits({ api: [records[0]] }, 4).api, { exitHook: 'present', exitsDuringDrop: [] });
});

const answersPath = 'docs/evidence/step-3/s3-14/rehearsal-officer-answers.json';
const officerAnswers = JSON.parse(await readFile(answersPath, 'utf8'));
test('answers reader requires every field, test_only true and a rehearsal runtime', async () => {
  assert.deepEqual(await readAnswers(answersPath, 'ulpin-reh-05'), officerAnswers);
  for (const field of ['file', 'kind', 'identifierField', 'nameField']) {
    const body = structuredClone(officerAnswers);
    delete body.answers[0][field];
    await assert.rejects(readAnswers(await manifest(body), 'ulpin-reh-05'), /fields/);
  }
  await assert.rejects(readAnswers(await manifest({ ...officerAnswers, test_only: false }), 'ulpin-reh-05'));
  await assert.rejects(readAnswers(await manifest({ ...officerAnswers, version: 'other' }), 'ulpin-reh-05'));
  await assert.rejects(readAnswers('E:/not-read.json', 'ulpin-demo'), /Expected ulpin-reh-NN/);
});
test('identifier answers refuse both choices, neither choice and unsupported position modes', async () => {
  for (const choice of [{ identifierField: 'BL_ID', identifierBy: 'position' }, { identifierField: null },
    { identifierField: null, identifierBy: 'other' }, { identifierBy: 'position' }, { identifierField: '' }]) {
    const body = structuredClone(officerAnswers);
    delete body.answers[0].identifierField;
    Object.assign(body.answers[0], choice);
    await assert.rejects(readAnswers(await manifest(body), 'ulpin-reh-05'), /fields/);
  }
});
const option = (value, disabled = false) => ({ value, text: value, disabled });
const property = field => `/features/*/properties/${field}`;
test('chooser matches BL_ID exactly and refuses disabled or ambiguous options', () => {
  const options = [option(property('BL_ID_OLD')), option(property('BL_ID'))];
  assert.equal(chooseOption(options, 'BL_ID', true), property('BL_ID'));
  assert.equal(chooseOption([options[0]], 'BL_ID', true), null);
  assert.equal(chooseOption([option(property('BL_ID'), true)], 'BL_ID', true), null);
  assert.equal(chooseOption([options[1], options[1]], 'BL_ID', true), null);
  assert.equal(chooseOption([option('')], null), '');
});
function answerPage(t, { missing = false, disabled = false, approve = false, alerts = [], position = false } = {}) {
  const presses = [], selections = [];
  const options = [[option('building', disabled)], [option(property('OBJECTID_OLD')),
    ...(missing ? [] : [option(property('OBJECTID'))]), ...(position ? [option('/features/*/geometry')] : [])],
    [option(''), option(property('OBJECTID'))]];
  const button = name => ({ isVisible: async () => name !== 'Approve layout' || approve,
    click: async () => {
      presses.push(name);
      t.mock.timers.tick(100);
    } });
  const layout = { waitFor: async () => {}, getAttribute: async () => 'Layout for test_only',
    getByRole: (role, { name } = {}) => {
      if (role === 'alert' || role === 'status') {
        return { allTextContents: async () => role === 'alert' ? alerts : [] };
      }
      if (role === 'button') return button(name);
      const index = ['What is each feature in this file?', 'Which field identifies each one?',
        'Which field is its name?'].indexOf(name);
      assert.notEqual(index, -1);
      return { waitFor: async () => {}, evaluate: async () => options[index],
        selectOption: async value => { selections.push(value); } };
    } };
  const page = { getByRole: (role, { name }) => name === 'Files in this batch'
    ? { locator: () => ({ filter: () => ({ getByRole: (_, { name }) => button(name) }) }) } : layout,
    waitForFunction: async () => {} };
  return { page, presses, selections };
}
const offeredFile = () => ({ name: officerAnswers.answers[0].file, layoutQuestionOffered: 1000,
  rowMatch: { kind: 'one', count: 1 } });
test('missing field or disabled kind records unavailable, never submits, and never reopens', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  for (const config of [{ missing: true }, { disabled: true }]) {
    const fake = answerPage(t, config), file = offeredFile();
    await answerLayout(fake.page, file, officerAnswers.answers[0]);
    await answerLayout(fake.page, file, officerAnswers.answers[0]);
    assert.equal(file.answer.state, 'unavailable');
    assert.deepEqual(file.answer.options[1].map(o => o.value), config.missing
      ? [property('OBJECTID_OLD')] : [property('OBJECTID_OLD'), property('OBJECTID')]);
    assert.deepEqual(fake.presses, ['View layout']);
    assert.equal(file.officerSeconds, null);
  }
});
test('listed answers use exact fields and Not stated, optionally approve, and keep exact alerts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  for (const config of [{}, { approve: true }, { alerts: ['The layout changed. Review it again.'] }]) {
    const fake = answerPage(t, config), file = offeredFile();
    await answerLayout(fake.page, file, null);
    await answerLayout(fake.page, file, officerAnswers.answers[1]);
    assert.deepEqual(fake.presses, []);
    await answerLayout(fake.page, file, officerAnswers.answers[0]);
    assert.deepEqual(fake.selections, ['building', property('OBJECTID'), '']);
    assert.deepEqual(fake.presses, config.approve
      ? ['View layout', 'Use this layout', 'Approve layout'] : ['View layout', 'Use this layout']);
    let state = config.approve ? 'approved' : 'used';
    if (config.alerts) state = 'failed';
    assert.equal(file.answer.state, state);
    assert.deepEqual(file.answer.alerts, config.alerts ?? []);
    assert.equal(file.officerSeconds, officerSeconds(file.answer));
    assert.equal(file.officerSeconds, ((file.answer.approvedAt ?? file.answer.usedAt) - 1000) / 1000);
  }
  assert.equal(officerSeconds({ offeredAt: 1000, usedAt: 2500, approvedAt: 4000 }), 3);
  assert.equal(officerSeconds({ offeredAt: 1000, usedAt: 2500, approvedAt: null }), 1.5);
});

test('position answer picks geometry exactly, or refuses with words without submitting', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const byPosition = { ...officerAnswers.answers[1], identifierField: null, identifierBy: 'position' };
  for (const position of [true, false]) {
    const fake = answerPage(t, { position }), file = { ...offeredFile(), name: byPosition.file };
    await answerLayout(fake.page, file, byPosition);
    assert.equal(file.answer.state, position ? 'used' : 'unavailable');
    assert.deepEqual(fake.selections, position ? ['building', '/features/*/geometry', ''] : ['building']);
    if (!position) {
      assert.match(file.answer.error, /Position in the file is not offered/);
      assert.deepEqual(fake.presses, ['View layout']);
    }
  }
});

test('dry-run with or without answers prints the guarded plan without creating output', async () => {
  const out = `${scratch}/never-created`;
  for (const args of [[], ['--answers', answersPath]]) {
    const run = spawnSync(process.execPath, ['scripts/rehearsal/kit-drop.mjs', '--runtime', 'ulpin-reh-03',
      '--kit', miniPath, ...args, '--out', out, '--dry-run'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const plan = JSON.parse(run.stdout);
    assert.equal(plan.files.length, 2);
    assert.deepEqual(plan.answers, args.length ? officerAnswers : null);
    assert.equal(plan.apiPort, 21036);
    assert.equal(plan.studioPort, 5189);
    assert.equal(plan.result, `${out}/result.json`);
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
});

const watchItems = ['a.geojson', 'b.geojson'].map(name => ({ name, itemId: name, state: 'probed', partsDone: 0,
  partsPlanned: null, sizeBytes: 1 }));
async function watchRun(t, seconds, { failPolls = [], failFile = null, intakeItems, childIntakes,
  page = null, dropAt } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  t.mock.method(performance, 'now', () => Date.now());
  const result = newResult('ulpin-reh-04', watchItems.map(item => ({ path: `E:/test_only/${item.name}`, bytes: 1 })));
  Object.assign(result, { caseId: 'test_only', dropAt });
  const plan = { out: scratch, result: `${scratch}/watch-${temporary.length}.json` };
  temporary.push(plan.result);
  let calls = 0;
  const observed = [], states = [], reads = [];
  const io = { answerLayout: async () => {}, sleep: async ms => {
    states.push({ finished: result.uploadsFinished, files: structuredClone(result.files) });
    t.mock.timers.tick(ms);
  },
    get: async (api, path, timeoutMs) => {
      assert.equal(timeoutMs, 15000);
      t.mock.timers.tick(250);
      calls += 1;
      reads.push({ at: Date.now(), path });
      if (failPolls.includes(calls)) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      if (path.endsWith('/intake') && !path.includes('/test_only/')) return childIntakes(path);
      return path.endsWith('/intake') ? { items: intakeItems ? intakeItems(result) : watchItems } : { packages: [] };
    },
    observeRow: async (page, file, item) => {
      if (item.name === failFile) throw new Error(`row read failed ${'x'.repeat(400)}`);
      observed.push(item.name);
      file.state = item.state;
    } };
  await watchBatch(page, null, plan, result, 'http://test_only', 'http://test_only', seconds / 60, io);
  return { result, observed, states, reads, saved: JSON.parse(await readFile(plan.result, 'utf8')) };
}
test('uploads finish only once every exact original name and byte count is observed as an item', async t => {
  let polls = 0;
  const { result, states } = await watchRun(t, 4, { intakeItems: () => ++polls > 1 ? watchItems : [watchItems[0],
    { ...watchItems[1], name: 'other.geojson' }, { ...watchItems[1], sizeBytes: 2 },
    { ...watchItems[1], parentItemId: 'child' },
    { ...watchItems[1], archiveItemId: 'member' }] });
  assert.equal(states[0].finished, null);
  assert.equal(states[0].files[1].itemSeenAt, null);
  assert.equal(states[0].files[1].retained, false);
  assert.equal(result.uploadsFinished, 1750);
  assert.deepEqual(result.files.map(file => [file.itemSeenAt, file.retained]), [[250, true], [1750, true]]);
});
test('a document reload during retention is recorded and missing files remain null/false at 180 seconds', async t => {
  const page = new EventEmitter(), frame = {};
  page.mainFrame = () => frame;
  const { result } = await watchRun(t, 1, { page, dropAt: 0, intakeItems: () => {
    if (Date.now() === 250) page.emit('request', { isNavigationRequest: () => true,
      redirectedFrom: () => null, frame: () => frame });
    return [watchItems[0]];
  } });
  assert.deepEqual(result.reloadsDuringRetention, [{ at: 250 }]);
  assert.equal(result.uploadsFinished, null);
  assert.equal(result.files[1].itemSeenAt, null);
  assert.equal(result.files[1].retained, false);
  assert.ok(Date.now() >= 180000);
  assert.equal(page.listenerCount('request'), 0);
});
test('an original enrolled after the 180 s retention window is still seen and finishes uploads', async t => {
  const { result } = await watchRun(t, 4, { dropAt: -200000,
    intakeItems: () => Date.now() >= 1000 ? watchItems : [watchItems[0]] });
  assert.deepEqual(result.files.map(file => [file.itemSeenAt, file.retained]), [[250, true], [1750, true]]);
  assert.equal(result.uploadsFinished, 1750);
});
test('a timed-out intake poll is recorded with its time, the pass is skipped and the next pass observes', async t => {
  const { result, observed, saved } = await watchRun(t, 2.5, { failPolls: [1] });
  const polls = [
    { at: 0, startMono: 0, path: '/ingestion/cases/test_only/intake', ms: 250,
      error: 'TimeoutError', runnerBlocked: false },
    { at: 1250, startMono: 1250, path: '/ingestion/cases/test_only/intake', ms: 250, runnerBlocked: false },
    { at: 1500, startMono: 1500, path: '/ingestion/cases/test_only/targets', ms: 250, runnerBlocked: false },
  ];
  assert.deepEqual(result.process.polls, polls);
  assert.deepEqual(saved.process.polls, polls);
  assert.deepEqual(observed, ['a.geojson', 'b.geojson']);
});
test('a throwing row observation is recorded on its file and the next file is still observed', async t => {
  const { result, observed } = await watchRun(t, 2, { failFile: 'a.geojson' });
  assert.deepEqual(observed, ['b.geojson', 'b.geojson']);
  assert.equal(result.files[1].state, 'probed');
  assert.equal(result.files[0].state, 'probed');
  const [error] = result.files[0].watchErrors;
  assert.equal(result.files[0].watchErrors.length, 1);
  assert.deepEqual({ ...error, message: error.message.length },
    { at: 500, name: 'Error', message: 300, count: 2, lastAt: 2000 });
  assert.equal(result.files[1].watchErrors, undefined);
});

test('three intake polls record every file and archive member before row or targets failures', async t => {
  let pass = 0;
  const { saved, reads } = await watchRun(t, 4, { dropAt: 0, failFile: 'a.geojson', failPolls: [2],
    intakeItems: () => {
      const done = pass++;
      return [...watchItems.map(item => ({ ...item, placement: done ? 'on_map' : 'undecided',
        state: done === 2 ? 'read' : 'reading', partsPlanned: 2, partsDone: done,
        limitReason: `test_only poll ${done}` })),
      { ...watchItems[0], name: 'member.geojson', itemId: 'member', archiveItemId: watchItems[0].itemId,
        state: 'read', placement: 'on_map', partsPlanned: 1, partsDone: 1, what: 'Map layer' }];
    } });
  assert.equal(reads.length, 6); // Still exactly one intake and one targets read per pass.
  for (const file of saved.files) {
    assert.deepEqual(file.timeline.map(row => [row.at, row.partsDone]), [[250, 0], [1750, 1], [3250, 2]]);
    assert.deepEqual([file.state, file.placement, file.partsPlanned, file.partsDone, file.words],
      ['read', 'on_map', 2, 2, 'test_only poll 2']);
    assert.deepEqual([file.firstPartAt, file.allPartsAt, file.firstPartSeconds, file.allPartsSeconds],
      [1750, 3250, 1.75, 3.25]);
    assert.equal(file.lastPollAt, 3250);
    assert.equal(file.itemReason, null);
    assert.equal(file.firstPartOnMap, null);
    assert.equal(file.lastPartOnMap, null);
  }
  const member = saved.files[0].members[0];
  assert.equal(member.words, 'Map layer');
  assert.equal(member.timeline.length, 1); // Unchanged polls update lastPollAt, not the change timeline.
  assert.equal(member.lastPollAt, 3250);
  assert.equal(member.firstPartAt, 250);
  observeItem(member, { itemId: 'member', partsDone: 0, partsPlanned: 0 }, 5000, null);
  assert.equal(member.allPartsAt, 250); // Counter reset does not erase an earlier observation.
  assert.equal(member.allPartsSeconds, null); // Unknown add time never becomes zero seconds.
});

test('cell parent names two child cases; bounded intake polls keep their own items under the parent', async t => {
  const refs = ['cell-one', 'cell-two'].map((caseId, index) => ({ cellKey: `test_only_${index}`, caseId,
    itemId: caseId, state: 'read', placement: 'on_map' }));
  const { saved, reads } = await watchRun(t, 24, { dropAt: 0,
    intakeItems: () => [{ ...watchItems[0], cellBatches: refs }, watchItems[1]],
    childIntakes: path => {
      const ref = refs.find(ref => path.includes(`/${ref.caseId}/`));
      return { items: [{ name: `${ref.caseId}.geojson`, itemId: ref.itemId, state: 'reading',
        placement: 'on_map', partsPlanned: 2, partsDone: Date.now() > 10000 ? 2 : 1,
        limitReason: 'test_only child intake words' }] };
    } });
  assert.equal(saved.files[0].cells.length, 2);
  assert.equal(saved.files[1].cells, undefined);
  for (const cell of saved.files[0].cells) {
    const polls = reads.filter(read => read.path.includes(`/${cell.caseId}/`));
    assert.equal(polls.length, 3);
    assert.ok(polls.slice(1).every((row, index) => row.at - polls[index].at >= 10000));
    assert.equal(cell.timeline.length, 2);
    assert.deepEqual([cell.state, cell.placement, cell.partsPlanned, cell.partsDone, cell.words],
      ['reading', 'on_map', 2, 2, 'test_only child intake words']);
    assert.equal(cell.firstPartSeconds, cell.firstPartAt / 1000);
    assert.equal(cell.allPartsSeconds, cell.allPartsAt / 1000);
    assert.ok(cell.allPartsAt > cell.firstPartAt);
    assert.equal(cell.firstPartOnMap, null);
  }
});

test('unseen file keeps null measurements and an explicit reason', async t => {
  const { saved } = await watchRun(t, 1, { intakeItems: () => [watchItems[0]] });
  const unseen = saved.files[1];
  for (const field of ['state', 'placement', 'partsPlanned', 'partsDone', 'words', 'firstPartAt', 'allPartsAt',
    'firstPartSeconds', 'allPartsSeconds', 'lastPollAt', 'firstPartOnMap', 'lastPartOnMap']) {
    assert.equal(unseen[field], null, field);
  }
  assert.deepEqual(unseen.timeline, []);
  assert.match(unseen.itemReason, /No matching intake item/);
});

test('child polling caps unique cases at 30, deduplicates references, and records inaccessible cells', async t => {
  const refs = Array.from({ length: 31 }, (_, index) => ({ cellKey: `test_only_${index}`,
    caseId: `child-${index}`, itemId: `child-${index}`, state: 'read', placement: 'on_map' }));
  refs.push({ ...refs[0], cellKey: 'test_only_duplicate' },
    { cellKey: 'test_only_private', caseId: null, itemId: null, state: null, placement: null });
  const { saved, reads } = await watchRun(t, 9, { failPolls: [3],
    intakeItems: () => [{ ...watchItems[0], cellBatches: refs }, watchItems[1]],
    childIntakes: () => ({ items: [] }) });
  const cells = saved.files[0].cells;
  const children = reads.filter(row => !row.path.includes('/test_only/'));
  assert.equal(new Set(children.map(row => row.path)).size, 30);
  assert.equal(children.length, 30); // Even a timeout and duplicate reference do not trigger an early retry.
  assert.match(cells[0].itemReason, /poll failed: TimeoutError/);
  assert.match(cells[1].itemReason, /absent from the child intake/);
  assert.match(cells[30].itemReason, /limit reached/);
  assert.match(cells.at(-1).itemReason, /unavailable or not accessible/);
  assert.ok(cells.every(cell => cell.state === null && cell.partsDone === null));
});
