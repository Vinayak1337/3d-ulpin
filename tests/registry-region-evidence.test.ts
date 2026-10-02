import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {RegistryDocumentAmendmentSchema,type RegistryRecord,type RegistryReview,type RegistryDraft} from '../packages/contracts/src';
import {PacketRegionWorkerSchema} from '../packages/contracts/src/packet-region';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {registrySourceTx} from '../packages/server/src/modules/registry/registry-metadata';
import {registryRegionSourceTx,prepareRegistryRegion} from '../packages/server/src/modules/registry/registry-region-evidence';
import {amendRegistryDocumentCitationsTx,registryRegionAmendmentPreflightTx,readRegistryDocumentCitationsTx,
  assertRegistryDocumentCitationsTx,assertCitationEdit,publicRegistryBody,publicRegistryReview,documentReviewContext,
  type RegistryRegionAmendmentPrepared,type RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {persistRegistryReviewTx,commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {registryRegionCases,registryDocumentCases,lockRegistryDocumentCasesTx} from '../packages/server/src/modules/registry/registry-document-locks';

// Source/crop proof is retained unchanged. Every case/site/target/SQL row here
// is a memory-only technical control, never operational property applicability.
// These controls cover private access and stale publication, which a screenshot
// cannot establish. No native rendering, model, service or original write runs.
const root='E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/real-crop-02';
const present=existsSync(root+'/result.json')&&existsSync(root+'/region.png');
const subject='registry-region-technical-control',digest='a'.repeat(64);
const status=(n:number)=>(error:any)=>error.status===n;
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(){
  const validation=PacketRegionWorkerSchema.parse(JSON.parse(readFileSync(root+'/result.json','utf8'))),png=readFileSync(root+'/region.png');
  const siteId=randomUUID(),caseId=randomUUID(),sourceId=randomUUID(),recordingId=randomUUID(),draftId=randomUUID(),binding=ingestionBinding(caseId);
  const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,sha256:validation.sourceSha256,
    bytes:validation.sourceBytes,object_key:'technical-retained-original',name:'Technical source envelope',mime_type:'application/pdf',
    profile:'pdf-reference-v2',status:'needs_input',created_at:'2026-10-02T00:00:00Z',
    inspection:{status:'needs_input',documentOriginal:{version:'source-document/1',subject:binding.subject,format:'pdf',
      sha256:validation.sourceSha256,bytes:validation.sourceBytes,receivedAt:'2026-10-02T00:00:00Z'}}};
  const sourceCase={id:caseId,site_id:siteId,revision:1,archived:false,context:null,frame:null};
  const recording={id:recordingId,case_id:caseId,family_id:recordingId,revision:1,sha256:digest,bytes:1,
    object_key:'technical-existing-record-evidence',name:'Technical existing evidence',profile:'technical-control',mime_type:'text/plain',
    status:'ready',inspection:{},created_at:'2026-10-02T00:00:00Z'};
  const body={alias:'Technical region target',name:'Technical region target',kind:'building' as const,
    footprint:[[0,0],[1,0],[1,1],[0,1]] as [number,number][],links:[],rights:[],
    evidence:[{sourceId:recordingId,locator:'technical existing-record evidence'}],synthetic:true};
  const record:RegistryRecord={...body,id:randomUUID(),identifier:'technical-reference',siteId,revision:1};
  const site={id:siteId,identifier:'technical-site',name:'Technical site',revision:1,
    frame:{id:'technical-control',benchmark:'technical-control',horizontalUnit:'m' as const,verticalUnit:'m' as const},synthetic:true};
  const state={draft:{id:draftId,site_id:siteId,case_id:randomUUID(),status:'draft',revision:1,
    records:[structuredClone(record)],created_at:'2026-10-02T00:00:00Z'},
    row:{id:record.id,site_id:siteId,kind:'building',identifier:record.identifier,revision:1,body:structuredClone(body)},
    history:new Map<number,any>([[1,structuredClone(body)]]),operations:new Map<string,any>(),reviews:new Map<string,any>(),
    events:[] as {sql:string;args:any[]}[],writes:0,byteReads:0,latest:1,onCaseLock:undefined as (()=>void)|undefined,
    onTargetRead:undefined as (()=>void)|undefined};
  const sources=new Map<string,any>([[sourceId,source],[recordingId,recording]]);
  const client={query:async(sql:string,args:any[]=[])=>{
    state.events.push({sql,args});let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('FROM cases')){if(sql.includes('FOR SHARE'))state.onCaseLock?.();rows=args[0]===caseId?[structuredClone(sourceCase)]:[];}
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:state.latest}];
    else if(sql.includes('source_site_id')||sql.includes('SELECT s.* FROM sources')){
      const s=sources.get(args[0]);if(s)rows=[{...structuredClone(s),source_site_id:sourceCase.site_id,source_archived:sourceCase.archived}];
    }
    else if(sql.includes('FROM sources')){const s=sources.get(sql.includes('WHERE case_id=')?args[1]:args[0]);if(s)rows=[structuredClone(s)];}
    else if(sql.includes('FROM registry_drafts'))rows=[structuredClone(state.draft)];
    else if(sql.includes('FROM registry_sites'))rows=[structuredClone(site)];
    else if(sql.includes('CASE WHEN r.revision'))rows=[{site_id:siteId,kind:state.row.kind,
      body:structuredClone(args[1]===state.row.revision?state.row.body:state.history.get(args[1]))}];
    else if(sql.includes('FROM registry_records')){state.onTargetRead?.();rows=[structuredClone(state.row)];}
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.includes('FROM registry_reviews'))rows=state.reviews.has(args[0])?[structuredClone(state.reviews.get(args[0]))]:[];
    else if(sql.includes('FROM building_preparations')){}
    else if(sql.startsWith('UPDATE registry_drafts SET records')){state.draft.records=JSON.parse(args[1]);state.draft.revision++;state.writes++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else if(sql.startsWith('INSERT INTO registry_reviews'))state.reviews.set(args[0],{draft_id:args[1],body:structuredClone(args[2]),committed:false});
    else if(sql.startsWith('UPDATE registry_records')){state.row.body=structuredClone(args[1]);state.row.revision=args[2];state.writes++;}
    else if(sql.startsWith('INSERT INTO registry_revisions'))state.history.set(args[1],structuredClone(args[2]));
    else if(sql.startsWith('DELETE FROM registry_')){}
    else if(sql.startsWith('UPDATE registry_sites'))site.revision=args[1];
    else if(sql.startsWith("UPDATE registry_drafts SET status"))state.draft.status='recorded';
    else if(sql.startsWith('UPDATE registry_reviews'))state.reviews.get(args[0]).committed=true;
    else throw new Error('Unexpected region technical SQL: '+sql);
    return {rows,rowCount:rows.length};
  }} as unknown as PoolClient;
  const dependencies:RegistryDocumentDependencies={source:async()=>{throw new Error('Region must not read job authority');},
    result:async()=>{throw new Error('Region must not read result bytes');},registrySource:registrySourceTx,regionSource:registryRegionSourceTx};
  const request=RegistryDocumentAmendmentSchema.parse({requestKey:randomUUID(),expectedDraftRevision:1,
    recordId:record.id,expectedRecordRevision:1,addRegion:{document:{caseId,caseRevision:1,sourceId,sourceRevision:1,
      sourceSha256:validation.sourceSha256,sourceBytes:validation.sourceBytes},page:validation.page,region:validation.selection,purpose:'record_evidence'}});
  const extract=async()=>{state.byteReads++;return {bytes:png,provenance:{...validation,version:'packet-region/1' as const,
    caseId,caseRevision:1,sourceId,sourceRevision:1,purpose:'private_source_preview' as const}};};
  async function prepare():Promise<RegistryRegionAmendmentPrepared>{
    state.events.length=0;const captured=await registryRegionAmendmentPreflightTx(client,draftId,request,dependencies);assert(captured);
    assert(!state.events.some(e=>e.sql.includes('pg_advisory')||/FOR (SHARE|UPDATE)/.test(e.sql)),'Preflight holds no mutation locks');
    return {...await prepareRegistryRegion(request.addRegion!,captured.source,extract),...captured};
  }
  const checker:typeof assertRegistryDocumentCitationsTx=(c,s,r,lock,_,protect)=>assertRegistryDocumentCitationsTx(c,s,r,lock,dependencies,protect);
  function snapshot(){const d:RegistryDraft={id:draftId,caseId:state.draft.case_id,siteId,revision:state.draft.revision,
    records:structuredClone(state.draft.records),status:'draft',createdAt:new Date(state.draft.created_at).toISOString()};
    return {d,site:structuredClone(site),combined:structuredClone(state.draft.records)};}
  function review():RegistryReview{const s=snapshot(),ctx=documentReviewContext();return {id:randomUUID(),draftId,
    draftRevision:s.d.revision,siteRevision:site.revision,records:s.d.records,before:[record],findings:[],committed:false,
    documentReviewContext:ctx,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',records:s.combined,
      frame:site.frame,draftRevision:s.d.revision,siteRevision:site.revision,documentReviewContext:ctx})};}
  return {siteId,caseId,sourceId,source,sourceCase,recording,record,site,state,client,dependencies,request,extract,prepare,checker,snapshot,review};
}
function earlyRegionLock(events:{sql:string;args:any[]}[],caseId:string,destination:string){
  const held=events.findIndex(e=>e.sql==='SELECT id FROM cases WHERE id=$1 FOR SHARE'&&e.args[0]===caseId);
  assert(held>=0);const gate=events.map(e=>e.sql.includes('pg_advisory_xact_lock')&&e.args[0]?.startsWith?.('registry-import:')).lastIndexOf(true);
  assert(gate<held);assert(held<events.findIndex(e=>e.sql.includes(destination)));
}

