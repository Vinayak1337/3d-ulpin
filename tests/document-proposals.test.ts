import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import type {transaction} from '../packages/server/src/infrastructure/db';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {DocumentProposalsService} from '../packages/server/src/modules/usp/ingestion/document-proposals';
import {DocumentProposalsSaveSchema,DocumentProposalSnapshotViewSchema,DocumentProposalsHistorySchema,
  DocumentProposalsHistoryQuerySchema,DocumentProposalDecisionSaveSchema,DocumentProposalDecisionViewSchema,
  DocumentProposalDecisionHistorySchema} from '../packages/contracts/src/usp/document-proposals';
import {DocumentProposalsController} from '../apps/api/src/modules/ingestion/document-proposals.controller';
import {PrivateSpatialGuard} from '../apps/api/src/modules/spatial/private-spatial.guard';
import type {QuotePage} from '../packages/server/src/modules/usp/ingestion/document-proposal-quotes';
import {documentInput} from '../packages/server/src/modules/usp/ingestion/document-context';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {DocumentResultSchema} from '../packages/contracts/src/usp/document-ingestion';
import {saveReplayedStoreyProposals} from '../scripts/agent/storey-proposals-replay';
import {TeacherRecordings} from '../packages/server/src/modules/model-gateway/recordings';
import {hash} from '../packages/server/src/modules/model-gateway/config';
import {controlConfig,requestContext} from '../scripts/agent/control-runtime';
import {STOREY_AGENT_TEMPLATE,STOREY_AGENT_MODEL,storeyPartSelection,storeyPartsHash,storeyReplayKey,
  validateStoreyOutput} from '../packages/server/src/modules/ai/document-storey-agent';

