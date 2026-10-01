import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {CITYJSON_REFERENCE_REVIEW_VERSION,RegistryCityJSONReferenceReviewRequestSchema,CITYJSON_ADMISSION_MAX_BYTES} from '../packages/contracts/src';
import {createRegistryCityJSONReferenceReviewTx,readRegistryCityJSONReferenceReviewTx,
  readRegistryCityJSONReferenceReviewForAuthorityTx} from '../packages/server/src/modules/registry/cityjson-reference-review';
import {readRegistryCityJSONReferenceAuthorityTx} from '../packages/server/src/modules/registry/cityjson-reference';
import {registryCityJSONAuthorityTx,readRegistryCityJSONDraftTx} from '../packages/server/src/modules/registry/cityjson-draft';
import {assessCityJSONAdmission} from '../packages/server/src/modules/registry/cityjson-admission';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

// Accepted real revision-5 snapshot, original results and unchanged native bytes;
// transaction/authority doubles only. Notes below are scoped operator judgments,
// not measured controls, historical applicability, operational writes or labels.
const root=(process.env.ULPIN_CITYJSON_REFERENCE_REVIEW_CONTROL_ROOT??'E:/BhuAayam-data/task-data').replace(/[\\/]?$/,'/');
const json=(p:string)=>JSON.parse(readFileSync(root+p,'utf8'));
const snapshot=json('desktop-cityjson-reference-runtime/final.json');
const manifest=json('desktop-cityjson-reference-binding/accepted-enrollment-manifest.json');
const candidate=snapshot.registry.drafts[0].records[0].nativeExteriorCandidate;
async function attributed(work:()=>Promise<void>){const old=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=candidate.input.subject;
  try{await work();}finally{if(old===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=old;}}
const status=(code:number)=>(e:any)=>e.status===code;
function fixture(){
  const draft=structuredClone(snapshot.registry.drafts[0]),site=structuredClone(snapshot.registry.sites[0]),record=draft.records[0];
  const docs=manifest.enrollments.map((e:any)=>{const bytes=readFileSync(e.resultPrivateCopy);assert.equal(sha256(bytes),e.resultSha256);
    return {e,result:JSON.parse(bytes.toString('utf8'))};});
  const nativeMeta=snapshot.retained.metadata.find((v:any)=>v.job_id===candidate.input.jobId);
  const nativeArtifact=readFileSync(root+'desktop-cityjson-api/native.json');assert.equal(sha256(nativeArtifact),candidate.artifact.sha256);
  const nativeResult={version:'cityjson-native/1',input:candidate.input,...json('desktop-cityjson-api/final-runtime-result.json').result};
  const state={tx:0,operations:new Map<string,any>(),queries:[] as {tx:number;sql:string;args:any[]}[],documents:0,receipts:0,nativeReads:0,reviewReads:0,
    denied:new Set<string>(),afterDocument:undefined as (()=>void)|undefined,afterNative:undefined as (()=>void)|undefined,
    afterLookup:undefined as (()=>void)|undefined};
  const operation=(args:any[])=>`${args[0]}:${args[1]}:${args[2]}`;
  const client={query:async(sql:string,args:any[]=[])=>{
    state.queries.push({tx:state.tx,sql,args:structuredClone(args)});
    assert(!/^\s*(UPDATE|DELETE|ALTER|CREATE)\b/i.test(sql));let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('FROM registry_drafts'))rows=[structuredClone(draft)];
    else if(sql.includes('FROM registry_sites'))rows=[structuredClone(site)];
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:1}];
    else if(sql.includes('SELECT payload_hash,result FROM operations')){state.reviewReads++;const r=state.operations.get(operation(args));rows=r?[structuredClone(r)]:[];state.afterLookup?.();}
    else if(sql.startsWith('INSERT INTO operations')){
      assert.equal(args[2],CITYJSON_REFERENCE_REVIEW_VERSION);assert(!state.operations.has(operation(args)));
      state.operations.set(operation(args),{payload_hash:args[3],result:structuredClone(args[4])});state.receipts++;
    }else throw Error('Unexpected review control SQL: '+sql);
    return {rows,rowCount:rows.length};
  }} as unknown as PoolClient;
  const transaction:any=async(work:any)=>{state.tx++;const ops=structuredClone(state.operations),receipts=state.receipts;
    try{return await work(client);}catch(e){state.operations=ops;state.receipts=receipts;throw e;}};
  const accepted:any=async()=>({input:structuredClone(candidate.input),job:structuredClone(nativeMeta)});
  const refs={native:(c:PoolClient,id:string)=>registryCityJSONAuthorityTx(c,id,accepted),document:async(_c:PoolClient,_ctx:any,pin:any,expected?:any)=>{
    const doc=docs.find((v:any)=>v.e.caseId===pin.caseId&&v.e.jobId===pin.jobId);if(!doc||state.denied.has(pin.caseId))throw new AppError(403,'DOCUMENT_DENIED','Retained source denied.');
    if(expected)assert.equal(fingerprint(expected),fingerprint(doc.result.input));return structuredClone(doc.result.input);
  },result:async(input:any,hash:string)=>{const doc=docs.find((v:any)=>v.e.jobId===input.jobId);assert.equal(hash,doc.e.resultSha256);
    state.documents++;const value=structuredClone(doc.result);state.afterDocument?.();return value;}};
  const dependencies={references:(c:PoolClient,id:string,rev?:number)=>readRegistryCityJSONReferenceAuthorityTx(c,id,rev,refs)};
  const create=(raw:any)=>transaction((c:PoolClient)=>createRegistryCityJSONReferenceReviewTx(c,draft.id,raw,dependencies));
  const read=(id:string)=>transaction((c:PoolClient)=>readRegistryCityJSONReferenceReviewTx(c,draft.id,id,dependencies));
  const request={requestKey:randomUUID(),expectedDraftRevision:5,candidateSha256:fingerprint(candidate),selectionSha256:fingerprint(candidate.selection),
    referencesSha256:fingerprint(record.nativeExteriorReferences),conclusions:record.nativeExteriorReferences.map((p:any)=>({referenceId:p.id,
      purpose:docs.find((d:any)=>d.e.caseId===p.document.caseId).e.id==='epsg7415'?'reference_system_definition':'delivery_convention',
      disposition:'supported',rationale:'The selected literal excerpt supports the source-declared reference convention; no survey accuracy is inferred.'})),
    objectControls:{disposition:'needs_input',rationale:'Independent known-coordinate/height controls and exact retained API-to-release applicability remain missing from these excerpts.'}};
  const admissionDependencies:any={transaction,...dependencies,review:readRegistryCityJSONReferenceReviewForAuthorityTx,
    native:(c:PoolClient,id:string)=>readRegistryCityJSONDraftTx(c,id,{accepted,result:async()=>structuredClone(nativeResult),artifact:async()=>{
      state.nativeReads++;const b=Buffer.from(nativeArtifact);state.afterNative?.();return b;}} as any),
    validation:async()=>assert.fail('No validation selected'),status:async()=>assert.fail('No validation selected')};
  return {draft,site,record,docs,state,client,request,create,read,admissionDependencies};
}

