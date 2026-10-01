import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import type {PoolClient} from 'pg';
import {CityJSONInputSchema} from '../packages/contracts/src/usp/cityjson-ingestion';
import {RegistryCityJSONCandidateSchema,RegistryCityJSONValidationInputSchema,RegistryCityJSONValidationRequestSchema,
  RegistryCityJSONValidationStatusSchema} from '../packages/contracts/src';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {registerUspJobInputTx,assertUspJobAttemptTx,cancelUspJob} from '../packages/server/src/modules/usp/jobs';
import {registryCityJSONAuthorityTx} from '../packages/server/src/modules/registry/cityjson-draft';
import {assertNoNativeCandidates} from '../packages/server/src/modules/registry/registry';
import {validationSummary,CITYJSON_VALIDATION_REPORT_NAMES} from '../packages/server/src/modules/registry/cityjson-validation-processor';
import {cityjsonValidationFailureCode} from '../packages/server/src/modules/registry/cityjson-validation-worker';
import {cityjsonValidationConfig} from '../packages/server/src/modules/registry/cityjson-validation-config';
import {enqueueCityJSONValidationTx,validationSelections,assertCityJSONValidationAuthority,assertCityJSONValidationJob,
  encodeCityJSONValidationResult,cityjsonValidationReportKey,readCityJSONValidationStatus} from '../packages/server/src/modules/registry/cityjson-validation';

