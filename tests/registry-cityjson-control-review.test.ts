import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {RegistryCityJSONReadSchema} from '../packages/contracts/src/registry-cityjson-draft';
import {RegistryCityJSONControlReviewRequestSchema} from '../packages/contracts/src/registry-cityjson-control-review';
import {assessCityJSONControls,type CityJSONControlDependencies} from '../packages/server/src/modules/registry/cityjson-control-assessment';
import {createRegistryCityJSONControlReview,readRegistryCityJSONControlReview,readRegistryCityJSONControlReviewForAuthorityTx,
  cityjsonControlDocumentCache} from '../packages/server/src/modules/registry/cityjson-control-review';
import {assessCityJSONAdmission} from '../packages/server/src/modules/registry/cityjson-admission';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

const root='E:/BhuAayam-data/task-data/',json=(name:string)=>JSON.parse(readFileSync(root+name,'utf8'));
const snapshot=json('desktop-cityjson-reference-runtime/final.json');
const nativeView=json('desktop-cityjson-validation-runtime/native-after.json').body;
const referencesView=json('desktop-cityjson-reference-runtime/read-restored-five.json').body;
const evidence:Record<string,unknown>={scope:'Retained revision-5 missing controls and isolated REF-CONTROL-01 arithmetic; authority/SQL doubles, not authentic survey/persistence.'};
after(()=>{if(process.env.ULPIN_CONTROL_REVIEW_OUTPUT)writeFileSync(process.env.ULPIN_CONTROL_REVIEW_OUTPUT,JSON.stringify(evidence,null,2)+'\n');});
async function local(work:()=>Promise<void>){const old=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=snapshot.registry.drafts[0].records[0].nativeExteriorCandidate.input.subject;
  try{await work();}finally{if(old===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=old;}}
function fixture(technical=false){
  const draft=structuredClone(snapshot.registry.drafts[0]),site=structuredClone(snapshot.registry.sites[0]),record=draft.records[0],candidate=record.nativeExteriorCandidate;
  const native=RegistryCityJSONReadSchema.parse({...nativeView,draftRevision:draft.revision,candidate});
  const references=structuredClone(referencesView),sources:any[]=[];
  if(technical){
    // Exact existing REF-CONTROL-01 numerical protocol, never operational controls.
    draft.id=randomUUID();record.id=randomUUID();candidate.input.sourceId=randomUUID();candidate.input.caseId=randomUUID();
    candidate.input.sourceSha256='a'.repeat(64);candidate.input.sourceFamilyId=randomUUID();native.draftId=draft.id;native.recordId=record.id;
    native.native.encodedVertices=[[1,2,3],[4,5,6]];native.native.transform={scale:[2,3,4],translate:[10,20,30]};
    native.native.geometry={type:'MultiSurface',boundaries:[[[0,1,0]]]};
    candidate.selection.verticesSha256=fingerprint(native.native.encodedVertices);candidate.selection.transformSha256=fingerprint(native.native.transform);
    candidate.selection.geometrySha256=fingerprint(native.native.geometry);native.candidate=structuredClone(candidate);
    references.references=[[11,24,40],[20,34,57]].map((coordinates,index)=>{
      const sourceId=randomUUID(),text=JSON.stringify({version:'native-point-control/1',controlId:`technical-control-${index}`,
        targetObjectId:candidate.selection.objectId,frame:{id:'EPSG:7415',axes:['easting','northing','height'],unit:'m',vertical:'NAP'},
        acquisition:{method:'independent_survey',observedAt:'2026-10-02T00:00:00Z',issuer:'technical protocol control'},coordinates});
      const locator={label:'Technical literal line',line:1,characterStart:0,characterEnd:text.length},partId=randomUUID();
      const document={caseId:randomUUID(),caseRevision:1,sourceId,sourceRevision:1,sourceSha256:sha256(`technical-original-${index}`),jobId:randomUUID(),resultSha256:'a'.repeat(64)};
      sources.push({id:sourceId,family_id:randomUUID(),sha256:document.sourceSha256,inspection:{}});
      const pin={...references.references[0].pin,id:sha256(`technical-reference-${index}`),document,partId,partSha256:sha256(text),locator};
      return {pin,part:{id:partId,sourceId,sourceRevision:1,sourceSha256:document.sourceSha256,text,sha256:sha256(text),locator,method:'native_text'}};
    });
  }
  const aggregate={current:{draft,site,record,candidate},references},operations=new Map<string,any>();
  const state={refs:0,nativeReads:0,inserts:0,denied:false,changeAtPublication:false,transaction:0};
  const operation=(args:any[])=>JSON.stringify(args.slice(0,3));
  const client={query:async(sql:string,args:any[]=[])=>{
    if(sql.includes('FROM sources'))return {rows:structuredClone(sources)};
    if(sql.includes('SELECT payload_hash,result FROM operations'))return {rows:operations.has(operation(args))?[structuredClone(operations.get(operation(args)))]:[]};
    if(sql.startsWith('INSERT INTO operations')){assert.equal(state.transaction%3,0);assert(!operations.has(operation(args)));
      operations.set(operation(args),{payload_hash:args[3],result:structuredClone(args[4])});state.inserts++;return {rows:[]};}
    throw Error('Unexpected control-review SQL: '+sql);
  }};
  const deps:CityJSONControlDependencies={transaction:async work=>{state.transaction++;return work(client as any);},
    references:async()=>{state.refs++;if(state.denied)throw new AppError(403,'TECHNICAL_DENIED','Technical source revoked');
      if(state.changeAtPublication&&state.refs===3)site.revision++;return structuredClone(aggregate);},
    native:async()=>{state.nativeReads++;return structuredClone(native);}};
  const comparison={expectedDraftRevision:draft.revision,candidateSha256:fingerprint(candidate),selectionSha256:fingerprint(candidate.selection),
    referencesSha256:fingerprint(references.references.map((entry:any)=>entry.pin)),correspondences:technical?references.references.map((entry:any,index:number)=>({
      referenceId:entry.pin.id,nativeVertexIndex:index,review:{correspondence:'reviewed',independentAcquisition:'reviewed',basis:'Technical protocol only; not authentic accuracy.'}})):[]};
  const request=async(disposition:'reviewed'|'needs_input'|'rejected')=>{
    const assessment=await assessCityJSONControls(draft.id,comparison,deps);state.transaction=0;state.refs=0;
    return {requestKey:randomUUID(),comparison,expectedAssessmentSha256:assessment.assessmentSha256,
      decision:{disposition,rationale:technical?'Review of isolated arithmetic only; not a tolerance or accuracy pass.':'Retained genuine source notes supply no independent point controls.'}};
  };
  return {draft,aggregate,native,sources,state,deps,operations,request};
}
test('retained missing controls save/read/replay privately and add only an explicit admission summary',()=>local(async()=>{
  const f=fixture(),request=await f.request('needs_input');
  const saved=await createRegistryCityJSONControlReview(f.draft.id,request,f.deps);
  assert.equal(saved.assessment.state,'needs_input');assert.equal(saved.assessment.metrics,null);
  assert.equal(saved.assessment.missing[0].reasonCode,'independent_point_controls_missing');
  assert.equal((saved as any).request,undefined);assert.equal((saved as any).reviewContext,undefined);
  assert.deepEqual(await readRegistryCityJSONControlReview(f.draft.id,saved.id,f.deps),saved);
  assert.deepEqual(await createRegistryCityJSONControlReview(f.draft.id,request,f.deps),saved);assert.equal(f.state.inserts,1);
  const stored=[...f.operations.values()][0].result;assert.deepEqual(stored.request,request);
  const dependencies={...f.deps,review:async()=>{assert.fail('No convention review selected');},validation:async()=>{assert.fail('No validation selected');},
    status:async()=>{assert.fail('No validation selected');},controlReview:readRegistryCityJSONControlReviewForAuthorityTx};
  const omitted=await assessCityJSONAdmission(f.draft.id,{expectedDraftRevision:f.draft.revision},dependencies as any);
  assert.equal(omitted.controlReview,undefined);
  const admission=await assessCityJSONAdmission(f.draft.id,{expectedDraftRevision:f.draft.revision,controlReviewId:saved.id},dependencies as any);
  assert.equal(admission.controlReview?.id,saved.id);assert.equal((admission.controlReview as any).rationale,undefined);
  assert(admission.actions.some(action=>action.kind==='inspect_control_review'));
  assert.equal(admission.findings.referenceAccuracy,'not_assessed');assert.equal(admission.capabilities.recordNativeExterior,false);
  assert(admission.sufficiency.missing.includes('reference_accuracy_check'));assert(admission.sufficiency.missing.includes('native_admission_review'));
  evidence.missing={saved,admission,storedRequestRetained:true,inserts:f.state.inserts};
}));
test('existing arithmetic comparison can be reviewed exactly without accuracy or learning approval',()=>local(async()=>{
  const f=fixture(true),request=await f.request('reviewed');
  const saved=await createRegistryCityJSONControlReview(f.draft.id,request,f.deps);
  assert.deepEqual(saved.assessment.points.map(point=>point.residual),[[1,2,2],[-2,1,-3]]);
  assert.equal(saved.accuracy,'not_assessed');assert.equal(saved.learningQualification,'not_assessed');assert.equal(saved.admission,'unavailable');
  assert.deepEqual(await readRegistryCityJSONControlReview(f.draft.id,saved.id,f.deps),saved);
  assert.deepEqual(await createRegistryCityJSONControlReview(f.draft.id,request,f.deps),saved);
  assert.equal(f.state.inserts,1);
  await assert.rejects(()=>createRegistryCityJSONControlReview(f.draft.id,{...request,decision:{...request.decision,disposition:'rejected'}},f.deps),(error:any)=>error.status===409);
  f.sources[0].inspection={copiedFrom:'changed authority'};
  await assert.rejects(()=>readRegistryCityJSONControlReview(f.draft.id,saved.id,f.deps),(error:any)=>error.status===409);
  f.state.denied=true;await assert.rejects(()=>readRegistryCityJSONControlReview(f.draft.id,saved.id,f.deps),(error:any)=>error.status===404);
  evidence.technical={saved,inserts:f.state.inserts,changedAndRevokedAuthorityDenied:true};
}));
test('incomplete or stale publication cannot be reviewed or inserted and caller metrics are rejected',()=>local(async()=>{
  const missing=fixture(),request=await missing.request('reviewed');
  await assert.rejects(()=>createRegistryCityJSONControlReview(missing.draft.id,request,missing.deps),(error:any)=>error.status===409);
  assert.equal(missing.operations.size,0);
  assert(!RegistryCityJSONControlReviewRequestSchema.safeParse({...request,metrics:{rmse3DMetres:0}}).success);
  const stale=fixture(true),valid=await stale.request('reviewed');stale.state.changeAtPublication=true;
  await assert.rejects(()=>createRegistryCityJSONControlReview(stale.draft.id,valid,stale.deps),(error:any)=>error.status===409);
  assert.equal(stale.operations.size,0);assert.equal(stale.state.nativeReads,2);
  evidence.denials={incompleteReview:true,callerMetrics:true,publicationAuthority:true,noInsertedReceipt:true};
}));
test('publication document cache refuses new identities without private object I/O',async()=>{
  let reads=0;const input={jobId:randomUUID()} as any;
  const cache=cityjsonControlDocumentCache(async()=>{reads++;return {version:'technical-cache-result',input} as any;});
  const first=await cache.result(input,'a'.repeat(64));cache.publication();
  const current=await cache.result(input,'a'.repeat(64));assert.deepEqual(current,first);assert.equal(reads,1);
  await assert.rejects(()=>cache.result(input,'b'.repeat(64)),(error:any)=>error.status===409);assert.equal(reads,1);
  evidence.publicationCache={privateReads:reads,unknownIdentityDenied:true};
});
