/** One retained official scan through the private document retry authority. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertLocalOperatorProcess,assertUspIsolation} from './local-isolation.mjs';

const [phase,runtime,outputRoot]=process.argv.slice(2);
assert(['live','missing','recovered','final'].includes(phase)&&runtime&&outputRoot&&process.argv.length===5);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const env=JSON.parse(readFileSync(join(runtime,'run.env.json'),'utf8'));
const owner=JSON.parse(readFileSync(join(runtime,'ownership.json'),'utf8'));
assert.equal(owner.project,assertUspIsolation(env).project);assertLocalOperatorProcess(env);
assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
mkdirSync(outputRoot,{recursive:true});
const file=join(outputRoot,'private-ocr-api.json');
const destination=phase==='final'?join(outputRoot,'private-ocr-final.json'):file;
const source='E:/BhuAayam-data/task-data/ulpin-official-runtime-pdf-v1/usgs-central-city-co-1910-topographic-map.pdf';
const expected='fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf';
const hash=value=>createHash('sha256').update(value).digest('hex');
const region=[107.133,52.325,464.244,112.125];
const bytes=readFileSync(source);assert.equal(hash(bytes),expected);
const base=env.ULPIN_TEST_URL+'api/v1';
async function call(path,status=200,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',body:body instanceof FormData?body:body?JSON.stringify(body):undefined,
    headers:body && !(body instanceof FormData)?{'Content-Type':'application/json'}:undefined,signal:AbortSignal.timeout(60000)});
  const value=await response.json();assert.equal(response.status,status,`${path}: ${response.status}/${value.error?.code??''}`);return value;
}
const path=r=>`/ingestion/cases/${r.caseId}/sources/${r.sourceId}/documents/jobs/${r.jobId}`;
async function wait(receipt){
  const until=Date.now()+115000;let result;
  do{result=await call(path(receipt));if(['completed','failed','stale'].includes(result.status))break;
    await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<until);
  assert.equal(result.status,'completed',`${result.status}/${result.code}`);return result;
}
async function retry(receipt,selection){
  return call(`/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/documents/retry`,201,
    {requestKey:randomUUID(),expectedCaseRevision:receipt.caseRevision,expectedSourceRevision:receipt.sourceRevision,
      sourceSha256:receipt.sourceSha256,mode:'native_only',ocrSelection:selection});
}
async function assertOriginal(receipt){
  const response=await fetch(`${base}/sources/${receipt.sourceId}/file`,{signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,200);const actual=Buffer.from(await response.arrayBuffer());
  assert.equal(actual.length,bytes.length);assert.equal(hash(actual),expected);
  return {bytes:actual.length,sha256:hash(actual),cacheControl:response.headers.get('cache-control')};
}
let record;
if(phase==='final'){
  assert(!existsSync(destination),'Preserve the existing final receipt.');
  const previous=readFileSync(file),prior=JSON.parse(previous.toString('utf8'));
  const retained={...prior.source,sourceSha256:prior.source.sha256};
  const selected=await retry(retained,{page:1,region}),selectedResult=await wait(selected);
  assert.equal(selectedResult.ocr.outputStatus,'complete');assert.equal(selectedResult.ocrItems.length,5);
  assert.equal(selectedResult.ocr.textCompleteness,'unverified');assert.equal(selectedResult.native.status,'needs_ocr');
  assert.equal(selectedResult.model.status,'not_requested');assert.equal(selectedResult.parts.length,0);
  assert.equal(selectedResult.ocr.execution.maxSeconds,90);assert.equal(selectedResult.ocr.execution.worker.gatedStart,true);
  assert.equal(selectedResult.ocr.execution.worker.stopReason,null);assert(selectedResult.ocr.execution.receiptSha256);
  assert.equal(selectedResult.ocr.sourceSha256,expected);assert.equal(selectedResult.ocr.sourceRevision,retained.sourceRevision);
  const page=await call(path(selected)+'?page=0&ocrPage=1');assert.deepEqual(page.ocrItems,[]);assert.equal(page.ocrHasMore,false);
  const whole=await retry(retained,{page:1}),wholeResult=await wait(whole);
  assert.equal(wholeResult.ocr.toolStatus,'complete');assert.equal(wholeResult.ocr.outputStatus,'partial');
  assert.deepEqual(wholeResult.ocrItems,[]);assert(wholeResult.ocr.issues.includes('no_ocr_text_emitted'));
  const other=await call('/source-cases',201,{requestKey:randomUUID(),name:'Separate private source OCR access check'});
  await call(`/ingestion/cases/${other.caseId}/sources/${retained.sourceId}/documents/jobs/${selected.jobId}`,404);
  const bare=['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'];
  const ocrKeys=['ULPIN_DOCUMENT_OCR_PYTHON','ULPIN_DOCUMENT_OCR_MODELS','ULPIN_DOCUMENT_OCR_TESSERACT',
    'ULPIN_DOCUMENT_OCR_TESSDATA','ULPIN_DOCUMENT_OCR_SCRATCH'];
  const childEnv=Object.fromEntries([...bare.map(key=>[key,process.env[key]]),...Object.entries(env),
    ...ocrKeys.map(key=>[key,process.env[key]]),['ULPIN_FIXTURE_ROOT',join(root,'fixtures')]].filter(([,value])=>typeof value==='string'));
  const controls=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/usp/desktop-private-ocr-controls.ts',
    retained.caseId,retained.sourceId,selected.jobId],{cwd:root,env:childEnv,encoding:'utf8',windowsHide:true,timeout:30000}));
  assert.equal(controls.status,'passed');
  const codePaths=['packages/contracts/src/usp/document-ingestion.ts','apps/api/src/modules/ingestion/documents.controller.ts',
    ...['document-context','document-native','document-worker','documents','document-ocr'].map(name=>`packages/server/src/modules/usp/ingestion/${name}.ts`),
    'scripts/usp/document-models/run_source_ocr.py','scripts/usp/document-models/run_trial.py',
    'services/geo/geo/usp_document_candidates/docling_tesseract.py'];
  const projection=(job,result)=>({jobId:job.jobId,resultSha256:result.resultSha256,sourceSha256:result.ocr.sourceSha256,
    sourceRevision:result.ocr.sourceRevision,sourcePage:result.ocr.sourcePage,requestedRegion:result.ocr.requestedRegion,
    sourcePageFrame:result.ocr.sourcePageFrame,items:result.ocrItems.length,toolStatus:result.ocr.toolStatus,
    outputStatus:result.ocr.outputStatus,textCompleteness:result.ocr.textCompleteness,issues:result.ocr.issues,execution:result.ocr.execution});
  record={version:'private-ocr-api-final/1',status:'passed',runAt:new Date().toISOString(),project:owner.project,
    codeHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    uncommittedCode:Boolean(execFileSync('git',['diff','--name-only','HEAD','--',...codePaths],{cwd:root,encoding:'utf8'}).trim()),
    codeSha256:Object.fromEntries(codePaths.map(path=>[path,hash(readFileSync(join(root,path)))])),
    previousReceiptSha256:hash(previous),source:prior.source,selected:projection(selected,selectedResult),
    whole:projection(whole,wholeResult),independentPagination:true,crossCaseStatus:404,original:await assertOriginal(retained),controls,
    priorMissingRuntime:prior.missing,priorRecovery:prior.recovered,priorCrossCaseStatus:prior.crossCaseStatus};
}else if(phase==='live'){
  assert(!existsSync(file),'Use a new private receipt directory.');
  const created=await call('/source-cases',201,{requestKey:randomUUID(),name:'USGS Central City 1910 source OCR check'});
  const form=new FormData();form.set('file',new Blob([bytes]),'usgs-central-city-co-1910-topographic-map.pdf');
  form.set('requestKey',randomUUID());form.set('expectedCaseRevision','0');form.set('mode','native_only');
  const retained=await call(`/ingestion/cases/${created.caseId}/documents`,201,form);
  assert.equal(retained.sourceSha256,expected);
  const initial=await wait(retained);assert.equal(initial.native.status,'needs_ocr');assert.equal(initial.ocr,null);
  const selected=await retry(retained,{page:1,region});
  const selectedResult=await wait(selected);assert.equal(selectedResult.native.status,'needs_ocr');
  assert.equal(selectedResult.ocr.outputStatus,'complete');assert.equal(selectedResult.ocr.textCompleteness,'unverified');
  assert.equal(selectedResult.ocr.sourceSha256,expected);assert.equal(selectedResult.ocr.sourceRevision,1);
  assert.deepEqual(selectedResult.ocr.requestedRegion,region);assert.equal(selectedResult.ocrItems.length,5);
  assert(selectedResult.ocrItems.every(item=>item.sourcePageBoxes.every(cite=>cite.pageNumber===1 &&
    cite.frame==='pdf_display_page_top_left_points'&&cite.box.length===4)));
  assert(['UNITED STATES','DEPARTMENT OF THE INTERIOR','GEOLOGICAL SURVEY'].every(text=>
    selectedResult.ocrItems.some(item=>item.text.includes(text))));
  const whole=await retry(retained,{page:1});const wholeResult=await wait(whole);
  assert.equal(wholeResult.ocr.toolStatus,'complete');assert.equal(wholeResult.ocr.outputStatus,'partial');
  assert.equal(wholeResult.ocrItems.length,0);assert(wholeResult.ocr.issues.includes('no_ocr_text_emitted'));
  const original=await assertOriginal(retained);
  const other=await call('/source-cases',201,{requestKey:randomUUID(),name:'Separate private source case'});
  await call(`/ingestion/cases/${other.caseId}/sources/${retained.sourceId}/documents/jobs/${selected.jobId}`,404);
  record={version:'private-ocr-api/1',status:'running',project:owner.project,codeCommit:owner.baseCommit,
    source:{sha256:expected,bytes:bytes.length,caseId:retained.caseId,sourceId:retained.sourceId,caseRevision:retained.caseRevision,sourceRevision:1},
    initial:{jobId:retained.jobId,nativeStatus:initial.native.status},
    selected:{jobId:selected.jobId,resultSha256:selectedResult.resultSha256,items:selectedResult.ocrItems.length,
      firstBox:selectedResult.ocrItems[0].sourcePageBoxes[0].box,toolStatus:selectedResult.ocr.toolStatus,
      outputStatus:selectedResult.ocr.outputStatus},
    whole:{jobId:whole.jobId,resultSha256:wholeResult.resultSha256,items:0,issues:wholeResult.ocr.issues,
      toolStatus:wholeResult.ocr.toolStatus,outputStatus:wholeResult.ocr.outputStatus},original,crossCaseStatus:404};
}else{
  assert(existsSync(file));record=JSON.parse(readFileSync(file,'utf8'));
  const receipt={...record.source,sourceSha256:record.source.sha256};
  const queued=await retry(receipt,{page:1,region});const result=await wait(queued);
  if(phase==='missing'){
    assert.equal(result.ocr.toolStatus,'unavailable');assert.equal(result.ocr.outputStatus,'failed');
    assert(result.ocr.issues.includes('OCR_RUNTIME_UNAVAILABLE'));
  }else{
    assert.equal(result.ocr.outputStatus,'complete');assert.equal(result.ocrItems.length,5);
    const stale=await call(path({...receipt,jobId:record.missing.jobId}));
    assert.equal(stale.status,'stale');assert.equal(stale.ocr,null);assert.equal(stale.ocrItems.length,0);
    record.configStaleStatus=stale.status;
  }
  record[phase]={jobId:queued.jobId,resultSha256:result.resultSha256,toolStatus:result.ocr.toolStatus,
    outputStatus:result.ocr.outputStatus,issues:result.ocr.issues,items:result.ocrItems.length};
  if(phase==='recovered')record.status='passed';
}
writeFileSync(destination,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({phase,status:record.status,sourceSha256:expected,selected:record.selected?.items,
  whole:record.whole?.outputStatus,missing:record.missing?.toolStatus,recovered:record.recovered?.items}));
