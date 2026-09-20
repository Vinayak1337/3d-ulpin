import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SpatialMlItem,SpatialMlResult} from '@ulpin/contracts';
import type {DatasetMlOverview,DatasetMlRun,DatasetMlReview} from '../dataset-ml';
import {query,transaction} from './db';
import {fingerprint} from './domain';
import {AppError,notFound,conflict} from './errors';
import {getSpatialDataset} from './spatial-datasets';
import {ensureDatasetMl} from './dataset-ml-db';
import {spatialMlStatus,validateRetainedInference,retainArtifact,deriveSpatialMlGeometry,spatialMlCalibrationSchema,type InferencePayload} from './spatial-ml';
import {readObject,sha256} from './storage';
import {receiveCaseDocument} from './source-cases';
import {documentFormat} from '../document-formats';
import {pdfPageCount} from './pdf-pages';
const itemSchema=z.object({sourceId:z.string().uuid(),task:z.enum(['floor-plan','building']),page:z.number().int().min(1).max(500)}).strict();
const batchSchema=z.object({requestKey:z.string().uuid(),expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),items:z.array(itemSchema).min(1).max(12)}).strict();
const runSelect=`r.id,r.source_id AS "sourceId",s.name AS "sourceName",r.task,r.page,r.model_id AS "modelId",j.status,j.error,r.created_at AS "createdAt",r.result,(SELECT body FROM spatial_dataset_ml_reviews v WHERE v.run_id=r.id ORDER BY v.created_at DESC,v.id DESC LIMIT 1) review`;
type PdfSource={sha256:string;object_key:string;bytes:number|string};
const pageCounts=new Map<string,Promise<number>>();
async function retainedPdfPages(source:PdfSource){
 const key=source.sha256;
 let pending=pageCounts.get(key);
 if(!pending){
  pending=(async()=>{const bytes=await readObject(source.object_key);if(bytes.length!==Number(source.bytes)||sha256(bytes)!==source.sha256)throw new Error('Original PDF integrity mismatch.');return pdfPageCount(bytes);})();
  if(pageCounts.size>=128)pageCounts.delete(pageCounts.keys().next().value!);
  pageCounts.set(key,pending);
  pending.catch(()=>{if(pageCounts.get(key)===pending)pageCounts.delete(key);});
 }
 return pending;
}
export async function datasetMlOverview(id:string):Promise<DatasetMlOverview>{
 const dataset=await getSpatialDataset(id);await ensureDatasetMl();
 const row=(await query('SELECT case_id,normalized_source FROM spatial_datasets WHERE id=$1',[id])).rows[0];
 const sources=(await query<PdfSource&{id:string;name:string;mimeType:string}>(`SELECT id,name,mime_type AS "mimeType",object_key,sha256,bytes FROM sources WHERE case_id=$1 AND (inspection->>'kind'='package_member' OR profile IN ('pdf-reference-v2','png-reference-v2','jpeg-reference-v2')) ORDER BY name`,[row.case_id])).rows;
 const eligible=sources.filter(s=>['application/pdf','image/png','image/jpeg'].includes(s.mimeType));
 const frame=row.normalized_source.frames[0];
 const runs=(await query<DatasetMlRun>(`SELECT ${runSelect} FROM spatial_dataset_ml_runs r JOIN jobs j ON j.id=r.id JOIN sources s ON s.id=r.source_id WHERE r.dataset_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 60`,[id])).rows;
 const described:DatasetMlOverview['sources']=[];
 // Sequential, cached metadata reads avoid flooding storage/parser workers on large datasets.
 for(const source of eligible){
  let pageCount:number|null=source.mimeType==='application/pdf'?null:1,pageCountError:string|undefined;
  if(source.mimeType==='application/pdf')try{pageCount=await retainedPdfPages(source);}catch{pageCountError='Page count unavailable; PDF may be locked or unreadable.';}
  described.push({id:source.id,name:source.name,mimeType:source.mimeType,task:/floor.*plan|plan.*floor|plans\//i.test(source.name)?'floor-plan':source.mimeType.startsWith('image/')?'building':null,reason:'',pageCount,pageCountError});
 }
 return {datasetId:id,name:dataset.name,digest:dataset.digest,frameId:frame.id,verticalDatum:frame.verticalDatum,sources:described,runs,retainedOnly:sources.length-eligible.length};
}
export async function queueDatasetMl(id:string,value:unknown){
 const input=batchSchema.parse(value),dataset=await getSpatialDataset(id);await ensureDatasetMl();
 if(input.expectedDigest!==dataset.digest)conflict('The dataset snapshot changed. Reload its sources.');
 if(new Set(input.items.map(i=>fingerprint(i))).size!==input.items.length)throw new AppError(422,'DUPLICATE_SOURCE','Select a source/page/task only once per batch.');
 const models=await spatialMlStatus(),batchDigest=fingerprint(input);
 await transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`dataset-ml:${id}:${input.requestKey}`]);
  const prior=(await client.query('SELECT request_digest FROM spatial_dataset_ml_runs WHERE dataset_id=$1 AND request_key=$2',[id,input.requestKey])).rows;
  if(prior.length){if(prior.some(p=>p.request_digest!==batchDigest))conflict('This batch key names different inputs.');return;}
  const row=(await client.query('SELECT case_id,digest FROM spatial_datasets WHERE id=$1 FOR SHARE',[id])).rows[0];
  if(row.digest!==input.expectedDigest)conflict('Dataset changed.');
  for(const selected of input.items){
   const source=(await client.query(`SELECT * FROM sources WHERE id=$1 AND case_id=$2 AND (inspection->>'kind'='package_member' OR profile IN ('pdf-reference-v2','png-reference-v2','jpeg-reference-v2')) FOR SHARE`,[selected.sourceId,row.case_id])).rows[0];
   if(!source||!['image/png','image/jpeg','application/pdf'].includes(source.mime_type)||source.mime_type!=='application/pdf'&&selected.page!==1)throw new AppError(422,'SOURCE_UNSUPPORTED','Choose a retained image or PDF page belonging to this dataset.');
   if(source.mime_type==='application/pdf'){let pages:number;try{pages=await retainedPdfPages(source);}catch{throw new AppError(422,'PDF_UNREADABLE','Unable to read this PDF. Choose an unlocked, readable original.');}if(selected.page>pages)throw new AppError(422,'PDF_PAGE_RANGE',`This PDF has ${pages} page${pages===1?'':'s'}. Choose a page within that range.`);}
   const model=models.models.find(m=>m.task===selected.task&&m.ready);if(!model)throw new AppError(422,'MODEL_UNAVAILABLE','The requested local model is unavailable.');
   const spec={schemaVersion:'spatial-inference/1' as const,task:selected.task,modelId:model.id,expectedModelSha256:model.sha256,expectedProfileVersion:model.profileVersion,page:selected.page,source:{id:source.id,objectKey:source.object_key,sha256:source.sha256,bytes:Number(source.bytes),mimeType:source.mime_type}};
   const payload={...spec,inputFingerprint:fingerprint(spec)},jobId=randomUUID();
   await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,input_fingerprint,payload) VALUES($1,$2,$3,'dataset-spatial-inference',$4,$5)`,[jobId,row.case_id,source.id,payload.inputFingerprint,payload]);
   await client.query(`INSERT INTO spatial_dataset_ml_runs(id,dataset_id,source_id,request_key,request_digest,task,page,model_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[jobId,id,source.id,input.requestKey,batchDigest,selected.task,selected.page,model.id]);
  }
 });return datasetMlOverview(id);
}
export async function failDatasetMl(jobId:string,message:string){await query("UPDATE jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1 AND operation='dataset-spatial-inference' AND status IN ('queued','running')",[jobId,message.slice(0,600)]);}
export async function markDatasetMlRunning(jobId:string){await query("UPDATE jobs SET status='running',started_at=coalesce(started_at,now()) WHERE id=$1 AND status IN ('queued','running')",[jobId]);}
export async function ingestDatasetMl(jobId:string,value:unknown){
 const row=(await query(`SELECT r.dataset_id,j.payload,j.status,s.sha256 FROM spatial_dataset_ml_runs r JOIN jobs j ON j.id=r.id JOIN sources s ON s.id=r.source_id WHERE r.id=$1`,[jobId])).rows[0];
 if(!row||!['queued','running'].includes(row.status))return;
 const input=row.payload as InferencePayload;if(input.source.sha256!==row.sha256)conflict('Source changed since extraction was queued.');
 const output=await validateRetainedInference(value,input);
 const raster=await retainArtifact(jobId,jobId,'raster',output.raster),mask=await retainArtifact(jobId,jobId,'mask',output.mask);
 const url=(kind:string)=>`/api/v1/spatial-datasets/${row.dataset_id}/ml?run=${jobId}&artifact=${kind}`;
 const result:SpatialMlResult={model:{id:output.model.id,sha256:output.model.sha256},raster:{sha256:raster.sha256,width:raster.width,height:raster.height,url:url('raster')},mask:{sha256:mask.sha256,width:mask.width,height:mask.height,url:url('mask')},components:output.components,receipt:{...output.receipt,model:output.model,rasterTransform:output.raster.transform,inputFingerprint:input.inputFingerprint,authority:'Unreviewed pixel predictions; scale, height and ownership are separate evidence.'}};
 await transaction(async client=>{const job=(await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];if(!['queued','running'].includes(job?.status))return;await client.query('UPDATE spatial_dataset_ml_runs SET result=$2,artifacts=$3 WHERE id=$1',[jobId,result,{raster,mask}]);await client.query("UPDATE jobs SET status='succeeded',completed_at=now(),error=NULL WHERE id=$1",[jobId]);});
}
export async function datasetMlArtifact(datasetId:string,runId:string,kind:string){
 if(!['raster','mask'].includes(kind))notFound();await getSpatialDataset(datasetId);await ensureDatasetMl();
 const row=(await query('SELECT artifacts FROM spatial_dataset_ml_runs WHERE id=$1 AND dataset_id=$2',[z.string().uuid().parse(runId),datasetId])).rows[0];
 const artifact=row?.artifacts?.[kind];if(!artifact)notFound('Retained image is unavailable.');
 const bytes=await readObject(artifact.objectKey);if(bytes.length!==artifact.bytes||sha256(bytes)!==artifact.sha256)throw new AppError(409,'ARTIFACT_INTEGRITY','Retained artifact hash changed.');
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
}
const reviewSchema=z.object({requestKey:z.string().uuid(),runId:z.string().uuid(),decision:z.enum(['keep','reject']),componentIds:z.array(z.string().min(1).max(120)).min(1).max(100),note:z.string().trim().min(3).max(2000),calibration:spatialMlCalibrationSchema.optional(),lowerM:z.number().finite().min(-1000).max(10000).optional(),upperM:z.number().finite().min(-1000).max(10000).optional(),levelEvidence:z.string().trim().min(3).max(2000).optional()}).strict();
export async function reviewDatasetMl(datasetId:string,value:unknown){
 const input=reviewSchema.parse(value);await getSpatialDataset(datasetId);await ensureDatasetMl();
 return transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`dataset-ml-review:${input.runId}:${input.requestKey}`]);
  const prior=(await client.query('SELECT v.request_digest,v.body FROM spatial_dataset_ml_reviews v JOIN spatial_dataset_ml_runs r ON r.id=v.run_id WHERE v.run_id=$1 AND v.request_key=$2 AND r.dataset_id=$3',[input.runId,input.requestKey,datasetId])).rows[0];
  const digest=fingerprint(input);if(prior){if(prior.request_digest!==digest)conflict('Review request key has different inputs.');return prior.body;}
  const row=(await client.query(`SELECT r.result,j.status,d.normalized_source FROM spatial_dataset_ml_runs r JOIN jobs j ON j.id=r.id JOIN spatial_datasets d ON d.id=r.dataset_id WHERE r.id=$1 AND r.dataset_id=$2 FOR SHARE`,[input.runId,datasetId])).rows[0];
  if(!row||row.status!=='succeeded'||!row.result?.components?.length)throw new AppError(422,'RESULT_REQUIRED','Review a completed nonempty prediction.');
  const result=row.result as SpatialMlResult;
  if(new Set(input.componentIds).size!==input.componentIds.length||input.componentIds.some(id=>!result.components.some(c=>c.id===id)))throw new AppError(422,'COMPONENT_MISMATCH','A selected region is not in this retained result.');
  const review:DatasetMlReview={id:randomUUID(),decision:input.decision,componentIds:input.componentIds,note:input.note,createdAt:new Date().toISOString()};
  if(input.calibration){
   if(input.decision!=='keep')throw new AppError(422,'REVIEW_DECISION','Rejected predictions cannot create metric proposals.');
   if(input.calibration.frame!==row.normalized_source.frames[0].id)conflict('Controls must use the dataset’s retained metre frame.');
   const components=deriveSpatialMlGeometry({state:'succeeded',result} as SpatialMlItem,input.calibration).filter(c=>input.componentIds.includes(c.id));
   if((input.lowerM===undefined)!==(input.upperM===undefined)||input.lowerM!==undefined&&input.upperM!<=input.lowerM)throw new AppError(422,'HEIGHT_RANGE','Provide both evidence-based lower and upper levels, with upper above lower.');
   const areas=(await client.query(`SELECT value->>'id' id,ST_Area(g) area,ST_IsValid(g) valid FROM (SELECT value,ST_GeomFromGeoJSON(value->'geometry') g FROM jsonb_array_elements($1::jsonb)) q`,[JSON.stringify(components)])).rows;
   if(areas.some(a=>!a.valid||Number(a.area)<=0))throw new AppError(422,'GEOMETRY_INVALID','A metric proposal has invalid topology.');
   if(input.lowerM!==undefined&&!input.levelEvidence)throw new AppError(422,'LEVEL_EVIDENCE','Describe the evidence for the vertical levels.');
   review.calibration=input.calibration;review.lowerM=input.lowerM;review.upperM=input.upperM;review.levelEvidence=input.levelEvidence;
   review.geometry=components.map(c=>{const area=Number(areas.find(a=>a.id===c.id).area);return {id:c.id,className:c.className,geometry:c.geometry,areaM2:area,volumeM3:input.lowerM===undefined?null:area*(input.upperM!-input.lowerM)};});
   const overlaps=(await client.query(`WITH shapes AS (SELECT value->>'id' id,ST_GeomFromGeoJSON(value->'geometry') g FROM jsonb_array_elements($1::jsonb)) SELECT a.id a,b.id b,ST_Area(ST_Intersection(a.g,b.g)) area FROM shapes a JOIN shapes b ON a.id<b.id AND a.g&&b.g WHERE ST_Area(ST_Intersection(a.g,b.g))>0.000001`,[JSON.stringify(components)])).rows;
   review.checks=overlaps.map(o=>({code:'PROPOSAL_OVERLAP',message:`${o.a} overlaps ${o.b}`,areaM2:Number(o.area)}));
  }else if(input.lowerM!==undefined||input.upperM!==undefined)throw new AppError(422,'SCALE_REQUIRED','Calibrate the retained pixels before assigning metric levels.');
  await client.query('INSERT INTO spatial_dataset_ml_reviews(id,run_id,request_key,request_digest,body) VALUES($1,$2,$3,$4,$5)',[review.id,input.runId,input.requestKey,digest,review]);return review;
 });
}

export async function attachDatasetMlSource(id:string,name:string,bytes:Uint8Array,requestKey:string){
 await getSpatialDataset(id);const format=documentFormat(name);
 if(!['pdf','png','jpeg'].includes(format??''))throw new AppError(422,'SOURCE_FORMAT','Attach a PNG, JPEG or PDF original.');
 if(name.length>200||/[\\/\x00-\x1f]/.test(name))throw new AppError(422,'SOURCE_NAME','Use a simple filename without directories.');
 const row=(await query('SELECT case_id FROM spatial_datasets WHERE id=$1',[id])).rows[0];
 return receiveCaseDocument(row.case_id,{name,bytes,format:format as 'pdf'|'png'|'jpeg',requestKey,entityIds:[]});
}
