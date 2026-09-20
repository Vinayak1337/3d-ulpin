/** Verifies the actual retained local inference and browser-authored demo review; does not simulate model accuracy. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {datasetMlOverview,queueDatasetMl,reviewDatasetMl,datasetMlArtifact} from '../apps/web/lib/server/dataset-ml';
import {validateRetainedInference} from '../apps/web/lib/server/spatial-ml';
import {readSpatialDatasetOriginal} from '../apps/web/lib/server/spatial-datasets';
import {readObject,sha256} from '../apps/web/lib/server/storage';
import {query,pool} from '../apps/web/lib/server/db';
const lake='22b196c2-b467-4f38-9252-5b4c5e3a2f14',shiv='160028fd-b3a4-42e9-b6da-daff641ddd3c';
const checks:string[]=[];
async function main(){
 const data=await datasetMlOverview(lake),other=await datasetMlOverview(shiv);
 const before=(await query('SELECT normalized_source,canonical_input,digest FROM spatial_datasets WHERE id=$1',[lake])).rows[0];
 const jobs=(await query('SELECT r.*,j.payload,j.status FROM spatial_dataset_ml_runs r JOIN jobs j ON j.id=r.id WHERE dataset_id=$1 ORDER BY r.created_at,r.task',[lake])).rows;
 assert.ok(jobs.length>=2);
 for(const task of ['floor-plan','building']){const run=data.runs.find(r=>r.task===task&&r.status==='succeeded');assert.ok(run?.result?.receipt.actualInference);assert.ok(run.result.components.length);}
 checks.push('actual CPU inference retained for both models');
 const batch=jobs.filter(r=>r.request_key===jobs[0].request_key);
 const input={requestKey:batch[0].request_key,expectedDigest:data.digest,items:batch.map(r=>({sourceId:r.source_id,task:r.task,page:r.page}))};
 await queueDatasetMl(lake,input);assert.equal((await datasetMlOverview(lake)).runs.length,data.runs.length);checks.push('exact batch replay creates no jobs');
 await assert.rejects(queueDatasetMl(lake,{...input,items:input.items.slice(0,1)}),/different inputs/);
 await assert.rejects(queueDatasetMl(lake,{...input,expectedDigest:'0'.repeat(64)}),/snapshot changed/);
 await assert.rejects(queueDatasetMl(shiv,{...input,requestKey:randomUUID(),expectedDigest:other.digest}),/belonging to this dataset/);
 checks.push('changed request, snapshot and cross-dataset source rejected atomically');
 const sourceRows=(await query('SELECT s.object_key,s.sha256,s.bytes FROM sources s JOIN spatial_datasets d ON d.case_id=s.case_id WHERE d.id=$1',[lake])).rows;
 for(const s of sourceRows){const bytes=await readObject(s.object_key);assert.equal(sha256(bytes),s.sha256);assert.equal(bytes.length,Number(s.bytes));}
 const original=await readSpatialDatasetOriginal(lake);assert.equal(sha256(original.bytes),'94d6cd80cd0b2ac4c0d7b5abf6b01dc93a70e373e6e607aae3d746579beea087');checks.push('all retained source bytes and original package unchanged');
 for(const r of jobs.filter(j=>j.status==='succeeded')){
  const out=r.result,artifacts=r.artifacts;
  const pack=async(a:any)=>({...a,base64:Buffer.from(await readObject(a.objectKey)).toString('base64')});
  const output={schemaVersion:'spatial-inference/1',inputFingerprint:r.payload.inputFingerprint,task:r.task,status:out.components.length?'succeeded':'empty',model:out.receipt.model,raster:await pack(artifacts.raster),mask:await pack(artifacts.mask),components:out.components,receipt:out.receipt};
  await validateRetainedInference(output,r.payload);
  await assert.rejects(validateRetainedInference({...output,inputFingerprint:'0'.repeat(64)},r.payload),/fingerprint/);
  await assert.rejects(validateRetainedInference({...output,receipt:{...output.receipt,sourceId:randomUUID()}},r.payload),/receipt/);
  await assert.rejects(validateRetainedInference({...output,raster:{...output.raster,sha256:'0'.repeat(64)}},r.payload),/byte\/hash/);
  const artifact=await datasetMlArtifact(lake,r.id,'raster');assert.equal(sha256(new Uint8Array(await artifact.arrayBuffer())),artifacts.raster.sha256);
  await assert.rejects(datasetMlArtifact(shiv,r.id,'raster'),/unavailable/);
 }
 checks.push('source/model fingerprints, artifact hashes and dataset scoping enforced');
 const run=data.runs.find(r=>r.review?.geometry?.length);assert.ok(run?.review?.calibration);
 const retained=(await query('SELECT request_key,body FROM spatial_dataset_ml_reviews WHERE id=$1',[run.review.id])).rows[0];
 const review={requestKey:retained.request_key,runId:run.id,decision:run.review.decision,componentIds:run.review.componentIds,note:run.review.note,calibration:run.review.calibration,lowerM:run.review.lowerM,upperM:run.review.upperM,levelEvidence:run.review.levelEvidence};
 const replay=await reviewDatasetMl(lake,review);assert.equal(replay.id,run.review.id);
 await assert.rejects(reviewDatasetMl(shiv,review),/completed nonempty/);
 await assert.rejects(reviewDatasetMl(lake,{...review,requestKey:randomUUID(),calibration:{...review.calibration,frame:'another-frame'}}),/retained metre frame/);
 await assert.rejects(reviewDatasetMl(lake,{...review,requestKey:randomUUID(),calibration:{...review.calibration,rasterSha256:'0'.repeat(64)}}),/different raster/);
 await assert.rejects(reviewDatasetMl(lake,{...review,requestKey:randomUUID(),levelEvidence:undefined}),/evidence for the vertical/);
 await assert.rejects(reviewDatasetMl(lake,{...review,requestKey:randomUUID(),upperM:review.lowerM}),/upper above lower/);
 const g=run.review.geometry[0];assert.equal(g.areaM2,369);assert.equal(g.volumeM3,1107);
 checks.push('review replay, dataset/frame/raster/height guards and 369 m² × 3 m = 1107 m³ verified');
 assert.deepEqual((await query('SELECT normalized_source,canonical_input,digest FROM spatial_datasets WHERE id=$1',[lake])).rows[0],before);
 checks.push('no mutation of canonical source snapshot');
 const evidence={checks,sourceObjectsVerified:sourceRows.length,dataset:lake,runs:data.runs.map(r=>({id:r.id,task:r.task,status:r.status,regions:r.result?.components.length,model:r.result?.model,actualInference:r.result?.receipt.actualInference,inferenceMs:r.result?.receipt.inferenceMs,review:r.review})),classification:'fictional demonstration; model predictions remain unapproved'};
 await writeFile('docs/engineering-plan/evidence/t084/integration.json',JSON.stringify(evidence,null,2));console.log(checks.join('\n'));
}
main().finally(()=>pool().end());