test('retained region attaches privately, persists canonical review and commits exact binding/history under early case protection',
  {skip:!present},()=>local(async()=>{
    const f=fixture(),prepared=await f.prepare();f.state.events.length=0;
    await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared);
    earlyRegionLock(f.state.events,f.caseId,'FROM registry_sites');
    const attached=f.state.draft.records[0],pin=attached.documentCitations![0];
    assert.equal(pin.version,'registry-document-region-citation/1');assert.equal(pin.selection.subject,subject);
    for(const field of ['jobId','resultSha256','inputSha256','readerSha256','acceptedFence']){
      assert(!Object.hasOwn(pin.document,field));assert(!Object.hasOwn(pin,field));
    }
    assert.deepEqual(publicRegistryBody(attached),f.record);assert.throws(()=>assertCitationEdit(f.record,{documentCitations:attached.documentCitations}),status(422));
    const read=await readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies);
    assert.deepEqual(read.citations,[{pin}]);assert.equal(f.state.byteReads,1);
    assert.equal(await registryRegionAmendmentPreflightTx(f.client,f.state.draft.id,f.request,f.dependencies),undefined);
    await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies);assert.equal(f.state.writes,1);
    f.state.events.length=0;
    await f.checker(f.client,f.siteId,attached,false);
    assert(!f.state.events.some(e=>/FOR (SHARE|UPDATE)/.test(e.sql)),'Review snapshot is read-only');
    const review=f.review(),snapshot=f.snapshot();f.state.events.length=0;
    await persistRegistryReviewTx(f.client,snapshot,review,f.checker);
    earlyRegionLock(f.state.events,f.caseId,'FROM registry_sites');assert.equal(f.state.reviews.size,1);
    assert(!Object.hasOwn(publicRegistryReview(review).records[0],'documentCitations'));
    const originalHistory=structuredClone(f.state.history.get(1));f.sourceCase.archived=true;
    await assert.rejects(()=>commitRegistryReviewTx(f.client,review.id,'',undefined,f.checker),status(403));assert.equal(f.state.writes,1);
    f.sourceCase.archived=false;f.state.events.length=0;
    const committed=await commitRegistryReviewTx(f.client,review.id,'',undefined,f.checker);
    earlyRegionLock(f.state.events,f.caseId,'physical-area-recording');assert.equal(committed.committed,true);
    assert.equal(f.state.row.revision,2);assert.deepEqual(f.state.row.body.documentCitations,[pin]);
    assert.deepEqual(f.state.history.get(2).documentCitations,[pin]);assert.deepEqual(f.state.history.get(1),originalHistory);
    assert(!Object.hasOwn(committed.records[0],'documentCitations'));
    assert.deepEqual((await readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies)).citations,[{pin}]);
    assert.equal(f.state.byteReads,1);f.recording.status='needs_input';
    await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies),
      (error:any)=>error.code==='REGISTRY_SOURCE_UNAVAILABLE');
  }));