test('retained five-part officer review creates/read/replays one immutable note and admission shows only explicit scoped support',()=>attributed(async()=>{
  const f=fixture(),before=structuredClone(f.draft),started=Date.now(),review=await f.create(f.request);
  assert.equal(review.outcome,'supports_declared_convention');assert.equal(review.objectControls.disposition,'needs_input');
  assert.equal(review.accuracyMetres,null);assert.equal(review.admission,'unavailable');assert.equal(review.currentness,'current_authority');
  assert(Date.parse(review.reviewedAt)>=started);assert.equal(review.attribution,'local_process');assert.equal(f.state.receipts,1);
  assert.deepEqual(await f.read(review.id),review);assert.deepEqual(await f.create(f.request),review);assert.equal(f.state.receipts,1);
  assert.deepEqual(f.draft,before);const stored=[...f.state.operations.values()][0];assert.equal(stored.result.reviewContext.subject,candidate.input.subject);
  const {reviewSha256,...body}=stored.result;assert.equal(reviewSha256,fingerprint(body));
  const omitted=await assessCityJSONAdmission(f.draft.id,{expectedDraftRevision:5},f.admissionDependencies),queries=f.state.reviewReads;
  assert(!Object.hasOwn(omitted,'referenceReview'));assert(!omitted.actions.some(action=>action.kind==='inspect_reference_review'));assert.equal(queries,3);
  const assessment=await assessCityJSONAdmission(f.draft.id,{expectedDraftRevision:5,referenceReviewId:review.id},f.admissionDependencies);
  assert.equal(assessment.referenceReview?.id,review.id);assert.equal(assessment.referenceReview?.outcome,'supports_declared_convention');
  assert.equal(assessment.referenceReview?.objectControls,'needs_input');assert.equal(assessment.reference.reviewedReference,'not_assessed');
  assert.equal(assessment.reference.referenceEvidence,'not_bound');assert.deepEqual(assessment.sufficiency.missing,omitted.sufficiency.missing);
  assert(assessment.actions.some(action=>action.kind==='inspect_reference_review'&&action.path.endsWith(review.id)));
  assert.equal(assessment.capabilities.recordNativeExterior,false);assert.equal(assessment.capabilities.qualifyGeometry,false);
  assert.equal(assessment.validation,null);const text=JSON.stringify(assessment);assert(Buffer.byteLength(text)<=CITYJSON_ADMISSION_MAX_BYTES);
  for(const value of ['subject','rationale','objectKey','C:/','E:/',f.request.objectControls.rationale])assert(!text.includes(value));
  for(const part of review.conclusions)assert(!text.includes(part.rationale));
  assert(!JSON.stringify(review).includes('subject'));assert.equal(f.state.nativeReads,2);assert.deepEqual(f.draft,before);
  const insert=f.state.queries.findIndex(q=>q.sql.startsWith('INSERT'));assert(insert>0);
  const prior=f.state.queries.slice(0,insert);assert(prior.some(q=>q.sql.includes('SELECT * FROM registry_drafts')));
  const expectedCases=[...new Set([f.draft.case_id,candidate.input.caseId,...f.record.nativeExteriorReferences.map((p:any)=>p.document.caseId)])].sort();
  for(const tx of [...new Set(f.state.queries.map(q=>q.tx))]){const calls=f.state.queries.filter(q=>q.tx===tx),firstRow=calls.findIndex(q=>/FOR (UPDATE|SHARE)/.test(q.sql));
    assert.deepEqual(calls.slice(0,firstRow).filter(q=>q.sql.includes('pg_advisory_xact_lock')).map(q=>q.args[0]),expectedCases.map(id=>`registry-import:${id}`));}
  const output=process.env.ULPIN_CITYJSON_REFERENCE_REVIEW_CONTROL_OUTPUT;if(output){assert(!existsSync(output));writeFileSync(output,
    JSON.stringify({noServiceControl:true,operatorJudgmentNotTruth:true,review,assessment,stored,queries:f.state.queries,draftUnchanged:true,receiptInsertions:1},null,2)+'\n',{flag:'wx'});}
}));

