import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {PointOriginalSchema,PointBatchResultSchema,DocumentResultSchema} from '../packages/contracts/src/usp';
import type {RegistryRecord} from '../packages/contracts/src/registry';
import {RegistryDocumentAmendmentSchema} from '../packages/contracts/src/registry-document-evidence';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  documentReviewContext,publicRegistryBody,citationId,type RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryPointCitationSourceTx} from '../packages/server/src/modules/registry/registry-point-citation-source';
import {commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {pointInput,pointArtifactKey,pointResultKey} from '../packages/server/src/modules/usp/ingestion/point-batch';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {associationLiterals} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import type {SourceFusionSelection} from '../packages/contracts/src/source-fusion';

// Retained metadata/document/original are unchanged. Target/site/input/envelope,
// accepted attempt, review and SQL/storage are controls, not a property crosswalk
// or missing historical native record artifact proof. No native point bytes or native process.
const root='E:/BhuAayam-data/task-data/desktop-ai05b-point',
  originalPath='E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-lidar-2017.laz',
  documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const present=existsSync(root+'/point-http-final.json')&&existsSync(originalPath)&&existsSync(documentPath);
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest='a'.repeat(64);
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-point-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(kind:'building'|'floor'|'space'='building',index=kind==='floor'?1:0){
  const oldBytes=readFileSync(root+'/point-http-final.json'),old=JSON.parse(oldBytes.toString('utf8')),raw=readFileSync(originalPath),
    retained=old.results[index],earlier=JSON.parse(readFileSync(root+'/point-http-source-retain.json','utf8')),
    manifest=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json','utf8')),
    upstream=manifest.originals.find((v:any)=>v.name==='20170504_980200.copc.laz');
  assert.equal(sha256(oldBytes),'1c9f4f94bf3ebbeacae4549dd582d6fc369bda000b864524d3272114213bf4f2');
  assert.equal(sha256(raw),old.sourceSha256);assert.equal(raw.length,old.sourceBytes);
  const siteId=id(10),caseId=id(1),sourceId=id(2),jobId=id(3),draftId=id(20),binding=ingestionBinding(caseId),
    current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:siteId},
    marker=PointOriginalSchema.parse({version:'point-batch/1',subject:binding.subject,sha256:old.sourceSha256,bytes:old.sourceBytes,
      receivedAt:earlier.first.result.createdAt,lineageState:'caller_declared',lineage:{kind:'native_point_derivative',issuer:'NOAA distribution of NYC 2017 survey',
        originalUrl:upstream.url,acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.coverage,
        upstreamBytes:upstream.bytes,upstreamRetained:true,parentSha256:upstream.sha256,limitations:manifest.limitations,note:'memory-only authority control'}}),
    source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,profile:'laz-point-v1',sha256:old.sourceSha256,
      bytes:old.sourceBytes,object_key:`sources/${sourceId}/${old.sourceSha256}`,inspection:{pointOriginal:marker}},
    input=pointInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId})},jobId,index?retained.metadata.batch:null),
    result=PointBatchResultSchema.parse({version:'point-batch/1',input,metadata:retained.metadata,
      artifact:{...retained.artifact,key:pointArtifactKey(jobId,retained.artifact.sha256),mediaType:'application/vnd.las.point-records'},createdAt:new Date(0).toISOString()}),
    resultBytes=Buffer.from(JSON.stringify(result)),inputHash=fingerprint(input),
    job={id:jobId,operation:'point-batch',case_id:caseId,source_id:sourceId,case_revision:1,payload:input,input_fingerprint:inputHash,
      input_manifest_id:sourceId,input_sha256:inputHash,scope:{kind:'intake',workspaceId:caseId,version:2},
      status:'succeeded',logical_state:'succeeded',result_ref:{assetId:`point:${jobId}`,version:1,sha256:sha256(resultBytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:inputHash,completion_sha256:sha256(resultBytes)},
    selection:Extract<SourceFusionSelection,{kind:'point'}>={kind:'point',pin:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:old.sourceSha256,
      jobId,resultSha256:sha256(resultBytes),readerSha256:input.readerSha256,inputSha256:inputHash,acceptedFence:1,resultBytes:resultBytes.length},
      artifactSha256:result.artifact.sha256,metadataSha256:fingerprint(result.metadata),batch:result.metadata.batch};
  const documentBytes=readFileSync(documentPath),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    enrollment=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((r:any)=>r.id==='epsg7415');
  assert.equal(sha256(documentBytes),enrollment.resultSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:enrollment.caseId,caseRevision:enrollment.caseRevision,
    sourceId:enrollment.sourceId,sourceRevision:enrollment.sourceRevision,sourceSha256:enrollment.sourceSha256,jobId:enrollment.jobId,
    resultSha256:enrollment.resultSha256,resultBytes:documentBytes.length,readerSha256:enrollment.readerSha256,
    inputSha256:enrollment.inputSha256,acceptedFence:enrollment.acceptedFence},partIds:[enrollment.selectedParts[0].id]};
  const record:RegistryRecord={id:id(11),siteId,identifier:'controlled-existing-record',revision:1,alias:'Protocol target',name:'Protocol target',kind,
    footprint:[[0,0],[1,0],[1,1],[0,1]],links:[],rights:[],evidence:[{sourceId:id(12),locator:'existing protocol evidence'}],synthetic:true},
    {id:_,siteId:__,identifier:___,revision:____,...body}=record,
    state={draft:{id:draftId,site_id:siteId,case_id:id(21),records:[structuredClone(record)],revision:1,status:'draft'},
      row:{id:record.id,site_id:siteId,identifier:record.identifier,kind:record.kind,revision:1,body:structuredClone(body)},
      site:{id:siteId,identifier:'protocol-site',name:'protocol-site',revision:1,frame:{id:'protocol-frame'},synthetic:true},
      review:undefined as any,operations:new Map<string,any>(),history:new Map<number,any>([[1,structuredClone(body)]]),
      draftWrites:0,registryWrites:0,reads:0,revokeDuringDocument:false,driftDuringDocument:false,objectReads:[] as string[],calls:[] as string[]},
    ordinarySource={id:id(12),case_id:caseId,family_id:id(12),revision:1,sha256:digest,bytes:1,name:'protocol recording source',profile:'protocol',
      mime_type:'text/plain',object_key:'protocol',created_at:'2026-10-03T00:00:00Z',status:'ready',inspection:{}};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push(sql);let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources')||sql.includes('FROM building_preparations'))rows=[];
    else if(sql.includes('SELECT site_id,case_id,records FROM registry_drafts')||sql.startsWith('SELECT * FROM registry_drafts'))rows=[state.draft];
    else if(sql.startsWith('SELECT * FROM registry_reviews'))rows=[{draft_id:draftId,body:state.review,committed:state.review?.committed??false}];
    else if(sql.includes('FROM registry_sites'))rows=[state.site];
    else if(sql.includes('CASE WHEN r.revision'))rows=[{site_id:siteId,kind:record.kind,body:args[1]===state.row.revision?state.row.body:state.history.get(args[1])}];
    else if(sql.includes('FROM registry_records'))rows=[state.row];
    else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[current];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:source.revision}];
    else if(sql.includes('FROM sources'))rows=args[0]===id(12)?[ordinarySource]:[source];
    else if(sql.includes('SELECT j.*,m.result_ref'))rows=[job];
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:enrollment.acceptedFence}];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.startsWith('UPDATE registry_drafts SET records')){state.draft.records=JSON.parse(args[1]);state.draft.revision++;state.draftWrites++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else if(sql.startsWith('UPDATE registry_records')){state.row.body=structuredClone(args[1]);state.row.revision=args[2];state.registryWrites++;}
    else if(sql.startsWith('INSERT INTO registry_revisions')){state.history.set(args[1],structuredClone(args[2]));state.registryWrites++;}
    else if(sql.startsWith('DELETE FROM registry_'))state.registryWrites++;
    else if(sql.startsWith('UPDATE registry_sites')){state.site.revision=args[1];state.registryWrites++;}
    else if(sql.startsWith('UPDATE registry_drafts SET status')){state.draft.status='recorded';state.registryWrites++;}
    else if(sql.startsWith('UPDATE registry_reviews')){state.review.committed=true;state.registryWrites++;}
    else assert.fail('Unexpected protocol SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const objects=new Map([[pointResultKey(jobId,sha256(resultBytes)),resultBytes],[documentResultKey(document.input.jobId,sha256(documentBytes)),documentBytes]]);
  const dependencies:RegistryDocumentDependencies={source:async(_client,_ctx,pin)=>{assert.equal(pin.sourceId,docSelection.pin.sourceId);return document.input;},
    result:async()=>document,registrySource:async(_client,_site,sourceId)=>sourceId===docSelection.pin.sourceId?
      ({revision:document.input.sourceRevision,sha256:document.input.sourceSha256,accessSha256:document.input.accessSha256}) as any:
      ({revision:1,sha256:digest,accessSha256:digest}) as any,
    fusionResult:async(selected,authority,budget)=>{state.reads++;
      const loaded=await readFusionResult(selected,authority,budget,(key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async()=>{
        state.objectReads.push(key);const bytes=objects.get(key);assert(bytes,'No native records or sibling batch may be fetched');return {body:Readable.from([bytes]),etag:'protocol'};}));
      if(selected.kind==='document'){if(state.revokeDuringDocument)current.archived=true;if(state.driftDuringDocument)job.accepted_fence=job.attempt_fence=2;}
      return loaded;}};
  const context=fusionContextProjection([fusionSourceProjection(selection,{kind:'point',result}),fusionSourceProjection(docSelection,{kind:'document',result:document})]),
    request={requestKey:id(30),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,
      addFusion:{contextSha256:context.contextSha256,selection:{sources:[selection,docSelection]}}};
  return {client,dependencies,state,record,body,current,source,job,selection,request,draftId,siteId,context,result,document,docSelection,raw};
}
function prepareReview(f:ReturnType<typeof fixture>){const record=f.state.draft.records[0],reviewContext=documentReviewContext();
  f.state.review={id:id(40),draftId:f.draftId,draftRevision:f.state.draft.revision,siteRevision:1,records:[structuredClone(record)],before:[f.record],findings:[],committed:false,
    documentReviewContext:reviewContext,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',records:[record],frame:f.state.site.frame,
      draftRevision:f.state.draft.revision,siteRevision:1,documentReviewContext:reviewContext})};}
