import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {RegistryCityJSONReferenceAttachSchema,RegistryCityJSONReferenceRemoveSchema,CITYJSON_REFERENCE_LIMITS} from '../packages/contracts/src';
import {DocumentInputSchema,DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {attachRegistryCityJSONReferencesTx,readRegistryCityJSONReferencesTx,removeRegistryCityJSONReferencesTx,
  cityjsonReferenceId,readRegistryCityJSONReferenceAuthorityTx} from '../packages/server/src/modules/registry/cityjson-reference';
import {registryCityJSONAuthorityTx,removeRegistryCityJSONDraftTx} from '../packages/server/src/modules/registry/cityjson-draft';
import {assertCityJSONValidationAuthority} from '../packages/server/src/modules/registry/cityjson-validation';
import {assessCityJSONAdmission} from '../packages/server/src/modules/registry/cityjson-admission';
import {publicRegistryBody,publicRegistryDraft,publicRegistryReview} from '../packages/server/src/modules/registry/registry-document-evidence';
import {assertNoNativeCandidates,createRegistryDraftTx,recordBodySchema} from '../packages/server/src/modules/registry/registry';
import {associationDocumentInputTx} from '../packages/server/src/modules/usp/ingestion/document-association-authority';
import {documentInput} from '../packages/server/src/modules/usp/ingestion/document-context';
import {documentReaderSha} from '../packages/server/src/modules/usp/ingestion/document-native';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

// Previously accepted snapshots/parts with query and object-read doubles. No
// runtime source is refreshed, no operational association is established, and
// the partial document-result double is not claimed as the full stored bytes.
const root=(process.env.ULPIN_CITYJSON_REFERENCE_CONTROL_DATA??'E:/BhuAayam-data/task-data').replace(/[\\/]?$/,'/');
const json=(path:string)=>JSON.parse(readFileSync(root+path,'utf8'));
const nativeSnapshot=json('desktop-cityjson-validation-runtime/after-journey.json');
const validation=json('desktop-cityjson-validation-runtime/objects/result.json');
const docStatus=json('desktop-document-association-preview/after-status.json');
const preparation=json('desktop-document-association-preview/native-preparation-receipt.json');
const selection=json('desktop-document-association-preview/exact-current-request.json');
const acceptedJob=preparation.after.jobs.find((job:any)=>job.id===docStatus.jobId);
const input=DocumentInputSchema.parse(acceptedJob.payload);
const docResult=DocumentResultSchema.parse({version:'source-document/1',input,
  native:{...docStatus.native,parts:docStatus.parts},model:docStatus.model,createdAt:preparation.runAt});
const rejected=(status:number)=>(error:any)=>error.status===status;
const unavailable=(error:any)=>error.status===404&&error.code==='REGISTRY_CITYJSON_REFERENCE_UNAVAILABLE';
async function attributed(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=input.subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(){
  const draft=structuredClone(nativeSnapshot.registry.drafts[0]),site=structuredClone(nativeSnapshot.registry.sites[0]);
  const candidate=draft.records[0].nativeExteriorCandidate;
  const state={draft,site,operations:new Map<string,any>(),writes:0,reads:0,fence:1,denied:false,nativeDenied:false,
    queries:[] as {sql:string;args:any[]}[],afterRead:undefined as (()=>void)|undefined,afterGate:undefined as (()=>void)|undefined};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.queries.push({sql,args});let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock'))state.afterGate?.();
    else if(sql.includes('FROM registry_drafts'))rows=[structuredClone(state.draft)];
    else if(sql.includes('FROM registry_sites'))rows=[structuredClone(state.site)];
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:state.fence}];
    else if(sql.startsWith('SELECT id FROM jobs'))rows=args[0]===validation.input.jobId&&args[1]===draft.id?[{id:args[0]}]:[];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.startsWith('UPDATE registry_drafts SET records')){state.draft.records=JSON.parse(args[1]);state.draft.revision++;state.writes++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else throw Error('Unexpected control SQL: '+sql);
    return {rows,rowCount:rows.length};
  }} as unknown as PoolClient;
  const accepted:any=async()=>{
    if(state.nativeDenied)throw new AppError(403,'NATIVE_DENIED','Revoked native source in control.');
    return {input:candidate.input,job:{accepted_fence:candidate.acceptedFence}};
  };
  const dependencies={native:(c:PoolClient,id:string)=>registryCityJSONAuthorityTx(c,id,accepted),
    document:async(_c:PoolClient,_ctx:unknown,pin:any,expected?:any)=>{
      if(state.denied)throw new AppError(403,'DOCUMENT_DENIED','Revoked document in control.');
      if(pin.jobId!==input.jobId||pin.caseId!==input.caseId||pin.sourceId!==input.sourceId)throw new AppError(404,'NOT_FOUND','Unavailable document.');
      if(fingerprint(pin)!==fingerprint(selection.document)||(expected&&fingerprint(expected)!==fingerprint(input)))
        throw new AppError(409,'REVISION_CONFLICT','Mismatched accepted document pins.');
      return input;
    },result:async()=>{state.reads++;const value=structuredClone(docResult);state.afterRead?.();return value;}};
  const request={requestKey:randomUUID(),expectedDraftRevision:1,document:selection.document,partIds:selection.partIds};
  return {state,client,dependencies,request,candidate,draftId:draft.id,recordId:draft.records[0].id};
}