test('caller proof/flags, wrong frame/page and source/draft/target preflight drift cannot publish a binding',
  {skip:!present},()=>local(async()=>{
    const f=fixture(),captured=await registryRegionAmendmentPreflightTx(f.client,f.state.draft.id,f.request,f.dependencies);assert(captured);
    for(const raw of [{...f.request,validation:{}},{...f.request,reviewed:true},
      {...f.request,addRegion:{...f.request.addRegion,validation:{}}}])assert(!RegistryDocumentAmendmentSchema.safeParse(raw).success);
    for(const addition of [{...f.request.addRegion!,page:2},
      {...f.request.addRegion!,region:{...f.request.addRegion!.region,frame:{...f.request.addRegion!.region.frame,width:2585}}}])
      await assert.rejects(()=>prepareRegistryRegion(addition,captured.source,f.extract),status(409));
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies),status(409));
    const prepared=await f.prepare();f.sourceCase.revision++;
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared),status(409));
    f.sourceCase.revision--;f.source.object_key='changed-original-authority';
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared),status(409));
    f.source.object_key='technical-retained-original';f.state.row.body.name='Changed target body';
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared),status(409));
    f.state.row.body.name=f.record.name;f.state.draft.records[0].name='Changed draft';
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared),status(409));
    assert.equal(f.state.writes,0);assert.equal(f.state.operations.size,0);
    const late=fixture(),validated=await late.prepare();let targets=0;
    late.state.onTargetRead=()=>{if(++targets===2)late.source.inspection.documentOriginal.subject='revoked-at-final-target';};
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(late.client,late.state.draft.id,late.request,late.dependencies,validated),status(403));
    assert.equal(late.state.writes,0);assert.equal(late.state.operations.size,0);
    for(const kind of ['floor','space'] as const){
      const selected=fixture();(selected.state.row as any).kind=kind;(selected.state.row.body as any).kind=kind;
      (selected.state.draft.records[0] as any).kind=kind;
      await amendRegistryDocumentCitationsTx(selected.client,selected.state.draft.id,selected.request,selected.dependencies,await selected.prepare());
      assert.equal((await readRegistryDocumentCitationsTx(selected.client,selected.state.draft.id,selected.dependencies)).citations.length,1);
    }
  }));

