import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {GltfOriginalSchema,GltfResultSchema,GLTF_LIMITS} from '../packages/contracts/src/usp/gltf-ingestion';
import {SourceFusionRequestSchema,type SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {assembleSourceFusion,fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,readFusionResult,readFusionObject,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {acceptedFusionGltfTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-gltf-authority';
import {captureAssociationFusion,proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {associationLiterals,associationManualSelection} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {amendRegistryDocumentCitations,amendRegistryDocumentCitationsTx} from '../packages/server/src/modules/registry/registry-document-evidence';
import {gltfArtifactKey,gltfResultKey} from '../packages/server/src/modules/usp/ingestion/gltf';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// No enrollment, native execution, network, persisted SQL or real tool admission.
// Reuse exact accepted GLTF-02 originals/results/artifacts and document result.
const root=process.env.ULPIN_GLTF_FUSION_TEST_ROOT??'E:/BhuAayam-data/task-data/gltf-api-20261004-run01';
const documentRoot=process.env.ULPIN_REFERENCE_DOCUMENT_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-reference-document-enrollment';
const budget=():FusionBudget=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal,reservedBytes:0});
const ctx=()=>localRequestContext('fusion-gltf-protocol-control');
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='gltf-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(label='Box.glb'){
  const journey=JSON.parse(readFileSync(root+'/'+label+'.journey.json','utf8')),result=GltfResultSchema.parse(journey.accepted),input=result.input,
    nativeBytes=readFileSync(root+'/'+label+'.native.json'),native=JSON.parse(nativeBytes.toString('utf8')),
    resultBytes=Buffer.from(JSON.stringify(result)),resultHash=sha256(resultBytes);
  assert.deepEqual(result.input,journey.accepted.input);assert.deepEqual(result.summary,journey.status.result.summary);
  assert.equal(result.artifact.sha256,sha256(nativeBytes));assert.equal(result.artifact.bytes,nativeBytes.length);
  assert.equal(result.artifact.key,gltfArtifactKey(input.jobId,sha256(nativeBytes)));
  const retainedResult=journey.objectHashes.find((entry:any)=>entry.key===gltfResultKey(input.jobId,resultHash));assert(retainedResult);
  assert.equal(resultHash,retainedResult.sha256);assert.equal(resultBytes.length,retainedResult.bytes);
  const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-gltf/sources.json',import.meta.url),'utf8')),
    originalEntry=manifest.sources.find((s:any)=>s.sha256===input.sourceSha256),original=readFileSync(originalEntry.path);
  assert.equal(sha256(original),input.sourceSha256);assert.equal(original.length,input.sourceBytes);
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null};
  assert.equal(fingerprint({frame:null,context:null,siteId:null}),input.caseContextSha256);
  const binding=ingestionBinding(input.caseId);assert.equal(binding.subject,input.subject);assert.equal(binding.access,input.accessSha256);
  const marker=GltfOriginalSchema.parse({version:input.version,subject:input.subject,accessSha256:input.accessSha256,
    sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:result.createdAt,lineageState:'caller_declared',
    lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['memory-only source authority control']}}),
    source={id:input.sourceId,case_id:input.caseId,family_id:input.sourceFamilyId,revision:input.sourceRevision,
      profile:'gltf-native-v1',sha256:input.sourceSha256,bytes:input.sourceBytes,object_key:input.objectKey,inspection:{gltfOriginal:marker}},
    job={id:input.jobId,operation:'gltf-native',case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`gltf:${input.jobId}:${resultBytes.length}`,version:1,sha256:resultHash},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:resultHash},
    selection:Extract<SourceFusionSelection,{kind:'gltf'}>={kind:'gltf',pin:{caseId:input.caseId,caseRevision:input.caseRevision,
      sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,jobId:input.jobId,
      resultSha256:resultHash,resultBytes:resultBytes.length,readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1},nodeIndices:[1]};
  const documentBytes=readFileSync(documentRoot+'/epsg7415-accepted-result.json'),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    entry=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((e:any)=>e.id==='epsg7415');
  assert.equal(sha256(documentBytes),entry.resultSha256);assert.equal(fingerprint(document.input),entry.inputSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:entry.caseId,caseRevision:entry.caseRevision,
    sourceId:entry.sourceId,sourceRevision:entry.sourceRevision,sourceSha256:entry.sourceSha256,jobId:entry.jobId,
    resultSha256:entry.resultSha256,resultBytes:entry.resultBytes,readerSha256:entry.readerSha256,inputSha256:entry.inputSha256,acceptedFence:entry.acceptedFence},
    partIds:[entry.selectedParts[0].id]};
  const objects=new Map([[gltfResultKey(input.jobId,resultHash),resultBytes],[result.artifact.key,nativeBytes],
    [documentResultKey(document.input.jobId,entry.resultSha256),documentBytes]]);
  const read:typeof readFusionResult=(selection,authority,bounds)=>readFusionResult(selection,authority,bounds,
    (key,size,digest,bounds)=>readFusionObject(key,size,digest,bounds,async()=>{
      const bytes=objects.get(key);assert(bytes,`unexpected owned key: ${key}`);return {body:Readable.from([bytes]),etag:'memory-control'};
    }));
  return {current,source,job,result,native,nativeBytes,original,resultBytes,selection,document,docSelection,read};
}
function authorityControl(f:ReturnType<typeof fixture>){
  let active=false,transactions=0,writes=0,tools=0;
  const client={query:async(sql:string)=>{
    if(/^(INSERT|UPDATE|DELETE)\b/.test(sql))writes++;
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[f.current]};
    if(sql.includes('SELECT * FROM sources'))return {rows:[f.source]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:f.source.revision}]};
    if(sql.includes('SELECT j.*,m.result_ref'))return {rows:[f.job]};
    if(sql.includes('SELECT accepted_fence'))return {rows:[{accepted_fence:f.docSelection.pin.acceptedFence}]};
    return {rows:[]};
  }};
  const deps={transaction:async(action:any)=>{transactions++;active=true;try{return await action(client);}finally{active=false;}},
    document:async()=>f.document.input,cityjson:async()=>assert.fail('no CityJSON authority'),gate:async()=>{},
    gltf:acceptedFusionGltfTx,gltfTools:()=>{assert(!active,'tool inventory held a transaction');tools++;}};
  const authority:typeof fusionAuthorityBatch=(ctx,selections,bounds,expected)=>fusionAuthorityBatch(ctx,selections,bounds,expected,deps as any);
  return {client,authority,stats:()=>({active,transactions,writes,tools})};
}
function save(name:string,value:unknown){const proof=process.env.ULPIN_FUSION_GLTF_PROOF_DIR;
  if(proof)writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const contextOnly=(e:any)=>e.status===422&&e.code==='SOURCE_FUSION_GLTF_CONTEXT_ONLY';
function at(root:any,pointer:string){return pointer.slice(1).split('/').reduce((value,key)=>value[key.replaceAll('~1','/').replaceAll('~0','~')],root);}

test('retained GLB plus document assembles selected nodes and exact incident metadata, context-only downstream',()=>local(async()=>{
  const f=fixture(),control=authorityControl(f),request={sources:[f.selection,f.docSelection]},events:string[]=[];
  const context=await assembleSourceFusion(ctx(),request,{authority:async(ctx,selections,bounds,expected)=>{
    events.push(expected?'final-all':'initial-all');return control.authority(ctx,selections,bounds,expected);
  },read:async(selection,authority,bounds)=>{assert(!control.stats().active);events.push('read:'+selection.kind);return f.read(selection,authority,bounds);}});
  const gltf=context.sources.find(s=>s.kind==='gltf')!;assert(gltf.kind==='gltf');
  assert.equal(events[0],'initial-all');assert.equal(events.at(-1),'final-all');assert.equal(events.length,4);
  assert.deepEqual(control.stats(),{active:false,transactions:2,writes:0,tools:2});
  assert.equal(gltf.nodes.length,1);assert.equal(gltf.nodes[0].index,1);assert.deepEqual(gltf.nodes[0].record,f.native.nodes[1]);
  assert.deepEqual(gltf.nodes[0].parentReferences,[{nodeIndex:0,pointer:'/nodes/0/children/0',childOrdinal:0,childIndex:1}]);
  assert.deepEqual((gltf.nodes[0].record.transform as any).specificationDefaults,{translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
  assert.deepEqual(gltf.selectedScene,f.native.selectedScene);assert.equal(gltf.selectedSceneDeclaration.state,'declared');
  assert.equal(gltf.meshes.length,1);assert.equal(gltf.primitives.length,1);assert.equal(gltf.accessors.length,3);
  assert.equal(gltf.buffers[0].record.status,'available');assert.equal(gltf.resources.materials.length,1);
  for(const record of [...gltf.nodes,...gltf.meshes,...gltf.accessors,...gltf.bufferViews,...gltf.buffers,...gltf.resources.materials]){
    assert.deepEqual(record.record,at(f.native,record.artifactPointer));assert.equal(record.recordSha256,fingerprint(record.record));}
  const primitive=gltf.primitives[0];assert.equal(primitive.recordSha256,fingerprint(at(f.native,primitive.artifactPointer)));
  assert.equal(primitive.metadataSha256,fingerprint(primitive.metadata));assert(!Object.hasOwn((primitive.metadata.projection as any).POSITION,'values'));
  assert(!Object.hasOwn((primitive.metadata.projection as any).indices,'values'));
  for(const omitted of primitive.omittedArrays){assert.equal(omitted.state,'present');assert.equal(omitted.valueSha256,fingerprint(at(f.native,omitted.artifactPointer)));
    assert.equal(omitted.count,omitted.role==='POSITION'?24:36);}
  const rootNode=fusionSourceProjection({...f.selection,nodeIndices:[0]},{kind:'gltf',result:f.result,native:f.native});assert(rootNode.kind==='gltf');
  assert.deepEqual(rootNode.nodes[0].record,f.native.nodes[0]);assert.equal(rootNode.nodes[0].index,0);assert.equal(rootNode.meshes.length,0);
  assert.equal(rootNode.primitives.length,0);assert.notEqual(rootNode.selectionSha256,gltf.selectionSha256);
  assert.equal(gltf.coverage.transformComposition,'not_performed');assert.equal(gltf.summary.canonicalIdentity,'not_assessed');
  assert.equal(gltf.qualification.analyticalGeometry,false);assert.deepEqual(context.association.canonicalTargets,[]);
  const document=context.sources.find(s=>s.kind==='document')!;assert(document.kind==='document');
  assert.equal(document.parts[0].part.text,'  <gml:name>RD + NAP height</gml:name>');
  const contextHash=context.contextSha256;
  assert.throws(()=>associationLiterals(context),contextOnly);assert.throws(()=>associationManualSelection({context:{selection:request}} as any,context,[]),contextOnly);
  await assert.rejects(()=>captureAssociationFusion(ctx(),request,budget()),contextOnly);
  await assert.rejects(()=>proposeFusionAssociations(ctx(),{requestKey:f.selection.pin.jobId,context:{contextSha256:contextHash,selection:request},scope:null,targets:[]},
    {capture:()=>assert.fail('no association capture'),targets:()=>assert.fail('no targets'),gateway:()=>assert.fail('no model')} as any),contextOnly);
  await assert.rejects(()=>resolveFusionCitationsTx({query:()=>assert.fail('no citation I/O')} as any,ctx(),
    {contextSha256:contextHash,selection:request},{source:()=>assert.fail('no source I/O')} as any,f.selection.pin.caseId,true),contextOnly);
  const amendment={requestKey:f.selection.pin.jobId,recordId:f.selection.pin.sourceId,expectedDraftRevision:1,expectedRecordRevision:1,
    addFusion:{contextSha256:contextHash,selection:request}};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx({query:()=>assert.fail('no registry I/O')} as any,f.selection.pin.caseId,amendment),contextOnly);
  await assert.rejects(()=>amendRegistryDocumentCitations(f.selection.pin.caseId,amendment),contextOnly);
  assert.equal(context.contextSha256,contextHash);assert.deepEqual(fusionContextProjection(context.sources),context);
  save('glb-controlled-journey.json',{qualification:'memory-only SQL/storage/tool controls; unchanged retained originals/native/document',request,context,rootNode,
    stats:control.stats(),events,contextOnlyRefusals:7,modelCalls:0,nativeRuns:0,originalSha256:sha256(f.original),resultSha256:sha256(f.resultBytes)});
}));

test('naturally missing GLTF companion stays unfetched; stale/final-access and selection bounds fail closed',()=>local(async()=>{
  const f=fixture('Box.gltf'),control=authorityControl(f),request={sources:[f.selection,f.docSelection]};
  const context=await assembleSourceFusion(ctx(),request,{authority:control.authority,read:f.read}),gltf=context.sources.find(s=>s.kind==='gltf')!;assert(gltf.kind==='gltf');
  assert.equal(gltf.summary.status,'inspected_partial');assert.equal(gltf.summary.geometryProjectionStatus,'unavailable');
  assert.equal(gltf.buffers[0].record.uri,'Box0.bin');assert.equal(gltf.buffers[0].record.status,'needs_input');assert.equal(gltf.buffers[0].record.fetched,false);
  assert.deepEqual(gltf.nodes[0].record,f.native.nodes[1]);assert(gltf.primitives[0].omittedArrays.every(a=>a.state==='absent'&&a.count===null&&a.valueSha256===null));
  await assert.rejects(()=>acceptedFusionGltfTx(control.client as any,{...f.selection.pin,resultSha256:'0'.repeat(64)}),(e:any)=>e.status===409);
  await assert.rejects(()=>control.authority(ctx(),[{...f.selection,pin:{...f.selection.pin,acceptedFence:2}},f.docSelection],budget()),(e:any)=>e.status===409);
  for(const nodeIndices of [[],[1,1],[0.5],[-1],[10000],Array.from({length:25},(_,i)=>i)])
    assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.selection,nodeIndices},f.docSelection]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.selection,pin:{...f.selection.pin,resultBytes:GLTF_LIMITS.resultBytes+1}},f.docSelection]}).success);
  assert.throws(()=>fusionSourceProjection({...f.selection,nodeIndices:[2]},{kind:'gltf',result:f.result,native:f.native}),(e:any)=>e.status===422);
  let reads=0;const revoked=authorityControl(f);
  await assert.rejects(()=>assembleSourceFusion(ctx(),request,{authority:revoked.authority,read:async(selection,authority,bounds)=>{
    const loaded=await f.read(selection,authority,bounds);if(++reads===2)f.current.archived=true;return loaded;
  }}),(e:any)=>e.status===403&&e.code==='SOURCE_FUSION_UNAVAILABLE');
  assert.equal(reads,2);assert.deepEqual(revoked.stats(),{active:false,transactions:2,writes:0,tools:1});
  save('partial-and-denial-controlled-journey.json',{qualification:'memory-only SQL/storage/tool and denial controls; retained incomplete JSON artifact',request,context,
    wrongResultDenied:true,staleFenceDenied:true,selectionBoundsDenied:true,revokedAfterReads:reads,publishedAfterRevocation:false,
    stats:revoked.stats(),nativeRuns:0,externalFetches:0,originalSha256:sha256(f.original),resultSha256:sha256(f.resultBytes)});
}));
