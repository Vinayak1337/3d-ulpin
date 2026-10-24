import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoDir, demoProject, readDemo } from '../../../../scripts/platform/demo-config.mjs';
import { demoCompose } from '../../../../scripts/platform/demo.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const evidence = 'docs/evidence/gf-backend/k2c';
const modelId = 'rfdetr-ramp-ka-seg-medium-b3-v1';
const image = 'ulpin-geo:demo-k2c';
const configDirectory = join(demoDir, 'k2c');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const env = readDemo();
const runtime = dockerRuntime();
const model = JSON.parse(readFileSync('services/geo/ml-models.json', 'utf8')).models.find(row => row.id === modelId);
assert.equal(model.active, false);
assert.deepEqual(model.activeProfiles, ['demo']);
assert(!existsSync(`${evidence}/activation.json`), 'Activation already recorded; do not rebuild/recreate twice.');
const cardPath = `docs/evidence/gf-ai/building/${modelId}/model-card.json`;
const card = JSON.parse(readFileSync(cardPath, 'utf8'));
const target = join(env.ULPIN_DEMO_MODEL_DIR, model.filename);
if (!existsSync(target)) copyFileSync(card.onnx_export.path, target, constants.COPYFILE_EXCL);
assert.equal(hash(readFileSync(target)), model.sha256);
const before = inventory(runtime, demoProject);
assert(before.containers.filter(container => ['geo', 'worker'].includes(container.service)).length === 2);
mkdirSync(configDirectory, { recursive: true });
const override = join(configDirectory, 'candidate-profile.compose.json');
if (!existsSync(override)) {
  writeFileSync(override, JSON.stringify({ services: Object.fromEntries(['geo', 'worker'].map(service => [service, {
    image, environment: { ULPIN_PROFILE: 'demo' },
  }])) }) + '\n', { flag: 'wx' });
}
assert.equal(JSON.parse(readFileSync(override, 'utf8')).services.geo.image, image);
demoCompose(runtime, env, ['-f', override, 'build', 'geo'], 600_000);
demoCompose(runtime, env, ['-f', override, '--profile', 'app', 'up', '-d', '--no-build', '--no-deps',
  '--wait', '--wait-timeout', '90', 'geo', 'worker'], 180_000);
const after = inventory(runtime, demoProject);
const volumes = snapshot => snapshot.volumes.map(volume => volume.name ?? volume).sort();
assert.deepEqual(volumes(after), volumes(before));
const receipt = { modelId, defaultActive: model.active, activeProfiles: model.activeProfiles,
  weightsSha256: model.sha256, executionProvider: 'CPUExecutionProvider', image,
  runtimeProfile: 'demo', ownedProject: demoProject, completedAt: new Date().toISOString(),
  preservedVolumes: true, holdoutScored: false, gpuUsed: false,
  limitations: ['Recall below preregistered target', 'Uncalibrated confidence', 'test_only roofprint candidates'],
  processorSha256: hash(readFileSync('services/geo/geo/spatial_ml.py')) };
writeFileSync(`${evidence}/activation.json`, JSON.stringify(receipt) + '\n', { flag: 'wx' });
console.log(`Activated ${modelId} for ulpin-demo only; CPUExecutionProvider; default remains inactive.`);
