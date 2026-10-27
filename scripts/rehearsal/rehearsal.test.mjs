// Ported from S1.3 acceptance.test.mjs; recorded figures are test_only, never new rehearsal verdicts.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { allowedPath, readKit, runtimePlan } from './kit-manifest.mjs';
import { batchItems, captureWatch, newResult, observeRow, recorder, smoothness } from './presenter.mjs';
import { dropExits, exitLines, queueDepth } from './timing.mjs';
import { setImmediate } from 'node:timers/promises';

await mkdir('E:/ulpin-tmp/s3-12', { recursive: true });
const scratch = await mkdtemp('E:/ulpin-tmp/s3-12/rehearsal-');
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
    assert.equal(file.words, count === 1 ? `${rowItem.name}\nKept only` : undefined);
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
    assert.equal(member.words, `${member.name}\nKept only`);
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
test('queue count uses one guarded read-only SELECT and refuses unsafe targets before exec', () => {
  const id = 'a3cd789b-226f-4e46-9f3b-e51b85f3389a';
  const counts = { queued: 4, dispatched: 0, running: 2 };
  const sample = queueDepth('ulpin-reh-04', id, (command, args, options) => {
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
    assert.throws(() => queueDepth(runtime, id, refuse), /Invalid/);
  }
  for (const caseId of ["'; delete from jobs; --", '-'.repeat(36), `${id}\n`]) {
    assert.throws(() => queueDepth('ulpin-reh-04', caseId, refuse), /Invalid/);
  }
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