test('retained LGD literal parts attach/read/remove on exact Dutch native selection without accuracy or geometry changes',()=>attributed(async()=>{
  const original=readFileSync(new URL('../fixtures/usp/D4/gf0-structured-codes-v1/lgd-districts.csv',import.meta.url));
  assert.equal(sha256(original),selection.document.sourceSha256);assert.equal(input.sourceBytes,original.length);
  assert.equal(sha256(readFileSync(new URL('../fixtures/usp/D1/single-roof/original.json',import.meta.url))),validation.input.candidate.input.sourceSha256);
  const lines=original.toString('utf8').split(/\r?\n/),headers=lines[0].split(',');
  for(const id of selection.partIds){
    const part=docStatus.parts.find((p:any)=>p.id===id);assert.equal(sha256(part.text),part.sha256);
    // These two source rows contain no quoted commas; compare all literal fields,
    // including padding/empty values and leading zeros, to their unchanged bytes.
    const values=lines[part.locator.row-1].split(',').map(value=>value.replace(/^"|"$/g,''));
    assert.equal(part.text,headers.map((name,index)=>`${name}: ${values[index]}`).join('\n'));
  }
  const f=fixture(),originalRecord=structuredClone(f.state.draft.records[0]),sourceInput=structuredClone(f.candidate.input);
  assertCityJSONValidationAuthority(validation.input,await f.dependencies.native(f.client,f.draftId));
  const savedStatus=json('desktop-cityjson-validation-runtime/bounded-result.json').body;
  const savedNative=json('desktop-cityjson-validation-runtime/native-after.json').body;
  const job=nativeSnapshot.validations.jobs.find((value:any)=>value.id===validation.input.jobId);
  const meta=nativeSnapshot.validations.metadata.find((value:any)=>value.job_id===validation.input.jobId);
  const attempt=nativeSnapshot.validations.attempts.find((value:any)=>value.job_id===validation.input.jobId);
  const admissionDependencies:any={transaction:async(work:any)=>work(f.client),
    references:(c:PoolClient,id:string,revision:number)=>readRegistryCityJSONReferenceAuthorityTx(c,id,revision,f.dependencies),
    validation:async()=>({input:validation.input,job:{...job,...meta,id:job.id,attempt_state:attempt.state,attempt_fence:attempt.fence,
      completion_sha256:attempt.completion_sha256}}),native:async()=>savedNative,status:async()=>savedStatus};
  const assessment=await assessCityJSONAdmission(f.draftId,{expectedDraftRevision:1,validationJobId:validation.input.jobId},admissionDependencies);
  assert.equal(assessment.capabilities.bindReferenceEvidence,true);assert.equal(assessment.capabilities.reviewAdmission,false);
  assert.equal(assessment.capabilities.recordNativeExterior,false);
  assert.deepEqual(assessment.sufficiency.missing,['reviewed_reference_evidence','reference_accuracy_check','native_admission_review','post_write_qualification']);
  assert(assessment.actions.some(action=>action.kind==='inspect_reference_selections'&&action.path.endsWith('/references')));
  const receipt=await attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies);
  assert.equal(receipt.draftRevision,2);assert.equal(receipt.changed,true);assert.equal(f.state.writes,1);
  const read=await readRegistryCityJSONReferencesTx(f.client,f.draftId,f.dependencies);
  assert.equal(read.references.length,2);assert.equal(read.geographicRelationship,'not_assessed');
  assert.equal(read.accuracy,'not_assessed');assert.equal(read.accuracyMetres,null);assert.equal(read.reviewedReference,'not_assessed');
  assert.equal(read.referenceDeclaration.crs,'EPSG:7415');assert.equal(read.globalPlacement,'not_qualified');
  assert.deepEqual(read.references.map(entry=>entry.part),selection.partIds.map((id:string)=>docStatus.parts.find((part:any)=>part.id===id)));
  assert(read.references[0].part.text.includes('049'));assert(read.references[1].part.text.includes('000'));
  assert.deepEqual(f.state.draft.records[0].nativeExteriorCandidate,originalRecord.nativeExteriorCandidate);
  assert.deepEqual(f.state.draft.records[0].footprint,originalRecord.footprint);assert.deepEqual(f.candidate.input,sourceInput);
  assert.equal(read.references[0].pin.inputSha256,fingerprint(input));assert.equal(read.references[0].pin.acceptedFence,1);
  const pinBytes=JSON.stringify(f.state.draft.records[0].nativeExteriorReferences);
  assert(!pinBytes.includes(read.references[0].part.text));assert(!pinBytes.includes('objectKey'));
  assert(Buffer.byteLength(JSON.stringify(read))<=CITYJSON_REFERENCE_LIMITS.readBytes);
  assert.throws(()=>assertCityJSONValidationAuthority(validation.input,{draft:f.state.draft,site:f.state.site,record:f.state.draft.records[0],candidate:f.candidate}),rejected(409));
  await assert.rejects(()=>assessCityJSONAdmission(f.draftId,{expectedDraftRevision:2,validationJobId:validation.input.jobId},admissionDependencies),rejected(409));
  const removal={requestKey:randomUUID(),expectedDraftRevision:2,clearAll:true};
  const removed=await removeRegistryCityJSONReferencesTx(f.client,f.draftId,removal,f.dependencies);
  assert.equal(removed.draftRevision,3);assert.equal(f.state.writes,2);assert.deepEqual(f.state.draft.records[0],originalRecord);
  assert.equal((await readRegistryCityJSONReferencesTx(f.client,f.draftId,f.dependencies)).references.length,0);
  assert.deepEqual(await removeRegistryCityJSONReferencesTx(f.client,f.draftId,removal,f.dependencies),removed);
  assert.equal(f.state.writes,2);
  assert(f.state.queries.filter(q=>/^(UPDATE|INSERT)/.test(q.sql)).every(q=>q.sql.startsWith('UPDATE registry_drafts')||q.sql.startsWith('INSERT INTO operations')));
  for(const operation of f.state.operations.values())assert(!JSON.stringify(operation).includes('locator'));
  const output=process.env.ULPIN_CITYJSON_REFERENCE_CONTROL_OUTPUT;
  if(output){assert(!existsSync(output));writeFileSync(output,JSON.stringify({assessment,receipt,read,removed,originalRecordSha256:fingerprint(originalRecord),
    validationAtPreviousRevision:'stale',protocolOnly:true},null,2)+'\n',{flag:'wx'});}
}));