const root=process.env.ULPIN_DOCUMENT_PROPOSAL_FIXTURE??'E:/BhuAayam-data/task-data/d08-document-field-baseline-20261005';
const sourceRows='E:/BhuAayam-data/task-data/d07-source-only-spatial-runtime-20261005-run02/pg-before.json';
const options={skip:existsSync(root+'/proposals-01/result.json')&&existsSync(sourceRows)?false:'Retained D08 packet and source authority fixture are required; no replacement generated.'};
const subject='document-proposals-controlled-process';
const error=(status:number,code?:string)=>(e:unknown)=>e instanceof AppError&&e.status===status&&(!code||e.code===code);
function fixture(){
  const bytes=readFileSync(root+'/proposals-01/result.json');
  assert.equal(sha256(bytes),'9fa7f99e52f90d446c3a26c075ebed64d1d539dd930556af91ae77aa632f63d5');
  return {bytes,packet:JSON.parse(bytes.toString('utf8'))};
}
// Explicit source selection from unchanged real D08 output. Paths/URLs are not
// copied into the API packet, dereferenced or presented as server verification.
function inputFor(sourceId:string){
  const {bytes,packet:p}=fixture(),selected=p.proposals.filter((v:any)=>v.sourceId===sourceId),context=p.provenance.find((v:any)=>v.sourceId===sourceId);
  const claim=(v:any)=>v?{sha256:v.sha256,bytes:v.bytes}:null;
  const locator=(v:any)=>({page:v.sourcePage??context.sourcePage,frame:v.sourcePageFrame??context.sourcePageFrame,
    box:v.sourcePageBox??null,selectedRegion:v.selectedRegion??context.selection.sourcePageBox??null,
    declaredPrecision:v.citationPrecision??null});
  return {requestKey:randomUUID(),expectedCaseRevision:2,
    source:{sourceRevision:context.sourceRevision,sourceSha256:context.original.sha256,sourceBytes:context.original.bytes},
    packet:{declaredOrigin:{sha256:sha256(bytes),bytes:bytes.length},proposals:selected.map((v:any)=>({proposalId:v.proposalId,
      fieldRole:v.fieldRole,quote:v.quote??null,lineQuote:v.lineQuote??null,quoteCharacterSpan:v.quoteCharacterSpan??null,
      status:v.status,reasons:v.reasons,locator:locator(v),declaredMethod:v.method??null,declaredObservation:claim(v.observation)})),
    rejected:p.rejected.filter((v:any)=>v.sourceId===sourceId).map((v:any,i:number)=>({entryId:`rejected-${i+1}`,
      lineQuote:v.lineQuote??null,reason:v.reason,locator:locator(v),declaredMethod:context.method??null,declaredObservation:claim(v.observation)})),
    conflicts:p.crossMethodQuoteDifferences.filter((v:any)=>v.sourceId===sourceId).map((v:any)=>({proposalIds:v.proposalIds,reason:v.reason,state:'unresolved'})),
    unknowns:p.unknowns}};
}
function uncheckedPacket(packet:any){
  return {...packet,proposals:packet.proposals.map(({quotationCheck,...proposal}:any)=>proposal)};
}
function harness(useSecond=false,textPages:QuotePage[]=[],useStoredText=false){

  const original=JSON.parse(readFileSync(sourceRows,'utf8')).state;
  const first=fixture().packet.proposals[0].sourceId;
  const records=structuredClone(original.sources);
  for(const r of records)r.inspection.documentOriginal.subject=subject;
  const source=records.find((r:any)=>useSecond?r.id!==first:r.id===first),caseId=source.case_id,sourceId=source.id;
  const request=()=>inputFor(sourceId),frame=request().packet.proposals[0].locator.frame;
  const state={revision:2,archived:false,owner:subject,latest:1,pages:0,verified:0,inserts:0,
    onPage:undefined as undefined|(()=>void),onVerify:undefined as undefined|(()=>void),
    onLock:undefined as undefined|(()=>void),onInsert:undefined as undefined|(()=>void),
    onHistoryRead:undefined as undefined|(()=>void),pageFrame:frame,
    storedInput:null as any,storedBytes:null as Buffer|null,productHash:null as string|null,textReads:0,
    onTextRead:undefined as undefined|(()=>void)};
  const operations=new Map<string,{payload_hash:string;result:any}>();
  let writeScope=false,caseLocked=false,sourceLocked=false;
  const client={query:async(sql:string,v:any[]=[])=>{
    const rows=(r:any[])=>({rows:structuredClone(r)});
    if(sql.startsWith('SELECT id,revision,archived')){
      if(sql.endsWith('FOR UPDATE')){assert(writeScope);state.onLock?.();caseLocked=true;}
      return rows(v[0]===caseId?[{id:caseId,revision:state.revision,archived:state.archived,
        frame:{id:'UNASSIGNED',horizontalUnit:'m',verticalUnit:'m',benchmark:'UNASSIGNED'},context:[],site_id:null}]:[]);
    }
    if(sql.includes('family_id=(SELECT family_id')){assert(caseLocked);sourceLocked=true;return rows([{id:sourceId}]);}
    if(sql.startsWith('SELECT case_id FROM sources'))return rows(records.filter((r:any)=>r.id===v[0]).map((r:any)=>({case_id:r.case_id})));
    if(sql.startsWith('SELECT * FROM sources'))return rows(records.filter((r:any)=>r.case_id===v[0]&&r.id===v[1]).map((r:any)=>({...r,
      inspection:{...r.inspection,documentOriginal:{...r.inspection.documentOriginal,subject:state.owner}}})));
    if(sql.startsWith('SELECT max(revision)'))return rows([{revision:state.latest}]);
    if(sql.startsWith('SELECT payload FROM jobs WHERE id=$1')||sql.startsWith('SELECT payload,input_fingerprint'))
      return rows([{payload:state.storedInput,input_fingerprint:fingerprint(state.storedInput)}]);
    if(sql.startsWith('SELECT j.status,j.payload'))return rows([{status:'succeeded',logical_state:'succeeded',
      payload:state.storedInput,input_sha256:fingerprint(state.storedInput),
      result_ref:{sha256:state.productHash},completion_sha256:state.productHash}]);
    if(sql.startsWith("SELECT max((result#>>'{snapshot,decisionRevision}')")){
      const revisions=[...operations].filter(([key])=>{const [c,k,kind]=key.split('|');return c===v[0]&&kind===v[1]&&k.startsWith(v[2].slice(0,-1));})
        .map(([,r])=>r.result.snapshot.decisionRevision);return rows([{revision:Math.max(...revisions)}]);
    }
    if(sql.startsWith('SELECT operation_key FROM operations')){
      assert(caseLocked&&sourceLocked);assert(v[5]>=2&&v[5]<=11);
      assert(sql.includes('operation_key>$3 AND operation_key<$4')&&sql.includes('ORDER BY operation_key ASC LIMIT $6'));
      const keys=[...operations].filter(([k,r])=>{const [c,key,kind]=k.split('|');
        return c===v[0]&&kind===v[1]&&key>v[2]&&key<v[3]&&
          (sql.includes("'{snapshot,proposal,snapshotId}'")?r.result.snapshot?.proposal.snapshotId:r.result.snapshot?.source.sourceId)===v[4];})
        .map(([k])=>k.split('|')[1]).sort().slice(0,v[5]);state.onHistoryRead?.();return rows(keys.map(operation_key=>({operation_key})));
    }
    if(sql.startsWith('SELECT payload_hash,result FROM operations')){const stored=operations.get(`${v[0]}|${v[1]}|${v[2]}`);return rows(stored?[stored]:[]);}
    if(sql.startsWith('INSERT INTO operations')){
      assert(writeScope&&caseLocked&&sourceLocked,'Only insert after canonical case/source-family locks.');
      const key=`${v[0]}|${v[1]}|${v[2]}`;assert(!operations.has(key),'Immutable operations cannot be overwritten.');
      operations.set(key,{payload_hash:v[3],result:structuredClone(v[4])});state.inserts++;state.onInsert?.();return rows([]);
    }
    throw new Error('Unexpected controlled SQL: '+sql);
  }} as unknown as PoolClient;
  let tail:Promise<unknown>=Promise.resolve();
  const tx=(async(action:any,deadline:any,mode:any)=>{
    const run=tail.then(async()=>{assert(deadline.deadlineAt>Date.now());writeScope=mode===undefined;caseLocked=sourceLocked=false;
      const prior=structuredClone(operations);
      try{return await action(client);}catch(e){operations.clear();for(const [k,v] of prior)operations.set(k,v);throw e;}
      finally{writeScope=false;caseLocked=sourceLocked=false;}
    });tail=run.catch(()=>{});return run;
  }) as typeof transaction;
  const service=new DocumentProposalsService({transaction:tx,
    ...(useStoredText?{}:{text:async()=>({pages:textPages})}),
    readTextObject:async key=>{
      assert(!caseLocked&&!sourceLocked,'Stored text object I/O occurs outside insertion locks.');
      assert.equal(key,`document-results/${state.storedInput.jobId}/${state.productHash}.json`);
      state.textReads++;state.onTextRead?.();return state.storedBytes!;
    },verify:async(a,deadline)=>{
    assert(!caseLocked&&!sourceLocked,'Original verification outside insertion locks.');assert(deadline>Date.now());
    assert.equal(a.sourceId,sourceId);assert.equal(a.sourceSha256,source.sha256);assert.equal(a.sourceBytes,Number(source.bytes));
    state.verified++;state.onVerify?.();
  },pages:async(id,pin)=>{
    assert(!caseLocked&&!sourceLocked,'Page inspection outside insertion locks.');state.pages++;
    assert.equal(id,sourceId);assert.equal(pin.sha256,source.sha256);assert.equal(pin.revision,String(source.revision));
    const result={version:'document-pages/1' as const,caseId,caseRevision:state.revision,sourceId,sourceRevision:1,
      sourceSha256:source.sha256,sourceBytes:Number(source.bytes),name:source.name,revision:'1',pageCount:1,offset:0,limit:1,hasMore:false,
      pages:[{page:1,label:'Page 1',sourceLabel:null,frame:state.pageFrame,mediaBox:[0,0,frame.width,frame.height],cropBox:[0,0,frame.width,frame.height],
        boxConvention:'pymupdf_page_rectangles/1' as const,renderSupport:'unsupported' as const,url:null,locator:{kind:'pdf_page' as const,page:1},calibration:null}],
      anchors:[{locator:'page:1',page:1,region:null}]};state.onPage?.();return result as any;
  }});
  // `edge`: the OCR region starts that many points inside the cited box, as a render that ends on whole pixels
  // leaves it; the stored result states its region edge only when given its render scale.
  function storeOcrProduct(proposal:any,edge?:{overhangPt:number;renderScalePxPerPt?:number}){
    const cited=proposal.locator.box,region=edge?[cited[0]+edge.overhangPt,...cited.slice(1)]:cited;
    const caseFrame={id:'UNASSIGNED',horizontalUnit:'m',verticalUnit:'m',benchmark:'UNASSIGNED'};
    const current={id:caseId,revision:2,archived:false,frame:caseFrame,context:[],site_id:null};
    const input=documentInput({current,source,binding:ingestionBinding(caseId),latest:true,
      context:fingerprint({frame:caseFrame,context:[],siteId:null})},randomUUID(),'native_only',
      {page:proposal.locator.page,region});
    const result=DocumentResultSchema.parse({version:'source-document/1',input,
      native:{status:'needs_ocr',format:'pdf',readerSha256:input.readerSha256,
        code:'NATIVE_TEXT_UNAVAILABLE',warnings:[],parts:[]},
      model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},
      ocr:{sourceSha256:input.sourceSha256,sourceRevision:1,sourcePage:1,requestedRegion:input.ocrSelection!.region,
        sourcePageFrame:proposal.locator.frame,method:'ocr:tesseract-cli-5.5.1:sparse-tsv-v1',
        toolStatus:'complete',outputStatus:'complete',textCompleteness:'unverified',issues:[],
        ...(edge?.renderScalePxPerPt===undefined?{}:{regionEdge:{renderScalePxPerPt:edge.renderScalePxPerPt,
          boxesBeyondRegion:1,largestOverhangPt:region[0]-cited[0]}}),
        items:[{text:proposal.lineQuote,label:'line',method:'ocr:tesseract-cli-sparse-tsv',
          sourcePageBoxes:[{pageNumber:1,frame:'pdf_display_page_top_left_points',box:proposal.locator.box,
            derivedFrom:'tesseract_tsv_pixels_via_mupdf_pixel_origin'}]}]},createdAt:new Date().toISOString()});
    state.storedInput=input;state.storedBytes=Buffer.from(JSON.stringify(result));
    state.productHash=sha256(state.storedBytes);
    source.inspection.documentAccepted={jobId:input.jobId,sha256:state.productHash};
  }
  return {service,state,operations,request,caseId,sourceId,storeOcrProduct};
}
async function withSubject(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}

