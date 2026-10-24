import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDemo, safeEnvironment } from '../../../../scripts/platform/demo-config.mjs';
import { launchProcesses, ownedProcess, stopProcesses, waitForApi } from '../../../../scripts/platform/processes.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const root = 'docs/evidence/gf-backend/k3c';
assert(!existsSync(`${root}/runtime-final.json`), 'Preserve the create-once final runtime checkpoint.');
const runtime = dockerRuntime();
const before = inventory(runtime, 'ulpin-demo');
for (const label of ['api', 'dispatcher']) {
  const record = ownedProcess(label);
  assert(record && resolve(record.entry).toLowerCase().startsWith(resolve('.').toLowerCase()));
}
// Reuse the standard launcher's credential consumption; do not inspect, emit or change credential files.
const env = readDemo();
const output = execFileSync(process.execPath, ['--require', resolve('scripts/platform/isolated-env.cjs'),
  '--import', 'tsx', resolve(`${root}/migrate-rejections.ts`)], {
  env: safeEnvironment(env), timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(output.trim(), '');
await stopProcesses();
await launchProcesses(env);
await waitForApi(env);
const after = inventory(runtime, 'ulpin-demo');
assert.deepEqual(after.volumes, before.volumes);
assert.deepEqual(after.containers.map(container => container.id), before.containers.map(container => container.id));
writeFileSync(`${root}/runtime-final.json`, JSON.stringify({ completedAt: new Date().toISOString(),
  servedCheckout: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  api: 'http://127.0.0.1:3194/api/v1', profile: 'demo', ocrPrefix: env.ULPIN_DOCUMENT_OCR_TESSDATA,
  volumes: after.volumes.filter(name => name.startsWith('ulpin-demo_')), containerIdsPreserved: true,
  nativeProcessesOwnershipVerified: true, containersRecreated: 0, reset: false, reseed: false,
  newOcrExecutions: 0, newModelInference: 0, leftRunning: true,
}) + '\n', { flag: 'wx' });
console.log('Applied bounded forward-only demo migration and restarted only the owned API/dispatcher.');
