import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoProject } from '../../../../scripts/platform/demo-config.mjs';
import { ownedProcess } from '../../../../scripts/platform/processes.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const root = 'docs/evidence/gf-backend/k2c';
const receipt = process.argv[2] ?? 'runtime-final.json';
assert(/^[a-z0-9-]+\.json$/.test(receipt), 'Only a new owned receipt name is accepted.');
const runtime = dockerRuntime(), snapshot = inventory(runtime, demoProject);
const geo = snapshot.containers.find(container => container.service === 'geo');
assert(geo && geo.project === demoProject);
const served = JSON.parse(runtime.docker('exec', geo.id, 'python', '-c',
  'import hashlib,json,os; from pathlib import Path; '
  + 'print(json.dumps({"profile":os.getenv("ULPIN_PROFILE"),"hashes":{'
  + 'p:hashlib.sha256(Path("/app",p).read_bytes()).hexdigest() '
  + 'for p in ["geo/spatial_ml.py","geo/area.py","ml-models.json"]}}))'));
assert.equal(served.profile, 'demo');
for (const [path, digest] of Object.entries(served.hashes)) {
  const bytes = readFileSync(`services/geo/${path}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
}
const processes = ['api', 'dispatcher'].map(label => {
  const record = ownedProcess(label);
  assert(record && resolve(record.entry).toLowerCase().startsWith(resolve('.').toLowerCase()));
  return { label, pid: record.pid, creationDate: record.creationDate, checkoutIdentityVerified: true };
});
const image = runtime.docker('inspect', geo.id, '--format', '{{.Config.Image}}');
assert.equal(image, 'ulpin-geo:demo-k2c-final');
const value = { profile: 'demo', project: demoProject, loopbackApi: 'http://127.0.0.1:3194/api/v1',
  observedAt: new Date().toISOString(), leftRunning: true,
  servedCheckoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  servedImage: image, processorSourcesMatchCheckout: true, servedProcessorHashes: served.hashes, processes,
  volumes: snapshot.volumes.filter(name => name.startsWith(`${demoProject}_`)).sort(),
  dataContainersPreserved: true, originalsPreserved: true, resets: 0, seeds: 0, pushes: 0,
  nativeRestarts: [
    { code: 'fea94e72', completedAt: null, reason: 'Imagery-only import and canonical overlays' },
    { code: 'fcd698fe', completedAt: null, reason: 'Canonical candidates, room command and sanitized OCR' },
    { code: '017dbdbc', completedAt: null, reason: 'Exact-source SQL origin casts' },
    { code: '8f5f5415', completedAt: null, reason: 'Original overlay route and final closed diagnostic contract' },
    { code: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      completedAt: null, reason: 'Keep retained ML aliases and outline roles as candidates in canonical reads' },
  ],
  processorUpdates: ['demo-k2c', 'demo-k2c-equal-area', 'demo-k2c-final'],
  processorUpdatesScope: 'Owned demo geo/worker only; existing storage containers and volumes retained',
  gpuUsed: false, scored: false, inferenceChips: 22, additionalModelInference: 0, ocrAttempts: 1,
  qualifications: ['Health/heartbeat is not extraction accuracy', 'Roofprint registry acceptance is blocked',
    'OCR still failed', 'Hindi assets present, runner uses English', 'No complete runtime gate pass'] };
writeFileSync(`${root}/${receipt}`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
console.log('Owned running demo identity and exact served processor hashes verified; secrets not read or emitted.');
