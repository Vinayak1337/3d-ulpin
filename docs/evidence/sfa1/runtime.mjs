import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoDoctor, run, safe, serving, sameDemo } from '../runtime/reh10/audit.mjs';

// Reuse the rehearsal's guarded commands and redaction, but write only this task's receipts.
const directory = resolve('docs/evidence/sfa1');
const action = process.argv[2];
const commands = {
  start: 'pnpm platform:start --profile demo --runtime ulpin-reh-02',
  doctor: 'pnpm platform:doctor --profile demo --runtime ulpin-reh-02',
  stop: 'pnpm platform:stop --profile demo --runtime ulpin-reh-02',
  install: 'pnpm install --frozen-lockfile',
  build: 'node scripts/platform/demo-document-runtime.mjs build --runtime ulpin-reh-02',
  migrate: 'node docs/evidence/runtime/reh9/migrate.mjs E:/Projects/ulpin-wt/ulpin-reh-02 ulpin-reh-02',
};
let result;
if (action === 'demo-before' || action === 'demo-after') {
  result = demoDoctor();
  if (action === 'demo-after') {
    const before = JSON.parse(readFileSync(resolve(directory, 'demo-before.json'), 'utf8'));
    result.matchesBaseline = sameDemo(before, result);
    assert(result.matchesBaseline, 'Demo changed during rehearsal');
  }
} else if (action === 'checkout') {
  const commit = process.argv[3];
  assert(/^[a-f0-9]{40}$/.test(commit ?? ''));
  result = run(`git checkout --detach ${commit}`, serving);
} else if (action === 'logs') {
  const text = readFileSync('E:/BhuAayam-data/runtime/ulpin-reh-02/logs/dispatcher.log', 'utf8');
  result = { lines: text.trim().split(/\r?\n/).length,
    tail: safe(text).trim().split(/\r?\n/).slice(-35) };
} else {
  assert(commands[action], 'Unknown runtime action');
  result = run(commands[action], serving, 1800000);
}
writeFileSync(resolve(directory, `${process.argv[4] ?? action}.json`), JSON.stringify(result, null, 2) + '\n',
  { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.exit ?? 0;
