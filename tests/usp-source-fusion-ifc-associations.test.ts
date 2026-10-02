import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {DocumentResultSchema,IFCOriginalSchema,IFCResultSchema} from '../packages/contracts/src/usp';
import {DocumentAssociationTargetSchema,RegistryDocumentAmendmentSchema,type RegistryRecord} from '../packages/contracts/src';
import {FusionAssociationRequestSchema,FusionAssociationResponseSchema,FUSION_IFC_IDENTIFIER_SCHEME} from '../packages/contracts/src/source-fusion-associations';
import {ModelGatewayConfigSchema,hash} from '../packages/server/src/modules/model-gateway/config';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {ifcInput} from '../packages/server/src/modules/usp/ingestion/ifc';
import {ifcSummary} from '../packages/server/src/modules/usp/ingestion/ifc-processor';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {associationLiterals,associationPreflight,validateFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {proposeFusionAssociations,type FusionAssociationDependencies} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {amendRegistryDocumentCitationsTx,type RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryIFCCitationSourceTx} from '../packages/server/src/modules/registry/registry-ifc-citation-source';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import type {SourceFusionSelection} from '../packages/contracts/src/source-fusion';

// Unchanged real test_only bytes; source/job/target/crosswalk and gateway reply
// below are explicitly memory protocol controls, never property/learning truth.
const nativeRoot=process.env.ULPIN_IFC_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-ifc-native';
const documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const present=existsSync(nativeRoot+'/outputs/final/ifc2x3.json')&&existsSync(documentPath);
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest='a'.repeat(64);
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='ifc-association-protocol';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(){
  const raw=readFileSync(nativeRoot+'/originals/ifc2x3-building-architecture.ifc'),artifact=readFileSync(nativeRoot+'/outputs/final/ifc2x3.json'),
    native=JSON.parse(artifact.toString('utf8')),siteId=id(10),caseId=id(1),sourceId=id(2),jobId=id(3),binding=ingestionBinding(caseId),
    current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:siteId};
  assert.equal(sha256(raw),'c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885');
  assert.equal(sha256(artifact),'66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a');
  const original=IFCOriginalSchema.parse({version:'ifc-native/1',subject:binding.subject,accessSha256:binding.access,sha256:sha256(raw),bytes:raw.length,
    receivedAt:'2026-10-01T00:00:00Z',lineageState:'caller_declared',lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,
      geography:null,limitations:['memory control; retained buildingSMART test_only bytes']}}),
    source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,profile:'ifc-native-v1',sha256:sha256(raw),bytes:raw.length,
      object_key:`sources/${sourceId}/${sha256(raw)}`,inspection:{ifcOriginal:original}},
    tools={platform:'windows-x86_64' as const,pythonSha256:digest,profileSha256:digest,readerSha256:digest,supervisorSha256:digest,dependencyLockSha256:digest,codeSha256:digest},
    input=ifcInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId})} as any,jobId,'complete_bounded_source',tools),
    result=IFCResultSchema.parse({version:'ifc-native/1',input,summary:ifcSummary(artifact,input),
      artifact:{key:`ifc-native/${jobId}/${sha256(artifact)}.native.json`,sha256:sha256(artifact),bytes:artifact.length,profile:'ulpin-native-ifc/1',mediaType:'application/json'},
      createdAt:'2026-10-01T00:00:00Z'}),resultBytes=Buffer.from(JSON.stringify(result)),
    ifc:Extract<SourceFusionSelection,{kind:'ifc'}>={kind:'ifc',pin:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:sha256(raw),jobId,
      resultSha256:sha256(resultBytes),resultBytes:resultBytes.length,inputSha256:fingerprint(input),readerSha256:input.readerSha256,acceptedFence:1},stepIds:[25,36,183]},
    job={id:jobId,operation:'ifc-native',case_id:caseId,source_id:sourceId,case_revision:1,payload:input,input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),
      status:'succeeded',logical_state:'succeeded',result_ref:{assetId:`ifc:${jobId}:${resultBytes.length}`,version:1,sha256:sha256(resultBytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:sha256(resultBytes)};
  const docBytes=readFileSync(documentPath),document=DocumentResultSchema.parse(JSON.parse(docBytes.toString('utf8'))),
    enrollment=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((row:any)=>row.id==='epsg7415');
  assert.equal(sha256(docBytes),enrollment.resultSha256);
  const doc:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:enrollment.caseId,caseRevision:enrollment.caseRevision,
    sourceId:enrollment.sourceId,sourceRevision:enrollment.sourceRevision,sourceSha256:enrollment.sourceSha256,jobId:enrollment.jobId,
    resultSha256:enrollment.resultSha256,resultBytes:docBytes.length,readerSha256:enrollment.readerSha256,inputSha256:enrollment.inputSha256,
    acceptedFence:enrollment.acceptedFence},partIds:[enrollment.selectedParts[0].id]};
  const ctx=localRequestContext(id(100)),record:RegistryRecord={id:id(11),siteId,identifier:'controlled-existing-record',revision:1,kind:'building' as const,
    alias:'Protocol target',name:'Protocol target',footprint:[[0,0],[1,0],[1,1],[0,1]] as [number,number][],links:[],rights:[],synthetic:true,
    evidence:[{sourceId:id(12),locator:'controlled recording evidence'}]},
    {id:_,siteId:__,identifier:___,revision:____,...body}=record,
    state={draft:{id:id(20),site_id:siteId,case_id:id(21),revision:1,status:'draft',records:[record]},writes:0,calls:0,rechecks:0,
      factoryCalls:0,messages:undefined as any,trusted:undefined as any,policy:undefined as string|undefined,
      targets:[] as ReturnType<typeof DocumentAssociationTargetSchema.parse>[],operations:new Map<string,any>()};
  const client={query:async(sql:string,args:any[]=[])=>{
    let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources')||sql.startsWith('SELECT id FROM registry_sites')){}
    else if(sql.includes('FROM registry_drafts'))rows=[state.draft];
    else if(sql.includes('FROM registry_records'))rows=[{id:record.id,site_id:siteId,kind:record.kind,revision:1,body}];
    else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[current];
    else if(sql.includes('FROM sources'))rows=[source];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:1}];
    else if(sql.includes('SELECT j.*,m.result_ref'))rows=[job];
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:enrollment.acceptedFence}];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.startsWith('UPDATE registry_drafts SET records')){state.draft.records=JSON.parse(args[1]);state.draft.revision++;state.writes++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else assert.fail('Unexpected owned SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const objects=new Map([[`ifc-native/${jobId}/${sha256(resultBytes)}.json`,resultBytes],[result.artifact.key,artifact],
    [documentResultKey(document.input.jobId,sha256(docBytes)),docBytes]]);
  const registry:RegistryDocumentDependencies={source:async()=>document.input,result:async()=>document,
    registrySource:async()=>({revision:1,sha256:digest,accessSha256:digest}) as any,ifcTools:()=>{},
    fusionResult:(selection,authority,budget)=>readFusionResult(selection,authority,budget,
      (key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async()=>{const bytes=objects.get(key);assert(bytes);return {body:Readable.from([bytes]),etag:'protocol'};}))};
  const projected=fusionSourceProjection(ifc,{kind:'ifc',result,native}),context=fusionContextProjection([projected,fusionSourceProjection(doc,{kind:'document',result:document})]);
  const scope={kind:'snapshot' as const,scopeId:siteId,world:{namespace:'world',id:'planned'},manifestId:'controlled-manifest',snapshotDigest:digest,stage:'recorded' as const};
  const identifier=(native.records.find((entry:any)=>entry.stepId===25).attributes.GlobalId as any).value;
  const target=DocumentAssociationTargetSchema.parse({pin:{ref:{namespace:'registry_record',id:record.id},revision:1},kind:'building',label:'Protocol target',
    identifiers:[{scheme:FUSION_IFC_IDENTIFIER_SCHEME,value:identifier,issuer:null,
      source:{ref:{namespace:'source_revision',id:sourceId},revision:1},state:'reviewed'}],
    recordState:'recorded',sourceEvidence:'available',synthetic:true,relationsWithinSelection:[],relationshipCoverage:'partial'});
  state.targets=[target];
  const request=FusionAssociationRequestSchema.parse({requestKey:id(30),context:{contextSha256:context.contextSha256,selection:{sources:[ifc,doc]}},scope,targets:[target.pin]});
  const literals=associationLiterals(context),literal=literals.find(item=>item.citation.kind==='ifc'&&item.citation.stepId===25)!;
  const output={suggestions:[{targetId:record.id,scheme:FUSION_IFC_IDENTIFIER_SCHEME,matchedIdentifier:identifier,
    citations:[{key:literal.citation.key,quote:identifier}],rationale:'Inspect this controlled explicit source-identifier assertion.'}],abstentions:[]};
  const config=ModelGatewayConfigSchema.parse({projectId:'ifc-protocol',policyVersion:'protocol',fundingVersion:'protocol',gatewayExclusiveFunding:true,
    indiaPrivateApproved:true,secretReference:'ULPIN_PROVIDER_KEY_PROTOCOL',model:'sarvam-105b',projectCapMicroInr:'100',principalDailyCallCap:10,
    price:{version:'protocol',inputPerMillionMicroInr:'1',cachedInputPerMillionMicroInr:'1',outputPerMillionMicroInr:'1'},
    inputBound:{version:'protocol',maxPromptTokens:34816},maxOutputTokens:2048,timeoutMs:1000,paceMs:1500});
  state.policy=hash(config);
  const ifcProjection=(selection:Extract<SourceFusionSelection,{kind:'ifc'}>)=>{
    const projection=fusionSourceProjection(selection,{kind:'ifc',result,native});assert(projection.kind==='ifc');return projection;
  };
  const deps:FusionAssociationDependencies={capture:async(_ctx,_selection,_budget,selectedSite)=>{
    assert.equal(selectedSite,siteId);return {context,unsupportedCitationSources:[],ifcProjection,revalidate:async()=>{
      state.rechecks++;await registryIFCCitationSourceTx(client,siteId,ifc.pin,true);
    }};
  },targets:async(_ctx,_scope,_pins,citationSources)=>{assert.deepEqual(citationSources,[doc.pin.sourceId]);return state.targets;},
    policy:()=>state.policy,gateway:async()=>{state.factoryCalls++;return {config,port:trusted=>{
      state.trusted=trusted;return {modelGateway:async(_ctx,input)=>{await trusted.authorize();state.calls++;state.messages=(input.input as any).messages;
        return {state:'available',data:{output:trusted.minimizeOutput(output) as any,modelId:config.model,outputSchemaId:input.outputSchemaId,evidenceRefs:[],replayed:false}};
      }};
    }};}};
  return {ctx,raw,native,result,ifc,doc,context,request,literals,output,state,target,client,registry,record,deps,ifcProjection,siteId};
}

