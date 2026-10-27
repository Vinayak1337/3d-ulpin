import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(import.meta.url);
const preload = fileURLToPath(new URL('./exit-record.cjs', import.meta.url));
const privateMessage = 'postgres://u:p@h/db'; // Deliberately artificial credential-shaped regression input.
const scenario = process.argv[2];
if (scenario) {
  if (scenario === 'term' || scenario === 'graceful') {
    if (scenario === 'graceful') process.on('SIGTERM', () => { process.exitCode = 7; });
    process.emit('SIGTERM');
  } else if (scenario === 'normal') {
    process.exitCode = 4;
  } else {
    const error = new TypeError(scenario === 'secret' ? privateMessage : 'private test message');
    if (scenario === 'code') error.code = 'DB_UNAVAILABLE';
    if (scenario === 'invalid-code') error.code = privateMessage;
    if (scenario === 'reject') Promise.reject(error);
    else throw error;
  }
} else {
  function run(t, mode, enabled = true) {
    const folder = mkdtempSync(join(tmpdir(), 'exit-record-'));
    const file = join(folder, 'exit.jsonl');
    t.after(() => {
      if (existsSync(file)) unlinkSync(file);
      rmdirSync(folder);
    });
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.ULPIN_EXIT_RECORD_FILE;
    if (enabled) env.ULPIN_EXIT_RECORD_FILE = file;
    const child = spawnSync(process.execPath, ['--require', preload, entry, mode], {
      env, encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.equal(child.error, undefined);
    if (!enabled) return { child, file };
    const text = readFileSync(file, 'utf8');
    const lines = text.trimEnd().split('\n');
    assert.equal(lines.length, 1);
    assert.ok(!text.includes(privateMessage));
    assert.ok(!text.includes('private test message'));
    assert.ok(!text.includes('    at '));
    const record = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(record).sort(),
      ['code', 'error', 'frame', 'heapLimitMiB', 'heapUsedMiB', 'rssMiB', 'signal', 'uptimeS']);
    for (const key of ['heapLimitMiB', 'heapUsedMiB', 'rssMiB', 'uptimeS']) {
      assert.ok(Number.isFinite(record[key]) && record[key] > 0, key);
    }
    return { child, record };
  }

  for (const mode of ['throw', 'secret', 'code', 'invalid-code', 'reject']) {
    test(`${mode}: one redacted fatal record preserves exit code 1 and the repository frame`, t => {
      const { child, record } = run(t, mode);
      assert.equal(child.status, 1);
      assert.equal(record.code, 1);
      assert.equal(record.signal, null);
      assert.equal(record.error, mode === 'code' ? 'DB_UNAVAILABLE' : 'TypeError');
      assert.match(record.frame, /^scripts\/platform\/exit-record\.test\.mjs:\d+$/);
    });
  }

  test('normal exit records its actual code with no error or frame', t => {
    const { child, record } = run(t, 'normal');
    assert.equal(child.status, 4);
    assert.deepEqual([record.code, record.signal, record.error, record.frame], [4, null, null, null]);
  });

  test('SIGTERM records once and preserves both default termination and application shutdown', t => {
    const terminated = run(t, 'term');
    assert.equal(terminated.record.signal, 'SIGTERM');
    assert.equal(terminated.record.code, null);
    if (process.platform !== 'win32') assert.equal(terminated.child.signal, 'SIGTERM');
    const graceful = run(t, 'graceful');
    assert.equal(graceful.child.status, 7);
    assert.equal(graceful.record.signal, 'SIGTERM');
  });

  test('unset destination: no file, no listeners, and the original exit outcome', t => {
    const { child, file } = run(t, 'normal', false);
    assert.equal(child.status, 4);
    assert.equal(existsSync(file), false);
    const env = { ...process.env };
    delete env.ULPIN_EXIT_RECORD_FILE;
    delete env.NODE_OPTIONS;
    const probe = spawnSync(process.execPath, ['-e', `
      const events = ['exit', 'uncaughtExceptionMonitor', 'unhandledRejection', 'SIGTERM'];
      const before = events.map(event => process.listenerCount(event));
      require(${JSON.stringify(preload)});
      require('node:assert/strict').deepEqual(events.map(event => process.listenerCount(event)), before);
    `], { env, windowsHide: true, timeout: 10000 });
    assert.equal(probe.status, 0);
  });
}
