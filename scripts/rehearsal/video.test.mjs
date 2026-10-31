import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { act1Options } from './act1.mjs';
import { closeSession, contextOptions, kitDropOptions, presenter, videoPlan, videoPreflight } from './kit-drop.mjs';
import { allowedPath, runtimePlan } from './kit-manifest.mjs';
import { newResult } from './presenter.mjs';

const base = 'E:/ulpin-tmp/s9-1l';
const args = ['--runtime', 'ulpin-reh-17', '--out', `${base}/not-created`];
const plan = enabled => videoPlan(runtimePlan('ulpin-reh-17', `${base}/not-created`), enabled);

async function scratch() {
  await mkdir(base, { recursive: true });
  return mkdtemp(`${base}/video-test-`);
}

test('both parsers accept the valueless video flag in any position and leave recording off by default', () => {
  assert.equal(act1Options(args).videoDir, undefined);
  assert.equal(kitDropOptions(args).video, undefined);
  for (const flags of [['--video', ...args], [...args, '--video']]) {
    assert.equal(act1Options(flags).videoDir, `${base}/not-created/videos`);
    assert.equal(kitDropOptions(flags).video, true);
  }
  for (const extra of [['--video', 'true'], ['--video=false']]) {
    assert.throws(() => act1Options([...args, ...extra]));
    assert.throws(() => kitDropOptions([...args, ...extra]));
  }
});

test('recording uses only the guarded output videos folder at 1440x900; no flag adds no recordVideo', () => {
  const recording = plan(true);
  assert.equal(allowedPath(recording.videoDir), recording.videoDir);
  assert.equal(win32.relative(recording.out, recording.videoDir), 'videos');
  assert.deepEqual(contextOptions(recording), { viewport: { width: 1440, height: 900 },
    recordVideo: { dir: recording.videoDir, size: { width: 1440, height: 900 } } });
  assert.deepEqual(contextOptions(plan(false)), { viewport: { width: 1440, height: 900 } });
  for (const out of ['C:/no', 'E:/outside', 'E:/ulpin-tmp/../outside', 'E:/ulpin-tmp/runtime/no']) {
    assert.throws(() => videoPlan({ runtime: 'ulpin-reh-17', out }, true));
  }
});

test('preflight refuses an injected absent ffmpeg folder and ignores it when video is off', async t => {
  const root = await scratch();
  await assert.rejects(videoPreflight(plan(true), root),
    { message: 'Video recording needs bundled ffmpeg under PLAYWRIGHT_BROWSERS_PATH' });
  await videoPreflight(plan(false), `${root}/not-created`);
  const folder = `${root}/ffmpeg-1011`;
  await mkdir(folder);
  await assert.rejects(videoPreflight(plan(true), root), /needs bundled ffmpeg/);
  const executable = `${folder}/${process.platform === 'win32' ? 'ffmpeg-win64.exe' : `ffmpeg-${process.platform}`}`;
  await writeFile(executable, 'test_only preflight fixture; never executed');
  t.after(async () => {
    await rm(executable);
    await rmdir(folder);
    await rmdir(root);
  });
  await videoPreflight(plan(true), root);
});

