import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {RegistryDocumentAmendmentSchema,type RegistryRecord,type RegistryReview,type RegistryDraft} from '../packages/contracts/src';
import {PacketImageRegionProvenanceSchema} from '../packages/contracts/src/packet-image-region';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {registrySourceTx} from '../packages/server/src/modules/registry/registry-metadata';
import {registryImageRegionSourceTx,prepareRegistryImageRegion} from '../packages/server/src/modules/registry/registry-image-region-evidence';
import {amendRegistryDocumentCitationsTx,registryImageRegionAmendmentPreflightTx,readRegistryDocumentCitationsTx,
  assertRegistryDocumentCitationsTx,assertCitationEdit,publicRegistryBody,documentReviewContext,
  type RegistryImageRegionAmendmentPrepared,type RegistryDocumentDependencies} from '../packages/server/src/modules/registry/registry-document-evidence';
import {persistRegistryReviewTx,commitRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {registryRegionCases} from '../packages/server/src/modules/registry/registry-document-locks';

// Actual accepted crop/provenance bytes are retained unchanged. Source/site/target/
// access/SQL/extraction are technical method controls, never a real property crosswalk.
// No native decoder/renderer, model, service, provider or original write runs.
const root='E:/BhuAayam-data/task-data/desktop-packet-image-region-20261003';
const subject='registry-image-region-technical-control',digest='a'.repeat(64);
const status=(value:number)=>(error:any)=>error.status===value;
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(format:'png'|'jpeg'='png',kind:'building'|'floor'='building'){
  const proof=PacketImageRegionProvenanceSchema.parse(JSON.parse(readFileSync(root+'/'+format+'-provenance.json','utf8')));
  const png=readFileSync(root+'/'+format+'-region.png');
  const siteId=randomUUID(),caseId=randomUUID(),sourceId=randomUUID(),recordingId=randomUUID(),draftId=randomUUID(),binding=ingestionBinding(caseId);
  const source={id:sourceId,case_id:caseId,family_id:sourceId,revision:1,sha256:proof.sourceSha256,bytes:proof.sourceBytes,
    object_key:'technical-retained-image',name:'Technical image envelope',mime_type:'image/'+format,profile:'image-reference-v2',
    status:'needs_input',created_at:'2026-10-03T00:00:00Z',inspection:{status:'needs_input',
      documentOriginal:{version:'source-document/1',subject:binding.subject,format,sha256:proof.sourceSha256,
        bytes:proof.sourceBytes,receivedAt:'2026-10-03T00:00:00Z'}}};
  const sourceCase={id:caseId,site_id:siteId,revision:1,archived:false,context:null,frame:null};
  const recording={id:recordingId,case_id:caseId,family_id:recordingId,revision:1,sha256:digest,bytes:1,
    object_key:'technical-existing-evidence',name:'Technical existing evidence',profile:'technical-control',mime_type:'text/plain',
    status:'ready',inspection:{},created_at:'2026-10-03T00:00:00Z'};
  const body={alias:'Technical image target',name:'Technical image target',kind,
    footprint:[[0,0],[1,0],[1,1],[0,1]] as [number,number][],links:[],rights:[],
    evidence:[{sourceId:recordingId,locator:'technical existing-record evidence'}],synthetic:true};
  const record:RegistryRecord={...body,id:randomUUID(),identifier:'technical-reference',siteId,revision:1};
  const site={id:siteId,identifier:'technical-site',name:'Technical site',revision:1,
    frame:{id:'technical-control',benchmark:'technical-control',horizontalUnit:'m' as const,verticalUnit:'m' as const},synthetic:true};
  const state={draft:{id:draftId,site_id:siteId,case_id:randomUUID(),status:'draft',revision:1,
    records:[structuredClone(record)],created_at:'2026-10-03T00:00:00Z'},
    row:{id:record.id,site_id:siteId,kind,identifier:record.identifier,revision:1,body:structuredClone(body)},
    history:new Map<number,any>([[1,structuredClone(body)]]),operations:new Map<string,any>(),reviews:new Map<string,any>(),
    events:[] as {sql:string;args:any[]}[],writes:0,byteReads:0,latest:1,onTargetRead:undefined as (()=>void)|undefined};
  const sources=new Map<string,any>([[sourceId,source],[recordingId,recording]]);
  const client={query:async(sql:string,args:any[]=[])=>{
    state.events.push({sql,args});let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')){}
    else if(sql.includes('FROM cases'))rows=args[0]===caseId?[structuredClone(sourceCase)]:[];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:state.latest}];
    else if(sql.includes('source_site_id')||sql.includes('SELECT s.* FROM sources')){
      const value=sources.get(args[0]);if(value)rows=[{...structuredClone(value),source_site_id:sourceCase.site_id,source_archived:sourceCase.archived}];
    }else if(sql.includes('FROM sources')){const value=sources.get(sql.includes('WHERE case_id=')?args[1]:args[0]);if(value)rows=[structuredClone(value)];}
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
    else if(sql.startsWith('UPDATE registry_drafts SET status'))state.draft.status='recorded';
    else if(sql.startsWith('UPDATE registry_reviews'))state.reviews.get(args[0]).committed=true;
    else throw new Error('Unexpected image technical SQL: '+sql);
    return {rows,rowCount:rows.length};
  }} as unknown as PoolClient;
  const dependencies:RegistryDocumentDependencies={source:async()=>{throw new Error('Image region has no job authority');},
    result:async()=>{throw new Error('Image region has no job result');},registrySource:registrySourceTx,imageRegionSource:registryImageRegionSourceTx};
  const request=RegistryDocumentAmendmentSchema.parse({requestKey:randomUUID(),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,
    addImageRegion:{document:{caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:proof.sourceSha256,sourceBytes:proof.sourceBytes},
      region:proof.selection,purpose:'record_evidence'}});
  const extract=async()=>{state.byteReads++;assert(!state.events.some(event=>/FOR (SHARE|UPDATE)|pg_advisory/.test(event.sql)),
    'Native preparation must be outside mutation locks');return {bytes:png,provenance:{...proof,caseId,caseRevision:1,sourceId,sourceRevision:1}};};
  async function prepare():Promise<RegistryImageRegionAmendmentPrepared>{state.events.length=0;
    const captured=await registryImageRegionAmendmentPreflightTx(client,draftId,request,dependencies);assert(captured);
    return {...await prepareRegistryImageRegion(request.addImageRegion!,captured.source,extract),...captured};}
  const checker:typeof assertRegistryDocumentCitationsTx=(c,s,r,lock,_,protect)=>assertRegistryDocumentCitationsTx(c,s,r,lock,dependencies,protect);
  function snapshot(){const draft:RegistryDraft={id:draftId,caseId:state.draft.case_id,siteId,revision:state.draft.revision,
    records:structuredClone(state.draft.records),status:'draft',createdAt:new Date(state.draft.created_at).toISOString()};
    return {d:draft,site:structuredClone(site),combined:structuredClone(state.draft.records)};}
  function review():RegistryReview{const s=snapshot(),ctx=documentReviewContext();return {id:randomUUID(),draftId,draftRevision:s.d.revision,
    siteRevision:site.revision,records:s.d.records,before:[record],findings:[],committed:false,documentReviewContext:ctx,
    inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',records:s.combined,frame:site.frame,
      draftRevision:s.d.revision,siteRevision:site.revision,documentReviewContext:ctx})};}
  return {siteId,caseId,sourceId,source,sourceCase,record,state,client,dependencies,request,extract,prepare,checker,snapshot,review};
}
function earlyImageLock(f:ReturnType<typeof fixture>,destination:string){const events=f.state.events;
  const source=events.findIndex(event=>event.sql==='SELECT id FROM cases WHERE id=$1 FOR SHARE'&&event.args[0]===f.caseId);
  assert(source>=0&&source<events.findIndex(event=>event.sql.includes(destination)));}