test('actual T3-2 ten cited proposals save/exact-read/replay with literal caption/conflict and provisional provenance',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request(),saved=await f.service.save(f.caseId,f.sourceId,input);
  assert(DocumentProposalSnapshotViewSchema.safeParse(saved).success);assert.equal(saved.packet.proposals.length,10);
  assert.equal(saved.packet.proposals[0].quote,'TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)');
  assert.deepEqual(uncheckedPacket(saved.packet),input.packet);assert.equal(saved.packet.conflicts.length,1);
  assert.equal(saved.method,'caller_supplied_provisional');assert.equal(saved.provenanceAuthority,'caller_supplied_unverified');
  assert.equal(saved.review.actor,subject);assert.equal(saved.review.humanAuthenticated,false);assert.equal(saved.review.independentGroundTruth,false);
  assert.equal(saved.quotationVerification,'locator_checks_recorded');
  assert.equal(saved.learningLabel,false);assert.equal(saved.canonicalTarget,null);
  assert.equal(f.state.pages,1);assert.equal(f.operations.size,2);
  assert.deepEqual(await f.service.save(f.caseId,f.sourceId,input),saved);assert.equal(f.state.pages,1);assert.equal(f.operations.size,2);
  assert.deepEqual(await f.service.read(f.caseId,f.sourceId,saved.snapshotId),saved);
  await assert.rejects(f.service.save(f.caseId,f.sourceId,{...input,packet:{...input.packet,unknowns:[...input.packet.unknowns,'changed']}}),error(409));
  f.state.revision=3;const later=await f.service.read(f.caseId,f.sourceId,saved.snapshotId);
  assert.equal(later.currentCaseRevision,3);assert.equal(later.caseRevision,2);
  assert.deepEqual(uncheckedPacket(later.packet),input.packet);
}));
test('same-key recovery after unrelated case advance returns the committed snapshot without new operations or page inspection',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request();
  await f.service.save(f.caseId,f.sourceId,input); // Discard the response as if its server-generated snapshotId was lost.
  const persisted=[...f.operations.values()].find(v=>v.result.snapshot)!.result.snapshot;
  const operations=structuredClone(f.operations),pages=f.state.pages,inserts=f.state.inserts,verified=f.state.verified;
  f.state.revision=3;
  const recovered=await f.service.save(f.caseId,f.sourceId,input),{currentCaseRevision,snapshotSha256,...snapshot}=recovered;
  assert.deepEqual(snapshot,persisted);assert.equal(currentCaseRevision,3);assert.equal(snapshot.caseRevision,2);
  assert.equal(snapshotSha256.length,64);assert.deepEqual(f.operations,operations);
  assert.equal(f.state.pages,pages);assert.equal(f.state.inserts,inserts);
  assert.equal(f.state.verified,verified+1,'Exact replay still verifies the current original before locked disclosure.');
  await assert.rejects(f.service.save(f.caseId,f.sourceId,{...input,expectedCaseRevision:3}),error(409));
  await assert.rejects(f.service.save(f.caseId,f.sourceId,{...input,requestKey:randomUUID()}),error(409));
  assert.deepEqual(f.operations,operations);assert.equal(f.state.pages,pages);assert.equal(f.state.inserts,inserts);
}));
test('incomplete quote remains needs_input; actual S-001 rejected lines remain inspectable without filtering or promotion',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request();input.packet.proposals[0]={...input.packet.proposals[0],quote:null,lineQuote:null,
    quoteCharacterSpan:null,status:'needs_input',declaredMethod:null,declaredObservation:null};
  const saved=await f.service.save(f.caseId,f.sourceId,input);assert.equal(saved.packet.proposals[0].quote,null);
  assert.equal(saved.packet.proposals[0].status,'needs_input');assert.equal(saved.status,'needs_review');assert.equal(saved.qualification,'not_assessed');
  const site=harness(true),siteInput=site.request(),siteSaved=await site.service.save(site.caseId,site.sourceId,siteInput);
  assert.equal(siteSaved.packet.rejected.length,137);assert.deepEqual(siteSaved.packet.rejected,siteInput.packet.rejected);
  assert.equal(siteSaved.locatorWarnings.length,6);assert(siteSaved.locatorWarnings.every(w=>w.entryKind==='rejected'&&
    w.code==='citation_extends_declared_region'&&w.basis==='caller_supplied_coordinates'));
  assert.equal(siteSaved.packet.proposals.length,6);assert.equal(siteSaved.population,'explicit_selection_only');
}));
test('exact saved proposal decision records reviewed citation and keeps canonical building/floor linkage needs_input',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request(),saved=await f.service.save(f.caseId,f.sourceId,input),proposal=saved.packet.proposals[0];
  const request={requestKey:randomUUID(),expectedCaseRevision:2,source:input.source,
    proposal:{snapshotId:saved.snapshotId,snapshotRevision:saved.snapshotRevision,snapshotSha256:saved.snapshotSha256,proposalId:proposal.proposalId},
    decision:'reviewed' as const,reviewReason:'Officer retained the cited caption for source review.',
    citation:{quote:proposal.quote,lineQuote:proposal.lineQuote,quoteCharacterSpan:proposal.quoteCharacterSpan,locator:proposal.locator},
    missingPrerequisites:[]};
  const decision=await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,request);
  assert(DocumentProposalDecisionViewSchema.safeParse(decision).success);assert.equal(decision.decision,'reviewed');
  assert.equal(decision.originalProposal.proposalId,proposal.proposalId);assert.equal(decision.citation.quote,proposal.quote);
  assert.deepEqual(decision.buildingFloorLink,{state:'needs_input',canonicalTarget:null,
    missingPrerequisites:['canonical_building','canonical_floor','reviewed_source_target_crosswalk']});
  assert.equal(decision.quotationVerification,'not_machine_verified');assert.equal(decision.learningLabel,false);
  assert.equal(f.operations.size,4);assert.deepEqual(await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,request),decision);
  assert.equal(f.operations.size,4);
  const correction={...request,requestKey:randomUUID(),decision:'needs_input' as const,
    reviewReason:'Correction records the unresolved current revision.',citation:{...request.citation,quote:null,lineQuote:null,quoteCharacterSpan:null},
    missingPrerequisites:['current_drawing_revision'],correctionOf:{decisionId:decision.decisionId,decisionRevision:decision.decisionRevision,
      snapshotSha256:decision.snapshotSha256}};
  const revised=await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,correction);
  assert.equal(revised.decisionId,decision.decisionId);assert.equal(revised.decisionRevision,2);assert.equal(revised.correctionOf?.decisionRevision,1);
  assert.equal(f.operations.size,6);assert.equal((await f.service.decisionHistory(f.caseId,f.sourceId,saved.snapshotId)).references.length,2);
  const history=await f.service.decisionHistory(f.caseId,f.sourceId,saved.snapshotId);assert(DocumentProposalDecisionHistorySchema.safeParse(history).success);
  assert.equal(history.references.length,2);assert.equal(history.references[0].decisionRevision,1);assert.equal(history.references[1].decisionRevision,2);
  assert.deepEqual(await f.service.readDecision(f.caseId,f.sourceId,saved.snapshotId,decision.decisionId,{revision:'1'}),decision);
  assert.deepEqual(await f.service.readDecision(f.caseId,f.sourceId,saved.snapshotId,decision.decisionId,{revision:'2'}),revised);
  const page=await f.service.decisionHistory(f.caseId,f.sourceId,saved.snapshotId,{limit:'1'});
  assert.equal(page.nextAfter,`${decision.decisionId}:1`);
  const tail=await f.service.decisionHistory(f.caseId,f.sourceId,saved.snapshotId,{limit:'1',after:page.nextAfter});
  assert.equal(tail.references[0].decisionRevision,2);assert.equal(tail.hasMore,false);
  await assert.rejects(f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,{...correction,requestKey:randomUUID()}),error(409));
  assert.equal(f.operations.size,6);assert.deepEqual(await f.service.read(f.caseId,f.sourceId,saved.snapshotId),saved);
  f.state.revision=3;const pageCount=f.state.pages;
  const replay=await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,request);
  assert.equal(replay.currentCaseRevision,3);assert.equal(replay.decisionRevision,1);assert.equal(f.state.pages,pageCount);assert.equal(f.operations.size,6);
}));
test('conflicting or incomplete proposal decision remains needs_input and changed replay is refused',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request(),saved=await f.service.save(f.caseId,f.sourceId,input),proposal=saved.packet.proposals[0];
  const request={requestKey:randomUUID(),expectedCaseRevision:2,source:input.source,
    proposal:{snapshotId:saved.snapshotId,snapshotRevision:1,snapshotSha256:saved.snapshotSha256,proposalId:proposal.proposalId},
    decision:'needs_input' as const,reviewReason:'The caption conflicts with the separate retained source statement.',
    citation:{quote:null,lineQuote:null,quoteCharacterSpan:null,locator:proposal.locator},
    missingPrerequisites:['current_drawing_revision','canonical_building','canonical_floor']};
  assert.equal(DocumentProposalDecisionSaveSchema.safeParse({...request,decision:'reviewed'}).success,false);
  assert.equal(DocumentProposalDecisionSaveSchema.safeParse({...request,canonicalTarget:randomUUID()}).success,false);
  const decision=await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,request);assert.equal(decision.decision,'needs_input');
  assert.equal(decision.citation.quote,null);assert.deepEqual(decision.sourceConflicts,input.packet.conflicts);assert.deepEqual(decision.sourceUnknowns,input.packet.unknowns);
  await assert.rejects(f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,{...request,reviewReason:'changed'}),error(409));
  assert.equal(f.operations.size,4);
}));
test('decision wrong snapshot/source and access or source drift refuse before writes; exact decision corruption denies disclosure',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request(),saved=await f.service.save(f.caseId,f.sourceId,input),p=saved.packet.proposals[0];
  const request={requestKey:randomUUID(),expectedCaseRevision:2,source:input.source,
    proposal:{snapshotId:saved.snapshotId,snapshotRevision:1,snapshotSha256:saved.snapshotSha256,proposalId:p.proposalId},
    decision:'rejected' as const,reviewReason:'This provisional caption is not adopted.',
    citation:{quote:p.quote,lineQuote:p.lineQuote,quoteCharacterSpan:p.quoteCharacterSpan,locator:p.locator},missingPrerequisites:[]};
  const unchanged=structuredClone(f.operations),pages=f.state.pages;
  await assert.rejects(f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,
    {...request,proposal:{...request.proposal,snapshotSha256:'0'.repeat(64)}}),error(409));
  await assert.rejects(f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,
    {...request,source:{...request.source,sourceSha256:'f'.repeat(64)}}),error(409));
  assert.equal(f.state.pages,pages);assert.deepEqual(f.operations,unchanged);
  f.state.onPage=()=>{f.state.latest=2;};
  await assert.rejects(f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,request),error(409));
  f.state.latest=1;f.state.onPage=undefined;f.state.onVerify=()=>{f.state.owner='revoked';};
  await assert.rejects(f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,request),error(403));
  f.state.owner=subject;f.state.onVerify=undefined;assert.deepEqual(f.operations,unchanged);
  const decision=await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,request);
  f.state.onVerify=()=>{f.state.owner='revoked';};
  await assert.rejects(f.service.readDecision(f.caseId,f.sourceId,saved.snapshotId,decision.decisionId,{revision:'1'}),error(403));
  f.state.owner=subject;f.state.onVerify=undefined;
  const key=[...f.operations.keys()].find(k=>k.includes('document-proposal-decision:'))!,stored=f.operations.get(key)!;
  stored.result.snapshot.originalProposal.quote='tampered';
  await assert.rejects(f.service.readDecision(f.caseId,f.sourceId,saved.snapshotId,decision.decisionId,{revision:'1'}),error(422,'DOCUMENT_PROPOSALS_DECISION_INTEGRITY'));
  assert.equal(f.operations.size,4);
}));
test('wrong source hash, page frame, access and final source drift refuse with zero denied inserts',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request();
  await assert.rejects(f.service.save(f.caseId,f.sourceId,{...input,source:{...input.source,sourceSha256:'f'.repeat(64)}}),error(409));
  assert.equal(f.state.pages,0);assert.equal(f.state.verified,0);assert.equal(f.operations.size,0);
  f.state.pageFrame={...f.state.pageFrame,width:f.state.pageFrame.width+1};
  await assert.rejects(f.service.save(f.caseId,f.sourceId,input),error(409));assert.equal(f.operations.size,0);
  f.state.pageFrame=input.packet.proposals[0].locator.frame;f.state.onPage=()=>{f.state.latest=2;};
  await assert.rejects(f.service.save(f.caseId,f.sourceId,input),error(409));assert.equal(f.operations.size,0);
  f.state.latest=1;f.state.onPage=undefined;f.state.onLock=()=>{f.state.owner='different-process';};
  await assert.rejects(f.service.save(f.caseId,f.sourceId,input),error(403));assert.equal(f.operations.size,0);assert.equal(f.state.inserts,0);
  f.state.owner=subject;f.state.onLock=undefined;f.state.onInsert=()=>{f.state.owner='revoked-at-final-check';};
  await assert.rejects(f.service.save(f.caseId,f.sourceId,input),error(403));assert.equal(f.operations.size,0);
}));
test('exact read fences access after original I/O, detects snapshot corruption and rejects caller paths/verified claims',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request();
  for(const raw of [{...input,actor:'caller'}, {...input,method:'human_entry'}, {...input,objectKey:'private/other'},
    {...input,packet:{...input.packet,declaredOrigin:{...input.packet.declaredOrigin,path:'E:/private/input'}}},
    {...input,packet:{...input.packet,proposals:[{...input.packet.proposals[0],status:'accepted'}]}}])
    assert.equal(DocumentProposalsSaveSchema.safeParse(raw).success,false);
  const saved=await f.service.save(f.caseId,f.sourceId,input);f.state.onVerify=()=>{f.state.archived=true;};
  await assert.rejects(f.service.read(f.caseId,f.sourceId,saved.snapshotId),error(403));assert.equal(f.operations.size,2);
  f.state.archived=false;f.state.onVerify=undefined;
  const snapshot=[...f.operations.values()].find(v=>v.result.snapshot)!;snapshot.result.snapshot.packet.proposals[0].quote='tampered';
  await assert.rejects(f.service.read(f.caseId,f.sourceId,saved.snapshotId),error(422,'DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY'));
}));
test('private no-store controller keeps source routing and fatal UTF-8/literal Unicode before a controlled save',options,()=>withSubject(async()=>{
  assert.deepEqual(Reflect.getMetadata('__guards__',DocumentProposalsController),[PrivateSpatialGuard]);
  const f=harness(),input=f.request(),seen:any[]=[];
  const controller=new DocumentProposalsController({save:async(caseId:string,sourceId:string,raw:unknown)=>{seen.push({caseId,sourceId,raw});return raw;}} as any);
  for(const name of ['save','read'] as const){const handler=DocumentProposalsController.prototype[name];
    assert(Reflect.getMetadata('swagger/apiOperation',handler)?.operationId);
    assert(Reflect.getMetadata('__headers__',handler).some((h:any)=>h.name==='Cache-Control'&&h.value==='private, no-store'));
  }
  const stream=(bytes:Buffer)=>Object.assign(Readable.from([bytes]),{headers:{},originalUrl:'/document-proposals'}) as any;
  const raw=JSON.stringify(input),quote=input.packet.proposals[0].quote,at=raw.indexOf(quote),bad=Buffer.concat([
    Buffer.from(raw.slice(0,at)),Buffer.from([255]),Buffer.from(raw.slice(at+quote.length))]);
  await assert.rejects(controller.save(f.caseId,f.sourceId,stream(bad)),error(400,'INVALID_JSON'));assert.equal(seen.length,0);
  input.packet.unknowns.push('जाँच 🧭');await controller.save(f.caseId,f.sourceId,stream(Buffer.from(JSON.stringify(input))));
  assert.deepEqual(seen,[{caseId:f.caseId,sourceId:f.sourceId,raw:input}]);
}));