// In-memory technical identities only; unchanged source and previously accepted parser evidence.
// No database, validator, new operational row or runtime acceptance is produced here.
const source=readFileSync(new URL('../fixtures/usp/D1/single-roof/original.json',import.meta.url));
const acceptedRoot=(process.env.ULPIN_CITYJSON_VALIDATION_CONTROL_REPORTS??'E:/BhuAayam-data/task-data/desktop-cityjson-validity/run-final').replace(/[\\/]?$/,'/');
const archived=JSON.parse(readFileSync(acceptedRoot+'receipt.json','utf8'));
const toolLock=JSON.parse(readFileSync(new URL('../scripts/usp/cityjson-validity/tools.json',import.meta.url),'utf8'));
const hash='a'.repeat(64),building='NL.IMBAG.Pand.1655100000500568',part=building+'-0',root='/feature/CityObjects/';
function fixture(){
  const caseId=randomUUID(),sourceId=randomUUID(),nativeJob=randomUUID(),recordId=randomUUID(),siteId=randomUUID(),draftId=randomUUID(),binding=ingestionBinding(caseId);
  const native=CityJSONInputSchema.parse({version:'cityjson-native/1',jobId:nativeJob,caseId,caseRevision:1,caseContextSha256:hash,
    sourceId,sourceFamilyId:sourceId,sourceRevision:1,sourceSha256:sha256(source),sourceBytes:source.length,objectKey:`sources/${sourceId}/${sha256(source)}`,
    subject:binding.subject,accessSha256:binding.access,readerSha256:hash,selection:'complete_bounded_source'});
  const frame={id:'EPSG:7415',horizontalUnit:'m',verticalUnit:'m',benchmark:'NAP'};
  const representation={ref:{namespace:'representation',id:recordId},revision:0,entity:{namespace:'registry_record',id:recordId},frame:null,
    role:'exterior',geometry:{profile:'asset',asset:{ref:{namespace:'asset',id:`cityjson:${nativeJob}`},revision:1},format:'source-native-cityjson/1'},sourceParts:[]};
  const candidate=RegistryCityJSONCandidateSchema.parse({version:'registry-cityjson-draft/1',state:'unrecorded',qualification:'not_assessed',intentSha256:hash,
    input:native,resultSha256:hash,acceptedFence:1,artifact:{key:`cityjson-native/${nativeJob}/${hash}.native.json`,sha256:hash,bytes:33168,
      mediaType:'application/json',profile:'source-native-cityjson/1'},site:{id:siteId,revision:0,frameSha256:fingerprint(frame)},representation,
    selection:{buildingObjectId:building,objectId:part,buildingPointer:root+building,objectPointer:root+part,
      geometryPointer:root+part+'/geometry/2',geometrySha256:hash,objectSha256:hash,footprintSurfacePointer:root+building+'/geometry/0/boundaries/0',
      footprintSha256:hash,verticesPointer:'/feature/vertices',verticesSha256:hash,transformPointer:'/metadata/transform',transformSha256:hash},
    reference:{state:'declared',crs:'EPSG:7415',vertical:'NAP',qualification:'not_assessed'}});
  const pins={platform:'windows-x86_64',pythonSha256:hash,adapterSha256:archived.adapterSha256,supervisorSha256:hash,toolLockSha256:archived.toolLockSha256,
    codeSha256:hash,configSha256:hash,tools:Object.entries(toolLock.tools).map(([name,t]:[string,any])=>({name,version:t.version,files:t.files.map(({sha256,executable}:any)=>({sha256,executable}))}))};
  const record:any={id:recordId,siteId,kind:'building',revision:0,footprint:[],nativeExteriorCandidate:candidate};
  const current:any={site:{id:siteId,revision:0,frame,synthetic:false},draft:{id:draftId,site_id:siteId,revision:1,status:'draft',records:[record]},record,candidate};
  const input=RegistryCityJSONValidationInputSchema.parse({version:'registry-cityjson-validation/1',jobId:randomUUID(),draftId,draftRevision:1,
    siteId,recordId,candidate,footprintSha256:fingerprint(record.footprint),selections:validationSelections(candidate),validator:pins});
  const reports=CITYJSON_VALIDATION_REPORT_NAMES.map(name=>({name,bytes:readFileSync(acceptedRoot+name)}));
  return {input,current,reports};
}
async function attributed(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='validation-technical-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
const rejected=(status:number)=>(e:any)=>e.status===status;

test('strict request, bound archived report controls and qualification guard',()=>attributed(async()=>{
  const f=fixture(),request={requestKey:randomUUID(),expectedDraftRevision:1};
  assert.equal(sha256(source),'5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2');
  for(const field of ['report','verdict','toolsRoot','sourceUrl','executable'])assert.equal(RegistryCityJSONValidationRequestSchema.safeParse({...request,[field]:'forged'}).success,false);
  const summary=validationSummary(archived,f.input,f.reports);assert.equal(summary.outcome,'valid');assert.equal(summary.qualification,'not_assessed');
  assert.throws(()=>validationSummary({...archived,source:{...archived.source,sha256:'0'.repeat(64)}},f.input,f.reports),rejected(422));
  assert.throws(()=>validationSummary(archived,f.input,f.reports.map(v=>v.name==='val3dity.json'?{...v,bytes:Buffer.from('{}')}:v)),rejected(422));
  assert.throws(()=>assertNoNativeCandidates([f.current.record]));
  const bytes=encodeCityJSONValidationResult({version:f.input.version,input:f.input,summary,createdAt:'2026-10-01T00:00:00Z',
    reports:f.reports.map(v=>({name:v.name,key:cityjsonValidationReportKey(f.input.jobId,sha256(v.bytes),v.name),bytes:v.bytes.length,sha256:sha256(v.bytes)}))});
  assert.equal(bytes.length,32768);assert.equal(JSON.parse(bytes.toString()).summary.qualification,'not_assessed');
  const safe=RegistryCityJSONValidationStatusSchema.parse({version:f.input.version,draftId:f.input.draftId,draftRevision:1,jobId:f.input.jobId,
    status:'completed',code:null,result:{summary,createdAt:'2026-10-01T00:00:00Z',resultSha256:sha256(bytes)}});
  const publicText=JSON.stringify(safe);for(const privateValue of ['objectKey','reportFile','commands','E:/','sources/','cityjson-native/'])assert.equal(publicText.includes(privateValue),false);
}));

test('invalid is a completed verdict; timeout, unavailable and tool failure remain distinct',()=>attributed(async()=>{
  const f=fixture(),invalid=structuredClone(archived),schema=JSON.parse(f.reports.find(v=>v.name==='cjval.stdout')!.bytes.toString());
  schema.valid=false;schema.checks.errors.schema={valid:false,errors:['technical parser diagnostic']};
  const data=Buffer.from(JSON.stringify(schema));invalid.results.cjval.state='invalid';invalid.results.cjval.reportSha256=sha256(data);
  invalid.results.cjval.checks=schema.checks;invalid.state='invalid';
  const summary=validationSummary(invalid,f.input,f.reports.map(v=>v.name==='cjval.stdout'?{...v,bytes:data}:v));
  assert.equal(summary.outcome,'invalid');assert.equal(summary.documentSchema,'invalid');assert.equal(summary.selectedGeometry,'valid');
  assert.equal(summary.qualification,'not_assessed');
  for(const [state,code] of [['error','CITYJSON_VALIDATION_TOOL_FAILURE'],['unavailable','CITYJSON_VALIDATION_UNAVAILABLE']] as const){
    assert.throws(()=>validationSummary({...archived,state},f.input,f.reports),(e:any)=>cityjsonValidationFailureCode(e)===code);
  }
  assert.throws(()=>validationSummary({...archived,state:'error',commands:[{execution:'timeout'}]},f.input,f.reports),(e:any)=>cityjsonValidationFailureCode(e)==='CITYJSON_VALIDATION_TIMEOUT');
  assert.equal(cityjsonValidationFailureCode(new AppError(409,'CONFLICT','stale')),'CITYJSON_VALIDATION_STALE');
}));

test('canonical enrollment rejects forged digests/access/scope and preserves metadata replay',()=>attributed(async()=>{
  const f=fixture(),digest=fingerprint(f.input),source=f.input.candidate.input;
  let job:any={id:f.input.jobId,operation:'cityjson-validation',case_id:source.caseId,case_revision:source.caseRevision,source_id:source.sourceId,input_fingerprint:digest,payload:f.input},meta:any,insertions=0;
  const client={query:async(sql:string,args:any[]=[])=>{
    if(sql.includes('SELECT * FROM jobs'))return {rows:[job]};
    if(sql.includes('SELECT * FROM usp_job_metadata'))return {rows:meta?[meta]:[]};
    if(sql.startsWith('INSERT INTO usp_job_metadata')){insertions++;meta={input_manifest_id:args[1],input_sha256:args[2]};return {rows:[]};}
    throw new Error(sql);
  }} as unknown as PoolClient;
  const scope={kind:'intake' as const,workspaceId:source.caseId,version:source.caseRevision+1};
  await registerUspJobInputTx(client,job.id,scope,source.sourceId,digest);await registerUspJobInputTx(client,job.id,scope,source.sourceId,digest);assert.equal(insertions,1);
  const enrolled=structuredClone(job);job.input_fingerprint=hash;
  await assert.rejects(()=>registerUspJobInputTx(client,job.id,scope,source.sourceId,hash),rejected(422));job=structuredClone(enrolled);
  job.payload.candidate.input.accessSha256=hash;job.input_fingerprint=fingerprint(job.payload);
  await assert.rejects(()=>registerUspJobInputTx(client,job.id,scope,source.sourceId,job.input_fingerprint),rejected(422));job=structuredClone(enrolled);
  await assert.rejects(()=>registerUspJobInputTx(client,job.id,{...scope,version:99},source.sourceId,digest),rejected(422));
}));

test('enqueue replay preserves exact job; stale candidate during I/O and changed request cannot enroll',()=>attributed(async()=>{
  const f=fixture(),operations=new Map(),jobs=new Map(),request={requestKey:randomUUID(),expectedDraftRevision:1};let registrations=0,mutate=false;
  const client={query:async(sql:string,args:any[]=[])=>{
    if(sql.includes('SELECT payload_hash,result FROM operations'))return {rows:operations.has(args[1])?[operations.get(args[1])]:[]};
    if(sql.includes('SELECT count(*)'))return {rows:[{n:0}]};if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.startsWith('INSERT INTO jobs')){jobs.set(args[0],{id:args[0],case_id:args[1],source_id:args[2],operation:'cityjson-validation',case_revision:args[3],input_fingerprint:args[4],payload:args[5]});return {rows:[]};}
    if(sql.startsWith('INSERT INTO operations')){operations.set(args[1],{payload_hash:args[2],result:args[3]});return {rows:[]};}
    if(sql.includes('SELECT * FROM jobs'))return {rows:[jobs.get(args[0])]};throw new Error(sql);
  }} as unknown as PoolClient;
  const dependencies:any={authority:async()=>structuredClone(f.current),readDraft:async()=>{if(mutate)f.current.candidate.acceptedFence++;},
    register:async()=>{registrations++;},config:()=>({pins:f.input.validator})};
  const first=await enqueueCityJSONValidationTx(client,f.input.draftId,request,dependencies);
  const replay=await enqueueCityJSONValidationTx(client,f.input.draftId,request,dependencies);assert.deepEqual(replay,first);assert.equal(registrations,1);
  await assert.rejects(()=>enqueueCityJSONValidationTx(client,f.input.draftId,{...request,expectedDraftRevision:2},dependencies),rejected(409));
  mutate=true;await assert.rejects(()=>enqueueCityJSONValidationTx(client,f.input.draftId,{...request,requestKey:randomUUID()},dependencies),rejected(409));assert.equal(registrations,1);
  mutate=false;await assert.rejects(()=>enqueueCityJSONValidationTx(client,f.input.draftId,request,dependencies),rejected(409));
}));

