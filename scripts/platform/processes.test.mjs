// A made-up rehearsal runtime on a temporary folder with one recorded API process. The process table is a stand-in,
// so no process is started, inspected or stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { runtimeDefinition } from './demo-config.mjs';
import { launchProcesses, ownedProcess } from './processes.mjs';

const created = '/Date(1792800000000)/';
const entry = join('made-up-checkout', 'apps/api/src/main.ts');
const preload = join('made-up-checkout', 'scripts/platform/isolated-env.cjs');

/** One runtime folder holding the API record as the launcher writes it, and the record's bytes. */
function madeUpRuntime(t) {
  const folder = mkdtempSync(join(tmpdir(), 'processes-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const runtime = runtimeDefinition('ulpin-reh-01', folder);
  mkdirSync(runtime.dir, { recursive: true });
  const record = { project: runtime.project, label: 'api', pid: 4242, creationDate: created,
    executable: process.execPath, entry, preload };
  const bytes = JSON.stringify(record) + '\n';
  writeFileSync(join(runtime.dir, 'api.process.json'), bytes);
  return { runtime, record, bytes };
}
const holder = (changes = {}) => () => ({ ProcessId: 4242, ExecutablePath: process.execPath,
  CommandLine: `"${process.execPath}" --require ${preload} --require exit-record.cjs --import tsx ${entry}`,
  CreationDate: created, ...changes });

test('launch wiring keeps the identity preload and sets a per-runtime exit destination after safeEnvironment', () => {
  const source = launchProcesses.toString();
  assert.match(source, /join\('E:\/ulpin-tmp', runtime\.name\)/);
  assert.match(source, /mkdirSync\(exitDir, \{ recursive: true \}\)/);
  assert.match(source, /scripts\/platform\/exit-record\.cjs/);
  assert.match(source, /\['--require', preload, '--require', exitPreload, '--import', 'tsx', entry\]/);
  assert.match(source, /safeEnvironment\(env\), ULPIN_EXIT_RECORD_FILE: join\(exitDir, `\$\{label\}-exit\.jsonl`\)/);
});

test('dispatcher reports safe codes once per failure streak, without blaming every error on the database', async () => {
  const source = readFileSync(new URL('../dispatcher.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const signals = {}, printed = [];
  let ticks = 0;
  const error = new TypeError('private file content');
  error.code = 'READER_FAILED';
  await runInNewContext(source, {
    process: { on: (name, listener) => { signals[name] = listener; } },
    Error, console: { log() {}, error: message => printed.push(message) },
    localOperatorSubject() {}, dispatchWakeVersion: () => 0,
    dispatchTick: async () => {
      ticks++;
      if (ticks === 3) return;
      if (ticks === 4) error.code = 'postgres://u:p@h/db';
      throw error;
    },
    waitForDispatch: async () => { if (ticks === 4) signals.SIGTERM(); },
    closePool: async () => {}, closeStorageClient() {}, useDispatcherPool() {}, dispatchPoolSize: () => 33,
  });
  assert.deepEqual(printed, ['Dispatcher tick failed with error code READER_FAILED.',
    'Dispatcher tick failed with error code TypeError.']);
});

test('a PID reused by a process created at another time: null, and the record is moved aside, not deleted', t => {
  const { runtime, bytes } = madeUpRuntime(t);
  const printed = t.mock.method(console, 'log', () => {});
  const later = '/Date(1792900000000)/';
  assert.equal(ownedProcess('api', runtime, { info: holder({ CreationDate: later }) }), null);
  const files = readdirSync(runtime.dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^api\.process\.json\.exited-\d{14}$/);
  assert.equal(readFileSync(join(runtime.dir, files[0]), 'utf8'), bytes);
  assert.deepEqual(printed.mock.calls.map(call => call.arguments), [[`api process record moved aside: `
    + `recorded creation ${created}, PID now held by a process created ${later}.`]]);
  // With the record aside, the runtime holds no API process, so a stop has nothing to do and a start launches anew.
  assert.equal(ownedProcess('api', runtime, { info: () => assert.fail('no record is left to look up') }), null);
});

test('the same creation time with another entry, executable or preload is still refused, and the record stays', t => {
  const { runtime, bytes } = madeUpRuntime(t);
  for (const changes of [{ CommandLine: `"${process.execPath}" --require ${preload} --import tsx other.ts` },
    { ExecutablePath: join('made-up', 'other-node.exe') }, { CommandLine: `"${process.execPath}" ${entry}` }]) {
    assert.throws(() => ownedProcess('api', runtime, { info: holder(changes) }),
      /^Error: api PID identity changed; refusing to stop or adopt it\.$/);
  }
  assert.deepEqual(readdirSync(runtime.dir), ['api.process.json']);
  assert.equal(readFileSync(join(runtime.dir, 'api.process.json'), 'utf8'), bytes);
});

test('no process holding the PID gives null; a matching process gives the record; neither moves the record', t => {
  const { runtime, record } = madeUpRuntime(t);
  assert.equal(ownedProcess('api', runtime, { info: () => null }), null);
  assert.deepEqual(ownedProcess('api', runtime, { info: holder() }), record);
  assert.deepEqual(readdirSync(runtime.dir), ['api.process.json']);
});
