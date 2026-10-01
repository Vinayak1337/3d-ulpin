import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {RegistryCityJSONAdmissionRequestSchema,CITYJSON_ADMISSION_MAX_BYTES} from '../packages/contracts/src';
import {assessCityJSONAdmission} from '../packages/server/src/modules/registry/cityjson-admission';
import {registryCityJSONAuthorityTx,readRegistryCityJSONDraftTx} from '../packages/server/src/modules/registry/cityjson-draft';
import {readRegistryCityJSONReferenceAuthorityTx} from '../packages/server/src/modules/registry/cityjson-reference';
import {cityjsonValidationStatusTx} from '../packages/server/src/modules/registry/cityjson-validation';
import {validationSummary,CITYJSON_VALIDATION_REPORT_NAMES} from '../packages/server/src/modules/registry/cityjson-validation-processor';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Exact previously accepted runtime observations, used with query/object-read
// doubles. No DB, HTTP, tools, operational writes or new qualification occur.
const retained=(process.env.ULPIN_CITYJSON_ADMISSION_CONTROL_ROOT??'E:/BhuAayam-data/task-data/desktop-cityjson-validation-runtime').replace(/[\\/]?$/,'/');
const read=(path:string)=>JSON.parse(readFileSync(retained+path,'utf8'));
const snapshot=read('after-journey.json'),savedNative=read('native-after.json').body,savedStatus=read('bounded-result.json').body;
const resultBytes=readFileSync(retained+'objects/result.json'),result=JSON.parse(resultBytes.toString('utf8'));
const rejected=(status:number)=>(error:any)=>error.status===status;
async function attributed(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=result.input.candidate.input.subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(jobId=savedStatus.jobId){
  const site=structuredClone(snapshot.registry.sites[0]),draft=structuredClone(snapshot.registry.drafts[0]);
  const record=draft.records[0],candidate=record.nativeExteriorCandidate,job=structuredClone(snapshot.validations.jobs.find((v:any)=>v.id===jobId)),
    meta=structuredClone(snapshot.validations.metadata.find((v:any)=>v.job_id===jobId)),attempt=structuredClone(snapshot.validations.attempts.find((v:any)=>v.job_id===jobId));
  const status=structuredClone(jobId===savedStatus.jobId?savedStatus:read('busy-terminal.json').body),native=structuredClone(savedNative);
  let denied=false,afterRead:(()=>void)|undefined;const sqls:string[]=[];
  const row=()=>({...job,...meta,id:job.id,attempt_state:attempt.state,attempt_fence:meta.accepted_fence===null?null:attempt.fence,
    attempt_input_sha256:attempt.input_sha256,completion_sha256:attempt.completion_sha256});
  const client={query:async(sql:string,args:any[]=[])=>{
    sqls.push(sql);assert(!/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(sql));
    if(sql.includes('SELECT site_id,records'))return {rows:[draft]};if(sql.includes('FROM registry_sites'))return {rows:[site]};
    if(sql.includes('FROM registry_drafts'))return {rows:[draft]};if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.startsWith('SELECT id FROM jobs')){const visible=args[0]===job.id&&job.payload.draftId===args[1];return {rows:visible?[{id:job.id}]:[],rowCount:visible?1:0};}
    if(sql.includes('FROM jobs j JOIN usp_job_metadata'))return {rows:args[0]===job.id?[row()]:[]};
    if(sql.includes('SELECT state,input_sha256,completion_sha256'))return {rows:[attempt]};throw Error('Unexpected control SQL: '+sql);
  }} as unknown as PoolClient;
  const accepted:any=async()=>{if(denied)throw new AppError(403,'CITYJSON_DENIED','Retained source access revoked in control.');return {input:candidate.input,job:{accepted_fence:candidate.acceptedFence}};};
  const dependencies:any={transaction:async(action:any)=>action(client),
    references:(c:PoolClient,id:string,revision:number)=>readRegistryCityJSONReferenceAuthorityTx(c,id,revision,{
      native:(cl,nativeId)=>registryCityJSONAuthorityTx(cl,nativeId,accepted),
      document:async()=>{assert.fail('No retained reference selected');},result:async()=>{assert.fail('No retained reference selected');}}),validation:cityjsonValidationStatusTx,
    native:async()=>structuredClone(native),status:async()=>{const value=structuredClone(status);afterRead?.();return value;}};
  return {site,draft,record,candidate,job,meta,attempt,status,native,sqls,dependencies,request:{expectedDraftRevision:1,validationJobId:jobId},
    set afterRead(value:(()=>void)|undefined){afterRead=value;},set denied(value:boolean){denied=value;}};
}