test('retained IFC literals keep native spans and naturally lack a compatible canonical crosswalk', {skip:!present},()=>local(async()=>{
  const f=fixture();assert.equal(f.literals.filter(literal=>literal.citation.kind==='ifc').length,3);
  for(const literal of f.literals)if(literal.citation.kind==='ifc'){
    const entry=f.native.records.find((record:any)=>record.stepId===literal.citation.stepId),attribute=entry.attributes.GlobalId;
    assert.equal(literal.text,attribute.value);assert.equal(literal.citation.attributeSha256,fingerprint(attribute));
    assert.equal(f.raw.subarray(attribute.locator.byteStart,attribute.locator.byteEnd).toString('latin1'),attribute.rawLiteral);
  }
  f.state.targets=[{...f.target,identifiers:[{scheme:'application-3d-ulpin',value:f.record.identifier,source:null,issuer:null,state:'reviewed'}]}];
  const response=await proposeFusionAssociations(f.ctx,f.request,f.deps);
  assert.equal(response.state,'needs_input');assert.equal(response.proposals.length,0);assert.equal(f.state.factoryCalls,0);assert.equal(f.state.calls,0);
  assert(response.abstentions.some(item=>item.reasonCode==='ifc_identifier_namespace_or_crosswalk_missing'));
  const source=f.context.sources.find(source=>source.kind==='ifc')!;assert(source.kind==='ifc');
  assert.equal(source.reference.georeference.state,'missing_or_unqualified');assert.equal(source.reference.georeference.globalTransformApplied,false);
  assert.equal((source.entities[0].record.attributes.Elevation as any).state,'absent');
  const proof=process.env.ULPIN_IFC_ASSOCIATION_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
    writeFileSync(proof+'/missing-crosswalk.json',JSON.stringify({scope:'real retained native literals with controlled application target; no authentic property crosswalk',response,literals:f.literals},null,2)+'\n');}
}));

