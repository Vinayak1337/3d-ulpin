import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {DocumentResultSchema,IFCOriginalSchema,IFCResultSchema,UspSnapshotManifestSchema} from '../packages/contracts/src/usp';
import type {RegistryRecord} from '../packages/contracts/src/registry';
import type {RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  documentReviewContext,publicRegistryBody,publicRegistryReview,citationId} from '../packages/server/src/modules/registry/registry-document-evidence';
import {assertCitationEdit} from '../packages/server/src/modules/registry/registry-document-evidence';
import {assertedIFCCitations,reviewedIFCIdentifiers,ifcIdentityFields} from '../packages/server/src/modules/registry/registry-ifc-identifiers';
import {associationTargetAuthority} from '../packages/server/src/modules/usp/ingestion/document-association-targets';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {readSnapshotBody,resolveRegistryTarget} from '../packages/server/src/modules/usp/snapshots';
import {associationLiterals,associationPreflight} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {ModelGatewayConfigSchema,hash} from '../packages/server/src/modules/model-gateway/config';
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
  return {client,dependencies,state,record,body,current,source,job,selection,request,draftId,siteId,native,raw,context,ordinarySource,result,document,docSelection};
}
function review(f:ReturnType<typeof fixture>){
  const record=f.state.draft.records[0],reviewContext=documentReviewContext();
  f.state.review={id:id(40),draftId:f.draftId,draftRevision:f.state.draft.revision,siteRevision:1,records:[structuredClone(record)],
    before:[f.record],findings:[],committed:false,documentReviewContext:reviewContext,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',
      records:[record],frame:f.state.site.frame,draftRevision:f.state.draft.revision,siteRevision:1,documentReviewContext:reviewContext})};
  return commitRegistryReviewTx(f.client,id(40),'',undefined,(client,siteId,record,lock)=>
    assertRegistryDocumentCitationsTx(client,siteId,record,lock,f.dependencies));
}
/** Actual private projection and typed IFC authority over controlled SQL rows.
 * No live SQL/storage/tool/provider is used. Gates are asserted before row locks. */