const historyRoot='E:/BhuAayam-data/task-data/d08-document-proposals-runtime-20261005-run01';
const historyOptions={skip:options.skip||(!existsSync(historyRoot+'/pg-after.json')?'Retained saved D08 snapshot required.':false)};
async function historyFixture(){
  const f=harness(),setup=await f.service.save(f.caseId,f.sourceId,f.request());
  const retained=JSON.parse(readFileSync(historyRoot+'/pg-after.json','utf8')).addedOperations
    .find((v:any)=>v.kind==='document-proposal-snapshot/1');
  assert.equal(fingerprint(retained.result),retained.payload_hash,'Retained immutable wrapper is unchanged.');
  assert.equal(retained.result.snapshot.snapshotId,'d69d935a-20f7-4399-b4b3-9ef3b4bb7ef3');
  assert.equal(retained.result.snapshot.source.sourceId,f.sourceId);assert.equal(retained.result.snapshot.caseId,f.caseId);
  const envelope=structuredClone([...f.operations.values()].find(v=>v.result.snapshot)!.result);f.operations.clear();
  // Saved real packet/reference/time, with only technical actor/access authority
  // from the controlled harness. Extra UUIDs are pagination controls, not live saves.
  const seed=(snapshotId:string,sourceId=f.sourceId,caseId=f.caseId)=>{
    const result=structuredClone(envelope);result.snapshot=structuredClone(retained.result.snapshot);
    result.snapshot.snapshotId=snapshotId;result.snapshot.source.sourceId=sourceId;result.snapshot.caseId=caseId;
    result.snapshot.review.actor=subject;
    const key=`${caseId}|document-proposal-snapshot:${snapshotId}|document-proposal-snapshot/1`;
    f.operations.set(key,{payload_hash:fingerprint(result),result});return key;
  };
  seed(retained.result.snapshot.snapshotId);
  assert.equal(setup.packet.proposals.length,retained.result.snapshot.packet.proposals.length);
  return {...f,seed,retained:retained.result.snapshot};
}
test('history discovers retained D08 UUID and exact reader; bounded ordered pages preserve saved metadata without writes',historyOptions,()=>withSubject(async()=>{
  const f=await historyFixture(),actual=f.retained.snapshotId,small='00000001-0000-4000-8000-000000000001';
  f.seed(small);f.seed('00000002-0000-4000-8000-000000000002',randomUUID());f.seed('00000003-0000-4000-8000-000000000003',f.sourceId,randomUUID());
  const before=structuredClone(f.operations),inserts=f.state.inserts,pages=f.state.pages;f.state.revision=3;
  const first=await f.service.history(f.caseId,f.sourceId,{limit:'1'});assert(DocumentProposalsHistorySchema.safeParse(first).success);
  assert.deepEqual(first.references.map(r=>r.snapshotId),[small]);assert.equal(first.hasMore,true);assert.equal(first.nextAfter,small);
  assert.equal(first.currentCaseRevision,3);assert.equal(first.references[0].caseRevision,2);
  const last=await f.service.history(f.caseId,f.sourceId,{after:first.nextAfter,limit:'1'});
  assert.deepEqual(last.references.map(r=>r.snapshotId),[actual]);assert.equal(last.hasMore,false);assert.equal(last.nextAfter,null);
  const ref=last.references[0],read=await f.service.read(f.caseId,f.sourceId,ref.snapshotId);
  assert.equal(ref.snapshotSha256,read.snapshotSha256);assert.equal(ref.readUrl,`/api/v1/ingestion/cases/${f.caseId}/sources/${f.sourceId}/document-proposals/${actual}`);
  assert.equal(ref.proposalCount,10);assert.equal(ref.conflictCount,f.retained.packet.conflicts.length);assert.deepEqual(ref.review,read.review);
  assert.equal('packet' in ref,false);assert.equal(ref.learningLabel,false);assert.equal(ref.quotationVerification,'not_machine_verified');
  const empty=await f.service.history(f.caseId,f.sourceId,{after:actual});assert.deepEqual(empty.references,[]);assert.equal(empty.hasMore,false);
  assert.deepEqual(f.operations,before);assert.equal(f.state.inserts,inserts);assert.equal(f.state.pages,pages);
}));
test('history refuses wrong-scope cursors, corrupt snapshots, denied access and authority changes after reads with no writes',historyOptions,()=>withSubject(async()=>{
  const f=await historyFixture(),foreign='00000002-0000-4000-8000-000000000002';f.seed(foreign,randomUUID());
  await assert.rejects(f.service.history(f.caseId,f.sourceId,{after:foreign}),error(409));assert.equal(f.state.verified,1,'Setup alone verified original.');
  const before=structuredClone(f.operations),inserts=f.state.inserts;
  f.state.archived=true;await assert.rejects(f.service.history(f.caseId,f.sourceId),error(403));assert.equal(f.state.verified,1);
  f.state.archived=false;f.state.onVerify=()=>{f.state.latest=2;};await assert.rejects(f.service.history(f.caseId,f.sourceId),error(409));
  f.state.latest=1;f.state.onVerify=undefined;f.state.onHistoryRead=()=>{f.state.revision++;};
  await assert.rejects(f.service.history(f.caseId,f.sourceId),error(409));f.state.onHistoryRead=undefined;f.state.revision=2;
  const ownKey=[...f.operations.keys()].find(k=>k.includes(f.retained.snapshotId))!,own=f.operations.get(ownKey)!;
  own.result.snapshot.source.sourceRevision++;own.payload_hash=fingerprint(own.result);
  await assert.rejects(f.service.history(f.caseId,f.sourceId),error(409),'Rehashed stale source metadata cannot be promoted by current authority.');
  f.operations.set(ownKey,structuredClone(before.get(ownKey)!));f.operations.get(ownKey)!.result.snapshot.packet.proposals[0].quote='tampered';
  await assert.rejects(f.service.history(f.caseId,f.sourceId),error(422,'DOCUMENT_PROPOSALS_SNAPSHOT_INTEGRITY'));
  f.operations.set(ownKey,structuredClone(before.get(ownKey)!));
  assert.deepEqual(f.operations,before);assert.equal(f.state.inserts,inserts);
}));
test('history controller keeps private no-store collection and exact-query semantics with strict bounded pagination',()=>{
  const seen:any[]=[],controller=new DocumentProposalsController({history:(...args:any[])=>{seen.push(args);return args;},read:()=>null} as any);
  const request=(query='')=>({originalUrl:'/document-proposals'+query}) as any;
  controller.history('case','source',request('?limit=2'));assert.deepEqual({...seen[0][2]},{limit:'2'});
  assert.equal(DocumentProposalsHistoryQuerySchema.parse({}).limit,5);
  for(const q of ['?limit=0','?limit=11','?limit=1&limit=2','?offset=1','?after=context'])
    assert.throws(()=>controller.history('case','source',request(q)));
  assert.equal(seen.length,1);assert.throws(()=>controller.read('case','source','snapshot',request('?limit=1')),error(422));
  const handler=DocumentProposalsController.prototype.history;
  assert.deepEqual(Reflect.getMetadata('__guards__',DocumentProposalsController),[PrivateSpatialGuard]);
  assert.equal(Reflect.getMetadata('path',handler),'/');assert.equal(Reflect.getMetadata('method',handler),0);
  assert.equal(Reflect.getMetadata('swagger/apiOperation',handler).operationId,'GET_api_v1_ingestion_cases_caseId_sources_sourceId_document_proposals');
  assert(Reflect.getMetadata('__headers__',handler).some((h:any)=>h.name==='Cache-Control'&&h.value==='private, no-store'));
  const decisionController=new DocumentProposalsController({decisionHistory:(...args:any[])=>args,readDecision:(...args:any[])=>args} as any);
  for(const q of ['?limit=0','?limit=1&limit=2','?offset=1'])
    assert.throws(()=>decisionController.decisionHistory('case','source','snapshot',request(q)));
  for(const q of ['','?revision=0','?revision=1&revision=2','?revision=1&latest=true'])
    assert.throws(()=>decisionController.readDecision('case','source','snapshot','decision',request(q)));
  for(const name of ['reviewDecision','readDecision','decisionHistory'] as const){const handler=DocumentProposalsController.prototype[name];
    assert(Reflect.getMetadata('swagger/apiOperation',handler)?.operationId);
    assert(Reflect.getMetadata('__headers__',handler).some((h:any)=>h.name==='Cache-Control'&&h.value==='private, no-store'));
  }
});

