import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containers, demoDoctor, evidence, gpu, image, inventory, pinnedImage, oldImage, run, runtime, safe,
  sameDemo, save, serving, tail } from './audit.mjs';

// REH4's steps.mjs for REH5: one receipt per step, written once; every command runs from the rehearsal's serving
// checkout and names ulpin-reh-02. No image is built: the pinned image is already on the engine.
const before = JSON.parse(readFileSync(`${evidence}/before.json`, 'utf8'));
const commit = before.stagingCommit;
const pin = JSON.parse(readFileSync('E:/Projects/ulpin-wt/k2/scripts/platform/processor-image.json', 'utf8'));
const commands = {
  'a2-checkout': `git checkout --detach ${commit}`,
  'a2-install': 'pnpm install --frozen-lockfile',
  'a3-document-runtime': `node scripts/platform/demo-document-runtime.mjs build --runtime ${runtime}`,
  'a3-roll': `node scripts/platform/processor-image.mjs roll --runtime ${runtime}`,
  'a3-start': `pnpm platform:start --profile demo --runtime ${runtime}`,
  'a3-doctor': `pnpm platform:doctor --profile demo --runtime ${runtime}`,
  'end-stop': `pnpm platform:stop --profile demo --runtime ${runtime}`,
};

assert.equal(before.baseline.doctor.exit, 0);
assert.equal(before.baseline.machine.processes.length, 2);
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
  const value = { at: new Date().toISOString(), commit, receipt: step === 'a3-doctor' ? receipt : tail(receipt, 25),
    outputLines: receipt.output.length, containersBefore,
    containersAfter: { 'ulpin-demo': containers('ulpin-demo'), [runtime]: containers(runtime) }, state: inventory() };
  if (step === 'a3-start' || step === 'a3-doctor') value.gpu = gpu();
  if (step.startsWith('a2')) {
    value.servingHead = run('git rev-parse HEAD', serving).output[0];
    value.servingServicesGeo = run('git rev-parse HEAD:services/geo', serving).output[0];
    value.pinServicesTree = pin.servicesTree;
    value.servicesTreeIsPin = value.servingServicesGeo === pin.servicesTree;
    value.servingStatus = run('git status --short', serving).output;
  }
  if (step === 'a3-roll') value.images = [image(oldImage), image(pinnedImage)];
  save(`step-${step}.json`, value);
  console.log(safe(JSON.stringify(value, null, 2)));
  process.exitCode = receipt.exit ?? 1;
}
