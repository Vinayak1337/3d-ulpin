import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs, { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { settings } from '../../../infrastructure/config';
import { citygmlConfig } from './citygml-config';

// The profile is written by the unchanged pinning script, run by any CPython 3 (the CityGML environment by default).
const profilePython = process.env.ULPIN_CITYGML_PYTHON
  ?? 'E:/BhuAayam-data/task-data/desktop-citygml-native/env/Scripts/python.exe';
const ready = process.platform === 'win32' && process.arch === 'x64' && existsSync(profilePython);
const runtimeFiles = ['python.exe', 'python313.dll', 'python3.dll', 'vcruntime140.dll', 'vcruntime140_1.dll',
  'DLLs/_socket.pyd', 'Lib/os.py'];
// A full walk reads every runtime file but python.exe (not counted), plus the one environment module.
const fullWalkReads = runtimeFiles.length;

// Test-written placeholder bytes laid out like a pinned runtime; nothing here is a real interpreter.
function pinnedTree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'citygml-config-')));
  const runtime = join(root, 'runtime');
  const environment = join(root, 'environment');
  const scratch = join(root, 'scratch');
  const module = join(environment, 'Lib', 'site-packages', 'module.py');
  for (const folder of [join(runtime, 'DLLs'), join(runtime, 'Lib', 'site-packages'), join(module, '..'), scratch]) {
    mkdirSync(folder, { recursive: true });
  }
  for (const name of runtimeFiles) writeFileSync(join(runtime, name), `test_only placeholder ${name}\n`);
  writeFileSync(module, 'test_only placeholder module\n');
  const profile = join(root, 'profile.json');
  const receipt = JSON.parse(execFileSync(profilePython, ['-I', '-B', 'scripts/usp/citygml/profile.py',
    '--python', join(runtime, 'python.exe'), '--environment', environment, '--scratch', scratch, '--output', profile],
  { cwd: settings.repositoryRoot, encoding: 'utf8' }));
  process.env.ULPIN_CITYGML_PROFILE = profile;
  process.env.ULPIN_CITYGML_PROFILE_SHA256 = receipt.sha256;
  return { runtime, environment, module };
}

// Counts reads of inventoried runtime and environment files; python.exe is read for its pin on every call.
function countInventoryReads(t: TestContext, tree: ReturnType<typeof pinnedTree>) {
  const read = fs.readFileSync;
  const python = join(tree.runtime, 'python.exe');
  const counter = { reads: 0 };
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof read>) => {
    const path = args[0];
    const inventoried = typeof path === 'string' && path !== python
      && (path.startsWith(tree.runtime) || path.startsWith(tree.environment));
    if (inventoried) counter.reads++;
    return Reflect.apply(read, fs, args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  return counter;
}

function callCounting(counter: { reads: number }) {
  counter.reads = 0;
  const config = citygmlConfig();
  return { pins: config.pins, reads: counter.reads };
}

const refused = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test.after(() => {
  delete process.env.ULPIN_CITYGML_PROFILE;
  delete process.env.ULPIN_CITYGML_PROFILE_SHA256;
});

test('a later CityGML tool check in the same process hashes no inventoried file and returns the same pins',
  { skip: !ready }, t => {
    const tree = pinnedTree();
    const counter = countInventoryReads(t, tree);
    const first = callCounting(counter);
    assert.equal(first.reads, fullWalkReads);
    const later = callCounting(counter);
    assert.equal(later.reads, 0);
    assert.deepEqual(later.pins, first.pins);
    assert.throws(() => citygmlConfig(Date.now()), refused('CITYGML_CONFIG_TIMEOUT'));
  });

test('a changed mtime or size runs the full walk again, and a mismatch is still refused', { skip: !ready }, t => {
  const tree = pinnedTree();
  const counter = countInventoryReads(t, tree);
  const first = callCounting(counter);
  const later = new Date(Date.now() + 60_000);
  utimesSync(tree.module, later, later);
  const touched = callCounting(counter);
  assert.equal(touched.reads, fullWalkReads);
  assert.deepEqual(touched.pins, first.pins);
  assert.equal(callCounting(counter).reads, 0);
  appendFileSync(tree.module, '# test_only change\n');
  assert.throws(() => citygmlConfig(), refused('CITYGML_TOOL_CHANGED'));
  assert.ok(counter.reads > 0);
  assert.throws(() => citygmlConfig(), refused('CITYGML_TOOL_CHANGED'));
});

test('a new runtime file or root file is refused after the inventory was verified', { skip: !ready }, t => {
  const tree = pinnedTree();
  const counter = countInventoryReads(t, tree);
  callCounting(counter);
  writeFileSync(join(tree.runtime, 'Lib', 'added.py'), 'test_only added module\n');
  assert.throws(() => citygmlConfig(), refused('CITYGML_TOOL_CHANGED'));
  assert.ok(counter.reads > 0);
  const other = pinnedTree();
  citygmlConfig();
  writeFileSync(join(other.runtime, 'python313._pth'), 'test_only path override\n');
  assert.throws(() => citygmlConfig(), refused('CITYGML_TOOL_CHANGED'));
});
