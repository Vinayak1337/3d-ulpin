import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {RegistryDocumentAmendmentSchema,type RegistryRecord} from '../packages/contracts/src';
import {DocumentPartSchema,DocumentResultSchema,type DocumentInput} from '../packages/contracts/src/usp/document-ingestion';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  assertCitationEdit,publicRegistryBody,publicRegistryDraft,publicRegistryReview,documentReviewContext,
  assertDocumentReviewContext} from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryDocumentSnapshotView} from '../packages/server/src/modules/usp/snapshots';
import {assertAssociationSnapshotTargetTx} from '../packages/server/src/modules/usp/ingestion/document-association-targets';
import {buildExchange,compareExchange} from '../packages/server/src/modules/usp/exchange';
import {CityJsonExportResultSchema} from '../apps/api/src/modules/evidence/evidence.schemas';
import {commitRegistryReviewTx,createRegistryDraftTx} from '../packages/server/src/modules/registry/registry';
import {associationDocumentInputTx} from '../packages/server/src/modules/usp/ingestion/document-association-authority';
import {documentInput} from '../packages/server/src/modules/usp/ingestion/document-context';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';

// Memory-only technical protocol controls. These are neither persisted property
// records nor a positive operational source/target example, accuracy label or geometry qualification.
const subject='registry-document-technical-control',digest='a'.repeat(64);
async function attributed(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
function fixture(){
  const siteId=randomUUID(),sourceId=randomUUID(),caseId=randomUUID(),jobId=randomUUID(),draftId=randomUUID();
  const input:DocumentInput={version:'source-document/1',jobId,caseId,caseRevision:1,caseContextSha256:digest,
    sourceId,familyId:sourceId,sourceRevision:1,sourceSha256:digest,sourceBytes:1,objectKey:'technical-control',
    subject,accessSha256:digest,policyVersion:'source-document-native/1',readerSha256:digest,
    gatewayPolicySha256:null,layoutCap:null,mode:'native_only'};
  const text='Technical native literal 0049';
  const part=DocumentPartSchema.parse({id:randomUUID(),sourceId,sourceRevision:1,sourceSha256:digest,
    text,sha256:sha256(text),locator:{label:'Technical paragraph',paragraph:1,characterStart:0,characterEnd:text.length},method:'native_text'});
  const result=DocumentResultSchema.parse({version:'source-document/1',input,
    native:{status:'extracted',format:'docx',readerSha256:digest,code:null,warnings:[],parts:[part]},
    model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},createdAt:'2026-09-30T00:00:00Z'});
  const document={caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:digest,jobId,resultSha256:digest};
  const body={alias:'Technical control',name:'Technical control',kind:'building' as const,
    footprint:[[0,0],[1,0],[1,1],[0,1]] as [number,number][],links:[],rights:[],evidence:[],synthetic:true};
  const record:RegistryRecord={...body,id:randomUUID(),siteId,identifier:'technical-reference',revision:1};
  const state={draft:{id:draftId,site_id:siteId,case_id:randomUUID(),status:'draft',revision:1,records:[structuredClone(record)],created_at:'2026-09-30T00:00:00Z'},
    row:{id:record.id,site_id:siteId,kind:record.kind,revision:1,body:structuredClone(body)},fence:1,
    operations:new Map<string,any>(),history:new Map<number,any>([[1,structuredClone(body)]]),writes:0,reads:0,sourceChecks:0};
  const client={query:async(sql:string,args:any[]=[])=>{
    let rows:any[]=[];
    if(sql.includes('SELECT site_id FROM registry_drafts'))rows=[{site_id:siteId}];
    else if(sql.includes('SELECT * FROM registry_drafts'))rows=[structuredClone(state.draft)];
    else if(sql.includes('FROM registry_sites'))rows=[{id:siteId}];
    else if(sql.includes('CASE WHEN r.revision'))rows=[{site_id:siteId,kind:record.kind,
      body:structuredClone(args[1]===state.row.revision?state.row.body:state.history.get(args[1]))}];
    else if(sql.includes('FROM registry_records'))rows=[structuredClone(state.row)];
    else if(sql.includes('SELECT accepted_fence'))rows=[{accepted_fence:state.fence}];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.startsWith('UPDATE registry_drafts SET records')){state.draft.records=JSON.parse(args[1]);state.draft.revision++;state.writes++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else throw new Error('Unexpected technical SQL: '+sql);
    return {rows,rowCount:rows.length};
  }} as unknown as PoolClient;
  const dependencies={source:async()=>{state.sourceChecks++;return input;},
    result:async()=>{state.reads++;return structuredClone(result);},
    registrySource:async()=>({revision:1,sha256:digest,accessSha256:digest}) as any};
  const request={requestKey:randomUUID(),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,add:{document,partIds:[part.id]},remove:[]};
  return {siteId,record,body,state,client,dependencies,request,input,result,part,draftId};
}
const status=(code:number)=>(error:any)=>error.status===code;

