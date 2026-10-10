import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { demoDir, demoProject, readDemo } from '../../../../scripts/platform/demo-config.mjs';
import { demoCompose } from '../../../../scripts/platform/demo.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const receiptPath = 'docs/evidence/gf-backend/k2d/processor.json';
assert(!existsSync(receiptPath), 'No repeated processor activation.');
const env = readDemo(), runtime = dockerRuntime(), before = inventory(runtime, demoProject);
const image = 'ulpin-geo:demo-k2d';
const override = join(demoDir, 'k2d', 'profile-activation.compose.json');
assert(!existsSync(override), 'Retain all earlier images and overlays.');
mkdirSync(dirname(override), { recursive: true });
writeFileSync(override, JSON.stringify({ services: Object.fromEntries(['geo', 'worker'].map(service => [service, {
  image, environment: { ULPIN_PROFILE: 'demo' },
}])) }) + '\n', { flag: 'wx' });
demoCompose(runtime, env, ['-f', override, 'build', 'geo'], 600_000);
demoCompose(runtime, env, ['-f', override, '--profile', 'app', 'up', '-d', '--no-build', '--no-deps',
  '--wait', '--wait-timeout', '90', 'geo', 'worker'], 180_000);
const after = inventory(runtime, demoProject);
assert.deepEqual([...before.volumes].sort(), [...after.volumes].sort());
const storage = snapshot => snapshot.containers.filter(container => !['geo', 'worker'].includes(container.service))
  .map(container => container.id).sort();
assert.deepEqual(storage(before), storage(after));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(receiptPath, JSON.stringify({ image, project: demoProject, completedAt: new Date().toISOString(),
  volumesPreserved: true, storageContainersPreserved: true, processorSha256: digest('services/geo/geo/spatial_ml.py'),
  modelManifestSha256: digest('services/geo/ml-models.json'), gpuUsed: false, inferenceRerun: false,
  analyticalQualificationChanged: false, nativeProcessesRestarted: false,
  reason: 'Serve configured activeProfiles; default registry and demo candidate policy unchanged',
}) + '\n', { flag: 'wx' });
console.log('Owned geo/worker profile predicate updated; storage and native processes unchanged; no inference.');
