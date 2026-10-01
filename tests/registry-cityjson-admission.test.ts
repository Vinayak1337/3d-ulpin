import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {RegistryCityJSONAdmissionRequestSchema,CITYJSON_ADMISSION_MAX_BYTES} from '../packages/contracts/src';
import {assessCityJSONAdmission} from '../packages/server/src/modules/registry/cityjson-admission';
import {registryCityJSONAuthorityTx} from '../packages/server/src/modules/registry/cityjson-draft';
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
  const dependencies:any={transaction:async(action:any)=>action(client),authority:async(c:PoolClient,id:string)=>registryCityJSONAuthorityTx(c,id,accepted),validation:cityjsonValidationStatusTx,
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
  assert.equal(a.validation.acceptedFence,1);assert.equal(a.validation.status.result?.resultSha256,savedStatus.result.resultSha256);
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
  assert.equal(failed.findings.structuralValidity,'failed');assert.equal(failed.validation.status.code,'CITYJSON_VALIDATION_BUSY');assert.equal(failed.validation.acceptedFence,null);
  assert(failed.sufficiency.missing.includes('accepted_structural_validation'));
  const pending=fixture();pending.job.status='queued';pending.meta.logical_state='queued';pending.meta.result_ref=null;pending.meta.accepted_fence=null;
  pending.status.status='queued';pending.status.code=null;pending.status.result=null;
  assert.equal((await assessCityJSONAdmission(pending.draft.id,pending.request,pending.dependencies)).findings.structuralValidity,'pending');
  const invalid=fixture();invalid.status.result.summary.outcome='invalid';invalid.status.result.summary.selectedGeometry='invalid';
  assert.equal((await assessCityJSONAdmission(invalid.draft.id,invalid.request,invalid.dependencies)).findings.structuralValidity,'invalid');
}));