test('retained accepted D1 assessment preserves structural success and concrete admission gaps',()=>attributed(async()=>{
  assert.equal(sha256(resultBytes),'82c3b05a37731aed7fb624d98f017817b2f463cad27825e7ed92ff72f9cfe5c4');
  assert.equal(sha256(readFileSync(new URL('../fixtures/usp/D1/single-roof/original.json',import.meta.url))),'5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2');
  const reports=CITYJSON_VALIDATION_REPORT_NAMES.map(name=>({name,bytes:readFileSync(retained+'objects/'+name)}));
  assert.deepEqual(validationSummary(read('objects/receipt.json'),result.input,reports),result.summary);
  const f=fixture(),a=await assessCityJSONAdmission(f.draft.id,f.request,f.dependencies);
  assert.equal(a.findings.structuralValidity,'passed');assert.equal(a.findings.admission,'unavailable');assert.equal(a.reference.accuracy,'not_assessed');
  assert.equal(a.reference.accuracyMetres,null);assert.equal(a.reference.qualifiedTransform,null);assert.equal(a.draft.recordRevision,0);
  assert.equal(a.native.geometry.type,'Solid');assert.deepEqual(a.native.geometry.lod,{state:'known',value:'2.2'});
  assert.deepEqual(a.sufficiency.missing,['reviewed_reference_evidence','reference_accuracy_check','native_admission_review','post_write_qualification']);
  assert.equal(a.sufficiency.outcome,'partial');assert.equal(a.capabilities.recordNativeExterior,false);assert.equal(a.capabilities.analyticalGeometry,false);
  assert(a.validation);assert.equal(a.validation.acceptedFence,1);assert.equal(a.validation.status.result?.resultSha256,savedStatus.result.resultSha256);
  const {assessmentSha256,...body}=a;assert.equal(assessmentSha256,fingerprint(body));assert.deepEqual(await assessCityJSONAdmission(f.draft.id,f.request,f.dependencies),a);
  const text=JSON.stringify(a);assert(Buffer.byteLength(text)<=CITYJSON_ADMISSION_MAX_BYTES);
  for(const privateValue of ['objectKey','subject','commands','E:/','E:\\','C:/','cityjson-native/','receipt.json'])assert(!text.includes(privateValue));
  assert(!f.sqls.some(sql=>/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)));
  const output=process.env.ULPIN_CITYJSON_ADMISSION_CONTROL_OUTPUT;if(output){assert(!existsSync(output));writeFileSync(output,JSON.stringify(a,null,2)+'\n',{flag:'wx'});}
}));

test('mismatched supplied job/draft/selection and forged accepted fence cannot pass',()=>attributed(async()=>{
  for(const mutate of [(f:ReturnType<typeof fixture>)=>f.job.payload.draftId='00000000-0000-4000-8000-000000000001',
    (f:ReturnType<typeof fixture>)=>f.job.payload.candidate.input.sourceRevision++,
    (f:ReturnType<typeof fixture>)=>f.job.payload.selections[0].geometryIndex++,
    (f:ReturnType<typeof fixture>)=>f.attempt.fence='2']){
    const f=fixture();mutate(f);await assert.rejects(()=>assessCityJSONAdmission(f.draft.id,f.request,f.dependencies));
  }
  const f=fixture();await assert.rejects(()=>assessCityJSONAdmission(f.draft.id,{...f.request,validationJobId:'00000000-0000-4000-8000-000000000001'},f.dependencies),rejected(404));
  for(const key of ['report','accuracyMetres','crs','approved','sourceUrl'])assert.equal(RegistryCityJSONAdmissionRequestSchema.safeParse({...f.request,[key]:true}).success,false);
}));

