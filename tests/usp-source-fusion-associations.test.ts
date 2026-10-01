import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {DocumentPartSchema,DocumentResultSchema,type DocumentInput} from '../packages/contracts/src/usp/document-ingestion';
import {DocumentAssociationTargetSchema} from '../packages/contracts/src/document-association';
import {RegistryDocumentAmendmentSchema} from '../packages/contracts/src/registry-document-evidence';
import {FusionAssociationRequestSchema,FusionAssociationResponseSchema} from '../packages/contracts/src/source-fusion-associations';
import {UspSnapshotScopeSchema,type RequestContext} from '../packages/contracts/src/usp/common';
import type {SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {ModelGatewayConfigSchema,hash} from '../packages/server/src/modules/model-gateway/config';
import {fusionContextProjection,fusionSourceProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {proposeFusionAssociations,type FusionAssociationDependencies} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {associationLiterals,validateFusionAssociations,exactIdentifier} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';

// Technical memory transport and explicitly stubbed outputs. No property facts,
// provider inference, accepted operational source envelope or accuracy oracle.
const digest='a'.repeat(64),subject='fusion-association-technical-control';
async function local(work:(ctx:RequestContext)=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work(localRequestContext(randomUUID()));}finally{
    if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;
  }
}
function fixture(){
  const rows=[false,true].map(ocr=>{
    const input:DocumentInput={version:'source-document/1',jobId:randomUUID(),caseId:randomUUID(),caseRevision:1,
      caseContextSha256:digest,sourceId:randomUUID(),familyId:randomUUID(),sourceRevision:1,sourceSha256:digest,sourceBytes:1,
      objectKey:'technical-memory-control',subject,accessSha256:digest,policyVersion:'source-document-native/1',readerSha256:digest,
      gatewayPolicySha256:null,layoutCap:null,mode:'native_only',...(ocr?{ocrSelection:{page:1},ocrConfigSha256:digest}:{})};
    const text=ocr?'Exact selected identifier TECH-FLOOR-0049; incomplete text':'Exact selected identifier TECH-BLDG-0049; supplied revision unknown';
    const part=DocumentPartSchema.parse({id:randomUUID(),sourceId:input.sourceId,sourceRevision:1,sourceSha256:digest,
      text,sha256:sha256(text),method:'native_text',locator:{label:'technical line',line:1,characterStart:0,characterEnd:text.length}});
    const result=DocumentResultSchema.parse({version:'source-document/1',input,
      native:{status:ocr?'needs_ocr':'extracted',format:ocr?'pdf':'text',readerSha256:digest,code:null,warnings:[],parts:ocr?[]:[part]},
      model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},createdAt:'2026-10-02T00:00:00Z',
      ...(ocr?{ocr:{sourceSha256:digest,sourceRevision:1,sourcePage:1,requestedRegion:null,
        sourcePageFrame:{kind:'pdf_display_page_top_left_points',rotation:0,width:400,height:500},
        method:'ocr:tesseract-cli-5.5.1:sparse-tsv-v1',toolStatus:'complete',outputStatus:'partial',textCompleteness:'unverified',
        issues:['technical_incomplete_text'],items:[{text,label:'text',method:'ocr:tesseract-cli-sparse-tsv',sourcePageBoxes:[{
          pageNumber:1,frame:'pdf_display_page_top_left_points',box:[10,20,100,40],derivedFrom:'tesseract_tsv_pixels_via_mupdf_pixel_origin'}]}]}}:{})});
    const pin={caseId:input.caseId,caseRevision:1,sourceId:input.sourceId,sourceRevision:1,sourceSha256:digest,jobId:input.jobId,
      readerSha256:digest,inputSha256:fingerprint(input),acceptedFence:1,resultSha256:sha256(JSON.stringify(result)),
      resultBytes:Buffer.byteLength(JSON.stringify(result))};
    const selection:SourceFusionSelection=ocr?{kind:'document_ocr',pin,itemOrdinals:[0]}:{kind:'document',pin,partIds:[part.id]};
    return {input,result,selection};
  });
  const context=fusionContextProjection(rows.map(row=>fusionSourceProjection(row.selection,{kind:'document',result:row.result}))
    .sort((a,b)=>a.pin.caseId.localeCompare(b.pin.caseId)||a.pin.sourceId.localeCompare(b.pin.sourceId)));
  const scope=UspSnapshotScopeSchema.parse({kind:'snapshot',scopeId:randomUUID(),world:{namespace:'world',id:'planned'},
    manifestId:'technical-manifest',snapshotDigest:digest,stage:'recorded'});
  const targets=['TECH-BLDG-0049','TECH-FLOOR-0049'].map((value,index)=>DocumentAssociationTargetSchema.parse({
    pin:{ref:{namespace:'registry_record',id:randomUUID()},revision:1},kind:index?'floor':'building',label:'Technical target',
    identifiers:[{scheme:'technical-id',value,issuer:null,source:null,state:'reviewed'}],recordState:'recorded',
    relationsWithinSelection:[],relationshipCoverage:'partial',sourceEvidence:'available',synthetic:true}));
  const request=FusionAssociationRequestSchema.parse({requestKey:randomUUID(),context:{contextSha256:context.contextSha256,
    selection:{sources:rows.map(row=>row.selection)}},scope,targets:targets.map(target=>target.pin)});
  const literals=associationLiterals(context);
  const output={suggestions:targets.map(target=>{const literal=literals.find(l=>l.text.includes(target.identifiers[0].value))!;
    return {targetId:target.pin.ref.id,scheme:'technical-id',matchedIdentifier:target.identifiers[0].value,
      citations:[{key:literal.citation.key,quote:literal.text}],rationale:'Inspect this explicitly selected exact identifier.'};}),abstentions:[]};
  const config=ModelGatewayConfigSchema.parse({projectId:'technical-control',policyVersion:'technical-policy',fundingVersion:'technical-funding',
    gatewayExclusiveFunding:true,indiaPrivateApproved:true,secretReference:'ULPIN_PROVIDER_KEY_TECHNICAL_CONTROL',model:'sarvam-105b',
    projectCapMicroInr:'100',principalDailyCallCap:10,price:{version:'technical-price',inputPerMillionMicroInr:'1',
      cachedInputPerMillionMicroInr:'1',outputPerMillionMicroInr:'1'},inputBound:{version:'technical-bound',maxPromptTokens:34816},
    maxOutputTokens:2048,timeoutMs:1000,paceMs:1500});
  const state={policy:hash(config) as string|undefined,sourceRevoked:false,targetDrift:false,calls:0,factoryCalls:0,rechecks:0,
    afterCall:()=>{},output:structuredClone(output),trusted:undefined as any,messages:undefined as any};
  const deps:FusionAssociationDependencies={capture:async()=>({context:structuredClone(context),unsupportedCitationSources:[],revalidate:async()=>{
    state.rechecks++;if(state.sourceRevoked)throw new AppError(403,'DOCUMENT_DENIED','Technical revoked source');}}),
    targets:async()=>structuredClone(state.targetDrift?targets.map(target=>({...target,pin:{...target.pin,revision:2}})):targets),
    citationSites:async(_ctx,siteId)=>assert.equal(siteId,scope.scopeId),policy:()=>state.policy,
    gateway:async()=>{state.factoryCalls++;return {config,port:trusted=>{
      state.trusted=trusted;return {modelGateway:async(_ctx,input)=>{
        assert.equal(trusted.attempt,1);assert.equal(trusted.consumer,'INGEST');assert.equal(trusted.taskKind,input.taskKind);
        assert.equal(trusted.outputSchemaId,input.outputSchemaId);await trusted.authorize();
        state.calls++;state.messages=(input.input as any).messages;state.afterCall();
        return {state:'available',data:{output:trusted.minimizeOutput(state.output) as any,modelId:config.model,
          outputSchemaId:input.outputSchemaId,evidenceRefs:[],replayed:false}};
      }};
    }};}};
  return {rows,context,scope,targets,request,literals,output,state,deps};
}
test('grounded native/OCR proposals carry exact provenance and a narrowed selection accepted by the existing manual adapter',()=>local(async ctx=>{
  const f=fixture(),response=await proposeFusionAssociations(ctx,f.request,f.deps);
  assert(FusionAssociationResponseSchema.safeParse(response).success);assert.equal(response.state,'proposed');
  assert.equal(f.state.calls,1);assert.equal(response.proposals.length,2);assert(f.state.rechecks>=2);
  assert.equal(response.provenance.method,'governed_model_gateway');assert.equal(response.provenance.gatewayPolicySha256,f.state.policy);
  assert.equal(response.provenance.promptSha256,fingerprint(f.state.messages));
  assert.equal(response.context.sources.find(source=>source.kind==='document_ocr')!.ocr!.textCompleteness,'unverified');
  for(const proposal of response.proposals){
    const sources=proposal.manualSelection.selection.sources;
    assert.equal(sources.filter(source=>source.kind==='document'?source.partIds.length:source.kind==='document_ocr'?source.itemOrdinals.length:0).length,1);
    const rebuilt=fusionContextProjection(sources.map(selection=>fusionSourceProjection(selection,{kind:'document',
      result:f.rows.find(row=>row.input.sourceId===selection.pin.sourceId)!.result})).sort((a,b)=>
        a.pin.caseId.localeCompare(b.pin.caseId)||a.pin.sourceId.localeCompare(b.pin.sourceId)));
    assert.equal(proposal.manualSelection.contextSha256,rebuilt.contextSha256);
    assert(RegistryDocumentAmendmentSchema.safeParse({requestKey:randomUUID(),expectedDraftRevision:1,
      recordId:proposal.target.pin.ref.id,expectedRecordRevision:1,addFusion:proposal.manualSelection}).success);
  }
  assert(!JSON.stringify(f.state.messages).includes('technical-memory-control'));
}));
test('missing targets or gateway preserves useful explicit manual context without no-config inference',()=>local(async ctx=>{
  const noTargets=fixture();noTargets.deps.targets=async()=>[];
  const sourceOnly=await proposeFusionAssociations(ctx,{...noTargets.request,scope:null,targets:[]},noTargets.deps);
  assert.equal(sourceOnly.state,'needs_input');assert.equal(noTargets.state.calls,0);assert.equal(noTargets.state.factoryCalls,0);
  assert(sourceOnly.abstentions.some(item=>item.reasonCode==='target_selection_unavailable'));
  assert.deepEqual(sourceOnly.manualSelection,noTargets.request.context);
  const missing=fixture();missing.state.policy=undefined;
  const unavailable=await proposeFusionAssociations(ctx,missing.request,missing.deps);
  assert.equal(unavailable.state,'unavailable');assert.equal(missing.state.calls,0);assert.equal(missing.state.factoryCalls,0);
  assert(unavailable.abstentions.some(item=>item.reasonCode==='MODEL_CONFIGURATION_UNAVAILABLE'));
  assert.deepEqual(unavailable.manualSelection,missing.request.context);
}));
test('fabricated quote, target or OCR ordinal is rejected rather than exposed as a grounded proposal',()=>{
  const f=fixture();
  for(const mutate of [(output:any)=>output.suggestions[0].citations[0].quote='fabricated quotation',
    (output:any)=>output.suggestions[0].targetId=randomUUID(),
    (output:any)=>output.suggestions[0].citations[0].key=f.literals.find(l=>l.citation.kind==='document_ocr')!.citation.key.replace(/\/0$/,'/64')]){
    const raw={suggestions:[structuredClone(f.output.suggestions[0])],abstentions:[]};mutate(raw);
    const checked=validateFusionAssociations(raw,f.request,f.context,f.targets,f.literals);
    assert.equal(checked.proposals.length,0);assert.equal(checked.abstentions.length,1);
  }
  assert(!exactIdentifier('TECH-BLDG-00490','TECH-BLDG-0049'));
});
test('duplicate identifiers and conflicting model evidence abstain; no forced building/floor winner',()=>local(async ctx=>{
  const duplicate=fixture();duplicate.targets[1]={...duplicate.targets[1],identifiers:duplicate.targets[0].identifiers};
  const response=await proposeFusionAssociations(ctx,duplicate.request,duplicate.deps);
  assert.equal(response.proposals.length,0);assert.equal(duplicate.state.calls,0);
  assert(response.abstentions.some(item=>item.reasonCode==='ambiguous_exact_identifiers'));
  const long=fixture(),native=long.literals.find(literal=>literal.citation.kind==='document')!;
  native.identifierText+=' '.repeat(1001)+'TECH-FLOOR-0049';
  const ambiguous=validateFusionAssociations({suggestions:[long.output.suggestions[0]],abstentions:[]},
    long.request,long.context,long.targets,long.literals);
  assert.equal(ambiguous.proposals.length,0,'identifier after the prompt excerpt still prevents a forced winner');
  const f=fixture();f.state.output={suggestions:[f.output.suggestions[0]],
    abstentions:[{reason:'conflicting_evidence',citations:f.output.suggestions[0].citations}]} as any;
  const conflicting=await proposeFusionAssociations(ctx,f.request,f.deps);
  assert.equal(conflicting.state,'needs_input');assert.equal(conflicting.proposals.length,0);
  assert(conflicting.abstentions.some(item=>item.reasonCode==='model_conflicting_evidence'));
}));
test('source, target and model-policy drift during a stubbed single gateway call withholds every suggestion',()=>local(async ctx=>{
  for(const drift of ['source','target','policy']){
    const f=fixture();f.state.afterCall=()=>{
      if(drift==='source')f.state.sourceRevoked=true;
      else if(drift==='target')f.state.targetDrift=true;
      else f.state.policy='b'.repeat(64);
    };
    await assert.rejects(()=>proposeFusionAssociations(ctx,f.request,f.deps),(error:any)=>[403,409].includes(error.status));
    assert.equal(f.state.calls,1);
  }
}));
