import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {DocumentClaimsService} from '../packages/server/src/modules/usp/ingestion/document-claims';
import {DocumentClaimsReviewRequestSchema,DocumentClaimReviewSchema} from '../packages/contracts/src/usp/document-claims';
import {DocumentPagesSchema} from '../packages/contracts/src/document-pages';
import {AppError} from '../packages/server/src/infrastructure/errors';
import type {transaction} from '../packages/server/src/infrastructure/db';
import {DocumentClaimsController} from '../apps/api/src/modules/ingestion/document-claims.controller';
import {PrivateSpatialGuard} from '../apps/api/src/modules/spatial/private-spatial.guard';

// Actual D02 quotes/hashes/lengths; SQL rows, UUIDs and page transport are controls,
// not enrolled operational records, accepted jobs or machine-verified quotations.
const caseId='2da6d171-14eb-442e-99b6-f4d557d2bd64';
const first='dd273d9a-73fd-45af-80a6-957b22349311',second='20d1d9d0-09bc-47bb-8f3b-c7c1bf0061a6';
const subject='document-claims-controlled-process';
const frame={kind:'pdf_display_page_top_left_points' as const,rotation:0,width:2586,height:1694};
const sources=[{sourceId:first,sourceRevision:1,sourceSha256:'2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1'},
  {sourceId:second,sourceRevision:1,sourceSha256:'26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9'}];
const request=()=>({requestKey:randomUUID(),expectedCaseRevision:2,sources,claims:[
  {sourceId:first,kind:'floor_caption' as const,quote:'TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)',
    locator:{page:1,label:'main Floor-02 caption',region:{frame,box:[1820,750,2130,825] as [number,number,number,number]}}},
  ...['central T-3 graphic','lower UNIT DETAIL','lower TOWER AREA DETAIL'].map((label,i)=>({
    sourceId:second,kind:'stack_statement' as const,quote:i===0?'G+41':'G+42',locator:{page:1,label}}))],
  conflicts:[{claimOrdinals:[1,2,3],reason:'Drawing graphic and two tables disagree; retain all statements without a winner.'}],
  reviewReason:'Controlled manual transcription of retained D02 observations; approval and canonical floor links remain unresolved.'});
const error=(status:number,code:string)=>(value:unknown)=>value instanceof AppError&&value.status===status&&value.code===code;