test('amendment selection accepts only bounded exact IDs and server-derived citation data',()=>{
  const f=fixture();assert(RegistryDocumentAmendmentSchema.safeParse(f.request).success);
  for(const request of [{...f.request,text:'caller text'},
    {...f.request,clearAll:true},
    {...f.request,add:undefined,clearAll:true,remove:[digest]},
    {...f.request,add:undefined,clearAll:false},
    {...f.request,add:{...f.request.add,partIds:[f.part.id,f.part.id]}},
    {...f.request,add:{...f.request.add,partIds:Array.from({length:26},()=>randomUUID())}},
    {...f.request,add:undefined,remove:[]}])assert(!RegistryDocumentAmendmentSchema.safeParse(request).success);
  assert(RegistryDocumentAmendmentSchema.safeParse({...f.request,add:undefined,clearAll:true}).success);
});
test('canonical amendment preserves other bytes, derives exact pins, deduplicates and fences replay/stale submissions',()=>attributed(async()=>{
  const f=fixture();
  const receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  assert.equal(receipt.draftRevision,2);assert.equal(f.state.writes,1);
  const changed=f.state.draft.records[0];
  assert.deepEqual(publicRegistryBody(changed),f.record);
  const pin=changed.documentCitations![0];
  assert.equal(pin.partSha256,f.part.sha256);assert.deepEqual(pin.locator,f.part.locator);assert.equal(pin.acceptedFence,1);
  assert.equal(pin.selection.subject,subject);assert(!('text' in pin));
  assert.equal(JSON.stringify(pin).includes(f.part.text),false);
  assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),receipt);
  assert.equal(f.state.writes,1);
  const duplicate=await amendRegistryDocumentCitationsTx(f.client,f.draftId,{...f.request,requestKey:randomUUID(),expectedDraftRevision:2},f.dependencies);
  assert.equal(duplicate.changed,false);assert.equal(f.state.writes,1);
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,{...f.request,requestKey:randomUUID()},f.dependencies),status(409));
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,{...f.request,add:{...f.request.add,partIds:[randomUUID()]}},f.dependencies),status(409));
  f.state.draft.revision=3;
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies),status(409));
  assert.equal(f.state.writes,1);
}));
test('source/site/part/attempt and target changes prevent writes, including revocation during object I/O',()=>attributed(async()=>{
  for(const scenario of ['site','part','marker','source-after-read','target-after-read','body-after-read','fence-after-read','retired']){
    const f=fixture();let checks=0;
    const dependencies={...f.dependencies,
      registrySource:async()=>{if(scenario==='site')throw new AppError(403,'REGISTRY_SOURCE_DENIED','Denied');return f.dependencies.registrySource();},
      source:async()=>{if(scenario==='source-after-read'&&++checks>1)throw new AppError(403,'DOCUMENT_DENIED','Revoked');return f.input;},
      result:async()=>{
        f.state.reads++;
        if(scenario==='target-after-read')f.state.row.revision=2;
        if(scenario==='body-after-read')f.state.row.body.name='Changed';
        if(scenario==='retired')(f.state.row as any).project_status='retired';
        if(scenario==='fence-after-read')f.state.fence=2;
        if(scenario==='marker')return {...f.result,native:{...f.result.native,parts:[{...f.part,text:'[redacted]',sha256:sha256('[redacted]')}]}};
        return f.result;
      }};
    const request=scenario==='part'?{...f.request,add:{...f.request.add,partIds:[randomUUID()]}}:f.request;
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,f.draftId,request,dependencies));
    assert.equal(f.state.writes,0,scenario);if(scenario==='site')assert.equal(f.state.reads,0);
  }
}));
test('extracted source authority uses actual canonical source/input/accepted-result helpers, with no independent transaction',()=>attributed(async()=>{
  const f=fixture(),binding=ingestionBinding(f.input.caseId);
  const current={id:f.input.caseId,revision:1,archived:false,frame:null,context:null,site_id:f.siteId};
  const source={id:f.input.sourceId,case_id:current.id,family_id:f.input.sourceId,revision:1,sha256:digest,bytes:1,
    object_key:'technical-control',inspection:{documentOriginal:{version:'source-document/1',subject,format:'docx',
      sha256:digest,bytes:1,receivedAt:'2026-09-30T00:00:00Z'}}};
  const input=documentInput({current,source,binding,context:fingerprint({frame:null,context:null,siteId:f.siteId}),latest:true},f.input.jobId,'native_only');
  const pin={...f.request.add.document};let acceptedHash=digest;
  const sqlCalls:string[]=[];
  const client={query:async(sql:string)=>{
    sqlCalls.push(sql);
    if(sql.includes('FROM cases'))return {rows:[current]};
    if(sql.includes('max(revision)'))return {rows:[{revision:1}]};
    if(sql.includes('FROM sources'))return {rows:[source]};
    if(sql.includes('JOIN usp_job_metadata'))return {rows:[{status:'succeeded',logical_state:'succeeded',payload:input,
      input_sha256:fingerprint(input),result_ref:{sha256:acceptedHash},completion_sha256:acceptedHash}]};
    if(sql.includes('FROM jobs'))return {rows:[{payload:input,input_fingerprint:fingerprint(input)}]};
    return {rows:[{job_id:input.jobId}]};
  }} as unknown as PoolClient;
  assert.deepEqual(await associationDocumentInputTx(client,localRequestContext(randomUUID()),pin,undefined,true),input);
  for(const table of ['jobs','sources','usp_job_metadata','usp_job_attempts'])
    assert(sqlCalls.some(sql=>sql.includes(`FROM ${table} WHERE`)&&sql.includes('FOR SHARE')),table);
  assert(sqlCalls.some(sql=>sql.includes('FROM cases')&&sql.includes('FOR UPDATE')));
  current.archived=true;
  await assert.rejects(()=>associationDocumentInputTx(client,localRequestContext(randomUUID()),pin),status(403));
  current.archived=false;source.inspection.documentOriginal.subject='wrong-subject';
  await assert.rejects(()=>associationDocumentInputTx(client,localRequestContext(randomUUID()),pin),status(403));
  source.inspection.documentOriginal.subject=subject;acceptedHash='b'.repeat(64);
  await assert.rejects(()=>associationDocumentInputTx(client,localRequestContext(randomUUID()),pin),status(409));
}));
test('private read rechecks authority; exact locator/hash drift and wrong subject cannot be served; removal recovers from revoked source',()=>attributed(async()=>{
  const f=fixture();await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const read=await readRegistryDocumentCitationsTx(f.client,f.draftId,f.dependencies);
  assert.deepEqual(read.citations[0].part,f.part);
  // The snapshot phase of canonical review is READ ONLY; it is validated again
  // with locks before review persistence, so this phase must not request locks.
  await assertRegistryDocumentCitationsTx(f.client,f.siteId,f.state.draft.records[0],false,{...f.dependencies,
    source:async(_client:PoolClient,_ctx:unknown,_pin:unknown,_expected?:DocumentInput,lock=false)=>{
      assert.equal(lock,false);return f.input;
    }});
  let reads=0;
  const revoked={...f.dependencies,source:async()=>{throw new AppError(403,'DOCUMENT_DENIED','Revoked');},result:async()=>{reads++;return f.result;}};
  await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,revoked),status(403));assert.equal(reads,0);
  let calls=0;
  await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,f.draftId,{...f.dependencies,source:async()=>{
    if(++calls>1)throw new AppError(403,'DOCUMENT_DENIED','Revoked');return f.input;}}),status(403));
  const record=f.state.draft.records[0],pin=record.documentCitations![0];
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(f.client,f.siteId,{...record,documentCitations:[{...pin,locator:{...pin.locator,label:'Changed'}}]},false,f.dependencies),status(409));
  await assert.rejects(()=>assertRegistryDocumentCitationsTx(f.client,f.siteId,{...record,documentCitations:[{...pin,selection:{...pin.selection,subject:'different-subject'}}]},false,f.dependencies),status(403));
  assert.throws(()=>assertCitationEdit(record,{documentCitations:[]}));assert.doesNotThrow(()=>assertCitationEdit(record,{}));
  const receipt=await amendRegistryDocumentCitationsTx(f.client,f.draftId,{requestKey:randomUUID(),expectedDraftRevision:2,
    recordId:f.record.id,expectedRecordRevision:1,remove:[pin.id]},revoked);
  assert.equal(receipt.draftRevision,3);assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
}));
test('fresh clients can open/reuse an unavailable citation correction and explicitly clear it from the exposed response',()=>attributed(async()=>{
  for(const unavailable of [403,409]){
    const f=fixture();await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
    const pin=f.state.draft.records[0].documentCitations![0];
    const recordedBody={...f.body,documentCitations:[structuredClone(pin)]},savedBody=structuredClone(recordedBody);
    const savedHistory=structuredClone(f.state.history.get(1)),savedOriginalResult=structuredClone(f.result);
    f.state.row.revision=2;f.state.row.body=recordedBody as typeof f.state.row.body;
    f.state.draft.status='recorded';
    const oldDraft=structuredClone(f.state.draft),key=randomUUID();let created=false;
    const client={query:async(sql:string,args:any[]=[])=>{
      if(sql.includes('SELECT * FROM registry_sites'))return {rows:[{id:f.siteId,identifier:'technical-site',revision:2,
        frame:{id:'technical-control',horizontalUnit:'m',verticalUnit:'m',benchmark:'technical-control'},synthetic:true}]};
      if(sql.includes('SELECT * FROM registry_records'))return {rows:[{...structuredClone(f.state.row),identifier:f.record.identifier}]};
      if(sql.includes('SELECT * FROM registry_drafts WHERE site_id'))
        return {rows:created && (!sql.includes('request_key')||args[1]===key)?[structuredClone(f.state.draft)]:[]};
      if(sql.startsWith('INSERT INTO cases'))return {rows:[]};
      if(sql.startsWith('INSERT INTO registry_drafts')){
        f.state.draft={id:args[0],site_id:args[1],case_id:args[2],records:JSON.parse(args[3]),revision:1,status:'draft',created_at:'2026-09-30T00:00:00Z'};
        created=true;return {rows:[structuredClone(f.state.draft)]};
      }
      return f.client.query(sql,args);
    }} as unknown as PoolClient;
    let reads=0,sourceChecks=0;
    const denied={...f.dependencies,source:async()=>{sourceChecks++;throw new AppError(unavailable,'DOCUMENT_UNAVAILABLE','Unavailable');},
      result:async()=>{reads++;return f.result;}};
    const fresh=await createRegistryDraftTx(client,f.siteId,f.record.id,undefined,key);
    assert.equal(fresh.status,'draft');assert.equal(fresh.records[0].revision,2);
    assert.equal(Object.hasOwn(fresh.records[0],'documentCitations'),false);
    assert.deepEqual(f.state.draft.records[0].documentCitations,[pin]);
    assert.deepEqual(await createRegistryDraftTx(client,f.siteId,f.record.id,undefined,key),fresh);
    assert.deepEqual(await createRegistryDraftTx(client,f.siteId,f.record.id),fresh);
    assert.equal(reads,0);assert.equal(sourceChecks,0);
    await assert.rejects(()=>readRegistryDocumentCitationsTx(client,fresh.id,denied),status(unavailable));
    await assert.rejects(()=>assertRegistryDocumentCitationsTx(client,f.siteId,f.state.draft.records[0],false,denied),status(unavailable));
    assert.throws(()=>assertCitationEdit(f.state.draft.records[0],{documentCitations:[]}));
    // This request uses only the actual public response, without inaccessible
    // citation IDs, source locators or any previously resolved document text.
    const clear={requestKey:randomUUID(),expectedDraftRevision:fresh.revision,
      recordId:fresh.records[0].id,expectedRecordRevision:fresh.records[0].revision,clearAll:true};
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(client,fresh.id,
      {...clear,expectedDraftRevision:fresh.revision+1},denied),status(409));
    assert.deepEqual(f.state.draft.records[0].documentCitations,[pin]);
    const removal=await amendRegistryDocumentCitationsTx(client,fresh.id,clear,denied);
    assert.equal(removal.draftRevision,2);assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
    assert.deepEqual(await amendRegistryDocumentCitationsTx(client,fresh.id,clear,denied),removal);
    assert.equal((await readRegistryDocumentCitationsTx(client,fresh.id,denied)).citations.length,0);
    assert.equal(reads,0);
    assert.deepEqual(f.state.row.body,savedBody);assert.deepEqual(f.state.history.get(1),savedHistory);
    assert.deepEqual(oldDraft.records[0].documentCitations,[pin]);assert.deepEqual(f.result,savedOriginalResult);
    await assert.rejects(()=>amendRegistryDocumentCitationsTx(client,fresh.id,{...f.request,requestKey:randomUUID(),
      expectedDraftRevision:2,expectedRecordRevision:2},denied),status(unavailable));
    assert.deepEqual(f.state.draft.records[0].documentCitations,[]);
  }
}));