test('stale/reused request keys and no-op duplicate selection never duplicate pins or draft revisions',()=>attributed(async()=>{
  const f=fixture(),receipt=await attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies);
  assert.deepEqual(await attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies),receipt);
  const duplicate=await attachRegistryCityJSONReferencesTx(f.client,f.draftId,{...f.request,requestKey:randomUUID(),expectedDraftRevision:2},f.dependencies);
  assert.equal(duplicate.changed,false);assert.equal(duplicate.draftRevision,2);assert.equal(f.state.writes,1);
  assert.equal(f.state.draft.records[0].nativeExteriorReferences.length,2);
  await assert.rejects(()=>attachRegistryCityJSONReferencesTx(f.client,f.draftId,{...f.request,partIds:[f.request.partIds[0]]},f.dependencies),rejected(409));
  await assert.rejects(()=>attachRegistryCityJSONReferencesTx(f.client,f.draftId,{...f.request,requestKey:randomUUID()},f.dependencies),rejected(409));
  await removeRegistryCityJSONReferencesTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:2,clearAll:true},f.dependencies);
  await assert.rejects(()=>attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies),rejected(409));
  for(const key of ['text','locator','approved','accuracyMetres','sourceUrl'])assert(!RegistryCityJSONReferenceAttachSchema.safeParse({...f.request,[key]:true}).success);
  assert(!RegistryCityJSONReferenceAttachSchema.safeParse({...f.request,partIds:[f.request.partIds[0],f.request.partIds[0]]}).success);
  assert(!RegistryCityJSONReferenceRemoveSchema.safeParse({requestKey:randomUUID(),expectedDraftRevision:1,remove:[],clearAll:false}).success);
}));