test('retained PNG building and JPEG floor citations pass canonical amendment/read/replay/review/commit/history without crop rerun',()=>local(async()=>{
  for(const [format,kind] of [['png','building'],['jpeg','floor']] as const){
    const f=fixture(format,kind),prepared=await f.prepare();f.state.events.length=0;
    await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared);earlyImageLock(f,'FROM registry_sites');
    const attached=f.state.draft.records[0],pin=attached.documentCitations![0];assert.equal(pin.version,'registry-image-region-citation/1');
    assert.equal(pin.selection.subject,subject);assert.equal(pin.associationState,'operator_selected');assert.equal(pin.qualification,'not_assessed');
    for(const field of ['page','jobId','inputSha256','readerSha256','acceptedFence'])assert(!Object.hasOwn(pin,field)&&!Object.hasOwn(pin.document,field));
    assert.deepEqual(registryRegionCases([attached]),[f.caseId]);assert.deepEqual(publicRegistryBody(attached),f.record);
    assert.throws(()=>assertCitationEdit(f.record,{documentCitations:attached.documentCitations}),status(422));
    assert.deepEqual((await readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies)).citations,[{pin}]);
    assert.equal(await registryImageRegionAmendmentPreflightTx(f.client,f.state.draft.id,f.request,f.dependencies),undefined);
    await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies);assert.equal(f.state.writes,1);
    const review=f.review();f.state.events.length=0;await persistRegistryReviewTx(f.client,f.snapshot(),review,f.checker);earlyImageLock(f,'FROM registry_sites');
    const before=structuredClone(f.state.history.get(1));f.state.events.length=0;
    const committed=await commitRegistryReviewTx(f.client,review.id,'',undefined,f.checker);earlyImageLock(f,'physical-area-recording');
    assert.equal(committed.committed,true);assert.equal(f.state.row.revision,2);assert(!Object.hasOwn(committed.records[0],'documentCitations'));
    assert.deepEqual(f.state.history.get(1),before);assert.deepEqual(f.state.history.get(2).documentCitations,[pin]);assert.equal(pin.target.revision,1);
    const historical=await readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies);
    assert.deepEqual(historical.citations,[{pin}]);
    await commitRegistryReviewTx(f.client,review.id,'',undefined,f.checker);assert.equal(f.state.byteReads,1);
    const evidence=process.env.ULPIN_IMAGE_CITATION_TEST_EVIDENCE;
    if(evidence)writeFileSync(evidence+'/'+format+'-journey.json',JSON.stringify({
      version:'registry-image-region-control/1',classification:'technical_source_target_SQL_transport_controls',
      sourceFormat:format,targetKind:kind,amendedDraftRevision:f.state.draft.revision,committedRecordRevision:f.state.row.revision,
      historicalTargetRevision:pin.target.revision,historicalTargetBodySha256:pin.target.bodySha256,
      extractionAdapterCalls:f.state.byteReads,originalHistoryUnchanged:true,privateHistoricalEvidence:historical,
      storedHistory:f.state.history.get(2),publicCommit:committed,
      limits:'Retained native crop proof reused; no current HTTP/PostgreSQL/persistence or authentic property applicability.'
    },null,2)+'\n',{flag:'wx'});
    f.source.inspection.documentOriginal.subject='revoked-control-owner';
    await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies),status(403));
    await assert.rejects(()=>commitRegistryReviewTx(f.client,review.id,'',undefined,f.checker),status(403));
  }
}));

