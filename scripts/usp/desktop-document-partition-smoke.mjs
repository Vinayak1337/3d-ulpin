/** One provider-disabled document journey on retained USGS originals. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {assertLocalOperatorProcess,assertUspIsolation} from './local-isolation.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const runtime=process.argv[2],sourceRoot=process.argv[3],receiptRoot=process.argv[4];
assert(runtime&&sourceRoot&&receiptRoot&&process.argv.length===5,
  'Usage: desktop-document-partition-smoke.mjs <owned-runtime> <retained-task-data> <new-receipt-directory>');
assert.equal(basename(runtime),'prefix-worker-20260929');
const env=JSON.parse(readFileSync(join(runtime,'run.env.json'),'utf8'));
const owner=JSON.parse(readFileSync(join(runtime,'ownership.json'),'utf8'));
const scope=assertUspIsolation(env);assertLocalOperatorProcess(env);
assert.equal(owner.project,scope.project);
assert.equal(owner.profile,'prefix-worker');
assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
const sources=[
  {kind:'native_fact_sheet',path:join(sourceRoot,'ai-04a-docling','usgs-fact-sheet-2025-3036.pdf'),
    sha256:'5c1576e603b4bb66ff4725329432be66941853838d6ab02544e7b40a0071b5a7',bytes:6219868},
  {kind:'scanned_map',path:join(sourceRoot,'ulpin-official-runtime-pdf-v1','usgs-central-city-co-1910-topographic-map.pdf'),
    sha256:'fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf',bytes:9344939},
];
for(const source of sources){
  source.data=readFileSync(source.path);
  assert.equal(source.data.length,source.bytes);
  assert.equal(hash(source.data),source.sha256);
}
const base=env.ULPIN_TEST_URL+'api/v1';
async function call(path,expected=200,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',body:body instanceof FormData?body:body?JSON.stringify(body):undefined,
    headers:body && !(body instanceof FormData)?{'Content-Type':'application/json'}:undefined,signal:AbortSignal.timeout(60000)});
  const value=await response.json();
  assert.equal(response.status,expected,`${path}: ${response.status}/${value.error?.code??''}`);
  return value;
}
async function retainedOriginal(sourceId,source){
  const response=await fetch(`${base}/sources/${sourceId}/file`,{signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length,source.bytes);assert.equal(hash(bytes),source.sha256);
}
async function submit(source,name){
  const created=await call('/source-cases',201,{requestKey:randomUUID(),name});
  const form=new FormData();form.set('file',new Blob([source.data]),basename(source.path));
  form.set('requestKey',randomUUID());form.set('expectedCaseRevision','0');form.set('mode','native_only');
  const receipt=await call(`/ingestion/cases/${created.caseId}/documents`,201,form);
  assert.equal(receipt.sourceSha256,source.sha256);
  await retainedOriginal(receipt.sourceId,source);
  let status;
  const deadline=Date.now()+110000;
  do{
    status=await call(`/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/documents/jobs/${receipt.jobId}`);
    if(status.status==='completed')break;
    assert(['queued','running'].includes(status.status),`Document job ended ${status.status}/${status.code}`);
    await new Promise(resolve=>setTimeout(resolve,500));
  }while(Date.now()<deadline);
  assert.equal(status.status,'completed','Document job did not finish before the bounded deadline');
  const parts=[...status.parts];
  for(let page=1;status.hasMore;page++){
    status=await call(`/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/documents/jobs/${receipt.jobId}?page=${page}`);
    parts.push(...status.parts);
  }
  return {receipt,status,parts};
}
function verifyParts(parts,sourceSha256){
  const units=new Map();
  for(const part of parts){
    assert.equal(part.sourceSha256,sourceSha256);
    assert.equal(hash(part.text),part.sha256);
    assert(part.locator.page>=1);
    assert(part.locator.paragraph>=1 ||
      (part.locator.line>=1 && part.locator.lineEnd>=part.locator.line));
    assert(part.text.length<=4096);
    assert.equal(part.locator.characterEnd-part.locator.characterStart,part.text.length);
    const group=units.get(part.locator.unitId)??[];group.push(part);units.set(part.locator.unitId,group);
  }
  for(const group of units.values()){
    group.sort((a,b)=>a.locator.segmentIndex-b.locator.segmentIndex);
    let offset=0;
    for(const [index,part] of group.entries()){
      assert.equal(part.locator.segmentIndex,index);
      assert.equal(part.locator.segmentCount,group.length);
      assert.equal(part.locator.characterStart,offset);
      offset=part.locator.characterEnd;
    }
    assert.equal(hash(group.map(part=>part.text).join('')),group[0].locator.unitSha256);
  }
  return {parts:parts.length,units:units.size,continuationUnits:[...units.values()].filter(group=>group.length>1).length,
    pages:[...new Set(parts.map(part=>part.locator.page))].sort((a,b)=>a-b)};
}
const health=await call('/health');assert.equal(health.ok,true);
const fact=await submit(sources[0],'USGS fact sheet native document partition check');
assert.equal(fact.status.native.status,'extracted');
assert.equal(fact.status.model.status,'not_requested');
const factCoverage=verifyParts(fact.parts,sources[0].sha256);
assert(factCoverage.pages.includes(1));
assert(factCoverage.units>4,'The readable PDF needs page-local evidence groups');
assert(fact.parts.some(part=>part.text.includes('Plain Language Summary')),
  'The retained fact sheet summary heading must remain visible in a cited part');
const scanned=await submit(sources[1],'USGS Central City scanned original document check');
assert.equal(scanned.status.native.status,'needs_ocr');
assert.equal(scanned.status.model.status,'not_requested');
assert.equal(scanned.parts.length,0);
mkdirSync(receiptRoot,{recursive:true});
const path=join(receiptRoot,`runtime-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
assert(!existsSync(path));
const result={version:'desktop-ai04b-document-runtime/1',runAt:new Date().toISOString(),project:scope.project,
  sourceChecks:sources.map(({kind,sha256,bytes})=>({kind,sha256,bytes})),
  fact:{caseId:fact.receipt.caseId,sourceId:fact.receipt.sourceId,jobId:fact.receipt.jobId,
    resultSha256:fact.status.resultSha256,native:fact.status.native.status,model:fact.status.model.status,...factCoverage},
  scanned:{caseId:scanned.receipt.caseId,sourceId:scanned.receipt.sourceId,jobId:scanned.receipt.jobId,
    resultSha256:scanned.status.resultSha256,native:scanned.status.native.status,model:scanned.status.model.status,
    parts:scanned.parts.length},providerCalls:0};
writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:path,sha256:hash(readFileSync(path)),fact:result.fact,scanned:result.scanned}));
