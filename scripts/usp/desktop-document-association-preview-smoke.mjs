/** Read-only API journey; run only after explicit transfer of the owned runtime. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertLocalOperatorProcess,assertUspIsolation} from './local-isolation.mjs';

const [runtime,requestFile,outputFile]=process.argv.slice(2);
assert(runtime&&requestFile&&outputFile&&process.argv.length===5,
  'Usage: desktop-document-association-preview-smoke.mjs <transferred-runtime> <exact-current-request.json> <new-receipt.json>');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const env=JSON.parse(readFileSync(join(runtime,'run.env.json'),'utf8'));
const owner=JSON.parse(readFileSync(join(runtime,'ownership.json'),'utf8'));
assert.equal(owner.project,assertUspIsolation(env).project);assertLocalOperatorProcess(env);
assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
const hash=value=>createHash('sha256').update(value).digest('hex');
const requestBytes=readFileSync(requestFile),request=JSON.parse(requestBytes.toString('utf8'));
assert.equal(request.scope,null);assert.deepEqual(request.targets,[]);
assert(request.partIds.length>=1 && request.partIds.length<=2,
  'Use one or two retained native parts from the first status page; no qualified positive target/source pair is assumed.');
const base=env.ULPIN_TEST_URL+'api/v1',path='/usp/evidence/document-association/preview';
async function call(route,status=200,body,headers={}){
  const response=await fetch(base+route,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,
    headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.length<=4*1024*1024);
  const value=JSON.parse(bytes.toString('utf8'));
  assert.equal(response.status,status,`${route}: ${response.status}/${value.error?.code??''}`);
  assert.equal(response.headers.get('cache-control'),'no-store');return value;
}
const source=request.document;
const jobPath=`/ingestion/cases/${source.caseId}/sources/${source.sourceId}/documents/jobs/${source.jobId}`;
const status=await call(jobPath);assert.equal(status.status,'completed');
assert.equal(status.resultSha256,source.resultSha256);assert.equal(status.sourceSha256,source.sourceSha256);
assert.equal(status.sourceRevision,source.sourceRevision);assert.equal(status.currentCaseRevision,source.caseRevision);
assert.equal(status.native.status,'extracted');
const expected=request.partIds.map(id=>status.parts.find(part=>part.id===id));assert(expected.every(Boolean));
const preview=await call(path,200,request);
assert.equal(preview.data.state,'needs_input');assert.deepEqual(preview.data.targets,[]);
assert.deepEqual(preview.data.document,source);
assert(preview.data.reasonCodes.includes('target_selection_unavailable'));
assert.equal(preview.data.association.state,'not_assessed');
assert.equal(preview.data.association.identifierOverlap.reasonCode,'source_key_namespace_unqualified');
assert.deepEqual(preview.data.citations.map(cite=>cite.part),expected);
for(const citation of preview.data.citations)assert.equal(hash(citation.part.text),citation.part.sha256);
const replay=await call(path,200,request);assert.deepEqual(replay.data,preview.data);
const stale=await call(path,409,{...request,document:{...source,resultSha256:'0'.repeat(64)}});
assert(stale.error);assert.equal(stale.data,undefined);
const invalid=await call(path,422,{...request,partIds:[randomUUID()]});assert.equal(invalid.data,undefined);
const denied=await call(path,403,request,{Origin:'https://unrelated.invalid'});assert.equal(denied.data,undefined);
const final=await call(jobPath);assert.equal(final.resultSha256,status.resultSha256);assert.equal(final.status,'completed');
const codePaths=['packages/contracts/src/document-association.ts','packages/contracts/src/index.ts',
  ...['document-association','document-association-authority','document-association-targets'].map(name=>`packages/server/src/modules/usp/ingestion/${name}.ts`),
  'apps/api/src/modules/evidence/document-association.controller.ts','apps/api/src/modules/evidence/evidence.module.ts'];
const record={version:'document-association-preview-runtime/1',runAt:new Date().toISOString(),project:owner.project,
  status:'passed',codeHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  codeSha256:Object.fromEntries(codePaths.map(path=>[path,hash(readFileSync(join(root,path)))])),
  requestSha256:hash(requestBytes),document:source,response:preview.data,
  controls:{statelessReplay:true,staleResultStatus:409,invalidPartStatus:422,foreignOriginStatus:403,retainedJobUnchanged:true},
  limitations:['No qualified matched building/floor source; positive association journey remains unqualified.',
    'Native citation/incomplete-target response only; no original read, extraction, provider, mutation or learning label.']};
mkdirSync(dirname(outputFile),{recursive:true});writeFileSync(outputFile,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:outputFile,sha256:hash(readFileSync(outputFile)),state:preview.data.state,citations:expected.length}));
