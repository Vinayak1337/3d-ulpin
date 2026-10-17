import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoProject } from '../../../../scripts/platform/demo-config.mjs';
import { ownedProcess } from '../../../../scripts/platform/processes.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const runtime = dockerRuntime(), snapshot = inventory(runtime, demoProject);
const geo = snapshot.containers.find(container => container.service === 'geo');
assert(geo && geo.project === demoProject);
const served = JSON.parse(runtime.docker('exec', geo.id, 'python', '-c',
  'import hashlib,json,os; from pathlib import Path; '
  + 'from geo.spatial_ml import _model_active; '
  + 'assert not _model_active({"active":False,"activeProfiles":["fixture-only-authorised-profile"]}); '
  + 'os.environ["ULPIN_PROFILE"]="fixture-only-authorised-profile"; '
  + 'assert _model_active({"active":False,"activeProfiles":["fixture-only-authorised-profile"]}); '
  + 'os.environ.pop("ULPIN_PROFILE"); '
  + 'assert not _model_active({"active":False,"activeProfiles":["fixture-only-authorised-profile"]}); '
  + 'print(json.dumps({"profilePredicateChecks":3,"hashes":{'
  + 'p:hashlib.sha256(Path("/app",p).read_bytes()).hexdigest() '
  + 'for p in ["geo/spatial_ml.py","geo/area.py","ml-models.json"]}}))'));
for (const [path, digest] of Object.entries(served.hashes)) {
  assert.equal(createHash('sha256').update(readFileSync(`services/geo/${path}`)).digest('hex'), digest);
}
const processes = ['api', 'dispatcher'].map(label => {
  const record = ownedProcess(label);
  assert(record && resolve(record.entry).toLowerCase().startsWith(resolve('.').toLowerCase()));
  return { label, pid: record.pid, creationDate: record.creationDate, checkoutIdentityVerified: true };
});
const image = runtime.docker('inspect', geo.id, '--format', '{{.Config.Image}}');
assert.equal(image, 'ulpin-geo:demo-k2d');
const prior = JSON.parse(readFileSync('docs/evidence/gf-backend/k2c/runtime-final-method.json', 'utf8'));
const volumes = snapshot.volumes.filter(name => name.startsWith(`${demoProject}_`)).sort();
assert.deepEqual(volumes, prior.volumes);
writeFileSync('docs/evidence/gf-backend/k2d/runtime-final.json', JSON.stringify({ profile: 'demo',
  project: demoProject, api: 'http://127.0.0.1:3194/api/v1', observedAt: new Date().toISOString(), leftRunning: true,
  checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  apiStartupCheckpoint: prior.servedCheckoutCommit, apiRestarted: false, serverTypeScriptChanged: false,
  servedImage: image, exactProcessorHashes: served.hashes, profilePredicateChecks: served.profilePredicateChecks,
  processes, volumes, storageContainersPreserved: true, resets: 0, seeds: 0, pushes: 0, gpuUsed: false,
  additionalRoofprintInference: 0, diagnosticOcrAttempts: 1, postDiagnosisOcrRetries: 0,
  roofprintQualificationExecuted: false, completeRuntimeGatePass: false }) + '\n', { flag: 'wx' });
console.log('Owned running demo verified: exact K2d processor hashes, profile predicate and preserved storage.');
