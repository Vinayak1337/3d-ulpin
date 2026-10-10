import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {DocumentResultSchema,DXFOriginalSchema,DXFResultSchema,DXFStatusSchema} from '../packages/contracts/src/usp';
import type {RegistryRecord} from '../packages/contracts/src/registry';
import {RegistryDocumentAmendmentSchema} from '../packages/contracts/src/registry-document-evidence';
import type {RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  documentReviewContext,publicRegistryBody,publicRegistryReview,citationId} from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryDXFCitationSourceTx} from '../packages/server/src/modules/registry/registry-dxf-citation-source';
import {commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {dxfInput,dxfArtifactKey,dxfResultKey} from '../packages/server/src/modules/usp/ingestion/dxf';
import {dxfSummary} from '../packages/server/src/modules/usp/ingestion/dxf-processor';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {associationLiterals} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import type {SourceFusionSelection} from '../packages/contracts/src/source-fusion';

// Adapted from the accepted IFC correction protocol control. These focused
// checks prevent unauthorized/stale native citations reaching canonical commit.
// Original/native/document bytes are retained real inputs; target, jobs, SQL,
// storage, review and tool inventory are labelled controls, not real matching.
const root='E:/BhuAayam-data/task-data/desktop-dxf-private-api/journey-corrected',
  originals='E:/BhuAayam-data/task-data/desktop-dxf-native/sources',
  documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const samples={
  '1_polylines.dxf':{source:'37f57491672a9b330be08888200a8ad893d15af52af91e1c6be54b0c9cda75de',
    artifact:'1d26c542913cbd51dd35286fb04a0529acca96677e50f943924c4fd73304e285',ordinal:33},
  'ASCII_R12.dxf':{source:'b476d3e53fe24c1db3c701d20b2bebd774f7bd7966b12d81891505b9b29e4d21',
    artifact:'e926344244e4a73c6f6fcac93991fb8cd6883473ea88ecdca364eb5ac8d76166',ordinal:1}
};
const present=Object.keys(samples).every(name=>existsSync(root+'/'+name+'.native.json')&&existsSync(originals+'/'+name))&&existsSync(documentPath);
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest='a'.repeat(64);
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-dxf-protocol';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(name:keyof typeof samples='1_polylines.dxf',kind:'building'|'floor'|'space'='building'){
  const sample=samples[name],raw=readFileSync(originals+'/'+name),artifact=readFileSync(root+'/'+name+'.native.json'),native=JSON.parse(artifact.toString('utf8')),
    saved=DXFStatusSchema.parse(JSON.parse(readFileSync(root+'/'+name+'.journey.json','utf8')).status).result!;
  assert.equal(sha256(raw),sample.source);assert.equal(sha256(artifact),sample.artifact);
  const siteId=id(10),caseId=id(1),sourceId=id(2),jobId=id(3),draftId=id(20),binding=ingestionBinding(caseId),
    current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:siteId},
    original=DXFOriginalSchema.parse({version:'dxf-native/1',subject:binding.subject,accessSha256:binding.access,sha256:sha256(raw),bytes:raw.length,
      receivedAt:'2026-10-03T00:00:00Z',lineageState:'caller_declared',lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,
        geography:null,limitations:['memory protocol authority; unchanged retained test_only bytes']}}),
    source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,profile:'dxf-native-v1',status:'received',sha256:sha256(raw),bytes:raw.length,
      object_key:`sources/${sourceId}/${sha256(raw)}`,inspection:{dxfOriginal:original}},
    tools={platform:'windows-x86_64' as const,pythonSha256:digest,profileSha256:digest,readerSha256:digest,supervisorSha256:digest,dependencyLockSha256:digest,codeSha256:digest},
    input=dxfInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId})} as any,jobId,'complete_bounded_source',tools),
    result=DXFResultSchema.parse({version:'dxf-native/1',input,summary:dxfSummary(artifact,input),artifact:{...saved.artifact,key:dxfArtifactKey(jobId,sha256(artifact))},createdAt:'2026-10-03T00:00:00Z'}),
    resultBytes=Buffer.from(JSON.stringify(result)),
    selection:Extract<SourceFusionSelection,{kind:'dxf'}>={kind:'dxf',pin:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:sha256(raw),jobId,
      resultSha256:sha256(resultBytes),readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1,resultBytes:resultBytes.length},entityOrdinals:[sample.ordinal]},
    job={id:jobId,operation:'dxf-native',case_id:caseId,source_id:sourceId,case_revision:1,payload:input,input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),
      status:'succeeded',logical_state:'succeeded',result_ref:{assetId:`dxf:${jobId}:${resultBytes.length}`,version:1,sha256:sha256(resultBytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:sha256(resultBytes)};
  assert.deepEqual(result.summary,saved.summary);
  const documentBytes=readFileSync(documentPath),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    enrollment=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((row:any)=>row.id==='epsg7415');
  assert.equal(sha256(documentBytes),enrollment.resultSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:document.input.caseId,caseRevision:document.input.caseRevision,
    sourceId:document.input.sourceId,sourceRevision:document.input.sourceRevision,sourceSha256:document.input.sourceSha256,jobId:document.input.jobId,
    resultSha256:sha256(documentBytes),readerSha256:document.input.readerSha256,inputSha256:fingerprint(document.input),acceptedFence:enrollment.acceptedFence,resultBytes:documentBytes.length},
    partIds:[enrollment.selectedParts[0].id]};
  const record:RegistryRecord={id:id(11),siteId,identifier:'controlled-existing-record',revision:1,alias:'Protocol target',name:'Protocol target',kind,
    footprint:[[0,0],[1,0],[1,1],[0,1]],links:[],rights:[],evidence:[{sourceId:id(12),locator:'existing protocol evidence'}],synthetic:true},
    {id:_,siteId:__,identifier:___,revision:____,...body}=record,
    state={draft:{id:draftId,site_id:siteId,case_id:id(21),records:[structuredClone(record)],revision:1,status:'draft'},
      row:{id:record.id,site_id:siteId,identifier:record.identifier,kind:record.kind,revision:1,body:structuredClone(body)},
      site:{id:siteId,identifier:'protocol-site',name:'protocol-site',revision:1,frame:{id:'protocol-frame'},synthetic:true},
      review:undefined as any,operations:new Map<string,any>(),history:new Map<number,any>([[1,structuredClone(body)]]),
      draftWrites:0,registryWrites:0,reads:0,toolChecks:0,revokeDuringDocument:false,revokeDuringArtifact:false,calls:[] as string[]},
    ordinarySource={id:id(12),case_id:caseId,family_id:id(12),revision:1,sha256:digest,bytes:1,name:'protocol recording source',profile:'protocol',
      mime_type:'text/plain',object_key:'protocol',created_at:'2026-10-03T00:00:00Z',status:'ready',inspection:{}};
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
    else if(sql.startsWith('UPDATE registry_records')){state.row.body=structuredClone(args[1]);state.row.revision=args[2];state.registryWrites++;}
    else if(sql.startsWith('INSERT INTO registry_revisions')){state.history.set(args[1],structuredClone(args[2]));state.registryWrites++;}
    else if(sql.startsWith('DELETE FROM registry_'))state.registryWrites++;
    else if(sql.startsWith('UPDATE registry_sites')){state.site.revision=args[1];state.registryWrites++;}
    else if(sql.startsWith('UPDATE registry_drafts SET status')){state.draft.status='recorded';state.registryWrites++;}
    else if(sql.startsWith('UPDATE registry_reviews')){state.review.committed=true;state.registryWrites++;}
    else assert.fail('Unexpected protocol SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const objects=new Map([[dxfResultKey(jobId,sha256(resultBytes)),resultBytes],[result.artifact.key,artifact],
    [documentResultKey(document.input.jobId,sha256(documentBytes)),documentBytes]]);
  const dependencies:RegistryDocumentDependencies={source:async(_client,_ctx,pin)=>{
    assert.equal(pin.sourceId,docSelection.pin.sourceId);return document.input;
  },result:async()=>document,registrySource:async(_client,_site,sourceId)=>sourceId===docSelection.pin.sourceId?
    ({revision:document.input.sourceRevision,sha256:document.input.sourceSha256,accessSha256:document.input.accessSha256}) as any:
    ({revision:1,sha256:digest,accessSha256:digest}) as any,
    dxfTools:()=>{state.toolChecks++;},fusionResult:async(selected,authority,budget)=>{
      state.reads++;
      const loaded=await readFusionResult(selected,authority,budget,(key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async()=>{
        const bytes=objects.get(key);assert(bytes);if(state.revokeDuringArtifact&&key===result.artifact.key)current.archived=true;
        return {body:Readable.from([bytes]),etag:'protocol'};
      }));
      if(selected.kind==='document'&&state.revokeDuringDocument)current.archived=true;return loaded;
    }};
  const context=fusionContextProjection([fusionSourceProjection(selection,{kind:'dxf',result,native}),
    fusionSourceProjection(docSelection,{kind:'document',result:document})]);
  const request={requestKey:id(30),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,
    addFusion:{contextSha256:context.contextSha256,selection:{sources:[selection,docSelection]}}};
  return {client,dependencies,state,record,body,current,source,job,selection,request,draftId,siteId,native,raw,context,result,document,docSelection};
}
function prepareReview(f:ReturnType<typeof fixture>){
  const record=f.state.draft.records[0],reviewContext=documentReviewContext();
  f.state.review={id:id(40),draftId:f.draftId,draftRevision:f.state.draft.revision,siteRevision:1,records:[structuredClone(record)],
    before:[f.record],findings:[],committed:false,documentReviewContext:reviewContext,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',
      records:[record],frame:f.state.site.frame,draftRevision:f.state.draft.revision,siteRevision:1,documentReviewContext:reviewContext})};
}
test('selected DXF entity and native document traverse draft/private read/review/commit/history without inferred identity', {skip:!present},()=>local(async()=>{
  for(const [name,kind] of [['1_polylines.dxf','building'],['ASCII_R12.dxf','floor']] as const){
    const f=fixture(name,kind),receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),record=f.state.draft.records[0];
    assert.equal(receipt.draftRevision,2);assert.equal(f.state.draftWrites,1);assert.equal(record.documentCitations!.length,2);
    const pin=record.documentCitations![0];assert(pin.version==='registry-dxf-citation/1');assert.equal(pin.id,citationId(pin));
    assert.equal(pin.dxf.entityOrdinal,samples[name].ordinal);assert.equal(pin.dxf.identifierScope,'source_native_only; not_canonical_registry_ids');
    assert(!Object.hasOwn(pin,'identityAssertion'));assert(!Object.hasOwn(pin,'partId'));assert.deepEqual(publicRegistryBody(record),f.record);
    const evidence=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),entry=evidence.citations[0];assert('entity' in entry);
    assert.deepEqual(entry.entity,f.native.entities[samples[name].ordinal]);assert.equal(fingerprint(entry.entity),pin.dxf.recordSha256);
    assert.equal(evidence.citations.length,2);assert('part' in evidence.citations[1]);
    const lines=new TextDecoder(f.native.encoding.name).decode(f.raw).split(/\r?\n/);
    for(const tag of entry.entity.sourceTags as any[])assert.equal(lines[tag.tagIndex*2+1],tag.rawValue);
    assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),receipt);assert.equal(f.state.draftWrites,1);
    f.state.calls.length=0;await assertRegistryDocumentCitationsTx(f.client,f.siteId,record,false,f.dependencies);
    assert(!f.state.calls.some(sql=>/FOR (SHARE|UPDATE)/.test(sql)));
    if(name==='ASCII_R12.dxf'){
      const fields=entry.entity.fields as any;assert.deepEqual(fields.scaleX,{state:'absent',tags:[]});assert.deepEqual(fields.rotationDegrees,{state:'absent',tags:[]});
      const dxf=f.context.sources.find(source=>source.kind==='dxf')!;assert(dxf.kind==='dxf');assert.equal(dxf.reference.units.state,'absent');
    }
    prepareReview(f);
    const check:typeof assertRegistryDocumentCitationsTx=(client,siteId,record,lock)=>assertRegistryDocumentCitationsTx(client,siteId,record,lock,f.dependencies);
    const committed=await commitRegistryReviewTx(f.client,id(40),'',undefined,check);assert.equal(committed.committed,true);
    assert(!Object.hasOwn(committed.records[0],'documentCitations'));assert.deepEqual(f.state.history.get(1),f.body);
    assert.deepEqual(f.state.row.body.documentCitations,record.documentCitations);assert.equal(f.state.row.revision,2);
    const historical=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);assert.deepEqual(historical.citations[0].pin,pin);
    const proof=process.env.ULPIN_DXF_CITATION_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
      writeFileSync(proof+'/'+name+'.controlled-journey.json',JSON.stringify({scope:'memory target/job/SQL/storage/review controls over unchanged retained DXF/document bytes; no authentic crosswalk',
        request:f.request,receipt,citation:pin,privateRead:evidence,context:f.context,review:publicRegistryReview(f.state.review),committed,
        recordedBody:f.state.row.body,historicalRead:historical,qualification:'not_assessed',toolInventory:'stubbed; not current runtime qualification'},null,2)+'\n',{flag:'wx'});}
  }
}));
test('DXF wrong/stale/revoked citation denies amendment/read/commit; removed denied source needs no artifact read', {skip:!present},()=>local(async()=>{
  const f=fixture();await registryDXFCitationSourceTx(f.client,f.siteId,f.selection.pin);
  await assert.rejects(()=>registryDXFCitationSourceTx(f.client,id(99),f.selection.pin),(error:any)=>error.status===403);
  await assert.rejects(()=>registryDXFCitationSourceTx(f.client,f.siteId,{...f.selection.pin,acceptedFence:2}),(error:any)=>error.status===409);
  const late=fixture();late.state.revokeDuringDocument=true;
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(late.client,late.draftId,late.request,late.dependencies),(error:any)=>error.status===403);
  assert.equal(late.state.draftWrites,0);assert.equal(late.state.operations.size,0);
  const space=fixture('1_polylines.dxf','space');
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(space.client,space.draftId,space.request,space.dependencies),(error:any)=>error.code==='REGISTRY_DOCUMENT_TARGET');
  assert.equal(space.state.reads,0);
  assert.throws(()=>associationLiterals(f.context),(error:any)=>error.code==='SOURCE_FUSION_DXF_CONTEXT_ONLY');
  const dxfOnly=structuredClone(f.request);dxfOnly.addFusion.selection.sources[1]={...f.docSelection,partIds:[]};
  assert(RegistryDocumentAmendmentSchema.safeParse(dxfOnly).success);
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const record=f.state.draft.records[0],pin=record.documentCitations![0];assert(pin.version==='registry-dxf-citation/1');
  const drift={...pin,dxf:{...pin.dxf,recordPointer:'/entities/0'}};
  drift.id=citationId(drift); // A matching caller-computed ID cannot authorize changed native fields.
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(f.client,f.siteId,{...record,documentCitations:[drift]},false,f.dependencies),(error:any)=>error.status===409);
  prepareReview(f);const check:typeof assertRegistryDocumentCitationsTx=(client,siteId,record,lock)=>assertRegistryDocumentCitationsTx(client,siteId,record,lock,f.dependencies);
  f.current.archived=true;await assert.rejects(()=>commitRegistryReviewTx(f.client,id(40),'',undefined,check),(error:any)=>error.status===403);
  assert.equal(f.state.registryWrites,0);f.current.archived=false;
  f.state.revokeDuringArtifact=true;await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),(error:any)=>error.status===403);
  f.state.revokeDuringArtifact=false;const reads=f.state.reads;
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:id(31),expectedDraftRevision:2,recordId:f.record.id,expectedRecordRevision:1,clearAll:true},f.dependencies);
  assert.equal(f.state.reads,reads);assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
}));