test('current draft authority gates source before destination locks and rejects removed/revoked pins',()=>attributed(async()=>{
  const f=fixture(),queries:string[]=[];let denied=false,fence=1;
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.includes('SELECT site_id,records')?[f.current.draft]:
    sql.includes('FROM registry_sites')?[f.current.site]:sql.includes('FROM registry_drafts')?[f.current.draft]:[]};}} as unknown as PoolClient;
  const accepted:any=async()=>{if(denied)throw new AppError(403,'DENIED','technical revoked');return {input:f.input.candidate.input,job:{accepted_fence:fence}};};
  const authority=await registryCityJSONAuthorityTx(client,f.input.draftId,accepted);assertCityJSONValidationAuthority(f.input,authority);
  assert.ok(queries.findIndex(sql=>sql.includes('pg_advisory_xact_lock'))<queries.findIndex(sql=>sql.includes('FOR UPDATE')));
  f.current.draft.revision++;assert.throws(()=>assertCityJSONValidationAuthority(f.input,f.current),rejected(409));f.current.draft.revision--;
  denied=true;await assert.rejects(()=>registryCityJSONAuthorityTx(client,f.input.draftId,accepted),rejected(403));denied=false;
  fence=2;await assert.rejects(()=>registryCityJSONAuthorityTx(client,f.input.draftId,accepted),rejected(409));fence=1;
  delete f.current.record.nativeExteriorCandidate;await assert.rejects(()=>registryCityJSONAuthorityTx(client,f.input.draftId,accepted),rejected(422));
}));