test('caller proof/frame/stale source/site/access/tamper and space refusal protect acceptance; revoked removal and clear stay usable',()=>local(async()=>{
  const f=fixture(),captured=await registryImageRegionAmendmentPreflightTx(f.client,f.state.draft.id,f.request,f.dependencies);assert(captured);
  assert(!RegistryDocumentAmendmentSchema.safeParse({...f.request,addImageRegion:{...f.request.addImageRegion,validation:{}}}).success);
  await assert.rejects(()=>prepareRegistryImageRegion({...f.request.addImageRegion!,region:{...f.request.addImageRegion!.region,
    frame:{...f.request.addImageRegion!.region.frame,width:257}}},captured.source,f.extract),status(409));
  const prepared=await f.prepare();f.sourceCase.revision++;
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared),status(409));
  f.sourceCase.revision--;f.sourceCase.site_id=randomUUID();
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared),status(403));f.sourceCase.site_id=f.siteId;
  f.state.events.length=0;let targets=0;f.state.onTargetRead=()=>{if(++targets===2)f.source.inspection.documentOriginal.subject='late-revoked';};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared),status(403));assert.equal(f.state.writes,0);
  f.state.onTargetRead=undefined;f.source.inspection.documentOriginal.subject=subject;
  await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies,prepared);
  const pin=f.state.draft.records[0].documentCitations![0];assert(pin.version==='registry-image-region-citation/1');
  const tampered={...f.state.draft.records[0],documentCitations:[{...pin,validation:{...pin.validation,
    transform:{...pin.validation.transform,sourceToOutput:[1,0,1,0,1,0] as [number,number,number,number,number,number]}}}]};
  await assert.rejects(()=>f.checker(f.client,f.siteId,tampered,true),status(409));
  f.state.latest=2;await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.dependencies),status(409));f.state.latest=1;
  f.source.inspection.documentOriginal.subject='revoked-control-owner';
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,f.request,f.dependencies),status(403));
  await assert.rejects(()=>persistRegistryReviewTx(f.client,f.snapshot(),f.review(),f.checker),status(403));
  const reads=f.state.byteReads;f.state.events.length=0;
  await amendRegistryDocumentCitationsTx(f.client,f.state.draft.id,{requestKey:randomUUID(),expectedDraftRevision:2,
    recordId:f.record.id,expectedRecordRevision:1,remove:[pin.id]},f.dependencies);
  assert.deepEqual(f.state.draft.records[0].documentCitations,[]);assert.equal(f.state.byteReads,reads);
  assert(!f.state.events.some(event=>event.sql.includes('FROM sources')&&event.args.includes(f.sourceId)));
  const clear=fixture();await amendRegistryDocumentCitationsTx(clear.client,clear.state.draft.id,clear.request,clear.dependencies,await clear.prepare());
  clear.source.inspection.documentOriginal.subject='revoked-control-owner';
  await amendRegistryDocumentCitationsTx(clear.client,clear.state.draft.id,{requestKey:randomUUID(),expectedDraftRevision:2,
    recordId:clear.record.id,expectedRecordRevision:1,clearAll:true},clear.dependencies);assert.deepEqual(clear.state.draft.records[0].documentCitations,[]);
  const space=fixture();(space.state.row as any).kind='space';(space.state.draft.records[0] as any).kind='space';
  await assert.rejects(()=>registryImageRegionAmendmentPreflightTx(space.client,space.state.draft.id,space.request,space.dependencies),status(422));
}));
