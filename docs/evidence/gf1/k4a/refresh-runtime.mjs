import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDemo } from '../../../../scripts/platform/demo-config.mjs';
import { launchProcesses, ownedProcess, stopProcesses, waitForApi } from '../../../../scripts/platform/processes.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const receipt = 'docs/evidence/gf1/k4a/runtime.json';
assert(!existsSync(receipt), 'Preserve the runtime refresh checkpoint.');
const runtime = dockerRuntime();
const before = inventory(runtime, 'ulpin-demo');
for (const label of ['api', 'dispatcher']) {
  const record = ownedProcess(label);
  assert(record && resolve(record.entry).toLowerCase().startsWith(resolve('.').toLowerCase()));
}
const env = readDemo();
await stopProcesses();
await launchProcesses(env);
await waitForApi(env);
const after = inventory(runtime, 'ulpin-demo');
assert.deepEqual(before.volumes, after.volumes);
assert.deepEqual(before.containers.map(row => row.id), after.containers.map(row => row.id));
writeFileSync(receipt, JSON.stringify({ refreshedAt: new Date().toISOString(),
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  manifestRegistrationInWorkingTree: true, reason: 'Refresh cached SQL loader after manifest registration',
  ownedNativeProcessesOnly: true, containersPreserved: true, volumesPreserved: true,
  reset: false, reseed: false, inferenceOrOcrExecutions: 0, leftRunning: true,
}) + '\n', { flag: 'wx' });
console.log('Refreshed only owned native API/dispatcher; containers and volumes preserved.');
