import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';

const outputPaths = ['lgd', 'gmda'].map(name => `docs/evidence/gf-agent/a1/${name}.output.json`);
const expected = outputPaths.map(path => execFileSync('git', ['show', `staging:${path}`], { encoding: 'utf8' }));
const receiptPath = 'docs/evidence/gf-agent/a1/result.json';
const originalReceipt = readFileSync(receiptPath, 'utf8');
try {
  execSync('pnpm exec tsx docs/evidence/gf-agent/a1/run.ts', { stdio: 'inherit' });
  for (const [index, path] of outputPaths.entries()) {
    const actual = readFileSync(path, 'utf8');
    assert.deepEqual(JSON.parse(actual), JSON.parse(expected[index]), 'A1 output must retain identical values.');
    assert.equal(actual, expected[index], 'A1 output must also retain byte order/format.');
  }
  console.log('A1 LGD and GMDA output JSON is byte-identical to staging; source hash checks passed.');
} finally {
  // Preserve the historical A1 receipt; this continuation records its new checks in A2's receipt.
  writeFileSync(receiptPath, originalReceipt);
}
