import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {DocumentResultSchema} from '../packages/contracts/src/usp';
import {CityGMLOriginalSchema,CityGMLResultSchema} from '../packages/contracts/src/usp/citygml-ingestion';
import {SourceFusionRequestSchema,type SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {assembleSourceFusion,fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,readFusionResult,readFusionObject,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {acceptedFusionCityGMLTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citygml-authority';
import {captureAssociationFusion,proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {associationLiterals,associationManualSelection} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {citygmlArtifactKey,citygmlResultKey} from '../packages/server/src/modules/usp/ingestion/citygml';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Unchanged accepted envelopes/native/original/document bytes. Source/fence/SQL,
// object transport and tool assertions below are explicitly memory-only controls.
// These checks prevent selection expansion and stale/denied partial disclosure.
const root=process.env.ULPIN_CITYGML_FUSION_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-citygml-private-api/journey-01';
const documentRoot=process.env.ULPIN_REFERENCE_DOCUMENT_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-reference-document-enrollment';
const labels=['Building_and_garage_LOD2-EPSG25832.gml','Building_LOD1-LocalEngineeringCRS.gml'] as const;
const present=labels.every(name=>existsSync(root+'/'+name+'.native.json')&&existsSync(root+'/'+name+'.journey.json'))&&
  existsSync(documentRoot+'/epsg7415-accepted-result.json');
const budget=():FusionBudget=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal,reservedBytes:0});
const ctx=()=>localRequestContext('fusion-citygml-protocol-control');
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='citygml-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(label:typeof labels[number]=labels[0]){
  const journey=JSON.parse(readFileSync(root+'/'+label+'.journey.json','utf8')),
    result=CityGMLResultSchema.parse(journey.accepted),input=result.input,
    nativeBytes=readFileSync(root+'/'+label+'.native.json'),native=JSON.parse(nativeBytes.toString('utf8')),
    resultBytes=Buffer.from(JSON.stringify(result)),resultHash=sha256(resultBytes);
  assert.deepEqual(result.input,journey.accepted.input);assert.deepEqual(result.summary,journey.status.result.summary);
  assert.equal(result.artifact.sha256,sha256(nativeBytes));assert.equal(result.artifact.bytes,nativeBytes.length);
  assert.equal(result.artifact.key,citygmlArtifactKey(input.jobId,sha256(nativeBytes)));
  const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-citygml/sources.json',import.meta.url),'utf8')),
    originalEntry=manifest.sources.find((source:any)=>source.sha256===input.sourceSha256),original=readFileSync(originalEntry.localPath);
  assert.equal(sha256(original),input.sourceSha256);assert.equal(original.length,input.sourceBytes);
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null};
  assert.equal(fingerprint({frame:null,context:null,siteId:null}),input.caseContextSha256);
  const binding=ingestionBinding(input.caseId);assert.equal(binding.subject,input.subject);assert.equal(binding.access,input.accessSha256);
  const marker=CityGMLOriginalSchema.parse({version:input.version,subject:input.subject,accessSha256:input.accessSha256,
    sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:result.createdAt,lineageState:'caller_declared',
    lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['memory-only source authority control']}}),
    source={id:input.sourceId,case_id:input.caseId,family_id:input.sourceFamilyId,revision:input.sourceRevision,
      profile:'citygml-native-v1',sha256:input.sourceSha256,bytes:input.sourceBytes,object_key:input.objectKey,inspection:{citygmlOriginal:marker}},
    job={id:input.jobId,operation:'citygml-native',case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`citygml:${input.jobId}:${resultBytes.length}`,version:1,sha256:resultHash},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:resultHash},
    selection:Extract<SourceFusionSelection,{kind:'citygml'}>={kind:'citygml',pin:{caseId:input.caseId,caseRevision:input.caseRevision,
      sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,jobId:input.jobId,
      resultSha256:resultHash,resultBytes:resultBytes.length,readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1},buildingOrdinals:[0]};
  const documentBytes=readFileSync(documentRoot+'/epsg7415-accepted-result.json'),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    entry=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((entry:any)=>entry.id==='epsg7415');
  assert.equal(sha256(documentBytes),entry.resultSha256);assert.equal(fingerprint(document.input),entry.inputSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:entry.caseId,caseRevision:entry.caseRevision,
    sourceId:entry.sourceId,sourceRevision:entry.sourceRevision,sourceSha256:entry.sourceSha256,jobId:entry.jobId,
    resultSha256:entry.resultSha256,resultBytes:entry.resultBytes,readerSha256:entry.readerSha256,inputSha256:entry.inputSha256,acceptedFence:entry.acceptedFence},
    partIds:[entry.selectedParts[0].id]};
  const objects=new Map([[citygmlResultKey(input.jobId,resultHash),resultBytes],[result.artifact.key,nativeBytes],
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
    citygml:acceptedFusionCityGMLTx,citygmlTools:()=>{assert(!active,'tool inventory held a transaction');tools++;}};
  const authority:typeof fusionAuthorityBatch=(ctx,selections,bounds,expected)=>fusionAuthorityBatch(ctx,selections,bounds,expected,deps as any);
  return {client,authority,stats:()=>({active,transactions,writes,tools})};
}
function save(name:string,value:unknown){
  const proof=process.env.ULPIN_FUSION_CITYGML_PROOF_DIR;if(!proof)return;
  mkdirSync(proof,{recursive:true});writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
const contextOnly=(e:any)=>e.status===422&&e.code==='SOURCE_FUSION_CITYGML_CONTEXT_ONLY';

test('retained CityGML building plus document preserves exact fragments without expanding unselected parts',{skip:!present},()=>local(async()=>{
  const f=fixture(),control=authorityControl(f),request={sources:[f.selection,f.docSelection]},events:string[]=[];
  const context=await assembleSourceFusion(ctx(),request,{authority:async(ctx,selections,bounds,expected)=>{
    events.push(expected?'final-all':'initial-all');return control.authority(ctx,selections,bounds,expected);
  },read:async(selection,authority,bounds)=>{assert(!control.stats().active);events.push('read:'+selection.kind);return f.read(selection,authority,bounds);}});
  const city=context.sources.find(s=>s.kind==='citygml')!;assert(city.kind==='citygml');
  assert.equal(events[0],'initial-all');assert.equal(events.at(-1),'final-all');assert.equal(events.length,4);
  assert.deepEqual(control.stats(),{active:false,transactions:2,writes:0,tools:2});
  assert.equal(city.buildings.length,1);const building=city.buildings[0];
  assert.deepEqual(building.record,f.native.buildings[0]);assert.equal(building.recordSha256,fingerprint(building.record));
  const {ordinal,key,pointer,recordSha256,fragmentSha256,...fragment}=building;assert.equal(fragmentSha256,fingerprint(fragment));
  assert.equal(building.pointer,'/buildings/0');assert.equal(building.record.id,'GML_7b1a5a6f-ddad-4c3d-a507-3eb9ee0a8e68');
  assert(!building.elements.some(e=>e.ordinal===103));assert(!city.sourceContext.elements.some(e=>e.ordinal===103));
  assert.equal(building.record.parentBuildingElement,null);assert.equal(city.coverage.availableNativeBuildings,2);
  const root=building.elements.find(e=>e.ordinal===7)! as any;
  assert(f.original.subarray(root.locator.byteStart,root.locator.byteEnd).toString('utf8').startsWith('<bldg:Building '));
  for(const element of building.elements){assert.deepEqual(element,f.native.elements[element.ordinal as number]);}
  assert.deepEqual(city.namespaces,f.native.namespaces);assert.deepEqual(city.findings,f.native.findings);
  assert.equal(city.summary.status,'partial');assert.equal(city.semantics.globalTransformApplied,false);
  assert(building.coordinates.some((c:any)=>c.tupleDimensionState==='absent'&&c.tupleDimension===null));
  assert(building.references.some((r:any)=>r.state==='local_target_inventory'));
  const part=fusionSourceProjection({...f.selection,buildingOrdinals:[1]},{kind:'citygml',result:f.result,native:f.native});assert(part.kind==='citygml');
  assert.equal(part.buildings[0].record.type,'BuildingPart');assert.equal(part.buildings[0].record.parentBuildingElement,7);
  assert(!part.buildings[0].elements.some(e=>e.ordinal===7));assert.notEqual(part.selectionSha256,city.selectionSha256);
  const doc=context.sources.find(s=>s.kind==='document')!;assert(doc.kind==='document');
  assert.equal(doc.parts[0].part.text,'  <gml:name>RD + NAP height</gml:name>');assert.deepEqual(context.association.canonicalTargets,[]);
  assert.throws(()=>associationLiterals(context),contextOnly);
  assert.throws(()=>associationManualSelection({context:{selection:request}} as any,context,[]),contextOnly);
  await assert.rejects(()=>captureAssociationFusion(ctx(),request,budget()),contextOnly);
  await assert.rejects(()=>proposeFusionAssociations(ctx(),{requestKey:f.selection.pin.jobId,context:{contextSha256:context.contextSha256,selection:request},scope:null,targets:[]},
    {capture:()=>assert.fail('no association capture'),gateway:()=>assert.fail('no model')} as any),contextOnly);
  await assert.rejects(()=>resolveFusionCitationsTx({query:()=>assert.fail('no citation I/O')} as any,ctx(),
    {contextSha256:context.contextSha256,selection:request},{source:()=>assert.fail('no source I/O')} as any,f.selection.pin.caseId),contextOnly);
  const old=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/desktop-source-fusion-ocr/mixed-context.json','utf8'));
  assert.deepEqual(fusionContextProjection(old.sources),old);
  save('lod2-controlled-journey.json',{qualification:'controlled authority/storage/tools; unchanged retained originals/native/document',request,context,part});
}));

test('retained local engineering CityGML stays partial with opaque metadata and absent building reference',{skip:!present},()=>local(async()=>{
  const f=fixture(labels[1]),control=authorityControl(f),request={sources:[f.selection,f.docSelection]},
    context=await assembleSourceFusion(ctx(),request,{authority:control.authority,read:f.read}),city=context.sources.find(s=>s.kind==='citygml')!;
  assert(city.kind==='citygml');assert.equal(city.summary.status,'partial');assert.equal(city.buildings[0].record.lodDeclarations[0].lodLiteral,'1');
  assert(city.sourceContext.elements.some((e:any)=>e.namespace==='urn:x-ogp:spec:schema-xsd:localmetadata'&&e.interpretation.startsWith('unsupported')));
  const coordinate=city.buildings[0].coordinates[0] as any;
  assert.equal(coordinate.referenceDeclarations.srsName.state,'absent');assert.equal(coordinate.tupleDimensionState,'absent');
  assert.equal(coordinate.tupleDimension,null);assert.equal(coordinate.values[0].literal,'7.0');
  const value=coordinate.values[0];assert.equal(f.original.subarray(value.locator.byteStart,value.locator.byteEnd).toString('utf8'),value.literal);
  assert(city.sourceContext.references.some((r:any)=>r.literal==='#local-CRS-1'));assert.equal(city.semantics.externalResourcesResolved,false);
  assert.equal(city.semantics.referencePolicy,f.native.semantics.referencePolicy);assert.equal(city.coverage.opaqueContent,'literal_only');
  save('local-controlled-journey.json',{qualification:'controlled authority/storage/tools; unchanged retained originals/native/document',request,context});
}));

test('CityGML accepted result/fence pins and complete-set revocation deny any context publication',{skip:!present},()=>local(async()=>{
  const f=fixture(),control=authorityControl(f),request={sources:[f.selection,f.docSelection]};
  await acceptedFusionCityGMLTx(control.client as any,f.selection.pin);
  await assert.rejects(()=>acceptedFusionCityGMLTx(control.client as any,{...f.selection.pin,resultSha256:'0'.repeat(64)}),(e:any)=>e.status===409);
  await assert.rejects(()=>control.authority(ctx(),[{...f.selection,pin:{...f.selection.pin,acceptedFence:2}},f.docSelection],budget()),(e:any)=>e.status===409);
  const changed={...f.result,input:{...f.result.input,sourceRevision:2}};
  assert.throws(()=>fusionSourceProjection(f.selection,{kind:'citygml',result:changed,native:f.native}),(e:any)=>e.status===422);
  const wrong=Buffer.from(JSON.stringify({...f.result,artifact:{...f.result.artifact,key:'wrong-job-artifact'}}));
  await assert.rejects(()=>readFusionResult({...f.selection,pin:{...f.selection.pin,resultBytes:wrong.length,resultSha256:sha256(wrong)}},
    {kind:'citygml',input:f.result.input,acceptedFence:1},budget(),async()=>wrong),(e:any)=>e.status===422);
  for(const buildingOrdinals of [[],[0,0],[0.5],[-1],[25000]])
    assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.selection,buildingOrdinals},f.docSelection]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.selection,buildingOrdinals:Array.from({length:25},(_,i)=>i)},f.docSelection]}).success);
  let reads=0;const fresh=authorityControl(f);
  await assert.rejects(()=>assembleSourceFusion(ctx(),request,{authority:fresh.authority,read:async(selection,authority,bounds)=>{
    const loaded=await f.read(selection,authority,bounds);if(++reads===2)f.current.archived=true;return loaded;
  }}),(e:any)=>e.status===403&&e.code==='SOURCE_FUSION_UNAVAILABLE');
  assert.equal(reads,2);assert.deepEqual(fresh.stats(),{active:false,transactions:2,writes:0,tools:1});
  save('denial-control.json',{qualification:'memory-only stale/revocation controls',staleResultDenied:true,staleFenceDenied:true,
    changedInputDenied:true,wrongArtifactDenied:true,revokedAfterReads:reads,stats:fresh.stats(),published:false});
}));