function save(name:string,value:unknown){const dir=process.env.ULPIN_POINT_CITATION_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('selected retained batch metadata and EPSG document traverse building/floor amendment, replay, review, commit and history',{skip:!present},()=>local(async()=>{
  for(const kind of ['building','floor'] as const){const f=fixture(kind),receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),record=f.state.draft.records[0];
    assert.equal(receipt.draftRevision,2);assert.equal(record.documentCitations!.length,2);const pin=record.documentCitations![0];
    assert(pin.version==='registry-point-metadata-citation/1');assert.equal(pin.id,citationId(pin));assert.deepEqual(pin.point.batch,f.selection.batch);
    assert.equal(pin.point.metadataSha256,fingerprint(f.result.metadata));assert(!Object.hasOwn(pin,'partId'));assert(!Object.hasOwn(pin,'identityAssertion'));
    assert.deepEqual(publicRegistryBody(record),f.record);
    const evidence=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),entry=evidence.citations[0];
    assert('fragment' in entry&&entry.fragment.kind==='point');assert.deepEqual(entry.fragment.metadata,f.result.metadata);
    assert.equal(fingerprint(entry.fragment),pin.point.fragmentSha256);assert.equal(entry.fragment.coverage.pointRecords,'not_read');
    assert.equal(entry.fragment.coverage.artifactVerification,'accepted_receipt_reference_only');assert.equal(entry.fragment.coverage.otherBatches,'not_fetched');
    assert.equal(entry.fragment.metadata.globalPlacement,'not_qualified');assert.equal(entry.fragment.coverage.geometryQualification,'not_assessed');
    assert(!f.state.objectReads.includes(f.result.artifact.key));assert(!JSON.stringify(evidence).includes(f.result.artifact.key));
    assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),receipt);assert.equal(f.state.draftWrites,1);
    prepareReview(f);const check:typeof assertRegistryDocumentCitationsTx=(client,site,record,lock)=>assertRegistryDocumentCitationsTx(client,site,record,lock,f.dependencies);
    const committed=await commitRegistryReviewTx(f.client,id(40),'',undefined,check);assert.equal(committed.committed,true);assert(!Object.hasOwn(committed.records[0],'documentCitations'));
    assert.deepEqual(f.state.history.get(1),f.body);assert.deepEqual(f.state.row.body.documentCitations,record.documentCitations);assert.equal(f.state.row.revision,2);
    const historical=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);assert.deepEqual(historical.citations[0].pin,pin);
    save(kind+'.controlled-journey.json',{scope:'unchanged retained metadata/document/original; reconstructed input/envelope/attempt/target/site/review/SQL/storage controls; no historic native record artifact or authentic applicability',
      request:f.request,receipt,citation:pin,privateRead:evidence,context:f.context,committed,recordedRevision:2,targetRevision:1,recordedBody:f.state.row.body,
      historicalRead:historical,automaticPointAssociation:'unsupported',nativeRecordRead:false,original:{path:originalPath,bytes:f.raw.length,sha256:sha256(f.raw)}});
  }
}));