test('controlled exact IFC suggestion reassembles only its cited STEP and passes the existing addFusion amendment', {skip:!present},()=>local(async()=>{
  const f=fixture(),response=await proposeFusionAssociations(f.ctx,f.request,f.deps);
  assert(FusionAssociationResponseSchema.safeParse(response).success);assert.equal(response.state,'proposed');assert.equal(f.state.calls,1);
  assert.equal(response.provenance.promptVersion,'source-fusion-exact-associations/2');assert.match(f.state.trusted.invocationKey,/^fusion-association-v2:/);
  assert(!JSON.stringify(f.state.messages).includes('Single-family house'));assert(!JSON.stringify(f.state.messages).includes('sources/'));
  const proposal=response.proposals[0],selection=proposal.manualSelection;
  assert.deepEqual(selection.selection.sources.find(source=>source.kind==='ifc')!.stepIds,[25]);
  assert.deepEqual(selection.selection.sources.find(source=>source.kind==='document')!.partIds,[]);
  const rebuilt=fusionContextProjection(selection.selection.sources.map(source=>source.kind==='ifc'?f.ifcProjection(source):
    fusionSourceProjection(source,{kind:'document',result:DocumentResultSchema.parse(JSON.parse(readFileSync(documentPath,'utf8')))})));
  assert.equal(rebuilt.contextSha256,selection.contextSha256);
  const amendment=RegistryDocumentAmendmentSchema.parse({requestKey:id(31),expectedDraftRevision:1,recordId:f.record.id,expectedRecordRevision:1,addFusion:selection});
  const receipt=await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,amendment,f.registry);
  assert.equal(receipt.changed,true);assert.equal(f.state.writes,1);
  const pin=f.state.draft.records[0].documentCitations![0];assert(pin.version==='registry-ifc-citation/1');assert.equal(pin.ifc.stepId,25);
  assert.equal(f.state.draft.records[0].documentCitations!.length,1);
  const proof=process.env.ULPIN_IFC_ASSOCIATION_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
    writeFileSync(proof+'/controlled-roundtrip.json',JSON.stringify({scope:'memory target/crosswalk/accepted IFC job and stubbed gateway; no model or authentic matching qualification',
      response,rebuilt,receipt,amendedRecord:f.state.draft.records[0],messages:f.state.messages,toolInventory:'stubbed'},null,2)+'\n');}
}));

