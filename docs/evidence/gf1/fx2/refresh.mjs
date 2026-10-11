// After integrating FX2, refresh only reviewed pinned paths; refuse unexpected bytes or dirty content.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, unlinkSync } from 'node:fs';

const git = (...args) => execFileSync('git', args);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const step0 = JSON.parse(readFileSync('docs/evidence/gf1/fx2/step0.json', 'utf8'));
const crlf = step0.counts.crlfPinnedWithLfIndex;
const normalized = new Set(['api_producers', 'isolation_harness']);
const lf = step0.table.filter(row => !crlf.includes(row[0]) && !row[0].endsWith('.ttf') &&
  row[0] !== 'scripts/usp/security/appcontainer_audit.py' &&
  row[4].some(pin => !normalized.has(pin.split('=')[0])) &&
  row[4].some(pin => ['index', 'both'].includes(pin.split('=')[1])));
const refresh = process.argv.includes('--refresh');
const proof = [];
const indexed = new Map();

// Check every path before overwriting any. Never normalize index content here.
for (const row of [...lf, ...step0.table.filter(row => crlf.includes(row[0]))]) {
  const path = row[0];
  const expected = hash(git('show', ':' + path));
  // A CRLF-pinned path must still hold its audited bytes. An LF path that later work changed in Git is
  // refreshed to its current index bytes: only line endings are rewritten here, never content.
  if (crlf.includes(path) && expected !== row[2]) throw Error('Unexpected index bytes: ' + path);
  indexed.set(path, expected);
  const working = readFileSync(path);
  const observed = hash(working);
  // Another checkout may hold CRLF where the audited one held LF: line endings alone are not a change.
  const lfOnly = hash(Buffer.from(working.toString('latin1').replaceAll('\r\n', '\n'), 'latin1'));
  if (observed !== expected && (crlf.includes(path) || (observed !== row[2] && lfOnly !== expected))) {
    throw Error('Uncommitted or unexpected working bytes: ' + path);
  }
}
for (const row of [...lf, ...step0.table.filter(row => crlf.includes(row[0]))]) {
  const path = row[0];
  const expected = indexed.get(path);
  if (refresh && hash(readFileSync(path)) !== expected) {
    const output = git('checkout-index', '--temp', '--', path).toString().trim();
    const temporary = output.split('\t')[0];
    try {
      if (hash(readFileSync(temporary)) !== expected) throw Error('Unexpected checkout conversion: ' + path);
      copyFileSync(temporary, path);
    } finally {
      unlinkSync(temporary);
    }
  }
  const working = hash(readFileSync(path));
  if (working !== expected) throw Error('Working bytes need refresh: ' + path);
  proof.push({ path, sha256: expected, workingMatches: true, indexMatches: true });
}
if (refresh) {
  // Git's old CRLF stat entries can report false dirtiness after a byte-identical LF refresh.
  git('add', '--', ...lf.map(row => row[0]));
  for (const row of lf) {
    if (hash(git('show', ':' + row[0])) !== indexed.get(row[0])) throw Error('Index changed on stat refresh: ' + row[0]);
  }
}
console.log(JSON.stringify({ refresh, lfFiles: lf.length, crlfFiles: crlf.length, proof }, null, 2));
