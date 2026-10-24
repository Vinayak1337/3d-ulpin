import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDemo } from '../../../../scripts/platform/demo-config.mjs';
import { launchProcesses, ownedProcess, stopProcesses, waitForApi } from '../../../../scripts/platform/processes.mjs';

const receipt = 'docs/evidence/gf-t16/k3b/native-final.json';
assert(!existsSync(receipt), 'Preserve each native startup checkpoint.');
for (const label of ['api', 'dispatcher']) {
  const record = ownedProcess(label);
  assert(record && resolve(record.entry).toLowerCase().startsWith(resolve('.').toLowerCase()));
}
// Standard demo launcher configuration only; no credential contents are inspected, changed or emitted.
const env = readDemo();
await stopProcesses();
await launchProcesses(env);
await waitForApi(env);
writeFileSync(receipt, JSON.stringify({ checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim(), completedAt: new Date().toISOString(), identityChecked: true,
  profile: 'demo', ocrPrefix: env.ULPIN_DOCUMENT_OCR_TESSDATA,
  containersOrVolumesChanged: false, reset: false, seed: false,
  reason: 'Serve final schedule/association safeguards and demo-only OCR override',
}) + '\n', { flag: 'wx' });
console.log('Owned native processes restarted against the final source checkpoint; existing services/data unchanged.');