test('private authority denial/mismatch and drift after I/O prevent writes; revoked removed sources remain removable',()=>attributed(async()=>{
  for(const status of [403,404]){
    const f=fixture();f.dependencies.document=async()=>{throw new AppError(status,'DOCUMENT_DENIED','Private source unavailable.');};
    await assert.rejects(()=>attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies),unavailable);
    assert.equal(f.state.reads,0);assert.equal(f.state.writes,0);
  }
  for(const change of ['fence','source','draft','native','part']){
    const f=fixture();f.state.afterRead=()=>{
      if(change==='fence')f.state.fence++;
      if(change==='source')f.state.denied=true;
      if(change==='draft')f.state.draft.revision++;
      if(change==='native')f.state.nativeDenied=true;
    };
    if(change==='part')f.dependencies.result=async()=>({...structuredClone(docResult),native:{...docResult.native,parts:docResult.native.parts.map(part=>({...part,text:'[redacted]',sha256:sha256('[redacted]')}))}});
    await assert.rejects(()=>attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies));assert.equal(f.state.writes,0,change);
  }
  const f=fixture();await attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies);
  f.state.denied=true;const reads=f.state.reads;
  await assert.rejects(()=>readRegistryCityJSONReferencesTx(f.client,f.draftId,f.dependencies),unavailable);assert.equal(f.state.reads,reads);
  const one=f.state.draft.records[0].nativeExteriorReferences[0].id;
  await assert.rejects(()=>removeRegistryCityJSONReferencesTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:2,remove:[one]},f.dependencies),unavailable);
  const removed=await removeRegistryCityJSONReferencesTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:2,clearAll:true},f.dependencies);
  assert.equal(removed.draftRevision,3);assert.equal(f.state.reads,reads);assert(!Object.hasOwn(f.state.draft.records[0],'nativeExteriorReferences'));
}));