test('stale expected revision and post-I/O source/candidate/validation drift fail closed',()=>attributed(async()=>{
  const f=fixture();await assert.rejects(()=>assessCityJSONAdmission(f.draft.id,{...f.request,expectedDraftRevision:2},f.dependencies),rejected(409));
  for(const mutate of [(f:ReturnType<typeof fixture>)=>f.site.frame.benchmark='changed',
    (f:ReturnType<typeof fixture>)=>f.draft.revision++,
    (f:ReturnType<typeof fixture>)=>f.candidate.input.sourceSha256='0'.repeat(64),
    (f:ReturnType<typeof fixture>)=>f.meta.accepted_fence='2']){
    const control=fixture();control.afterRead=()=>mutate(control);await assert.rejects(()=>assessCityJSONAdmission(control.draft.id,control.request,control.dependencies));
  }
}));

test('revoked source denies before private reads and after report I/O without an assessment',()=>attributed(async()=>{
  const f=fixture();f.denied=true;let reads=0;f.dependencies.native=async()=>{reads++;return f.native;};
  const unavailable=(error:any)=>error.status===404&&error.code==='CITYJSON_ADMISSION_UNAVAILABLE'&&error.message==='The requested native admission evidence is unavailable.';
  await assert.rejects(()=>assessCityJSONAdmission(f.draft.id,f.request,f.dependencies),unavailable);assert.equal(reads,0);
  const after=fixture();after.afterRead=()=>after.denied=true;await assert.rejects(()=>assessCityJSONAdmission(after.draft.id,after.request,after.dependencies),unavailable);
  const unrelated=fixture();unrelated.job.payload.draftId='00000000-0000-4000-8000-000000000001';
  await assert.rejects(()=>assessCityJSONAdmission(unrelated.draft.id,unrelated.request,unrelated.dependencies),unavailable);
  const missing=fixture();await assert.rejects(()=>assessCityJSONAdmission(missing.draft.id,{...missing.request,validationJobId:'00000000-0000-4000-8000-000000000001'},missing.dependencies),unavailable);
}));

test('retained busy failure and pending/invalid controls preserve structural distinctions',()=>attributed(async()=>{
  const busy=fixture(read('busy-admission.json').body.jobId),failed=await assessCityJSONAdmission(busy.draft.id,busy.request,busy.dependencies);
  assert.equal(failed.findings.structuralValidity,'failed');assert(failed.validation);assert.equal(failed.validation.status.code,'CITYJSON_VALIDATION_BUSY');assert.equal(failed.validation.acceptedFence,null);
  assert(failed.sufficiency.missing.includes('accepted_structural_validation'));
  const pending=fixture();pending.job.status='queued';pending.meta.logical_state='queued';pending.meta.result_ref=null;pending.meta.accepted_fence=null;
  pending.status.status='queued';pending.status.code=null;pending.status.result=null;
  assert.equal((await assessCityJSONAdmission(pending.draft.id,pending.request,pending.dependencies)).findings.structuralValidity,'pending');
  const invalid=fixture();invalid.status.result.summary.outcome='invalid';invalid.status.result.summary.selectedGeometry='invalid';
  assert.equal((await assessCityJSONAdmission(invalid.draft.id,invalid.request,invalid.dependencies)).findings.structuralValidity,'invalid');
}));

