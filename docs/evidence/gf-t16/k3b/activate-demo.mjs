import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { demoDir, demoProject, readDemoOcrPaths, readDemo } from '../../../../scripts/platform/demo-config.mjs';
import { demoCompose } from '../../../../scripts/platform/demo.mjs';
import { launchProcesses, ownedProcess, stopProcesses, waitForApi } from '../../../../scripts/platform/processes.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const root = 'docs/evidence/gf-t16/k3b';
const profileFile = join(demoDir, 'ocr-paths-profile.json');
const prefix = join(demoDir, 'tessdata-complete');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function activatePrefix() {
  assert(!existsSync(profileFile), 'Preserve an existing OCR profile override; do not activate twice.');
  const retainedFile = join(demoDir, 'ocr-paths.json');
  const before = hash(readFileSync(retainedFile));
  const paths = readDemoOcrPaths();
  const manifest = JSON.parse(readFileSync('docs/evidence/gf-backend/k2f/prefix.json', 'utf8'));
  for (const entry of manifest.files) {
    assert.equal(hash(readFileSync(join(prefix, entry.file))), entry.sha256);
  }
  const value = { profile: 'demo', paths: { ...paths, ULPIN_DOCUMENT_OCR_TESSDATA: prefix } };
  writeFileSync(profileFile, JSON.stringify(value) + '\n', { flag: 'wx' });
  assert.equal(readDemoOcrPaths().ULPIN_DOCUMENT_OCR_TESSDATA, prefix);
  assert.equal(hash(readFileSync(retainedFile)), before);
  return { profile: 'demo', prefix, retainedPathConfigurationUnchanged: true,
    globalDefaultChanged: false, configurationMechanism: 'demo-only readDemoOcrPaths profile override' };
}

function refreshProcessor(runtime, env) {
  const overlay = join(demoDir, 'k3b', 'level-prisms.compose.json');
  assert(!existsSync(overlay), 'Preserve the owned processor overlay.');
  mkdirSync(dirname(overlay), { recursive: true });
  writeFileSync(overlay, JSON.stringify({ services: Object.fromEntries(['geo', 'worker'].map(service => [service, {
    image: 'ulpin-geo:demo-k3b', environment: { ULPIN_PROFILE: 'demo' },
  }])) }) + '\n', { flag: 'wx' });
  demoCompose(runtime, env, ['-f', overlay, 'build', 'geo'], 600000);
  demoCompose(runtime, env, ['-f', overlay, '--profile', 'app', 'up', '-d', '--no-build', '--no-deps',
    '--wait', '--wait-timeout', '90', 'geo', 'worker'], 180000);
}

async function main() {
  assert(!existsSync(`${root}/runtime-activation.json`), 'Activation already checkpointed.');
  for (const label of ['api', 'dispatcher']) {
    const process = ownedProcess(label);
    assert(process && resolve(process.entry).toLowerCase().startsWith(resolve('.').toLowerCase()));
  }
  const runtime = dockerRuntime();
  const before = inventory(runtime, demoProject);
  const ocr = activatePrefix();
  // Only the established launcher consumes retained credentials internally; never inspect or emit their contents.
  const env = readDemo();
  refreshProcessor(runtime, env);
  await stopProcesses();
  await launchProcesses(env);
  await waitForApi(env);
  const after = inventory(runtime, demoProject);
  assert.deepEqual([...after.volumes].sort(), [...before.volumes].sort());
  const storageIds = snapshot => snapshot.containers.filter(container => !['geo', 'worker'].includes(container.service))
    .map(container => container.id).sort();
  assert.deepEqual(storageIds(after), storageIds(before));
  writeFileSync(`${root}/runtime-activation.json`, JSON.stringify({ ocr, completedAt: new Date().toISOString(),
    api: 'http://127.0.0.1:3194/api/v1', nativeCheckoutIdentityVerified: true, processorImage: 'ulpin-geo:demo-k3b',
    processorChanges: 'K3a prism engine and existing area bridge build-prisms operation',
    storageContainersAndVolumesPreserved: true, originalAssetsPreserved: true, ocrRerun: false,
    resets: 0, seeds: 0, gpuUsed: false }) + '\n', { flag: 'wx' });
  console.log('Owned demo updated; profile-specific OCR prefix active, storage preserved, no OCR execution.');
}

await main();
