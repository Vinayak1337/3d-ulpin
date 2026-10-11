import { readFileSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = 'docs/evidence/gf1/au4/';
const chain = JSON.parse(readFileSync(root + 'chain.json', 'utf8'));
assert.deepEqual(chain.items.map(item => item.item), [1, 2, 3, 4, 5, 6, 7, 8]);
let references = 0;
const errors = [];
function inspect(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'at' || key === 'moreAt') && typeof child === 'string') {
      for (const ref of child.split(';')) {
        const match = /^(.*):(\d[\d,\-]*)$/.exec(ref);
        if (!match) { errors.push('Invalid reference: ' + ref); continue; }
        let path = match[1];
        const slash = path.indexOf('/');
        const prefix = path.slice(0, slash);
        if (chain.paths[prefix]) path = chain.paths[prefix] + path.slice(slash + 1);
        if (!existsSync(path)) { errors.push('Missing: ' + path); continue; }
        const lines = readFileSync(path, 'utf8').split('\n').length;
        for (const range of match[2].split(',')) {
          const [first, last = first] = range.split('-').map(Number);
          if (first < 1 || last < first || last > lines) errors.push(`${ref}: file has ${lines} lines`);
        }
        references++;
      }
    } else inspect(child);
  }
}
inspect(chain);
const checkProposal = !process.argv.includes('--chain-only') && existsSync(root + 'proposal.json');
if (checkProposal) {
  const proposal = JSON.parse(readFileSync(root + 'proposal.json', 'utf8'));
  assert(proposal.tasks.length <= 4);
  const owners = new Set();
  for (const task of proposal.tasks) for (const path of task.files) {
    assert(!owners.has(path), 'Overlapping task ownership: ' + path);
    owners.add(path);
  }
  inspect(proposal);
}
for (const name of readdirSync(root)) {
  if (!/\.(json|md|mjs)$/.test(name)) continue;
  const text = readFileSync(root + name, 'utf8');
  if (name.endsWith('.json')) JSON.parse(text);
  for (const [index, line] of text.split('\n').entries()) {
    if (line.length > 120) errors.push(`${name}:${index + 1}: exceeds 120 characters`);
  }
}
assert.deepEqual(errors, [], errors.join('\n'));
console.log(JSON.stringify({ json: 'valid', chainItems: 8, fileLineReferences: references,
  referenceCheck: 'path existence and ranges only; semantics require manual source review',
  taskOwnership: checkProposal ? 'four ordered disjoint tasks' : 'proposal not checked',
  runtime: 'not run' }, null, 2));
