import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import type {RegistryRecord,RegistryDraft,RegistrySite,RegistryReview} from '../packages/contracts/src/registry';
import {DocumentOriginalSchema,DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {RegistryDocumentAmendmentSchema,RegistryNativeDocumentCitationSchema,RegistryDocumentEvidenceSchema}
  from '../packages/contracts/src/registry-document-evidence';
import {amendRegistryDocumentCitationsTx,readRegistryDocumentCitationsTx,assertRegistryDocumentCitationsTx,
  documentReviewContext,publicRegistryBody,citationId,type RegistryDocumentDependencies}
  from '../packages/server/src/modules/registry/registry-document-evidence';
import {registryDocumentSourceAccessTx,registrySourceTx} from '../packages/server/src/modules/registry/registry-metadata';
import {persistRegistryReviewTx} from '../packages/server/src/modules/registry/registry';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {documentInput} from '../packages/server/src/modules/usp/ingestion/document-context';
import {associationDocumentInputTx} from '../packages/server/src/modules/usp/ingestion/document-association-authority';
import {extractSourceDocument} from '../packages/server/src/modules/usp/ingestion/document-native';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {fusionSourceProjection,fusionContextProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';
import {associationLiterals} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Original reports and actual retained producer stdout are unchanged. New
// input/result/attempt envelopes, site/target/footprint/review and SQL/storage
// are technical controls, not live records or Cape May point correspondence.
const originals='E:/BhuAayam-data/task-data/desktop-survey-control-source-20261003/originals';
const producer={
  nva:{path:'E:/BhuAayam-data/task-data/survey-context-runtime-20261004-run02/d8c2957b-ec64-46e1-be2c-94f596d65fbd.stdout',
    bytes:81105,sha256:'da03e66576e75e72b17b41c5a10667d2a544979399ee200063a04daadf609906'},
  pid:{path:'E:/BhuAayam-data/task-data/survey-context-runtime-20261004-run01/fb4966b9-9078-41f1-aa10-99142e418e6f.stdout',
    bytes:11922,sha256:'5dd9c2389dc08f5c8ae531f98ba599c5f31bafe280d8bc8d4cec54b12e6dc18d'},
};
const present=(['nva','pid'] as const).every(kind=>existsSync(producer[kind].path)&&existsSync(`${originals}/20250722_capemay_${kind}_report.txt`));
const options={skip:present?false:'Retained reports/producer stdout unavailable; no replacement source is generated.'};
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,siteId=id(10),draftId=id(20),time='2026-10-04T00:00:00.000Z';
async function local(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-survey-protocol-control';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
async function report(kind:'nva'|'pid',n:number){
  const manifest=JSON.parse(readFileSync('docs/evidence/usp/survey-control-source/manifest.json','utf8')),
    original=manifest.originals.find((v:any)=>v.id===`${kind}-table`),raw=readFileSync(original.pin.path),stdout=readFileSync(producer[kind].path);
  assert.equal(raw.length,original.pin.bytes);assert.equal(sha256(raw),original.pin.sha256);
  assert.equal(stdout.length,producer[kind].bytes);assert.equal(sha256(stdout),producer[kind].sha256);
  const current={id:id(n),revision:1,archived:false,frame:null,
    context:{sourceFamily:manifest.sourceFamily,classification:'test_only'},site_id:siteId},binding=ingestionBinding(current.id),
    source={id:id(n+100),case_id:current.id,family_id:id(n+100),revision:1,status:'ready',sha256:sha256(raw),bytes:raw.length,
      object_key:`controlled-survey/${id(n+100)}/${sha256(raw)}`,inspection:{documentOriginal:DocumentOriginalSchema.parse({
        version:'source-document/1',subject:binding.subject,format:'text',sha256:sha256(raw),bytes:raw.length,receivedAt:time}),
        documentAccepted:{jobId:id(n+200),sha256:''}}},
    input=documentInput({current,source,binding,latest:true,context:fingerprint({frame:null,context:current.context,siteId})},id(n+200),'native_only'),
    native=await extractSourceDocument(input,raw,async(value:any)=>{
      assert.equal(value.format,'text');assert.deepEqual(Buffer.from(value.base64,'base64'),raw);
      return JSON.parse(stdout.toString('utf8'));
    }),result=DocumentResultSchema.parse({version:'source-document/1',input,native,
      model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},createdAt:time}),
    bytes=Buffer.from(JSON.stringify(result)),pin={caseId:input.caseId,caseRevision:1,sourceId:input.sourceId,sourceRevision:1,
      sourceSha256:input.sourceSha256,jobId:input.jobId,resultSha256:sha256(bytes),readerSha256:input.readerSha256,
      inputSha256:fingerprint(input),acceptedFence:1,resultBytes:bytes.length};
  source.inspection.documentAccepted.sha256=pin.resultSha256;
  const job={payload:input,input_fingerprint:pin.inputSha256,input_sha256:pin.inputSha256,status:'succeeded',logical_state:'succeeded',
    result_ref:{assetId:`document:${input.jobId}`,version:1,sha256:pin.resultSha256},completion_sha256:pin.resultSha256,accepted_fence:1};
  return {kind,raw,source,current,input,result,bytes,pin,job,original};
}
async function fixture(){
  const [nva,pid]=await Promise.all([report('nva',1),report('pid',2)]),reports=[nva,pid],
    survey={kind:'survey_report' as const,pin:nva.pin,rowOrdinals:[164]},doc={kind:'document' as const,pin:pid.pin,partIds:[] as string[]},
    context=fusionContextProjection([fusionSourceProjection(survey,{kind:'document',result:nva.result}),fusionSourceProjection(doc,{kind:'document',result:pid.result})]),
    record:RegistryRecord={id:id(11),siteId,identifier:'controlled-recorded-target',revision:1,alias:'Protocol target',name:'Protocol target',kind:'building',
      footprint:[[0,0],[1,0],[1,1],[0,1]],links:[],rights:[],evidence:[{sourceId:id(12),locator:'controlled prior recording evidence'}],synthetic:true},
    {id:_,siteId:__,identifier:___,revision:____,...body}=record,
    part=pid.result.native.parts.find(p=>p.locator.line===83)!;
  const prior=RegistryNativeDocumentCitationSchema.parse({version:'registry-document-citation/1',id:'0'.repeat(64),
    document:{caseId:pid.pin.caseId,caseRevision:1,sourceId:pid.pin.sourceId,sourceRevision:1,sourceSha256:pid.pin.sourceSha256,
      jobId:pid.pin.jobId,resultSha256:pid.pin.resultSha256},inputSha256:pid.pin.inputSha256,readerSha256:pid.pin.readerSha256,acceptedFence:1,
    partId:part.id,partSha256:part.sha256,locator:part.locator,target:{recordId:record.id,revision:1,bodySha256:fingerprint(body)},
    selection:{subject:pid.input.subject,accessSha256:pid.input.accessSha256,selectedAt:time},associationState:'operator_selected',qualification:'not_assessed'});
  prior.id=citationId(prior);
  const state={draft:{id:draftId,site_id:siteId,case_id:id(21),records:[{...record,documentCitations:[prior]}],revision:1,status:'draft',created_at:time},
    row:{id:record.id,site_id:siteId,identifier:record.identifier,kind:record.kind,revision:1,body:structuredClone(body)},
    site:{id:siteId,identifier:'protocol-site',name:'Protocol site',revision:1,
      frame:{id:'controlled-frame-only',horizontalUnit:'m' as const,verticalUnit:'m' as const,benchmark:'protocol-only'},synthetic:true},
    operations:new Map<string,any>(),draftWrites:0,reviewWrites:0,reads:[] as string[],calls:[] as {sql:string;args:any[]}[],
    revokeDuringRead:false,review:undefined as RegistryReview|undefined};
  const bySource=new Map(reports.map(f=>[f.source.id,f])),byCase=new Map(reports.map(f=>[f.current.id,f])),byJob=new Map(reports.map(f=>[f.input.jobId,f])),
    objects=new Map(reports.map(f=>[documentResultKey(f.input.jobId,f.pin.resultSha256),f.bytes]));
  const ordinary={id:id(12),case_id:id(21),family_id:id(12),revision:1,status:'ready',name:'Controlled prior recording evidence',
    sha256:sha256('memory-only protocol source'),bytes:Buffer.byteLength('memory-only protocol source'),profile:'protocol-only',mime_type:'text/plain',object_key:'protocol-only',
    created_at:time,inspection:{}};
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push({sql,args});let rows:any[]=[];
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources')||
      sql.startsWith('SELECT job_id FROM usp_job_')||sql.includes('FROM building_preparations'))rows=[];
    else if(sql.includes('FROM registry_drafts'))rows=[state.draft];
    else if(sql.includes('FROM registry_sites'))rows=[state.site];
    else if(sql.includes('CASE WHEN r.revision'))rows=[{site_id:siteId,kind:record.kind,body:state.row.body}];
    else if(sql.includes('FROM registry_records'))rows=[state.row];
    else if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))rows=[byCase.get(args[0])!.current];
    else if(sql.startsWith('SELECT archived FROM cases'))rows=[byCase.get(args[0])!.current];
    else if(sql.includes('SELECT max(revision)'))rows=[{revision:byCase.get(args[0])!.source.revision}];
    else if(sql.includes('FROM sources s JOIN cases')){
      if(args[0]===ordinary.id)rows=[{...ordinary,source_site_id:siteId,source_archived:false}];
      else{const f=bySource.get(args[0])!;rows=[{...f.source,source_site_id:f.current.site_id,source_archived:f.current.archived,
        case_revision:f.current.revision,case_context:f.current.context,case_frame:f.current.frame}];}
    }else if(sql.startsWith('SELECT * FROM sources'))rows=[(args[1]??args[0])===ordinary.id?ordinary:bySource.get(args[1]??args[0])!.source];
    else if(sql.startsWith('SELECT accepted_fence'))rows=[{accepted_fence:byJob.get(args[0])!.job.accepted_fence}];
    else if(sql.includes('FROM jobs'))rows=[byJob.get(args[0])!.job];
    else if(sql.includes('SELECT payload_hash,result FROM operations'))rows=state.operations.has(args[1])?[state.operations.get(args[1])]:[];
    else if(sql.startsWith('UPDATE registry_drafts SET records')){state.draft.records=JSON.parse(args[1]);state.draft.revision++;state.draftWrites++;}
    else if(sql.startsWith('INSERT INTO operations'))state.operations.set(args[1],{payload_hash:args[2],result:args[3]});
    else if(sql.startsWith('INSERT INTO registry_reviews')){state.review=structuredClone(args[2]);state.reviewWrites++;}
    else assert.fail('Unexpected protocol SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient;
  const dependencies:RegistryDocumentDependencies={source:associationDocumentInputTx,citationSource:registryDocumentSourceAccessTx,registrySource:registrySourceTx,
    result:async(input,hash)=>{const f=byJob.get(input.jobId)!;assert.equal(hash,f.pin.resultSha256);assert.equal(fingerprint(input),f.pin.inputSha256);return f.result;},
    fusionResult:(selected,authority,budget)=>readFusionResult(selected,authority,budget,
      (key,size,hash,bounds)=>readFusionObject(key,size,hash,bounds,async(_key,_size,timeout,_etag,signal)=>{
        assert.equal(_key,key);assert.equal(_size,size);assert(timeout>0);assert(signal);const bytes=objects.get(key);assert(bytes);
        state.reads.push(key);if(state.revokeDuringRead&&selected.kind==='survey_report')nva.current.archived=true;
        return {body:Readable.from([bytes]),etag:'controlled-retained-stream'};
      }))};
  const request={requestKey:id(30),expectedDraftRevision:1,recordId:record.id,expectedRecordRevision:1,
    addFusion:{contextSha256:context.contextSha256,selection:{sources:[survey,doc]}}};
  return {client,dependencies,state,record,body,nva,pid,prior,context,request,survey};
}
function review(f:Awaited<ReturnType<typeof fixture>>){
  const records=structuredClone(f.state.draft.records),access=documentReviewContext(),
    d:RegistryDraft={id:draftId,siteId,caseId:f.state.draft.case_id,records,revision:f.state.draft.revision,status:'draft',createdAt:time},
    site=f.state.site as unknown as RegistrySite,
    body:RegistryReview={id:id(40),draftId,draftRevision:d.revision,siteRevision:1,records,before:[f.record],findings:[],committed:false,
      documentReviewContext:access,inputFingerprint:fingerprint({validatorVersion:'registry-relationships-v2',records,frame:site.frame,
        draftRevision:d.revision,siteRevision:1,documentReviewContext:access})};
  return {snapshot:{d,site,combined:records},body};
}
function save(name:string,value:unknown){const dir=process.env.ULPIN_SURVEY_LINK_PROOF_DIR;if(!dir)return;
  mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/${name}`,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('retained excluded survey row preserves typed reference, prior citation, exact mixed hash, private read, replay and canonical review',options,()=>local(async()=>{
  const f=await fixture();assert(RegistryDocumentAmendmentSchema.safeParse(f.request).success);
  const hash=f.request.addFusion.contextSha256,receipt=await amendRegistryDocumentCitationsTx(f.client,draftId,f.request,f.dependencies),
    record=f.state.draft.records[0],pin=record.documentCitations![1];assert(pin.version==='registry-survey-row-citation/1');
  assert.equal(receipt.draftRevision,2);assert.equal(f.state.draftWrites,1);assert.equal(f.state.operations.size,1);
  assert.deepEqual(record.documentCitations![0],f.prior);assert.deepEqual(f.state.row.body,f.body);assert.deepEqual(publicRegistryBody(record),f.record);
  assert.equal(f.request.addFusion.contextSha256,hash);assert.equal(hash,f.context.contextSha256);assert.equal(f.context.sources.length,2);
  assert.equal(pin.id,citationId(pin));assert.equal(pin.survey.purpose,'source_reference_only');assert.equal(pin.survey.row.ordinal,164);
  assert.equal(pin.survey.row.pointIdentifier,'gs_240');assert.equal(pin.survey.row.enabled,false);assert.equal(pin.survey.row.statusLiteral,'Turned Off');
  assert.equal(pin.survey.row.fields[10].literal,'-----');assert.equal(pin.survey.row.fields[10].state,'unavailable');assert.equal(pin.survey.row.fields[10].value,null);
  assert.equal(pin.survey.row.fields[6].literal,'0.000');assert.equal(pin.survey.row.fields[6].value,0);
  assert.equal(pin.survey.row.quote.literal,f.nva.raw.toString('utf8').split(/\r\n|\n|\r/)[pin.survey.row.quote.citation.line-1]);
  assert.equal(pin.survey.qualification.coordinateFrame,'needs_input');assert.equal(pin.survey.qualification.objectCorrespondence,'needs_input');
  assert.equal(pin.survey.qualification.accuracy,'not_assessed');assert.equal(pin.survey.qualification.learningSplit,'not_assessed');
  assert.equal(pin.survey.horizontalUnits!.literal.trim(),'Horizontal Units:   meter');assert.equal(pin.survey.tableStatus,'complete');
  const evidence=await readRegistryDocumentCitationsTx(f.client,draftId,f.dependencies);assert(RegistryDocumentEvidenceSchema.safeParse(evidence).success);
  const entry=evidence.citations[1];assert('fragment' in entry&&entry.fragment.kind==='survey_report');
  assert.equal(entry.fragment.rows.length,1);assert.equal(entry.fragment.table.parsedRows,166);assert.equal(entry.fragment.coverage.unselectedParsedRows,165);
  assert.equal(fingerprint(entry.fragment),pin.survey.fragmentSha256);assert.equal(entry.fragment.rows[0].rowSha256,pin.survey.rowSha256);
  const part=entry.fragment.parts.find(p=>p.id===pin.survey.row.quote.citation.partId)!;
  assert.equal(part.sha256,pin.survey.partSha256);assert.equal(part.text.slice(pin.survey.row.quote.citation.characterStart,pin.survey.row.quote.citation.characterEnd),pin.survey.row.quote.literal);
  assert.deepEqual(await amendRegistryDocumentCitationsTx(f.client,draftId,f.request,f.dependencies),receipt);assert.equal(f.state.draftWrites,1);assert.equal(f.state.operations.size,1);
  const prepared=review(f),check:typeof assertRegistryDocumentCitationsTx=(client,site,record,lock)=>assertRegistryDocumentCitationsTx(client,site,record,lock,f.dependencies);
  await persistRegistryReviewTx(f.client,prepared.snapshot,prepared.body,check);assert.equal(f.state.reviewWrites,1);
  assert.deepEqual(f.state.review!.records[0].documentCitations,record.documentCitations);
  assert(f.state.calls.some(call=>call.sql.includes("a.state='accepted'")));assert(!f.state.calls.some(call=>call.sql.startsWith('UPDATE registry_records')));
  assert.throws(()=>associationLiterals(f.context),(e:any)=>e.code==='SOURCE_FUSION_SURVEY_CONTEXT_ONLY');
  await assert.rejects(()=>resolveFusionCitationsTx(f.client,localRequestContext(id(99)),f.request.addFusion,f.dependencies,siteId),
    (e:any)=>e.code==='SOURCE_FUSION_SURVEY_CONTEXT_ONLY');
  save('journey.json',{scope:'Unchanged real reports and retained actual producer stdout; reconstructed input/result/accepted-attempt, target/site/footprint/review and SQL/storage controls. No live persistence or authentic correspondence.',
    producer,originals:[f.nva,f.pid].map(r=>({path:r.original.pin.path,bytes:r.raw.length,sha256:sha256(r.raw),sourceFamily:r.current.context.sourceFamily,classification:r.current.context.classification})),
    request:f.request,receipt,priorCitation:f.prior,citation:pin,privateRead:evidence,contextSha256:hash,contextSources:2,review:f.state.review,
    draftWrites:f.state.draftWrites,operationReceipts:f.state.operations.size,reviewWrites:f.state.reviewWrites,sourceObjectReads:f.state.reads,
    readerSha256:f.nva.input.readerSha256,responseBytes:Buffer.byteLength(JSON.stringify(evidence)),
    qualification:'Private reference amendment/read/replay/review controls only; no geometry commit, model proposal, point correspondence, working frame, control/accuracy/learning qualification.'});
  save('nva.controlled-result.json',f.nva.result);save('pid.controlled-result.json',f.pid.result);
}));

test('wrong-row hash and current source revocation deny writes/disclosure/replay/review',options,()=>local(async()=>{
  const wrong=await fixture(),request=structuredClone(wrong.request);request.addFusion.selection.sources[0]={...wrong.survey,rowOrdinals:[165]};
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(wrong.client,draftId,request,wrong.dependencies),(e:any)=>e.status===409);
  assert.equal(wrong.state.draftWrites,0);assert.equal(wrong.state.operations.size,0);
  const f=await fixture();await amendRegistryDocumentCitationsTx(f.client,draftId,f.request,f.dependencies);
  const prepared=review(f),check:typeof assertRegistryDocumentCitationsTx=(client,site,record,lock)=>assertRegistryDocumentCitationsTx(client,site,record,lock,f.dependencies);
  f.state.revokeDuringRead=true;
  await assert.rejects(()=>readRegistryDocumentCitationsTx(f.client,draftId,f.dependencies),(e:any)=>e.status===403||e.status===409);
  f.state.revokeDuringRead=false;const reads=f.state.reads.length;
  await assert.rejects(()=>amendRegistryDocumentCitationsTx(f.client,draftId,f.request,f.dependencies),(e:any)=>e.status===403||e.status===409);
  await assert.rejects(()=>persistRegistryReviewTx(f.client,prepared.snapshot,prepared.body,check),(e:any)=>e.status===403||e.status===409);
  assert.equal(f.state.reads.length,reads);assert.equal(f.state.draftWrites,1);assert.equal(f.state.operations.size,1);assert.equal(f.state.reviewWrites,0);
  save('denials.json',{wrongRow:{contextSha256:wrong.request.addFusion.contextSha256,requestedRow:165,contextRow:164,draftWrites:0,operationReceipts:0},
    revokedSource:{latePrivateReadDenied:true,replayDeniedBeforeObjectRead:true,reviewDenied:true,draftWrites:1,operationReceipts:1,reviewWrites:0},
    scope:'Controlled canonical authority and SQL/storage; denied requests made no additional writes.'});
}));
