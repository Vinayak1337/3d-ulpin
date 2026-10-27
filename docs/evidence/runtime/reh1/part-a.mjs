import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidence, serving, demoDoctor, sameDemo, run, inventory, save } from './audit.mjs';

const before = JSON.parse(readFileSync(`${evidence}/before.json`, 'utf8'));
const commit = 'afd23f2999c412ed5c2b21aae10c3fae0c859003';
const commands = {
  '1': [`git worktree add --detach ${serving} ${commit}`, 'E:/Projects/3d-ulpin'],
  '2': ['pnpm install --frozen-lockfile', serving],
  '3': ['pnpm platform:start --profile demo --create --runtime ulpin-reh-01', serving],
  '4': ['node scripts/platform/demo-document-runtime.mjs build --runtime ulpin-reh-01', serving],
  '5': ['pnpm platform:start --profile demo --runtime ulpin-reh-01', serving],
  '6': ['pnpm platform:doctor --profile demo --runtime ulpin-reh-01', serving],
  '7': ['pnpm platform:stop --profile demo --runtime ulpin-reh-01', serving],
};

assert.equal(before.baseline.doctor.exit, 0);
assert.equal(before.baseline.commit.slice(0, 8), '18b5e74c');
assert.equal(before.baseline.machine.processes.length, 2);
const step = process.argv[2];
if (step === 'demo') {
  const result = demoDoctor();
  result.matchesBaseline = sameDemo(before.baseline, result);
  save(`demo-${process.argv[3]}.json`, result);
  console.log(JSON.stringify(result, null, 2));
  assert(result.matchesBaseline, 'Demo changed: stop all rehearsal work');
} else {
  const selected = commands[step.replace('-resume', '')];
  assert(selected, 'Unknown step');
  let gpu = null;
  if (step.startsWith('3')) {
    gpu = run('nvidia-smi --query-compute-apps=pid,used_memory --format=csv', evidence);
    assert.equal(gpu.exit, 0);
  }
  const receipt = run(selected[0], selected[1], 900000);
  const state = inventory();
  if (step === '5') gpu = run('nvidia-smi --query-compute-apps=pid,used_memory --format=csv', evidence);
  save(`step-${step}.json`, { at: new Date().toISOString(), commit, receipt, gpu, state });
  console.log(JSON.stringify({ receipt, gpu, state }, null, 2));
  process.exitCode = receipt.exit ?? 1;
}
