import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {SPATIAL_SOURCE_REVIEW_LIMITS as limits,SpatialSourceReviewPinSchema,SpatialSourceReviewRequestSchema,
  SpatialSourceReviewSchema,SpatialSourceReviewContextSchema,type SpatialSourceReviewPin,type SpatialSourceReview}
  from '../../../../contracts/src/spatial-ml-source-review';
import {transaction} from '../../infrastructure/db';
import {AppError,conflict,notFound} from '../../infrastructure/errors';
import {fingerprint} from '../cases/domain';
import {documentCaseTx} from '../usp/ingestion/document-context';
import {assertIngestionBinding} from '../usp/ingestion/events';
import {getSpatialMlItemRecord,validateSpatialMlPixels,type SpatialMlItemRecord} from './spatial-ml';
import {spatialMlSourceAuthorityTx,spatialMlSourceService,spatialMlSourcePixelReceipt,readSpatialMlObject,
  type SpatialMlSourceAuthority} from './spatial-ml-source';

const id=z.uuid().transform(v=>v.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const snapshotKind='spatial-source-review-snapshot/1',requestKind='spatial-source-review-request/1';
const snapshotKey=(reviewId:string)=>`spatial-source-review:${reviewId}`;
const requestKey=(key:string)=>`spatial-source-review-request:${key}`;
const storedSchema=z.strictObject({snapshot:SpatialSourceReviewSchema,subject:z.string(),accessSha256:hash,
  sourceAuthoritySha256:hash,requestSha256:hash});
type Stored=z.output<typeof storedSchema>;
type Capture={record:SpatialMlItemRecord;pin:SpatialSourceReviewPin;authority:SpatialMlSourceAuthority;
  subject:string;accessSha256:string};
type Dependencies={transaction:typeof transaction;current:typeof spatialMlSourceService.current;read:typeof readSpatialMlObject};
const defaults:Dependencies={transaction,current:(scope,a)=>spatialMlSourceService.current(scope,a),read:readSpatialMlObject};
const qualifications={coordinateUnit:'pixel',physicalTarget:null,calibration:null,canonicalMatchState:'not_assessed',
  qualification:'not_assessed',learningLabel:false,independentGroundTruth:false} as const;
function fail(code:string,message:string):never{throw new AppError(422,code,message);}
function live(deadline:number){if(Date.now()>=deadline)throw new AppError(504,'ML_REVIEW_DEADLINE','Review timed out. Read or replay the exact request key.');}
function bounded(value:unknown,bytes:number){if(Buffer.byteLength(JSON.stringify(value))>bytes)
  throw new AppError(413,'ML_REVIEW_LIMIT','The complete review exceeds its bounded size. No predictions or decisions were truncated.');}
function artifactUrl(itemId:string,jobId:string,kind:string,digest:string){
  return `/api/v1/spatial-ml/items/${itemId}/artifacts/${kind}?jobId=${jobId}&sha256=${digest}`;
}
/** Validates the retained source input and accepted output without re-running a model. */
export function spatialSourceReviewPin(record:SpatialMlItemRecord):SpatialSourceReviewPin{
  const {item,privateInput:p}=record,scope=item.scope,a=p.sourceAuthority,output=p.outputs[item.currentJobId];
  if(scope?.kind!=='source'||!a||item.packageId!==null||item.partId!==null||p.sourcePartHash!==null||
    item.task!=='floor-plan'||item.applications.length||item.footprintDrafts?.length)
    fail('ML_REVIEW_SOURCE_REQUIRED','Select an actual source-only floor-plan item.');
  if(!['succeeded','empty'].includes(item.state)||!item.result||!output)
    conflict('Select the current completed source-only result; cancelled, superseded or unavailable output cannot be reviewed.');
  const result=item.result,payload=p.payload;
  bounded(result,limits.resultBytes);
  if(item.sourceRevisionId!==scope.sourceId||item.sourceSha256!==scope.sourceSha256||item.page!==scope.page||
    a.caseId!==scope.caseId||a.caseRevision!==scope.caseRevision||a.sourceId!==scope.sourceId||a.sourceRevision!==scope.sourceRevision||
    a.sourceSha256!==scope.sourceSha256||a.sourceBytes!==scope.sourceBytes||payload.source.id!==scope.sourceId||
    payload.source.objectKey!==a.objectKey||payload.source.sha256!==scope.sourceSha256||payload.source.bytes!==scope.sourceBytes||
    payload.source.mimeType!=='application/pdf'||payload.schemaVersion!=='spatial-inference/1'||payload.task!==item.task||
    payload.page!==scope.page||fingerprint(payload.region)!==fingerprint(scope.region)||payload.modelId!==item.modelId||
    payload.expectedModelSha256!==item.modelSha256||payload.inputFingerprint!==item.inputFingerprint)
    fail('ML_REVIEW_INPUT_INTEGRITY','The source, model or extraction input differs from its retained authority.');
  const {inputFingerprint:_,...spec}=payload;
  if(fingerprint({spec,scope,authoritySha256:a.authoritySha256})!==item.inputFingerprint||
    fingerprint(result)!==fingerprint(output.result)||result.model.id!==item.modelId||result.model.sha256!==item.modelSha256||
    (item.state==='empty')!==(result.components.length===0)||result.components.length>100)
    fail('ML_REVIEW_RESULT_INTEGRITY','The exact accepted model output or input fingerprint changed.');
  validateSpatialMlPixels(result.components,result.raster.width,result.raster.height);
  const raw=output.processorReceipt;
  if(!raw||raw.sourceId!==scope.sourceId||raw.sourceSha256!==scope.sourceSha256||raw.modelSha256!==item.modelSha256||
    raw.profileVersion!==payload.expectedProfileVersion||raw.inputFingerprint!==item.inputFingerprint)
    fail('ML_REVIEW_RESULT_INTEGRITY','The retained processor receipt has different source/model/profile pins.');
  const receipt={...spatialMlSourcePixelReceipt(scope,{...result.raster,transform:result.receipt.rasterTransform as Record<string,unknown>},raw),
    model:{id:item.modelId,sha256:item.modelSha256,profileVersion:payload.expectedProfileVersion},inputFingerprint:item.inputFingerprint};
  if(fingerprint(receipt)!==fingerprint(result.receipt))fail('ML_REVIEW_RESULT_INTEGRITY','The retained pixel transform or omission receipt changed.');
  const artifacts={} as Pick<SpatialSourceReviewPin,'raster'|'mask'>;
  for(const kind of ['raster','mask'] as const){
    const artifact=output.artifacts[kind],publicArtifact=result[kind];
    if(artifact.objectKey!==`spatial-ml/${item.id}/${item.currentJobId}/${kind}/${artifact.sha256}.png`||artifact.mimeType!=='image/png'||
      publicArtifact.url!==artifactUrl(item.id,item.currentJobId,kind,artifact.sha256)||
      publicArtifact.sha256!==artifact.sha256||publicArtifact.width!==artifact.width||publicArtifact.height!==artifact.height||
      artifact.width!==result.raster.width||artifact.height!==result.raster.height)
      fail('ML_REVIEW_ARTIFACT_INTEGRITY','The artifact receipt differs from the exact result.');
    artifacts[kind]={sha256:artifact.sha256,width:artifact.width,height:artifact.height,bytes:artifact.bytes};
  }
  return SpatialSourceReviewPinSchema.parse({itemId:item.id,batchId:item.batchId,jobId:item.currentJobId,scope,
    inputFingerprint:item.inputFingerprint,model:receipt.model,resultSha256:fingerprint(result),
    transformSha256:fingerprint(receipt.rasterTransform),...artifacts});
}
async function captureTx(client:PoolClient,itemId:string,lock=false):Promise<Capture>{
  const initial=await getSpatialMlItemRecord(itemId,client),pin=spatialSourceReviewPin(initial);
  if(pin.itemId!==itemId)fail('ML_REVIEW_INPUT_INTEGRITY','The selected item row has a different identity.');
  // Canonical case/source family locks precede item and job locks. No storage I/O.
  const authority=await spatialMlSourceAuthorityTx(client,pin.scope,lock);
  const ctx=await documentCaseTx(client,pin.scope.caseId);assertIngestionBinding(ctx.binding);
  const batch=(await client.query(`SELECT id,case_id,source_id,package_id,scope,source_scope FROM spatial_ml_batches WHERE id=$1${lock?' FOR SHARE':''}`,[pin.batchId])).rows[0];
  const record=lock?await getSpatialMlItemRecord(itemId,client,true):initial;
  const current=spatialSourceReviewPin(record);
  const row=(await client.query('SELECT id,batch_id,package_id,source_id,current_job_id FROM spatial_ml_items WHERE id=$1',[itemId])).rows[0];
  if(fingerprint(pin)!==fingerprint(current)||fingerprint(authority)!==fingerprint(record.privateInput.sourceAuthority)||
    !row||row.id!==itemId||row.batch_id!==pin.batchId||row.package_id!==null||row.source_id!==pin.scope.sourceId||row.current_job_id!==pin.jobId||
    !batch||batch.id!==pin.batchId||batch.case_id!==pin.scope.caseId||batch.source_id!==pin.scope.sourceId||
    batch.package_id!==null||batch.scope!=='source'||fingerprint(batch.source_scope)!==fingerprint(pin.scope))
    conflict('The source batch, item, original or private access changed. Refresh the inspection.');
  const job=(await client.query(`SELECT id,case_id,source_id,operation,input_fingerprint,payload,status,completed_at FROM jobs WHERE id=$1${lock?' FOR SHARE':''}`,[pin.jobId])).rows[0];
  const attempt=record.item.attempts.filter(v=>v.jobId===pin.jobId);
  if(!job||job.id!==pin.jobId||job.case_id!==pin.scope.caseId||job.source_id!==pin.scope.sourceId||
    job.operation!=='spatial-inference'||job.input_fingerprint!==pin.inputFingerprint||
    fingerprint(job.payload)!==fingerprint(record.privateInput.payload))
    fail('ML_REVIEW_JOB_INTEGRITY','The registered job belongs to different source/model inputs.');
  if(job.status!=='succeeded'||!job.completed_at||attempt.length!==1||attempt[0].state!==record.item.state||!attempt[0].completedAt)
    conflict('The exact job/attempt is not completed or was superseded or cancelled.');
  return {record,pin:current,authority,subject:ctx.binding.subject,accessSha256:ctx.binding.access};
}
function same(before:Capture,after:Capture){
  if(before.subject!==after.subject||before.accessSha256!==after.accessSha256)
    throw new AppError(403,'ML_REVIEW_ACCESS_CHANGED','The private review access changed.');
  if(fingerprint(before.pin)!==fingerprint(after.pin)||fingerprint(before.authority)!==fingerprint(after.authority)||
    fingerprint(before.record.privateInput.outputs[before.pin.jobId])!==fingerprint(after.record.privateInput.outputs[after.pin.jobId]))
    conflict('The source, model, artifact or exact result changed during inspection.');
}
function selected(capture:Capture,decisions:SpatialSourceReview['decisions']){
  const available=new Set(capture.record.item.result!.components.map(v=>v.id));
  if(decisions.some(v=>!available.has(v.componentId)))fail('ML_REVIEW_SELECTION','Select component IDs from this exact retained output. Mask-only omissions have no selectable geometry.');
}
function view(stored:Stored,current:Capture){
  if(stored.subject!==current.subject||stored.accessSha256!==current.accessSha256)
    throw new AppError(403,'ML_REVIEW_ACCESS_CHANGED','The saved private review is unavailable under current access.');
  if(fingerprint(stored.snapshot.pin)!==fingerprint(current.pin)||stored.sourceAuthoritySha256!==fingerprint(current.authority))
    conflict('The saved review names a stale or different exact source/model/result.');
  selected(current,stored.snapshot.decisions);bounded(stored.snapshot,limits.responseBytes);return stored.snapshot;
}
async function operation(client:PoolClient,caseId:string,key:string,kind:string){
  return (await client.query('SELECT payload_hash,result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3',[caseId,key,kind])).rows[0];
}
async function load(client:PoolClient,current:Capture,reviewId:string):Promise<Stored>{
  const row=await operation(client,current.pin.scope.caseId,snapshotKey(reviewId),snapshotKind);
  if(!row)notFound('The selected source-candidate review was not found.');
  const parsed=storedSchema.safeParse(row.result);
  if(!parsed.success||fingerprint(parsed.data)!==row.payload_hash||parsed.data.snapshot.reviewId!==reviewId||
    parsed.data.snapshot.pin.itemId!==current.pin.itemId||parsed.data.snapshot.review.actor!==parsed.data.subject)
    fail('ML_REVIEW_SNAPSHOT_INTEGRITY','The immutable review failed its integrity check.');
  view(parsed.data,current);return parsed.data;
}
async function replay(client:PoolClient,current:Capture,key:string,digest:string){
  const row=await operation(client,current.pin.scope.caseId,requestKey(key),requestKind);
  if(!row)return null;
  if(row.payload_hash!==digest)conflict('This request key already names different review inputs.');
  const reviewId=id.safeParse(row.result?.reviewId);
  if(!reviewId.success)fail('ML_REVIEW_SNAPSHOT_INTEGRITY','The saved request receipt is invalid.');
  const stored=await load(client,current,reviewId.data);
  if(stored.requestSha256!==digest)fail('ML_REVIEW_SNAPSHOT_INTEGRITY','The request receipt points to a different immutable review.');
  return stored;
}
export class SpatialSourceReviewsService{
  constructor(private readonly dependencies:Dependencies=defaults){}
  private capture(itemId:string,deadline:number){live(deadline);
    return this.dependencies.transaction(client=>captureTx(client,itemId),{deadlineAt:deadline},'repeatable_read_only');}
  private async verify(capture:Capture,deadline:number){
    live(deadline);
    if(deadline-Date.now()<31_000)throw new AppError(504,'ML_REVIEW_DEADLINE','Not enough time remains for bounded original verification.');
    await this.dependencies.current(capture.pin.scope,capture.authority);live(deadline);
    for(const kind of ['raster','mask'] as const){
      const a=capture.record.privateInput.outputs[capture.pin.jobId].artifacts[kind];
      await this.dependencies.read(a.objectKey,a.bytes,a.sha256,limits.artifactBytes,Math.min(deadline,Date.now()+30_000));live(deadline);
    }
  }
  private async finish<T>(before:Capture,deadline:number,action:(client:PoolClient,current:Capture)=>Promise<T>){
    return this.dependencies.transaction(async client=>{
      live(deadline);const current=await captureTx(client,before.pin.itemId,true);same(before,current);
      const result=await action(client,current);same(current,await captureTx(client,current.pin.itemId));live(deadline);return result;
    },{deadlineAt:deadline});
  }
  async context(itemValue:string){
    const itemId=id.parse(itemValue),deadline=Date.now()+limits.seconds*1000,before=await this.capture(itemId,deadline);
    await this.verify(before,deadline);
    return this.finish(before,deadline,async(_,current)=>{
      const result=current.record.item.result!;
      const context=SpatialSourceReviewContextSchema.parse({version:'source-candidate-context/1',pin:current.pin,
        candidates:result.components.map(c=>({componentId:c.id,className:c.className,score:c.score,geometrySha256:fingerprint(c.geometry)})),
        inspection:{itemUrl:`/api/v1/spatial-ml/items/${itemId}`,rasterUrl:result.raster.url,maskUrl:result.mask.url},limits:qualifications});
      bounded(context,limits.responseBytes);return context;
    });
  }
  private async publish(itemId:string,reviewId:string,deadline:number){
    const before=await this.capture(itemId,deadline);
    const stored=await this.dependencies.transaction(client=>load(client,before,reviewId),{deadlineAt:deadline},'repeatable_read_only');
    await this.verify(before,deadline);
    return this.finish(before,deadline,async(client,current)=>{const latest=await load(client,current,reviewId);
      if(fingerprint(stored)!==fingerprint(latest))fail('ML_REVIEW_SNAPSHOT_INTEGRITY','The saved snapshot changed.');return view(latest,current);});
  }
  async read(itemValue:string,reviewValue:string){
    return this.publish(id.parse(itemValue),id.parse(reviewValue),Date.now()+limits.seconds*1000);
  }
  async review(itemValue:string,raw:unknown){
    const itemId=id.parse(itemValue),request=SpatialSourceReviewRequestSchema.parse(raw),deadline=Date.now()+limits.seconds*1000;
    bounded(request,limits.requestBytes);
    const before=await this.capture(itemId,deadline);
    if(itemId!==request.pin.itemId||fingerprint(request.pin)!==fingerprint(before.pin))conflict('Refresh the exact source-candidate inspection pins.');
    selected(before,request.decisions);const digest=fingerprint({itemId,request});
    await this.dependencies.transaction(client=>replay(client,before,request.requestKey,digest),{deadlineAt:deadline},'repeatable_read_only');
    await this.verify(before,deadline);
    const saved=await this.finish(before,deadline,async(client,current)=>{
      const prior=await replay(client,current,request.requestKey,digest);if(prior)return view(prior,current);
      const snapshot=SpatialSourceReviewSchema.parse({version:'source-candidate-review/1',reviewId:randomUUID(),reviewRevision:1,
        pin:current.pin,decisions:request.decisions,candidateCount:current.record.item.result!.components.length,
        unselectedCount:current.record.item.result!.components.length-request.decisions.length,limits:qualifications,
        review:{actor:current.subject,time:new Date().toISOString(),attribution:'local_process',humanAuthenticated:false,independentGroundTruth:false}});
      const stored:Stored={snapshot,subject:current.subject,accessSha256:current.accessSha256,
        sourceAuthoritySha256:fingerprint(current.authority),requestSha256:digest};
      view(stored,current);
      await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [current.pin.scope.caseId,snapshotKey(snapshot.reviewId),snapshotKind,fingerprint(stored),stored]);
      await client.query('INSERT INTO operations(case_id,operation_key,kind,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
        [current.pin.scope.caseId,requestKey(request.requestKey),requestKind,digest,{reviewId:snapshot.reviewId}]);
      return snapshot;
    });
    // Revalidate after commit; an ambiguous commit is recovered by the same key.
    return this.publish(itemId,saved.reviewId,deadline);
  }
}
