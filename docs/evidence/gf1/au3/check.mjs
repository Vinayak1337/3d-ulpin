// Read-only checks of the audit shape, citation locations and the single retained runtime projection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const folder = 'docs/evidence/gf1/au3/';
const read = name => JSON.parse(readFileSync(folder + name, 'utf8'));
const chain = read('chain.json');
const result = read('result.json');
const proposal = read('proposal.json');
let citations = 0;

function citation(value) {
  for (const part of value.split('; ')) {
    const match = /^(.+):(\d[\d,\-]*)$/.exec(part);
    assert(match, `Malformed citation: ${part}`);
    const slash = match[1].indexOf('/');
    const prefix = match[1].slice(0, slash);
    const path = chain.paths[prefix] ? chain.paths[prefix] + match[1].slice(slash + 1) : match[1];
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).length;
    for (const token of match[2].split(',')) {
      const ends = token.split('-').map(Number);
      assert(ends.every(line => line >= 1 && line <= lines), `Line outside ${path}: ${token}`);
    }
    citations++;
  }
}

function visit(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'at' || key === 'additionalAt' || key === 'contradiction') citation(child);
    else visit(child);
  }
}

assert.equal(chain.files.length, 3);
for (const file of chain.files) {
  assert.deepEqual(file.items.map(item => item.item), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const item of file.items) assert(chain.details[item.detail]);
}
visit(chain);
assert.equal(result.box.runtimeExit, 0);
assert.equal(result.box.remainingOwned, '');
assert.equal(result.originalHashesUnchanged, true);
assert.equal(result.providers, 0);
assert.equal(result.gpu, false);
for (const file of result.files) {
  assert.equal(file.manualSources.code, 'INVALID_INPUT');
  assert.equal(file.afterProbe.state, 'probed');
  assert.equal(file.afterReading.placement, 'undecided');
  assert.equal(file.reader.status, 'completed');
  assert.equal(file.reader.globalPlacement, 'not_qualified');
}
assert.equal(proposal.tasks.length, 3);
const owners = new Map();
for (const task of proposal.tasks) {
  for (const file of task.files) {
    const path = file.replace(/ \(.*\)$/, '');
    assert(!owners.has(path), `Shared proposal file: ${path}`);
    owners.set(path, task.id);
  }
}
assert.equal(proposal.tasks.reduce((hours, task) => hours + task.workerHours, 0), 44);
console.log(JSON.stringify({ task: 'AU3', files: 3, numberedItems: 24, citations,
  proposalTasks: 3, exclusivePaths: owners.size, workerHours: 44,
  runtime: 'three originals retained, probed and read; no intake parts or map connection' }));