test('expired/superseded completion and forged accepted fence are rejected',()=>attributed(async()=>{
  const f=fixture(),digest=fingerprint(f.input),attempt={jobId:f.input.jobId,number:1,fence:1,owner:'technical',leaseUntil:new Date(Date.now()+30_000).toISOString(),inputSha256:digest};
  const row:any={state:'active',fence:1,owner:attempt.owner,input_sha256:digest,lease_until:attempt.leaseUntil},meta={logical_state:'running',input_sha256:digest};
  const client={query:async(sql:string)=>({rows:sql.includes('SELECT status FROM jobs')?[{status:'running'}]:sql.includes('usp_job_metadata')?[meta]:[row]})} as unknown as PoolClient;
  await assertUspJobAttemptTx(client,attempt);row.fence=2;await assert.rejects(()=>assertUspJobAttemptTx(client,attempt),rejected(409));row.fence=1;
  row.lease_until=new Date(Date.now()-1000).toISOString();await assert.rejects(()=>assertUspJobAttemptTx(client,attempt),rejected(409));
  const source=f.input.candidate.input,job:any={id:f.input.jobId,operation:'cityjson-validation',case_id:source.caseId,source_id:source.sourceId,case_revision:source.caseRevision,
    input_fingerprint:digest,input_sha256:digest,payload:f.input,status:'succeeded',logical_state:'succeeded',accepted_fence:1,attempt_fence:1,
    attempt_state:'accepted',attempt_input_sha256:digest,completion_sha256:hash,result_ref:{assetId:`cityjson-validation:${f.input.jobId}`,version:1,sha256:hash}};
  assertCityJSONValidationJob(job,f.input,true);job.attempt_fence=2;assert.throws(()=>assertCityJSONValidationJob(job,f.input,true),rejected(409));
}));

