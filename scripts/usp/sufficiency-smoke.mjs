/** One owned real-source API journey; no mapping/geometry/rights is invented. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {assertUspIsolation,assertLocalOperatorProcess} from './local-isolation.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex'),root=process.cwd();
const dir=realpathSync(process.argv[2]);assert(dir.startsWith(realpathSync(resolve('.runtime/run01'))+'/'));
const env=JSON.parse(readFileSync(join(dir,'run.env.json'))),owner=JSON.parse(readFileSync(join(dir,'ownership.json')));
const scope=assertUspIsolation(env);assertLocalOperatorProcess(env);assert.equal(owner.checkout,root);assert.equal(owner.project,scope.project);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),owner.baseCommit);
assert(!env.ULPIN_MODEL_GATEWAY_ENABLED&&!env.ULPIN_MODEL_GATEWAY_CONFIG);
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:1});
const receipt={version:'ingest-04a-mvp/1',status:'running',codeCommit:owner.baseCommit,nonce:owner.nonce,checks:[],sources:[],at:new Date().toISOString()};
const continuation=process.argv[3]==='--continue';
const file=join(dir,'sufficiency-smoke.json'),base=env.ULPIN_TEST_URL+'api/v1';
async function call(path,status=200,body){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:undefined,
    body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const value=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(value)}`);return value;
}
const createCase=name=>call('/source-cases',201,{requestKey:randomUUID(),name});
try{
  const bytes=readFileSync('fixtures/real-nyc/original.geojson'),provenance=JSON.parse(readFileSync('fixtures/real-nyc/provenance.json'));
  assert.equal(hash(bytes),provenance.originalSha256);
  let c,source;
  if(continuation){
    const failure=readFileSync(file);writeFileSync(join(dir,'sufficiency-smoke-initial-failure.json'),failure);receipt.initialFailureSha256=hash(failure);
    const rows=(await pool.query("SELECT c.id,s.id source_id FROM cases c JOIN sources s ON s.case_id=c.id WHERE c.name=$1 AND s.sha256=$2",['NYC official footprint sufficiency',hash(bytes)])).rows;assert.equal(rows.length,1);
    c={caseId:rows[0].id};source={sourceId:rows[0].source_id};
    const needs=await call(`/ingestion/cases/${c.caseId}/needs-input`);assert.equal(needs.questions.length,0);assert(needs.decisions.some(d=>d.task==='building_massing'&&d.outcome==='park'));
  }else{
  c=await createCase('NYC official footprint sufficiency');const path=`/ingestion/cases/${c.caseId}`;
  const form=new FormData();form.set('file',new Blob([bytes]),'original.geojson');form.set('requestKey',randomUUID());form.set('expectedWorkspaceRevision','0');form.set('format','geojson');
  const profile=await call(path+'/sources',201,form);source=profile.source;const request={requestKey:randomUUID(),expectedCaseRevision:profile.workspaceRevision,
    expectedSourceRevision:source.sourceRevision,sourceSha256:source.sourceSha256,tasks:['retain_evidence','building_massing']};
  const url=path+`/sources/${source.sourceId}/sufficiency`,result=await call(url,200,request);
  assert.equal(result.decisions[0].outcome,'complete');assert.equal(result.decisions[1].outcome,'ask');assert.equal(result.questions.length,1);
  assert(result.decisions[1].evidence.some(e=>e.requirement==='reliable_height'&&e.state==='present_unqualified'));
  assert.deepEqual(await call(url,200,request),result);
  // Two concurrent evaluations of the same evidence class must reuse one question.
  const concurrent=await Promise.all([0,1].map(()=>call(url,200,{...request,requestKey:randomUUID()})));
  assert(concurrent.every(r=>r.questions.length===1&&r.questions[0].id===result.questions[0].id));
  const q=result.questions[0],answer={requestKey:randomUUID(),expectedQuestionRevision:q.revision,pins:q.pins,answer:{choice:'not_sure'}};
  const parked=await call(path+`/questions/${q.id}/answers`,200,answer);assert.equal(parked.state,'parked');
  assert.deepEqual(await call(path+`/questions/${q.id}/answers`,200,answer),parked);
  const again=await call(url,200,{...request,requestKey:randomUUID()});assert.equal(again.decisions[1].outcome,'park');assert.equal(again.questions[0].id,q.id);
  const needs=await call(path+'/needs-input');assert.equal(needs.questions.length,0);assert(needs.decisions.some(d=>d.task==='building_massing'&&d.outcome==='park'));
  }
  const path=`/ingestion/cases/${c.caseId}`;
  const count=(await pool.query('SELECT count(*)::int n FROM usp_ingestion_questions WHERE case_id=$1',[c.caseId])).rows[0].n;assert.equal(count,1);
  await pool.query('UPDATE cases SET archived=true WHERE id=$1',[c.caseId]);
  try{const denied=await call(path+'/needs-input',403);assert.equal(denied.error.code,'SUFFICIENCY_DENIED');}finally{await pool.query('UPDATE cases SET archived=false WHERE id=$1',[c.caseId]);}
  const original=await fetch(base+`/sources/${source.sourceId}/file`);assert.equal(original.status,200);assert.equal(hash(Buffer.from(await original.arrayBuffer())),hash(bytes));
  receipt.sources.push({caseId:c.caseId,sourceId:source.sourceId,sha256:hash(bytes),bytes:bytes.length,url:provenance.originalDownload});
  receipt.checks.push('Original retention, task decision, one unqualified-height question, concurrent class deduplication, idempotent replay, Not sure persistence, needs-input, archive denial and exact original');
  const sourceCheck=JSON.parse(readFileSync('docs/evidence/usp/nest-migration/official-runtime-source/source-check.json'));
  const pdf=readFileSync(sourceCheck.source.original.localPath);assert.equal(hash(pdf),sourceCheck.source.original.sha256);
  const pc=await createCase('USGS unchanged scanned evidence sufficiency'),pf=new FormData();pf.set('file',new Blob([pdf],{type:'application/pdf'}),'usgs-original.pdf');pf.set('requestKey',randomUUID());pf.set('expectedCaseRevision','0');pf.set('mode','native_only');
  const retained=await call(`/ingestion/cases/${pc.caseId}/documents`,201,pf),pp=`/ingestion/cases/${pc.caseId}/sources/${retained.sourceId}`;
  const pr={requestKey:randomUUID(),expectedCaseRevision:retained.caseRevision,expectedSourceRevision:retained.sourceRevision,sourceSha256:retained.sourceSha256,tasks:['building_massing']};
  const pending=await call(pp+'/sufficiency',200,pr);assert.equal(pending.questions.length,0);assert.equal(pending.decisions[0].outcome,'park');
  let status;const deadline=Date.now()+30000;
  do{status=await call(pp+`/documents/jobs/${retained.jobId}`);if(['completed','failed','stale'].includes(status.status))break;await new Promise(r=>setTimeout(r,500));}while(Date.now()<deadline);
  assert.equal(status.status,'completed');assert.equal(status.native.status,'needs_ocr');
  const incomplete=await call(pp+'/sufficiency',200,{...pr,requestKey:randomUUID()});assert.equal(incomplete.questions.length,0);
  assert.equal(incomplete.decisions[0].outcome,'park');assert.equal(incomplete.decisions[0].nextAction,'run_ocr');assert.equal(incomplete.decisions[0].processing.nativeStatus,'needs_ocr');
  if(pending.decisions[0].processing.state==='needs_ocr')assert.deepEqual(await call(pp+'/sufficiency',200,pr),pending);
  else await call(pp+'/sufficiency',409,pr);
  // If the worker completed after evaluation, old current-pin replay must deny.
  // A completion before evaluation instead leaves the identical receipt current.
  receipt.sources.push({caseId:pc.caseId,sourceId:retained.sourceId,sha256:hash(pdf),bytes:pdf.length,jobId:retained.jobId});
  receipt.checks.push('Naturally scanned official PDF: extraction/capability state parks with run_ocr and zero missing-fact questions');
  receipt.status='passed';receipt.completedAt=new Date().toISOString();
}catch(error){receipt.status='failed';receipt.error=error.message;process.exitCode=1;}
finally{await pool.end();receipt.harnessSha256=hash(readFileSync(new URL(import.meta.url)));writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,checks:receipt.checks,error:receipt.error}));}
