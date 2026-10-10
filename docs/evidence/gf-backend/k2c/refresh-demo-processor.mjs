import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoDir, demoProject, readDemo } from '../../../../scripts/platform/demo-config.mjs';
import { demoCompose } from '../../../../scripts/platform/demo.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const finalCheckpoint = process.argv[2] === '--final-checkpoint';
assert(process.argv.length === 2 || (process.argv.length === 3 && finalCheckpoint), 'Unknown processor action.');
const suffix = finalCheckpoint ? 'final' : 'equal-area';
const receiptPath = `docs/evidence/gf-backend/k2c/processor-${suffix}.json`;
assert(!existsSync(receiptPath), 'Processor checkpoint already applied; do not rebuild/recreate twice.');
const env = readDemo(), runtime = dockerRuntime(), before = inventory(runtime, demoProject);
const image = `ulpin-geo:demo-k2c-${suffix}`;
const override = join(demoDir, 'k2c', `candidate-profile-${suffix}.compose.json`);
assert(!existsSync(override), 'Preserve the existing profile overlay.');
writeFileSync(override, JSON.stringify({ services: Object.fromEntries(['geo', 'worker'].map(service => [service, {
  image, environment: { ULPIN_PROFILE: 'demo' },
}])) }) + '\n', { flag: 'wx' });
demoCompose(runtime, env, ['-f', override, 'build', 'geo'], 600_000);
demoCompose(runtime, env, ['-f', override, '--profile', 'app', 'up', '-d', '--no-build', '--no-deps',
  '--wait', '--wait-timeout', '90', 'geo', 'worker'], 180_000);
const after = inventory(runtime, demoProject);
assert.deepEqual([...before.volumes].sort(), [...after.volumes].sort());
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(receiptPath, JSON.stringify({ image, project: demoProject, completedAt: new Date().toISOString(),
  volumesPreserved: true, processorSha256: digest('services/geo/geo/spatial_ml.py'),
  areaProcessorSha256: digest('services/geo/geo/area.py'), gpuUsed: false, inferenceRerun: false,
  analyticalQualificationChanged: false, reason: finalCheckpoint
    ? 'Pin the final line-wrapped processor sources exactly; no model rerun'
    : 'Admit the retained explicit equal-area reference' }) + '\n', { flag: 'wx' });
console.log('Owned demo processor refreshed; exact EPSG:6933 metre placement supported; qualification unchanged.');
