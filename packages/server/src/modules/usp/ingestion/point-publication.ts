import {z} from 'zod';
import {POINT_BATCH_LIMITS,PointBatchMetadataSchema,type PointBatchInput} from '@ulpin/contracts/usp';
import type {DbDeadline} from '../../../infrastructure/db';
import {AppError} from '../../../infrastructure/errors';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';

const reply=z.strictObject({metadata:PointBatchMetadataSchema,artifactBase64:z.string().max(720*1024),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),artifactBytes:z.number().int().positive().max(POINT_BATCH_LIMITS.artifactBytes)});
// Exact maximum base64 artifact plus the existing receipt/metadata ceiling.
export const POINT_NATIVE_REPLY_BYTES=4*Math.ceil(POINT_BATCH_LIMITS.artifactBytes/3)+POINT_BATCH_LIMITS.resultBytes;
export function pointPublicationLive(bounds:DbDeadline){
  if(bounds.signal?.aborted){
    if(bounds.signal.reason instanceof AppError)throw bounds.signal.reason;
    if(bounds.signal.reason?.name==='TimeoutError')throw new AppError(504,'POINT_TIMEOUT','The bounded point transport deadline elapsed.');
    throw new AppError(503,'POINT_CANCELLED','Owned point processing stopped; the original remains retained.');
  }
  if(Date.now()>=bounds.deadlineAt)throw new AppError(504,'POINT_TIMEOUT','The absolute point publication deadline elapsed.');
}
/** Cap wire bytes before JSON/base64 allocation; cancel the owned response on
 * refusal/stop. Fetch and this body share the same finite native deadline. */
export async function pointNativeJson(response:Response,cap:number,bounds:DbDeadline):Promise<unknown>{
  try{pointPublicationLive(bounds);}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>cap)){
    await response.body?.cancel().catch(()=>{});
    throw new AppError(413,'POINT_REPLY_LIMIT','The point reader reply exceeds its bounded profile.');
  }
  if(!response.body)throw new AppError(503,'POINT_PROCESSOR_UNAVAILABLE','The point reader returned no bounded body.');
  const reader=response.body.getReader(),chunks:Buffer[]=[];let count=0;
  const stop=()=>{void reader.cancel().catch(()=>{});};bounds.signal?.addEventListener('abort',stop,{once:true});
  try{
    while(true){pointPublicationLive(bounds);const {done,value}=await reader.read();pointPublicationLive(bounds);if(done)break;
      count+=value.byteLength;if(count>cap)throw new AppError(413,'POINT_REPLY_LIMIT','The point reader reply exceeds its bounded profile.');
      chunks.push(Buffer.from(value));}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,count)));
  }catch(error){pointPublicationLive(bounds);throw error;}
  finally{bounds.signal?.removeEventListener('abort',stop);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function nativePointBatch(input:PointBatchInput,bounds:DbDeadline,request:typeof fetch=fetch){
  pointPublicationLive(bounds);
  const deadlineAt=Math.min(bounds.deadlineAt,Date.now()+100000),signal=AbortSignal.any([
    AbortSignal.timeout(Math.max(1,deadlineAt-Date.now())),...(bounds.signal?[bounds.signal]:[])]),nativeBounds={deadlineAt,signal};
  let response:Response;
  try{response=await request(`${settings.geoUrl}/internal/point/batch`,{method:'POST',headers:{
    Authorization:`Bearer ${settings.geoToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({sourceId:input.sourceId,objectKey:input.objectKey,sha256:input.sourceSha256,bytes:input.sourceBytes,batch:input.batch}),signal});
  }catch(error){pointPublicationLive(nativeBounds);throw error;}
  if(response.status===422){
    let value:unknown;try{value=await pointNativeJson(response,POINT_BATCH_LIMITS.resultBytes,nativeBounds);}
    catch(error){if(error instanceof AppError)throw error;value=null;}
    const detail=z.object({detail:z.string().max(2048)}).safeParse(value),text=detail.success?detail.data.detail:'';
    if(text==='Point batch is outside the retained source point count.')
      throw new AppError(422,'POINT_BATCH_OUT_OF_BOUNDS','Select a batch within the retained point count. The original remains available.');
    if(text==='Point source hash or byte count differs from its retained receipt.'||text==='Point source exceeds its retained byte receipt.')
      throw new AppError(422,'POINT_SOURCE_INTEGRITY','The retained point differs from its source receipt. Re-upload the original.');
    throw new AppError(422,'POINT_UNSUPPORTED','The retained LAZ/COPC or selected native batch is unsupported; the original remains available.');
  }
  if(!response.ok){await response.body?.cancel().catch(()=>{});
    throw new AppError(503,'POINT_PROCESSOR_UNAVAILABLE','The bounded point reader is unavailable; retry the retained source.');}
  const parsed=reply.parse(await pointNativeJson(response,POINT_NATIVE_REPLY_BYTES,nativeBounds));
  const batch=input.batch??{start:0,count:Math.min(POINT_BATCH_LIMITS.batchPoints,parsed.metadata.sourcePointCount)};
  if(fingerprint(parsed.metadata.batch)!==fingerprint(batch))
    throw new AppError(422,'POINT_BATCH_SCOPE','The reader returned a different point batch.');
  if(parsed.artifactBase64.length!==4*Math.ceil(parsed.artifactBytes/3))
    throw new AppError(422,'POINT_ARTIFACT_INTEGRITY','The reader artifact differs from its bounded base64 length.');
  const bytes=Buffer.from(parsed.artifactBase64,'base64');
  if(bytes.length!==parsed.artifactBytes||bytes.toString('base64')!==parsed.artifactBase64||sha256(bytes)!==parsed.artifactSha256)
    throw new AppError(422,'POINT_ARTIFACT_INTEGRITY','The reader artifact failed its exact hash or byte count.');
  pointPublicationLive(nativeBounds);return {metadata:parsed.metadata,bytes,hash:parsed.artifactSha256};
}
