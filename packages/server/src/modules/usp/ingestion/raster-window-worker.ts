import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {RASTER_WINDOW_VERSION,RASTER_WINDOW_LIMITS,RasterWindowInputSchema,RasterWindowMetadataSchema,
  RasterWindowResultSchema,type RasterWindowInput} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,acceptUspJobAttempt,assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {assertRasterInputTx,rasterArtifactKey,rasterResultKey,readRasterResult} from './raster-window';

const reply=z.strictObject({metadata:RasterWindowMetadataSchema,artifactBase64:z.string().max(6*1024*1024),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),artifactBytes:z.number().int().positive().max(RASTER_WINDOW_LIMITS.artifactBytes)});
async function putExact(key:string,bytes:Buffer,mediaType:string){
  try{await putOriginal(key,bytes,mediaType);}catch(error){
    const prior=Buffer.from(await readObject(key).catch(()=>{throw error;}));
    if(prior.length!==bytes.length||sha256(prior)!==sha256(bytes))throw error;
  }
}
async function nativeWindow(input:RasterWindowInput){
  const response=await fetch(`${settings.geoUrl}/internal/raster/window`,{method:'POST',headers:{
    Authorization:`Bearer ${settings.geoToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({sourceId:input.sourceId,objectKey:input.objectKey,sha256:input.sourceSha256,
      bytes:input.sourceBytes,window:input.window}),signal:AbortSignal.timeout(100_000)});
  if(response.status===422){
    const detail=String((await response.json().catch(()=>({detail:''})))?.detail??'');
    if(detail==='Pixel window is outside the retained raster dimensions.')
      throw new AppError(422,'RASTER_WINDOW_OUT_OF_BOUNDS','Select a window within the retained raster dimensions. The original remains available.');
    if(detail==='Raster source hash or byte count differs from its retained receipt.'||detail==='Raster source exceeds its retained byte receipt.')
      throw new AppError(422,'RASTER_SOURCE_INTEGRITY','The retained raster differs from its source receipt. Re-upload the original.');
    throw new AppError(422,'RASTER_UNSUPPORTED','The retained GeoTIFF or selected native window is unsupported; the original remains available.');
  }
  if(!response.ok)throw new AppError(503,'RASTER_PROCESSOR_UNAVAILABLE','The bounded raster reader is unavailable; retry the retained source.');
  const parsed=reply.parse(await response.json());
  if(input.window&&fingerprint(parsed.metadata.window)!==fingerprint(input.window))
    throw new AppError(422,'RASTER_WINDOW_SCOPE','The reader returned a different pixel window.');
  const bytes=Buffer.from(parsed.artifactBase64,'base64');
  if(bytes.length!==parsed.artifactBytes||sha256(bytes)!==parsed.artifactSha256)
    throw new AppError(422,'RASTER_ARTIFACT_INTEGRITY','The reader artifact failed its hash or byte count.');
  return {metadata:parsed.metadata,bytes,hash:parsed.artifactSha256};
}
export async function failRasterWindowJob(jobId:string,code:string,attempt?:UspJobAttempt){
  await transaction(async client=>{
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='raster-window' FOR UPDATE",[jobId])).rows[0];
    if(!job||!['queued','running'].includes(job.status))return;
    if(attempt){try{await assertUspJobAttemptTx(client,attempt);}catch{return;}}
    const stale=code==='RASTER_INPUT_STALE';
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,stale?'stale':'failed',code]);
    if(job.payload.subject===process.env.ULPIN_LOCAL_OPERATOR_SUBJECT)
      await appendCaseIngestionTx(client,job.case_id,{kind:'raster-window.changed',sourceId:job.source_id,
        sourceRevision:job.payload.sourceRevision,jobId,status:stale?'stale':'failed'},job.payload.subject);
  });
}
export async function runRasterWindowJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='raster-window'",[jobId])).rows[0]??notFound('Raster job not found.');
  if(!['queued','running'].includes(job.status))return;
  const input=RasterWindowInputSchema.parse(job.payload);
  const beforeLocks=async(client:Parameters<typeof assertRasterInputTx>[0])=>{await assertRasterInputTx(client,input,true);};
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`raster:${randomUUID()}`,beforeLocks);}
  catch(error){
    const active=(await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
    if(active)return;
    await failRasterWindowJob(jobId,error instanceof AppError&&error.status===409?'RASTER_INPUT_STALE':'RASTER_CONTEXT_UNAVAILABLE');return;
  }
  try{
    await transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,attempt);
      await appendCaseIngestionTx(client,input.caseId,{kind:'raster-window.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);});
    const native=await nativeWindow(input);
    const artifact={key:rasterArtifactKey(jobId,native.hash),sha256:native.hash,bytes:native.bytes.length,mediaType:'image/tiff' as const};
    await putExact(artifact.key,native.bytes,artifact.mediaType);
    const result=RasterWindowResultSchema.parse({version:RASTER_WINDOW_VERSION,input,metadata:native.metadata,
      artifact,createdAt:new Date().toISOString()});
    const bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>RASTER_WINDOW_LIMITS.resultBytes)throw new AppError(413,'RASTER_RESULT_LIMIT','The window metadata exceeds the bounded result budget.');
    const hash=sha256(bytes),asset={assetId:`raster:${jobId}`,version:1,sha256:hash};
    await putExact(rasterResultKey(jobId,hash),bytes,'application/json');
    await acceptUspJobAttempt(attempt,asset,async(client,current,accepted)=>{
      if(current.operation!=='raster-window'||fingerprint(current.payload)!==fingerprint(input)||current.input_fingerprint!==attempt.inputSha256)
        conflict('The raster job input changed before publication.');
      const verified=await readRasterResult(input,accepted.sha256);
      const stored=Buffer.from(await readObject(verified.artifact.key));
      if(stored.length!==verified.artifact.bytes||sha256(stored)!==verified.artifact.sha256)
        throw new AppError(422,'RASTER_ARTIFACT_INTEGRITY','The staged native window differs from its receipt.');
      await assertRasterInputTx(client,input);
    },beforeLocks,async client=>{
      await appendCaseIngestionTx(client,input.caseId,{kind:'raster-window.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
    });
  }catch(error){
    await failRasterWindowJob(jobId,error instanceof AppError&&error.status===409?'RASTER_INPUT_STALE':
      error instanceof AppError?error.code:'RASTER_PROCESSING_FAILED',attempt);
  }
}
