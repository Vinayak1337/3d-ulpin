import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import type {PoolClient} from 'pg';
import type {transaction} from '../packages/server/src/infrastructure/db';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {SpatialSourceReviewsService,spatialSourceReviewPin} from '../packages/server/src/modules/spatial/spatial-ml-source-review';
import {spatialMlSourceAuthorityTx} from '../packages/server/src/modules/spatial/spatial-ml-source';
import {SpatialSourceReviewRequestSchema,SpatialSourceReviewSchema} from '../packages/contracts/src/spatial-ml-source-review';
import {SpatialSourceReviewsController} from '../apps/api/src/modules/spatial/spatial-ml-source-review.controller';
import {PrivateSpatialGuard} from '../apps/api/src/modules/spatial/private-spatial.guard';

const root=process.env.ULPIN_SOURCE_REVIEW_FIXTURE??'E:/BhuAayam-data/task-data/d07-source-only-spatial-runtime-20261005-run02';
const available=existsSync(root+'/pg-after.json')&&existsSync(root+'/pg-before.json');
const options={skip:available?false:'Retained actual D07 run02 output is required; no substitute predictions generated.'};
const subject='source-review-controlled-process';
const error=(status:number,code?:string)=>(e:unknown)=>e instanceof AppError&&e.status===status&&(!code||e.code===code);
const json=(path:string)=>JSON.parse(readFileSync(root+'/'+path,'utf8'));
// Unchanged real 100-component output (including MultiPolygon and omissions).
// SQL, source authority/access/input pins and transport are controlled envelopes,
// not an enrolled current job or a live save/read/accuracy/learning qualification.
async function harness(){
  const after=json('pg-after.json'),before=json('pg-before.json').state;
  const row=structuredClone(after.owned.item),record={item:row.body,privateInput:row.private_input};
  assert.equal(spatialSourceReviewPin(record).jobId,after.owned.job.id,'Retained authentic output passes pin validation unchanged.');
  const source=structuredClone(before.sources.find((r:any)=>r.id===record.item.scope.sourceId));
  source.inspection.documentOriginal.subject=subject;
  const scope=record.item.scope,caseId=scope.caseId,itemId=record.item.id;
  const state={archived:false,revision:scope.caseRevision,latest:scope.sourceRevision,owner:subject,
    originalReads:0,artifactReads:0,inserts:0,onIo:undefined as undefined|(()=>void),
    onLock:undefined as undefined|(()=>void),onInsert:undefined as undefined|(()=>void),
    job:structuredClone(after.owned.job),batch:structuredClone(after.owned.batch)};
  const operations=new Map<string,{payload_hash:string;result:any}>();
  let writeScope=false,caseLocked=false,sourceLocked=false,itemLocked=false,jobLocked=false;
  const client={query:async(sql:string,v:any[]=[])=>{
    const rows=(value:any[])=>({rows:structuredClone(value)});
    if(sql.startsWith('SELECT body,private_input')){
      if(sql.endsWith('FOR UPDATE')){assert(writeScope&&caseLocked&&sourceLocked);itemLocked=true;}
      return rows(v[0]===itemId?[{body:record.item,private_input:record.privateInput}]:[]);
    }
    if(sql.startsWith('SELECT id FROM cases')){assert(writeScope);state.onLock?.();caseLocked=true;return rows([{id:caseId}]);}
    if(sql.includes('family_id=(SELECT family_id')){assert(caseLocked);sourceLocked=true;return rows([{id:source.id}]);}
    if(sql.startsWith('SELECT case_id FROM sources'))return rows(v[0]===source.id?[{case_id:caseId}]:[]);
    if(sql.startsWith('SELECT id,revision,archived'))return rows([{id:caseId,revision:state.revision,archived:state.archived,
      frame:{id:'UNASSIGNED',horizontalUnit:'m',verticalUnit:'m',benchmark:'UNASSIGNED'},context:[],site_id:null}]);
    if(sql.startsWith('SELECT * FROM sources'))return rows(v[0]===caseId&&v[1]===source.id?
      [{...source,inspection:{...source.inspection,documentOriginal:{...source.inspection.documentOriginal,subject:state.owner}}}]:[]);
    if(sql.startsWith('SELECT max(revision)'))return rows([{revision:state.latest}]);
    if(sql.startsWith('SELECT id,package_id,scope,source_scope'))return rows(v[0]===state.batch.id?[state.batch]:[]);
    if(sql.startsWith('SELECT id,batch_id,package_id,source_id,current_job_id'))return rows([{...row,current_job_id:record.item.currentJobId}]);
    if(sql.startsWith('SELECT id,case_id,source_id,operation')){
      if(sql.endsWith('FOR SHARE')){assert(itemLocked);jobLocked=true;}return rows(v[0]===state.job.id?[state.job]:[]);
    }
    if(sql.startsWith('SELECT payload_hash,result FROM operations')){
      const value=operations.get(`${v[0]}|${v[1]}|${v[2]}`);return rows(value?[value]:[]);
    }
    if(sql.startsWith('INSERT INTO operations')){
      assert(writeScope&&caseLocked&&sourceLocked&&itemLocked&&jobLocked,'Insert only after all final authority locks.');
      const key=`${v[0]}|${v[1]}|${v[2]}`;assert(!operations.has(key),'Immutable snapshot/request keys must not be overwritten.');
      operations.set(key,{payload_hash:v[3],result:structuredClone(v[4])});state.inserts++;state.onInsert?.();return rows([]);
    }
    throw new Error('Unexpected controlled SQL: '+sql);
  }} as unknown as PoolClient;
  const authority=await spatialMlSourceAuthorityTx(client,scope);
  // Re-pin the technical access context; actual model/candidate/mask/transform
  // values remain intact. This is not a claimed authentic accepted-job replay.
  record.privateInput.sourceAuthority=authority;
  const payload=record.privateInput.payload,{inputFingerprint:_,...spec}=payload;
  payload.inputFingerprint=fingerprint({spec,scope,authoritySha256:authority.authoritySha256});
  record.item.inputFingerprint=payload.inputFingerprint;
  record.item.result.receipt.inputFingerprint=payload.inputFingerprint;
  const output=record.privateInput.outputs[record.item.currentJobId];
  output.result=structuredClone(record.item.result);output.processorReceipt.inputFingerprint=payload.inputFingerprint;
  state.job.payload=structuredClone(payload);state.job.input_fingerprint=payload.inputFingerprint;
  const originalRecord=structuredClone(record);
  let tail:Promise<unknown>=Promise.resolve();
  const tx=(async(action:any,deadline:any,mode:any)=>{
    const run=tail.then(async()=>{
      assert(deadline.deadlineAt>Date.now());writeScope=mode===undefined;
      caseLocked=sourceLocked=itemLocked=jobLocked=false;const prior=structuredClone(operations);
      try{return await action(client);}catch(e){operations.clear();for(const [k,v] of prior)operations.set(k,v);throw e;}
      finally{writeScope=false;caseLocked=sourceLocked=itemLocked=jobLocked=false;}
    });tail=run.catch(()=>{});return run;
  }) as typeof transaction;
  const service=new SpatialSourceReviewsService({transaction:tx,current:async(selected,expected)=>{
    assert(!caseLocked&&!sourceLocked&&!itemLocked,'Original I/O outside insertion locks.');
    assert.deepEqual(selected,scope);assert.deepEqual(expected,authority);state.originalReads++;state.onIo?.();
  },read:async(key,bytes,hash,maxBytes,deadline)=>{
    assert(!caseLocked&&!sourceLocked&&!itemLocked,'Artifact I/O outside insertion locks.');assert(deadline>Date.now());
    assert(maxBytes>=bytes);const kind=key.includes('/raster/')?'raster':'mask';
    const data=readFileSync(root+'/'+kind+'.png');assert.equal(data.length,bytes);assert.equal(sha256(data),hash);
    state.artifactReads++;state.onIo?.();return data;
  }});
  const request=()=>({requestKey:randomUUID(),pin:spatialSourceReviewPin(record),decisions:
    record.item.result.components.slice(0,3).map((c:any,i:number)=>({componentId:c.id,
      decision:['reviewed','rejected','needs_input'][i],reason:['Inspected retained pixels; physical target remains unknown.',
        'Reject this prediction; source support is insufficient.','Need source clarification before an inspection conclusion.'][i]}))});
  return {service,state,record,originalRecord,operations,request,itemId};
}
async function withSubject(work:()=>Promise<void>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}
test('retained real 100 predictions: context, immutable save/replay/read and independent later decision preserve mask and omissions',options,()=>withSubject(async()=>{
  const f=await harness(),context=await f.service.context(f.itemId),request=f.request();
  assert.equal(context.candidates.length,100);assert.equal(context.pin.transformSha256,fingerprint(f.record.item.result.receipt.rasterTransform));
  assert(f.record.item.result.components.some((c:any)=>c.geometry.type==='MultiPolygon'));
  const omissions=structuredClone(f.record.item.result.receipt.floorRepresentation);
  const saved=await f.service.review(f.itemId,request);assert(SpatialSourceReviewSchema.safeParse(saved).success);
  assert.equal(saved.candidateCount,100);assert.equal(saved.unselectedCount,97);assert.equal(saved.review.actor,subject);
  assert.equal(saved.review.humanAuthenticated,false);assert.equal(saved.limits.learningLabel,false);
  assert.deepEqual(saved.decisions,request.decisions);assert.equal(f.operations.size,2);
  assert.deepEqual(await f.service.review(f.itemId,request),saved);assert.equal(f.operations.size,2);
  assert.deepEqual(await f.service.read(f.itemId,saved.reviewId),saved);
  await assert.rejects(f.service.review(f.itemId,{...request,decisions:[{...request.decisions[0],reason:'Changed reason'}]}),error(409));
  const next=await f.service.review(f.itemId,{...request,requestKey:randomUUID(),decisions:[{...request.decisions[0],decision:'needs_input'}]});
  assert.notEqual(next.reviewId,saved.reviewId);assert.equal(f.operations.size,4);
  assert.deepEqual(await f.service.read(f.itemId,saved.reviewId),saved);
  const receipt=[...f.operations.entries()].find(([key])=>key.includes(`spatial-source-review-request:${request.requestKey}|`))![1];
  receipt.result.reviewId=next.reviewId;
  await assert.rejects(f.service.review(f.itemId,request),error(422,'ML_REVIEW_SNAPSHOT_INTEGRITY'));
  receipt.result.reviewId=saved.reviewId;
  assert.deepEqual(f.record,f.originalRecord);assert.deepEqual(f.record.item.result.receipt.floorRepresentation,omissions);
}));
test('wrong selections, source/model/result/transform pins and incomplete/cancelled registered jobs refuse before I/O or inserts',options,()=>withSubject(async()=>{
  const f=await harness(),request=f.request();
  for(const pin of [{...request.pin,model:{...request.pin.model,sha256:'f'.repeat(64)}},
    {...request.pin,resultSha256:'f'.repeat(64)},{...request.pin,transformSha256:'f'.repeat(64)},
    {...request.pin,scope:{...request.pin.scope,sourceId:randomUUID()}}])
    await assert.rejects(f.service.review(f.itemId,{...request,pin}),error(409));
  await assert.rejects(f.service.review(f.itemId,{...request,decisions:[{...request.decisions[0],componentId:randomUUID()}]}),error(422,'ML_REVIEW_SELECTION'));
  f.state.job.status='cancelled';await assert.rejects(f.service.review(f.itemId,request),error(409));
  f.state.job.status='succeeded';f.state.job.payload.modelId='wrong-model';
  await assert.rejects(f.service.review(f.itemId,request),error(422,'ML_REVIEW_JOB_INTEGRITY'));
  assert.equal(f.state.originalReads,0);assert.equal(f.operations.size,0);
}));
test('source/access drift after retained artifact I/O and immediately before locked insert refuses; saved private reads recheck authority',options,()=>withSubject(async()=>{
  const f=await harness(),request=f.request();f.state.onIo=()=>{f.state.latest=2;};
  await assert.rejects(f.service.review(f.itemId,request),error(409));assert.equal(f.operations.size,0);
  f.state.latest=1;f.state.onIo=undefined;f.state.onLock=()=>{f.state.owner='different-process';};
  await assert.rejects(f.service.review(f.itemId,request),error(403));assert.equal(f.operations.size,0);
  f.state.owner=subject;f.state.onLock=undefined;const saved=await f.service.review(f.itemId,request);
  f.state.archived=true;const reads=f.state.originalReads;
  await assert.rejects(f.service.read(f.itemId,saved.reviewId),error(403));assert.equal(f.state.originalReads,reads);
  f.state.archived=false;f.state.onIo=()=>{f.state.job.status='cancelled';};
  await assert.rejects(f.service.read(f.itemId,saved.reviewId),error(409));assert.equal(f.operations.size,2);
  const late=await harness();late.state.onInsert=()=>{late.state.owner='revoked-at-final-fence';};
  await assert.rejects(late.service.review(late.itemId,late.request()),error(403));
  assert.equal(late.operations.size,0,'The final in-transaction recapture rolls back both inserted operations.');
}));
test('snapshot corruption and invalid decision text/duplicates/extra actor fields refuse lossless unsafe writes',options,()=>withSubject(async()=>{
  const f=await harness(),request=f.request();
  for(const raw of [{...request,actor:'caller'}, {...request,decisions:[request.decisions[0],request.decisions[0]]},
    {...request,decisions:[{...request.decisions[0],reason:'\u0000'}]}, {...request,decisions:[{...request.decisions[0],reason:'\ud800'}]}])
    assert.equal(SpatialSourceReviewRequestSchema.safeParse(raw).success,false);
  assert(SpatialSourceReviewRequestSchema.safeParse({...request,decisions:[{...request.decisions[0],reason:'Inspected ✓ 🧭'}]}).success);
  const saved=await f.service.review(f.itemId,request);
  const snapshot=[...f.operations.values()].find(v=>v.result.snapshot)!;snapshot.result.snapshot.decisions[0].reason='tampered';
  await assert.rejects(f.service.read(f.itemId,saved.reviewId),error(422,'ML_REVIEW_SNAPSHOT_INTEGRITY'));
  assert.equal(f.operations.size,2);
}));
test('private no-store controller advertises three typed routes and delegates exact IDs without caller attribution',async()=>{
  assert.deepEqual(Reflect.getMetadata('__guards__',SpatialSourceReviewsController),[PrivateSpatialGuard]);
  const seen:any[]=[];const controller=new SpatialSourceReviewsController({context:async(id:string)=>{seen.push(id);return {}},
    read:async(item:string,review:string)=>{seen.push(item,review);return {}}} as any);
  for(const name of ['context','review','read'] as const){
    const handler=SpatialSourceReviewsController.prototype[name];
    assert(Reflect.getMetadata('swagger/apiOperation',handler)?.operationId);
    assert(Reflect.getMetadata('__headers__',handler).some((h:any)=>h.name==='Cache-Control'&&h.value==='private, no-store'));
  }
  const item=randomUUID(),review=randomUUID(),request={originalUrl:'/exact'} as any;
  await controller.context(item,request);await controller.read(item,review,request);assert.deepEqual(seen,[item,item,review]);
  assert.throws(()=>controller.context(item,{originalUrl:'/exact?actor=caller'} as any),error(422,'ML_REVIEW_QUERY'));
});
