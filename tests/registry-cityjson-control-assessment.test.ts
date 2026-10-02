import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {RegistryCityJSONControlRequestSchema} from '../packages/contracts/src/registry-cityjson-control-assessment';
import {RegistryCityJSONReadSchema} from '../packages/contracts/src/registry-cityjson-draft';
import {assessCityJSONControls,type CityJSONControlDependencies} from '../packages/server/src/modules/registry/cityjson-control-assessment';
import {documentReviewContext} from '../packages/server/src/modules/registry/registry-document-evidence';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

const root='E:/BhuAayam-data/task-data/',json=(file:string)=>JSON.parse(readFileSync(root+file,'utf8'));
const snapshot=json('desktop-cityjson-reference-runtime/final.json');
const historicalNative=json('desktop-cityjson-validation-runtime/native-after.json').body;
const historicalReferences=json('desktop-cityjson-reference-runtime/read-restored-five.json').body;
const digest='a'.repeat(64);
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=snapshot.registry.drafts[0].records[0].nativeExteriorCandidate.input.subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(technical=false){
  const draft=structuredClone(snapshot.registry.drafts[0]),site=structuredClone(snapshot.registry.sites[0]);
  const record=draft.records[0],candidate=record.nativeExteriorCandidate;
  // Reconstruct a serving view from unchanged historical bytes and captured
  // revision-5 records. This is not a fresh accepted source/job envelope.
  const native=RegistryCityJSONReadSchema.parse({...historicalNative,draftRevision:draft.revision,candidate});
  const references=structuredClone(historicalReferences),sources:any[]=[];
  if(technical){
    // Explicit numerical protocol controls only. No operational controls,
    // current persistence, property fact or authentic accuracy is manufactured.
    draft.id=randomUUID();record.id=randomUUID();candidate.input.sourceId=randomUUID();candidate.input.caseId=randomUUID();
    native.draftId=draft.id;native.recordId=record.id;
    candidate.input.sourceSha256=digest;candidate.input.sourceFamilyId=randomUUID();
    native.candidate=structuredClone(candidate);native.native.encodedVertices=[[1,2,3],[4,5,6]];
    native.native.transform={scale:[2,3,4],translate:[10,20,30]};native.native.geometry={type:'MultiSurface',boundaries:[[[0,1,0]]]};
    candidate.selection.verticesSha256=fingerprint(native.native.encodedVertices);
    candidate.selection.transformSha256=fingerprint(native.native.transform);candidate.selection.geometrySha256=fingerprint(native.native.geometry);
    native.candidate=structuredClone(candidate);
    references.references=[[11,24,40],[20,34,57]].map((coordinates,index)=>{
      const sourceId=randomUUID(),text=JSON.stringify({version:'native-point-control/1',controlId:`technical-control-${index}`,
        targetObjectId:candidate.selection.objectId,frame:{id:'EPSG:7415',axes:['easting','northing','height'],unit:'m',vertical:'NAP'},
        acquisition:{method:'independent_survey',observedAt:'2026-10-02T00:00:00Z',issuer:'technical protocol control'},coordinates});
      const locator={label:'Technical literal line',line:1,characterStart:0,characterEnd:text.length},partId=randomUUID();
      const document={caseId:randomUUID(),caseRevision:1,sourceId,sourceRevision:1,sourceSha256:sha256(`technical-original-${index}`),
        jobId:randomUUID(),resultSha256:digest};
      sources.push({id:sourceId,family_id:randomUUID(),sha256:document.sourceSha256,inspection:{}});
      const pin={...references.references[0].pin,id:sha256(`technical-reference-${index}`),document,partId,partSha256:sha256(text),locator};
      return {pin,part:{id:partId,sourceId,sourceRevision:1,sourceSha256:document.sourceSha256,text,sha256:sha256(text),locator,method:'native_text'}};
    });
  }
  const aggregate={current:{draft,site,record,candidate},references};
  const request=RegistryCityJSONControlRequestSchema.parse({expectedDraftRevision:draft.revision,candidateSha256:fingerprint(candidate),
    selectionSha256:fingerprint(candidate.selection),referencesSha256:fingerprint(references.references.map((entry:any)=>entry.pin)),
    correspondences:technical?references.references.map((entry:any,index:number)=>({referenceId:entry.pin.id,nativeVertexIndex:index,
      review:{correspondence:'reviewed',independentAcquisition:'reviewed',basis:'Technical reviewed correspondence; not authentic accuracy.'}})):[]});
  const state={reads:0,queries:[] as string[],revoked:false};
  const client={query:async(sql:string)=>{state.queries.push(sql);assert(!/^(INSERT|UPDATE|DELETE)/.test(sql));return {rows:structuredClone(sources)};}};
  const deps:CityJSONControlDependencies={transaction:async action=>action(client as any),references:async()=>{
    state.reads++;if(state.revoked)throw new AppError(403,'DOCUMENT_DENIED','Technical revoked context');return structuredClone(aggregate);
  },native:async()=>structuredClone(native)};
  return {aggregate,native,sources,request,state,deps};
}
test('source-locator controls produce residuals after one native decode and retain honest qualification states',()=>local(async()=>{
  const f=fixture(true),result=await assessCityJSONControls(f.aggregate.current.draft.id,f.request,f.deps);
  assert.equal(result.state,'comparison_computed');assert.deepEqual(result.points.map(point=>point.nativePosition),[[12,26,42],[18,35,54]]);
  assert.deepEqual(result.points.map(point=>point.residual),[[1,2,2],[-2,1,-3]]);
  assert.deepEqual(result.metrics!.meanResidual,[-0.5,1.5,-0.5]);
  assert(Math.abs(result.metrics!.rmse3DMetres-Math.sqrt(11.5))<1e-12);
  assert(Math.abs(result.metrics!.rmseHorizontalMetres-Math.sqrt(5))<1e-12);
  assert(Math.abs(result.metrics!.maximum3DMetres-Math.sqrt(14))<1e-12);
  assert.equal(result.points[0].evidence.partSha256,sha256(f.aggregate.references.references[0].part.text));
  assert.equal(result.accuracy,'not_assessed');assert.equal(result.admission,'unavailable');assert.equal(result.learningQualification,'not_assessed');
  const {assessmentSha256,...body}=result;assert.equal(assessmentSha256,fingerprint(body));assert.equal(f.state.reads,2);
  const repeat=await assessCityJSONControls(f.aggregate.current.draft.id,f.request,f.deps);assert.deepEqual(repeat,result);
  if(process.env.ULPIN_CONTROL_ASSESSMENT_OUTPUT)writeFileSync(process.env.ULPIN_CONTROL_ASSESSMENT_OUTPUT,JSON.stringify({scope:'technical arithmetic; not authentic accuracy',result},null,2)+'\n');
}));
test('retained real sources lack independent controls; incomplete/incompatible or revoked inputs cannot become accuracy',()=>local(async()=>{
  const real=fixture(),missing=await assessCityJSONControls(real.aggregate.current.draft.id,real.request,real.deps);
  assert.equal(missing.state,'needs_input');assert.equal(missing.metrics,null);
  assert.equal(missing.missing[0].reasonCode,'independent_point_controls_missing');
  const incompatible=fixture(true),part=incompatible.aggregate.references.references[0].part;
  const control=JSON.parse(part.text);control.frame.vertical='unknown';part.text=JSON.stringify(control);part.sha256=sha256(part.text);
  const pin=incompatible.aggregate.references.references[0].pin;pin.partSha256=part.sha256;
  incompatible.request.referencesSha256=fingerprint(incompatible.aggregate.references.references.map((entry:any)=>entry.pin));
  const refused=await assessCityJSONControls(incompatible.aggregate.current.draft.id,incompatible.request,incompatible.deps);
  assert.equal(refused.state,'needs_input');assert.equal(refused.metrics,null);
  assert.equal(refused.points[0].reasonCode,'same_named_frame_axes_metres_required');
  assert(!RegistryCityJSONControlRequestSchema.safeParse({...real.request,coordinates:[1,2,3]}).success);
  const revoked=fixture(true);revoked.deps.native=async()=>{revoked.state.revoked=true;return revoked.native;};
  await assert.rejects(()=>assessCityJSONControls(revoked.aggregate.current.draft.id,revoked.request,revoked.deps),(error:any)=>error.status===404);
  assert.equal(documentReviewContext().subject,snapshot.registry.drafts[0].records[0].nativeExteriorCandidate.input.subject);
  if(process.env.ULPIN_CONTROL_MISSING_OUTPUT)writeFileSync(process.env.ULPIN_CONTROL_MISSING_OUTPUT,JSON.stringify({scope:'unchanged retained source/record fields; isolated current-authority dependencies',result:missing},null,2)+'\n');
}));
