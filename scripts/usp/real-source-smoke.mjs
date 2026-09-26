/** RUN-01: unchanged NYC authority bytes plus the retained, separately labelled derivative. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation } from './local-isolation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const dir=realpathSync(process.argv[2] || '');
assert(dir.startsWith(realpathSync(join(root,'.runtime','run01'))+'/'));
const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8'));
assertUspIsolation(env);
const base=env.ULPIN_TEST_URL+'api/v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const original=readFileSync(join(root,'fixtures/real-nyc/original.geojson'));
const provenance=JSON.parse(readFileSync(join(root,'fixtures/real-nyc/provenance.json'),'utf8'));
assert.equal(hash(original),provenance.originalSha256,'retained authority bytes changed');
const native=JSON.parse(original.toString('utf8'));
assert.equal(native.features.length,1,'bounded one-feature profile changed');
const nativeKey=String(native.features[0].properties.doitt_id);
async function call(path, options={}) {
  const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(30000)});
  const value=await response.json();
  if(!response.ok)throw new Error(`${options.method||'GET'} ${path} -> ${response.status} ${value.error?.code||value.error?.message||''}`);
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
  const got=Buffer.from(await response.arrayBuffer());assert(got.equals(want),'source download differs from submitted bytes');
  return {status:response.status,bytes:got.length,sha256:hash(got),contentType:response.headers.get('content-type')};
}
async function waitJob(caseId, jobId) {
  for(let i=0;i<50;i++) {
    const detail=(await call(`/cases/${caseId}`)).value;
    const job=detail.jobs.find(item=>item.id===jobId);
    if(job?.status==='succeeded')return detail;
    if(job?.status==='failed')throw new Error(`job ${jobId} failed: ${job.error||'unreported'}`);
    await sleep(600);
  }
  throw new Error(`job ${jobId} did not complete within 30 seconds`);
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
const rawRead=await exactSource(readPackage.value.sourceRevisionIds[0],original);
const caseCreated=await call('/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  name:`NYC OTI ${nativeKey} source-derived case`,description:'Foreign official footprint with a retained local-metre derivative; no interior, parcel or rights assertion.',
})});
assert.equal(caseCreated.status,201);
const caseId=caseCreated.value.id;
const derived=[];
for(const item of [
  {file:'spatial.json',profile:'parcel-local-json-v1'},
  {file:'levels-r1.csv',profile:'levels-csv-v1'},
]) {
  const bytes=readFileSync(join(root,'fixtures/real-nyc',item.file));
  const uploaded=await call(`/cases/${caseId}/sources`,{method:'POST',body:multipart(bytes,item.file,{profile:item.profile})});
  assert.equal(uploaded.status,201);
  assert.equal(uploaded.value.sha256,hash(bytes));
  let detail=await call(`/cases/${caseId}`);
  const job=detail.value.jobs.find(j=>j.sourceId===uploaded.value.id&&j.operation==='inspect');
  assert(job,'source inspection job absent');
  detail={value:await waitJob(caseId,job.id)};
  assert.equal(detail.value.sources.find(s=>s.id===uploaded.value.id)?.status,'ready');
  derived.push({file:item.file,sourceId:uploaded.value.id,jobId:job.id,jobStatus:'succeeded',download:await exactSource(uploaded.value.id,bytes)});
}
const prepared=await call(`/cases/${caseId}/prepare`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spatialSourceId:derived[0].sourceId,levelSourceId:derived[1].sourceId})});
assert.equal(prepared.value.units.length,1);
const revision=prepared.value.case.revision;
const built=await call(`/cases/${caseId}/build`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision})});
assert.equal(built.status,202);
const final=await waitJob(caseId,built.value.id);
assert(final.model,'build job succeeded without a model read');
const result={schemaVersion:'run01-smoke/1',source:{issuer:provenance.provider,originalUrl:provenance.originalDownload,geography:'New York City, USA',originalSha256:provenance.originalSha256,originalBytes:original.length,nativeKey,sourceCrs:'OGC CRS84 / EPSG:4326',heightLimitation:'No shared vertical datum; building-relative constant envelope is a retained derivative, not surveyed or legal geometry.'},
  inspection:{status:inspected.status,sourceSha256:inspected.value.sourceSha256,featureCount:inspected.value.featureCount},
  rawImport:{status:imported.status,packageId:pkg.id,areaId:pkg.areaId,state:pkg.state,featureCount:pkg.features.length,sourceRevisionId:readPackage.value.sourceRevisionIds[0],download:rawRead},
  derivedCase:{caseId,derived,prepareStatus:prepared.status,caseRevision:revision,unitCount:prepared.value.units.length,buildRequestStatus:built.status,buildJobId:built.value.id,buildJobStatus:'succeeded',modelRead:!!final.model}};
writeFileSync(join(dir,'smoke-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({rawImport:result.rawImport,derivedCase:{caseId,inspectionJobs:derived.map(d=>({file:d.file,status:d.jobStatus,sha256:d.download.sha256})),buildStatus:'succeeded',modelRead:true}}));