test('wrong-site/batch/metadata, late fence/revocation and changed history deny point citations; denied citations remain removable',{skip:!present},()=>local(async()=>{
  const f=fixture();await registryPointCitationSourceTx(f.client,f.siteId,f.selection.pin);
  await assert.rejects(()=>registryPointCitationSourceTx(f.client,id(99),f.selection.pin),(e:any)=>e.status===403);
  const copied=fixture();(copied.source.inspection as any).copiedFrom={};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(copied.client,copied.draftId,copied.request,copied.dependencies),(e:any)=>e.status===403);assert.equal(copied.state.reads,0);
  const space=fixture('space');await assert.rejects(()=>amendRegistryDocumentCitationsTx(space.client,space.draftId,space.request,space.dependencies),(e:any)=>e.code==='REGISTRY_DOCUMENT_TARGET');assert.equal(space.state.reads,0);
  assert.throws(()=>associationLiterals(f.context),(e:any)=>e.code==='SOURCE_FUSION_POINT_CONTEXT_ONLY');
  const only=structuredClone(f.request);only.addFusion.selection.sources[1]={...f.docSelection,partIds:[]};assert(RegistryDocumentAmendmentSchema.safeParse(only).success);
  for(const mode of ['batch','metadata','fence','revoked'] as const){const late=fixture();
    if(mode==='batch')late.request.addFusion.selection.sources[0]={...late.selection,batch:{...late.selection.batch,start:late.selection.batch.start+1}};
    if(mode==='metadata')late.request.addFusion.selection.sources[0]={...late.selection,metadataSha256:digest};
    if(mode==='fence')late.state.driftDuringDocument=true;if(mode==='revoked')late.state.revokeDuringDocument=true;
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(late.client,late.draftId,late.request,late.dependencies),(e:any)=>[403,409,422].includes(e.status));
    assert.equal(late.state.draftWrites,0);assert.equal(late.state.operations.size,0);}
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);const record=f.state.draft.records[0],pin=record.documentCitations![0];
  assert(pin.version==='registry-point-metadata-citation/1');const drift={...pin,point:{...pin.point,batch:{...pin.point.batch,start:1}}};drift.id=citationId(drift);
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(f.client,f.siteId,{...record,documentCitations:[drift]},false,f.dependencies),(e:any)=>[409,422].includes(e.status));
  prepareReview(f);const check:typeof assertRegistryDocumentCitationsTx=(client,site,record,lock)=>assertRegistryDocumentCitationsTx(client,site,record,lock,f.dependencies);
  f.job.accepted_fence=f.job.attempt_fence=2;await assert.rejects(()=>commitRegistryReviewTx(f.client,id(40),'',undefined,check),(e:any)=>e.status===409);assert.equal(f.state.registryWrites,0);
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),(e:any)=>e.status===409);f.job.accepted_fence=f.job.attempt_fence=1;
  const targetName=f.state.row.body.name;f.state.row.body.name='changed target history control';
  await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),(e:any)=>e.status===409);f.state.row.body.name=targetName;
  f.current.archived=true;await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),(e:any)=>e.status===403);
  const reads=f.state.objectReads.length;await amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:id(31),expectedDraftRevision:2,recordId:f.record.id,expectedRecordRevision:1,clearAll:true},f.dependencies);
  assert.equal(f.state.objectReads.length,reads);assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
  save('denial-controls.json',{scope:'metadata/source/job/target/SQL/storage controls; no native/service run',wrongSiteDenied:true,copiedBeforeReadsDenied:true,
    spaceBeforeReadsDenied:true,automaticAssociationDenied:true,wrongBatchAndMetadataDenied:true,lateFenceAndRevocationDenied:true,
    recomputedCitationIdWithBatchDriftDenied:true,commitAndReplayFenceDenied:true,changedTargetHistoryDenied:true,revokedHistoryDenied:true,clearAllObjectReads:0,registryWrites:0});
}));
