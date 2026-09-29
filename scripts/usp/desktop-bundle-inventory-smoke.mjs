/** Provider-disabled private API journey on retained originals; receipts contain metadata only. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {assertLocalOperatorProcess,assertUspIsolation} from './local-isolation.mjs';

const [runtime,outputRoot]=process.argv.slice(2);
assert(runtime&&outputRoot&&process.argv.length===4,'Provide the owned runtime and private receipt directory.');
assert.equal(basename(runtime),'prefix-worker-20260929');
const env=JSON.parse(readFileSync(join(runtime,'run.env.json'),'utf8'));
const owner=JSON.parse(readFileSync(join(runtime,'ownership.json'),'utf8'));
assert.equal(owner.project,assertUspIsolation(env).project);assertLocalOperatorProcess(env);
assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
const hash=value=>createHash('sha256').update(value).digest('hex');
const sources=[
  {kind:'karnataka_district_original',path:'E:/BhuAayam-data/task-data/ulpin-data-10/District.zip',
    sha256:'0f5b59339c5d4e3a3c1efd4be810edd38264e40a51f29f17ab78b19067f88891',members:7,expanded:6005321,format:'archive'},
  {kind:'nyc_local_assembly',path:'E:/BhuAayam-data/task-data/nyc-zcta-10013-context/nyc-10013-official-context.zip',
    sha256:'ec691b929143f520cbf8b427bc071877030c045a035fd99697cdcf231d542111',members:76,expanded:14486364,format:'archive'},
  {kind:'fco_workbook_compat',path:'E:/BhuAayam-data/task-data/desktop-ai04e-native-xlsx/Senior_Staff_Hospitality_Received__Cabinet_Office_.xlsx',
    sha256:'aa301b90933f3b779a69a855f271fa7ab6217b5e0a93b279fca7636d675f32f4',format:'xlsx'},
  {kind:'mhra_docx_compat',path:'E:/BhuAayam-data/task-data/desktop-ai04d-native-documents/Applicant_s_response_template.docx',
    sha256:'3d709b94da96e91c83e7c901b3b1dca1b4d1403f0602696eff8c77973d2aae92',format:'docx'},
];
const base=env.ULPIN_TEST_URL+'api/v1';
async function json(path,expected=200,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',body:body instanceof FormData?body:body?JSON.stringify(body):undefined,
    headers:body && !(body instanceof FormData)?{'Content-Type':'application/json'}:undefined,signal:AbortSignal.timeout(60000)});
  const value=await response.json();
  assert.equal(response.status,expected,`${path}: ${response.status}/${value.error?.code??''}`);
  return value;
}
async function submit(source){
  const bytes=readFileSync(source.path);assert.equal(hash(bytes),source.sha256);
  const created=await json('/source-cases',201,{requestKey:randomUUID(),name:`Private ${source.kind} reader check`});
  const form=new FormData();form.set('file',new Blob([bytes]),basename(source.path));
  form.set('requestKey',randomUUID());form.set('expectedCaseRevision','0');form.set('mode','native_only');
  const receipt=await json(`/ingestion/cases/${created.caseId}/documents`,201,form);
  assert.equal(receipt.sourceSha256,source.sha256);assert.equal(receipt.bytes,bytes.length);
  const download=await fetch(`${base}/sources/${receipt.sourceId}/file`,{signal:AbortSignal.timeout(60000)});
  assert.equal(download.status,200);const returned=Buffer.from(await download.arrayBuffer());
  assert.equal(returned.length,bytes.length);assert.equal(hash(returned),source.sha256);
  let result;const deadline=Date.now()+110000;
  do{
    result=await json(`/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/documents/jobs/${receipt.jobId}`);
    if(result.status==='completed')break;
    assert(['queued','running'].includes(result.status),`${source.kind}: ${result.status}/${result.code}`);
    await new Promise(resolve=>setTimeout(resolve,500));
  }while(Date.now()<deadline);
  assert.equal(result.status,'completed',`${source.kind}: bounded job deadline`);
  assert.equal(result.native.format,source.format);assert.equal(result.model.status,'not_requested');
  if(source.format==='archive'){
    assert.equal(result.native.status,'unsupported');assert.equal(result.native.code,'ARCHIVE_INVENTORY_ONLY');
    assert.equal(result.parts.length,0);
    const inventory=result.native.archiveInventory;
    assert.equal(inventory.sourceSha256,source.sha256);assert.equal(inventory.coverage,'complete');
    assert.equal(inventory.memberCount,source.members);assert.equal(inventory.members.length,source.members);
    assert.equal(inventory.declaredExpandedBytes,source.expanded);
    assert.equal(inventory.observedExpandedBytes,source.expanded);
    assert(inventory.members.every((member,index)=>member.ordinal===index && member.crc==='match' &&
      member.sha256?.length===64 && member.actualBytes===member.declaredBytes));
    if(source.kind==='karnataka_district_original')
      assert(inventory.members.filter(member=>member.routeHint==='shapefile').every(member=>member.companion==='complete'));
    if(source.kind==='nyc_local_assembly')
      assert(inventory.members.some(member=>member.issue==='SCRIPT_INERT' && member.routeHint==='none'));
  }else{
    assert.equal(result.native.status,'extracted');assert(result.parts.length>0);
    assert.equal(result.native.archiveInventory,undefined);
  }
  return {kind:source.kind,bytes:bytes.length,sha256:source.sha256,caseId:receipt.caseId,
    sourceId:receipt.sourceId,jobId:receipt.jobId,resultSha256:result.resultSha256,
    readerSha256:result.native.readerSha256,nativeStatus:result.native.status,format:result.native.format,
    memberCount:result.native.archiveInventory?.memberCount??null,
    partCount:result.parts.length};
}
assert.equal((await json('/health')).ok,true);
const results=[];for(const source of sources)results.push(await submit(source));
const denied=await fetch(`${base}/ingestion/cases/${results[1].caseId}/sources/${results[0].sourceId}/documents/jobs/${results[0].jobId}`,
  {signal:AbortSignal.timeout(10000)});
assert.equal(denied.status,404);const deniedBody=await denied.text();
assert(!deniedBody.includes(basename(sources[0].path)));
mkdirSync(outputRoot,{recursive:true});
const path=join(outputRoot,`runtime-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
assert(!existsSync(path));
const report={version:'desktop-bundle-inventory-runtime/1',runAt:new Date().toISOString(),project:owner.project,
  providerCalls:0,crossCaseStatus:denied.status,results};
writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:path,sha256:hash(readFileSync(path)),results:results.map(({kind,nativeStatus,format,memberCount,partCount})=>
  ({kind,nativeStatus,format,memberCount,partCount})),crossCaseStatus:denied.status}));
