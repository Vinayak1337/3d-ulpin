import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {DocumentResultSchema,KMLOriginalSchema,KMLResultSchema} from '../packages/contracts/src/usp';
import {SourceFusionRequestSchema,type SourceFusionSelection} from '../packages/contracts/src/source-fusion';
import {assembleSourceFusion,fusionSourceProjection,fusionContextProjection,type SourceFusionDependencies} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,readFusionResult,readFusionObject,type FusionBudget} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {acceptedFusionKMLTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-kml-authority';
import {associationLiterals,associationManualSelection} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {kmlArtifactKey,kmlResultKey} from '../packages/server/src/modules/usp/ingestion/kml';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Reuse actual KML-02 accepted envelopes/native bytes and the saved document.
// SQL/source-marker/accepted-fence rows and tool checks are memory-only controls;
// no historical database record, current inventory or live persistence is claimed.
const root=process.env.ULPIN_KML_FUSION_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-kml-private-api/journey-initial';
const documentRoot=process.env.ULPIN_REFERENCE_DOCUMENT_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-reference-document-enrollment';
const labels=['kmlsamples.kml','multikml-doc.kmz','multikml-doc.kmz.selected'] as const;
const present=labels.every(name=>existsSync(root+'/'+name+'.native.json')&&existsSync(root+'/'+name+'.journey.json'))&&
  existsSync(documentRoot+'/epsg7415-accepted-result.json');
const budget=():FusionBudget=>({deadlineAt:Date.now()+30000,signal:new AbortController().signal,reservedBytes:0});
const ctx=()=>localRequestContext('fusion-kml-protocol-control');
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='kml-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(label:typeof labels[number]='kmlsamples.kml'){
  const journey=JSON.parse(readFileSync(root+'/'+label+'.journey.json','utf8')),
    result=KMLResultSchema.parse(journey.accepted),input=result.input,
    nativeBytes=readFileSync(root+'/'+label+'.native.json'),native=JSON.parse(nativeBytes.toString('utf8')),
    resultBytes=Buffer.from(JSON.stringify(result)),resultHash=sha256(resultBytes);
  assert.deepEqual(result.input,journey.accepted.input);assert.deepEqual(result.summary,journey.status.result.summary);
  assert.equal(result.artifact.sha256,sha256(nativeBytes));assert.equal(result.artifact.bytes,nativeBytes.length);
  assert.equal(result.artifact.key,kmlArtifactKey(input.jobId,sha256(nativeBytes)));
  const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-kml/sources.json',import.meta.url),'utf8')),
    originalEntry=manifest.sources.find((source:any)=>source.sha256===input.sourceSha256),original=readFileSync(originalEntry.path);
  assert.equal(sha256(original),input.sourceSha256);assert.equal(original.length,input.sourceBytes);
  const current={id:input.caseId,revision:input.caseRevision,archived:false,frame:null,context:null,site_id:null};
  assert.equal(fingerprint({frame:null,context:null,siteId:null}),input.caseContextSha256);
  const binding=ingestionBinding(input.caseId);assert.equal(binding.subject,input.subject);assert.equal(binding.access,input.accessSha256);
  const marker=KMLOriginalSchema.parse({version:input.version,subject:input.subject,accessSha256:input.accessSha256,
    sha256:input.sourceSha256,bytes:input.sourceBytes,receivedAt:result.createdAt,lineageState:'caller_declared',
    lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,geography:null,limitations:['memory-only source authority control']}}),
    source={id:input.sourceId,case_id:input.caseId,family_id:input.sourceFamilyId,revision:input.sourceRevision,
      profile:'kml-native-v1',sha256:input.sourceSha256,bytes:input.sourceBytes,object_key:input.objectKey,inspection:{kmlOriginal:marker}},
    job={id:input.jobId,operation:'kml-native',case_id:input.caseId,source_id:input.sourceId,case_revision:input.caseRevision,payload:input,
      input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`kml:${input.jobId}:${resultBytes.length}`,version:1,sha256:resultHash},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:resultHash},
    selection:Extract<SourceFusionSelection,{kind:'kml'}>={kind:'kml',pin:{caseId:input.caseId,caseRevision:input.caseRevision,
      sourceId:input.sourceId,sourceRevision:input.sourceRevision,sourceSha256:input.sourceSha256,jobId:input.jobId,
      resultSha256:resultHash,resultBytes:resultBytes.length,readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1},
      featureOrdinals:label==='kmlsamples.kml'?[3,2]:[0]};
  const documentBytes=readFileSync(documentRoot+'/epsg7415-accepted-result.json'),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    entry=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((entry:any)=>entry.id==='epsg7415');
  assert.equal(sha256(documentBytes),entry.resultSha256);assert.equal(fingerprint(document.input),entry.inputSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:entry.caseId,caseRevision:entry.caseRevision,
    sourceId:entry.sourceId,sourceRevision:entry.sourceRevision,sourceSha256:entry.sourceSha256,jobId:entry.jobId,
    resultSha256:entry.resultSha256,resultBytes:entry.resultBytes,readerSha256:entry.readerSha256,inputSha256:entry.inputSha256,acceptedFence:entry.acceptedFence},
    partIds:[entry.selectedParts[0].id]};
  const objects=new Map([[kmlResultKey(input.jobId,resultHash),resultBytes],[result.artifact.key,nativeBytes],
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
    kml:acceptedFusionKMLTx,kmlTools:()=>{assert(!active,'tool inventory held a transaction');tools++;}};
  const authority:typeof fusionAuthorityBatch=(ctx,selections,bounds,expected)=>fusionAuthorityBatch(ctx,selections,bounds,expected,deps as any);
  return {client,authority,stats:()=>({active,transactions,writes,tools})};
}
function save(name:string,value:unknown){
  const proof=process.env.ULPIN_FUSION_KML_PROOF_DIR;if(!proof)return;
  mkdirSync(proof,{recursive:true});writeFileSync(proof+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}

test('retained accepted KML and document preserve selected feature literals, declarations and context-only boundaries',{skip:!present},()=>local(async()=>{
  const f=fixture(),control=authorityControl(f),events:string[]=[],request={sources:[f.selection,f.docSelection]};
  const deps:SourceFusionDependencies={authority:async(ctx,selections,bounds,expected)=>{
    events.push(expected?'final-all':'initial-all');return control.authority(ctx,selections,bounds,expected);
  },read:async(selection,authority,bounds)=>{assert(!control.stats().active);events.push('read:'+selection.kind);return f.read(selection,authority,bounds);}};
  const context=await assembleSourceFusion(ctx(),request,deps),kml=context.sources.find(source=>source.kind==='kml')!;assert(kml.kind==='kml');
  assert.equal(events[0],'initial-all');assert.equal(events.at(-1),'final-all');assert.equal(events.length,4);
  assert.deepEqual(control.stats(),{active:false,transactions:2,writes:0,tools:2});
  assert.deepEqual(kml.features.map(entry=>entry.ordinal),[2,3]);
  for(const entry of kml.features){assert.deepEqual(entry.record,f.native.features[entry.ordinal]);assert.equal(entry.recordSha256,fingerprint(entry.record));}
  const simple=kml.features[0].record as any,floating=kml.features[1].record as any;
  assert.equal(simple.name.values[0].text,'Simple placemark');assert.equal(floating.sourceId.text,'floating-placemark');
  assert.deepEqual(simple.geometries[0].declarations.altitudeMode,{state:'absent',values:[]});
  assert.equal(simple.geometries[0].specificationDefaults.altitudeMode,'clampToGround');
  assert.equal(floating.geometries[0].declarations.altitudeMode.values[0].text,'relativeToGround');
  assert.deepEqual(floating.geometries[0].coordinates.sequences[0].tuples[0].lexemes,['-122.084075','37.4220033612141','50']);
  assert.equal(floating.geometries[0].verticalReference.qualifiedDatum,null);
  const field=floating.geometries[0].declarations.altitudeMode.values[0];
  assert.ok(f.original.toString('utf8').split(/\r?\n/)[field.locator.line-1].includes('>'+field.text+'<'));
  assert.deepEqual(kml.document,f.native.document);assert.deepEqual(kml.findings.references,f.native.references);
  assert.deepEqual(kml.findings.unsupported,f.native.unsupported);assert.equal(kml.summary.status,'partial');
  const doc=context.sources.find(source=>source.kind==='document')!;assert(doc.kind==='document');
  assert.equal(doc.parts[0].part.text,'  <gml:name>RD + NAP height</gml:name>');assert.equal(context.association.state,'not_assessed');
  assert.deepEqual(context.association.canonicalTargets,[]);
  const denied=(e:any)=>e.status===422&&e.code==='SOURCE_FUSION_KML_CONTEXT_ONLY';
  assert.throws(()=>associationLiterals(context),denied);assert.throws(()=>associationManualSelection({context:{selection:request}} as any,context,[]),denied);
  await assert.rejects(()=>resolveFusionCitationsTx({query:()=>assert.fail('no citation I/O')} as any,ctx(),
    {contextSha256:context.contextSha256,selection:request},{source:()=>assert.fail('no document authority')} as any),denied);
  const old=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/desktop-source-fusion-ocr/mixed-context.json','utf8'));
  assert.deepEqual(fusionContextProjection(old.sources),old);
  save('controlled-selection.json',SourceFusionRequestSchema.parse(request));save('controlled-context.json',context);
}));

test('selected accepted KMZ fragment stays partial with absent geometry; unselected archive gives an actionable refusal',{skip:!present},()=>local(async()=>{
  const f=fixture('multikml-doc.kmz.selected'),control=authorityControl(f),request={sources:[f.selection,f.docSelection]},
    context=await assembleSourceFusion(ctx(),request,{authority:control.authority,read:f.read}),kml=context.sources.find(source=>source.kind==='kml')!;
  assert(kml.kind==='kml');assert.equal(kml.summary.status,'partial');assert.equal(kml.summary.horizontalReference,'unknown');
  assert.deepEqual(kml.summary.member,{path:'doc/doc.kml',ordinal:3,sha256:'727198e00328bbeaa4e7b8af4260084eb28315b26eff817297dc1bcacd2c4455',bytes:44});
  assert.equal(kml.summary.xmlSha256,kml.summary.member!.sha256);assert.notEqual(kml.summary.xmlSha256,kml.summary.sourceSha256);
  assert.deepEqual(kml.features[0].record,f.native.features[0]);assert.deepEqual(kml.features[0].record.geometries,[]);
  assert.equal(kml.features[0].record.geometryState,'absent');assert.equal((kml.document.horizontalReference as any).basis,null);
  save('selected-kmz-context.json',context);
  const pending=fixture('multikml-doc.kmz'),pendingControl=authorityControl(pending);
  await assert.rejects(()=>assembleSourceFusion(ctx(),{sources:[pending.selection,pending.docSelection]},
    {authority:pendingControl.authority,read:pending.read}),(e:any)=>e.status===422&&e.code==='SOURCE_FUSION_KML_MEMBER_SELECTION_REQUIRED'&&e.message.includes('canonical KML retry'));
}));

test('KML exact member/result pins and full-set reauthorization deny stale or revoked context',{skip:!present},()=>local(async()=>{
  const f=fixture('multikml-doc.kmz.selected'),control=authorityControl(f),request={sources:[f.selection,f.docSelection]};
  await acceptedFusionKMLTx(control.client as any,f.selection.pin);
  await assert.rejects(()=>acceptedFusionKMLTx(control.client as any,{...f.selection.pin,resultSha256:'0'.repeat(64)}),(e:any)=>e.status===409);
  const changed={...f.result,input:{...f.result.input,selection:{...f.result.input.selection!,sha256:'0'.repeat(64)}}};
  assert.throws(()=>fusionSourceProjection(f.selection,{kind:'kml',result:changed,native:f.native}),(e:any)=>e.status===422);
  const wrongBytes=Buffer.from(JSON.stringify({...f.result,artifact:{...f.result.artifact,key:'wrong-job-artifact'}}));
  await assert.rejects(()=>readFusionResult({...f.selection,pin:{...f.selection.pin,resultBytes:wrongBytes.length,resultSha256:sha256(wrongBytes)}},
    {kind:'kml',input:f.result.input,acceptedFence:1},budget(),async()=>wrongBytes),(e:any)=>e.status===422);
  for(const featureOrdinals of [[],[0,0],[0.5],[-1],[10000]])
    assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.selection,featureOrdinals},f.docSelection]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[{...f.selection,featureOrdinals:Array.from({length:25},(_,i)=>i)},f.docSelection]}).success);
  let reads=0;
  await assert.rejects(()=>assembleSourceFusion(ctx(),request,{authority:control.authority,read:async(selection,authority,bounds)=>{
    assert(!control.stats().active);const loaded=await f.read(selection,authority,bounds);if(++reads===2)f.current.archived=true;return loaded;
  }}),(e:any)=>e.status===403&&e.code==='SOURCE_FUSION_UNAVAILABLE');
  assert.equal(reads,2);assert.deepEqual(control.stats(),{active:false,transactions:2,writes:0,tools:1});
}));
