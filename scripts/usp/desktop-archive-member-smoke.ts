/** One retained NYC ZIP journey, with private source/access/publication controls. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';
import {assertLocalOperatorProcess,assertUspIsolation} from './local-isolation.mjs';

const [runtime,priorPath,output]=process.argv.slice(2);assert(runtime&&priorPath&&output&&process.argv.length===5);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const env=JSON.parse(readFileSync(join(runtime,'run.env.json'),'utf8'));
const owner=JSON.parse(readFileSync(join(runtime,'ownership.json'),'utf8'));
assert.equal(owner.project,assertUspIsolation(env).project);assertLocalOperatorProcess(env);
assert.equal(env.ULPIN_MODEL_GATEWAY_ENABLED,'0');
Object.assign(process.env,env,{ULPIN_FIXTURE_ROOT:join(root,'fixtures')});
const {pool,closePool,transaction}=await import('../../packages/server/src/infrastructure/db');
const {DocumentIngestionService,assertDocumentAcceptedResultTx}=await import('../../packages/server/src/modules/usp/ingestion/documents');
const {assertDocumentInputTx}=await import('../../packages/server/src/modules/usp/ingestion/document-context');
const {DocumentInputSchema,DocumentResultSchema}=await import('../../packages/contracts/src/usp/document-ingestion');
const {acceptUspJobAttempt}=await import('../../packages/server/src/modules/usp/jobs');
const {readDocumentResult}=await import('../../packages/server/src/modules/usp/ingestion/documents');
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const prior=JSON.parse(readFileSync(priorPath,'utf8'));
const source=prior.results.find((row:any)=>row.kind==='nyc_local_assembly');assert(source);
const originalPath='E:/BhuAayam-data/task-data/nyc-zcta-10013-context/nyc-10013-official-context.zip';
const original=readFileSync(originalPath);
assert.equal(hash(original),'ec691b929143f520cbf8b427bc071877030c045a035fd99697cdcf231d542111');
assert.equal(hash(original),source.sha256);assert.equal(original.length,source.bytes);
const selected={ordinal:24,memberSha256:'107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e',memberBytes:1103282};
const script={ordinal:2,memberSha256:'af65d82bc0c574e2ff46bbba5d273b934589909e10a29b6fe44c163938465f0a',memberBytes:2430};
const member=unzipSync(original)['nyc-10013-official-context/layers/buildings-original.geojson'];
assert.equal(hash(member),selected.memberSha256);assert.equal(member.length,selected.memberBytes);
const base=env.ULPIN_TEST_URL+'api/v1',jobPath=(r:any)=>`/ingestion/cases/${r.caseId}/sources/${r.sourceId}/documents/jobs/${r.jobId}`;
async function call(path:string,status=200,body?:unknown){
  const response=await fetch(base+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,
    headers:body?{'Content-Type':'application/json'}:undefined,signal:AbortSignal.timeout(60000)});
  const value=await response.json();assert.equal(response.status,status,`${path}: ${response.status}/${value.error?.code??''}`);return value;
}
async function wait(r:any,expected:string){
  const until=Date.now()+115000;let result;
  do{result=await call(jobPath(r));if(['completed','failed','stale'].includes(result.status))break;
    await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<until);
  assert.equal(result.status,expected,`${result.status}/${result.code}`);return result;
}
try{
  const current=(await pool().query(`SELECT c.revision,s.revision source_revision,s.sha256,s.inspection FROM cases c
    JOIN sources s ON s.case_id=c.id WHERE c.id=$1 AND s.id=$2`,[source.caseId,source.sourceId])).rows[0];
  assert(current);assert.equal(current.sha256,source.sha256);
  assert.equal(current.inspection.documentOriginal.subject,env.ULPIN_LOCAL_OPERATOR_SUBJECT);
  const retryPath=`/ingestion/cases/${source.caseId}/sources/${source.sourceId}/documents/retry`;
  const request=(archiveSelection:typeof selected)=>({requestKey:randomUUID(),expectedCaseRevision:current.revision,
    expectedSourceRevision:current.source_revision,sourceSha256:source.sha256,mode:'native_only',archiveSelection});
  const wrong=await call(retryPath,201,request({...selected,memberSha256:'0'.repeat(64)}));
  const wrongStatus=await wait(wrong,'failed');assert.equal(wrongStatus.code,'ARCHIVE_MEMBER_REFERENCE_MISMATCH');
  assert.equal(wrongStatus.archiveInspection,null);
  const denied=await call(retryPath,201,request(script));
  const deniedStatus=await wait(denied,'failed');assert.equal(deniedStatus.code,'ARCHIVE_MEMBER_SCRIPT_INERT');
  const pinned=request(selected),accepted=await call(retryPath,201,pinned),status=await wait(accepted,'completed');
  assert.deepEqual(await call(retryPath,201,pinned),accepted);
  await call(retryPath,409,{...pinned,archiveSelection:script});
  await call(retryPath,409,{...request(selected),expectedSourceRevision:current.source_revision+1});
  await call(retryPath,422,{...request(selected),ocrSelection:{page:1}});
  assert.equal(status.native.format,'archive');assert.equal(status.native.status,'unsupported');
  assert.equal(status.model.status,'not_requested');assert.deepEqual(status.parts,[]);assert.equal(status.ocr,null);
  assert(status.archiveInspection);assert.equal(status.archiveInspection.lineage.outerSha256,source.sha256);
  assert.equal(status.archiveInspection.lineage.ordinal,24);
  const independentResponse=await fetch(env.GEO_URL+'/internal/area/inspect-gis',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.GEO_SERVICE_TOKEN}`},
    body:JSON.stringify({base64:Buffer.from(member).toString('base64')}),signal:AbortSignal.timeout(60000)});
  assert.equal(independentResponse.status,200);const independent=await independentResponse.json();
  assert.deepEqual(status.archiveInspection.inspection,independent);
  const originalResponse=await fetch(`${base}/sources/${source.sourceId}/file`,{signal:AbortSignal.timeout(60000)});
  assert.equal(originalResponse.status,200);const downloaded=Buffer.from(await originalResponse.arrayBuffer());
  assert.equal(hash(downloaded),hash(original));assert.equal(downloaded.length,original.length);
  const other=prior.results.find((row:any)=>row.caseId!==source.caseId);assert(other);
  await call(`/ingestion/cases/${other.caseId}/sources/${source.sourceId}/documents/jobs/${accepted.jobId}`,404);
  const service=new DocumentIngestionService(),subject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  try{
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='document-access-denial-control';
    await assert.rejects(()=>service.status(source.caseId,source.sourceId,accepted.jobId),(e:any)=>e.status===403);
    await assert.rejects(()=>service.original(source.caseId,source.sourceId),(e:any)=>e.status===403);
  }finally{process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;}
  const row=(await pool().query(`SELECT j.payload,m.result_ref,a.* FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id
    JOIN usp_job_attempts a ON a.job_id=j.id AND a.state='accepted' WHERE j.id=$1`,[accepted.jobId])).rows[0];assert(row);
  const input=DocumentInputSchema.parse(row.payload),result=await readDocumentResult(input,row.result_ref.sha256);
  assert(DocumentResultSchema.safeParse(result).success);
  assert(!DocumentResultSchema.safeParse({...result,archiveInspection:{...result.archiveInspection,
    lineage:{...result.archiveInspection!.lineage,ordinal:2}}}).success);
  await assert.rejects(()=>transaction(client=>assertDocumentInputTx(client,{...input,archiveSelection:script})),(e:any)=>e.status===409);
  const client=await pool().connect();
  try{
    await client.query('BEGIN');await client.query('UPDATE cases SET revision=revision+1 WHERE id=$1',[source.caseId]);
    await assert.rejects(()=>assertDocumentInputTx(client,input),(e:any)=>e.status===409);
  }finally{await client.query('ROLLBACK');client.release();}
  const fenceClient=await pool().connect();
  try{
    await fenceClient.query('BEGIN');
    await fenceClient.query('UPDATE usp_job_metadata SET accepted_fence=accepted_fence+1 WHERE job_id=$1',[accepted.jobId]);
    await assert.rejects(()=>assertDocumentAcceptedResultTx(fenceClient,input,row.result_ref.sha256),(e:any)=>e.status===409);
  }finally{await fenceClient.query('ROLLBACK');fenceClient.release();}
  let validated=false;
  await assert.rejects(()=>acceptUspJobAttempt({jobId:accepted.jobId,number:row.number,fence:Number(row.fence)+1,
    owner:row.owner,leaseUntil:new Date(row.lease_until).toISOString(),inputSha256:row.input_sha256},row.result_ref,
    async()=>{validated=true;}),(e:any)=>e.status===409);assert.equal(validated,false);
  assert.equal((await call(jobPath(accepted))).status,'completed');
  const codePaths=['packages/contracts/src/usp/document-ingestion.ts','packages/server/src/modules/areas/areas.ts',
    ...['document-native','document-context','document-worker','documents','document-archive'].map(name=>`packages/server/src/modules/usp/ingestion/${name}.ts`),
    'apps/api/src/modules/ingestion/documents.controller.ts','services/geo/geo/api.py',
    ...['native_archive','native_archive_member','archive_member_inspection','gis_inspection','native_gis','area'].map(name=>`services/geo/geo/${name}.py`)];
  mkdirSync(dirname(output),{recursive:true});
  const receipt={version:'private-archive-member-api/1',status:'passed',runAt:new Date().toISOString(),project:owner.project,
    codeHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),uncommittedCode:true,
    codeSha256:Object.fromEntries(codePaths.map(path=>[path,hash(readFileSync(join(root,path)))])),
    original:{sha256:source.sha256,bytes:original.length,caseId:source.caseId,sourceId:source.sourceId,geography:'NYC, United States; test_only',
      originKind:'retained_local_assembly',manifestSha256:hash(readFileSync(join(dirname(originalPath),'manifest.json')))},
    selected:{...selected,jobId:accepted.jobId,resultSha256:status.resultSha256,readerSha256:input.readerSha256,
      archiveInspection:status.archiveInspection},independent,independentExactMatch:true,originalExactMatch:true,
    denial:{jobId:denied.jobId,code:deniedStatus.code},wrongPin:{jobId:wrong.jobId,code:wrongStatus.code},
    controls:['replay returns same job','request key with changed selection denied','wrong source revision denied','OCR coexistence denied',
      'cross-case status 404','subject status/original 403','changed selection rejected by current input fence',
      'rolled-back parent revision drift rejected','rolled-back accepted fence drift rejected','superseded publication rejected before validator'],
    modelGateway:'disabled',limits:{outerBytes:10*1024*1024,memberBytes:8*1024*1024,members:256,expandedBytes:30*1024*1024,
      memberReaderSeconds:15,processorTimeoutSeconds:60,jobDeadlineSeconds:120,resultBytes:4*1024*1024}};
  writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({receipt:output,sha256:hash(readFileSync(output)),jobId:accepted.jobId,
    resultSha256:status.resultSha256,featureCount:independent.featureCount,quarantine:independent.quarantine}));
}finally{await closePool();}
