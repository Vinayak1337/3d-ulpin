import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source audit only: no product imports, generated registry data or runtime state.
const path = 'docs/evidence/gf1/ca0/resume-stop.json';
const audit = JSON.parse(readFileSync(path, 'utf8'));
const regions = new Map();
for (const check of audit.checks) {
  const source = readFileSync(check.file, 'utf8').split(/\r?\n/);
  const [first, last] = check.lines;
  assert(first > 0 && first <= last && last <= source.length, check.id);
  const region = source.slice(first - 1, last).join('\n');
  for (const needle of check.contains) assert(region.includes(needle), `${check.id}: source condition changed`);
  regions.set(check.id, region);
}
assert(!regions.get('workspace').includes('FROM units'));
assert(!regions.get('workspace').includes('FROM jobs'));
assert(!regions.get('workspace').includes('frame:'));
assert(!regions.get('completion').includes('current.frame'));
assert(!regions.get('completion').includes('current.context'));
assert(!regions.get('queue').includes('UNASSIGNED'));
assert.deepEqual(audit.build.productChanges, []);
assert.equal(audit.build.runtimeExecuted, false);
assert.equal(audit.acceptedAuditCommit, '5dbb862b');
const step0 = JSON.parse(readFileSync('docs/evidence/gf1/ca0/step0.json', 'utf8'));
assert.deepEqual(step0.answers.map(answer => answer.question), [1, 2, 3, 4, 5, 6]);
console.log(JSON.stringify({ task: 'CA0', resumeAudit: 'pass', sourceRegions: regions.size,
  acceptedStep0Preserved: true, stop: 'case revision / e', productBuilt: false, runtimeExecuted: false }));