function privateTargetPool(f:ReturnType<typeof fixture>){
  // Recording evidence and asserted IFC belong to separate source cases; the
  // native assertion must expand the whole-target protection set.
  f.ordinarySource.case_id=id(55);
  const ctx=localRequestContext(id(100)),pin={ref:{namespace:'registry_record',id:f.record.id},revision:f.state.row.revision},
    scope={kind:'snapshot' as const,scopeId:f.siteId,world:{namespace:'world',id:'planned'},manifestId:id(101),snapshotDigest:digest,stage:'recorded' as const},
    captured={...structuredClone(f.state.row),projectIdentity:null},manifest=UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:scope.manifestId,
      digest:scope.snapshotDigest,scope,capturedAt:'2026-10-02T00:00:00Z',selection:{kind:'targets',pins:[pin]},
      members:[{pin,bodySha256:fingerprint(captured),bodyRef:'controlled-target',authority:'registry'}],frame:{horizontal:null,vertical:null,unit:null,transform:null},
      policyVersion:ctx.policyVersion,accessViewId:ctx.accessViewId,validAt:null,asOf:null,coverage:{state:'partial',reasonCodes:['controlled-sql']}}),
    state={active:0,gates:[] as string[],protectedCases:[] as string[],jobProtected:false,reads:0},prior=(globalThis as any).ulpinPool,
    expectedCases=[f.ordinarySource.case_id,...(assertedIFCCitations(captured.body,captured.kind).length?[f.current.id]:[])].sort();
  const query=async(sql:string,args:any[]=[])=>{
    let rows:any[]=[];
    if(sql==='BEGIN'){state.active++;state.gates=[];state.protectedCases=[];}
    else if(sql==='COMMIT'||sql==='ROLLBACK')state.active--;
    else if(sql.startsWith('SELECT set_config'))rows=[{deadline_live:true}];
    else if(sql.startsWith('SET TRANSACTION')){}
    else if(sql.includes('pg_advisory_xact_lock'))state.gates.push(String(args[0]).replace('registry-import:',''));
    else if(sql.includes('FROM cases WHERE id=ANY')){
      assert.deepEqual(state.gates,args[0]);state.protectedCases=args[0];rows=args[0].map((id:string)=>({id}));
    }else{
      if(sql.includes('FOR SHARE')){
        assert.deepEqual(state.protectedCases,expectedCases,'all asserted IFC dependencies gated before destination/row protection');
        assert.deepEqual(state.gates,expectedCases);
      }
      if(sql.includes('FROM usp_snapshots'))rows=[{body:manifest}];
      else if(sql.includes('FROM usp_snapshot_bodies')){
        if(!sql.includes("namespace='source_revision'"))rows=[{body:captured,body_sha256:fingerprint(captured)}];
      }else if(sql.includes('FROM sources WHERE id=ANY'))rows=[f.source,f.ordinarySource].filter(row=>args[0].includes(row.id)).sort((a,b)=>a.id.localeCompare(b.id));
      else if(sql.includes('FROM sources s JOIN cases'))rows=[{...f.ordinarySource,source_site_id:f.siteId,source_archived:false,
        case_revision:1,case_context:null,case_frame:null}];
      else if(sql.startsWith('SELECT id FROM jobs')){state.jobProtected=true;assert(args[0].includes(f.job.id));}
      else if(sql.startsWith('SELECT job_id FROM usp_job_')||sql.includes('FROM usp_project_')||sql.startsWith('SELECT id FROM registry_records WHERE id=ANY')){}
      else return f.client.query(sql,args);
    }
    return {rows:structuredClone(rows),rowCount:rows.length};
  };
  (globalThis as any).ulpinPool={query,connect:async()=>({query,release(){}})};
  return {ctx,pin,scope,state,restore:()=>{(globalThis as any).ulpinPool=prior;},targets:()=>
    associationTargetAuthority(ctx,scope,[pin],[],{deadlineAt:Date.now()+30000})};
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
  const pool=privateTargetPool(f);try{assert(!(await pool.targets())[0].identifiers.some(id=>id.scheme==='ifc-globalid'));}finally{pool.restore();}
  const historical=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);assert.deepEqual(historical.citations[0].pin,pin);
  const proof=process.env.ULPIN_IFC_CITATION_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});
    writeFileSync(proof+'/controlled-journey.json',JSON.stringify({scope:'memory correction/accepted rows and review; unchanged retained IFC bytes; no authentic crosswalk',
      request:f.request,receipt,citation:pin,privateRead:evidence,review:publicRegistryReview(f.state.review),committed,recordedBody:f.state.row.body,
      historicalRead:historical,qualification:'not_assessed',toolInventory:'stubbed; not current runtime qualification'},null,2)+'\n');}
}));
test('explicit IFC identity confirmation commits privately and feeds the actual protected proposal/manual-selection flow', {skip:!present},()=>local(async()=>{
  const f=fixture();await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const ordinary=f.state.draft.records[0],citation=ordinary.documentCitations![0];
  assert.deepEqual(reviewedIFCIdentifiers(assertedIFCCitations(ordinary,ordinary.kind)),[]);
  const confirm={requestKey:id(32),expectedDraftRevision:2,recordId:f.record.id,expectedRecordRevision:1,assertIFCIdentity:citation.id};
  const receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,confirm,f.dependencies),confirmed=f.state.draft.records[0];
  const native=confirmed.documentCitations![0];assert(native.version==='registry-ifc-citation/1');
  assert.equal(receipt.draftRevision,3);assert.equal(native.identityAssertion!.globalId,'0c$N1CTon2BB2Sp89385G8');
  assert.deepEqual(native.identityAssertion!.attributeLocator,f.native.records.find((r:any)=>r.stepId===25).attributes.GlobalId.locator);
  assert.equal(native.id,citation.id);assert.throws(()=>assertCitationEdit(ordinary,{documentCitations:confirmed.documentCitations}),
    (error:any)=>error.code==='REGISTRY_DOCUMENT_AMENDMENT_REQUIRED');
  assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,f.draftId,confirm,f.dependencies),receipt);
  const pending=privateTargetPool(f);try{assert(!(await pending.targets())[0].identifiers.some(id=>id.scheme==='ifc-globalid'));}finally{pending.restore();}
  const committed=await review(f);assert(!JSON.stringify(committed).includes('identityAssertion'));
  const pool=privateTargetPool(f);try{
    const target=(await pool.targets())[0],identifier=target.identifiers.find(id=>id.scheme==='ifc-globalid')!;
    assert.equal(identifier.value,native.identityAssertion!.globalId);assert.equal(identifier.state,'reviewed');assert.equal(pool.state.jobProtected,true);
    assert.deepEqual(identifier.source,{ref:{namespace:'source_revision',id:f.source.id},revision:1});
    assert(!JSON.stringify(await readSnapshotBody(pool.ctx,pool.scope,pool.pin)).includes('identityAssertion'));
    const general=await resolveRegistryTarget(pool.ctx,pool.scope,pool.pin);assert(general.state==='available');
    assert(!general.data.identifiers.some(id=>id.scheme==='ifc-globalid'));
    const literals=associationLiterals(f.context),literal=literals.find(l=>l.citation.kind==='ifc')!;
    assert.equal(associationPreflight(literals,[target,{...target,pin:{ref:{namespace:'registry_record',id:id(98)},revision:2}}]).canPropose,false);
    const config=ModelGatewayConfigSchema.parse({projectId:'ifc-identity-control',policyVersion:'protocol',fundingVersion:'protocol',gatewayExclusiveFunding:true,
      indiaPrivateApproved:true,secretReference:'ULPIN_PROVIDER_KEY_PROTOCOL',model:'sarvam-105b',projectCapMicroInr:'100',principalDailyCallCap:10,
      price:{version:'protocol',inputPerMillionMicroInr:'1',cachedInputPerMillionMicroInr:'1',outputPerMillionMicroInr:'1'},
      inputBound:{version:'protocol',maxPromptTokens:34816},maxOutputTokens:2048,timeoutMs:1000,paceMs:1500});
    let calls=0;
    const ifcProjection=(selected:Extract<SourceFusionSelection,{kind:'ifc'}>)=>{
      const projected=fusionSourceProjection(selected,{kind:'ifc',result:f.result,native:f.native});assert(projected.kind==='ifc');return projected;
    };
    const response=await proposeFusionAssociations(pool.ctx,{requestKey:id(33),context:f.request.addFusion,scope:pool.scope,targets:[pool.pin]},
      {capture:async()=>({context:f.context,unsupportedCitationSources:[],ifcProjection,revalidate:async()=>{await registryIFCCitationSourceTx(f.client,f.siteId,f.selection.pin);}}),
        targets:async(...args)=>associationTargetAuthority(args[0],args[1],args[2],[],args[4]),policy:()=>hash(config),
        gateway:async()=>({config,port:trusted=>({modelGateway:async(_ctx,input)=>{
          await trusted.authorize();assert.equal(pool.state.active,0,'complete protections release before gateway I/O');calls++;
          const output={suggestions:[{targetId:f.record.id,scheme:'ifc-globalid',matchedIdentifier:identifier.value,
            citations:[{key:literal.citation.key,quote:literal.text}],rationale:'Inspect the officer-confirmed native entity.'}],abstentions:[]};
          return {state:'available',data:{output:trusted.minimizeOutput(output) as any,modelId:config.model,outputSchemaId:input.outputSchemaId,evidenceRefs:[],replayed:false}};
        }})})});
    assert.equal(response.state,'proposed');assert.equal(calls,1);const manual=response.proposals[0].manualSelection;
    assert.deepEqual(manual.selection.sources.find(s=>s.kind==='ifc')!.stepIds,[25]);
    assert.deepEqual(manual.selection.sources.find(s=>s.kind==='document')!.partIds,[]);
    // Controlled next correction uses the current canonical body/revision.
    f.state.draft.status='draft';f.state.draft.records=[{...f.state.row.body,...f.record,revision:2,documentCitations:f.state.row.body.documentCitations}];
    const selected=await amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:id(34),expectedDraftRevision:3,recordId:f.record.id,
      expectedRecordRevision:2,addFusion:manual},f.dependencies);assert.equal(selected.changed,true);
    const proof=process.env.ULPIN_IFC_IDENTITY_PROOF_DIR;if(proof){mkdirSync(proof,{recursive:true});writeFileSync(proof+'/controlled-journey.json',JSON.stringify({
      scope:'unchanged retained test_only IFC bytes; controlled source/job/registry/snapshot rows, review and gateway reply',receipt,native,committed,target,response,selected,
      originalSha256:sha256(f.raw),toolChecks:'stubbed; no live persistence, provider or authentic crosswalk'},null,2)+'\n');}
    f.current.archived=true;await assert.rejects(()=>pool.targets(),(error:any)=>error.status===403);f.current.archived=false;
    f.job.accepted_fence=2;await assert.rejects(()=>pool.targets(),(error:any)=>error.status===409);f.job.accepted_fence=1;
    f.state.row.revision=3;await assert.rejects(()=>pool.targets(),(error:any)=>error.status===409);f.state.row.revision=2;
    const reads=f.state.reads;f.current.archived=true;
    await amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:id(35),expectedDraftRevision:4,recordId:f.record.id,
      expectedRecordRevision:2,clearAll:true},f.dependencies);assert.equal(f.state.reads,reads);assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
    assert.equal(pool.state.active,0);
  }finally{pool.restore();}
}));
test('IFC confirmation rejects wrong target/entity and missing or conflicting native identifiers', {skip:!present},()=>local(async()=>{
  const f=fixture();f.selection.stepIds=[36,183];f.request.addFusion.contextSha256=fusionContextProjection([
    fusionSourceProjection(f.selection,{kind:'ifc',result:f.result,native:f.native}),fusionSourceProjection(f.docSelection,{kind:'document',result:f.document})]).contextSha256;
  await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  for(const citation of f.state.draft.records[0].documentCitations!)await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,
    {requestKey:id(36),expectedDraftRevision:2,recordId:f.record.id,expectedRecordRevision:1,assertIFCIdentity:citation.id},f.dependencies),
    (error:any)=>error.code==='REGISTRY_IFC_IDENTITY_KIND');
  assert.equal(f.state.draftWrites,1);
  const storey=f.native.records.find((r:any)=>r.stepId===36);assert.equal(ifcIdentityFields('floor',storey).globalId,'1Ano2ZUxnEIvVQ_beukl8b');
  const incomplete=structuredClone(storey);incomplete.attributes.GlobalId={state:'null',value:null,rawLiteral:'$',locator:{}};
  assert.throws(()=>ifcIdentityFields('floor',incomplete),(error:any)=>error.code==='REGISTRY_IFC_IDENTITY_LITERAL');
  const good=fixture();await amendRegistryDocumentCitationsTx(good.client,good.draftId,good.request,good.dependencies);
  await amendRegistryDocumentCitationsTx(good.client,good.draftId,{requestKey:id(37),expectedDraftRevision:2,recordId:good.record.id,
    expectedRecordRevision:1,assertIFCIdentity:good.state.draft.records[0].documentCitations![0].id},good.dependencies);
  const pin=assertedIFCCitations(good.state.draft.records[0],'building')[0];
  assert(reviewedIFCIdentifiers([pin,{...pin,ifc:{...pin.ifc,stepId:999}}]).every(id=>id.state==='disputed'));
  good.current.archived=true;const reads=good.state.reads;
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(good.client,good.siteId,good.state.draft.records[0],false,good.dependencies),(error:any)=>error.status===403);
  assert.equal(good.state.reads,reads);
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