function referenceFixture(){
  const dataRoot=retained.replace(/desktop-cityjson-validation-runtime\/$/,'');
  const snapshot=JSON.parse(readFileSync(dataRoot+'desktop-cityjson-reference-runtime/final.json','utf8'));
  const manifest=JSON.parse(readFileSync(dataRoot+'desktop-cityjson-reference-binding/accepted-enrollment-manifest.json','utf8'));
  const site=structuredClone(snapshot.registry.sites[0]),draft=structuredClone(snapshot.registry.drafts[0]),record=draft.records[0],candidate=record.nativeExteriorCandidate;
  const docs=manifest.enrollments.map((e:any)=>{
    const bytes=readFileSync(e.resultPrivateCopy);assert.equal(sha256(bytes),e.resultSha256);
    const result=JSON.parse(bytes.toString('utf8'));assert.equal(fingerprint(result.input),e.inputSha256);
    return {e,result};
  });
  const artifact=readFileSync(dataRoot+'desktop-cityjson-api/native.json');assert.equal(sha256(artifact),candidate.artifact.sha256);
  const publicResult=JSON.parse(readFileSync(dataRoot+'desktop-cityjson-api/final-runtime-result.json','utf8')).result;
  const nativeResult={version:'cityjson-native/1',input:candidate.input,...publicResult};
  const job=structuredClone(snapshot.validations.jobs.find((v:any)=>v.id===savedStatus.jobId));
  const state={denied:new Set<string>(),documentReads:0,nativeReads:0,tx:0,validationCalls:0,statusCalls:0,
    afterDocumentRead:undefined as (()=>void)|undefined,afterNativeRead:undefined as (()=>void)|undefined,
    queries:[] as {tx:number;sql:string;args:any[]}[]};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.queries.push({tx:state.tx,sql,args});assert(!/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(sql));
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.includes('FROM registry_drafts'))return {rows:[structuredClone(draft)]};
    if(sql.includes('FROM registry_sites'))return {rows:[structuredClone(site)]};
    if(sql.includes('SELECT accepted_fence'))return {rows:[{accepted_fence:1}]};
    if(sql.startsWith('SELECT id FROM jobs'))return {rows:[{id:args[0]}],rowCount:1};
    if(sql.includes('FROM jobs j JOIN usp_job_metadata'))return {rows:[job]};
    throw Error('Unexpected retained-reference control SQL: '+sql);
  }} as unknown as PoolClient;
  const nativeMeta=snapshot.retained.metadata.find((v:any)=>v.job_id===candidate.input.jobId);
  assert.equal(nativeMeta.result_ref.sha256,candidate.resultSha256);assert.equal(Number(nativeMeta.accepted_fence),candidate.acceptedFence);
  const accepted:any=async()=>({input:structuredClone(candidate.input),job:structuredClone(nativeMeta)});
  const referenceDependencies={native:(c:PoolClient,id:string)=>registryCityJSONAuthorityTx(c,id,accepted),
    document:async(_client:PoolClient,_ctx:unknown,pin:any,expected?:any)=>{
      const doc=docs.find((v:any)=>v.e.caseId===pin.caseId&&v.e.jobId===pin.jobId&&v.e.sourceId===pin.sourceId);
      if(!doc||state.denied.has(pin.caseId))throw new AppError(403,'DOCUMENT_DENIED','Revoked in retained snapshot control.');
      const e=doc.e;assert.deepEqual(pin,{caseId:e.caseId,caseRevision:e.caseRevision,sourceId:e.sourceId,sourceRevision:e.sourceRevision,
        sourceSha256:e.sourceSha256,jobId:e.jobId,resultSha256:e.resultSha256});
      if(expected)assert.equal(fingerprint(expected),fingerprint(doc.result.input));return doc.result.input;
    },result:async(input:any,hash:string)=>{
      state.documentReads++;const doc=docs.find((v:any)=>v.e.jobId===input.jobId)!;assert.equal(hash,doc.e.resultSha256);
      const result=structuredClone(doc.result);state.afterDocumentRead?.();return result;
    }};
  const nativeDependencies:any={accepted,result:async()=>structuredClone(nativeResult),artifact:async()=>{
    state.nativeReads++;const bytes=Buffer.from(artifact);state.afterNativeRead?.();return bytes;
  }};
  const dependencies:any={transaction:async(action:any)=>{state.tx++;return action(client);},
    references:(c:PoolClient,id:string,revision:number)=>readRegistryCityJSONReferenceAuthorityTx(c,id,revision,referenceDependencies),
    native:(c:PoolClient,id:string)=>readRegistryCityJSONDraftTx(c,id,nativeDependencies),
    validation:async(...args:any[])=>{state.validationCalls++;return (cityjsonValidationStatusTx as any)(...args);},
    status:async()=>{state.statusCalls++;throw new Error('No validation was selected');}};
  return {draft,site,record,candidate,job,state,dependencies,docs};
}

