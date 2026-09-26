import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertUspIsolation,assertLocalOperatorProcess} from './local-isolation.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const inherited=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
async function run(){
  const dir=realpathSync(process.argv[2]);assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'))),owner=JSON.parse(readFileSync(join(dir,'ownership.json')));
  assertUspIsolation(env);assertLocalOperatorProcess(env);assert.equal(owner.checkout,root);assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),owner.baseCommit);
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim(),'');
  assert(!existsSync(join(root,'.env')));assert(!env.ULPIN_MODEL_GATEWAY_ENABLED);assert(!env.ULPIN_MODEL_GATEWAY_CONFIG);
  const manifest=JSON.parse(readFileSync(join(root,'fixtures/real-area/manifest.json'))),asset=manifest.assets.find(a=>a.file==='evidence/nyc-building-metadata.md');
  const textPath=join(root,'fixtures/real-area',asset.file),text=readFileSync(textPath);assert.equal(hash(text),asset.sha256);
  const check=JSON.parse(readFileSync(join(root,'docs/evidence/usp/nest-migration/official-runtime-source/source-check.json'))),pdf=readFileSync(check.source.original.localPath);
  assert.equal(hash(pdf),check.source.original.sha256);
  const base=env.ULPIN_TEST_URL+'api/v1',output=join(dir,'document-authority-proof.json');assert(!existsSync(output));
  const receipt={version:'document-authority-proof/1',status:'running',codeCommit:owner.baseCommit,nonce:owner.nonce,runAt:new Date().toISOString(),
    sources:[{sha256:hash(text),bytes:text.length,url:asset.url,terms:manifest.license.termsUrl},{sha256:hash(pdf),bytes:pdf.length,url:check.source.originalUrl,terms:check.source.sourcePermissionReference}],
    provider:'disabled; no model configuration/key/call',checks:[],proofs:[],jobs:[],
    limits:['Foreign test_only sources; no geometry, rights, training, field accuracy, OCR or release qualification','No legitimate marked-source property association is available: snapshot/evidence/packet/export gates use declared in-memory protocol metadata, not invented persisted targets or operational records','Marked staged documents are unavailable through legacy re-extraction/copy; canonical original/native APIs remain usable']};
  async function call(path,status=200,body){const r=await fetch(base+path,{...(body?{method:'POST',body:body instanceof FormData?body:JSON.stringify(body)}:{}),headers:body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{},signal:AbortSignal.timeout(60000)});const value=await r.json();assert.equal(r.status,status,`${path}: ${value.error?.code||r.status}`);return value;}
  function form(bytes,name,revision){const f=new FormData();f.set('file',new Blob([bytes]),name);f.set('requestKey',randomUUID());f.set('expectedCaseRevision',String(revision));return f;}
  const path=r=>`/ingestion/cases/${r.caseId}/sources/${r.sourceId}/documents/jobs/${r.jobId}`;
  async function wait(r){const end=Date.now()+90000;let value;while(Date.now()<end){value=await call(path(r));if(!['queued','running'].includes(value.status))break;await new Promise(r=>setTimeout(r,500));}assert.equal(value.status,'completed');receipt.jobs.push({jobId:r.jobId,sourceId:r.sourceId,resultSha256:value.resultSha256,native:value.native.status,model:value.model.status});return value;}
  async function original(id,expected){const r=await fetch(`${base}/sources/${id}/file`);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),hash(expected));assert.equal(bytes.length,expected.length);}
  function proof(retained,phase){const stdout=execFileSync('pnpm',['exec','tsx','scripts/usp/document-authority-proof.ts',retained.caseId,retained.sourceId,retained.jobId,textPath,phase],{cwd:root,env:{...inherited,...env},encoding:'utf8',timeout:60000,maxBuffer:1048576}).trim();const value=JSON.parse(stdout);assert.equal(value.status,'passed');receipt.proofs.push(value);}
  try{
    const created=await call('/source-cases',201,{requestKey:randomUUID(),name:'Retained official document authority review'});
    const retained=await call(`/ingestion/cases/${created.caseId}/documents`,201,form(text,'nyc-building-metadata.md',0));receipt.caseId=created.caseId;
    const native=await wait(retained);assert.equal(native.native.status,'extracted');assert.equal(native.model.status,'disabled');assert(native.parts.length);
    await original(retained.sourceId,text);
    const generic=await call(`/cases/${created.caseId}`);const view=generic.sources.find(s=>s.id===retained.sourceId).inspection;
    assert(!view.referenceParts);assert(!view.documentOriginal);assert(!view.documentAccepted);
    // Existing case/source IDs in invalid destination slots are a protocol input,
    // not a fabricated building/package or claimed property association.
    const rejected=await call(`/import-packages/${created.caseId}/copy-case-documents`,409,{expectedRevision:1,caseId:created.caseId,sourceIds:[retained.sourceId],buildingId:retained.sourceId,reason:'Marked-source boundary before destination processing'});
    assert.equal(rejected.error.code,'DOCUMENT_CANONICAL_COPY_REQUIRED');
    receipt.checks.push('Final-code HTTP native/provider-disabled/original/generic projection and marked-source copy boundary');
    proof(retained,'current');
    const scanned=await call(`/ingestion/cases/${created.caseId}/documents`,201,form(pdf,'usgs-scanned-original.pdf',1));
    const scannedResult=await wait(scanned);assert.equal(scannedResult.native.status,'needs_ocr');assert.equal(scannedResult.parts.length,0);await original(scanned.sourceId,pdf);
    const stale=await call(path(retained));assert.equal(stale.status,'stale');assert.deepEqual(stale.parts,[]);assert.equal(stale.model,null);
    proof(retained,'stale');await original(retained.sourceId,text);
    receipt.checks.push('Actual scanned PDF needs_ocr and exact original; real additional-source case drift denies captured text evidence without altering bytes');
    const retry=await call(`/ingestion/cases/${created.caseId}/sources/${retained.sourceId}/documents/retry`,201,{requestKey:randomUUID(),expectedCaseRevision:2,expectedSourceRevision:1,sourceSha256:hash(text)});
    const retried=await wait(retry);assert.equal(retried.native.status,'extracted');assert.equal(retried.model.status,'disabled');await original(retained.sourceId,text);
    receipt.checks.push('Canonical retry under actual current case pins remains useful after revocation controls');
    assert.equal(hash(readFileSync(textPath)),asset.sha256);assert.equal(hash(readFileSync(check.source.original.localPath)),check.source.original.sha256);
    receipt.status='passed';console.log(JSON.stringify({status:receipt.status,jobs:receipt.jobs.length,proofs:receipt.proofs.map(p=>({phase:p.phase,gates:p.gates,archive:p.archiveGates,operator:p.operatorGates})),receipt:output}));
  }catch(error){receipt.status='failed';receipt.error=error.message;throw error;}
  finally{receipt.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
