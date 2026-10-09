import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startProblems, storageProblems } from './runtime.mjs';

// Regression for the observed bug: the former `compose up` route would create
// replacement ulpin storage against this REAL Desktop inventory from S0.3.
test('the retained Desktop inventory cannot authorize a new empty ulpin stack', () => {
  const receipt = JSON.parse(readFileSync(new URL('./evidence/s03/result.json', import.meta.url)));
  const snapshot = receipt.requestedProjectInventory;
  assert.equal(snapshot.volumes.length, 14);
  assert.equal(snapshot.containers.length, 0);
  assert.equal(storageProblems(snapshot).length, 6);
  assert.equal(startProblems(snapshot).length, 8);
  assert.equal(startProblems(snapshot, true).length, 6);
  const start = readFileSync(new URL('../platform-start.sh', import.meta.url), 'utf8');
  assert.ok(start.indexOf('platform/runtime.mjs') < start.indexOf('ulpin_compose start'));
  assert.doesNotMatch(start, /platform-env\.sh|platform-mode\.mjs|db:migrate|\bup -d\b|--build/);
  assert.match(start, /start --wait --wait-timeout 90/);
  const lib = readFileSync(new URL('../platform-lib.sh', import.meta.url), 'utf8');
  assert.match(lib, /-p ulpin/);
  assert.doesNotMatch(lib, /platform-mode\.mjs|colima start/);
});