test('current five accepted references give a useful admission checklist without selected validation or validator configuration',()=>attributed(async()=>{
  const f=referenceFixture(),original=structuredClone(f.draft),keys=Object.keys(process.env).filter(key=>key.startsWith('ULPIN_CITYJSON_VALIDATOR_'));
  const config=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys)delete process.env[key];
  try{
    const request={expectedDraftRevision:5};assert(RegistryCityJSONAdmissionRequestSchema.safeParse(request).success);
    assert(!RegistryCityJSONAdmissionRequestSchema.safeParse({}).success);
    assert(!RegistryCityJSONAdmissionRequestSchema.safeParse({...request,validationJobId:null}).success);
    const a=await assessCityJSONAdmission(f.draft.id,request,f.dependencies);
    assert.equal(a.validation,null);assert.equal(a.findings.structuralValidity,'not_assessed');assert.equal(a.findings.sourceIntegrity.nativeArtifact,'verified');
    assert.deepEqual(a.reference.selections,{state:'operator_selected',count:5,
      ids:f.record.nativeExteriorReferences.map((pin:any)=>pin.id),referencesSha256:fingerprint(f.record.nativeExteriorReferences)});
    assert.equal(a.reference.referenceEvidence,'not_bound');assert.equal(a.reference.reviewedReference,'not_assessed');
    assert.equal(a.reference.accuracy,'not_assessed');assert.equal(a.reference.accuracyMetres,null);
    assert.equal(a.draft.footprintSha256,fingerprint(f.record.footprint));assert.equal(a.draft.draftRevision,5);
    assert.deepEqual(a.sufficiency.missing,['accepted_structural_validation','reviewed_reference_evidence','reference_accuracy_check','native_admission_review','post_write_qualification']);
    assert.match(a.missing[0].reason,/No validation was selected/);assert(!/no validation exists/i.test(a.missing[0].reason));
    assert(!a.actions.some(action=>action.kind==='inspect_validation'));
    for(const kind of ['request_validation','inspect_reference_selections'])assert(a.actions.some(action=>action.kind===kind));
    assert.equal(a.capabilities.recordNativeExterior,false);assert.equal(a.capabilities.qualifyGeometry,false);assert.equal(a.capabilities.analyticalGeometry,false);
    const {assessmentSha256,...body}=a;assert.equal(assessmentSha256,fingerprint(body));
    const text=JSON.stringify(a);assert(Buffer.byteLength(text)<=CITYJSON_ADMISSION_MAX_BYTES);
    for(const value of ['objectKey','subject','commands','C:/','E:/',...f.docs.map((v:any)=>v.result.native.parts[0].text)])assert(!text.includes(value));
    assert.equal(f.state.validationCalls,0);assert.equal(f.state.statusCalls,0);assert.equal(f.state.nativeReads,1);assert.equal(f.state.documentReads,4);
    assert(!f.state.queries.some(q=>q.sql.includes('FROM jobs')));assert.deepEqual(f.draft,original);
    const expectedCases=[...new Set([f.draft.case_id,f.candidate.input.caseId,...f.record.nativeExteriorReferences.map((p:any)=>p.document.caseId)])].sort();
    for(const tx of [1,2]){
      const calls=f.state.queries.filter(q=>q.tx===tx),firstRow=calls.findIndex(q=>/FOR (UPDATE|SHARE)/.test(q.sql));
      const initialGates=calls.slice(0,firstRow).filter(q=>q.sql.includes('pg_advisory_xact_lock')).map(q=>q.args[0]);
      assert.deepEqual(initialGates,expectedCases.map(id=>`registry-import:${id}`));
      assert(calls.filter(q=>q.sql.includes('pg_advisory_xact_lock')).every(q=>expectedCases.some(id=>q.args[0]===`registry-import:${id}`)));
    }
    const output=process.env.ULPIN_CITYJSON_ADMISSION_READINESS_CONTROL_OUTPUT;
    if(output){assert(!existsSync(output));writeFileSync(output,JSON.stringify({assessment:a,queries:f.state.queries,nativeArtifactVerified:true,
      selectedReferenceParts:5,validationCalls:0,statusCalls:0,sourceAndDraftUnchanged:true,noServiceControl:true},null,2)+'\n',{flag:'wx'});}
    // No attachment is a distinct authorized empty set; no document I/O occurs.
    delete f.record.nativeExteriorReferences;f.state.documentReads=0;
    const empty=await assessCityJSONAdmission(f.draft.id,request,f.dependencies);
    assert.deepEqual(empty.reference.selections,{state:'none',count:0,ids:[],referencesSha256:fingerprint([])});assert.equal(f.state.documentReads,0);
  }finally{Object.assign(process.env,config);}
}));

