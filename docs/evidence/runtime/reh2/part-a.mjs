import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { demoDoctor, evidence, gpu, imageId, inventory, run, runtime, safe, sameDemo, save, serving, tail }
  from './audit.mjs';

// REH1's part-a.mjs for ulpin-reh-02: one receipt per step, written once; a resume is its own receipt.
const before = JSON.parse(readFileSync(`${evidence}/before.json`, 'utf8'));
const commit = before.stagingCommit;
const commands = {
  1: [`git worktree add --detach ${serving} ${commit}`, 'E:/Projects/3d-ulpin'],
  2: ['pnpm install --frozen-lockfile', serving],
  3: [`pnpm platform:start --profile demo --create --runtime ${runtime}`, serving],
  4: [`node scripts/platform/demo-document-runtime.mjs build --runtime ${runtime}`, serving],
  5: [`pnpm platform:start --profile demo --runtime ${runtime}`, serving],
  6: [`pnpm platform:doctor --profile demo --runtime ${runtime}`, serving],
  7: [`pnpm platform:stop --profile demo --runtime ${runtime}`, serving],
};

assert.equal(before.baseline.doctor.exit, 0);
assert.equal(before.baseline.machine.processes.length, 2);
imageId();
const step = process.argv[2];
if (step === 'demo') {
  const result = demoDoctor();
  result.matchesBaseline = sameDemo(before.baseline, result);
  save(`demo-${process.argv[3]}.json`, result);
  console.log(JSON.stringify(result, null, 2));
  assert(result.matchesBaseline, 'Demo changed: stop all rehearsal work');
} else {
  const selected = commands[step.replace(/-resume$/, '')];
  assert(selected, 'Unknown step');
  if (step === '1') assert(!existsSync(serving), 'Serving checkout exists already');
  const receipt = run(selected[0], selected[1], 1800000);
  const value = { at: new Date().toISOString(), commit, receipt: step === '6' ? receipt : tail(receipt, 25),
    outputLines: receipt.output.length, state: inventory() };
  if (step.startsWith('5') || step.startsWith('6')) value.gpu = gpu();
  if (step === '1' || step === '2') {
    value.servingHead = run('git rev-parse HEAD', serving).output[0];
    value.servingStatus = run('git status --short', serving).output;
  }
  save(`step-${step}.json`, value);
  console.log(safe(JSON.stringify(value, null, 2)));
  process.exitCode = receipt.exit ?? 1;
}