test('all retained/new/native/destination case gates precede row locks; changed case sets fail without acquiring a late gate',()=>attributed(async()=>{
  const f=fixture();await attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies);f.state.queries=[];
  await readRegistryCityJSONReferencesTx(f.client,f.draftId,f.dependencies);
  const firstRow=f.state.queries.findIndex(q=>/FOR (UPDATE|SHARE)/.test(q.sql)),gates=f.state.queries.slice(0,firstRow).filter(q=>q.sql.includes('pg_advisory_xact_lock'));
  const cases=[f.state.draft.case_id,f.candidate.input.caseId,input.caseId].sort();
  assert.deepEqual(gates.slice(0,cases.length).map(q=>q.args[0]),cases.map(id=>'registry-import:'+id));
  const addedCase='00000000-0000-4000-8000-000000000001';f.state.queries=[];
  await assert.rejects(()=>attachRegistryCityJSONReferencesTx(f.client,f.draftId,{...f.request,requestKey:randomUUID(),expectedDraftRevision:2,
    document:{...f.request.document,caseId:addedCase}},f.dependencies),unavailable);
  const rows=f.state.queries.findIndex(q=>/FOR (UPDATE|SHARE)/.test(q.sql));
  assert.deepEqual(f.state.queries.slice(0,rows).filter(q=>q.sql.includes('pg_advisory_xact_lock')).slice(0,4).map(q=>q.args[0]),
    [...cases,addedCase].sort().map(id=>'registry-import:'+id));
  const drift=fixture();await attachRegistryCityJSONReferencesTx(drift.client,drift.draftId,drift.request,drift.dependencies);drift.state.queries=[];
  drift.state.afterGate=()=>{drift.state.draft.records[0].nativeExteriorReferences[0].document.caseId=addedCase;};
  await assert.rejects(()=>readRegistryCityJSONReferencesTx(drift.client,drift.draftId,drift.dependencies),rejected(409));
  assert(!drift.state.queries.some(q=>q.sql.includes('pg_advisory_xact_lock')&&q.args[0]==='registry-import:'+addedCase));
  for(const during of ['gates','io']){
    const nativeDrift=fixture(),mutate=()=>{nativeDrift.state.draft.records[0].nativeExteriorCandidate.input.caseId=addedCase;};
    if(during==='gates')nativeDrift.state.afterGate=mutate;else nativeDrift.state.afterRead=mutate;
    await assert.rejects(()=>attachRegistryCityJSONReferencesTx(nativeDrift.client,nativeDrift.draftId,nativeDrift.request,nativeDrift.dependencies),rejected(409));
    assert(!nativeDrift.state.queries.some(q=>q.sql.includes('pg_advisory_xact_lock')&&q.args[0]==='registry-import:'+addedCase));
    assert.equal(nativeDrift.state.writes,0);
  }
}));

test('generic create/edit/review projections reject injection and candidate removal removes orphan private selections',()=>attributed(async()=>{
  const f=fixture();await attachRegistryCityJSONReferencesTx(f.client,f.draftId,f.request,f.dependencies);const record=f.state.draft.records[0];
  for(const value of [null,[],record.nativeExteriorReferences])assert.throws(()=>assertNoNativeCandidates([{nativeExteriorReferences:value}]),rejected(422));
  await assert.rejects(()=>createRegistryDraftTx(f.client,f.state.site.id,undefined,{...record,nativeExteriorCandidate:undefined},randomUUID()),rejected(422));
  const projected=[publicRegistryBody(record),...publicRegistryDraft({records:[record]}).records,
    ...publicRegistryReview({records:[record],before:[record]}).before];
  for(const body of projected){assert(!Object.hasOwn(body,'nativeExteriorReferences'));assert(!Object.hasOwn(body,'nativeExteriorCandidate'));assert.deepEqual(body.footprint,[]);}
  assert(!recordBodySchema.safeParse({...publicRegistryBody(record),nativeExteriorReferences:'caller text'}).success);
  f.state.denied=true;f.state.nativeDenied=true;const reads=f.state.reads;
  const removed=await removeRegistryCityJSONDraftTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:2,recordId:f.recordId});
  assert.equal(removed.draftRevision,3);assert.equal(f.state.reads,reads);assert(!Object.hasOwn(f.state.draft.records[0],'nativeExteriorReferences'));
  assert(!Object.hasOwn(f.state.draft.records[0],'nativeExteriorCandidate'));assert.deepEqual(f.state.draft.records[0].footprint,[]);
}));

