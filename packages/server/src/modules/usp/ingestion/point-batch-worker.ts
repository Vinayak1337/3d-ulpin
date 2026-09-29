import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {POINT_BATCH_VERSION,POINT_BATCH_LIMITS,PointBatchInputSchema,PointBatchMetadataSchema,
  PointBatchResultSchema,type PointBatchInput} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,acceptUspJobAttempt,assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {assertPointInputTx,pointArtifactKey,pointResultKey,readPointResult} from './point-batch';

const reply=z.strictObject({metadata:PointBatchMetadataSchema,artifactBase64:z.string().max(720*1024),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),artifactBytes:z.number().int().positive().max(POINT_BATCH_LIMITS.artifactBytes)});
async function putExact(key:string,bytes:Buffer,mediaType:string){
  try{await putOriginal(key,bytes,mediaType);}catch(error){
    const prior=Buffer.from(await readObject(key).catch(()=>{throw error;}));
    if(prior.length!==bytes.length||sha256(prior)!==sha256(bytes))throw error;
  }
}
async function nativeBatch(input:PointBatchInput){
  const response=await fetch(`${settings.geoUrl}/internal/point/batch`,{method:'POST',headers:{
    Authorization:`Bearer ${settings.geoToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({sourceId:input.sourceId,objectKey:input.objectKey,sha256:input.sourceSha256,
      bytes:input.sourceBytes,batch:input.batch}),signal:AbortSignal.timeout(100_000)});
  if(response.status===422){
    const detail=String((await response.json().catch(()=>({detail:''})))?.detail??'');
    if(detail==='Point batch is outside the retained source point count.')
      throw new AppError(422,'POINT_BATCH_OUT_OF_BOUNDS','Select a batch within the retained point count. The original remains available.');
    if(detail==='Point source hash or byte count differs from its retained receipt.'||detail==='Point source exceeds its retained byte receipt.')
      throw new AppError(422,'POINT_SOURCE_INTEGRITY','The retained point differs from its source receipt. Re-upload the original.');
    throw new AppError(422,'POINT_UNSUPPORTED','This LAZ/COPC format or selected native batch is unsupported; the original remains available.');
  }
  if(!response.ok)throw new AppError(503,'POINT_PROCESSOR_UNAVAILABLE','The bounded point reader is unavailable; retry the retained source.');
  const parsed=reply.parse(await response.json());
  if(input.batch&&fingerprint(parsed.metadata.batch)!==fingerprint(input.batch))
    throw new AppError(422,'POINT_BATCH_SCOPE','The reader returned a different point batch.');
  const bytes=Buffer.from(parsed.artifactBase64,'base64');
  if(bytes.length!==parsed.artifactBytes||sha256(bytes)!==parsed.artifactSha256)
    throw new AppError(422,'POINT_ARTIFACT_INTEGRITY','The reader artifact failed its hash or byte count.');
  return {metadata:parsed.metadata,bytes,hash:parsed.artifactSha256};
}
export async function failPointBatchJob(jobId:string,code:string,attempt?:UspJobAttempt){
  await transaction(async client=>{
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='point-batch' FOR UPDATE",[jobId])).rows[0];
    if(!job||!['queued','running'].includes(job.status))return;
    if(attempt){try{await assertUspJobAttemptTx(client,attempt);}catch{return;}}
    const stale=code==='POINT_INPUT_STALE';
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,stale?'stale':'failed',code]);
    if(job.payload.subject===process.env.ULPIN_LOCAL_OPERATOR_SUBJECT)
      await appendCaseIngestionTx(client,job.case_id,{kind:'point-batch.changed',sourceId:job.source_id,
        sourceRevision:job.payload.sourceRevision,jobId,status:stale?'stale':'failed'},job.payload.subject);
  });
}
export async function runPointBatchJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='point-batch'",[jobId])).rows[0]??notFound('Point job not found.');
  if(!['queued','running'].includes(job.status))return;
  const input=PointBatchInputSchema.parse(job.payload);
  const beforeLocks=async(client:Parameters<typeof assertPointInputTx>[0])=>{await assertPointInputTx(client,input,true);};
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`point:${randomUUID()}`,beforeLocks);}
  catch(error){
    const active=(await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
    if(active)return;
    await failPointBatchJob(jobId,error instanceof AppError&&error.status===409?'POINT_INPUT_STALE':'POINT_CONTEXT_UNAVAILABLE');return;
  }
  try{
    await transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,attempt);
      await appendCaseIngestionTx(client,input.caseId,{kind:'point-batch.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);});
    const native=await nativeBatch(input);
    const artifact={key:pointArtifactKey(jobId,native.hash),sha256:native.hash,bytes:native.bytes.length,
      mediaType:'application/vnd.las.point-records' as const};
    await putExact(artifact.key,native.bytes,artifact.mediaType);
    const result=PointBatchResultSchema.parse({version:POINT_BATCH_VERSION,input,metadata:native.metadata,
      artifact,createdAt:new Date().toISOString()});
    const bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>POINT_BATCH_LIMITS.resultBytes)throw new AppError(413,'POINT_RESULT_LIMIT','The batch metadata exceeds the bounded result budget.');
    const hash=sha256(bytes),asset={assetId:`point:${jobId}`,version:1,sha256:hash};
    await putExact(pointResultKey(jobId,hash),bytes,'application/json');
    await acceptUspJobAttempt(attempt,asset,async(client,current,accepted)=>{
      if(current.operation!=='point-batch'||fingerprint(current.payload)!==fingerprint(input)||current.input_fingerprint!==attempt.inputSha256)
        conflict('The point job input changed before publication.');
      const verified=await readPointResult(input,accepted.sha256);
      const stored=Buffer.from(await readObject(verified.artifact.key));
      if(stored.length!==verified.artifact.bytes||sha256(stored)!==verified.artifact.sha256)
        throw new AppError(422,'POINT_ARTIFACT_INTEGRITY','The staged native batch differs from its receipt.');
      await assertPointInputTx(client,input);
    },beforeLocks,async client=>{
      await appendCaseIngestionTx(client,input.caseId,{kind:'point-batch.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
    });
  }catch(error){
    await failPointBatchJob(jobId,error instanceof AppError&&error.status===409?'POINT_INPUT_STALE':
      error instanceof AppError?error.code:'POINT_PROCESSING_FAILED',attempt);
  }
}
