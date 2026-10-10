import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

// Load only path validation. Never call readDemo(), open credentials or start runtime processes in this test.
const { readDemoTabularPaths } = await import(pathToFileURL(resolve('scripts/platform/demo-config.mjs')).href);

test('demo tabular paths validate the real bridge and seed and fail clearly for missing or invalid paths', () => {
  const valid = readDemoTabularPaths();
  assert.equal(valid.ULPIN_PROFILE_PYTHON, 'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe');
  const directory = join('E:/BhuAayam-data/task-data/a3c/controls', randomUUID());
  mkdirSync(directory, { recursive: true });
  assert.throws(() => readDemoTabularPaths(join(directory, 'missing.json')), /Demo tabular paths missing/);
  const invalid = join(directory, 'invalid.json');
  writeFileSync(invalid, JSON.stringify({ ...valid, ULPIN_PROFILE_PYTHON: directory }), { flag: 'wx' });
  assert.throws(() => readDemoTabularPaths(invalid), /wrong kind: ULPIN_PROFILE_PYTHON/);
  const outside = join(directory, 'outside.json');
  writeFileSync(outside, JSON.stringify({ ...valid, ULPIN_TABULAR_LEARNING_DIR: directory }), { flag: 'wx' });
  assert.throws(() => readDemoTabularPaths(outside), /learning directory must be inside demo runtime/);
});
