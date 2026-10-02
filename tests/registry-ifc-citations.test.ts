import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {DocumentResultSchema,IFCOriginalSchema,IFCResultSchema} from '../packages/contracts/src/usp';
import type {RegistryRecord} from '../packages/contracts/src/registry';
import type {RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  documentReviewContext,publicRegistryBody,publicRegistryReview,citationId} from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryIFCCitationSourceTx} from '../packages/server/src/modules/registry/registry-ifc-citation-source';
import {commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {ifcInput} from '../packages/server/src/modules/usp/ingestion/ifc';
import {ifcSummary} from '../packages/server/src/modules/usp/ingestion/ifc-processor';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import type {SourceFusionSelection} from '../packages/contracts/src/source-fusion';

// Controlled same-site correction/job rows over unchanged real native bytes.
// No authentic IFC/property crosswalk, database persistence or geometry claim.
const root=process.env.ULPIN_IFC_TEST_ROOT??'E:/BhuAayam-data/task-data/desktop-ifc-native',
  documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const present=existsSync(root+'/outputs/final/ifc2x3.json')&&existsSync(documentPath);
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest='a'.repeat(64);
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-ifc-protocol';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(){
  const raw=readFileSync(root+'/originals/ifc2x3-building-architecture.ifc'),artifact=readFileSync(root+'/outputs/final/ifc2x3.json'),native=JSON.parse(artifact.toString('utf8'));
  assert.equal(sha256(raw),'c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885');
  assert.equal(sha256(artifact),'66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a');
  const siteId=id(10),caseId=id(1),sourceId=id(2),jobId=id(3),draftId=id(20),binding=ingestionBinding(caseId),
    current={id:caseId,revision:1,archived:false,frame:null,context:null,site_id:siteId},
    original=IFCOriginalSchema.parse({version:'ifc-native/1',subject:binding.subject,accessSha256:binding.access,sha256:sha256(raw),bytes:raw.length,
      receivedAt:'2026-10-01T00:00:00Z',lineageState:'caller_declared',lineage:{issuer:null,originalUrl:null,acquiredAt:null,permissionReference:null,
        geography:null,limitations:['memory protocol receipt; retained test_only bytes']}}),
    source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,profile:'ifc-native-v1',status:'received',sha256:sha256(raw),bytes:raw.length,
      object_key:`sources/${sourceId}/${sha256(raw)}`,inspection:{ifcOriginal:original}},
    tools={platform:'windows-x86_64' as const,pythonSha256:digest,profileSha256:digest,readerSha256:digest,supervisorSha256:digest,dependencyLockSha256:digest,codeSha256:digest},
    input=ifcInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:null,siteId})} as any,jobId,'complete_bounded_source',tools),
    result=IFCResultSchema.parse({version:'ifc-native/1',input,summary:ifcSummary(artifact,input),artifact:{key:`ifc-native/${jobId}/${sha256(artifact)}.native.json`,
      sha256:sha256(artifact),bytes:artifact.length,mediaType:'application/json',profile:'ulpin-native-ifc/1'},createdAt:'2026-10-01T00:00:00Z'}),
    resultBytes=Buffer.from(JSON.stringify(result)),
    selection:Extract<SourceFusionSelection,{kind:'ifc'}>={kind:'ifc',pin:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:sha256(raw),jobId,
      resultSha256:sha256(resultBytes),readerSha256:input.readerSha256,inputSha256:fingerprint(input),acceptedFence:1,resultBytes:resultBytes.length},stepIds:[25]},
    job={id:jobId,operation:'ifc-native',case_id:caseId,source_id:sourceId,case_revision:1,payload:input,input_fingerprint:fingerprint(input),input_sha256:fingerprint(input),
      status:'succeeded',logical_state:'succeeded',result_ref:{assetId:`ifc:${jobId}:${resultBytes.length}`,version:1,sha256:sha256(resultBytes)},
      accepted_fence:1,attempt_state:'accepted',attempt_fence:1,attempt_input_sha256:fingerprint(input),completion_sha256:sha256(resultBytes)};
  const documentBytes=readFileSync(documentPath),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    enrollment=JSON.parse(readFileSync(new URL('../docs/evidence/usp/reference-document-enrollment/manifest.json',import.meta.url),'utf8')).enrollments.find((row:any)=>row.id==='epsg7415');
  assert.equal(sha256(documentBytes),enrollment.resultSha256);
  const docSelection:Extract<SourceFusionSelection,{kind:'document'}>={kind:'document',pin:{caseId:document.input.caseId,caseRevision:document.input.caseRevision,
    sourceId:document.input.sourceId,sourceRevision:document.input.sourceRevision,sourceSha256:document.input.sourceSha256,jobId:document.input.jobId,
    resultSha256:sha256(documentBytes),readerSha256:document.input.readerSha256,inputSha256:fingerprint(document.input),acceptedFence:enrollment.acceptedFence,resultBytes:documentBytes.length},partIds:[]};
  const record:RegistryRecord={id:id(11),siteId,identifier:'controlled-existing-record',revision:1,alias:'Protocol target',name:'Protocol target',kind:'building',
    footprint:[[0,0],[1,0],[1,1],[0,1]],links:[],rights:[],evidence:[{sourceId:id(12),locator:'existing protocol evidence'}],synthetic:true},
    {id:_,siteId:__,identifier:___,revision:____,...body}=record,
    state={draft:{id:draftId,site_id:siteId,case_id:id(21),records:[structuredClone(record)],revision:1,status:'draft'},
      row:{id:record.id,site_id:siteId,identifier:record.identifier,kind:record.kind,revision:1,body:structuredClone(body)},
      site:{id:siteId,identifier:'protocol-site',name:'protocol-site',revision:1,frame:{id:'protocol-frame'},synthetic:true},
      review:undefined as any,operations:new Map<string,any>(),history:new Map<number,any>([[1,structuredClone(body)]]),
      draftWrites:0,registryWrites:0,reads:0,toolChecks:0,revokeDuringDocument:false,revokeDuringArtifact:false,calls:[] as string[]},
    ordinarySource={id:id(12),case_id:caseId,family_id:id(12),revision:1,sha256:digest,bytes:1,name:'protocol recording source',profile:'protocol',
      mime_type:'text/plain',object_key:'protocol',created_at:'2026-10-01T00:00:00Z',status:'ready',inspection:{}};
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
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:1}];
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
  const objects=new Map([[`ifc-native/${jobId}/${sha256(resultBytes)}.json`,resultBytes],[result.artifact.key,artifact],
    [documentResultKey(document.input.jobId,sha256(documentBytes)),documentBytes]]);
  const dependencies:RegistryDocumentDependencies={source:async(_client,_ctx,pin)=>{
    assert.equal(pin.sourceId,docSelection.pin.sourceId);return document.input;
  },result:async()=>document,registrySource:async()=>({revision:1,sha256:digest,accessSha256:digest}) as any,
    ifcTools:()=>{state.toolChecks++;},fusionResult:async(selected,authority,budget)=>{
      state.reads++;
      const loaded=await readFusionResult(selected,authority,budget,(key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async()=>{
        const bytes=objects.get(key);assert(bytes);if(state.revokeDuringArtifact&&key===result.artifact.key)current.archived=true;
        return {body:Readable.from([bytes]),etag:'protocol'};
      }));
      if(selected.kind==='document'&&state.revokeDuringDocument)current.archived=true;return loaded;
    }};
  const context=fusionContextProjection([fusionSourceProjection(selection,{kind:'ifc',result,native}),
    fusionSourceProjection(docSelection,{kind:'document',result:document})]);
  const request={requestKey:id(30),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,
    addFusion:{contextSha256:context.contextSha256,selection:{sources:[selection,docSelection]}}};
  return {client,dependencies,state,record,body,current,source,job,selection,request,draftId,siteId,native,raw,context};
}
test('explicit IFC attach/private read/reviewed commit uses existing correction authority and preserves historical native evidence', {skip:!present},()=>local(async()=>{
  const f=fixture(),receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),record=f.state.draft.records[0];
  assert.equal(receipt.draftRevision,2);assert.equal(f.state.draftWrites,1);const pin=record.documentCitations![0];assert.equal(pin.version,'registry-ifc-citation/1');
  assert(pin.version==='registry-ifc-citation/1');assert.equal(pin.ifc.stepId,25);assert.equal(pin.id,citationId(pin));
  assert(!Object.hasOwn(pin,'partId'));assert(!Object.hasOwn(pin,'partSha256'));assert(!JSON.stringify(pin).includes('Single-family house'));
  assert.deepEqual(publicRegistryBody(record),f.record);assert.equal(pin.target.recordId,f.record.id);assert.equal(pin.document.sourceId,f.selection.pin.sourceId);
  const evidence=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),entry=evidence.citations[0];assert('record' in entry);
  assert.deepEqual(entry.record,f.native.records.find((record:any)=>record.stepId===25));assert.equal(fingerprint(entry.record),pin.ifc.recordSha256);
  for(const attribute of Object.values(entry.record.attributes) as any[])if(attribute.rawLiteral!==null)
    assert.equal(f.raw.subarray(attribute.locator.byteStart,attribute.locator.byteEnd).toString('latin1'),attribute.rawLiteral);
  assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),receipt);assert.equal(f.state.draftWrites,1);
  f.state.calls.length=0;await assertRegistryDocumentCitationsTx(f.client,f.siteId,record,false,f.dependencies);
  assert(!f.state.calls.some(sql=>/FOR (SHARE|UPDATE)/.test(sql)));
  const reviewContext=documentReviewContext();f.state.review={id:id(40),draftId:f.draftId,draftRevision:2,siteRevision:1,records:[structuredClone(record)],
    before:[f.record],findings:[],committed:false,documentReviewContext:reviewContext,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',
      records:[record],frame:f.state.site.frame,draftRevision:2,siteRevision:1,documentReviewContext:reviewContext})};
  const check:typeof assertRegistryDocumentCitationsTx=(client,siteId,record,lock)=>assertRegistryDocumentCitationsTx(client,siteId,record,lock,f.dependencies);
  f.current.archived=true;await assert.rejects(()=>commitRegistryReviewTx(f.client,id(40),'',undefined,check),(error:any)=>error.status===403);
  assert.equal(f.state.registryWrites,0);f.current.archived=false;
  const committed=await commitRegistryReviewTx(f.client,id(40),'',undefined,check);assert.equal(committed.committed,true);assert(f.state.registryWrites>0);
  assert(!Object.hasOwn(committed.records[0],'documentCitations'));assert.deepEqual(f.state.history.get(1),f.body);
  assert.deepEqual(f.state.row.body.documentCitations,[pin]);assert.equal(f.state.row.revision,2);
  const historical=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);assert.deepEqual(historical.citations[0].pin,pin);
  const proof=process.env.ULPIN_IFC_CITATION_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
    writeFileSync(proof+'/controlled-journey.json',JSON.stringify({scope:'memory correction/accepted rows and review; unchanged retained IFC bytes; no authentic crosswalk',
      request:f.request,receipt,citation:pin,privateRead:evidence,review:publicRegistryReview(f.state.review),committed,recordedBody:f.state.row.body,
      historicalRead:historical,qualification:'not_assessed',toolInventory:'stubbed; not current runtime qualification'},null,2)+'\n');}
}));
test('IFC exact site/input/reader/fence checks, late revocation and record-span drift deny; denied-source removal remains available', {skip:!present},()=>local(async()=>{
  const f=fixture();await registryIFCCitationSourceTx(f.client,f.siteId,f.selection.pin);
  await assert.rejects(()=>registryIFCCitationSourceTx(f.client,id(99),f.selection.pin),(error:any)=>error.status===403);
  for(const patch of [{inputSha256:'b'.repeat(64)},{readerSha256:'b'.repeat(64)},{acceptedFence:2}])
    await assert.rejects(()=>registryIFCCitationSourceTx(f.client,f.siteId,{...f.selection.pin,...patch}),(error:any)=>error.status===409);
  const late=fixture();late.state.revokeDuringDocument=true;
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(late.client,late.draftId,late.request,late.dependencies),(error:any)=>error.status===403);
  assert.equal(late.state.draftWrites,0);assert.equal(late.state.operations.size,0);
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const record=f.state.draft.records[0],pin=record.documentCitations![0];assert(pin.version==='registry-ifc-citation/1');
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(f.client,f.siteId,{...record,documentCitations:[{...pin,ifc:{...pin.ifc,recordPointer:'/records/0'}}]},false,f.dependencies),
    (error:any)=>error.status===409);
  f.state.revokeDuringArtifact=true;await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies),(error:any)=>error.status===403);
  f.state.revokeDuringArtifact=false;const previousReads=f.state.reads;
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:id(31),expectedDraftRevision:2,recordId:f.record.id,expectedRecordRevision:1,clearAll:true},f.dependencies);
  assert.equal(f.state.reads,previousReads);assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
}));