function harness(){
  const operations=new Map<string,{payload_hash:string;result:any}>();
  const state={revision:2,archived:false,owner:subject,latest:1,pages:0,inserts:0,reads:0,
    afterPage:undefined as undefined|(()=>void),beforeInsert:undefined as undefined|(()=>void),
    onOperationRead:undefined as undefined|(()=>void),onCaseRead:undefined as undefined|(()=>void)};
  const records=sources.map((pin,i)=>({id:pin.sourceId,case_id:caseId,family_id:pin.sourceId,revision:pin.sourceRevision,
    sha256:pin.sourceSha256,bytes:i===0?1630108:3782332,name:i===0?'T3-2.pdf':'S-001.pdf',object_key:`controlled/${pin.sourceId}`,
    inspection:{documentOriginal:{version:'source-document/1',format:'pdf',sha256:pin.sourceSha256,
      bytes:i===0?1630108:3782332,subject,receivedAt:'2026-10-05T00:00:00Z'}}}));
  let writeScope=false,caseLocked=false,sourceLocked=false;
  const client={query:async(sql:string,values:any[]=[])=>{
    if(sql.startsWith('SET TRANSACTION'))return {rows:[]};
    if(sql.startsWith('SELECT id,revision,archived')){
      state.onCaseRead?.();
      if(sql.endsWith('FOR UPDATE')){assert(writeScope);caseLocked=true;}
      return {rows:[{id:caseId,revision:state.revision,archived:state.archived,
        frame:{id:'UNASSIGNED',horizontalUnit:'m',verticalUnit:'m',benchmark:'UNASSIGNED'},context:[],site_id:null}]};
    }
    if(sql.startsWith('SELECT id FROM sources')){assert(caseLocked);sourceLocked=true;return {rows:records.map(row=>({id:row.id}))};}
    if(sql.startsWith('SELECT case_id FROM sources'))return {rows:records.filter(row=>row.id===values[0]).map(row=>({case_id:row.case_id}))};
    if(sql.startsWith('SELECT * FROM sources'))return {rows:records.filter(row=>row.id===values[1]&&row.case_id===values[0])
      .map(row=>({...row,inspection:{documentOriginal:{...row.inspection.documentOriginal,subject:state.owner}}}))};
    if(sql.startsWith('SELECT max(revision)'))return {rows:[{revision:state.latest}]};
    if(sql.startsWith('SELECT payload_hash,result FROM operations')){
      state.reads++;state.onOperationRead?.();
      const row=operations.get(`${values[1]}|${values[2]}`);return {rows:row?[structuredClone(row)]:[]};
    }
    if(sql.startsWith('SELECT max((result'))return {rows:[{revision:Math.max(0,...[...operations.entries()]
      .filter(([key])=>key.startsWith(values[2].slice(0,-1))).map(([,row])=>row.result.snapshot.reviewRevision))}]};
    if(sql.startsWith('INSERT INTO operations')){
      assert(writeScope&&caseLocked&&sourceLocked,'Only insert after final case/source locks.');state.beforeInsert?.();
      const key=`${values[1]}|${values[2]}`;assert(!operations.has(key),'No snapshot update or duplicate insert.');
      operations.set(key,{payload_hash:values[3],result:structuredClone(values[4])});state.inserts++;return {rows:[]};
    }
    throw new Error(`Unexpected controlled SQL: ${sql}`);
  }} as unknown as PoolClient;
  // Serialize the controlled connections; this exercises service replay branches,
  // not PostgreSQL lock/concurrency performance or live transactional durability.
  let tail:Promise<unknown>=Promise.resolve();
  const tx=(async(action:any,options:any)=>{
    const run=tail.then(async()=>{
      assert(options.deadlineAt>Date.now());writeScope=true;caseLocked=false;sourceLocked=false;
      const prior=structuredClone(operations);
      try{return await action(client);}catch(e){operations.clear();for(const [key,row] of prior)operations.set(key,row);throw e;}
      finally{writeScope=false;caseLocked=false;sourceLocked=false;}
    });tail=run.catch(()=>{});return run;
  }) as typeof transaction;
  const service=new DocumentClaimsService({transaction:tx,pages:async(id,raw)=>{
    assert(!caseLocked&&!sourceLocked,'Never fetch original/page metadata under insertion locks.');state.pages++;
    const pin=sources.find(source=>source.sourceId===id)!,record=records.find(row=>row.id===id)!;
    const query=raw as Record<string,string>;
    assert.equal(query.sha256,pin.sourceSha256);assert.equal(query.revision,String(pin.sourceRevision));
    const pageFrame=id===first?frame:{...frame,width:1000,height:800}; // S-001 frame is a disclosed transport control.
    const result=DocumentPagesSchema.parse({version:'document-pages/1',sourceId:id,caseId,caseRevision:state.revision,
      sourceRevision:pin.sourceRevision,sourceSha256:pin.sourceSha256,sourceBytes:record.bytes,name:record.name,revision:'1',
      pageCount:1,offset:0,limit:1,hasMore:false,pages:[{page:1,label:'Page 1',sourceLabel:null,frame:pageFrame,
        mediaBox:[0,0,pageFrame.width,pageFrame.height],cropBox:[0,0,pageFrame.width,pageFrame.height],
        boxConvention:'pymupdf_page_rectangles/1',renderSupport:id===first?'unsupported':'supported',url:null,
        locator:{kind:'pdf_page',page:1},calibration:null}],anchors:[{locator:'page:1',page:1,region:null}]});
    state.afterPage?.();return result;
  }});
  return {service,state,operations,records};
}
async function withSubject(action:()=>Promise<void>){
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await action();}finally{if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
}

test('actual caption and three conflicting source statements save/read with manual attribution and exact locator pins',()=>withSubject(async()=>{
  const {service,state}=harness(),input=request(),saved=await service.review(caseId,input);
  assert(DocumentClaimReviewSchema.safeParse(saved).success);assert.equal(state.inserts,2);assert.equal(state.pages,2);
  assert.equal(saved.claims[0].quote,input.claims[0].quote);assert.deepEqual(saved.claims[0].locator.region,input.claims[0].locator.region);
  assert.deepEqual(saved.claims.slice(1).map(claim=>claim.quote),['G+41','G+42','G+42']);
  assert.deepEqual(saved.conflicts[0].claimIds,saved.claims.slice(1).map(claim=>claim.claimId));
  assert.equal(saved.conflicts[0].state,'unresolved');assert.equal(saved.canonicalMatchState,'not_assessed');
  assert.equal(saved.quotationVerification,'not_machine_verified');assert.equal(saved.review.actor,subject);
  assert.equal(saved.review.independentGroundTruth,false);assert.equal(saved.review.humanAuthenticated,false);
  assert(!JSON.stringify(saved).includes('controlled/'));assert.equal(saved.method,'human_entry');
  assert.deepEqual(await service.read(caseId,saved.reviewId,{revision:'1'}),saved);
}));

test('same key replays, concurrent controlled requests converge, correction appends while exact predecessor remains readable',()=>withSubject(async()=>{
  const {service,state}=harness(),input=request();
  const [firstResult,secondResult]=await Promise.all([service.review(caseId,input),service.review(caseId,input)]);
  assert.deepEqual(firstResult,secondResult);assert.equal(state.inserts,2);
  const pageReads=state.pages;assert.deepEqual(await service.review(caseId,input),firstResult);assert.equal(state.pages,pageReads);
  await assert.rejects(service.review(caseId,{...input,reviewReason:'Different request under same key'}),error(409,'STALE_REVISION'));
  assert.equal(state.pages,pageReads);
  const revised=await service.review(caseId,{...input,requestKey:randomUUID(),correctionOf:{reviewId:firstResult.reviewId,reviewRevision:1},reviewReason:'New manual review; original claims and conflict retained.'});
  assert.equal(revised.reviewId,firstResult.reviewId);assert.equal(revised.reviewRevision,2);
  assert.deepEqual(await service.read(caseId,firstResult.reviewId,{revision:'1'}),firstResult);
  assert.deepEqual(await service.read(caseId,revised.reviewId,{revision:'2'}),revised);
  await assert.rejects(service.read(caseId,revised.reviewId,{revision:'3'}),error(404,'NOT_FOUND'));
  await assert.rejects(service.review(caseId,{...input,requestKey:randomUUID(),correctionOf:{reviewId:firstResult.reviewId,reviewRevision:1}}),error(409,'STALE_REVISION'));
}));

