import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  containers, demoDoctor, image, inventory, oldImage, pinnedImage, run, safe, sameDemo, save, serving, tail,
} from './audit.mjs';

// REH10's step receipts, with REH3's processor roll between documents and start. A second argument `back` rolls
// to the earlier served commit, under its own receipt names.
const phase = process.argv[3] ?? '';
const commit = phase === 'back' ? '1a226949' : '1e749518';
const runtime = 'ulpin-reh-02';
const commands = {
  stop: `pnpm platform:stop --profile demo --runtime ${runtime}`,
  checkout: `git checkout --detach ${commit}`,
  install: 'pnpm install --frozen-lockfile',
  documents: `node scripts/platform/demo-document-runtime.mjs build --runtime ${runtime}`,
  roll: `node scripts/platform/processor-image.mjs roll --runtime ${runtime}`,
  start: `pnpm platform:start --profile demo --runtime ${runtime}`,
  doctor: `pnpm platform:doctor --profile demo --runtime ${runtime}`,
  end: `pnpm platform:stop --profile demo --runtime ${runtime}`,
};
const step = process.argv[2];
if (step === 'demo-after') {
  const before = JSON.parse(readFileSync(new URL('./before.json', import.meta.url), 'utf8'));
  const after = demoDoctor();
  after.matchesBaseline = sameDemo(before.baseline, after);
  save('demo-after.json', after);
  console.log(safe(JSON.stringify(after)));
} else {
  assert(commands[step], 'Unknown rehearsal step');
  const receipt = run(commands[step], serving, 1800000);
  save(`step-${step}${phase ? `-${phase}` : ''}.json`, { at: new Date().toISOString(), receipt: tail(receipt, 40),
    containers: containers(runtime), state: inventory(),
    images: [image(pinnedImage), image(oldImage)] });
  console.log(safe(JSON.stringify(receipt)));
  process.exitCode = receipt.exit ?? 1;
}
