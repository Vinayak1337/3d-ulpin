import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoProject, readDemoOcrPaths } from '../../../../scripts/platform/demo-config.mjs';
import { ownedProcess } from '../../../../scripts/platform/processes.mjs';
import { dockerRuntime, inventory } from '../../../../scripts/platform/runtime.mjs';

const root = 'docs/evidence/gf-t16/k3b';
const runtime = dockerRuntime();
const snapshot = inventory(runtime, demoProject);
const geo = snapshot.containers.find(container => container.service === 'geo');
assert(geo && geo.project === demoProject);
const hashes = JSON.parse(runtime.docker('exec', geo.id, 'python', '-c',
  'import hashlib,json; from pathlib import Path; '
  + 'print(json.dumps({p:hashlib.sha256(Path("/app",p).read_bytes()).hexdigest() '
  + 'for p in ["geo/api.py","geo/geometry.py","geo/spatial_ml.py","ml-models.json"]}))'));
for (const [file, sha256] of Object.entries(hashes)) {
  assert.equal(createHash('sha256').update(readFileSync(`services/geo/${file}`)).digest('hex'), sha256);
}
const prefix = readDemoOcrPaths().ULPIN_DOCUMENT_OCR_TESSDATA;
assert.equal(resolve(prefix), resolve('E:/BhuAayam-data/runtime/ulpin-demo/tessdata-complete'));
const processes = ['api', 'dispatcher'].map(label => {
  const record = ownedProcess(label);
  assert(record && resolve(record.entry).toLowerCase().startsWith(resolve('.').toLowerCase()));
  return { label, pid: record.pid, creationDate: record.creationDate, checkoutIdentityVerified: true };
});
const prior = JSON.parse(readFileSync('docs/evidence/gf-backend/k2d/runtime-final.json', 'utf8'));
const volumes = snapshot.volumes.filter(name => name.startsWith(`${demoProject}_`)).sort();
assert.deepEqual(volumes, prior.volumes);
assert.equal(runtime.docker('inspect', geo.id, '--format', '{{.Config.Image}}'), 'ulpin-geo:demo-k3b');
const startup = JSON.parse(readFileSync(`${root}/native-final.json`, 'utf8'));
writeFileSync(`${root}/runtime-final.json`, JSON.stringify({ observedAt: new Date().toISOString(),
  servedNativeCheckout: startup.checkoutCommit, profile: 'demo', api: 'http://127.0.0.1:3194/api/v1',
  leftRunning: true, ocrPrefix: prefix, ocrPrefixScope: 'demo-only', processorImage: 'ulpin-geo:demo-k3b',
  exactProcessorSourceHashes: hashes, processes, volumes, storagePreserved: true,
  registryRoofprintAdmissionChanged: false, newOcrExecutions: 0, newModelInference: 0, gpuUsed: false,
  newPrismExecutions: 0, reason: 'All real schedule vertical limits unknown; no extrusion',
  completeGatePass: false, resets: 0, seeds: 0, pushes: 0 }) + '\n', { flag: 'wx' });
console.log('Owned runtime identity, complete demo OCR prefix, exact processor sources and retained storage verified.');