test('stale/denied originals refuse before page I/O and drift during processing refuses all inserts',()=>withSubject(async()=>{
  for(const control of ['case','source','owner','archived'] as const){
    const {service,state,records}=harness();
    if(control==='case')state.revision=3;if(control==='source')records[0].sha256='0'.repeat(64);
    if(control==='owner')state.owner='other-private-subject';if(control==='archived')state.archived=true;
    await assert.rejects(service.review(caseId,request()),(e:any)=>e instanceof AppError&&[403,409,422].includes(e.status));
    assert.equal(state.pages,0);assert.equal(state.inserts,0);
  }
  const {service,state}=harness();state.afterPage=()=>state.revision++;
  await assert.rejects(service.review(caseId,request()),error(422,'DOCUMENT_CLAIMS_PAGE_INTEGRITY'));
  assert.equal(state.inserts,0);
}));

test('final write boundary and fresh read refuse revocation, source replacement and snapshot tampering',()=>withSubject(async()=>{
  const write=harness();write.state.beforeInsert=()=>write.state.archived=true;
  await assert.rejects(write.service.review(caseId,request()),error(403,'DOCUMENT_DENIED'));assert.equal(write.operations.size,0);
  for(const control of ['owner','source','tampered','late-read'] as const){
    const {service,state,records,operations}=harness(),saved=await service.review(caseId,request());
    if(control==='owner')state.owner='other-private-subject';if(control==='source')records[0].sha256='0'.repeat(64);
    if(control==='tampered'){const row=[...operations.values()].find(row=>row.result.snapshot)!;row.result.snapshot.claims[0].quote='Changed stored text';}
    if(control==='late-read'){let captures=0;state.onCaseRead=()=>{if(++captures===4)state.archived=true;};}
    await assert.rejects(service.read(caseId,saved.reviewId,{revision:'1'}),(e:any)=>e instanceof AppError&&[403,409,422].includes(e.status));
  }
}));

test('strict bounds and frame/claim populations reject fabricated inputs without truncation or actor overrides',()=>withSubject(async()=>{
  const input=request();
  for(const invalid of [{...input,actor:'caller'}, {...input,claims:[{...input.claims[0],quote:'x'.repeat(4097)}]},
    {...input,claims:[{...input.claims[0],quote:'invalid\u0000quote'}]},
    {...input,claims:[{...input.claims[0],quote:'unpaired\ud800'}]},
    {...input,claims:[...input.claims,...Array.from({length:22},()=>input.claims[0])]},
    {...input,conflicts:[{claimOrdinals:[1,1],reason:'duplicate'}]},
    {...input,conflicts:[{claimOrdinals:[1,9],reason:'absent'}]}])assert.equal(DocumentClaimsReviewRequestSchema.safeParse(invalid).success,false);
  const {service,state}=harness();const changed=request();changed.claims[0].locator.region!.frame={...frame,width:2700};
  await assert.rejects(service.review(caseId,changed),error(409,'STALE_REVISION'));assert.equal(state.inserts,0);
  const response=Reflect.getMetadata('swagger/apiResponse',DocumentClaimsController.prototype.review)[201];
  assert(response.schema.properties.claims);assert(response.schema.properties.snapshotSha256);
  const large=harness(),largeInput=request();
  largeInput.claims=Array.from({length:25},(_,i)=>({sourceId:i===0?first:second,kind:'stack_statement' as const,
    quote:'\u0001'.repeat(4095)+'x',locator:{page:1,label:`bounded JSON byte control ${i}`}})) as typeof largeInput.claims;
  await assert.rejects(large.service.review(caseId,largeInput),error(413,'DOCUMENT_CLAIMS_REQUEST_LIMIT'));
  assert.equal(large.state.pages,0);assert.equal(large.state.inserts,0);
}));

test('thin controller declares private guard/no-store and requires one exact revision query',async()=>{
  assert(Reflect.getMetadata('__guards__',DocumentClaimsController).includes(PrivateSpatialGuard));
  assert(Reflect.getMetadata('__headers__',DocumentClaimsController.prototype.read).some((header:any)=>header.name==='Cache-Control'&&header.value.includes('no-store')));
  const controller=new DocumentClaimsController({read:async()=>({controlled:true})} as unknown as DocumentClaimsService);
  assert.throws(()=>controller.read(caseId,randomUUID(),{originalUrl:'/?revision=1&revision=2'} as any),error(422,'DOCUMENT_CLAIMS_QUERY'));
});
