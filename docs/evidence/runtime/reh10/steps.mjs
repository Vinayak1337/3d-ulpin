import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containers, demoDoctor, evidence, gpu, image, inventory, pinnedImage, run, runtime, safe, sameDemo, save,
  serving, tail } from './audit.mjs';

// REH9's steps.mjs for REH10: one receipt per step, written once; every command runs from the rehearsal's serving
// checkout and names ulpin-reh-02. No schema step (database/ is unchanged from the served commit), no image roll
// (the pin is unchanged); the document runtime is rebuilt as every roll-out does.
const before = JSON.parse(readFileSync(`${evidence}/before.json`, 'utf8'));
const commit = process.env.REH10_COMMIT;
assert(/^[0-9a-f]{40}$/.test(commit ?? ''), 'REH10_COMMIT must be the full roll commit');
const pin = JSON.parse(readFileSync('E:/Projects/ulpin-wt/k3/scripts/platform/processor-image.json', 'utf8'));
const commands = {
  'b0-stop': `pnpm platform:stop --profile demo --runtime ${runtime}`,
  'b1-checkout': `git checkout --detach ${commit}`,
  'b1-install': 'pnpm install --frozen-lockfile',
  'b2-document-runtime': `node scripts/platform/demo-document-runtime.mjs build --runtime ${runtime}`,
  'b3-start': `pnpm platform:start --profile demo --runtime ${runtime}`,
  'b3-doctor': `pnpm platform:doctor --profile demo --runtime ${runtime}`,
  'end-stop': `pnpm platform:stop --profile demo --runtime ${runtime}`,
};

// The demo's comparison is the same doctor exit, commit, process ids and containers as the baseline.
const step = process.argv[2];
if (step === 'demo') {
  const result = demoDoctor();
  result.matchesBaseline = sameDemo(before.baseline, result);
  save(`demo-${process.argv[3]}.json`, result);
  console.log(JSON.stringify(result, null, 2));
  assert(result.matchesBaseline, 'Demo changed: record it and continue');
} else {
  const selected = commands[step];
  assert(selected, 'Unknown step');
  const containersBefore = { 'ulpin-demo': containers('ulpin-demo'), [runtime]: containers(runtime) };
  const receipt = run(selected, serving, 1800000);
  const value = { at: new Date().toISOString(), commit, receipt: step.endsWith('-doctor') ? receipt : tail(receipt, 25),
    outputLines: receipt.output.length, containersBefore,
    containersAfter: { 'ulpin-demo': containers('ulpin-demo'), [runtime]: containers(runtime) }, state: inventory() };
  if (/-(start|doctor)$/.test(step)) value.gpu = gpu();
  if (/-(checkout|install)$/.test(step)) {
    value.servingHead = run('git rev-parse HEAD', serving).output[0];
    value.servingServicesGeo = run('git rev-parse HEAD:services/geo', serving).output[0];
    value.pinServicesTree = pin.servicesTree;
    value.servicesTreeIsPin = value.servingServicesGeo === pin.servicesTree;
    value.servingStatus = run('git status --short', serving).output;
  }
  if (step.endsWith('-start')) value.images = [image(pinnedImage)];
  save(`step-${step}.json`, value);
  console.log(safe(JSON.stringify(value, null, 2)));
  process.exitCode = receipt.exit ?? 1;
}
