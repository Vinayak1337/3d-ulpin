import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {DocumentResultSchema} from '../packages/contracts/src/usp';
import {GltfOriginalSchema,GltfResultSchema} from '../packages/contracts/src/usp/gltf-ingestion';
import type {RegistryRecord,RegistryDraft,RegistrySite,RegistryReview} from '../packages/contracts/src/registry';
import {RegistryDocumentAmendmentSchema,RegistryNativeDocumentCitationSchema,RegistryDocumentEvidenceSchema} from '../packages/contracts/src/registry-document-evidence';
import type {RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  documentReviewContext,publicRegistryBody,publicRegistryReview,citationId} from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryGltfCitationSourceTx} from '../packages/server/src/modules/registry/registry-gltf-citation-source';
import {persistRegistryReviewTx,commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {gltfInput,gltfArtifactKey,gltfResultKey} from '../packages/server/src/modules/usp/ingestion/gltf';
import {gltfSummary} from '../packages/server/src/modules/usp/ingestion/gltf-processor';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {associationLiterals} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import type {SourceFusionSelection} from '../packages/contracts/src/source-fusion';

// Adapted from accepted CityGML/survey correction controls; no native run or live writes. These focused
// checks prevent unauthorized/stale native citations reaching canonical commit.
// Original/native/document bytes and historical supervision are retained real inputs; site-bound result/input/accepted-attempt envelopes, target, SQL,
// storage, review and tool inventory are labelled controls, not real matching. Accepted LF reader/tool pins and exact native bytes remain unchanged.
const root='E:/BhuAayam-data/task-data/gltf-api-20261004-run01',
  originals='E:/BhuAayam-data/task-data/desktop-gltf-native/originals',
  documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const samples={
  'Box.glb':{source:'ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e',
    artifact:'3640eeb9cdeb91cef30caa9af3e94f89fddaf6000e2c685ebac250d8d0329ebe',ordinal:0,originalName:'Box.glb'},
  'Box.gltf':{source:'4a0d69eecfce0672a50b71dc218cbacec6c53fe2445040c235c6314b1b2c41b9',
    artifact:'992c6ad19fb4c4e7efc23a5cd24babde2cde3acb7889a71ff30fcd2af553a8bb',ordinal:0,originalName:'Box.gltf'}
};
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest='a'.repeat(64);
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-gltf-protocol';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(name:keyof typeof samples='Box.glb',kind:'building'|'floor'|'space'='building',ordinal=0){
  const sample=samples[name],raw=readFileSync(originals+'/'+sample.originalName),artifact=readFileSync(root+'/'+name+'.native.json'),native=JSON.parse(artifact.toString('utf8')),
    saved=GltfResultSchema.parse(JSON.parse(readFileSync(root+'/'+name+'.journey.json','utf8')).accepted);
  assert.equal(sha256(raw),sample.source);assert.equal(sha256(artifact),sample.artifact);
  const siteId=id(10),caseId=id(1),sourceId=id(2),jobId=id(3),draftId=id(20),binding=ingestionBinding(caseId),
    current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:siteId},
    original=GltfOriginalSchema.parse({version:'gltf-native/1',subject:binding.subject,accessSha256:binding.access,sha256:sha256(raw),bytes:raw.length,
      receivedAt:'2026-10-03T00:00:00Z',lineageState:'caller_declared',lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,
        geography:null,limitations:['memory protocol authority; unchanged retained test_only bytes']}}),
    source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,profile:'gltf-native-v1',status:'received',sha256:sha256(raw),bytes:raw.length,
      object_key:`sources/${sourceId}/${sha256(raw)}`,inspection:{gltfOriginal:original}},
    tools=saved.input.tools!,
    input=gltfInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId})} as any,jobId,{...tools,readerSha256:saved.input.readerSha256}),
    result=GltfResultSchema.parse({...saved,input,summary:gltfSummary(artifact,input),artifact:{...saved.artifact,key:gltfArtifactKey(jobId,sha256(artifact))},createdAt:'2026-10-03T00:00:00Z'}),
    resultBytes=Buffer.from(JSON.stringify(result)),
    selection:Extract<SourceFusionSelection,{kind:'gltf'}>={kind:'gltf',pin:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:sha256(raw),jobId,
      resultSha256:sha256(resultBytes),readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1,resultBytes:resultBytes.length},nodeIndices:[0,1]},
    job={id:jobId,operation:'gltf-native',case_id:caseId,source_id:sourceId,case_revision:1,payload:input,input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),
      status:'succeeded',logical_state:'succeeded',result_ref:{assetId:`gltf:${jobId}:${resultBytes.length}`,version:1,sha256:sha256(resultBytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:sha256(resultBytes)};
  assert.deepEqual(result.summary,saved.summary);
  const documentBytes=readFileSync(documentPath),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    enrollment=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((row:any)=>row.id==='epsg7415');
  assert.equal(sha256(documentBytes),enrollment.resultSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:document.input.caseId,caseRevision:document.input.caseRevision,
    sourceId:document.input.sourceId,sourceRevision:document.input.sourceRevision,sourceSha256:document.input.sourceSha256,jobId:document.input.jobId,
    resultSha256:sha256(documentBytes),readerSha256:document.input.readerSha256,inputSha256:fingerprint(document.input),acceptedFence:enrollment.acceptedFence,resultBytes:documentBytes.length},
    partIds:[]};
  const record:RegistryRecord={id:id(11),siteId,identifier:'controlled-existing-record',revision:1,alias:'Protocol target',name:'Protocol target',kind,
    footprint:[[0,0],[1,0],[1,1],[0,1]],links:[],rights:[],evidence:[{sourceId:id(12),locator:'existing protocol evidence'}],synthetic:true},
    {id:_,siteId:__,identifier:___,revision:____,...body}=record,
    priorPart=document.native.parts.find(part=>part.id===enrollment.selectedParts[0].id)!,
    prior=RegistryNativeDocumentCitationSchema.parse({version:'registry-document-citation/1',id:'0'.repeat(64),
      document:{caseId:docSelection.pin.caseId,caseRevision:docSelection.pin.caseRevision,sourceId:docSelection.pin.sourceId,sourceRevision:docSelection.pin.sourceRevision,
        sourceSha256:docSelection.pin.sourceSha256,jobId:docSelection.pin.jobId,resultSha256:docSelection.pin.resultSha256},
      inputSha256:docSelection.pin.inputSha256,readerSha256:docSelection.pin.readerSha256,acceptedFence:docSelection.pin.acceptedFence,
      partId:priorPart.id,partSha256:priorPart.sha256,locator:priorPart.locator,target:{recordId:record.id,revision:1,bodySha256:fingerprint(body)},
      selection:{subject:binding.subject,accessSha256:document.input.accessSha256,selectedAt:'2026-10-04T00:00:00Z'},associationState:'operator_selected',qualification:'not_assessed'}),
    state={draft:{id:draftId,site_id:siteId,case_id:id(21),records:[{...structuredClone(record),documentCitations:[prior]}],revision:1,status:'draft',created_at:'2026-10-04T00:00:00Z'},
      row:{id:record.id,site_id:siteId,identifier:record.identifier,kind:record.kind,revision:1,body:structuredClone(body)},
      site:{id:siteId,identifier:'protocol-site',name:'protocol-site',revision:1,frame:{id:'protocol-frame',horizontalUnit:'m',verticalUnit:'m',benchmark:'protocol-only'},synthetic:true},
      review:undefined as any,operations:new Map<string,any>(),history:new Map<number,any>([[1,structuredClone(body)]]),
      draftWrites:0,reviewWrites:0,registryWrites:0,reads:0,toolChecks:0,revokeDuringDocument:false,revokeDuringArtifact:false,calls:[] as string[]},
    ordinarySource={id:id(12),case_id:caseId,family_id:id(12),revision:1,sha256:digest,bytes:1,name:'protocol recording source',profile:'protocol',
      mime_type:'text/plain',object_key:'protocol',created_at:'2026-10-03T00:00:00Z',status:'ready',inspection:{}};
  prior.id=citationId(prior);
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push(sql);let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources'))rows=[];
    else if(sql.includes('FROM building_preparations'))rows=[];
    else if(sql.includes('SELECT site_id,case_id,records FROM registry_drafts')||sql.startsWith('SELECT * FROM registry_drafts'))rows=[state.draft];
    else if(sql.startsWith('SELECT * FROM registry_reviews'))rows=[{draft_id:draftId,body:state.review,committed:state.review?.committed??false}];
    else if(sql.includes('FROM registry_sites'))rows=[state.site];
    else if(sql.includes('CASE WHEN r.revision'))rows=[{site_id:siteId,kind:record.kind,body:args[1]===state.row.revision?state.row.body:state.history.get(args[1])}];
    else if(sql.includes('FROM registry_records'))rows=[state.row];
    else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[current];
    else if(sql.includes('FROM sources'))rows=args[0]===id(12)?[ordinarySource]:[source];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:1}];
    else if(sql.includes('SELECT j.*,m.result_ref'))rows=[job];
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:enrollment.acceptedFence}];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.startsWith('UPDATE registry_drafts SET records')){state.draft.records=JSON.parse(args[1]);state.draft.revision++;state.draftWrites++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else if(sql.startsWith('INSERT INTO registry_reviews')){state.review=structuredClone(args[2]);state.reviewWrites++;}
    else if(sql.startsWith('UPDATE registry_records')){state.row.body=structuredClone(args[1]);state.row.revision=args[2];state.registryWrites++;}
    else if(sql.startsWith('INSERT INTO registry_revisions')){state.history.set(args[1],structuredClone(args[2]));state.registryWrites++;}
    else if(sql.startsWith('DELETE FROM registry_'))state.registryWrites++;
    else if(sql.startsWith('UPDATE registry_sites')){state.site.revision=args[1];state.registryWrites++;}
    else if(sql.startsWith('UPDATE registry_drafts SET status')){state.draft.status='recorded';state.registryWrites++;}
    else if(sql.startsWith('UPDATE registry_reviews')){state.review.committed=true;state.registryWrites++;}
    else assert.fail('Unexpected protocol SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const objects=new Map([[gltfResultKey(jobId,sha256(resultBytes)),resultBytes],[result.artifact.key,artifact],
    [documentResultKey(document.input.jobId,sha256(documentBytes)),documentBytes]]);
  const dependencies:RegistryDocumentDependencies={source:async(_client,_ctx,pin)=>{
    assert.equal(pin.sourceId,docSelection.pin.sourceId);return document.input;
  },result:async()=>document,registrySource:async(_client,_site,sourceId)=>sourceId===docSelection.pin.sourceId?
    ({revision:document.input.sourceRevision,sha256:document.input.sourceSha256,accessSha256:document.input.accessSha256}) as any:
    ({revision:1,sha256:digest,accessSha256:digest}) as any,
    gltfTools:()=>{state.toolChecks++;},fusionResult:async(selected,authority,budget)=>{
      state.reads++;
      const loaded=await readFusionResult(selected,authority,budget,(key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async()=>{
        const bytes=objects.get(key);assert(bytes);if(state.revokeDuringArtifact&&key===result.artifact.key)current.archived=true;
        return {body:Readable.from([bytes]),etag:'protocol'};
      }));
      if(selected.kind==='document'&&state.revokeDuringDocument)current.archived=true;return loaded;
    }};
  const context=fusionContextProjection([fusionSourceProjection(selection,{kind:'gltf',result,native}),
    fusionSourceProjection(docSelection,{kind:'document',result:document})]);
  const request={requestKey:id(30),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,
    addFusion:{gltfReferences:true as const,contextSha256:context?.contextSha256??digest,selection:{sources:[selection,docSelection]}}};
  return {client,dependencies,state,record,body,current,source,job,selection,request,draftId,siteId,native,raw,context,result,document,docSelection,prior};
}
function review(f:ReturnType<typeof fixture>){
  const records=structuredClone(f.state.draft.records),access=documentReviewContext(),time=new Date('2026-10-04T00:00:00Z').toISOString(),
    d:RegistryDraft={id:f.draftId,siteId:f.siteId,caseId:f.state.draft.case_id,records,revision:f.state.draft.revision,status:'draft',createdAt:time},
    site=f.state.site as unknown as RegistrySite,
    body:RegistryReview={id:id(40),draftId:f.draftId,draftRevision:d.revision,siteRevision:1,records,before:[f.record],findings:[],committed:false,
      documentReviewContext:access,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',records,frame:site.frame,
        draftRevision:d.revision,siteRevision:1,documentReviewContext:access})};
  return {snapshot:{d,site,combined:records},body};
}
function save(name:string,value:unknown){const proof=process.env.ULPIN_GLTF_LINK_PROOF_DIR;if(proof)
  writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('retained GLB/building and incomplete JSON/floor references preserve singleton metadata, prior citation, replay, review and commit',()=>local(async()=>{
  for(const [name,kind] of [['Box.glb','building'],['Box.gltf','floor']] as const){
    const f=fixture(name,kind),hash=f.context.contextSha256,receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),record=f.state.draft.records[0];
    assert.equal(receipt.draftRevision,2);assert.equal(f.state.draftWrites,1);assert.equal(f.state.operations.size,1);assert.equal(record.documentCitations!.length,3);
    assert.deepEqual(record.documentCitations![0],f.prior);assert.deepEqual(f.state.row.body,f.body);
    const pin=record.documentCitations![2];assert(pin.version==='registry-gltf-node-citation/1');assert.equal(pin.id,citationId(pin));
    assert.equal(pin.gltf.nodeIndex,1);assert.equal(pin.gltf.purpose,'source_reference_only');assert.equal(pin.gltf.combinedContextSha256,hash);
    assert.deepEqual(pin.gltf.selectedNodeIndices,[0,1]);assert.equal(pin.gltf.recordSha256,fingerprint(f.native.nodes[1]));
    assert.equal(pin.gltf.placement,'unknown');assert.equal(pin.gltf.measurements,false);assert.equal(pin.gltf.learningLabels,false);
    assert(!Object.hasOwn(pin,'identityAssertion'));assert.deepEqual(publicRegistryBody(record),f.record);
    const evidence=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);assert(RegistryDocumentEvidenceSchema.safeParse(evidence).success);
    assert.equal(evidence.citations.length,3);const entry=evidence.citations[2];assert('fragment' in entry&&entry.fragment.kind==='gltf');
    const fragment=entry.fragment;assert.equal(fragment.nodes.length,1);assert.equal(fragment.nodes[0].index,1);
    assert.deepEqual(fragment.nodes[0].record,f.native.nodes[1]);assert.equal(fragment.coverage.selectedNodes,1);assert.equal(fragment.coverage.unselectedNodes,'not_expanded');
    assert.equal(fingerprint(fragment),pin.gltf.fragmentSha256);assert.equal(fragment.selectionSha256,pin.gltf.selectionSha256);
    assert.equal(fragment.nodes[0].recordSha256,pin.gltf.recordSha256);assert.equal(fragment.primitives.length,1);
    assert(!Object.hasOwn((fragment.primitives[0].metadata.projection as any).POSITION,'values'));
    assert(!Object.hasOwn((fragment.primitives[0].metadata.projection as any).indices,'values'));
    const rootEntry=evidence.citations[1];assert('fragment' in rootEntry&&rootEntry.fragment.kind==='gltf');assert.equal(rootEntry.fragment.nodes[0].index,0);
    assert.equal(rootEntry.fragment.primitives.length,0);assert.deepEqual(rootEntry.fragment.nodes[0].record,f.native.nodes[0]);
    if(name==='Box.gltf'){assert.equal(fragment.summary.status,'inspected_partial');assert.equal(fragment.buffers[0].record.uri,'Box0.bin');
      assert.equal(fragment.buffers[0].record.status,'needs_input');assert.equal(fragment.buffers[0].record.fetched,false);
      assert(fragment.primitives[0].omittedArrays.every(a=>a.state==='absent'));}
    else assert.deepEqual(fragment.primitives[0].omittedArrays.map(a=>a.count),[24,36]);
    assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),receipt);
    assert.equal(f.state.draftWrites,1);assert.equal(f.state.operations.size,1);assert.equal(f.request.addFusion.contextSha256,hash);
    const prepared=review(f),check:typeof assertRegistryDocumentCitationsTx=(client,site,record,lock)=>assertRegistryDocumentCitationsTx(client,site,record,lock,f.dependencies);
    await persistRegistryReviewTx(f.client,prepared.snapshot,prepared.body,check);assert.equal(f.state.reviewWrites,1);
    assert.deepEqual(f.state.review.records[0].documentCitations,record.documentCitations);
    const committed=await commitRegistryReviewTx(f.client,id(40),'',undefined,check);assert.equal(committed.committed,true);
    assert(!Object.hasOwn(committed.records[0],'documentCitations'));assert.deepEqual(f.state.history.get(1),f.body);
    assert.deepEqual(f.state.row.body.documentCitations,record.documentCitations);assert.equal(f.state.row.revision,2);
    const historical=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);assert.deepEqual(historical.citations[2].pin,pin);
    save(name+'.controlled-journey.json',{qualification:'Unchanged test_only originals/native artifacts/reader/tool pins; site-bound input/result/accepted-attempt, target/footprint/site/SQL/storage/review controls. No live persistence or genuine correspondence.',
      request:f.request,receipt,citation:pin,priorCitation:f.prior,context:f.context,privateRead:evidence,review:f.state.review,committed,historicalRead:historical,
      recordedBody:f.state.row.body,sourceSha256:sha256(f.raw),artifactSha256:sha256(Buffer.from(readFileSync(root+'/'+name+'.native.json'))),
      originalToolPins:f.result.input.tools,draftWrites:f.state.draftWrites,operationReceipts:f.state.operations.size,reviewWrites:f.state.reviewWrites,
      responseBytes:Buffer.byteLength(JSON.stringify(evidence)),nativeRuns:0,providerCalls:0,liveWrites:0});
  }
}));

