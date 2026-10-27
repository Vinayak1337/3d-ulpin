import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const receipt = read('runtime.json');
const result = read('result.json');
assert.equal(receipt.runtime.exit, 0);
assert.equal(receipt.ownedBoxGone, true);
assert.equal(receipt.runtime.evidence.originalHashesUnchanged, true);
assert.equal(receipt.runtime.evidence.providerCalls, 0);
assert.deepEqual(receipt.runtime.evidence.failures, []);
assert.equal(receipt.runtime.evidence.results.length, 2);
for (const item of receipt.runtime.evidence.results) {
  assert.equal(item.upload.state, 'retained');
  assert.equal(item.upload.verifiedSha256, item.sha256);
  assert.equal(item.upload.bytes, item.bytes);
  assert.equal(item.register201.state, 'probed');
  assert.equal(item.register201.placement, 'needs_answer');
  assert.equal(item.register201.plan, null);
  assert.equal(item.packages, 0);
  assert.deepEqual(item.jobs, []);
}
for (const flag of ['largeFileToPackagesAutomatic', 'restartDraftsNothingTwice',
  'threeCardsFromThreePackages', 'projectedLargeFileSaysWhy', 'gatePassed']) assert.equal(result[flag], false);
assert.equal(result.checks.beforePassed, 279);
assert.equal(result.checks.afterPassed, 289);
console.log(JSON.stringify({ task: 'LP3b', savedHttpBoundary: 'passed', automaticIntake: 'not_built',
  gatePassed: false, next: 'CHECKPOINT.md', qualification: 'Saved boundary proof, not a fresh runtime gate.' }));