test('source/site/access/family denial blocks retained reads/replay/review; removal reads no crop or denied source authority',
  {skip:!present},()=>local(async()=>{
    const f=fixture();await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,await f.prepare());
    const record=f.state.draft.records[0],pin=record.documentCitations![0],bytes=f.state.byteReads;
    (f.source.inspection as any).copiedFrom={};
    await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies),
      (error:any)=>error.code==='REGISTRY_REGION_COPY_UNSUPPORTED');delete (f.source.inspection as any).copiedFrom;
    f.state.latest=2;await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies),status(409));f.state.latest=1;
    f.sourceCase.site_id=randomUUID();await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies),status(403));
    f.sourceCase.site_id=f.siteId;(f.source.inspection.documentOriginal as any).subject='revoked-source-owner';
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies),status(403));
    await assert.rejects(()=>persistRegistryReviewTx(f.client,f.snapshot(),f.review(),f.checker),status(403));assert.equal(f.state.reviews.size,0);
    const drifted={...record,documentCitations:[{...pin,selection:{...pin.selection,accessSha256:digest}}]};
    f.source.inspection.documentOriginal.subject=subject;
    await assert.rejects(()=>f.checker(f.client,f.siteId,drifted,true),status(409));
    f.source.inspection.documentOriginal.subject='revoked-source-owner';f.state.events.length=0;
    await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,{requestKey:randomUUID(),expectedDraftRevision:2,
      recordId:f.record.id,expectedRecordRevision:1,remove:[pin.id]},f.dependencies);
    assert.deepEqual(f.state.draft.records[0].documentCitations,[]);assert.equal(f.state.byteReads,bytes);
    assert(!f.state.events.some(e=>e.sql.includes('FROM sources')&&e.args.includes(f.sourceId)),'Removal never reads denied source authority');
    assert.equal(f.state.writes,2);
  }));

test('region protection sorts complete case gates/rows and rejects a changed region set without late locks or publication',
  {skip:!present},()=>local(async()=>{
    const f=fixture();await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,await f.prepare());
    const record=f.state.draft.records[0],other=randomUUID(),records=[record,{...record,
      documentCitations:[{...record.documentCitations![0],document:{...record.documentCitations![0].document,caseId:other}}]}];
    f.state.events.length=0;
    await lockRegistryDocumentCasesTx(f.client,registryDocumentCases(f.state.draft.case_id,records),registryRegionCases(records));
    assert.deepEqual(f.state.events.filter(e=>e.sql==='SELECT id FROM cases WHERE id=$1 FOR SHARE').map(e=>e.args[0]),[f.caseId,other].sort());
    const held=structuredClone(record.documentCitations);f.state.onCaseLock=()=>{f.state.draft.records[0].documentCitations=[];};
    f.state.events.length=0;
    await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies),status(409));
    assert(!f.state.events.some(e=>e.sql.includes('FROM sources')));assert.equal(f.state.writes,1);
    f.state.onCaseLock=undefined;f.state.draft.records[0].documentCitations=held;
    // Same gate identities but region protection disappears during acquisition.
    const review=f.review();await persistRegistryReviewTx(f.client,f.snapshot(),review,f.checker);
    f.state.onCaseLock=()=>{(f.state.draft.records[0].documentCitations![0] as any).version='registry-ifc-citation/1';};
    // Remove the region from both captured collections without changing the
    // complete case gate set; held region rows must still be revalidated.
    const change=f.state.onCaseLock;f.state.onCaseLock=()=>{
      change();(f.state.reviews.get(review.id).body.records[0].documentCitations[0] as any).version='registry-ifc-citation/1';
    };
    await assert.rejects(()=>commitRegistryReviewTx(f.client,review.id,'',undefined,f.checker),
      (error:any)=>error.status===409&&error.message.includes('case set changed'));
    assert.equal(f.state.writes,1);
  }));