test('private aggregate read rejects A revoked during B I/O and final checks run under all authority locks',()=>attributed(async()=>{
  const a=fixture(),b=fixture();let revoked=false,rechecksAfterRevocation=0;
  const events:{kind:string;sourceId:string;locked?:boolean}[]=[];
  const dependencies={...a.dependencies,
    source:async(_client:PoolClient,_ctx:unknown,pin:any,expected?:DocumentInput,lock=false)=>{
      events.push({kind:'authority',sourceId:pin.sourceId,locked:lock});
      if(revoked&&pin.sourceId===a.input.sourceId){
        rechecksAfterRevocation++;throw new AppError(403,'DOCUMENT_DENIED','A revoked during B I/O');
      }
      const input=pin.sourceId===a.input.sourceId?a.input:b.input;
      if(expected)assert.deepEqual(input,expected);
      return input;
    },
    result:async(input:DocumentInput)=>{
      events.push({kind:'result',sourceId:input.sourceId});
      if(input.sourceId===b.input.sourceId){if(revokeOnB)revoked=true;return structuredClone(b.result);}
      return structuredClone(a.result);
    }};
  let revokeOnB=false;
  await amendRegistryDocumentCitationsTx(a.client,a.draftId,a.request,dependencies);
  await amendRegistryDocumentCitationsTx(a.client,a.draftId,{...a.request,requestKey:randomUUID(),expectedDraftRevision:2,
    add:b.request.add},dependencies);
  events.length=0;
  const available=await readRegistryDocumentCitationsTx(a.client,a.draftId,dependencies);
  assert.equal(available.citations.length,2);
  const lastObjectRead=events.map(event=>event.kind).lastIndexOf('result');
  const finalEvents=events.slice(lastObjectRead+1),lockedSources=new Set<string>();
  for(const event of finalEvents){
    assert.notEqual(event.kind,'result');
    if(event.locked)lockedSources.add(event.sourceId);
    // Initial per-group rechecks may precede aggregate locks; the final pass
    // must revisit both groups after all locks have been acquired.
  }
  assert.deepEqual(lockedSources,new Set([a.input.sourceId,b.input.sourceId]));
  const lastLock=finalEvents.map(event=>!!event.locked).lastIndexOf(true);
  assert.deepEqual(new Set(finalEvents.slice(lastLock+1).map(event=>event.sourceId)),lockedSources);
  events.length=0;revokeOnB=true;
  await assert.rejects(()=>readRegistryDocumentCitationsTx(a.client,a.draftId,dependencies),status(403));
  assert.equal(rechecksAfterRevocation,1);
  assert.deepEqual(events.filter(event=>event.kind==='result').map(event=>event.sourceId),[a.input.sourceId,b.input.sourceId]);
  assert.equal(a.state.writes,2);
}));
test('generic registry/snapshot/exchange projections omit citations while immutable raw/hash and internal exact target checks stay intact',()=>attributed(async()=>{
  const f=fixture();await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const record=f.state.draft.records[0],raw={id:record.id,site_id:f.siteId,kind:record.kind,identifier:record.identifier,revision:1,
    body:{...f.body,synthetic:false,documentCitations:record.documentCitations},projectIdentity:null};
  const digest=fingerprint(raw),saved=structuredClone(raw),view=registryDocumentSnapshotView(raw);
  assert(!('documentCitations' in view.body));assert.deepEqual(raw,saved);assert.equal(fingerprint(raw),digest);
  assert(!('documentCitations' in publicRegistryDraft({records:[record]}).records[0]));
  assert(!('documentCitations' in publicRegistryReview({records:[record],before:[record]}).before[0]));
  const scope={kind:'snapshot' as const,scopeId:f.siteId,world:{namespace:'world',id:'technical-control'},manifestId:randomUUID() as any,
    snapshotDigest:'a'.repeat(64),stage:'recorded' as const};
  const pin={ref:{namespace:'registry_record' as const,id:record.id},revision:1};
  const client={query:async()=>({rows:[{body:raw,body_sha256:digest}]})} as unknown as PoolClient;
  await assertAssociationSnapshotTargetTx(client,scope,pin,raw);
  await assert.rejects(()=>assertAssociationSnapshotTargetTx(client,scope,pin,{...raw,body:{...raw.body,name:'Changed'}}),status(409));
  await assert.rejects(()=>assertAssociationSnapshotTargetTx(client,scope,pin,{...raw,body:{...raw.body,documentCitations:[]}}),status(409));
  const exchange=buildExchange({scope,frame:{horizontal:'EPSG:32643',vertical:'technical-control',unit:'m'},licenceFamily:null,
    records:[{id:record.id,pin,bodySha256:digest,body:raw,sourceIds:[f.input.sourceId],licenceFamily:null}],
    sources:[{id:f.input.sourceId,revision:1,sha256:'a'.repeat(64),licenceFamily:null,bodySha256:'a'.repeat(64),metadata:{issuer:null}}]});
  assert.equal(Object.hasOwn(exchange.sidecar.records[0].body.body,'documentCitations'),false);
  assert.deepEqual(exchange.sidecar.omissions,[{field:'documentCitations',category:'omitted_by_profile',
    reason:'Private document citation pins are excluded from this general exchange profile.'}]);
  assert.equal(JSON.stringify(exchange).includes(record.documentCitations![0].id),false);
  assert.equal(JSON.stringify(exchange).includes(record.documentCitations![0].locator.label),false);
  assert.equal(exchange.sidecar.records[0].bodySha256,digest);
  assert.equal(exchange.sidecar.records[0].bodyProjection.sha256,fingerprint(view));
  assert.doesNotThrow(()=>CityJsonExportResultSchema.parse(exchange));
  const roundTrip=compareExchange(exchange,exchange.cityJson,exchange.sidecar);
  const changedOmission=compareExchange(exchange,exchange.cityJson,{...exchange.sidecar,omissions:[]});
  assert.equal(roundTrip.comparisons.some(item=>item.field==='sidecar.omissions'&&item.category==='conflict'),false);
  assert.equal(roundTrip.comparisons.some(item=>item.field==='documentCitations'&&item.category==='omitted_by_profile'),true);
  assert.equal(changedOmission.comparisons.some(item=>item.field==='sidecar.omissions'&&item.category==='conflict'),true);
  assert.deepEqual(raw,saved);
  const review={records:[record],documentReviewContext:documentReviewContext()};
  assert.doesNotThrow(()=>assertDocumentReviewContext(review));
  assert.throws(()=>assertDocumentReviewContext({...review,documentReviewContext:{...review.documentReviewContext,subject:'revoked'}}),status(403));
  assert.throws(()=>assertDocumentReviewContext({records:[record]}),status(403));
}));
test('actual canonical commit rejects stale draft or server review context before any registry write',()=>attributed(async()=>{
  const f=fixture();await amendRegistryDocumentCitationsTx(f.client,f.draftId,f.request,f.dependencies);
  const review={id:randomUUID(),draftId:f.draftId,draftRevision:2,siteRevision:1,records:f.state.draft.records,
    before:[f.record],findings:[],inputFingerprint:digest,committed:false,documentReviewContext:documentReviewContext()};
  let writes=0;
  const client={query:async(sql:string)=>{
    if(sql.startsWith('UPDATE')||sql.startsWith('INSERT')){writes++;throw new Error('Unexpected write');}
    if(sql.includes('registry_reviews'))return {rows:[{draft_id:f.draftId,body:review,committed:false}]};
    if(sql.includes('registry_drafts'))return {rows:[{...f.state.draft,revision:3}]};
    if(sql.includes('registry_sites'))return {rows:[{id:f.siteId,revision:1,frame:{id:'technical-control'},synthetic:true}]};
    return {rows:[]};
  }} as unknown as PoolClient;
  await assert.rejects(()=>commitRegistryReviewTx(client,review.id,''),status(409));assert.equal(writes,0);
  review.documentReviewContext.subject='wrong-subject';
  await assert.rejects(()=>commitRegistryReviewTx(client,review.id,''),status(403));assert.equal(writes,0);
}));
