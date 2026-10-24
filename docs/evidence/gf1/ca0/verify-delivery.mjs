import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = 'docs/evidence/gf1/ca0/';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const result = json(`${root}result.json`);
const receipt = json(`${root}${result.runtime.receipt}`);
const runtime = receipt.runtime.evidence;
assert.equal(receipt.runtime.exit, 0);
assert.equal(receipt.failure, undefined);
assert.equal(receipt.machineUnchanged, true);
assert.equal(receipt.removed, receipt.container);
assert.deepEqual(receipt.before, receipt.after);
assert.deepEqual(runtime.rejectedSql, []);
assert.deepEqual(runtime.reviewScaffolding, []);
assert.equal(runtime.providers, 0);
assert.equal(runtime.originalHashesUnchanged, true);
assert.equal(runtime.steps[1].result.recipe, null);
assert.equal(runtime.steps[1].result.placement, 'needs_answer');
assert.equal(runtime.steps[3].result.accepted, result.runtime.accepted);
assert.deepEqual(runtime.steps[3].result.sourceIndices.map(value => value.index),
  result.runtime.checkedOriginalIndices);
assert.equal(runtime.steps[3].result.binding.frame.id, 'UNASSIGNED');
assert.equal(runtime.steps[4].result.citedRevisionOne, result.runtime.citedRecords);
assert.equal(runtime.steps[4].result.qualificationReceipts, 0);
assert.equal(runtime.steps[5].result.packet, 'complete');
assert.equal(runtime.steps[5].result.sourceStatus, 'needs_input');
assert.equal(runtime.steps[6].result.sameLayout, null);
assert.equal(runtime.steps[7].result.placement, 'needs_answer');
assert.deepEqual(runtime.replayChecks.map(value => [value.jobsBefore, value.jobsAfter]), [[1, 1], [2, 2]]);
assert.deepEqual(runtime.replayChecks.map(value => value.state), ['probed', 'read']);
assert(runtime.replayChecks.every(value => value.reasonPreserved));
for (const [index, step] of result.stepTable.entries()) assert.equal(step.ms, runtime.steps[index + 1].ms);
for (const input of result.inputs) {
  const bytes = readFileSync(input.path);
  assert.equal(bytes.length, input.bytes);
  assert.equal(digest(bytes), input.sha256);
}
for (const [name, expected] of Object.entries(runtime.hashes)) {
  assert(!name.includes('/') && !name.includes('\\'));
  assert.equal(digest(readFileSync(`E:/BhuAayam-data/datasets/nyc-10013/files/${name}`)), expected);
}
const pins = json('docs/api/source-pins.json');
assert.equal(Object.keys(pins.sourceSha256).length, result.checks.producerPins);
for (const [path, expected] of Object.entries(pins.sourceSha256)) {
  const forbidden = ['heldout', 'holdout', 'evaluator', 'provisional', 'acquisitions'];
  assert(!path.split('/').some(part => forbidden.includes(part)));
  const bytes = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  assert.equal(digest(bytes), expected, path);
}
execFileSync('git', ['diff', '--exit-code', result.runtime.productionCommit, 'HEAD', '--', 'packages/server']);
execFileSync('git', ['diff', '--exit-code', '5dbb862b', '--', `${root}step0.json`]);
execFileSync('git', ['diff', '--exit-code', '3dca9555', 'HEAD', '--',
  'packages/contracts', 'database', 'packages/server/src/modules/officer',
  'packages/server/src/modules/areas/package-authority.ts', 'packages/server/src/modules/usp/snapshots.ts',
  'packages/server/src/modules/cases/domain.ts', 'docs/api/openapi.json', 'docs/api/runtime-qualification.json',
  'docs/evidence/usp/cityjson-validation-runtime.json']);
console.log(JSON.stringify({ delivery: 'pass', runtimeExit: 0, originalHashesUnchanged: true,
  acceptedAuditPreserved: true, protectedPathsUnchanged: true, producerPins: result.checks.producerPins }));