test('IFC namespace collisions, absent identifiers and fabricated attribute claims abstain without inferred identity', {skip:!present},()=>local(async()=>{
  const f=fixture(),globalId=f.target.identifiers[0].value;
  for(const identifiers of [
    [{...f.target.identifiers[0],scheme:'application-3d-ulpin',source:null}],
    [{...f.target.identifiers[0],source:{ref:{namespace:'source_revision',id:id(99)},revision:1}}],
  ]){
    const checked=validateFusionAssociations(f.output,f.request,f.context,[{...f.target,identifiers}],f.literals,f.ifcProjection);
    assert.equal(checked.proposals.length,0);assert.equal(checked.abstentions.length,1);
  }
  const partial={...f.target,identifiers:[{...f.target.identifiers[0],value:'0c'}]};
  assert.equal(associationPreflight(f.literals,[partial]).canPropose,false,'$ inside a GlobalId is not a partial-ID boundary');
  const invalid=structuredClone(f.output);invalid.suggestions[0].citations[0].key=invalid.suggestions[0].citations[0].key.replace('GlobalId','Name');
  assert.equal(validateFusionAssociations(invalid,f.request,f.context,[f.target],f.literals,f.ifcProjection).proposals.length,0);
  const duplicate={...f.target,pin:{ref:{namespace:'registry_record',id:id(98)},revision:1}};
  const ambiguous=associationPreflight(f.literals,[f.target,duplicate]);assert.equal(ambiguous.canPropose,false);
  assert(ambiguous.abstentions.some(item=>item.reasonCode==='ambiguous_exact_identifiers'));
  const missing=structuredClone(f.context),source=missing.sources.find(source=>source.kind==='ifc')!;assert(source.kind==='ifc');
  source.entities[0].record.attributes.GlobalId={state:'null',value:null,rawLiteral:'$',locator:{}};
  const literals=associationLiterals(missing);assert.equal(literals.find(literal=>literal.citation.kind==='ifc'&&literal.citation.stepId===25)!.eligible,false);
  assert.equal(associationPreflight(literals,[f.target]).canPropose,false);
  f.state.policy=undefined;const unavailable=await proposeFusionAssociations(f.ctx,f.request,f.deps);
  assert.equal(unavailable.state,'unavailable');assert(unavailable.abstentions.some(item=>item.reasonCode==='MODEL_CONFIGURATION_UNAVAILABLE'));
  assert.equal(f.state.calls,0);assert.equal(globalId,'0c$N1CTon2BB2Sp89385G8');
}));