test('configuration fails closed without server pins and reads actual local tool/code bytes without execution',()=>{
  const names=['ULPIN_CITYJSON_VALIDATOR_PYTHON','ULPIN_CITYJSON_VALIDATOR_PYTHON_SHA256','ULPIN_CITYJSON_VALIDATOR_TOOLS_ROOT','ULPIN_CITYJSON_VALIDATOR_SCRATCH_ROOT'],
    prior=names.map(v=>process.env[v]),scratch=mkdtempSync(join(realpathSync(tmpdir()),'cityjson-validation-config-control-'));
  try{
    for(const name of names)delete process.env[name];assert.throws(()=>cityjsonValidationConfig(),rejected(503));
    process.env[names[0]]='C:/Python313/python.exe';process.env[names[1]]=sha256(readFileSync(process.env[names[0]]!));
    process.env[names[2]]='E:/BhuAayam-data/task-data/desktop-cityjson-validity';process.env[names[3]]=scratch;
    const config=cityjsonValidationConfig();assert.equal(config.pins.tools[0].version,'0.10.0');assert.equal(config.pins.tools[1].version,'2.7.0');
    assert.equal(config.pins.adapterSha256,sha256(readFileSync(new URL('../scripts/usp/cityjson-validity/validate.py',import.meta.url))));
    process.env[names[1]]='0'.repeat(64);assert.throws(()=>cityjsonValidationConfig(),(e:any)=>e.code==='CITYJSON_VALIDATION_TOOL_CHANGED');
  }finally{
    names.forEach((name,i)=>{if(prior[i]===undefined)delete process.env[name];else process.env[name]=prior[i];});
    const rel=relative(realpathSync(tmpdir()),realpathSync(scratch));assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel));rmSync(scratch,{recursive:true});
  }
});

test('canonical cancellation reaches actual current-authority status; stored error text is allowlisted',()=>attributed(async()=>{
  const f=fixture(),digest=fingerprint(f.input),source=f.input.candidate.input,globals=globalThis as any,prior=globals.ulpinPool;
  const job:any={id:f.input.jobId,operation:'cityjson-validation',case_id:source.caseId,source_id:source.sourceId,
    case_revision:source.caseRevision,payload:f.input,input_fingerprint:digest,status:'queued',error:null};
  const meta={logical_state:'queued',version:1,input_sha256:digest,result_ref:null,accepted_fence:null},attempt={state:'active'};
  const client={release(){},query:async(sql:string)=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.startsWith('SELECT id FROM jobs'))return {rows:[{id:job.id}]};
    if(sql.startsWith('SELECT * FROM usp_job_metadata'))return {rows:[meta]};
    if(sql.startsWith('UPDATE usp_job_attempts')){attempt.state='fenced';return {rows:[]};}
    if(sql.startsWith('UPDATE usp_job_metadata')){meta.logical_state='cancelled';meta.version++;return {rows:[]};}
    if(sql.startsWith('UPDATE jobs')){job.status='failed';job.error='Cancelled by local operator';return {rows:[]};}
    if(sql.startsWith('INSERT INTO usp_outbox'))return {rows:[]};
    if(sql.startsWith('UPDATE usp_outbox_streams'))return {rows:[{sequence:'1'}]};
    if(sql.startsWith('SELECT j.*'))return {rows:[structuredClone({...job,...meta})]};
    throw new Error('Unexpected technical SQL: '+sql);
  }};
  let checks=0;const authority:any=async()=>{checks++;return structuredClone(f.current);};
  globals.ulpinPool={connect:async()=>client};
  try{
    await cancelUspJob(job.id,1);assert.equal(attempt.state,'fenced');assert.equal(job.error,'Cancelled by local operator');
    const status=await readCityJSONValidationStatus(f.input.draftId,job.id,authority);
    assert.equal(status.status,'failed');assert.equal(status.code,'CITYJSON_VALIDATION_CANCELLED');assert.equal(checks,2);
    assert.equal(JSON.stringify(status).includes('Cancelled by local operator'),false);
    meta.logical_state='failed';job.error='CITYJSON_VALIDATION_INTERNAL_SECRET';
    assert.equal((await readCityJSONValidationStatus(f.input.draftId,job.id,authority)).code,'CITYJSON_VALIDATION_TOOL_FAILURE');
    job.error='private command path C:/secret';
    assert.equal((await readCityJSONValidationStatus(f.input.draftId,job.id,authority)).code,'CITYJSON_VALIDATION_TOOL_FAILURE');
    await assert.rejects(()=>readCityJSONValidationStatus(f.input.draftId,job.id,async()=>{throw new AppError(403,'DENIED','technical revoked');}),rejected(403));
  }finally{if(prior===undefined)delete globals.ulpinPool;else globals.ulpinPool=prior;}
}));