function towerQuoteFixture(){
  const candidatePath='docs/evidence/gf-ai/storeys/a5/candidates/haryana-2831-tower3.json';
  const packet=JSON.parse(readFileSync(candidatePath,'utf8')).packet;
  const path='E:/BhuAayam-data/task-data/a5/stores/'+packet.declaredOrigin.sha256+'.pages.json';
  const bytes=readFileSync(path),store=JSON.parse(bytes.toString('utf8'));
  assert.equal(store.source.sha256,packet.declaredOrigin.sha256);
  const pages:QuotePage[]=Object.entries(store.pages).map(([number,entry]:[string,any])=>({
    page:Number(number),frame:packet.proposals[0].locator.frame,lines:entry.lines,
    basis:{kind:'ocr_observations',productSha256:sha256(bytes)}
  }));
  return {packet,pages,store};
}
test('real Tower 3 A5 packet keeps 20 quotes; one altered digit refuses 1 and keeps 19 before save',options,
  ()=>withSubject(async()=>{
    const {packet,pages}=towerQuoteFixture();
    for(const altered of [false,true]){
      const f=harness(true,pages),input=f.request();
      input.packet=structuredClone(packet);f.state.pageFrame=packet.proposals[0].locator.frame;
      assert.equal(input.source.sourceSha256,packet.declaredOrigin.sha256);
      if(altered){const p=input.packet.proposals.find((p:any)=>p.quote==='G+42')!;
        p.quote='G+43';p.lineQuote=p.lineQuote.replace('G+42','G+43');}
      const saved=await f.service.save(f.caseId,f.sourceId,input);
      assert.equal(saved.version,'source-document-proposals/2');
      assert.equal(saved.packet.proposals.length,altered?19:20);
      assert.equal(saved.packet.rejected.length,altered?1:0);
      assert(saved.packet.proposals.every(p=>'quotationCheck' in p&&p.quotationCheck.outcome==='quote_at_locator'));
      assert(saved.packet.proposals.every(p=>p.status==='needs_review'));assert.equal(saved.learningLabel,false);
      assert.equal(saved.unresolved[0],'quote_truth');
      if(altered){const r=saved.packet.rejected[0];assert.equal(r.reason,'quote_not_at_locator');
        assert.deepEqual(r.locator,input.packet.proposals.find((p:any)=>p.quote==='G+43')!.locator);}
      assert.deepEqual(await f.service.save(f.caseId,f.sourceId,input),saved);
      assert.equal(f.state.pages,1);assert.equal(f.operations.size,2);
    }
  }));