test('canonical document helper scopes opaque job/source IDs and fences exact accepted input/result/access',()=>attributed(async()=>{
  // Isolated query-only registration control under current measured reader pins,
  // using the unchanged source. It is not a newly accepted operational job.
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null};
  const source={...preparation.after.source,family_id:input.familyId,inspection:{documentOriginal:{version:'source-document/1',
    subject:input.subject,format:'csv',sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:preparation.runAt}}};
  const control=documentInput({current,source,binding:ingestionBinding(input.caseId),context:fingerprint({frame:null,context:null,siteId:null}),latest:true},input.jobId,'native_only');
  let completedHash=selection.document.resultSha256;const queries:string[]=[];
  const client={query:async(sql:string,args:any[])=>{
    queries.push(sql);
    if(sql.includes('FROM cases'))return {rows:[current]};
    if(sql.includes('max(revision)'))return {rows:[{revision:source.revision}]};
    if(sql.includes('FROM sources'))return {rows:[source]};
    if(sql.includes('JOIN usp_job_metadata'))return {rows:[{status:'succeeded',logical_state:'succeeded',payload:control,
      input_sha256:fingerprint(control),result_ref:{sha256:completedHash},completion_sha256:completedHash}]};
    if(sql.includes('SELECT payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3'))
      return {rows:args[0]===control.jobId&&args[1]===control.caseId&&args[2]===control.sourceId?[{payload:control}]:[]};
    if(sql.includes('FROM jobs'))return {rows:[{payload:control,input_fingerprint:fingerprint(control)}]};
    return {rows:[{job_id:control.jobId}]};
  }} as unknown as PoolClient;
  assert.deepEqual(await associationDocumentInputTx(client,localRequestContext('control'),selection.document,undefined,true),control);
  await assert.rejects(()=>associationDocumentInputTx(client,localRequestContext('control'),{...selection.document,jobId:randomUUID()}),rejected(404));
  completedHash='0'.repeat(64);await assert.rejects(()=>associationDocumentInputTx(client,localRequestContext('control'),selection.document),rejected(409));
  completedHash=selection.document.resultSha256;current.archived=true;
  await assert.rejects(()=>associationDocumentInputTx(client,localRequestContext('control'),selection.document),rejected(403));
  assert(queries.some(sql=>sql.includes('FOR UPDATE')));assert(!queries.some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)));
}));

