/** One guarded, provider-disabled API journey on unchanged retained official originals. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertUspIsolation,assertLocalOperatorProcess} from './local-isolation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeEnv=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const command=(bin,args,env=safeEnv,timeout=15000)=>execFileSync(bin,args,{cwd:root,env,encoding:'utf8',timeout,maxBuffer:2*1024*1024}).trim();
async function run(){
  const dir=realpathSync(process.argv[2]||'');assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8')),ownership=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  const scope=assertUspIsolation(env),operator=assertLocalOperatorProcess(env);
  assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');assert.equal(ownership.checkout,root);assert.equal(ownership.project,scope.project);
  assert.equal(ownership.nonce,env.ULPIN_LOCAL_NONCE);assert.deepEqual(ownership.operatorProvenance,operator);
  assert.equal(command('git',['rev-parse','HEAD']),ownership.baseCommit);assert.equal(command('git',['status','--porcelain','--untracked-files=no']),'');
  assert(!existsSync(join(root,'.env')));assert(!env.ULPIN_MODEL_GATEWAY_ENABLED);assert(!env.ULPIN_MODEL_GATEWAY_CONFIG);
  const output=join(dir,'document-ingestion-smoke.json');assert(!existsSync(output),'This nonce already has a document receipt.');
  const sourceCheck=JSON.parse(readFileSync(join(root,'docs/evidence/usp/nest-migration/official-runtime-source/source-check.json'),'utf8'));
  const pdfPath=sourceCheck.source.original.localPath,pdf=readFileSync(pdfPath);
  assert.equal(hash(pdf),sourceCheck.source.original.sha256);assert.equal(pdf.length,sourceCheck.source.original.bytes);
  const nyc=readFileSync(join(root,'fixtures/real-nyc/original.geojson')),provenance=JSON.parse(readFileSync(join(root,'fixtures/real-nyc/provenance.json'),'utf8'));
  assert.equal(hash(nyc),provenance.originalSha256);
  const areaManifest=JSON.parse(readFileSync(join(root,'fixtures/real-area/manifest.json'),'utf8'));
  const area=readFileSync(join(root,'fixtures/real-area',areaManifest.sourceFile));assert.equal(hash(area),areaManifest.sourceSha256);
  const textAsset=areaManifest.assets.find(a=>a.file==='evidence/nyc-building-metadata.md'),textPath=join(root,'fixtures/real-area',textAsset.file),text=readFileSync(textPath);
  assert.equal(hash(text),textAsset.sha256);assert.equal(text.length,textAsset.byteLength);
  const receipt={version:'document-ingestion-smoke/1',status:'running',codeCommit:ownership.baseCommit,project:scope.project,nonce:ownership.nonce,
    runAt:new Date().toISOString(),provider:'disabled; no provider configuration, keys, calls or training',
    harnessSha256:hash(readFileSync(fileURLToPath(import.meta.url))),sources:[{sha256:hash(pdf),bytes:pdf.length,issuer:sourceCheck.source.issuer,url:sourceCheck.source.originalUrl,permission:sourceCheck.source.sourcePermissionReference,
      geography:sourceCheck.source.geography,purpose:'test_only'},
    {sha256:hash(nyc),bytes:nyc.length,issuer:provenance.provider,url:provenance.originalDownload,terms:provenance.terms,geography:'New York City, USA',purpose:'test_only'},
    {sha256:hash(area),bytes:area.length,issuer:areaManifest.provider,url:areaManifest.assets.find(a=>a.file===areaManifest.sourceFile).url,
      terms:areaManifest.license.termsUrl,geography:'New York City, USA',purpose:'test_only'},
    {sha256:hash(text),bytes:text.length,issuer:areaManifest.provider,url:textAsset.url,terms:areaManifest.license.termsUrl,
      geography:'New York City, USA',purpose:'test_only; native reference text without inferred facts'}],checks:[],jobs:[],
    notQualified:['CSV/DOCX/image/encrypted runtime source accuracy; scanned PDF OCR','Live model/gateway funding, permission, key or policy','Field extraction accuracy, familiar-layout recipes and held-out evaluation',
      'OCR, generative geometry, domain approval, rights, learning, Indian operational data, scale, release gates or deployment']};
  const base=env.ULPIN_TEST_URL+'api/v1';let phase='source-case',processorStopped=false;
  async function call(path,status=200,body,headers={}){
    const response=await fetch(base+path,{...(body?{method:'POST',body:body instanceof FormData?body:JSON.stringify(body)}:{}),
      headers:{...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(60000)});
    const value=await response.json();assert.equal(response.status,status,`${path}: ${value.error?.code||response.status}`);return value;
  }
  async function original(sourceId,bytes){
    const response=await fetch(`${base}/sources/${sourceId}/file`,{signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);
    const downloaded=Buffer.from(await response.arrayBuffer());assert.equal(downloaded.length,bytes.length);assert.equal(hash(downloaded),hash(bytes));
  }
  function form(bytes,name,key,revision,extra={}){
    const value=new FormData();value.set('file',new Blob([bytes]),name);
    for(const [k,v] of Object.entries({requestKey:key,expectedCaseRevision:revision,...extra}))value.set(k,String(v));return value;
  }
  const path=r=>`/ingestion/cases/${r.caseId}/sources/${r.sourceId}/documents/jobs/${r.jobId}`;
  async function wait(r){
    const end=Date.now()+95000;let current;
    while(Date.now()<end){current=await call(path(r));if(!['queued','running'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,500));}
    assert.equal(current.status,'completed',`Document job finished as ${current.status}/${current.code}`);
    receipt.jobs.push({jobId:r.jobId,caseId:r.caseId,sourceId:r.sourceId,resultSha256:current.resultSha256,native:current.native,model:current.model,
      partCount:current.parts.length,parts:current.parts.map(p=>({sha256:p.sha256,locator:p.locator,sourceSha256:p.sourceSha256}))});return current;
  }
  const newCase=name=>call('/source-cases',201,{requestKey:randomUUID(),name});
  try{
    const sourceCase=await newCase('NYC OTI unchanged official native reference text'),caseId=sourceCase.caseId,key=randomUUID();
    const retained=await call(`/ingestion/cases/${caseId}/documents`,201,form(text,'nyc-building-metadata.md',key,0));
    assert.equal(retained.caseRevision,1);assert.equal(retained.sourceRevision,1);assert.equal(retained.sourceSha256,hash(text));
    phase='native-extraction';await original(retained.sourceId,text);const native=await wait(retained);
    assert.equal(native.native.status,'extracted');assert(native.parts.length>0);assert.equal(native.model.status,'disabled');assert.equal(native.model.code,'MODEL_DISABLED');
    for(const part of native.parts){assert.equal(part.sourceSha256,hash(text));assert.equal(hash(part.text),part.sha256);assert(part.locator.line>=1);}
    receipt.checks.push('Original receipt precedes native work; official text native line locators and exact text/source hashes; provider-disabled output remains usable without a package or entity');
    phase='idempotency';assert.deepEqual(await call(`/ingestion/cases/${caseId}/documents`,201,form(text,'nyc-building-metadata.md',key,0)),retained);
    const alias=await call(`/ingestion/cases/${caseId}/documents`,201,form(text,'nyc-building-metadata.md',randomUUID(),1));assert.deepEqual(alias,retained);
    const retryInput={requestKey:randomUUID(),expectedCaseRevision:1,expectedSourceRevision:1,sourceSha256:hash(text),mode:'propose'};
    const retries=await Promise.all([call(`/ingestion/cases/${caseId}/sources/${retained.sourceId}/documents/retry`,201,retryInput),
      call(`/ingestion/cases/${caseId}/sources/${retained.sourceId}/documents/retry`,201,retryInput)]);
    assert.deepEqual(retries[0],retries[1]);assert.notEqual(retries[0].jobId,retained.jobId);await wait(retries[0]);await original(retained.sourceId,text);
    await call(`/ingestion/cases/${caseId}/sources/${retained.sourceId}/documents/retry`,409,{...retryInput,requestKey:randomUUID(),sourceSha256:'0'.repeat(64)});
    await call(`/ingestion/cases/${caseId}/sources/${retained.sourceId}/documents/retry`,409,{...retryInput,requestKey:randomUUID(),expectedSourceRevision:2});
    await call(path(retained),403,undefined,{'Sec-Fetch-Site':'cross-site'});
    receipt.checks.push('Exact upload replay and same-hash dedup; concurrent same-key retry creates one new job on the unchanged original; incorrect source pins and cross-site access denied');
    phase='scanned-pdf';const scannedCase=await newCase('USGS unchanged historical scanned map');
    const scanned=await call(`/ingestion/cases/${scannedCase.caseId}/documents`,201,form(pdf,'usgs-original.pdf',randomUUID(),0));
    const scannedResult=await wait(scanned);assert.equal(scannedResult.native.status,'needs_ocr');assert.equal(scannedResult.parts.length,0);
    assert.equal(scannedResult.model.status,'unavailable');await original(scanned.sourceId,pdf);
    receipt.checks.push('Actual scanned official USGS PDF returns needs_ocr without invented text; its 9,344,939 original bytes download exactly');
    phase='unsupported-and-stale';const second=await newCase('NYC unchanged official source format boundary');
    const unsupported=await call(`/ingestion/cases/${second.caseId}/documents`,201,form(nyc,'original.geojson',randomUUID(),0));
    const unsupportedResult=await wait(unsupported);assert.equal(unsupportedResult.native.status,'unsupported');assert.equal(unsupportedResult.parts.length,0);await original(unsupported.sourceId,nyc);
    const distinct=await call(`/ingestion/cases/${second.caseId}/documents`,201,form(area,'original.geojson',randomUUID(),1));await wait(distinct);
    const stale=await call(path(unsupported));assert.equal(stale.status,'stale');assert.deepEqual(stale.parts,[]);assert.equal(stale.model,null);assert.equal(stale.resultSha256,null);
    await original(unsupported.sourceId,nyc);await original(distinct.sourceId,area);
    await call(`/ingestion/cases/${caseId}/sources/${distinct.sourceId}/documents/jobs/${distinct.jobId}`,404);
    receipt.checks.push('Unsupported genuine GeoJSON preserves original and emits no placeholders; adding a distinct genuine source changes case pins and hides the older result without rewriting either source');
    phase='tool-failure';command('node',['scripts/usp/real-source-runtime.mjs','processor-stop',dir],safeEnv,60000);processorStopped=true;
    const failedCase=await newCase('NYC official text retained during native-tool outage');
    const failed=await call(`/ingestion/cases/${failedCase.caseId}/documents`,201,form(text,'nyc-building-metadata.md',randomUUID(),0,{mode:'native_only'}));
    const failure=await wait(failed);assert.equal(failure.native.status,'tool_error');assert.equal(failure.parts.length,0);assert.equal(failure.model.status,'not_requested');await original(failed.sourceId,text);
    command('node',['scripts/usp/real-source-runtime.mjs','processor-start',dir],safeEnv,90000);processorStopped=false;
    const recovered=await call(`/ingestion/cases/${failedCase.caseId}/sources/${failed.sourceId}/documents/retry`,201,
      {requestKey:randomUUID(),expectedCaseRevision:1,expectedSourceRevision:1,sourceSha256:hash(text),mode:'native_only'});
    const recoveredResult=await wait(recovered);assert.equal(recoveredResult.native.status,'extracted');assert.equal(recoveredResult.model.status,'not_requested');await original(failed.sourceId,text);
    receipt.checks.push('Stopped native tool returns a retained tool_error derivative; restoring the owned tool and explicitly retrying extracts the same unchanged original');
    phase='source-bound-protocol-controls';
    const controls=command('pnpm',['exec','tsx','scripts/usp/document-ingestion-state.ts',caseId,retained.sourceId,retries[0].jobId,textPath,
      second.caseId,distinct.sourceId,distinct.jobId,unsupported.sourceId,unsupported.jobId],{...safeEnv,...env},60000);
    receipt.controls=JSON.parse(controls);assert.equal(receipt.controls.status,'passed');
    assert.equal(hash(readFileSync(pdfPath)),hash(pdf));assert.equal(hash(readFileSync(join(root,'fixtures/real-nyc/original.geojson'))),hash(nyc));
    assert.equal(hash(readFileSync(join(root,'fixtures/real-area',areaManifest.sourceFile))),hash(area));
    assert.equal(hash(readFileSync(textPath)),hash(text));
    receipt.status='passed';receipt.completedAt=new Date().toISOString();receipt.phase=phase;
    console.log(JSON.stringify({status:receipt.status,checks:receipt.checks.length,jobs:receipt.jobs.length,controls:receipt.controls.checks,invariants:receipt.controls.invariants,receipt:output}));
  }catch(error){receipt.status='failed';receipt.phase=phase;receipt.error=error.message;throw error;}
  finally{
    if(processorStopped)command('node',['scripts/usp/real-source-runtime.mjs','processor-start',dir],safeEnv,90000);
    writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
