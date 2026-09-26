/** RUN-01 official-original intake probe. Phase 1: execution stays disabled. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation } from './local-isolation.mjs';

// Change this only after the integrated Nest foundation and intake contracts are reviewed.
const RUNTIME_ENABLED = false;
if (!RUNTIME_ENABLED) {
  console.error('RUN-01 smoke execution is gated pending integrated foundation and intake review; no API call was made.');
  process.exit(1);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const dir=realpathSync(process.argv[2] || '');
assert(dir.startsWith(realpathSync(join(root,'.runtime','run01'))+'/'));
const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8'));
assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');
try {assertUspIsolation(env);}
catch {throw new Error('private run configuration failed isolation validation');}
const base=env.ULPIN_TEST_URL+'api/v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=readFileSync(join(root,'fixtures/real-nyc/original.geojson'));
const provenance=JSON.parse(readFileSync(join(root,'fixtures/real-nyc/provenance.json'),'utf8'));
assert.equal(hash(original),provenance.originalSha256,'retained authority bytes changed');
assert(provenance.provider && provenance.originalDownload && provenance.terms,'issuer, original URL and terms are required');
const native=JSON.parse(original.toString('utf8'));
assert.equal(native.features.length,1,'bounded one-feature profile changed');
const nativeKey=String(native.features[0].properties.doitt_id);
assert.equal(nativeKey,provenance.sourceKey.doitt_id,'native key differs from retained provenance');
async function call(path, options={}) {
  const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(30000)});
  const value=await response.json();
  if(!response.ok)throw new Error(`${options.method||'GET'} ${path} -> ${response.status} ${value.error?.code||'API_ERROR'}`);
  return {status:response.status,value};
}
function multipart(file,name,fields={}) {
  const form=new FormData();form.set('file',new Blob([file]),name);
  for(const [key,value] of Object.entries(fields))form.set(key,value);
  return form;
}
async function exactSource(sourceId,want) {
  const response=await fetch(base+`/sources/${sourceId}/file`,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);
  assert(response.headers.get('cache-control')?.startsWith('private'),'source download must be private');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const got=Buffer.from(await response.arrayBuffer());assert(got.equals(want),'source download differs from submitted bytes');
  return {status:response.status,bytes:got.length,sha256:hash(got),contentType:response.headers.get('content-type')};
}
const inspected=await call('/import-packages/inspect',{method:'POST',body:multipart(original,'original.geojson')});
assert.equal(inspected.value.sourceSha256,provenance.originalSha256);
assert.equal(inspected.value.featureCount,1);
assert.equal(inspected.value.sourceCrs,'EPSG:4326');
const mapping={idField:'doitt_id',kind:'building',geometryRole:'unknown'};
const imported=await call('/import-packages',{method:'POST',body:multipart(original,'original.geojson',{
  format:'geojson',namespace:'nyc-oti-5zhs-2jue',name:`NYC OTI building footprint ${nativeKey}`,
  mapping:JSON.stringify(mapping),sourceCrs:'EPSG:4326',worldStatus:'observed',
})});
assert.equal(imported.status,201);
const pkg=imported.value;
assert.equal(pkg.sourceHash,provenance.originalSha256);
assert.equal(pkg.features.length,1);
assert.equal(pkg.features[0].sourceKey,nativeKey);
assert.equal(pkg.features[0].geometryRole,'unknown');
const readPackage=await call(`/import-packages/${pkg.id}`);
assert.equal(readPackage.value.sourceHash,provenance.originalSha256);
assert.equal(readPackage.value.sourceRevisionIds.length,1);
const sourceRevisionId=readPackage.value.sourceRevisionIds[0];
const rawRead=await exactSource(sourceRevisionId,original);
assert.equal(rawRead.sha256,provenance.originalSha256);
assert.equal(readPackage.value.features.length,1);
const candidate=readPackage.value.features[0];
assert.equal(candidate.sourceKey,nativeKey);
assert.equal(candidate.sourceRevisionId,sourceRevisionId);
assert(candidate.evidence?.some(item=>item.sourceRevisionId===sourceRevisionId&&item.featureId===nativeKey),
  'candidate record does not bind to the unchanged official original');
const area=await call(`/areas/${pkg.areaId}/context`);
const persisted=area.value.packages.find(item=>item.id===pkg.id);
assert(persisted,'candidate package is absent from the area read');
assert.equal(persisted.sourceRevisionIds[0],sourceRevisionId);
assert.equal(persisted.features[0].id,candidate.id);

// This supported GeoJSON path normalizes synchronously and exposes no queued
// job tied to sourceRevisionId. A derivative inspection job would be a different
// source flow, so it cannot complete this qualification.
const result={schemaVersion:'run01-smoke/2',qualification:'blocked',
  source:{issuer:provenance.provider,originalUrl:provenance.originalDownload,terms:provenance.terms,
    geography:'New York City, USA',originalSha256:provenance.originalSha256,originalBytes:original.length,
    nativeKey,sourceCrs:'OGC CRS84 / EPSG:4326',limitations:provenance.limitations},
  inspection:{status:inspected.status,sourceSha256:inspected.value.sourceSha256,featureCount:inspected.value.featureCount},
  rawImport:{status:imported.status,packageId:pkg.id,areaId:pkg.areaId,state:pkg.state,
    sourceRevisionId,download:rawRead,candidateId:candidate.id,persistedReadStatus:area.status},
  jobAuthority:{status:'unavailable',jobId:null,sourceRevisionId,
    gap:'The supported GeoJSON import is synchronous and returns no queued job for this original; GF-BACKEND source-to-job-to-record remains open.'}};
const receipt=join(dir,`smoke-${randomBytes(6).toString('hex')}.json`);
writeFileSync(receipt,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt,qualification:result.qualification,sourceRevisionId,originalSha256:rawRead.sha256,gap:result.jobAuthority.gap}));
process.exitCode=2;
