import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = 'docs/evidence/gf1/au2/';
const chain = JSON.parse(readFileSync(`${root}chain.json`, 'utf8'));
const box = JSON.parse(readFileSync(`${root}measurement.json`, 'utf8'));
assert.deepEqual(chain.items.map(item => item.item), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert(chain.items.every(item => item.status && item.evidence.every(entry => entry.at && entry.fact)));
assert.equal(box.runtime.exit, 0);
assert.equal(box.machineUnchanged, true);
assert.equal(box.removed, box.container);
assert.deepEqual(box.before, box.after);
const measured = box.runtime.evidence;
assert.equal(measured.records, 1662);
assert.equal(measured.accepted, 1661);
assert.equal(measured.quarantined, 1);
assert.equal(measured.parts, 17);
assert.equal(measured.packages, 0);
assert.equal(measured.mappedSlots, 0);
assert(measured.slots.every(slot => slot.published && slot.status === 'ready'));
assert.equal(measured.rejected[0].featureIndex, 1322);
assert.equal(measured.rejected[0].issueCode, 'SELF_INTERSECTION');
assert.equal(measured.originalUnchanged, true);

const prefixes = ['', 'packages/server/src/modules/', 'packages/server/src/modules/usp/',
  'packages/server/src/modules/usp/ingestion/', 'packages/server/src/modules/areas/',
  'packages/server/src/modules/registry/', 'packages/contracts/src/usp/', 'docs/evidence/gf1/',
  'apps/studio/src/'];

function checkCitations(entry) {
  const matches = entry.at.matchAll(/([\w./-]+\.(?:ts|tsx|py|json|mjs)):(\d+)(?:-(\d+))?/g);
  let count = 0;
  for (const match of matches) {
    const path = prefixes.map(prefix => `${prefix}${match[1]}`).find(existsSync);
    assert(path, `Citation file missing: ${match[1]}`);
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).length;
    assert(Number(match[2]) <= lines && Number(match[3] ?? match[2]) <= lines, `Range: ${match[0]}`);
    count++;
  }
  assert(count > 0, `No citation: ${entry.at}`);
}

chain.items.forEach(item => item.evidence.forEach(checkCitations));
if (existsSync(`${root}proposal.json`)) {
  const proposal = JSON.parse(readFileSync(`${root}proposal.json`, 'utf8'));
  assert.equal(proposal.tasks.length, 3);
  const seen = new Set();
  for (const task of proposal.tasks) {
    for (const file of task.files) {
      assert(!seen.has(file), `Overlapping task ownership: ${file}`);
      seen.add(file);
    }
  }
}
const changed = execFileSync('git', ['diff', '--name-only', 'staging...HEAD'], { encoding: 'utf8' });
assert(changed.split(/\r?\n/).filter(Boolean).every(path => path.startsWith(root)));
for (const name of readdirSync(root)) {
  const text = readFileSync(`${root}${name}`, 'utf8');
  const long = text.split(/\r?\n/).flatMap((line, index) => line.length > 120 ? [index + 1] : []);
  assert.equal(long.length, 0, `Long lines: ${name}:${long.join(',')}`);
}
console.log('AU2: nine cited items; reader receipt and isolation; proposal owners if present; owned paths/style pass.');