test('both CLIs refuse missing ffmpeg with one line before reading inputs or calling a runtime', async t => {
  const root = await scratch();
  t.after(() => rmdir(root));
  for (const script of ['kit-drop', 'act1']) {
    const extra = script === 'kit-drop' ? ['--kit', 'E:/not-opened/missing.json'] : [];
    const run = spawnSync(process.execPath, [`scripts/rehearsal/${script}.mjs`, ...args, '--video', ...extra],
      { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1', PLAYWRIGHT_BROWSERS_PATH: root } });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr.trim(), 'Video recording needs bundled ffmpeg under PLAYWRIGHT_BROWSERS_PATH');
    await assert.rejects(stat(`${base}/not-created`), { code: 'ENOENT' });
  }
});

function fakeChromium(recording, options, events, failAt) {
  let count = 0;
  const browser = {
    newContext: async option => {
      options.push(option);
      const index = count++;
      if (index === failAt) throw new DOMException('test_only setup timeout', 'TimeoutError');
      return { addInitScript: async () => {},
        newPage: async () => {
          const page = Object.assign(new EventEmitter(), { url: () => 'about:blank',
            video: () => option.recordVideo
              ? { path: async () => `${recording.videoDir}/test-only-${index}.webm` } : null });
          page.goto = async () => {
            const url = 'http://test_only/missing-resource';
            page.emit('response', { status: () => 404,
              request: () => ({ method: () => 'GET', url: () => url }), json: async () => ({}) });
            page.emit('console', { type: () => 'error', location: () => ({ url }), text: () => 'Resource missing' });
          };
          return page;
        },
        close: async () => { events.push(`context-${index}`); },
      };
    },
    close: async () => { events.push('browser'); },
  };
  return { executablePath: () => 'E:/ms-playwright/chromium-test-only/chrome.exe', launch: async () => browser };
}

test('drop presenter records both contexts and closes them before the browser, including setup timeout', async () => {
  for (const enabled of [false, true]) for (const failAt of [undefined, 1]) {
    const recording = plan(enabled), options = [], events = [], session = {};
    const result = newResult('ulpin-reh-17', []);
    const chromium = fakeChromium(recording, options, events, failAt);
    const launch = presenter({ TMP: 'E:/ulpin-tmp', TEMP: 'E:/ulpin-tmp', TMPDIR: 'E:/ulpin-tmp' },
      recording, session, result, chromium);
    if (failAt === undefined) await launch;
    else await assert.rejects(launch, { name: 'TimeoutError' });
    assert.deepEqual(options, [contextOptions(recording), contextOptions(recording)]);
    for (const page of [session.page, session.map].filter(Boolean)) {
      assert.equal(page.listenerCount('requestfailed'), 1);
      assert.equal(page.listenerCount('console'), 1);
      await page.goto();
    }
    assert.equal(result.requestFailures.length, session.stopRequests.length);
    assert.ok(result.consoleErrors.every(row => row.path === '/:value' && row.status === 404));
    await Promise.all(session.stopRequests.map(stop => stop()));
    await closeSession(recording, result, session);
    assert.deepEqual(events, failAt === undefined ? ['context-0', 'context-1', 'browser'] : ['context-0', 'browser']);
    assert.equal(result.videos.length, enabled ? session.contexts.length : 0);
    for (const video of result.videos) {
      assert.match(video.path, /^videos\/test-only-\d\.webm$/);
      assert.equal(video.bytes, null);
    }
  }
});

test('video sizes are read after finalisation, and missing files stay null after a failed step', async t => {
  const out = await scratch(), recording = videoPlan(runtimePlan('ulpin-reh-17', out), true);
  await mkdir(recording.videoDir);
  const path = `${recording.videoDir}/test-only-finalised.webm`;
  t.after(async () => {
    await rm(path);
    await rmdir(recording.videoDir);
    await rmdir(out);
  });
  const events = [], result = { status: 'incomplete', error: { message: 'test_only failed step' } };
  const session = { page: { video: () => ({ path: async () => path }) },
    map: { video: () => ({ path: async () => `${recording.videoDir}/missing.webm` }) },
    contexts: [{ close: async () => {
      events.push('context');
      await writeFile(path, 'test_only finalised video fixture');
    } }], browser: { close: async () => events.push('browser') } };
  await closeSession(recording, result, session);
  assert.deepEqual(events, ['context', 'browser']);
  assert.deepEqual(result.videos, [{ path: 'videos/test-only-finalised.webm', bytes: (await stat(path)).size },
    { path: 'videos/missing.webm', bytes: null }]);
  assert.equal(result.status, 'incomplete');
});

test('Act 1 saves its final video inventory after a failed step or timeout without a runtime', async () => {
  const source = await readFile(new URL('./act1.mjs', import.meta.url), 'utf8');
  const run = source.slice(source.indexOf('async function run(plan)'), source.indexOf('if (import.meta.main)'));
  for (const name of ['Error', 'TimeoutError']) {
    const recording = plan(true), events = [], saved = [];
    await runInNewContext(`(${run})(plan)`, {
      plan: recording, Date, JSON, process: { env: {} }, console: { log() {}, error() {} },
      videoPreflight: async () => {}, freshOutput: async () => {}, mkdir: async () => {},
      writeFile: async (path, text) => { events.push('save'); saved.push(JSON.parse(text)); },
      inputs: async () => [], stepRecorder: () => {}, closeSession,
      requestWatch: () => { events.push('watch'); return async () => events.push('unwatch'); },
      launchStudio: async (plan, env, session) => Object.assign(session, {
        page: { video: () => ({ path: async () => `${plan.videoDir}/test-only-missing.webm` }) },
        contexts: [{ close: async () => events.push('context') }],
        browser: { close: async () => events.push('browser') }, preview: { kill: () => events.push('preview') },
      }),
      drive: async () => {
        assert.equal(events[0], 'watch'); // The first navigation belongs to drive, never launchStudio.
        throw Object.assign(new Error('test_only failed step'), { name });
      },
    });
    assert.deepEqual(events, ['watch', 'unwatch', 'context', 'browser', 'save', 'preview']);
    assert.equal(saved[0].status, 'incomplete');
    assert.equal(saved[0].error.message, 'test_only failed step');
    assert.deepEqual(saved[0].videos, [{ path: 'videos/test-only-missing.webm', bytes: null }]);
  }
});

test('cleanup closes remaining contexts and browser even when a context close fails', async () => {
  const events = [], result = {};
  await assert.rejects(closeSession(plan(true), result, { contexts: [
    { close: async () => { events.push('first'); throw new Error('test_only close failed'); } },
    { close: async () => events.push('second') },
  ], browser: { close: async () => events.push('browser') } }), /test_only close failed/);
  assert.deepEqual(events, ['first', 'second', 'browser']);
  assert.deepEqual(result.videos, []);
});

test('video inventory refuses an escape instead of saving an external absolute path', async () => {
  const result = {};
  await assert.rejects(closeSession(plan(true), result,
    { page: { video: () => ({ path: async () => `${base}/outside.webm` }) } }), /inside the output/);
  assert.deepEqual(result.videos, []);
});