test('accepted reference enrollment selects five exact EPSG/3DBAG lines across both cases without approving applicability or changing the native CRS',()=>attributed(async()=>{
  // Accepted at lead 310f20c; exact full result bytes are read from retained
  // files. Authority remains a snapshot double, not current DB authority in
  // this code-only checkout (its physical document-reader digest is reported).
  const manifest=json('desktop-cityjson-reference-binding/accepted-enrollment-manifest.json');
  assert.equal(sha256(readFileSync(manifest.verificationReceipt.path)),manifest.verificationReceipt.sha256);
  const documents=manifest.enrollments.map((entry:any)=>{
    const bytes=readFileSync(entry.resultPrivateCopy);assert.equal(bytes.length,entry.resultBytes);assert.equal(sha256(bytes),entry.resultSha256);
    const result=DocumentResultSchema.parse(JSON.parse(bytes.toString('utf8')));
    assert.equal(fingerprint(result.input),entry.inputSha256);assert.equal(result.input.readerSha256,entry.readerSha256);
    assert.equal(entry.acceptedFence,1);
    const source=readFileSync(entry.sourceOriginal.privatePath);assert.equal(source.length,entry.sourceBytes);assert.equal(sha256(source),entry.sourceSha256);
    const lines=source.toString('utf8').split(/\r?\n/),parts=entry.selectedParts.map((selected:any)=>{
      const part=result.native.parts.find(p=>p.id===selected.id)!;assert(part);
      assert.equal(part.text,lines[part.locator.line!-1]);assert.equal(part.sha256,selected.sha256);assert.equal(sha256(part.text),part.sha256);
      assert.deepEqual(part.locator,selected.locator);return part;
    });
    const pin={caseId:entry.caseId,caseRevision:entry.caseRevision,sourceId:entry.sourceId,sourceRevision:entry.sourceRevision,
      sourceSha256:entry.sourceSha256,jobId:entry.jobId,resultSha256:entry.resultSha256};
    return {entry,result,parts,pin};
  });
  const f=fixture(),initialRecord=structuredClone(f.state.draft.records[0]),denied=new Set<string>(),checks:string[]=[];
  const dependencies={...f.dependencies,
    document:async(_c:PoolClient,_ctx:unknown,pin:any,expected?:any)=>{
      checks.push(pin.caseId);const document=documents.find((v:any)=>v.pin.caseId===pin.caseId&&v.pin.jobId===pin.jobId&&v.pin.sourceId===pin.sourceId);
      if(!document||denied.has(pin.caseId))throw new AppError(404,'DOCUMENT_UNAVAILABLE','Snapshot unavailable.');
      if(fingerprint(pin)!==fingerprint(document.pin)||(expected&&fingerprint(expected)!==fingerprint(document.result.input)))
        throw new AppError(409,'DOCUMENT_PIN','Snapshot document input/result changed.');
      return document.result.input;
    },result:async(enrolled:any,resultHash:string)=>{
      const document=documents.find((v:any)=>v.result.input.jobId===enrolled.jobId)!;
      assert.equal(resultHash,document.entry.resultSha256);f.state.reads++;return structuredClone(document.result);
    }};
  let revision=1;
  for(const document of documents){
    const request={requestKey:randomUUID(),expectedDraftRevision:revision,document:document.pin,partIds:document.parts.map((p:any)=>p.id)};
    const receipt=await attachRegistryCityJSONReferencesTx(f.client,f.draftId,request,dependencies);assert.equal(receipt.draftRevision,++revision);
    assert.deepEqual(await attachRegistryCityJSONReferencesTx(f.client,f.draftId,request,dependencies),receipt);
  }
  const read=await readRegistryCityJSONReferencesTx(f.client,f.draftId,dependencies);assert.equal(read.references.length,5);
  assert.equal(read.referenceDeclaration.crs,'EPSG:7415');assert.equal(read.referenceDeclaration.qualification,'not_assessed');
  assert.equal(read.reviewedReference,'not_assessed');assert.equal(read.accuracyMetres,null);assert.equal(read.globalPlacement,'not_qualified');
  assert(read.references.some(v=>v.part.text.includes('EPSG:4978')));assert(read.references.every(v=>v.pin.accuracy==='not_assessed'&&v.pin.applicability==='not_assessed'));
  const {nativeExteriorReferences:_private,...unchanged}=f.state.draft.records[0];assert.deepEqual(unchanged,initialRecord);
  assert.throws(()=>assertCityJSONValidationAuthority(validation.input,{draft:f.state.draft,site:f.state.site,record:f.state.draft.records[0],candidate:f.candidate}),rejected(409));
  const html=documents.find((v:any)=>v.entry.id==='3dbagapi'),redacted=html.result.native.parts.find((part:any)=>/\[redacted/i.test(part.text));assert(redacted);
  await assert.rejects(()=>attachRegistryCityJSONReferencesTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:revision,
    document:html.pin,partIds:[redacted.id]},dependencies),rejected(422));assert.equal(f.state.writes,2);
  const xml=documents.find((v:any)=>v.entry.id==='epsg7415');denied.add(xml.pin.caseId);const beforeChecks=checks.length;
  const removed=await removeRegistryCityJSONReferencesTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:revision,
    remove:read.references.filter(v=>v.pin.document.caseId===xml.pin.caseId).map(v=>v.pin.id)},dependencies);
  assert.equal(removed.draftRevision,++revision);assert(checks.slice(beforeChecks).every(id=>id===html.pin.caseId));
  const retained=await readRegistryCityJSONReferencesTx(f.client,f.draftId,dependencies);assert.equal(retained.references.length,2);
  const cleared=await removeRegistryCityJSONReferencesTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:revision,clearAll:true},dependencies);
  assert.equal(cleared.draftRevision,++revision);assert.deepEqual(f.state.draft.records[0],initialRecord);
  const output=process.env.ULPIN_CITYJSON_REFERENCE_ENROLLMENT_OUTPUT;
  if(output){assert(!existsSync(output));writeFileSync(output,JSON.stringify({read,removed,retained,cleared,
    acceptedEnrollmentCommit:'310f20c7318e6b7431bab783e004a2c0cdcb087e',acceptedDocumentReaderSha256:documents[0].entry.readerSha256,
    currentCheckoutDocumentReaderSha256:documentReaderSha(),sourceContextChanged:false,protocolOnly:true},null,2)+'\n',{flag:'wx'});}
}));