test('wrong selection pins, changed request keys and unsupported control claims never append or silently qualify reviews',()=>attributed(async()=>{
  const f=fixture(),review=await f.create(f.request);await assert.rejects(()=>f.create({...f.request,objectControls:{...f.request.objectControls,rationale:'Changed conclusion'}}),status(409));
  assert.equal(f.state.receipts,1);const missing='0'.repeat(64);await assert.rejects(()=>f.read(missing),status(404));
  await assert.rejects(()=>assessCityJSONAdmission(f.draft.id,{expectedDraftRevision:5,referenceReviewId:missing},f.admissionDependencies),status(404));
  const invalid=fixture();await assert.rejects(()=>invalid.create({...invalid.request,selectionSha256:missing}),status(409));assert.equal(invalid.state.receipts,0);
  await assert.rejects(()=>invalid.create({...invalid.request,conclusions:invalid.request.conclusions.slice(1)}),status(409));
  for(const extra of [{accuracyMetres:0},{reviewedAt:new Date().toISOString()},{reviewer:'operator'},{id:review.id}])
    assert(!RegistryCityJSONReferenceReviewRequestSchema.safeParse({...f.request,...extra}).success);
  assert(!RegistryCityJSONReferenceReviewRequestSchema.safeParse({...f.request,objectControls:{...f.request.objectControls,disposition:'supported'}}).success);
  assert(!RegistryCityJSONReferenceReviewRequestSchema.safeParse({...f.request,conclusions:[{...f.request.conclusions[0],purpose:'object_control_applicability'}]}).success);
  const conflicting=fixture();conflicting.request.conclusions[0].disposition='conflicting';assert.equal((await conflicting.create(conflicting.request)).outcome,'conflicting');
}));

test('stale/revoked reference/native/access authority fails before insert and makes explicit saved review stale without rewriting it',()=>attributed(async()=>{
  const stale=fixture();await assert.rejects(()=>stale.create({...stale.request,expectedDraftRevision:4}),status(409));assert.equal(stale.state.documents,0);
  for(const phase of ['before','during'] as const){const f=fixture();if(phase==='before')f.state.denied.add(f.docs[0].e.caseId);
    else f.state.afterDocument=()=>f.state.denied.add(f.docs[0].e.caseId);
    await assert.rejects(()=>f.create(f.request),status(404));assert.equal(f.state.receipts,0);}
  const drift=fixture();drift.state.afterDocument=()=>drift.record.nativeExteriorReferences.pop();await assert.rejects(()=>drift.create(drift.request),status(409));assert.equal(drift.state.receipts,0);
  const access=fixture();access.state.afterLookup=()=>process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='changed-local-context';
  await assert.rejects(()=>access.create(access.request),status(404));assert.equal(access.state.receipts,0);process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=candidate.input.subject;
  const f=fixture(),review=await f.create(f.request),stored=structuredClone(f.state.operations),before=structuredClone(f.draft);
  f.site.name='Changed site context';await assert.rejects(()=>f.read(review.id),status(409));f.site.name=snapshot.registry.sites[0].name;
  f.draft.revision++;await assert.rejects(()=>f.read(review.id),status(409));f.draft.revision--;
  f.state.denied.add(f.docs[0].e.caseId);await assert.rejects(()=>f.read(review.id),status(404));f.state.denied.clear();
  const originalIds=f.record.nativeExteriorReferences;f.record.nativeExteriorReferences=[];await assert.rejects(()=>f.read(review.id),status(409));f.record.nativeExteriorReferences=originalIds;
  f.state.afterNative=()=>f.site.name='Changed after native I/O';await assert.rejects(()=>assessCityJSONAdmission(f.draft.id,
    {expectedDraftRevision:5,referenceReviewId:review.id},f.admissionDependencies),status(409));f.site.name=snapshot.registry.sites[0].name;
  assert.deepEqual(f.state.operations,stored);assert.deepEqual(f.draft,before);assert.equal(f.state.receipts,1);
}));
