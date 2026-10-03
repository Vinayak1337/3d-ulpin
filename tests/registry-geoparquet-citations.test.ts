import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {DocumentResultSchema,GeoParquetOriginalSchema,GeoParquetResultSchema} from '../packages/contracts/src/usp';
import type {RegistryRecord} from '../packages/contracts/src/registry';
import {RegistryDocumentAmendmentSchema} from '../packages/contracts/src/registry-document-evidence';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  documentReviewContext,publicRegistryBody,publicRegistryReview,citationId,type RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryGeoParquetCitationSourceTx} from '../packages/server/src/modules/registry/registry-geoparquet-citation-source';
import {commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {geoparquetInput,geoparquetReaderSha,geoparquetArtifactKey,geoparquetResultKey} from '../packages/server/src/modules/usp/ingestion/geoparquet';
import {geoparquetSummary} from '../packages/server/src/modules/usp/ingestion/geoparquet-processor';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {associationLiterals} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {fusionGeoParquetCitationFragment} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import type {SourceFusionSelection} from '../packages/contracts/src/source-fusion';

// Reuse the accepted registry correction SQL controls over unchanged real native
// and document bytes. These checks prevent stale parent/row pins or private
// access loss from reaching canonical commit; targets/input/result/job/review/
// tools are controlled envelopes and do not establish a property crosswalk.
const root='E:/BhuAayam-data/task-data/desktop-geoparquet-continuation/journey-01',
  documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json',
  originalPath='E:/BhuAayam-data/task-data/desktop-geoparquet-native/originals/example.parquet';
const present=existsSync(root+'/continued.native.json')&&existsSync(root+'/continuation.journey.json')&&existsSync(documentPath)&&existsSync(originalPath);
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest='a'.repeat(64);
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-geoparquet-protocol';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(kind:'building'|'floor'|'space'='building',rowIndex=3){
  const raw=readFileSync(originalPath),artifact=readFileSync(root+'/continued.native.json'),native=JSON.parse(artifact.toString('utf8')),
    savedJourney=JSON.parse(readFileSync(root+'/continuation.journey.json','utf8')),
    saved=GeoParquetResultSchema.parse(savedJourney.continuedAccepted),savedParent=GeoParquetResultSchema.parse(savedJourney.initialAccepted);
  assert.equal(sha256(raw),'f3e4bf0b0376904f851057d2047bb69e81dce913f2ff1aabe8a4dc1ec0789bc2');
  assert.equal(sha256(artifact),'78fb245f218091ba7a1e945b86c2b02dc3fd02cff3a2f7bc34c795ea092e3044');
  assert.equal(sha256(artifact),saved.artifact.sha256);assert.equal(artifact.length,saved.artifact.bytes);
  const siteId=id(10),caseId=id(1),sourceId=id(2),jobId=id(3),parentJobId=id(4),draftId=id(20),binding=ingestionBinding(caseId),
    current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:siteId};
  const manifest=JSON.parse(readFileSync(new URL('../docs/evidence/usp/native-geoparquet/sources.json',import.meta.url),'utf8')).sources[0];
  assert.equal(manifest.qualification,'test_only');assert.equal(manifest.sha256,sha256(raw));
  const original=GeoParquetOriginalSchema.parse({version:'geoparquet-native/1',subject:binding.subject,accessSha256:binding.access,sha256:sha256(raw),bytes:raw.length,
    receivedAt:'2026-10-03T00:00:00Z',lineageState:'caller_declared',lineage:{issuer:manifest.issuer,originalUrl:manifest.originalUrl,
      acquiredAt:new Date(manifest.acquiredAt).toISOString(),permissionReference:null,geography:manifest.geography,
      limitations:['memory protocol authority; unchanged retained test_only bytes',manifest.licence]}}),
    source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,profile:'geoparquet-native-v1',status:'received',sha256:sha256(raw),bytes:raw.length,
      object_key:`sources/${sourceId}/${sha256(raw)}`,inspection:{geoparquetOriginal:original}},
    tools={platform:'windows-x86_64' as const,pythonSha256:digest,profileSha256:digest,readerSha256:geoparquetReaderSha(),supervisorSha256:digest,dependencyLockSha256:digest,codeSha256:digest},
    sourceContext={current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId})},
    parentInput=geoparquetInput(sourceContext as any,parentJobId,savedParent.input.selection,tools),
    parent=GeoParquetResultSchema.parse({...savedParent,input:parentInput,artifact:{...savedParent.artifact,key:geoparquetArtifactKey(parentJobId,savedParent.artifact.sha256)}}),
    parentBytes=Buffer.from(JSON.stringify(parent)),
    continuation={jobId:parentJobId,resultSha256:sha256(parentBytes),artifactSha256:parent.artifact.sha256,nextRowIndex:2,inputSha256:fingerprint(parentInput),acceptedFence:1},
    input=geoparquetInput(sourceContext as any,jobId,saved.input.selection,tools,continuation),
    result=GeoParquetResultSchema.parse({...saved,input,summary:geoparquetSummary(artifact,input),artifact:{...saved.artifact,key:geoparquetArtifactKey(jobId,sha256(artifact))}}),
    resultBytes=Buffer.from(JSON.stringify(result)),
    selection:Extract<SourceFusionSelection,{kind:'geoparquet'}>={kind:'geoparquet',pin:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:sha256(raw),jobId,
      resultSha256:sha256(resultBytes),readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1,resultBytes:resultBytes.length},artifactSha256:sha256(artifact),rowIndices:[rowIndex]},
    job=(r:typeof result,bytes:Buffer)=>({id:r.input.jobId,operation:'geoparquet-native',case_id:caseId,source_id:sourceId,case_revision:1,
      payload:r.input,input_fingerprint:fingerprint(r.input),input_sha256:fingerprint(r.input),status:'succeeded',logical_state:'succeeded',
      result_ref:{assetId:`geoparquet:${r.input.jobId}:${bytes.length}`,version:1,sha256:sha256(bytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(r.input),completion_sha256:sha256(bytes)}),
    jobs=new Map([[jobId,job(result,resultBytes)],[parentJobId,job(parent,parentBytes)]]);
  assert.deepEqual(result.summary,saved.summary);assert.deepEqual(parent.summary,savedParent.summary);
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
      draftWrites:0,registryWrites:0,reads:0,toolChecks:0,revokeDuringDocument:false,driftParentDuringDocument:false,
      driftParentResultDuringDocument:false,driftParentBytesDuringDocument:false,revokeDuringArtifact:false,calls:[] as string[],objectReads:[] as string[]},
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
    else if(sql.includes('SELECT j.*,m.result_ref'))rows=jobs.has(args[0])?[jobs.get(args[0])]:[];
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
  const objects=new Map([[geoparquetResultKey(jobId,sha256(resultBytes)),resultBytes],[result.artifact.key,artifact],
    [geoparquetResultKey(parentJobId,sha256(parentBytes)),parentBytes],[documentResultKey(document.input.jobId,sha256(documentBytes)),documentBytes]]);
  const dependencies:RegistryDocumentDependencies={source:async(_client,_ctx,pin)=>{
    assert.equal(pin.sourceId,docSelection.pin.sourceId);return document.input;
  },result:async()=>document,registrySource:async(_client,_site,sourceId)=>sourceId===docSelection.pin.sourceId?
    ({revision:document.input.sourceRevision,sha256:document.input.sourceSha256,accessSha256:document.input.accessSha256}) as any:
    ({revision:1,sha256:digest,accessSha256:digest}) as any,
    geoparquetTools:()=>{state.toolChecks++;},fusionResult:async(selected,authority,budget)=>{
      state.reads++;
      const loaded=await readFusionResult(selected,authority,budget,(key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async()=>{
        state.objectReads.push(key);const bytes=objects.get(key);assert(bytes);if(state.revokeDuringArtifact&&key===result.artifact.key)current.archived=true;
        return {body:Readable.from([bytes]),etag:'protocol'};
      }));
      if(selected.kind==='document'){
        if(state.revokeDuringDocument)current.archived=true;
        if(state.driftParentDuringDocument)jobs.get(parentJobId)!.accepted_fence=jobs.get(parentJobId)!.attempt_fence=2;
        if(state.driftParentResultDuringDocument){jobs.get(parentJobId)!.result_ref.sha256=digest;jobs.get(parentJobId)!.completion_sha256=digest;}
        if(state.driftParentBytesDuringDocument)jobs.get(parentJobId)!.result_ref.assetId=`geoparquet:${parentJobId}:${parentBytes.length+1}`;
      }
      return loaded;
    }};
  const context=rowIndex>=2&&rowIndex<=3?fusionContextProjection([fusionSourceProjection(selection,{kind:'geoparquet',result,native}),
    fusionSourceProjection(docSelection,{kind:'document',result:document})]):null,
    request={requestKey:id(30),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,
      addFusion:{contextSha256:context?.contextSha256??digest,selection:{sources:[selection,docSelection]}}};
  return {client,dependencies,state,record,body,current,source,jobs,parentJobId,parent,selection,request,draftId,siteId,native,raw,context,result,document,docSelection};
}
function prepareReview(f:ReturnType<typeof fixture>){
  const record=f.state.draft.records[0],reviewContext=documentReviewContext();
  f.state.review={id:id(40),draftId:f.draftId,draftRevision:f.state.draft.revision,siteRevision:1,records:[structuredClone(record)],
    before:[f.record],findings:[],committed:false,documentReviewContext:reviewContext,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',
      records:[record],frame:f.state.site.frame,draftRevision:f.state.draft.revision,siteRevision:1,documentReviewContext:reviewContext})};
}
test('selected continued row plus EPSG document traverse building/floor amendment/private read/replay/review/commit/history',{skip:!present},()=>local(async()=>{
  for(const kind of ['building','floor'] as const){
    const f=fixture(kind),receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),record=f.state.draft.records[0];
    assert.equal(receipt.draftRevision,2);assert.equal(f.state.draftWrites,1);assert.equal(record.documentCitations!.length,2);
    const pin=record.documentCitations![0];assert(pin.version==='registry-geoparquet-citation/1');assert.equal(pin.id,citationId(pin));
    assert.equal(pin.geoparquet.rowIndex,3);assert.equal(pin.geoparquet.ordinal,1);assert.equal(pin.geoparquet.rowGroupIndex,0);
    assert.equal(pin.geoparquet.rowIndexInGroup,3);assert.equal(pin.geoparquet.recordPointer,'/rows/1');assert.equal(pin.geoparquet.continuation!.jobId,f.parentJobId);
    assert(!Object.hasOwn(pin,'identityAssertion'));assert(!Object.hasOwn(pin,'partId'));assert.deepEqual(publicRegistryBody(record),f.record);
    const evidence=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),entry=evidence.citations[0];
    assert(entry.pin.version==='registry-geoparquet-citation/1'&&'fragment' in entry&&entry.fragment.kind==='geoparquet');
    const fragment=entry.fragment,row=fragment.rows[0];assert.equal(fragment.rows.length,1);assert.deepEqual(row.record,f.native.rows[1]);
    assert.equal(row.recordSha256,pin.geoparquet.recordSha256);assert.equal(fingerprint(fragment),pin.geoparquet.fragmentSha256);
    assert.equal(fragment.selectionSha256,pin.geoparquet.selectionSha256);assert.equal(fragment.coverage.selectedRows,1);
    assert.equal(fragment.summary.status,'partial');assert.equal(fragment.summary.window.nextRowIndex,4);assert.equal(fragment.coverage.continuationRowsFetch,'not_performed');
    for(const name of ['source','reader','schema','geoMetadata','profile','rowGroups','semantics'] as const)assert.deepEqual(fragment[name],f.native[name]);
    const columns=row.record.columns as any;assert.equal(columns.name.value,'Canada');assert.equal(columns.gdp_md_est.value.decimalInteger,'1736425');
    assert.equal(sha256(Buffer.from(columns.geometry.wkb.hex,'hex')),columns.geometry.wkb.sha256);
    assert.deepEqual(pin.geoparquet.columnLocators,Object.fromEntries(Object.entries(columns).map(([n,c]:[string,any])=>[n,c.locator])));
    assert(!f.state.objectReads.includes(f.parent.artifact.key));assert.equal(evidence.citations.length,2);assert('part' in evidence.citations[1]);
    assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),receipt);assert.equal(f.state.draftWrites,1);
    f.state.calls.length=0;await assertRegistryDocumentCitationsTx(f.client,f.siteId,record,false,f.dependencies);
    assert(!f.state.calls.some(sql=>/FOR (SHARE|UPDATE)/.test(sql)));
    prepareReview(f);const check:typeof assertRegistryDocumentCitationsTx=(client,siteId,record,lock)=>assertRegistryDocumentCitationsTx(client,siteId,record,lock,f.dependencies);
    const committed=await commitRegistryReviewTx(f.client,id(40),'',undefined,check);assert.equal(committed.committed,true);
    assert(!Object.hasOwn(committed.records[0],'documentCitations'));assert.deepEqual(f.state.history.get(1),f.body);
    assert.deepEqual(f.state.row.body.documentCitations,record.documentCitations);assert.equal(f.state.row.revision,2);
    const historical=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);assert.deepEqual(historical.citations[0].pin,pin);
    const proof=process.env.ULPIN_GEOPARQUET_CITATION_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
      writeFileSync(proof+'/'+kind+'.controlled-journey.json',JSON.stringify({scope:'memory target/input/result/job/SQL/storage/review/tool controls over unchanged upstream/document bytes; no authentic crosswalk',
        request:f.request,receipt,citation:pin,privateRead:evidence,context:f.context,review:publicRegistryReview(f.state.review),committed,
        recordedRevision:f.state.row.revision,targetRevision:pin.target.revision,recordedBody:f.state.row.body,historicalRead:historical,
        selectedRows:1,parentArtifactRead:false,qualification:'not_assessed',toolInventory:'stubbed; not current runtime qualification'},null,2)+'\n',{flag:'wx'});}
  }
}));
test('exact parent/window and source access protect GeoParquet citations; denied sources are removable without artifact reads',{skip:!present},()=>local(async()=>{
  const f=fixture();await registryGeoParquetCitationSourceTx(f.client,f.siteId,f.selection.pin);
  await assert.rejects(()=>registryGeoParquetCitationSourceTx(f.client,id(99),f.selection.pin),(e:any)=>e.status===403);
  const copied=fixture();(copied.source.inspection as any).copiedFrom={};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(copied.client,copied.draftId,copied.request,copied.dependencies),(e:any)=>e.status===403);assert.equal(copied.state.reads,0);
  const space=fixture('space');await assert.rejects(()=>amendRegistryDocumentCitationsTx(space.client,space.draftId,space.request,space.dependencies),(e:any)=>e.code==='REGISTRY_DOCUMENT_TARGET');assert.equal(space.state.reads,0);
  assert.throws(()=>associationLiterals(f.context!),(e:any)=>e.code==='SOURCE_FUSION_GEOPARQUET_CONTEXT_ONLY');
  const only=structuredClone(f.request);only.addFusion.selection.sources[1]={...f.docSelection,partIds:[]};assert(RegistryDocumentAmendmentSchema.safeParse(only).success);
  const outside=fixture('building',1);await assert.rejects(()=>amendRegistryDocumentCitationsTx(outside.client,outside.draftId,outside.request,outside.dependencies),
    (e:any)=>e.code==='SOURCE_FUSION_GEOPARQUET_ROW_WINDOW');assert.equal(outside.state.draftWrites,0);
  for(const change of ['driftParentDuringDocument','driftParentResultDuringDocument','driftParentBytesDuringDocument','revokeDuringDocument'] as const){
    const late=fixture();late.state[change]=true;
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(late.client,late.draftId,late.request,late.dependencies),(e:any)=>e.status===403||e.status===409);
    assert.equal(late.state.draftWrites,0);assert.equal(late.state.operations.size,0);
  }
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const record=f.state.draft.records[0],pin=record.documentCitations![0];assert(pin.version==='registry-geoparquet-citation/1');
  const drift={...pin,geoparquet:{...pin.geoparquet,ordinal:0}};drift.id=citationId(drift);
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(f.client,f.siteId,{...record,documentCitations:[drift]},false,f.dependencies),(e:any)=>e.status===409);
  const geo=f.context!.sources[0];assert(geo.kind==='geoparquet');
  const both=fusionSourceProjection({...f.selection,rowIndices:[2,3]},{kind:'geoparquet',result:f.result,native:f.native});assert(both.kind==='geoparquet');
  assert.deepEqual(fusionGeoParquetCitationFragment(both,3),fusionGeoParquetCitationFragment(geo,3));
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:id(32),expectedDraftRevision:2,
    recordId:f.record.id,expectedRecordRevision:1,assertIFCIdentity:pin.id},f.dependencies),(e:any)=>e.code==='REGISTRY_IFC_IDENTITY_SELECTION');
  prepareReview(f);const check:typeof assertRegistryDocumentCitationsTx=(client,siteId,record,lock)=>assertRegistryDocumentCitationsTx(client,siteId,record,lock,f.dependencies);
  f.jobs.get(f.parentJobId)!.accepted_fence=f.jobs.get(f.parentJobId)!.attempt_fence=2;
  await assert.rejects(()=>commitRegistryReviewTx(f.client,id(40),'',undefined,check),(e:any)=>e.status===409);assert.equal(f.state.registryWrites,0);
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),(e:any)=>e.status===409);
  f.jobs.get(f.parentJobId)!.accepted_fence=f.jobs.get(f.parentJobId)!.attempt_fence=1;
  f.state.revokeDuringArtifact=true;await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),(e:any)=>e.status===403);
  f.state.revokeDuringArtifact=false;const reads=f.state.reads,objectReads=f.state.objectReads.length;
  // Remove both denied/attached pins without trying to resolve their artifacts.
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:id(31),expectedDraftRevision:2,recordId:f.record.id,expectedRecordRevision:1,clearAll:true},f.dependencies);
  assert.equal(f.state.reads,reads);assert.equal(f.state.objectReads.length,objectReads);assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
  const proof=process.env.ULPIN_GEOPARQUET_CITATION_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
    writeFileSync(proof+'/denial-controls.json',JSON.stringify({scope:'controlled SQL/source/job/storage/target authority; no native run or authentic crosswalk',
      wrongSiteDenied:true,copiedBeforeReadsDenied:true,spaceBeforeReadsDenied:true,automaticAssociationDenied:true,outOfWindowDenied:true,
      parentFenceDuringLaterReadDenied:true,parentResultDuringLaterReadDenied:true,parentReceiptBytesDuringLaterReadDenied:true,
      revokeDuringLaterReadDenied:true,recomputedCitationIdWithOrdinalDriftDenied:true,singletonStableAcrossOtherSelections:true,
      identityAssertionDenied:true,parentFenceAtCommitAndReplayDenied:true,revokedPrivateReadDenied:true,removalArtifactReads:0,
      registryWrites:f.state.registryWrites,remainingCitations:f.state.draft.records[0].documentCitations},null,2)+'\n',{flag:'wx'});}
}));
