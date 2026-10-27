import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import type {transaction} from '../packages/server/src/infrastructure/db';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {SpatialSourceReviewsService,spatialSourceReviewPin} from '../packages/server/src/modules/spatial/spatial-ml-source-review';
import {spatialMlSourceAuthorityTx} from '../packages/server/src/modules/spatial/spatial-ml-source';
import {SpatialSourceReviewRequestSchema,SpatialSourceReviewSchema,SpatialSourceReviewsHistorySchema,
  SpatialSourceReviewsHistoryQuerySchema} from '../packages/contracts/src/spatial-ml-source-review';
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
    onLock:undefined as undefined|(()=>void),onInsert:undefined as undefined|(()=>void),onHistoryRead:undefined as undefined|(()=>void),
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
    if(sql.startsWith('SELECT id,case_id,source_id,package_id,scope,source_scope'))return rows(v[0]===state.batch.id?[state.batch]:[]);
    if(sql.startsWith('SELECT id,batch_id,package_id,source_id,current_job_id'))return rows([{...row,current_job_id:record.item.currentJobId}]);
    if(sql.startsWith('SELECT id,case_id,source_id,operation')){
      if(sql.endsWith('FOR SHARE')){assert(itemLocked);jobLocked=true;}return rows(v[0]===state.job.id?[state.job]:[]);
    }
    if(sql.startsWith('SELECT payload_hash,result FROM operations')){
      const value=operations.get(`${v[0]}|${v[1]}|${v[2]}`);return rows(value?[value]:[]);
    }
    if(sql.startsWith('SELECT operation_key FROM operations')){
      assert(caseLocked&&sourceLocked&&itemLocked&&jobLocked);assert(v[5]>=2&&v[5]<=11);
      assert(sql.includes('operation_key>$3 AND operation_key<$4')&&sql.includes('ORDER BY operation_key ASC LIMIT $6'));
      const keys=[...operations].filter(([k,r])=>{const [c,key,kind]=k.split('|');
        return c===v[0]&&kind===v[1]&&key>v[2]&&key<v[3]&&r.result.snapshot?.pin.itemId===v[4];})
        .map(([k])=>k.split('|')[1]).sort().slice(0,v[5]);state.onHistoryRead?.();return rows(keys.map(operation_key=>({operation_key})));
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
  const otherSourceId=before.sources.find((r:any)=>r.id!==source.id).id;
  return {service,state,record,originalRecord,operations,request,itemId,otherSourceId};
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
test('canonical batch source drift during verified I/O and mismatched batch case refuse without operation inserts',options,()=>withSubject(async()=>{
  const f=await harness(),request=f.request(),originalScope=structuredClone(f.state.batch.source_scope);
  f.state.onIo=()=>{f.state.batch.source_id=f.otherSourceId;};
  await assert.rejects(f.service.review(f.itemId,request),error(409));
  assert(f.state.artifactReads>0,'The canonical batch drift occurs during verified artifact I/O.');
  assert.deepEqual(f.state.batch.source_scope,originalScope,'The JSON scope stays unchanged while its canonical source pointer drifts.');
  assert.equal(f.operations.size,0);assert.equal(f.state.inserts,0);
  f.state.onIo=undefined;f.state.batch.source_id=request.pin.scope.sourceId;f.state.batch.case_id=randomUUID();
  const reads=f.state.originalReads;
  await assert.rejects(f.service.context(f.itemId),error(409));assert.equal(f.state.originalReads,reads);
  assert.equal(f.operations.size,0);assert.equal(f.state.inserts,0);
}));
test('raw-stream controller refuses malformed UTF-8 before save and retains multilingual and astral reasons',options,()=>withSubject(async()=>{
  const f=await harness(),input=f.request(),seen:any[]=[];
  const controller=new SpatialSourceReviewsController({review:async(itemId:string,raw:unknown)=>{seen.push({itemId,raw});return raw;}} as any);
  const request=(chunks:Buffer[])=>Object.assign(Readable.from(chunks),{headers:{'content-type':'application/json'},
    originalUrl:`/api/v1/spatial-ml/items/${f.itemId}/source-reviews`}) as any;
  const placeholder='UTF8_CONTROL_TOKEN',badText=JSON.stringify({...input,decisions:[{...input.decisions[0],reason:placeholder}]}),
    position=badText.indexOf(placeholder);
  const malformed=Buffer.concat([Buffer.from(badText.slice(0,position)),Buffer.from([0xff]),Buffer.from(badText.slice(position+placeholder.length))]);
  await assert.rejects(controller.review(f.itemId,request([malformed])),error(400,'INVALID_JSON'));
  assert.equal(seen.length,0,'Malformed source-review text must never reach the service save.');
  const reason='जाँचा गया ✓ 🧭',valid={...input,decisions:[{...input.decisions[0],reason}]},bytes=Buffer.from(JSON.stringify(valid),'utf8'),
    split=bytes.indexOf(Buffer.from('🧭'))+2;
  await controller.review(f.itemId,request([bytes.subarray(0,split),bytes.subarray(split)]));
  assert.equal(seen.length,1);assert.equal(seen[0].itemId,f.itemId);assert.deepEqual(seen[0].raw,valid);
  assert.equal(seen[0].raw.decisions[0].reason,reason);
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

const historyRoot='E:/BhuAayam-data/task-data/d07-source-review-runtime-20261005-run01';
const historyOptions={skip:options.skip||(!existsSync(historyRoot+'/pg-after.json')?'Retained saved D07 review required.':false)};
async function historyFixture(){
  const f=await harness();await f.service.review(f.itemId,f.request());
  const retained=JSON.parse(readFileSync(historyRoot+'/pg-after.json','utf8')).addedOperations
    .find((v:any)=>v.kind==='spatial-source-review-snapshot/1');
  assert.equal(fingerprint(retained.result),retained.payload_hash,'Retained immutable wrapper is unchanged.');
  assert.equal(retained.result.snapshot.reviewId,'b46216ba-8c6b-4514-9e29-acc793330a5b');
  const envelope=structuredClone([...f.operations.values()].find(v=>v.result.snapshot)!.result),pin=spatialSourceReviewPin(f.record);
  assert.deepEqual(retained.result.snapshot.pin.raster,pin.raster);assert.deepEqual(retained.result.snapshot.pin.mask,pin.mask);
  assert.equal(retained.result.snapshot.pin.transformSha256,pin.transformSha256);
  f.operations.clear();
  // Saved real decisions/reference/time; input/job/item/access pins are the
  // controlled retained-output harness, not a claim of live enrollment.
  const seed=(reviewId:string,itemId=f.itemId,caseId=pin.scope.caseId)=>{
    const result=structuredClone(envelope);result.snapshot=structuredClone(retained.result.snapshot);
    result.snapshot.reviewId=reviewId;result.snapshot.pin=structuredClone(pin);result.snapshot.pin.itemId=itemId;
    result.snapshot.pin.scope.caseId=caseId;result.snapshot.review.actor=subject;
    const key=`${caseId}|spatial-source-review:${reviewId}|spatial-source-review-snapshot/1`;
    f.operations.set(key,{payload_hash:fingerprint(result),result});return key;
  };
  seed(retained.result.snapshot.reviewId);return {...f,seed,retained:retained.result.snapshot};
}
test('history discovers retained D07 review and exact reader with bounded ordering and zero mutations',historyOptions,()=>withSubject(async()=>{
  const f=await historyFixture(),actual=f.retained.reviewId,small='00000001-0000-4000-8000-000000000001';
  f.seed(small);f.seed('00000002-0000-4000-8000-000000000002',randomUUID());
  f.seed('00000003-0000-4000-8000-000000000003',f.itemId,randomUUID());
  const before=structuredClone(f.operations),record=structuredClone(f.record),inserts=f.state.inserts;
  const first=await f.service.history(f.itemId,{limit:'1'});assert(SpatialSourceReviewsHistorySchema.safeParse(first).success);
  assert.deepEqual(first.references.map(r=>r.reviewId),[small]);assert.equal(first.hasMore,true);assert.equal(first.nextAfter,small);
  const last=await f.service.history(f.itemId,{after:first.nextAfter,limit:'1'});
  assert.deepEqual(last.references.map(r=>r.reviewId),[actual]);assert.equal(last.hasMore,false);assert.equal(last.nextAfter,null);
  const ref=last.references[0],read=await f.service.read(f.itemId,ref.reviewId);
  assert.equal(ref.reviewSha256,fingerprint(read));assert.equal(ref.resultSha256,read.pin.resultSha256);
  assert.equal(ref.candidateCount,100);assert.equal(ref.decisionCount,read.decisions.length);assert.deepEqual(ref.review,read.review);
  assert.equal(ref.readUrl,`/api/v1/spatial-ml/items/${f.itemId}/source-reviews/${actual}`);
  assert.equal('decisions' in ref,false);assert.equal('candidates' in ref,false);assert.equal(ref.limits.learningLabel,false);
  const empty=await f.service.history(f.itemId,{after:actual});assert.deepEqual(empty.references,[]);assert.equal(empty.hasMore,false);
  assert.deepEqual(f.operations,before);assert.deepEqual(f.record,record);assert.equal(f.state.inserts,inserts);
}));
test('history refuses wrong-item cursors, corruption, stale pins and canonical batch/access drift after reads without writes',historyOptions,()=>withSubject(async()=>{
  const f=await historyFixture(),foreign='00000002-0000-4000-8000-000000000002';f.seed(foreign,randomUUID());
  const reads=f.state.originalReads,inserts=f.state.inserts,before=structuredClone(f.operations);
  await assert.rejects(f.service.history(f.itemId,{after:foreign}),error(422,'ML_REVIEW_SNAPSHOT_INTEGRITY'));
  assert.equal(f.state.originalReads,reads);f.state.archived=true;
  await assert.rejects(f.service.history(f.itemId),error(403));assert.equal(f.state.originalReads,reads);
  f.state.archived=false;f.state.onIo=()=>{f.state.batch.source_id=f.otherSourceId;};
  await assert.rejects(f.service.history(f.itemId),error(409));f.state.onIo=undefined;f.state.batch.source_id=f.record.item.scope.sourceId;
  f.state.onHistoryRead=()=>{f.state.batch.case_id=randomUUID();};await assert.rejects(f.service.history(f.itemId),error(409));
  f.state.onHistoryRead=undefined;f.state.batch.case_id=f.record.item.scope.caseId;
  f.state.onHistoryRead=()=>{f.state.owner='revoked-after-read';};await assert.rejects(f.service.history(f.itemId),error(403));
  f.state.onHistoryRead=undefined;f.state.owner=subject;
  const ownKey=[...f.operations.keys()].find(k=>k.includes(f.retained.reviewId))!,own=f.operations.get(ownKey)!;
  const original=structuredClone(own);own.result.snapshot.pin.resultSha256='f'.repeat(64);own.payload_hash=fingerprint(own.result);
  await assert.rejects(f.service.history(f.itemId),error(409),'A schema-valid rehashed stale snapshot is not silently made current.');
  f.operations.set(ownKey,structuredClone(original));f.operations.get(ownKey)!.result.snapshot.decisions[0].reason='tampered';
  await assert.rejects(f.service.history(f.itemId),error(422,'ML_REVIEW_SNAPSHOT_INTEGRITY'));
  f.operations.set(ownKey,original);assert.deepEqual(f.operations,before);assert.equal(f.state.inserts,inserts);
}));
test('history controller keeps static context separate from review IDs and preserves private no-store strict queries',()=>{
  const seen:any[]=[],controller=new SpatialSourceReviewsController({history:(...args:any[])=>{seen.push(args);return args;},
    context:()=>null,read:()=>null} as any),request=(query='')=>({originalUrl:'/source-reviews'+query}) as any;
  controller.history('item',request('?limit=2'));assert.deepEqual({...seen[0][1]},{limit:'2'});
  assert.equal(SpatialSourceReviewsHistoryQuerySchema.parse({}).limit,5);
  for(const q of ['?limit=0','?limit=11','?limit=1&limit=2','?after=context','?actor=caller'])
    assert.throws(()=>controller.history('item',request(q)));
  assert.equal(seen.length,1);assert.throws(()=>controller.context('item',request('?limit=1')),error(422));
  assert.throws(()=>controller.read('item','review',request('?limit=1')),error(422));
  const handler=SpatialSourceReviewsController.prototype.history;
  assert.deepEqual(Reflect.getMetadata('__guards__',SpatialSourceReviewsController),[PrivateSpatialGuard]);
  assert.equal(Reflect.getMetadata('path',handler),'/');assert.equal(Reflect.getMetadata('method',handler),0);
  assert.equal(Reflect.getMetadata('path',SpatialSourceReviewsController.prototype.context),'context');
  assert.equal(Reflect.getMetadata('path',SpatialSourceReviewsController.prototype.read),':reviewId');
  assert.equal(Reflect.getMetadata('swagger/apiOperation',handler).operationId,'GET_api_v1_spatial_ml_items_itemId_source_reviews');
  assert(Reflect.getMetadata('__headers__',handler).some((h:any)=>h.name==='Cache-Control'&&h.value==='private, no-store'));
});