test('glTF reference context/record mismatch, revocation and unsupported routes refuse without additional writes',()=>local(async()=>{
  const f=fixture(),wrong=structuredClone(f.request);wrong.addFusion.selection.sources[0]={...f.selection,nodeIndices:[1]};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,wrong,f.dependencies),(e:any)=>e.status===409);
  assert.equal(f.state.draftWrites,0);assert.equal(f.state.operations.size,0);
  const noFlag={...f.request,addFusion:{contextSha256:f.context.contextSha256,selection:f.request.addFusion.selection}};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,noFlag,f.dependencies),(e:any)=>e.code==='SOURCE_FUSION_GLTF_CONTEXT_ONLY');
  const space=fixture('Box.glb','space');await assert.rejects(()=>amendRegistryDocumentCitationsTx(space.client,space.draftId,space.request,space.dependencies),
    (e:any)=>e.code==='REGISTRY_DOCUMENT_TARGET');assert.equal(space.state.reads,0);
  assert.throws(()=>associationLiterals(f.context),(e:any)=>e.code==='SOURCE_FUSION_GLTF_CONTEXT_ONLY');
  await assert.rejects(()=>resolveFusionCitationsTx({query:()=>assert.fail('no generic resolver I/O')} as any,localRequestContext(id(99)),f.request.addFusion,
    f.dependencies,f.siteId,true),(e:any)=>e.code==='SOURCE_FUSION_GLTF_CONTEXT_ONLY');
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const record=f.state.draft.records[0],pin=record.documentCitations![2];assert(pin.version==='registry-gltf-node-citation/1');
  const drift={...pin,gltf:{...pin.gltf,recordSha256:digest}};drift.id=citationId(drift);
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(f.client,f.siteId,{...record,documentCitations:[drift]},false,f.dependencies),(e:any)=>e.status===409);
  f.state.revokeDuringArtifact=true;await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),(e:any)=>e.status===403);
  const before={draftWrites:f.state.draftWrites,receipts:f.state.operations.size,registryWrites:f.state.registryWrites,reviewWrites:f.state.reviewWrites};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),(e:any)=>e.status===403);
  const prepared=review(f),check:typeof assertRegistryDocumentCitationsTx=(client,site,record,lock)=>assertRegistryDocumentCitationsTx(client,site,record,lock,f.dependencies);
  await assert.rejects(()=>persistRegistryReviewTx(f.client,prepared.snapshot,prepared.body,check),(e:any)=>e.status===403);
  assert.deepEqual({draftWrites:f.state.draftWrites,receipts:f.state.operations.size,registryWrites:f.state.registryWrites,reviewWrites:f.state.reviewWrites},before);
  save('denial-controls.json',{qualification:'Memory-only adverse controls; no changed operational input',changedSelectionOldContextDenied:true,wrongRecordHashDenied:true,
    noExplicitOptionDenied:true,spaceDenied:true,genericAndModelStillContextOnly:true,revokedPrivateReadReplayReviewDenied:true,before,after:before,deniedExtraWrites:0});
}));