test('one good and one bad quote stores both populations and unresolved conflict; all refused still saves',options,
  ()=>withSubject(async()=>{
    const {packet,pages}=towerQuoteFixture();
    for(const allBad of [false,true]){
      const f=harness(true,pages),input=f.request();
      input.packet={...packet,proposals:[structuredClone(packet.proposals[5]),structuredClone(packet.proposals[5])]};
      input.packet.proposals[0].proposalId='good';input.packet.proposals[1].proposalId='bad';
      input.packet.proposals[1].quote='G+43';input.packet.proposals[1].quoteCharacterSpan=null;
      if(allBad){input.packet.proposals[0].quote='G+44';input.packet.proposals[0].quoteCharacterSpan=null;}
      input.packet.conflicts=[{proposalIds:['good','bad'],reason:'control alternatives',state:'unresolved'}];
      const saved=await f.service.save(f.caseId,f.sourceId,input);
      assert.equal(saved.packet.proposals.length,allBad?0:1);assert.equal(saved.packet.rejected.length,allBad?2:1);
      assert.deepEqual(saved.packet.conflicts,input.packet.conflicts);
      assert(saved.packet.rejected.every(r=>r.reason==='quote_not_at_locator'));
    }
  }));
test('moving failed quotes over rejected limit refuses the complete save with a named 422',options,
  ()=>withSubject(async()=>{
    const {packet,pages}=towerQuoteFixture(),f=harness(true,pages),input=f.request();
    const p=structuredClone(packet.proposals[5]);p.quote='G+43';p.quoteCharacterSpan=null;
    input.packet={...packet,proposals:[p],rejected:Array.from({length:256},(_,i)=>({entryId:`r${i}`,
      lineQuote:null,reason:'retained control',locator:p.locator,declaredMethod:null,declaredObservation:null}))};
    await assert.rejects(f.service.save(f.caseId,f.sourceId,input),error(422,'DOCUMENT_PROPOSALS_REJECTED_LIMIT'));
    assert.equal(f.operations.size,0);
  }));