test('omission never hides explicit stale jobs, stale revisions or revoked/changed selected reference authority',()=>attributed(async()=>{
  const stale=referenceFixture();await assert.rejects(()=>assessCityJSONAdmission(stale.draft.id,{expectedDraftRevision:4},stale.dependencies),rejected(409));
  assert.equal(stale.state.documentReads,0);assert.equal(stale.state.nativeReads,0);
  const supplied=referenceFixture();await assert.rejects(()=>assessCityJSONAdmission(supplied.draft.id,
    {expectedDraftRevision:5,validationJobId:supplied.job.id},supplied.dependencies),rejected(409));
  assert.equal(supplied.state.validationCalls,1);assert.equal(supplied.state.statusCalls,0);assert.equal(supplied.state.nativeReads,0);
  const unavailable=(error:any)=>error.status===404&&error.code==='CITYJSON_ADMISSION_UNAVAILABLE';
  const revoked=referenceFixture();revoked.state.denied.add(revoked.docs[0].e.caseId);
  await assert.rejects(()=>assessCityJSONAdmission(revoked.draft.id,{expectedDraftRevision:5},revoked.dependencies),unavailable);
  assert.equal(revoked.state.documentReads,0);assert.equal(revoked.state.nativeReads,0);
  const during=referenceFixture();during.state.afterDocumentRead=()=>during.state.denied.add(during.docs[0].e.caseId);
  await assert.rejects(()=>assessCityJSONAdmission(during.draft.id,{expectedDraftRevision:5},during.dependencies),unavailable);
  const after=referenceFixture();after.state.afterNativeRead=()=>after.state.denied.add(after.docs[0].e.caseId);
  await assert.rejects(()=>assessCityJSONAdmission(after.draft.id,{expectedDraftRevision:5},after.dependencies),unavailable);
  const drift=referenceFixture();drift.state.afterNativeRead=()=>drift.record.nativeExteriorReferences.pop();
  await assert.rejects(()=>assessCityJSONAdmission(drift.draft.id,{expectedDraftRevision:5},drift.dependencies),rejected(409));
}));
