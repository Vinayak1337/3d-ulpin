/** Memory-only service query controls. Actual retained case/source/job IDs and
 * unchanged official text; protocol context/state is not a retained DB snapshot.
 * No database, object store, processor, geometry, rights or provider is created. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import type {ImportPackage} from '@ulpin/contracts';
import type {PoolClient} from 'pg';
import {sourceWorkspaceForCase,createSourceWorkspace} from '../../packages/server/src/modules/cases/source-workspaces';
import {getPackage,areaContext,rebasePackage,answerQuestion,createPackageCorrection,commitPackage} from '../../packages/server/src/modules/areas/areas';
import {appendPreparationFacts} from '../../packages/server/src/modules/officer/officer-preparation';
import {readPreparationBuild} from '../../packages/server/src/modules/cases/preparation-continuation';
import {fingerprint} from '../../packages/server/src/modules/cases/domain';
import {documentInput} from '../../packages/server/src/modules/usp/ingestion/document-context';
import {ingestionBinding} from '../../packages/server/src/modules/usp/ingestion/events';
import {mvtCodeSha} from '../../packages/server/src/modules/usp/tiles/compiler';
import {sha256} from '../../packages/server/src/infrastructure/storage';

const [completionPath,envPath,outputPath]=process.argv.slice(2);
assert(completionPath&&envPath&&outputPath,'Provide the retained completion receipt, attribution env and output paths.');
const completion=JSON.parse(readFileSync(completionPath,'utf8'));
const prior=JSON.parse(readFileSync('docs/evidence/usp/document-authority-correction.json','utf8'));
const owner=JSON.parse(readFileSync(envPath,'utf8')).ULPIN_LOCAL_OPERATOR_SUBJECT;
const originalSubject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=owner;
const text=readFileSync('fixtures/real-area/evidence/nyc-building-metadata.md','utf8');
assert.equal(sha256(text),prior.runtime.sources[0].sha256);
const {caseId}=completion, job=completion.jobs.at(-1), sourceId=job.sourceId;
const otherId=completion.jobs[1].sourceId;
const workspaceInput={requestKey:job.jobId,caseId,areaId:caseId,expectedAreaRevision:0,name:'Retained source authority protocol',worldStatus:'observed'};
const current={id:caseId,revision:0,archived:false,frame:null,context:null,site_id:null};
const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,sha256:sha256(text),bytes:Buffer.byteLength(text),object_key:`memory-only/${sourceId}`,
  inspection:{documentOriginal:{version:'source-document/1',subject:owner,format:'text',sha256:sha256(text),bytes:Buffer.byteLength(text),receivedAt:prior.recordedAt},
    documentAccepted:{jobId:job.jobId,sha256:job.resultSha256}}};
// State/context are deliberately protocol controls, with no placement or facts.
const input=documentInput({current,source,binding:ingestionBinding(caseId),context:fingerprint({frame:null,context:null,siteId:null}),latest:true} as any,job.jobId,'native_only');
const accepted={id:job.jobId,payload:input,status:'succeeded',logical_state:'succeeded',input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),result_ref:{sha256:job.resultSha256}};
const part={id:job.jobId,sourceRevisionId:sourceId,locator:'unchanged official text',text,entityIds:[]};
const base={id:job.jobId,areaId:caseId,revision:1,state:'RECEIVED',schemaVersion:'ulpin-canonical/2',name:workspaceInput.name,
  datasetNamespace:`source-workspace:${fingerprint(workspaceInput)}`,sourceRevisionIds:[sourceId],parts:[part],features:[],questions:[],factCandidates:[],warnings:[],
  createdAt:prior.recordedAt,sourceWorkspace:{caseId}} as unknown as ImportPackage;
type Control={pkg:ImportPackage;rows:any[];context:typeof current;subject:string};
const marked=():Control=>({pkg:structuredClone(base),rows:[structuredClone(source)],context:{...current},subject:owner});
const legacy=():Control=>{const c=marked();c.rows[0].inspection={};return c;};
const copiedPart=()=>{const c=marked();c.pkg.sourceRevisionIds=[otherId];c.pkg.parts=[{...part,sourceRevisionId:otherId,copiedFrom:{sourceRevisionId:sourceId}} as any];
  c.rows.push({id:otherId,inspection:{}});return c;};
const copiedSource=()=>{const c=marked();c.pkg.sourceRevisionIds=[otherId];c.pkg.parts=[{...part,sourceRevisionId:otherId}];
  // Memory-only lineage envelope, not a claim that this copy was persisted.
  c.rows.push({...source,id:otherId,inspection:{copiedFrom:{caseId,sourceRevisionId:sourceId,sourceHash:source.sha256,sourceRevision:1}}});return c;};
let control:Control, calls:{sql:string;client:number}[]=[], nextClient=0, revokeBeforeSave=false;
const packageWrites=()=>calls.filter(c=>/^(UPDATE import_packages|INSERT INTO import_package)/.test(c.sql));
function response(sql:string,values:unknown[]=[],client=0){
  sql=sql.replace(/\s+/g,' ').trim();calls.push({sql,client});let rows:any[]=[];
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory_xact_lock')){}
  else if(sql.startsWith('INSERT INTO map_areas')){}
  else if(sql.startsWith('UPDATE import_packages')||sql.startsWith('INSERT INTO import_package_revisions')){}
  else if(sql.startsWith('SELECT id FROM map_areas')){rows=[{id:caseId}];if(revokeBeforeSave)control.context.archived=true;}
  else if(sql.includes('FROM map_areas a WHERE'))rows=[{id:caseId,site_id:null,name:'Protocol context only',revision:0,reference:null}];
  else if(sql.includes('FROM import_packages'))rows=[{body:control.pkg,case_id:caseId}];
  else if(sql.startsWith('SELECT * FROM sources WHERE id=ANY'))rows=control.rows.filter(s=>(values[0] as string[]).includes(s.id));
  else if(sql.startsWith('SELECT * FROM sources WHERE id='))rows=control.rows.filter(s=>s.id===values[0]);
  else if(sql.startsWith('SELECT * FROM sources WHERE case_id='))rows=control.rows.filter(s=>s.id===values[1]&&s.case_id===values[0]);
  else if(sql.startsWith('SELECT max(revision) revision FROM sources'))rows=[{revision:1}];
  else if(sql.startsWith('SELECT id,revision,archived,frame,context,site_id FROM cases')||sql.startsWith('SELECT archived FROM cases'))rows=[control.context];
  else if(sql.startsWith('SELECT j.*,m.input_sha256'))rows=[accepted];
  else if(sql.includes('FROM physical_features')||sql.includes('FROM area_check_runs')||sql.includes('FROM property_associations')||sql.includes('FROM external_identifiers')||sql.includes('FROM scene_asset_bindings')){}
  else throw new Error(`Unexpected protocol query: ${sql}`);
  return Promise.resolve({rows,rowCount:rows.length});
}
const previousPool=(globalThis as any).ulpinPool;
(globalThis as any).ulpinPool={query:(sql:string,values:unknown[])=>response(sql,values),connect:async()=>{
  const id=++nextClient;return {query:(sql:string,values:unknown[])=>response(sql,values,id),release(){}};
}};
const outcomes:any[]=[];
function install(c:Control){control=c;calls=[];revokeBeforeSave=false;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=c.subject;}
function invariant(before:string){
  assert.equal(fingerprint(control.pkg),before,'Denied retained body was changed');
  assert.equal(packageWrites().length,0,'Denied body reached a package write');
  const read=calls.find(c=>c.sql.includes('FROM import_packages'));
  assert(read&&read.client>0,'Retained body read must use a transaction client');
  assert(calls.some(c=>c.sql.includes('FROM sources')&&c.client===read.client),'Read bypassed source authority or used a different client');
  assert(!calls.some(c=>c.sql.includes('FROM cases')&&/FOR (UPDATE|SHARE)/.test(c.sql)),'Guard added an inverse case lock');
}
const entrypoints={
  rawWorkspace:()=>sourceWorkspaceForCase(caseId),
  workspaceReplay:()=>createSourceWorkspace(workspaceInput),
  areaContext:()=>areaContext(caseId),
  getPackage:()=>getPackage(job.jobId),
  lockedRebase:()=>rebasePackage(job.jobId,1),
  lockedAnswer:()=>answerQuestion(job.jobId,1,job.jobId,{choice:'not_sure'} as any),
  correctionReplay:()=>createPackageCorrection(job.jobId,job.jobId),
  lockedCommit:()=>commitPackage(job.jobId,1,'protocol'),
  lockedPreparation:()=>appendPreparationFacts(job.jobId,1,[]),
};
try{
  const controls:[string,()=>Control,number,string][]=[
    ['marked',marked,409,'DOCUMENT_STAGED_PACKAGE_PARTS'],
    ['mixed',()=>{const c=marked();c.pkg.sourceRevisionIds.push(otherId);c.rows.push({id:otherId,inspection:{}});return c;},409,'DOCUMENT_STAGED_PACKAGE_PARTS'],
    ['copiedPart',copiedPart,409,'DOCUMENT_STAGED_PACKAGE_PARTS'],
    ['copiedSource',copiedSource,409,'DOCUMENT_STAGED_PACKAGE_PARTS'],
    ['archived',()=>{const c=marked();c.pkg.parts=[];c.context.archived=true;return c;},403,'DOCUMENT_DENIED'],
    ['operatorRevoked',()=>{const c=marked();c.pkg.parts=[];c.subject=`revoked:${caseId}`;return c;},403,'DOCUMENT_DENIED'],
    ['staleAccepted',()=>{const c=marked();c.pkg.parts=[];c.context.revision++;return c;},409,'STALE_REVISION'],
    ['missingSource',()=>{const c=marked();c.rows=[];return c;},403,'DOCUMENT_DENIED'],
  ];
  for(const [state,make,status,code] of controls)for(const [entry,action] of Object.entries(entrypoints)){
    install(make());const before=fingerprint(control.pkg);
    await assert.rejects(action,(e:any)=>e.status===status&&e.code===code,`${entry}/${state}`);
    // Missing sources also fail closed at the same client's source query.
    invariant(before);outcomes.push({entry,state,status,code,packageWrites:0});
  }
  install(marked());const before=fingerprint(control.pkg);
  const client=await (globalThis as any).ulpinPool.connect();
  await assert.rejects(()=>readPreparationBuild(client as PoolClient,job.jobId),(e:any)=>e.code==='DOCUMENT_STAGED_PACKAGE_PARTS');
  invariant(before);outcomes.push({entry:'preparationContinuation',state:'marked',status:409,packageWrites:0});
  for(const entry of ['rawWorkspace','workspaceReplay','getPackage','correctionReplay'] as const){
    install(legacy());const before=fingerprint(control.pkg),result=await entrypoints[entry]();
    assert.equal(result,control.pkg);assert.equal(fingerprint(result),before);assert.equal(result.parts[0].text,text);
    assert.equal(packageWrites().length,0);outcomes.push({entry,state:'unmarked',unchanged:true});
  }
  install(legacy());const context=await areaContext(caseId);assert.equal(context.packages[0],control.pkg);assert.equal(context.packages[0].parts[0].text,text);
  outcomes.push({entry:'areaContext',state:'unmarked',unchanged:true});
  for(const entry of ['lockedRebase','lockedPreparation'] as const){
    install(legacy());const result=await entrypoints[entry]();assert.equal(result,control.pkg);assert.equal(result.revision,2);assert.equal(result.parts[0].text,text);
    assert.equal(packageWrites().length,2);assert.equal(calls.filter(c=>c.sql.startsWith('SELECT * FROM sources WHERE id=ANY')).length,2,'Writer must recheck before saving');
    outcomes.push({entry,state:'unmarked',nativeTextUnchanged:true,packageWrites:2});
  }
  // Membership-only canonical workspaces remain readable when their pins hold.
  install(marked());control.pkg.parts=[];assert.equal(await sourceWorkspaceForCase(caseId),control.pkg);
  outcomes.push({entry:'rawWorkspace',state:'currentCanonicalMembership',unchanged:true});
  // Revoke after the locked read, before the write: the final save guard must deny.
  install(marked());control.pkg.parts=[];revokeBeforeSave=true;
  await assert.rejects(()=>rebasePackage(job.jobId,1),(e:any)=>e.status===403&&e.code==='DOCUMENT_DENIED');
  assert.equal(packageWrites().length,0);
  assert.equal(calls.filter(c=>c.sql.startsWith('SELECT * FROM sources WHERE id=ANY')).length,2);
  outcomes.push({entry:'lockedRebase',state:'revokedBeforeSave',status:403,code:'DOCUMENT_DENIED',packageWrites:0});
  const receipt={version:'document-package-authority-proof/1',status:'passed',recordedAt:new Date().toISOString(),
    codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),harnessSha256:sha256(readFileSync(import.meta.filename)),
    source:{sha256:sha256(text),bytes:Buffer.byteLength(text),sourceId,caseId,jobId:job.jobId},
    scope:'Memory-only service/query controls using actual retained IDs and unchanged official text; state/context/lineage envelopes are protocol metadata, not retained database rows. No service startup, DB/object write, geometry, rights, association, original mutation or provider call.',
    denied:outcomes.filter(c=>c.status).length,passed:outcomes.length,outcomes,readerSha256:input.readerSha256,mvtCodeSha256:mvtCodeSha()};
  assert.equal(receipt.mvtCodeSha256,prior.mvtCodeSha256);
  writeFileSync(outputPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,codeCommit:receipt.codeCommit,denied:receipt.denied,passed:receipt.passed,mvtCodeSha256:receipt.mvtCodeSha256}));
}finally{
  if(previousPool===undefined)delete (globalThis as any).ulpinPool;else (globalThis as any).ulpinPool=previousPool;
  if(originalSubject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=originalSubject;
}