test('stored /1 snapshot still reads, lists in history and accepts a reviewed decision unchanged',historyOptions,
  ()=>withSubject(async()=>{
    const f=await historyFixture(),saved=await f.service.read(f.caseId,f.sourceId,f.retained.snapshotId);
    assert.equal(saved.version,'source-document-proposals/1');
    const history=await f.service.history(f.caseId,f.sourceId);
    assert.equal(history.references[0].quotationVerification,'not_machine_verified');
    const p=saved.packet.proposals[0];
    const decision=await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,{
      requestKey:randomUUID(),expectedCaseRevision:2,source:{sourceRevision:saved.source.sourceRevision,
        sourceSha256:saved.source.sourceSha256,sourceBytes:saved.source.sourceBytes},
      proposal:{snapshotId:saved.snapshotId,snapshotRevision:1,
        snapshotSha256:saved.snapshotSha256,proposalId:p.proposalId},
      decision:'reviewed',reviewReason:'Compatibility control retains the original cited proposal.',
      citation:{quote:p.quote,lineQuote:p.lineQuote,quoteCharacterSpan:p.quoteCharacterSpan,locator:p.locator},
      missingPrerequisites:[]
    });
    assert.deepEqual(decision.originalProposal,p);
    assert.deepEqual(await f.service.readDecision(f.caseId,f.sourceId,saved.snapshotId,decision.decisionId,
      {revision:'1'}),decision);
  }));
test('production stored-text reader checks accepted OCR bytes, product hash and source pins before persistence',options,
  ()=>withSubject(async()=>{
    const {packet}=towerQuoteFixture(),f=harness(true,[],true),input=f.request();
    input.packet={...packet,proposals:[packet.proposals[5]]};f.storeOcrProduct(input.packet.proposals[0]);
    const saved=await f.service.save(f.caseId,f.sourceId,input),p=saved.packet.proposals[0];
    assert('quotationCheck' in p);assert.equal(p.quotationCheck.outcome,'quote_at_locator');
    assert.deepEqual(p.quotationCheck.basis,{kind:'ocr_observations',productSha256:f.state.productHash});
    assert.equal(f.state.textReads,1);assert.equal(f.operations.size,2);
    f.state.storedBytes=Buffer.from('{}');
    await assert.rejects(f.service.save(f.caseId,f.sourceId,{...input,requestKey:randomUUID()}),
      error(422,'DOCUMENT_RESULT_INTEGRITY'));
    assert.equal(f.operations.size,2);
  }));
test('stored OCR text is read for a cited box within the stated region edge of its own result, not otherwise',options,
  ()=>withSubject(async()=>{
    const {packet}=towerQuoteFixture();
    const check=async(edge:{overhangPt:number;renderScalePxPerPt?:number})=>{
      const f=harness(true,[],true),input=f.request();
      input.packet={...packet,proposals:[packet.proposals[5]]};f.storeOcrProduct(input.packet.proposals[0],edge);
      const p=(await f.service.save(f.caseId,f.sourceId,input)).packet.proposals[0];
      assert('quotationCheck' in p);return p.quotationCheck;
    };
    // The scale and overhang of the retained site plan result (K9d): 1.114 pt, within its one rendered pixel.
    const stated=await check({overhangPt:1.1142857142857,renderScalePxPerPt:0.813953488372093});
    assert.deepEqual([stated.outcome,stated.reason],['quote_at_locator',null]);
    // A result without the block keeps the exact region, as before: the same kind of citation is not read.
    const silent=await check({overhangPt:0.5});
    assert.deepEqual([silent.outcome,silent.reason],['not_checked','no_region_text']);
  }));
test('accepted OCR authority drift during stored-object I/O refuses before any operation insert',options,
  ()=>withSubject(async()=>{
    const {packet}=towerQuoteFixture(),f=harness(true,[],true),input=f.request();
    input.packet={...packet,proposals:[packet.proposals[5]]};f.storeOcrProduct(input.packet.proposals[0]);
    f.state.onTextRead=()=>{f.state.productHash='f'.repeat(64);};
    await assert.rejects(f.service.save(f.caseId,f.sourceId,input),error(409));
    assert.equal(f.operations.size,0);
  }));

