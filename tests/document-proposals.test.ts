import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import type {transaction} from '../packages/server/src/infrastructure/db';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {DocumentProposalsService} from '../packages/server/src/modules/usp/ingestion/document-proposals';
import {DocumentProposalsSaveSchema,DocumentProposalSnapshotViewSchema} from '../packages/contracts/src/usp/document-proposals';
import {DocumentProposalsController} from '../apps/api/src/modules/ingestion/document-proposals.controller';
import {PrivateSpatialGuard} from '../apps/api/src/modules/spatial/private-spatial.guard';

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
function harness(useSecond=false){
  const original=JSON.parse(readFileSync(sourceRows,'utf8')).state;
  const first=fixture().packet.proposals[0].sourceId;
  const records=structuredClone(original.sources);
  for(const r of records)r.inspection.documentOriginal.subject=subject;
  const source=records.find((r:any)=>useSecond?r.id!==first:r.id===first),caseId=source.case_id,sourceId=source.id;
  const request=()=>inputFor(sourceId),frame=request().packet.proposals[0].locator.frame;
  const state={revision:2,archived:false,owner:subject,latest:1,pages:0,verified:0,inserts:0,
    onPage:undefined as undefined|(()=>void),onVerify:undefined as undefined|(()=>void),
    onLock:undefined as undefined|(()=>void),onInsert:undefined as undefined|(()=>void),pageFrame:frame};
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
  const service=new DocumentProposalsService({transaction:tx,verify:async(a,deadline)=>{
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
  return {service,state,operations,request,caseId,sourceId};
}
async function withSubject(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}

test('actual T3-2 ten cited proposals save/exact-read/replay with literal caption/conflict and provisional provenance',options,()=>withSubject(async()=>{
  const f=harness(),input=f.request(),saved=await f.service.save(f.caseId,f.sourceId,input);
  assert(DocumentProposalSnapshotViewSchema.safeParse(saved).success);assert.equal(saved.packet.proposals.length,10);
  assert.equal(saved.packet.proposals[0].quote,'TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)');
  assert.deepEqual(saved.packet,input.packet);assert.equal(saved.packet.conflicts.length,1);
  assert.equal(saved.method,'caller_supplied_provisional');assert.equal(saved.provenanceAuthority,'caller_supplied_unverified');
  assert.equal(saved.review.actor,subject);assert.equal(saved.review.humanAuthenticated,false);assert.equal(saved.review.independentGroundTruth,false);
  assert.equal(saved.quotationVerification,'not_machine_verified');assert.equal(saved.learningLabel,false);assert.equal(saved.canonicalTarget,null);
  assert.equal(f.state.pages,1);assert.equal(f.operations.size,2);
  assert.deepEqual(await f.service.save(f.caseId,f.sourceId,input),saved);assert.equal(f.state.pages,1);assert.equal(f.operations.size,2);
  assert.deepEqual(await f.service.read(f.caseId,f.sourceId,saved.snapshotId),saved);
  await assert.rejects(f.service.save(f.caseId,f.sourceId,{...input,packet:{...input.packet,unknowns:[...input.packet.unknowns,'changed']}}),error(409));
  f.state.revision=3;const later=await f.service.read(f.caseId,f.sourceId,saved.snapshotId);
  assert.equal(later.currentCaseRevision,3);assert.equal(later.caseRevision,2);assert.deepEqual(later.packet,input.packet);
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
