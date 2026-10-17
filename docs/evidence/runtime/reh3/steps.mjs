import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containers, demoDoctor, evidence, gpu, image, inventory, pinnedImage, oldImage, run, runtime, safe,
  sameDemo, save, serving, tail } from './audit.mjs';

// REH2's part-a.mjs for REH3: one receipt per step, written once; every command runs from the rehearsal's serving
// checkout and names ulpin-reh-02, except the one image build, which touches no container.
const before = JSON.parse(readFileSync(`${evidence}/before.json`, 'utf8'));
const commit = before.stagingCommit;
const commands = {
  'a2-checkout': `git checkout --detach ${commit}`,
  'a2-install': 'pnpm install --frozen-lockfile',
  'a3-build': 'node scripts/platform/processor-image.mjs build',
  'b1-document-runtime': `node scripts/platform/demo-document-runtime.mjs build --runtime ${runtime}`,
  'b2-roll': `node scripts/platform/processor-image.mjs roll --runtime ${runtime}`,
  'b3-start': `pnpm platform:start --profile demo --runtime ${runtime}`,
  'b3-doctor': `pnpm platform:doctor --profile demo --runtime ${runtime}`,
  'end-stop': `pnpm platform:stop --profile demo --runtime ${runtime}`,
};

assert.equal(before.baseline.doctor.exit, 0);
assert.equal(before.baseline.machine.processes.length, 2);
image(oldImage);
image(pinnedImage);
const step = process.argv[2];
if (step === 'demo') {
  const result = demoDoctor();
  result.matchesBaseline = sameDemo(before.baseline, result);
  save(`demo-${process.argv[3]}.json`, result);
  console.log(JSON.stringify(result, null, 2));
  assert(result.matchesBaseline, 'Demo changed: stop all rehearsal work');
} else {
  const selected = commands[step];
  assert(selected, 'Unknown step');
  const containersBefore = { 'ulpin-demo': containers('ulpin-demo'), [runtime]: containers(runtime) };
  const receipt = run(selected, serving, 1800000);
  const value = { at: new Date().toISOString(), commit, receipt: step === 'b3-doctor' ? receipt : tail(receipt, 25),
    outputLines: receipt.output.length, containersBefore,
    containersAfter: { 'ulpin-demo': containers('ulpin-demo'), [runtime]: containers(runtime) }, state: inventory() };
  if (step.startsWith('b3')) value.gpu = gpu();
  if (step.startsWith('a2')) {
    value.servingHead = run('git rev-parse HEAD', serving).output[0];
    value.servingServicesGeo = run('git rev-parse HEAD:services/geo', serving).output[0];
    value.servingStatus = run('git status --short', serving).output;
  }
  if (step.startsWith('a3') || step.startsWith('b2')) value.images = [image(oldImage), image(pinnedImage)];
  save(`step-${step}.json`, value);
  console.log(safe(JSON.stringify(value, null, 2)));
  process.exitCode = receipt.exit ?? 1;
}
