/** Explicitly transferred isolated runtime only. Default is private exact read-back;
 * --write submits already reviewed manual quotes, never uploads or starts services. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertLocalOperatorProcess,assertUspIsolation} from './local-isolation.mjs';

const [runtime,inputFile,outputFile,mode]=process.argv.slice(2);
assert(runtime&&inputFile&&outputFile&&[undefined,'--write'].includes(mode)&&process.argv.length===(mode?6:5),
  'Usage: desktop-document-claims-smoke.mjs <transferred-runtime> <read-or-review.json> <new-private-receipt.json> [--write]');
assert(!existsSync(outputFile),'Receipt must use a new path; existing evidence is preserved.');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert(statSync(inputFile).size<=512*1024,'Input exceeds the bounded request limit.');
const inputBytes=readFileSync(inputFile),input=JSON.parse(inputBytes.toString('utf8'));
const env=JSON.parse(readFileSync(join(runtime,'run.env.json'),'utf8'));
const ownership=JSON.parse(readFileSync(join(runtime,'ownership.json'),'utf8'));
assert.equal(ownership.project,assertUspIsolation(env).project);assertLocalOperatorProcess(env);
assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
assert(id.test(input.caseId),'Use the actual source case UUID.');
const base=new URL('api/v1/',env.ULPIN_TEST_URL).href;
async function bytes(response,limit){
  const length=response.headers.get('content-length');
  if(length!==null)assert(/^\d+$/.test(length)&&Number(length)<=limit,'Response exceeds the complete byte limit.');
  const reader=response.body?.getReader();assert(reader,'Missing response body.');
  const chunks=[];let total=0;
  try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;
    assert(total<=limit,'Response exceeded its byte limit; nothing was truncated.');chunks.push(Buffer.from(part.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks,total);
}
async function call(path,{status=200,body,headers={},binary=false,limit=768*1024}={}){
  const response=await fetch(base+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,
    headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(95000)});
  const data=await bytes(response,limit),value=binary?data:JSON.parse(data.toString('utf8'));
  assert.equal(response.status,status,`${path}: ${response.status}/${value.error?.code??''}`);
  assert(response.headers.get('cache-control')?.includes(binary?'private':'no-store'),
    binary?'Original download must remain private.':'Private review operation must disable caching.');
  return value;
}
function snapshot(value){
  const {currentCaseRevision,snapshotSha256,...immutable}=value;
  assert.equal(value.version,'source-document-review/1');assert(id.test(value.reviewId));
  assert(Number.isSafeInteger(value.reviewRevision)&&value.reviewRevision>0);
  assert.equal(value.caseId,input.caseId);assert.equal(value.method,'human_entry');
  assert.equal(value.quotationVerification,'not_machine_verified');assert.equal(value.canonicalMatchState,'not_assessed');
  assert.equal(value.qualification,'not_assessed');assert.equal(value.review.actor,env.ULPIN_LOCAL_OPERATOR_SUBJECT);
  assert.equal(value.review.attribution,'local_process');assert.equal(value.review.humanAuthenticated,false);
  assert.equal(value.review.independentGroundTruth,false);
  assert.deepEqual(value.unresolved,['approval','current_drawing_revision','canonical_building','canonical_floor','horizontal_reference','vertical_reference']);
  assert(value.sources.length>=1&&value.sources.length<=2&&value.claims.length>=1&&value.claims.length<=25);
  assert.deepEqual(value.claims.map(claim=>claim.ordinal),value.claims.map((_,i)=>i));
  assert(value.claims.every(claim=>id.test(claim.claimId)&&claim.quote.length>=1&&claim.quote.length<=4096));
  for(const conflict of value.conflicts){assert.equal(conflict.state,'unresolved');
    assert(conflict.claimIds.length>=2&&conflict.claimIds.every(id=>value.claims.some(claim=>claim.claimId===id)));}
  // Server fingerprint uses recursively sorted object keys; preserve every value.
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'
    ?Object.fromEntries(Object.keys(v).sort((a,b)=>a.localeCompare(b)).map(key=>[key,stable(v[key])])):v;
  assert.equal(hash(JSON.stringify(stable(immutable))),snapshotSha256);
  assert(Number.isSafeInteger(currentCaseRevision));return immutable;
}
const route=`ingestion/cases/${input.caseId}/document-claims/reviews`;
let result,failure;const controls={};let stage='review';
try{
if(mode==='--write'){
  assert.deepEqual(Object.keys(input).sort(),['caseId','review']);
  assert(id.test(input.review.requestKey));assert(typeof input.review.reviewReason==='string'&&input.review.reviewReason.trim());
  assert(Number.isSafeInteger(input.review.expectedCaseRevision));
  assert(input.review.sources.length>=1&&input.review.sources.length<=2);
  assert(input.review.claims.length>=1&&input.review.claims.length<=25);
  assert(!('actor' in input.review),'The server supplies process attribution.');
  result=await call(route,{status:201,body:input.review});snapshot(result);
  assert.deepEqual(result.claims.map(({sourceId,kind,quote,locator})=>({sourceId,kind,quote,
    locator:Object.fromEntries(Object.entries(locator).filter(([key])=>key!=='pageFrame'))})),input.review.claims);
  assert.deepEqual(result.sources.map(({sourceBytes,...pin})=>pin),input.review.sources);
  assert.deepEqual(snapshot(await call(route,{status:201,body:input.review})),snapshot(result));controls.idempotentReplay=true;
  const changedReason=input.review.reviewReason==='Changed replay payload control'?'Other replay payload control':'Changed replay payload control';
  const stale=await call(route,{status:409,body:{...input.review,reviewReason:changedReason}});
  assert(stale.error&&!stale.claims);controls.changedPayloadStatus=409;
}else{
  assert.deepEqual(Object.keys(input).sort(),['caseId','reviewId','revision']);
  assert(id.test(input.reviewId)&&Number.isSafeInteger(input.revision)&&input.revision>0);
  result=await call(`${route}/${input.reviewId}?revision=${input.revision}`);snapshot(result);
}
const exact=`${route}/${result.reviewId}?revision=${result.reviewRevision}`;
stage='exact_revision_read';
assert.deepEqual(snapshot(await call(exact)),snapshot(result));controls.exactRevisionRead=true;
stage='original_verification';
for(const source of result.sources){
  const original=await call(`sources/${source.sourceId}/file`,{binary:true,limit:16*1024**2});
  assert.equal(original.length,source.sourceBytes);assert.equal(hash(original),source.sourceSha256);
}
controls.unchangedOriginals=true;
stage='private_access_control';
const denied=await call(exact,{status:403,headers:{Origin:'https://unrelated.invalid'}});
assert(denied.error&&!denied.claims);controls.foreignOriginStatus=403;
}catch(error){failure={stage,code:typeof error?.code==='string'?error.code:'RUN_FAILED',
  message:String(error?.message??error).slice(0,1024)};process.exitCode=1;}
const codePaths=['packages/contracts/src/usp/document-claims.ts','packages/server/src/modules/usp/ingestion/document-claims.ts',
  'apps/api/src/modules/ingestion/document-claims.controller.ts','apps/api/src/modules/ingestion/ingestion.module.ts'];
const receipt={version:'document-claims-smoke/1',runAt:new Date().toISOString(),project:ownership.project,
  mode:mode==='--write'?'explicit_manual_review':'exact_read_back',status:failure?(result?'partial':'failed'):'passed',
  runnerCheckoutHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  runtimeOwnershipSha256:hash(readFileSync(join(runtime,'ownership.json'))),
  codeSha256:Object.fromEntries(codePaths.map(path=>[path,hash(readFileSync(join(root,path)))])),
  inputSha256:hash(inputBytes),review:result??null,controls,failure:failure??null,
  limitations:['API persistence and exact manual quotation/locator retention only; quote text is not machine verified.',
    'Local process attribution is not authenticated human review or independent learning ground truth.',
    'Approval/current drawing revision/canonical target/placement/rights/accuracy remain unqualified.',
    'No source upload, extraction, OCR/provider/model, service startup or physical geometry write occurs in this runner.',
    'Runtime owner must pair this receipt with the actually served revision; runner checkout hashes alone do not establish it.']};
mkdirSync(dirname(outputFile),{recursive:true});writeFileSync(outputFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:resolve(outputFile),sha256:hash(readFileSync(outputFile)),status:receipt.status,
  reviewId:result?.reviewId??null,revision:result?.reviewRevision??null,claims:result?.claims?.length??0,
  conflicts:result?.conflicts?.length??0,failureStage:failure?.stage??null}));