function towerReplayFixture(){
  const {packet,pages,store}=towerQuoteFixture(),f=harness(true,pages),input=f.request();
  const selection=storeyPartSelection(store),batch=selection.batches.findIndex(parts=>
    parts.some(p=>p.partId==='p1-l56')&&parts.some(p=>p.partId==='p1-l88'));
  assert(batch>=0,'The two real control citations must be in one selected batch.');
  const request={requestKey:input.requestKey,expectedCaseRevision:input.expectedCaseRevision,source:input.source,
    caseId:f.caseId,sourceId:f.sourceId,batch,frames:{'1':packet.proposals[0].locator.frame}};
  const root='E:/BhuAayam-data/task-data/d2';mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'replay-')),recordings=new TeacherRecordings(directory);
  return {...f,request,store,parts:selection.batches[batch],directory,recordings};
}
async function recordTowerControl(f:ReturnType<typeof towerReplayFixture>,output:any){
  const validation=validateStoreyOutput(output,f.parts);assert(validation.success);
  const profileHash=storeyPartsHash(f.parts);
  await f.recordings.record({adapterKind:'control',templateVersion:STOREY_AGENT_TEMPLATE,model:STOREY_AGENT_MODEL,
    profileHash,replayKey:storeyReplayKey(profileHash),attempt:1,inputHash:hash({control:true,parts:f.parts}),
    latencyMs:0,result:{output,responseHash:hash(output),httpStatus:200,
      rawResponse:{kind:'recorded_software_control',output}},parsedPlan:validation.output,validation,
    price:controlConfig().price});
}
function replayTower(f:ReturnType<typeof towerReplayFixture>){
  return saveReplayedStoreyProposals(f.store,f.request,{recordings:f.recordings,service:f.service,
    context:requestContext});
}
function retainReplayProof(f:ReturnType<typeof towerReplayFixture>,value:unknown){
  writeFileSync(join(f.directory,'proof.json'),JSON.stringify(value),{flag:'wx'});
  writeFileSync(join(f.directory,'request.json'),JSON.stringify(f.request),{flag:'wx'});
}
test('real Tower 3 software control replays, adapts, quote-checks and saves, then decisions read back',options,
  ()=>withSubject(async()=>{
    const f=towerReplayFixture();
    const output=JSON.parse(readFileSync('docs/evidence/gf-ai/documents/d2/control-output.json','utf8'));
    await recordTowerControl(f,output);
    const receipt=await replayTower(f),saved=receipt.snapshot;assert(saved);
    assert.equal(saved.version,'source-document-proposals/2');
    assert.equal(receipt.recordingKind,'control');assert.equal(receipt.dispatches,0);assert.equal(receipt.admissions,0);
    assert.equal(saved.packet.proposals.length,2);assert.equal(saved.packet.rejected.length,0);
    assert.deepEqual(saved.packet.conflicts,[],'There is no second storey expression in these retained OCR lines.');
    for(const p of saved.packet.proposals){assert('quotationCheck' in p);
      assert.equal(p.quotationCheck.outcome,'quote_at_locator');assert.equal(p.status,'needs_review');
      assert.equal(p.declaredMethod,'recorded_software_control');}
    assert.equal(saved.learningLabel,false);assert.equal(saved.unresolved[0],'quote_truth');
    assert.deepEqual((await replayTower(f)).snapshot,saved);assert.equal(f.operations.size,2);
    const decisions=[];
    for(const [index,decision] of ['reviewed','rejected'].entries()){
      const p=saved.packet.proposals[index];
      const reviewed=await f.service.reviewDecision(f.caseId,f.sourceId,saved.snapshotId,{
        requestKey:randomUUID(),expectedCaseRevision:2,source:f.request.source,
        proposal:{snapshotId:saved.snapshotId,snapshotRevision:1,snapshotSha256:saved.snapshotSha256,
          proposalId:p.proposalId},decision,reviewReason:'D2 offline software-control decision; not ground truth.',
        citation:{quote:p.quote,lineQuote:p.lineQuote,quoteCharacterSpan:p.quoteCharacterSpan,locator:p.locator},
        missingPrerequisites:[]});
      assert.equal(reviewed.decision,decision);assert.equal(reviewed.learningLabel,false);
      assert.deepEqual(reviewed.originalProposal,p);
      assert.deepEqual(await f.service.readDecision(f.caseId,f.sourceId,saved.snapshotId,reviewed.decisionId,
        {revision:'1'}),reviewed);decisions.push(reviewed.decision);
    }
    assert.equal((await f.service.decisionHistory(f.caseId,f.sourceId,saved.snapshotId)).references.length,2);
    assert.equal(f.operations.size,6);
    retainReplayProof(f,{kept:2,refused:0,codes:[],conflicts:0,decisions,dispatches:receipt.dispatches,
      admissions:receipt.admissions,omitted:receipt.omitted,source:f.request.source});
  }));
test('real Tower 3 control with an absent quote retains that fact in rejected with its original citation',options,
  ()=>withSubject(async()=>{
    const f=towerReplayFixture();
    const output=JSON.parse(readFileSync('docs/evidence/gf-ai/documents/d2/control-output.json','utf8'));
    output.floorExpressions[0].expression='G+43';output.floorExpressions[0].citations[0].quote='G+43';
    await recordTowerControl(f,output);
    const receipt=await replayTower(f),saved=receipt.snapshot;assert(saved);
    assert.equal(saved.packet.proposals.length,1);assert.equal(saved.packet.rejected.length,1);
    const refused=saved.packet.rejected[0];assert.equal(refused.reason,'quote_not_at_locator');
    assert.equal(refused.locator?.page,1);assert('originalProposal' in refused);
    assert.equal(refused.originalProposal?.quote,'G+43');
    assert.equal(refused.originalProposal?.agentFact?.kind,'floorExpression');
    assert.equal(receipt.dispatches,0);assert.equal(receipt.admissions,0);
    retainReplayProof(f,{kept:1,refused:1,codes:['quote_not_at_locator'],dispatches:0,admissions:0});
  }));
test('replay miss reports teacher_unavailable without packet, snapshot, provider dispatch or save',options,
  ()=>withSubject(async()=>{
    const f=towerReplayFixture(),receipt=await replayTower(f);
    assert.equal(receipt.state,'teacher_unavailable');assert.equal(receipt.snapshot,null);
    assert.equal(receipt.recordingKind,null);assert.equal(receipt.dispatches,0);assert.equal(receipt.admissions,0);
    assert.equal(f.operations.size,0);assert.equal(f.state.verified,0);assert.equal(f.state.pages,0);
    retainReplayProof(f,{state:receipt.state,code:receipt.code,snapshots:0,dispatches:0,admissions:0});
  }));
test('all-uncited agent facts save as explicit rejections with null locators and no invented page inspection',options,
  ()=>withSubject(async()=>{
    const f=towerReplayFixture();
    const output=JSON.parse(readFileSync('docs/evidence/gf-ai/documents/d2/control-output.json','utf8'));
    output.floorExpressions[0].citations=[];output.labels[0].citations=[];await recordTowerControl(f,output);
    const receipt=await replayTower(f),saved=receipt.snapshot;assert(saved);
    assert.equal(saved.packet.proposals.length,0);assert.equal(saved.packet.rejected.length,2);
    assert(saved.packet.rejected.every(r=>r.reason==='missing_citation'&&r.locator===null&&r.agentFact));
    assert.equal(saved.locatorWarnings.length,0);assert.equal(f.state.pages,0);assert.equal(f.state.verified,1);
    assert.deepEqual(await f.service.read(f.caseId,f.sourceId,saved.snapshotId),saved);
    assert.equal((await f.service.history(f.caseId,f.sourceId)).references[0].rejectedCount,2);
    assert.equal(receipt.dispatches,0);assert.equal(receipt.admissions,0);
  }));
